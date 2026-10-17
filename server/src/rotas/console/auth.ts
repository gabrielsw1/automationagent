// Acesso ao console: entrar (com bloqueio), escolher a empresa, sair, confirmar o e-mail do
// cadastro, senha nova por link, aceitar convite e criar a conta de uma empresa nova.
// A conta (e-mail e senha) é da plataforma e vale para todas as empresas em que a pessoa está
// na equipe; o perfil é de cada empresa.
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  cnpjValido,
  somenteDigitos,
  type CadastroEmpresaPedido,
  type ConfirmacaoEmail,
  type ConviteAberto,
  type EmpresaDaConta,
  type Entrada,
  type Eu,
  type LinkSenhaAberto,
  type PedidoSenhaNova,
  type PerfilEquipe,
  type PrimeiroAcesso,
} from '@copiloto/shared';
import { COOKIE_SESSAO, definirCookie, euDe, iniciais, membro, membroNaEmpresa, perfilNaEmpresa } from '../../auth/console.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import { agoraIso } from '../../db/banco.ts';
import { emailCodigo, emailSenhaNova } from '../../email/modelos.ts';
import {
  empresaDoToken,
  MINUTOS_BLOQUEIO,
  SEGUNDOS_REENVIO_CODIGO,
  SEGUNDOS_REENVIO_LINK,
  sistemaNovo,
  type Conta,
  type Plataforma,
} from '../../plataforma/index.ts';
import type { SessaoPlataforma } from '../../plataforma/index.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';
import { novoId } from '../../util/ids.ts';

const Email = z
  .string({ error: 'Digite o seu e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Digite um e-mail completo, por exemplo nome@empresa.com.br'));
const Entrar = z.object({ email: z.string().trim().toLowerCase(), senha: z.string(), convite: z.string().min(1).optional() });
const Nome = z.string().trim().min(2, 'Diga seu nome.').max(120, 'O nome pode ter até 120 caracteres.');
const AceitarConvite = z.object({ nome: z.string().trim().max(120).optional(), senha: z.string() });
const TrocarEmpresa = z.object({ empresaId: z.string().min(1) });
const Codigo = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, 'Digite os 6 dígitos do código.') });
const SenhaNova = z.object({ senha: z.string(), sairDosOutros: z.boolean().default(true) });

/** Regra de senha das telas de senha nova e de convite: pelo menos 8 caracteres. */
export function problemaSenhaSimples(senha: string): string | null {
  if (senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (senha.length > 200) return 'A senha pode ter até 200 caracteres.';
  return null;
}

/** Regras de senha do cadastro (as mesmas que a tela mostra). Devolve o problema ou null. */
export function problemaSenha(senha: string, empresa?: string): string | null {
  const curta = problemaSenhaSimples(senha);
  if (curta) return curta;
  if (!/\p{L}/u.test(senha) || !/\d/.test(senha)) return 'Use letras e números na senha.';
  const simples = (t: string) => t.toLowerCase().replace(/[^\p{L}\d]/gu, '');
  const nomeEmpresa = empresa ? simples(empresa) : '';
  if (nomeEmpresa.length >= 3 && simples(senha).includes(nomeEmpresa)) return 'A senha precisa ser diferente do nome da empresa.';
  return null;
}

// Quem cria o espaço de uma empresa usa o e-mail da empresa (o design pede "e-mail de trabalho").
const PROVEDORES_PESSOAIS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br',
  'proton.me', 'protonmail.com', 'aol.com',
]);

/** Metadados de nuvem e afins: nenhum sistema de cliente mora aí, e o servidor não deve abrir. */
const HOST_PROIBIDO = /^(169\.254\.\d+\.\d+|metadata(\.google\.internal)?|\[fd00:ec2::254\])$/i;

/** Endereço http(s) completo. Ex.: https://app.suaempresa.com.br */
export const UrlSistema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host && !HOST_PROIBIDO.test(u.hostname);
    } catch {
      return false;
    }
  }, 'Use o endereço completo do sistema, começando com https://');

const Cadastro = z
  .object({
    empresa: z.object({
      nome: z.string().trim().min(2, 'Diga o nome da empresa.').max(80, 'O nome da empresa pode ter até 80 caracteres.'),
      cnpj: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? somenteDigitos(v) : undefined))
        .refine((v) => v === undefined || cnpjValido(v), 'CNPJ inválido. Confira os números.'),
      faixaUsuarios: z.enum(['ate_200', 'ate_1000', 'ate_5000', 'mais_5000']).optional(),
    }),
    pessoa: z
      .object({
        nome: Nome,
        email: z.string().trim().toLowerCase().email('E-mail inválido.'),
        senha: z.string(),
      })
      .optional(),
    aceites: z.object({ termos: z.boolean(), dados: z.boolean() }, { error: 'Aceite os termos de uso e o contrato de tratamento de dados.' }),
  })
  .superRefine((d, c) => {
    if (!d.aceites.termos || !d.aceites.dados) {
      c.addIssue({ code: 'custom', message: 'Para criar o espaço, aceite os termos de uso e o contrato de tratamento de dados (LGPD).' });
    }
    if (!d.pessoa) return;
    if (PROVEDORES_PESSOAIS.has(d.pessoa.email.split('@')[1] ?? '')) {
      c.addIssue({ code: 'custom', message: 'Use o e-mail da empresa, por exemplo nome@suaempresa.com.br.' });
    }
  }) satisfies z.ZodType<CadastroEmpresaPedido, unknown>;

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

/** Empresa e linha do convite pelo token (`<empresa>.<aleatório>`), mesmo vencido (a tela diz quem reenviar). */
function convitePorToken(plataforma: Plataforma, token: string) {
  const empresaId = empresaDoToken(token);
  const empresa = empresaId ? plataforma.empresa(empresaId) : undefined;
  const ctx = empresa?.status === 'ativa' ? plataforma.contexto(empresa.id) : undefined;
  const l = ctx?.banco.um<{ id: string; email: string; perfil: PerfilEquipe; convite_expira_em: string | null; convidado_por: string | null }>(
    "SELECT id, email, perfil, convite_expira_em, convidado_por FROM equipe WHERE convite_token = ? AND status = 'convidado'",
    token,
  );
  if (!ctx || !l) throw new ErroHttp(404, 'convite_invalido', 'Este convite não existe ou já foi usado.');
  const quem = l.convidado_por
    ? ctx.banco.um<{ nome: string | null; email: string; perfil: PerfilEquipe }>('SELECT nome, email, perfil FROM equipe WHERE id = ?', l.convidado_por)
    : undefined;
  const convidadoPor = quem ? { nome: quem.nome ?? quem.email, perfil: quem.perfil } : null;
  const expirado = !!l.convite_expira_em && l.convite_expira_em < agoraIso();
  return { ctx, convite: l, convidadoPor, expirado };
}

function conviteVencido(convidadoPor: { nome: string } | null, email: string): ErroHttp {
  return new ErroHttp(
    410,
    'convite_expirado',
    convidadoPor
      ? `Este convite expirou. Peça ao ${convidadoPor.nome} para reenviar em Equipe e limites.`
      : 'Este convite expirou. Peça a um Admin da empresa para reenviar em Equipe e limites.',
    { email },
  );
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;
  const seguro = plataforma.config.urlPublica.startsWith('https://');
  const urlConsole = plataforma.config.urlConsole.replace(/\/+$/, '');

  /** Abre a sessão da conta na empresa e devolve o "Eu" dela lá. */
  function abrirSessao(reply: FastifyReply, conta: Conta, ctx: Contexto): Eu {
    const m = membroNaEmpresa(ctx, conta.email);
    if (!m) throw new ErroHttp(403, 'fora_da_equipe', 'Você não está mais na equipe desta empresa.');
    const { token, expira } = plataforma.criarSessao(conta.id, ctx.empresa.id);
    definirCookie(reply, token, expira, seguro);
    return euDe(ctx, m);
  }

  /** Empresas em que a conta está ativa na equipe, a usada por último primeiro. */
  function empresasDaConta(conta: Conta): EmpresaDaConta[] {
    const lista = plataforma.empresasDe(conta.email).flatMap((e) => {
      const m = perfilNaEmpresa(plataforma.contexto(e.id), conta.email);
      if (!m) return [];
      return [{ id: e.id, nome: e.nome, demo: e.demo, perfil: m.perfil, iniciais: iniciais(e.nome), ultimoAcesso: plataforma.ultimoAcesso(conta.email, e.id) }];
    });
    return lista.sort(
      (a, b) =>
        Number(b.id === conta.ultimaEmpresaId) - Number(a.id === conta.ultimaEmpresaId) ||
        (b.ultimoAcesso ?? '').localeCompare(a.ultimoAcesso ?? '') ||
        Number(a.demo) - Number(b.demo),
    );
  }

  /** Depois de conferir a senha: abre a última empresa usada (ou nenhuma, se a conta não está em nenhuma). */
  function entradaDe(reply: FastifyReply, conta: Conta): Entrada {
    const empresas = empresasDaConta(conta);
    const avisos = plataforma.lerAvisos(conta.email);
    if (empresas.length === 0) return { eu: null, empresas, avisos };
    return { eu: abrirSessao(reply, conta, plataforma.contexto(empresas[0].id)), empresas, avisos };
  }

  function sessaoDe(request: FastifyRequest): SessaoPlataforma {
    if (!request.sessaoConsole) throw new ErroHttp(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
    return request.sessaoConsole;
  }

  async function enviar(email: Parameters<typeof plataforma.correio.enviar>[0]) {
    try {
      await plataforma.correio.enviar(email);
    } catch (e) {
      console.error('Falha ao enviar e-mail:', e);
      throw new ErroHttp(502, 'email_indisponivel', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
    }
  }

  function confirmacaoDe(conta: Conta): ConfirmacaoEmail {
    const c = plataforma.codigoEmail(conta.id);
    const passou = c ? (Date.now() - Date.parse(c.enviadoEm)) / 1000 : Infinity;
    return {
      email: conta.email,
      reenviarEmS: Math.max(0, Math.ceil(SEGUNDOS_REENVIO_CODIGO - passou)),
      expiraEm: c?.expiraEm ?? null,
      envio: plataforma.correio.modo,
    };
  }

  async function enviarCodigo(conta: Conta) {
    const codigo = plataforma.novoCodigoEmail(conta.id);
    await enviar(emailCodigo(conta.email, conta.nome ?? conta.email, codigo));
  }

  app.get('/eu', async (request): Promise<Eu> => euDe(ctxDe(request), membro(request)));

  /**
   * Entrar (A1). 5 senhas erradas seguidas bloqueiam a entrada com senha por 15 minutos. Com
   * `convite` (A6, e-mail que já tem conta), confere o e-mail do convite antes da senha, aceita o
   * convite e abre a empresa dele, mesmo para quem ainda não está em nenhuma empresa.
   */
  app.post('/entrar', async (request, reply): Promise<Entrada> => {
    const { email, senha, convite: token } = validar(Entrar, request.body);
    const convite = token ? convitePorToken(plataforma, token) : undefined;
    if (convite?.expirado) throw conviteVencido(convite.convidadoPor, convite.convite.email);
    if (convite && convite.convite.email.toLowerCase() !== email) {
      throw new ErroHttp(403, 'outro_email', `Este convite é para ${convite.convite.email}. Entre com esse e-mail para aceitar.`);
    }
    const r = plataforma.entrarComSenha(email, senha);
    if (!r.conta) {
      if (r.bloqueadaAte) {
        throw new ErroHttp(423, 'bloqueado', `Por segurança, o acesso ficou bloqueado por ${MINUTOS_BLOQUEIO} minutos.`, { ate: r.bloqueadaAte });
      }
      throw new ErroHttp(401, 'credenciais', 'E-mail ou senha incorretos. Confira e tente de novo.');
    }
    if (!convite) return entradaDe(reply, r.conta);
    aceitar(convite.ctx, convite.convite.id, convite.convite.email, r.conta.nome ?? convite.convite.email);
    const eu = abrirSessao(reply, r.conta, convite.ctx);
    return { eu, empresas: empresasDaConta(plataforma.contaPorId(r.conta.id)!), avisos: plataforma.lerAvisos(r.conta.email) };
  });

  /** "Em qual empresa você quer entrar?" (A2), com os avisos guardados. */
  app.get('/empresas', async (request): Promise<{ empresas: EmpresaDaConta[]; avisos: string[] }> => {
    const conta = sessaoDe(request).conta;
    return { empresas: empresasDaConta(conta), avisos: plataforma.lerAvisos(conta.email) };
  });

  app.post('/sair', async (request, reply) => {
    plataforma.encerrarSessao(request.cookies[COOKIE_SESSAO]);
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  });

  /** Escolher a empresa (A2) e o seletor no topo do menu. */
  app.post('/empresa', async (request): Promise<Eu> => {
    const sessao = sessaoDe(request);
    const { empresaId } = validar(TrocarEmpresa, request.body);
    const empresa = plataforma.empresa(empresaId);
    const ctx = empresa?.status === 'ativa' ? plataforma.contexto(empresa.id) : undefined;
    const m = ctx ? membroNaEmpresa(ctx, sessao.conta.email) : undefined;
    if (!ctx || !m) throw new ErroHttp(404, 'empresa_nao_encontrada', 'Você não está na equipe desta empresa.');
    plataforma.trocarEmpresa(sessao.token, sessao.conta.id, ctx.empresa.id);
    return euDe(ctx, m);
  });

  /** Ninguém com acesso ainda: a tela de entrada mostra o cadastro da primeira empresa. */
  app.get('/primeiro-acesso', async (): Promise<PrimeiroAcesso> => ({
    precisaCriarAdmin: !plataforma.temContas(),
    demo: process.env.COPILOTO_DEMO !== '0' && plataforma.listarEmpresas().some((e) => e.demo),
    cadastroAberto: plataforma.config.cadastroAberto,
    envioEmail: plataforma.correio.modo,
  }));

  /**
   * Etapa 1 do cadastro: cria o espaço de uma empresa nova (banco próprio, sistema só pela tela,
   * ainda sem endereço) e quem criou como Admin. Conta nova recebe o código de 6 dígitos e só
   * segue para a etapa 2 depois de confirmar o e-mail. Logado, a empresa nova fica com a conta da sessão.
   */
  app.post('/cadastro', async (request, reply): Promise<Eu> => {
    const d = validar(Cadastro, request.body);
    let conta: Conta;
    let contaNova = false;
    if (request.sessaoConsole && request.membro) {
      conta = request.sessaoConsole.conta;
    } else {
      if (!plataforma.config.cadastroAberto && plataforma.temContas()) {
        throw new ErroHttp(403, 'cadastro_fechado', 'O cadastro de empresas novas está fechado. Fale com quem administra o copiloto.');
      }
      if (!d.pessoa) throw pedidoInvalido('Diga seu nome, e-mail e senha.');
      if (plataforma.conta(d.pessoa.email)) {
        // Quem já tem conta cria a empresa nova com a mesma senha (que conta tentativas, como na entrada).
        const r = plataforma.entrarComSenha(d.pessoa.email, d.pessoa.senha);
        if (!r.conta) {
          if (r.bloqueadaAte) {
            throw new ErroHttp(423, 'bloqueado', `Por segurança, o acesso ficou bloqueado por ${MINUTOS_BLOQUEIO} minutos.`, { ate: r.bloqueadaAte });
          }
          throw new ErroHttp(
            409,
            'conta_existente',
            'Este e-mail já tem acesso ao copiloto. Use a senha que você já tem, ou entre e crie a empresa pelo menu da conta.',
          );
        }
        conta = r.conta;
      } else {
        const problema = problemaSenha(d.pessoa.senha, d.empresa.nome);
        if (problema) throw pedidoInvalido(problema);
        conta = plataforma.criarConta({ email: d.pessoa.email, nome: d.pessoa.nome, senha: d.pessoa.senha, emailConfirmado: false });
        contaNova = true;
      }
    }
    const nomePessoa = conta.nome ?? d.pessoa?.nome ?? conta.email;
    // O sistema (endereço e acesso) vem na etapa 2 do cadastro, já logado, por PUT /sistema/config.
    const empresa = plataforma.criarEmpresa({
      nome: d.empresa.nome,
      sistema: sistemaNovo(d.empresa.nome),
      criadoPor: conta.email,
      cnpj: d.empresa.cnpj,
      faixaUsuarios: d.empresa.faixaUsuarios,
      termosAceitos: true,
    });
    const ctx = plataforma.contexto(empresa.id);
    ctx.banco.inserir('equipe', {
      id: novoId('mbr'),
      nome: nomePessoa,
      email: conta.email,
      perfil: 'admin',
      status: 'ativo',
      criado_em: agoraIso(),
    });
    plataforma.vincular(conta.email, empresa.id);
    ctx.auditoria.registrar(
      nomePessoa,
      'criou o espaço da empresa',
      empresa.nome,
      'Aceitou os termos de uso e o contrato de tratamento de dados (LGPD)',
    );
    if (contaNova) {
      // O espaço já existe: se o e-mail não sair agora, a tela de confirmação oferece reenviar.
      await enviarCodigo(conta).catch(() => {});
    }
    if (request.sessaoConsole) {
      plataforma.trocarEmpresa(request.sessaoConsole.token, conta.id, empresa.id);
      return euDe(ctx, membroNaEmpresa(ctx, conta.email)!);
    }
    return abrirSessao(reply, conta, ctx);
  });

  // ---------------------------------------------------------------- confirmar o e-mail (A5)

  app.get('/email', async (request): Promise<ConfirmacaoEmail> => confirmacaoDe(sessaoDe(request).conta));

  app.post('/email/confirmar', async (request): Promise<Eu> => {
    const sessao = sessaoDe(request);
    const { codigo } = validar(Codigo, request.body);
    if (!sessao.conta.emailConfirmado) {
      const r = plataforma.conferirCodigoEmail(sessao.conta.id, codigo);
      if (!r.ok && r.motivo === 'incorreto') {
        throw new ErroHttp(400, 'codigo_incorreto', `Código incorreto. ${r.restantes === 1 ? 'Resta 1 tentativa' : `Restam ${r.restantes} tentativas`}.`, {
          restantes: r.restantes,
        });
      }
      if (!r.ok) {
        throw new ErroHttp(410, 'codigo_expirado', 'Este código expirou. Cada código vale por 10 minutos. Peça outro e use o mais recente.');
      }
    }
    const ctx = ctxDe(request);
    return euDe(ctx, membro(request));
  });

  app.post('/email/reenviar', async (request): Promise<ConfirmacaoEmail> => {
    const conta = sessaoDe(request).conta;
    const atual = confirmacaoDe(conta);
    if (atual.reenviarEmS > 0) {
      throw new ErroHttp(429, 'aguarde', `Aguarde ${atual.reenviarEmS} s para pedir outro código.`, { aguardarS: atual.reenviarEmS });
    }
    await enviarCodigo(conta);
    return confirmacaoDe(conta);
  });

  /** "Trocar e-mail" antes de confirmar: corrige o e-mail digitado no cadastro e manda outro código. */
  app.post('/email/trocar', async (request): Promise<ConfirmacaoEmail> => {
    const conta = sessaoDe(request).conta;
    const { email } = validar(z.object({ email: Email }), request.body);
    if (conta.emailConfirmado) throw new ErroHttp(409, 'ja_confirmado', 'Este e-mail já foi confirmado.');
    if (PROVEDORES_PESSOAIS.has(email.split('@')[1] ?? '')) throw pedidoInvalido('Use o e-mail da empresa, por exemplo nome@suaempresa.com.br.');
    if (email !== conta.email) {
      if (plataforma.conta(email)) throw new ErroHttp(409, 'conta_existente', 'Este e-mail já tem acesso ao copiloto. Use outro ou entre com ele.');
      plataforma.trocarEmailNaoConfirmado(conta.id, email);
    }
    const atualizada = plataforma.contaPorId(conta.id)!;
    await enviarCodigo(atualizada);
    return confirmacaoDe(atualizada);
  });

  // ---------------------------------------------------------------- senha nova (A3 e A4)

  /** A resposta é a mesma exista ou não a conta, para ninguém descobrir quem tem acesso. */
  app.post('/senha/esqueci', async (request): Promise<PedidoSenhaNova> => {
    const { email } = validar(z.object({ email: Email }), request.body);
    const conta = plataforma.conta(email);
    let espera = SEGUNDOS_REENVIO_LINK;
    if (conta) {
      const ultimo = plataforma.ultimoLinkSenha(conta.id);
      const passou = ultimo ? (Date.now() - Date.parse(ultimo)) / 1000 : Infinity;
      if (passou >= SEGUNDOS_REENVIO_LINK) {
        const token = plataforma.novoLinkSenha(conta.id);
        await enviar(emailSenhaNova(conta.email, conta.nome, `${urlConsole}/senha-nova/${token}`));
      } else {
        espera = Math.ceil(SEGUNDOS_REENVIO_LINK - passou);
      }
    }
    return { ok: true, reenviarEmS: espera, envio: plataforma.correio.modo };
  });

  app.get<{ Params: { token: string } }>('/senha/:token', async (request): Promise<LinkSenhaAberto> => {
    const link = plataforma.linkSenha(request.params.token);
    if (!link) throw new ErroHttp(410, 'link_expirado', 'Este link expirou ou já foi usado.');
    return { email: link.conta.email, expiraEm: link.expiraEm };
  });

  /** "Salvar e entrar": troca a senha, destrava a entrada e, se pedido, encerra as outras sessões. */
  app.post<{ Params: { token: string } }>('/senha/:token', async (request, reply): Promise<Entrada> => {
    const link = plataforma.linkSenha(request.params.token);
    if (!link) throw new ErroHttp(410, 'link_expirado', 'Este link expirou ou já foi usado.');
    const { senha, sairDosOutros } = validar(SenhaNova, request.body);
    const problema = problemaSenhaSimples(senha);
    if (problema) throw pedidoInvalido(problema);
    plataforma.trocarSenha(link.conta.id, senha);
    plataforma.usarLinksSenha(link.conta.id);
    if (sairDosOutros) plataforma.encerrarSessoesDaConta(link.conta.id);
    for (const e of plataforma.empresasDe(link.conta.email)) {
      plataforma.contexto(e.id).auditoria.registrar(link.conta.nome ?? link.conta.email, 'criou uma senha nova', link.conta.email, sairDosOutros ? 'Saiu dos outros aparelhos' : undefined);
    }
    return entradaDe(reply, plataforma.contaPorId(link.conta.id)!);
  });

  // ---------------------------------------------------------------- convite (A6)

  app.get<{ Params: { token: string } }>('/convite/:token', async (request): Promise<ConviteAberto> => {
    const { ctx, convite, convidadoPor, expirado } = convitePorToken(plataforma, request.params.token);
    if (expirado) throw conviteVencido(convidadoPor, convite.email);
    return {
      email: convite.email,
      perfil: convite.perfil,
      empresa: ctx.empresa.nome,
      contaExistente: !!plataforma.conta(convite.email),
      convidadoPor,
      validoAte: convite.convite_expira_em,
    };
  });

  function aceitar(ctx: Contexto, conviteId: string, email: string, nome: string) {
    ctx.banco.atualizar('equipe', conviteId, { nome, status: 'ativo', convite_token: null });
    plataforma.vincular(email, ctx.empresa.id);
    ctx.auditoria.registrar(nome, 'aceitou o convite', email);
  }

  /** E-mail novo: cria a conta com nome e senha. O convite provou o e-mail. */
  app.post<{ Params: { token: string } }>('/convite/:token', async (request, reply): Promise<Eu> => {
    const d = validar(AceitarConvite, request.body);
    const { ctx, convite, convidadoPor, expirado } = convitePorToken(plataforma, request.params.token);
    if (expirado) throw conviteVencido(convidadoPor, convite.email);
    if (plataforma.conta(convite.email)) {
      throw new ErroHttp(409, 'conta_existente', 'Você já tem conta com este e-mail. Entre para aceitar o convite.');
    }
    const nome = validar(Nome, d.nome);
    const problema = problemaSenhaSimples(d.senha);
    if (problema) throw pedidoInvalido(problema);
    const conta = plataforma.criarConta({ email: convite.email, nome, senha: d.senha });
    aceitar(ctx, convite.id, convite.email, nome);
    return abrirSessao(reply, conta, ctx);
  });

  /** "Entrar e aceitar o convite": quem já tem conta entra e aceita, e a empresa nova abre. */
  app.post<{ Params: { token: string } }>('/convite/:token/aceitar', async (request): Promise<Eu> => {
    const sessao = sessaoDe(request);
    const { ctx, convite, convidadoPor, expirado } = convitePorToken(plataforma, request.params.token);
    if (expirado) throw conviteVencido(convidadoPor, convite.email);
    if (convite.email.toLowerCase() !== sessao.conta.email) {
      throw new ErroHttp(403, 'outro_email', `Este convite é para ${convite.email}. Entre com esse e-mail para aceitar.`);
    }
    aceitar(ctx, convite.id, convite.email, sessao.conta.nome ?? convite.email);
    plataforma.trocarEmpresa(sessao.token, sessao.conta.id, ctx.empresa.id);
    return euDe(ctx, membroNaEmpresa(ctx, sessao.conta.email)!);
  });
};

export default rotas;

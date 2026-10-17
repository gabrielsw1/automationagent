// Entrar, sair, trocar de empresa, aceitar convite e criar a conta de uma empresa nova.
// A conta (e-mail e senha) é da plataforma e vale para todas as empresas em que a pessoa está
// na equipe; o perfil é de cada empresa.
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CadastroEmpresaPedido, ConviteAberto, Eu, PerfilEquipe, PrimeiroAcesso } from '@copiloto/shared';
import { COOKIE_SESSAO, definirCookie, euDe, membro, membroNaEmpresa } from '../../auth/console.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import { agoraIso } from '../../db/banco.ts';
import { empresaDoToken, type Conta, type Plataforma } from '../../plataforma/index.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';
import { novoId } from '../../util/ids.ts';

const Entrar = z.object({ email: z.string().trim().toLowerCase(), senha: z.string() });
const Senha = z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.');
const Nome = z.string().trim().min(2, 'Diga seu nome.').max(120, 'O nome pode ter até 120 caracteres.');
const AceitarConvite = z.object({ nome: z.string().trim().max(120).optional(), senha: z.string() });
const TrocarEmpresa = z.object({ empresaId: z.string().min(1) });

/** Endereço http(s) completo. Ex.: https://app.suaempresa.com.br */
export const UrlSistema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host;
    } catch {
      return false;
    }
  }, 'Use o endereço completo do sistema, começando com https://');

const Cadastro = z.object({
  empresa: z.object({
    nome: z.string().trim().min(2, 'Diga o nome da empresa.').max(80, 'O nome da empresa pode ter até 80 caracteres.'),
    sistemaNome: z.string().trim().min(2, 'Diga como a equipe chama o sistema.').max(60, 'O nome do sistema pode ter até 60 caracteres.'),
    sistemaUrl: UrlSistema,
  }),
  pessoa: z
    .object({
      nome: Nome,
      email: z.string().trim().toLowerCase().email('E-mail inválido.'),
      senha: Senha,
    })
    .optional(),
}) satisfies z.ZodType<CadastroEmpresaPedido>;

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

/** Empresa e linha do convite pelo token (`<empresa>.<aleatório>`). */
function convitePorToken(plataforma: Plataforma, token: string) {
  const empresaId = empresaDoToken(token);
  const empresa = empresaId ? plataforma.empresa(empresaId) : undefined;
  const ctx = empresa?.status === 'ativa' ? plataforma.contexto(empresa.id) : undefined;
  const l = ctx?.banco.um<{ id: string; email: string; perfil: PerfilEquipe; convite_expira_em: string | null }>(
    "SELECT id, email, perfil, convite_expira_em FROM equipe WHERE convite_token = ? AND status = 'convidado'",
    token,
  );
  if (!ctx || !l) throw new ErroHttp(404, 'convite_invalido', 'Este convite não existe ou já foi usado.');
  if (l.convite_expira_em && l.convite_expira_em < agoraIso()) {
    throw new ErroHttp(410, 'convite_expirado', 'Este convite expirou. Peça a um Admin para reenviar.');
  }
  return { ctx, convite: l };
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;
  const seguro = plataforma.config.urlPublica.startsWith('https://');

  /** Abre a sessão da conta na empresa e devolve o "Eu" dela lá. */
  function abrirSessao(reply: FastifyReply, conta: Conta, ctx: Contexto): Eu {
    const m = membroNaEmpresa(ctx, conta.email);
    if (!m) throw new ErroHttp(403, 'fora_da_equipe', 'Você não está mais na equipe desta empresa.');
    const { token, expira } = plataforma.criarSessao(conta.id, ctx.empresa.id);
    definirCookie(reply, token, expira, seguro);
    return euDe(ctx, m);
  }

  /** Empresas em que a conta está ativa na equipe (o índice pode ter sobras de quem saiu). */
  function empresasAtivas(conta: Conta) {
    return plataforma.empresasDe(conta.email).filter((e) => membroNaEmpresa(plataforma.contexto(e.id), conta.email));
  }

  app.get('/eu', async (request): Promise<Eu> => euDe(ctxDe(request), membro(request)));

  app.post('/entrar', async (request, reply): Promise<Eu> => {
    const { email, senha } = validar(Entrar, request.body);
    const conta = plataforma.conferirSenha(email, senha);
    if (!conta) throw new ErroHttp(401, 'credenciais', 'E-mail ou senha não conferem.');
    const empresas = empresasAtivas(conta);
    if (empresas.length === 0) {
      throw new ErroHttp(
        403,
        'sem_empresa',
        'Seu acesso não está na equipe de nenhuma empresa agora. Peça um convite a um Admin ou crie a conta da sua empresa.',
      );
    }
    // Volta para a última empresa aberta; sem ela, a primeira (empresas de verdade antes da demonstração).
    const escolhida = empresas.find((e) => e.id === conta.ultimaEmpresaId) ?? empresas[0];
    return abrirSessao(reply, conta, plataforma.contexto(escolhida.id));
  });

  app.post('/sair', async (request, reply) => {
    plataforma.encerrarSessao(request.cookies[COOKIE_SESSAO]);
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  });

  /** "Trocar de empresa" no menu da conta. */
  app.post('/empresa', async (request): Promise<Eu> => {
    const sessao = request.sessaoConsole;
    if (!sessao || !request.membro) throw new ErroHttp(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
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
  }));

  /**
   * Cria a conta de uma empresa nova: a empresa (com o sistema dela, ligado só pelas telas), o
   * banco dela e quem criou como Admin. Logado, a empresa nova fica com a conta da sessão.
   */
  app.post('/cadastro', async (request, reply): Promise<Eu> => {
    const d = validar(Cadastro, request.body);
    let conta: Conta;
    if (request.sessaoConsole && request.membro) {
      conta = request.sessaoConsole.conta;
    } else {
      if (!plataforma.config.cadastroAberto && plataforma.temContas()) {
        throw new ErroHttp(403, 'cadastro_fechado', 'O cadastro de empresas novas está fechado. Fale com quem administra o copiloto.');
      }
      if (!d.pessoa) throw pedidoInvalido('Diga seu nome, e-mail e senha.');
      const existente = plataforma.conta(d.pessoa.email);
      if (existente) {
        const conferida = plataforma.conferirSenha(d.pessoa.email, d.pessoa.senha);
        if (!conferida) {
          throw new ErroHttp(
            409,
            'conta_existente',
            'Este e-mail já tem acesso ao copiloto. Use a senha que você já tem, ou entre e crie a empresa pelo menu da conta.',
          );
        }
        conta = conferida;
      } else {
        conta = plataforma.criarConta({ email: d.pessoa.email, nome: d.pessoa.nome, senha: d.pessoa.senha });
      }
    }
    const nomePessoa = conta.nome ?? d.pessoa?.nome ?? conta.email;
    const empresa = plataforma.criarEmpresa({
      nome: d.empresa.nome,
      sistema: {
        nome: d.empresa.sistemaNome,
        url: d.empresa.sistemaUrl.replace(/\/+$/, ''),
        conector: 'tela',
        acesso: { modo: 'nenhum', urlLogin: '', usuario: '' },
        perfis: [],
      },
      criadoPor: conta.email,
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
    ctx.auditoria.registrar(nomePessoa, 'criou a conta da empresa', empresa.nome, `Sistema ${empresa.sistema.nome} · ${empresa.sistema.url}`);
    if (request.sessaoConsole) {
      plataforma.trocarEmpresa(request.sessaoConsole.token, conta.id, empresa.id);
      return euDe(ctx, membroNaEmpresa(ctx, conta.email)!);
    }
    return abrirSessao(reply, conta, ctx);
  });

  app.get<{ Params: { token: string } }>('/convite/:token', async (request): Promise<ConviteAberto> => {
    const { ctx, convite } = convitePorToken(plataforma, request.params.token);
    return { email: convite.email, perfil: convite.perfil, empresa: ctx.empresa.nome, contaExistente: !!plataforma.conta(convite.email) };
  });

  /** Aceita o convite. E-mail novo: cria a conta com a senha escolhida. E-mail com conta: confere a senha atual. */
  app.post<{ Params: { token: string } }>('/convite/:token', async (request, reply): Promise<Eu> => {
    const d = validar(AceitarConvite, request.body);
    const { ctx, convite } = convitePorToken(plataforma, request.params.token);
    let conta = plataforma.conta(convite.email);
    let nome: string;
    if (conta) {
      if (!plataforma.conferirSenha(convite.email, d.senha)) {
        throw new ErroHttp(401, 'credenciais', 'Este e-mail já tem acesso ao copiloto. Use a senha que você já usa para entrar.');
      }
      nome = d.nome || conta.nome || convite.email;
    } else {
      nome = validar(Nome, d.nome);
      validar(Senha, d.senha);
      conta = plataforma.criarConta({ email: convite.email, nome, senha: d.senha });
    }
    ctx.banco.atualizar('equipe', convite.id, { nome, status: 'ativo', convite_token: null });
    plataforma.vincular(convite.email, ctx.empresa.id);
    ctx.auditoria.registrar(nome, 'aceitou o convite', convite.email);
    return abrirSessao(reply, conta, ctx);
  });
};

export default rotas;

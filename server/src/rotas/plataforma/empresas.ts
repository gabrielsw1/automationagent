// Plataforma › Empresas (S7): a lista com métricas, o painel de cada empresa (implantação, fluxos
// com conserto frequente), o acompanhamento que a Starta ajusta, "Nova empresa", pausar e
// reativar, "Sugerir regravação à empresa" e "Entrar como suporte".
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type DetalheEmpresaStarta, type NovaEmpresaStarta, type PainelEmpresas, type SuporteAberto } from '@copiloto/shared';
import { cnpjValido, somenteDigitos } from '@copiloto/shared';
import { COOKIE_SESSAO, PREFIXO_SUPORTE } from '../../auth/console.ts';
import { exigirStarta, pessoaStarta } from '../../auth/starta.ts';
import { agoraIso } from '../../db/banco.ts';
import { emailConvite, emailRegravar, emailSuporte } from '../../email/modelos.ts';
import { detalheEmpresa, fluxosComConserto, painelEmpresas } from '../../plataforma/metricas.ts';
import { sistemaNovo, tokenDaEmpresa, type Empresa } from '../../plataforma/index.ts';
import { ErroHttp, naoEncontrado, pedidoInvalido } from '../../util/erros.ts';
import { novoId } from '../../util/ids.ts';
import { validar } from './comum.ts';

const DIAS_CONVITE = 7;

const Data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Use uma data como 2026-10-22.')
  .transform((d) => (d.length === 10 ? `${d}T12:00:00.000Z` : new Date(d).toISOString()));

const Acompanhar = z.object({
  fase: z.enum(['implantacao', 'piloto', 'ativo']).optional(),
  planoId: z.string().min(1).nullable().optional(),
  responsavelStarta: z.string().min(1).nullable().optional(),
  metaTarefas: z.number().int().min(1, 'A meta é de pelo menos 1 tarefa.').max(500).nullable().optional(),
  avaliacaoPilotoEm: Data.nullable().optional(),
  /** Contrato e LGPD assinados fora do cadastro (empresa criada pela Starta). */
  contratoAssinadoEm: Data.nullable().optional(),
});

const NovaEmpresa = z.object({
  nome: z.string().trim().min(2, 'Diga o nome da empresa.').max(120),
  cnpj: z
    .string()
    .trim()
    .optional()
    .transform((c) => (c ? somenteDigitos(c) : undefined))
    .refine((c) => !c || cnpjValido(c), 'CNPJ inválido. Confira os números.'),
  faixaUsuarios: z.enum(['ate_200', 'ate_1000', 'ate_5000', 'mais_5000']).optional(),
  planoId: z.string().min(1).optional(),
  fase: z.enum(['implantacao', 'piloto', 'ativo']).default('implantacao'),
  admin: z.object({
    email: z.string().trim().toLowerCase().email('Digite o e-mail de quem vai administrar o espaço da empresa.'),
  }),
});

const Status = z.object({ status: z.enum(['ativa', 'suspensa'], { error: 'Use ativa ou suspensa.' }) });
const Suporte = z.object({ motivo: z.string().trim().min(10, 'Diga o motivo do acesso, em pelo menos 10 caracteres.').max(300) });
const Regravar = z.object({ tarefaId: z.string().min(1) });

type ComId = { Params: { id: string } };

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;
  const urlConsole = plataforma.config.urlConsole.replace(/\/+$/, '');
  const seguro = plataforma.config.urlPublica.startsWith('https://');

  app.addHook('preHandler', exigirStarta);

  const empresa = (request: FastifyRequest<ComId>): Empresa => {
    const e = plataforma.empresa(request.params.id);
    if (!e) throw naoEncontrado('Empresa');
    return e;
  };

  /** Registro na auditoria da empresa: tudo o que a Starta faz nela aparece lá. */
  const auditar = (e: Empresa, request: FastifyRequest, acao: string, detalhe?: string) =>
    plataforma.contexto(e.id).auditoria.registrar(`${pessoaStarta(request).nome} (Starta)`, acao, e.nome, detalhe);

  const adminsDa = (e: Empresa) =>
    plataforma.contexto(e.id).banco.todos<{ email: string }>("SELECT email FROM equipe WHERE perfil = 'admin' AND status = 'ativo'").map((l) => l.email);

  app.get('/', async (): Promise<PainelEmpresas> => painelEmpresas(plataforma));

  app.get<ComId>('/:id', async (request): Promise<DetalheEmpresaStarta> => detalheEmpresa(plataforma, empresa(request)));

  app.put<ComId>('/:id', async (request): Promise<DetalheEmpresaStarta> => {
    const e = empresa(request);
    const d = validar(Acompanhar, request.body);
    if (d.planoId && !plataforma.plano(d.planoId)) throw pedidoInvalido('Plano não encontrado.');
    if (d.responsavelStarta && !plataforma.starta.pessoa(d.responsavelStarta)?.ativa) throw pedidoInvalido('Escolha uma pessoa ativa da equipe Starta.');
    const { contratoAssinadoEm, ...acompanhamento } = d;
    const atualizada = plataforma.acompanhar(e.id, acompanhamento);
    if (contratoAssinadoEm !== undefined) {
      plataforma.banco.executar('UPDATE empresas SET termos_aceitos_em = ? WHERE id = ?', contratoAssinadoEm, e.id);
      if (contratoAssinadoEm) auditar(e, request, 'registrou o contrato e a LGPD assinados', `Assinados em ${contratoAssinadoEm.slice(0, 10)}`);
    }
    if (d.fase && d.fase !== e.fase) auditar(e, request, 'mudou a fase da empresa', { implantacao: 'Implantação', piloto: 'Piloto', ativo: 'Ativo' }[d.fase]);
    if (d.planoId !== undefined && d.planoId !== e.planoId) {
      auditar(e, request, 'mudou o plano da empresa', d.planoId ? `Plano ${plataforma.plano(d.planoId)!.nome}` : 'Sem plano');
    }
    return detalheEmpresa(plataforma, atualizada);
  });

  /** "Nova empresa": cria o espaço (sistema só pela tela, ainda sem endereço) e convida o primeiro Admin. */
  app.post('/', async (request): Promise<NovaEmpresaStarta> => {
    const d = validar(NovaEmpresa, request.body);
    if (d.planoId && !plataforma.plano(d.planoId)) throw pedidoInvalido('Plano não encontrado.');
    const pessoa = pessoaStarta(request);
    const nova = plataforma.criarEmpresa({
      nome: d.nome,
      sistema: sistemaNovo(d.nome),
      criadoPor: `${pessoa.email} (Starta)`,
      cnpj: d.cnpj,
      faixaUsuarios: d.faixaUsuarios,
    });
    plataforma.acompanhar(nova.id, { fase: d.fase, planoId: d.planoId ?? null, responsavelStarta: pessoa.id });
    const ctx = plataforma.contexto(nova.id);
    const agora = new Date();
    const token = tokenDaEmpresa(nova.id);
    const validoAte = new Date(agora.getTime() + DIAS_CONVITE * 86_400_000).toISOString();
    ctx.banco.inserir('equipe', {
      id: novoId('mbr'),
      nome: null,
      email: d.admin.email,
      perfil: 'admin',
      status: 'convidado',
      convite_token: token,
      convite_enviado_em: agora.toISOString(),
      convite_expira_em: validoAte,
      convidado_por: null,
      criado_em: agoraIso(),
    });
    const atualizada = plataforma.empresa(nova.id)!;
    auditar(atualizada, request, 'criou o espaço da empresa', `Convidou ${d.admin.email} como Admin`);
    const linkConvite = `${urlConsole}/convite/${token}`;
    try {
      await plataforma.correio.enviar(
        emailConvite({ para: d.admin.email, empresa: nova.nome, convidadoPor: `${pessoa.nome}, da equipe Starta,`, perfil: 'admin', link: linkConvite, validoAte }),
      );
    } catch (erro) {
      console.error('Falha ao enviar o convite da empresa nova:', erro);
      throw new ErroHttp(502, 'email_indisponivel', 'A empresa foi criada, mas o convite não saiu por e-mail. Copie o link no painel da empresa e envie.');
    }
    return { empresa: detalheEmpresa(plataforma, atualizada), linkConvite, envio: plataforma.correio.modo };
  });

  /** Pausar (suspender) ou reativar. Pausada, ninguém entra no console nem no widget dela. */
  app.put<ComId>('/:id/status', async (request): Promise<DetalheEmpresaStarta> => {
    const e = empresa(request);
    const { status } = validar(Status, request.body);
    if (status !== e.status) {
      plataforma.mudarStatus(e.id, status);
      auditar(
        e,
        request,
        status === 'suspensa' ? 'pausou a empresa' : 'reativou a empresa',
        status === 'suspensa' ? 'Ninguém entra no console nem no widget até reativar.' : undefined,
      );
    }
    return detalheEmpresa(plataforma, plataforma.empresa(e.id)!);
  });

  /** "Sugerir regravação à empresa": e-mail aos Admins com o link da tarefa. */
  app.post<ComId>('/:id/regravar', async (request): Promise<{ enviadosPara: number; envio: 'smtp' | 'caixa_local' }> => {
    const e = empresa(request);
    const { tarefaId } = validar(Regravar, request.body);
    const fluxo = fluxosComConserto(plataforma.contexto(e.id).banco).find((f) => f.tarefaId === tarefaId);
    if (!fluxo) throw naoEncontrado('Fluxo com conserto nos últimos 30 dias');
    const admins = adminsDa(e);
    if (!admins.length) throw new ErroHttp(409, 'sem_admin', 'A empresa ainda não tem um Admin ativo para receber a sugestão.');
    try {
      for (const para of admins) {
        await plataforma.correio.enviar(emailRegravar({ para, empresa: e.nome, tarefa: fluxo.nome, consertos: fluxo.consertos30d, link: `${urlConsole}/tarefas/${tarefaId}` }));
      }
    } catch (erro) {
      console.error('Falha ao enviar a sugestão de regravação:', erro);
      throw new ErroHttp(502, 'email_indisponivel', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
    }
    auditar(e, request, 'sugeriu regravar o fluxo', `${fluxo.nome}: ${fluxo.consertos30d} consertos em 30 dias`);
    return { enviadosPara: admins.length, envio: plataforma.correio.modo };
  });

  /**
   * "Entrar como suporte": abre o console da empresa com o perfil Suporte por 60 minutos. Fica na
   * auditoria da empresa e os Admins recebem um e-mail com o motivo.
   */
  app.post<ComId>('/:id/suporte', async (request, reply): Promise<SuporteAberto> => {
    const e = empresa(request);
    if (e.status !== 'ativa') throw new ErroHttp(409, 'empresa_pausada', 'A empresa está pausada. Reative antes de entrar como suporte.');
    const { motivo } = validar(Suporte, request.body);
    const pessoa = pessoaStarta(request);
    const { token, acesso } = plataforma.starta.abrirSuporte(pessoa.id, e.id, motivo);
    auditar(e, request, 'entrou como suporte', `Motivo: ${motivo}`);
    for (const para of adminsDa(e)) {
      await plataforma.correio
        .enviar(emailSuporte({ para, empresa: e.nome, pessoa: pessoa.nome, motivo, inicio: acesso.inicio, ate: acesso.expiraEm }))
        .catch((erro) => console.error('Falha ao avisar o Admin do acesso de suporte:', erro));
    }
    reply.setCookie(COOKIE_SESSAO, `${PREFIXO_SUPORTE}${token}`, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: seguro,
      expires: new Date(acesso.expiraEm),
    });
    return { acesso: { ...acesso, pessoa: acesso.pessoaNome, empresa: e.nome }, url: `${urlConsole}/` };
  });
};

export default rotas;

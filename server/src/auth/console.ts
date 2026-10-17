// Sessões do console: cookie httpOnly com token aleatório guardado no banco da plataforma. A sessão
// diz quem é a conta e qual empresa está aberta; o perfil vem da equipe da empresa, conferida a
// cada pedido (quem sai da equipe perde o acesso na hora).
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { pode, type Eu, type ModoSuporte, type PerfilEquipe, type Permissao } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import { agoraIso } from '../db/banco.ts';
import type { Plataforma, SessaoPlataforma } from '../plataforma/index.ts';
import { ErroHttp, semPermissao } from '../util/erros.ts';

export const COOKIE_SESSAO = 'copiloto_sessao';

export interface MembroLogado {
  /** ID do membro na equipe da empresa aberta. */
  id: string;
  nome: string;
  email: string;
  perfil: PerfilEquipe;
  iniciais: string;
  /** Pessoa da equipe Starta no modo suporte (perfil Suporte, sem conta na empresa). */
  suporte?: ModoSuporte & { acessoId: string };
}

/** Cookie do console no modo suporte: `sup.<token>` (o hash fica em acessos_suporte). */
export const PREFIXO_SUPORTE = 'sup.';

declare module 'fastify' {
  interface FastifyRequest {
    membro?: MembroLogado;
    sessaoConsole?: SessaoPlataforma;
  }
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const p = partes[0][0] ?? '';
  const u = partes.length > 1 ? (partes[partes.length - 1][0] ?? '') : '';
  return (p + u).toUpperCase();
}

export function definirCookie(reply: FastifyReply, token: string, expira: Date, seguro: boolean) {
  reply.setCookie(COOKIE_SESSAO, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: seguro,
    expires: expira,
  });
}

/** Membro ativo da equipe da empresa com este e-mail, sem marcar acesso (listas e conferências). */
export function perfilNaEmpresa(ctx: Contexto, email: string): (MembroLogado & { ultimoAcesso: string | null }) | undefined {
  const l = ctx.banco.um<{ id: string; nome: string | null; email: string; perfil: PerfilEquipe; ultimo_acesso: string | null }>(
    "SELECT id, nome, email, perfil, ultimo_acesso FROM equipe WHERE lower(email) = ? AND status = 'ativo'",
    email.trim().toLowerCase(),
  );
  if (!l) return undefined;
  const nome = l.nome ?? l.email;
  return { id: l.id, nome, email: l.email, perfil: l.perfil, iniciais: iniciais(nome), ultimoAcesso: l.ultimo_acesso };
}

/** Membro ativo da equipe da empresa com este e-mail. Atualiza o último acesso no máximo a cada 5 minutos. */
export function membroNaEmpresa(ctx: Contexto, email: string): MembroLogado | undefined {
  const l = perfilNaEmpresa(ctx, email);
  if (!l) return undefined;
  if (!l.ultimoAcesso || Date.now() - Date.parse(l.ultimoAcesso) > 5 * 60_000) {
    ctx.banco.executar('UPDATE equipe SET ultimo_acesso = ? WHERE id = ?', agoraIso(), l.id);
  }
  return { id: l.id, nome: l.nome, email: l.email, perfil: l.perfil, iniciais: l.iniciais };
}

/** Sessão, empresa e membro de um cookie, ou undefined (sessão vencida, empresa suspensa ou fora da equipe). */
export function lerSessaoConsole(
  plataforma: Plataforma,
  token: string | undefined,
): { sessao?: SessaoPlataforma; ctx: Contexto; membro: MembroLogado } | undefined {
  if (token?.startsWith(PREFIXO_SUPORTE)) return lerSuporteConsole(plataforma, token.slice(PREFIXO_SUPORTE.length));
  const sessao = plataforma.lerSessao(token);
  if (!sessao) return undefined;
  const empresa = plataforma.empresa(sessao.empresaId);
  if (!empresa || empresa.status !== 'ativa') return undefined;
  const ctx = plataforma.contexto(empresa.id);
  const m = membroNaEmpresa(ctx, sessao.conta.email);
  return m ? { sessao, ctx, membro: m } : undefined;
}

/** Modo suporte: a pessoa da Starta entra com o perfil Suporte, até o acesso vencer ou ser encerrado. */
function lerSuporteConsole(plataforma: Plataforma, token: string): { ctx: Contexto; membro: MembroLogado } | undefined {
  const lido = plataforma.starta.lerSuporte(token);
  if (!lido) return undefined;
  const empresa = plataforma.empresa(lido.acesso.empresaId);
  if (!empresa || empresa.status !== 'ativa') return undefined;
  const nome = `${lido.pessoa.nome} (Starta)`;
  return {
    ctx: plataforma.contexto(empresa.id),
    membro: {
      id: `starta:${lido.pessoa.id}`,
      nome,
      email: lido.pessoa.email,
      perfil: 'suporte',
      iniciais: iniciais(lido.pessoa.nome),
      suporte: { acessoId: lido.acesso.id, pessoa: lido.pessoa.nome, motivo: lido.acesso.motivo, ate: lido.acesso.expiraEm },
    },
  };
}

/** "Eu" do console: a pessoa, a empresa aberta e as outras empresas dela. */
export function euDe(ctx: Contexto, m: MembroLogado): Eu {
  const resumo = (e: { id: string; nome: string; demo: boolean }) => ({ id: e.id, nome: e.nome, demo: e.demo });
  if (m.suporte) {
    const { acessoId: _, ...modoSuporte } = m.suporte;
    return {
      id: m.id,
      nome: m.nome,
      email: m.email,
      perfil: m.perfil,
      iniciais: m.iniciais,
      empresa: resumo(ctx.empresa),
      empresas: [resumo(ctx.empresa)],
      adminPlataforma: false,
      emailConfirmado: true,
      modoSuporte,
    };
  }
  return {
    id: m.id,
    nome: m.nome,
    email: m.email,
    perfil: m.perfil,
    iniciais: m.iniciais,
    empresa: resumo(ctx.empresa),
    empresas: ctx.plataforma.empresasDe(m.email).map(resumo),
    adminPlataforma: ctx.plataforma.adminDaPlataforma(m.email),
    emailConfirmado: ctx.plataforma.conta(m.email)?.emailConfirmado ?? false,
  };
}

/** preHandler: exige sessão válida (401) e, se pedido, uma permissão (403). */
export function exigir(permissao: Permissao = 'ver'): preHandlerHookHandler {
  return async function (request: FastifyRequest) {
    if (!request.membro || !request.ctx) throw new ErroHttp(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
    // Até confirmar o e-mail do cadastro, só as rotas de /auth respondem.
    if (request.sessaoConsole && !request.sessaoConsole.conta.emailConfirmado) {
      throw new ErroHttp(403, 'email_nao_confirmado', 'Confirme o seu e-mail para continuar. Enviamos um código de 6 dígitos.');
    }
    if (!pode(request.membro.perfil, permissao)) {
      throw semPermissao(
        permissao === 'administrar'
          ? 'Só um Admin pode mudar isso.'
          : permissao === 'editar'
            ? 'Seu perfil não permite editar. Peça a um Admin ou Editor de tarefas.'
            : 'Seu perfil só permite ver.',
      );
    }
  };
}

/** Membro logado ou erro 401 (para usar dentro de handlers). */
export function membro(request: FastifyRequest): MembroLogado {
  if (!request.membro) throw new ErroHttp(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
  return request.membro;
}

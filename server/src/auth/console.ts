// Sessões do console: cookie httpOnly com token aleatório guardado na tabela sessoes.
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { pode, type Eu, type PerfilEquipe, type Permissao } from '@copiloto/shared';
import { agoraIso, type Banco } from '../db/banco.ts';
import { ErroHttp, semPermissao } from '../util/erros.ts';
import { tokenAleatorio } from '../util/ids.ts';

export const COOKIE_SESSAO = 'copiloto_sessao';
const DIAS_SESSAO = 7;

export interface MembroLogado extends Eu {
  perfil: PerfilEquipe;
}

declare module 'fastify' {
  interface FastifyRequest {
    membro?: MembroLogado;
  }
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const p = partes[0][0] ?? '';
  const u = partes.length > 1 ? (partes[partes.length - 1][0] ?? '') : '';
  return (p + u).toUpperCase();
}

export function criarSessao(banco: Banco, membroId: string): { token: string; expira: Date } {
  const token = tokenAleatorio(32);
  const expira = new Date(Date.now() + DIAS_SESSAO * 86400_000);
  banco.inserir('sessoes', { token, membro_id: membroId, criado_em: agoraIso(), expira_em: expira.toISOString() });
  banco.executar('UPDATE equipe SET ultimo_acesso = ? WHERE id = ?', agoraIso(), membroId);
  return { token, expira };
}

export function encerrarSessao(banco: Banco, token: string | undefined) {
  if (token) banco.executar('DELETE FROM sessoes WHERE token = ?', token);
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

/** Lê o membro da sessão (ou undefined). Atualiza o último acesso no máximo a cada 5 minutos. */
export function membroDaSessao(banco: Banco, token: string | undefined): MembroLogado | undefined {
  if (!token) return undefined;
  const l = banco.um<{
    id: string;
    nome: string | null;
    email: string;
    perfil: PerfilEquipe;
    expira_em: string;
    ultimo_acesso: string | null;
  }>(
    `SELECT e.id, e.nome, e.email, e.perfil, s.expira_em, e.ultimo_acesso FROM sessoes s
     JOIN equipe e ON e.id = s.membro_id WHERE s.token = ? AND e.status = 'ativo'`,
    token,
  );
  if (!l || l.expira_em < agoraIso()) return undefined;
  if (!l.ultimo_acesso || Date.now() - Date.parse(l.ultimo_acesso) > 5 * 60_000) {
    banco.executar('UPDATE equipe SET ultimo_acesso = ? WHERE id = ?', agoraIso(), l.id);
  }
  const nome = l.nome ?? l.email;
  return { id: l.id, nome, email: l.email, perfil: l.perfil, iniciais: iniciais(nome) };
}

/** preHandler: exige sessão válida (401) e, se pedido, uma permissão (403). */
export function exigir(permissao: Permissao = 'ver'): preHandlerHookHandler {
  return async function (request: FastifyRequest) {
    if (!request.membro) throw new ErroHttp(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
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

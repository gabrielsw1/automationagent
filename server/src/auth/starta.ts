// Sessões da Plataforma Starta: cookie próprio (separado do console das empresas), em duas etapas.
// Depois da senha, a sessão fica na etapa do código; só com o código do autenticador (ou um de
// recuperação) ela vale para as rotas da Plataforma. O aparelho confiável tem outro cookie, de 30 dias.
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { EuStarta, PessoaStartaResumo } from '@copiloto/shared';
import type { Plataforma } from '../plataforma/index.ts';
import type { PessoaStarta, SessaoStarta } from '../plataforma/starta.ts';
import { ErroHttp } from '../util/erros.ts';
import { iniciais } from './console.ts';

export const COOKIE_STARTA = 'starta_sessao';
export const COOKIE_APARELHO = 'starta_aparelho';

declare module 'fastify' {
  interface FastifyRequest {
    sessaoStarta?: SessaoStarta;
  }
}

export function definirCookieStarta(reply: FastifyReply, nome: string, token: string, expira: Date, seguro: boolean) {
  // Só as rotas da Plataforma recebem o cookie da sessão; o do aparelho vale para a entrada.
  reply.setCookie(nome, token, { path: '/api/plataforma', httpOnly: true, sameSite: 'strict', secure: seguro, expires: expira });
}

export function lerSessaoStarta(plataforma: Plataforma, request: FastifyRequest): SessaoStarta | undefined {
  return plataforma.starta.lerSessao(request.cookies[COOKIE_STARTA]);
}

export function resumoStarta(p: Pick<PessoaStarta, 'id' | 'nome' | 'email'>): PessoaStartaResumo {
  return { id: p.id, nome: p.nome, email: p.email, iniciais: iniciais(p.nome) };
}

export function euStarta(plataforma: Plataforma, p: PessoaStarta): EuStarta {
  return { ...resumoStarta(p), codigosRecuperacao: plataforma.starta.codigosRestantes(p.id) };
}

/** preHandler: sessão completa (senha e código) da equipe Starta. */
export const exigirStarta: preHandlerHookHandler = async function (request: FastifyRequest) {
  const s = request.sessaoStarta;
  if (!s || s.etapa !== 'completa') throw new ErroHttp(401, 'nao_autenticado', 'Entre na plataforma para continuar.');
};

/** Pessoa da equipe Starta logada (dentro de handlers com exigirStarta). */
export function pessoaStarta(request: FastifyRequest): PessoaStarta {
  const s = request.sessaoStarta;
  if (!s || s.etapa !== 'completa') throw new ErroHttp(401, 'nao_autenticado', 'Entre na plataforma para continuar.');
  return s.pessoa;
}

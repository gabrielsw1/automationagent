// Sessão das telas: cookie "hz_sessao" assinado (HMAC), sem estado no servidor.
// Serve tanto para o login de demonstração quanto para o navegador do copiloto (POST /v1/sessoes).
import crypto from 'node:crypto';

export const COOKIE_SESSAO = 'hz_sessao';
export const HORAS_SESSAO = 12;

function assinar(corpo: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(`hz_sessao.${corpo}`).digest('base64url');
}

export function criarSessao(usuarioId: string, segredo: string, agora: Date, horas = HORAS_SESSAO): { valor: string; expiraEm: Date } {
  const expiraEm = new Date(agora.getTime() + horas * 3_600_000);
  const corpo = Buffer.from(`${usuarioId}:${expiraEm.getTime()}`).toString('base64url');
  return { valor: `${corpo}.${assinar(corpo, segredo)}`, expiraEm };
}

/** ID do usuário da sessão, ou null se o cookie for inválido ou estiver vencido. */
export function lerSessao(valor: string | undefined, segredo: string, agora: Date): string | null {
  if (!valor) return null;
  const [corpo, assinatura] = valor.split('.');
  if (!corpo || !assinatura) return null;
  const esperado = Buffer.from(assinar(corpo, segredo));
  const obtido = Buffer.from(assinatura);
  if (esperado.length !== obtido.length || !crypto.timingSafeEqual(esperado, obtido)) return null;
  const [usuarioId, expira] = Buffer.from(corpo, 'base64url').toString().split(':');
  if (!usuarioId || !(Number(expira) > agora.getTime())) return null;
  return usuarioId;
}

/** Assinatura do snippet do widget: HMAC-SHA256(id do usuário, WIDGET_SEGREDO) em hexadecimal. */
export function assinaturaWidget(usuarioId: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(usuarioId).digest('hex');
}

/** Comparação de segredos em tempo constante. */
export function segredosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

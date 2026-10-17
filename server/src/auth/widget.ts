// Identidade no widget. O sistema anfitrião assina o ID do usuário logado com o segredo do widget
// (HMAC-SHA256) e passa no snippet (data-assinatura). Com isso ninguém se passa por outra pessoa
// trocando o data-usuario no HTML. O servidor devolve um token curto usado nas demais rotas.
import crypto from 'node:crypto';

export function assinarUsuario(usuarioId: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(usuarioId).digest('hex');
}

export function assinaturaValida(usuarioId: string, assinatura: string | undefined, segredo: string): boolean {
  if (!assinatura) return false;
  const esperado = Buffer.from(assinarUsuario(usuarioId, segredo), 'hex');
  const obtido = Buffer.from(assinatura, 'hex');
  return obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado);
}

export interface TokenWidget {
  /** ID do usuário no sistema anfitrião. */
  u: string;
  /** Modo de teste do console: usa rascunhos e não grava nada no sistema. */
  t?: 1;
  /** Expira em (ms desde 1970). */
  exp: number;
}

export function criarTokenWidget(dados: Omit<TokenWidget, 'exp'>, segredo: string, horas = 12): string {
  const corpo = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + horas * 3600_000 })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', segredo).update(`widget.${corpo}`).digest('base64url');
  return `${corpo}.${assinatura}`;
}

export function lerTokenWidget(token: string | undefined, segredo: string): TokenWidget | null {
  if (!token) return null;
  const [corpo, assinatura] = token.split('.');
  if (!corpo || !assinatura) return null;
  const esperado = crypto.createHmac('sha256', segredo).update(`widget.${corpo}`).digest();
  const obtido = Buffer.from(assinatura, 'base64url');
  if (obtido.length !== esperado.length || !crypto.timingSafeEqual(obtido, esperado)) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as TokenWidget;
    return dados.exp > Date.now() ? dados : null;
  } catch {
    return null;
  }
}

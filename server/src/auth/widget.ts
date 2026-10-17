// Identidade no widget. O sistema anfitrião assina o ID do usuário logado (ou o ID com nome, e-mail
// e perfis, ver `textoAssinado` em shared/src/widget.ts) com o segredo do widget da empresa
// (HMAC-SHA256) e passa no snippet (data-assinatura). Com isso ninguém se passa por outra pessoa
// trocando o data-usuario no HTML. O servidor devolve um token curto, que leva a empresa, usado
// nas demais rotas.
import crypto from 'node:crypto';

/** HMAC-SHA256 em hex de `texto` (o ID, ou o `textoAssinado` com a identidade). */
export function assinarUsuario(texto: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(texto).digest('hex');
}

export function assinaturaValida(texto: string, assinatura: string | undefined, segredo: string): boolean {
  if (!assinatura || !/^[0-9a-f]{64}$/i.test(assinatura)) return false;
  const esperado = Buffer.from(assinarUsuario(texto, segredo), 'hex');
  const obtido = Buffer.from(assinatura, 'hex');
  return obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado);
}

export interface TokenWidget {
  /** Empresa dona do widget. */
  e: string;
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

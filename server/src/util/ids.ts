import crypto from 'node:crypto';

/** Identificador curto com prefixo legível. Ex.: novoId("msg") → "msg_k3J9x0a2Lq". */
export function novoId(prefixo: string): string {
  return `${prefixo}_${crypto.randomBytes(8).toString('base64url')}`;
}

export function tokenAleatorio(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Código de referência de erro para o suporte. Ex.: "7F3A-21". */
export function codigoRef(): string {
  const h = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

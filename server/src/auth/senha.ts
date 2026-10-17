// Senhas do console com scrypt (embutido no Node), sal aleatório e comparação em tempo constante.
import crypto from 'node:crypto';

const N = 16384;

export function hashSenha(senha: string): string {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 32, { N });
  return `scrypt$${N}$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verificarSenha(senha: string, guardado: string | null | undefined): boolean {
  if (!guardado) return false;
  const [alg, n, sal, hash] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const obtido = crypto.scryptSync(senha, Buffer.from(sal, 'base64url'), esperado.length, { N: Number(n) });
  return obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado);
}

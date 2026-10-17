// Verificação em duas etapas da equipe Starta: códigos de 6 dígitos que mudam a cada 30 segundos
// (TOTP, RFC 6238, o mesmo do Google Authenticator, Microsoft Authenticator, 1Password e afins).
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_S = 30;
const DIGITOS = 6;

export function base32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function deBase32(texto: string): Buffer {
  const limpo = texto.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('Segredo TOTP inválido.');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo novo (160 bits, em base32, como os aplicativos esperam). */
export function novoSegredoTotp(): string {
  return base32(crypto.randomBytes(20));
}

/** O código do intervalo de 30 s que contém `quando`. */
export function codigoTotp(segredo: string, quando = Date.now()): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(quando / 1000 / PASSO_S)));
  const h = crypto.createHmac('sha1', deBase32(segredo)).update(contador).digest();
  const deslocamento = h[h.length - 1] & 15;
  const numero = (h.readUInt32BE(deslocamento) & 0x7fffffff) % 10 ** DIGITOS;
  return String(numero).padStart(DIGITOS, '0');
}

/**
 * Confere o código aceitando o intervalo anterior e o seguinte (relógio do celular um pouco
 * adiantado ou atrasado). Devolve o número do intervalo usado, para não aceitar o mesmo código duas vezes.
 */
export function conferirTotp(segredo: string, codigo: string, quando = Date.now()): number | null {
  const digitado = codigo.replace(/\D/g, '');
  if (digitado.length !== DIGITOS) return null;
  const atual = Math.floor(quando / 1000 / PASSO_S);
  for (const d of [0, -1, 1]) {
    const esperado = codigoTotp(segredo, (atual + d) * PASSO_S * 1000);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(digitado))) return atual + d;
  }
  return null;
}

/** Endereço que o aplicativo autenticador lê pelo QR code. */
export function uriTotp(segredo: string, email: string, emissor = 'Copiloto Starta'): string {
  const rotulo = encodeURIComponent(`${emissor}:${email}`);
  const params = new URLSearchParams({ secret: segredo, issuer: emissor, algorithm: 'SHA1', digits: String(DIGITOS), period: String(PASSO_S) });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

/** QR code do endereço, em SVG (a tela mostra direto, sem arquivo). */
export async function qrSvg(texto: string): Promise<string> {
  return QRCode.toString(texto, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#181C20', light: '#FFFFFF' } });
}

/** Códigos de recuperação no formato XXXX-XXXX (letras e números sem os que se confundem). */
export function novosCodigosRecuperacao(n = 10): string[] {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    const c = Array.from(crypto.randomBytes(8), (b) => letras[b % letras.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

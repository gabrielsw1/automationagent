// Cofre de segredos das empresas (segredo do widget, senha da conta de serviço do sistema):
// AES-256-GCM com a chave mestra. Nada disso vai para o Claude, para logs ou para o console.
import crypto from 'node:crypto';

export class Cofre {
  private readonly chave: Buffer;

  /** `chaveMestra`: COPILOTO_CHAVE_MESTRA (ou, sem ela, derivada do SESSAO_SEGREDO). */
  constructor(chaveMestra: string) {
    this.chave = crypto.createHash('sha256').update(`copiloto-cofre.${chaveMestra}`).digest();
  }

  cifrar(texto: string): string {
    const iv = crypto.randomBytes(12);
    const cifra = crypto.createCipheriv('aes-256-gcm', this.chave, iv);
    const corpo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
    return ['v1', iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), corpo.toString('base64url')].join('.');
  }

  /** Lança erro se o texto foi alterado ou cifrado com outra chave mestra. */
  decifrar(guardado: string): string {
    const [versao, iv, tag, corpo] = guardado.split('.');
    if (versao !== 'v1' || !iv || !tag || corpo === undefined) throw new Error('Segredo guardado em formato desconhecido.');
    const decifra = crypto.createDecipheriv('aes-256-gcm', this.chave, Buffer.from(iv, 'base64url'));
    decifra.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decifra.update(Buffer.from(corpo, 'base64url')), decifra.final()]).toString('utf8');
  }
}

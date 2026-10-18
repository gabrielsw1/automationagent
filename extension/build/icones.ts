// Ícones da extensão (PNG 16, 32, 48 e 128, mais os da loja), gerados na compilação: quadrado
// arredondado na cor da marca com o "S" branco, como a marca do popup. As cores vêm de
// shared/styles/tokens.css (--brand-600 e --white).
// PNG escrito à mão (zlib do Node), sem dependência de imagem.
import { deflateSync } from 'node:zlib';

export interface Cores {
  marca: [number, number, number];
  ponto: [number, number, number];
}

function hexParaRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Cor inválida em tokens.css: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Uma cor (#hex) de tokens.css. */
export function lerCor(tokensCss: string, nome: string): [number, number, number] {
  const m = tokensCss.match(new RegExp(`--${nome}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\b`));
  if (!m) throw new Error(`tokens.css sem --${nome}`);
  return hexParaRgb(m[1]);
}

/** Lê --brand-600 e --white de tokens.css. */
export function lerCores(tokensCss: string): Cores {
  return { marca: lerCor(tokensCss, 'brand-600'), ponto: lerCor(tokensCss, 'white') };
}

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** PNG RGBA 8 bits a partir dos pixels (largura × altura × 4). */
export function codificarPng(largura: number, altura: number, rgba: Uint8Array): Buffer {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // bits por canal
  cabecalho[9] = 6; // RGBA
  const linhas = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura * 4 + 1)] = 0; // sem filtro
    Buffer.from(rgba.buffer, rgba.byteOffset + y * largura * 4, largura * 4).copy(linhas, y * (largura * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', deflateSync(linhas)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/** Dentro do quadrado de cantos arredondados (coordenadas em 0..1)? */
function noQuadrado(x: number, y: number, raio: number): boolean {
  const cx = Math.min(Math.max(x, raio), 1 - raio);
  const cy = Math.min(Math.max(y, raio), 1 - raio);
  return (x - cx) ** 2 + (y - cy) ** 2 <= raio * raio;
}

/** Centro e raio dos dois arcos do "S" (coordenadas em 0..1 do quadrado). */
const S = { raio: 0.13, cimaY: 0.37, baixoY: 0.63, meiaLargura: 0.075 };

function angulo(x: number, y: number, cx: number, cy: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI; // -180..180, y para baixo
}

/** Distância do ponto ao arco (centro, raio, ângulo inicial e final, em graus, crescendo no sentido horário). */
function distanciaArco(x: number, y: number, cx: number, cy: number, r: number, de: number, ate: number): number {
  let a = angulo(x, y, cx, cy);
  while (a < de) a += 360;
  if (a <= ate) return Math.abs(Math.hypot(x - cx, y - cy) - r);
  const ponta = (g: number) => Math.hypot(x - (cx + r * Math.cos((g * Math.PI) / 180)), y - (cy + r * Math.sin((g * Math.PI) / 180)));
  return Math.min(ponta(de), ponta(ate));
}

/** O ponto está no traço do "S"? Arco de cima: da ponta direita, por cima e pela esquerda, até o meio; arco de baixo: do meio, pela direita e por baixo, até a ponta esquerda. */
export function noS(x: number, y: number): boolean {
  const cima = distanciaArco(x, y, 0.5, S.cimaY, S.raio, 90, 330);
  const baixo = distanciaArco(x, y, 0.5, S.baixoY, S.raio, -90, 150);
  return Math.min(cima, baixo) <= S.meiaLargura;
}

/** Pixels do ícone (largura × altura), com 4×4 amostras por pixel para as bordas ficarem suaves. */
export function desenharIcone(tamanho: number, cores: Cores, altura = tamanho): Uint8Array {
  const px = new Uint8Array(tamanho * altura * 4);
  const amostras = 4;
  const raioCanto = 0.22;
  // Em imagem que não é quadrada (a da loja), o quadrado do ícone fica no meio.
  const lado = Math.min(tamanho, altura);
  const x0 = (tamanho - lado) / 2;
  const y0 = (altura - lado) / 2;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < tamanho; x++) {
      let fundo = 0;
      let traco = 0;
      for (let sy = 0; sy < amostras; sy++) {
        for (let sx = 0; sx < amostras; sx++) {
          const u = (x - x0 + (sx + 0.5) / amostras) / lado;
          const v = (y - y0 + (sy + 0.5) / amostras) / lado;
          if (u < 0 || u > 1 || v < 0 || v > 1 || !noQuadrado(u, v, raioCanto)) continue;
          fundo++;
          if (noS(u, v)) traco++;
        }
      }
      const total = amostras * amostras;
      const i = (y * tamanho + x) * 4;
      const t = fundo ? traco / fundo : 0;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(cores.marca[c] * (1 - t) + cores.ponto[c] * t);
      px[i + 3] = Math.round((fundo / total) * 255);
    }
  }
  return px;
}

export function iconePng(tamanho: number, cores: Cores): Buffer {
  return codificarPng(tamanho, tamanho, desenharIcone(tamanho, cores));
}

/**
 * Imagem para a loja: o ícone no meio, com `lado` px, sobre um fundo (ou transparente). A Chrome Web
 * Store pede o ícone de 128 px com a arte em 96 px; o Edge, o logo de 300 px; as duas, o bloco
 * promocional de 440 × 280.
 */
export function imagemLojaPng(largura: number, altura: number, lado: number, cores: Cores, fundo: [number, number, number] | null = null): Buffer {
  const icone = desenharIcone(lado, cores);
  const px = new Uint8Array(largura * altura * 4);
  if (fundo) {
    for (let i = 0; i < largura * altura; i++) {
      px.set(fundo, i * 4);
      px[i * 4 + 3] = 255;
    }
  }
  const x0 = Math.round((largura - lado) / 2);
  const y0 = Math.round((altura - lado) / 2);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const de = (y * lado + x) * 4;
      const para = ((y + y0) * largura + (x + x0)) * 4;
      const a = icone[de + 3] / 255;
      const aFundo = px[para + 3] / 255;
      const aFinal = a + aFundo * (1 - a);
      for (let c = 0; c < 3; c++) {
        px[para + c] = aFinal ? Math.round((icone[de + c] * a + px[para + c] * aFundo * (1 - a)) / aFinal) : 0;
      }
      px[para + 3] = Math.round(aFinal * 255);
    }
  }
  return codificarPng(largura, altura, px);
}

// Ícones da extensão (PNG 16, 32, 48 e 128), gerados na compilação: quadrado arredondado na cor da
// marca com o ponto branco de gravação. As cores vêm de shared/styles/tokens.css (--brand-600 e --white).
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

/** Lê --brand-600 e --white de tokens.css. */
export function lerCores(tokensCss: string): Cores {
  const valor = (nome: string) => {
    const m = tokensCss.match(new RegExp(`--${nome}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\b`));
    if (!m) throw new Error(`tokens.css sem --${nome}`);
    return hexParaRgb(m[1]);
  };
  return { marca: valor('brand-600'), ponto: valor('white') };
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

function crc32(dados: Buffer): number {
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

/** Pixels do ícone, com 4×4 amostras por pixel para as bordas ficarem suaves. */
export function desenharIcone(tamanho: number, cores: Cores): Uint8Array {
  const px = new Uint8Array(tamanho * tamanho * 4);
  const amostras = 4;
  const raioCanto = 0.22;
  const raioPonto = 0.24;
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      let fundo = 0;
      let ponto = 0;
      for (let sy = 0; sy < amostras; sy++) {
        for (let sx = 0; sx < amostras; sx++) {
          const u = (x + (sx + 0.5) / amostras) / tamanho;
          const v = (y + (sy + 0.5) / amostras) / tamanho;
          if (!noQuadrado(u, v, raioCanto)) continue;
          fundo++;
          if ((u - 0.5) ** 2 + (v - 0.5) ** 2 <= raioPonto * raioPonto) ponto++;
        }
      }
      const total = amostras * amostras;
      const i = (y * tamanho + x) * 4;
      const t = fundo ? ponto / fundo : 0;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(cores.marca[c] * (1 - t) + cores.ponto[c] * t);
      px[i + 3] = Math.round((fundo / total) * 255);
    }
  }
  return px;
}

export function iconePng(tamanho: number, cores: Cores): Buffer {
  return codificarPng(tamanho, tamanho, desenharIcone(tamanho, cores));
}

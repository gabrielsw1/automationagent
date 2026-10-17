// Números pseudoaleatórios determinísticos: os dados de exemplo são sempre os mesmos.

export function hashTexto(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Aleatorio {
  private estado: number;

  constructor(semente: number | string) {
    this.estado = typeof semente === 'string' ? hashTexto(semente) : semente >>> 0;
  }

  /** Número em [0, 1). */
  proximo(): number {
    this.estado = (this.estado + 0x6d2b79f5) >>> 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  inteiro(min: number, max: number): number {
    return min + Math.floor(this.proximo() * (max - min + 1));
  }

  entre(min: number, max: number): number {
    return min + this.proximo() * (max - min);
  }

  escolher<T>(lista: readonly T[]): T {
    return lista[Math.floor(this.proximo() * lista.length)];
  }

  /** Escolhe pelo peso: [[item, peso], ...]. */
  ponderado<T>(itens: readonly (readonly [T, number])[]): T {
    const total = itens.reduce((acc, [, p]) => acc + p, 0);
    let r = this.proximo() * total;
    for (const [item, peso] of itens) {
      r -= peso;
      if (r <= 0) return item;
    }
    return itens[itens.length - 1][0];
  }
}

/** Identificador difícil de adivinhar (arquivos de relatório). */
export function idAleatorio(tamanho = 12): string {
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  const alfabeto = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

// Cor principal configurada no console → variáveis --brand-* locais.
// Mantém os mesmos papéis de tokens.css: --brand-600 é a cor exata (peças sem texto),
// --brand-btn é escurecida até ter 4,5:1 com texto branco, --brand-700 até 5,3:1 (links e texto),
// e os tons claros saem da mistura com --white. "O contraste do texto é ajustado sozinho."
import type { CSSProperties } from 'react';

type Rgb = [number, number, number];

export function lerHex(hex: string): Rgb | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function canal(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminancia([r, g, b]: Rgb): number {
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Contraste com branco (1 a 21). */
export function contrasteComBranco(rgb: Rgb): number {
  return 1.05 / (luminancia(rgb) + 0.05);
}

function misturar(a: Rgb, b: Rgb, pesoA: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * pesoA + b[i] * (1 - pesoA))) as Rgb;
}

const PRETO: Rgb = [0, 0, 0];
const BRANCO: Rgb = [255, 255, 255];

function escurecerAte(rgb: Rgb, alvo: number): Rgb {
  if (contrasteComBranco(rgb) >= alvo) return rgb;
  for (let peso = 0.98; peso > 0; peso -= 0.02) {
    const c = misturar(rgb, PRETO, peso);
    if (contrasteComBranco(c) >= alvo) return c;
  }
  return PRETO;
}

function css(rgb: Rgb): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

export function mesmaCor(a: string, b: string): boolean {
  const x = lerHex(a);
  const y = lerHex(b);
  return Boolean(x && y && x.every((v, i) => v === y[i]));
}

/** Variáveis CSS para aplicar num elemento (style). null quando a cor não é um hex válido. */
export function variaveisMarca(hex: string): Record<string, string> | null {
  const base = lerHex(hex);
  if (!base) return null;
  const btn = escurecerAte(base, 4.5);
  const texto = escurecerAte(btn, 5.3);
  const escuro = escurecerAte(texto, 8);
  return {
    '--brand-600': css(base),
    '--brand-btn': css(btn),
    '--brand-700': css(texto),
    '--brand-900': css(escuro),
    '--brand-200': css(misturar(base, BRANCO, 0.5)),
    '--brand-100': css(misturar(base, BRANCO, 0.2)),
    '--brand-50': css(misturar(base, BRANCO, 0.06)),
    // Ícone sobre a cor exata (botão flutuante): branco quando há contraste para ícone (3:1); senão escuro.
    '--cp-sobre-marca': contrasteComBranco(base) >= 3 ? 'var(--white)' : 'var(--ink-900)',
  };
}

export function estiloMarca(hex: string): CSSProperties | undefined {
  return (variaveisMarca(hex) ?? undefined) as CSSProperties | undefined;
}

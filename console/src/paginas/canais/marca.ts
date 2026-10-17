// Cor do widget: sugestões lidas dos tokens da marca e o contraste do texto branco. Usado em
// Canais e widget e na etapa "Sua marca" do cadastro.
import { useEffect, useState } from 'react';

/** Cores sugeridas: lidas dos tokens da marca (tokens.css), nunca escritas aqui. */
export const CORES_SUGERIDAS: { token: string; rotulo: string }[] = [
  { token: '--brand-600', rotulo: 'Rosa da marca' },
  { token: '--brand-btn', rotulo: 'Rosa escuro' },
  { token: '--accent-500', rotulo: 'Vinho' },
  { token: '--success-700', rotulo: 'Verde' },
  { token: '--ink-900', rotulo: 'Grafite' },
];

/** As cores sugeridas em #RRGGBB, sem repetir (alguns tokens têm o mesmo valor). */
export function useCoresSugeridas(): { rotulo: string; valor: string }[] {
  const [cores, setCores] = useState<{ rotulo: string; valor: string }[]>([]);
  useEffect(() => {
    const estilo = getComputedStyle(document.documentElement);
    const vistos = new Set<string>();
    const lista: { rotulo: string; valor: string }[] = [];
    for (const c of CORES_SUGERIDAS) {
      const v = estilo.getPropertyValue(c.token).trim().toUpperCase();
      if (/^#[0-9A-F]{6}$/.test(v) && !vistos.has(v)) {
        vistos.add(v);
        lista.push({ rotulo: c.rotulo, valor: v });
      }
    }
    setCores(lista);
  }, []);
  return cores;
}

/** Contraste do texto branco sobre a cor (1 a 21). null se a cor não for válida. */
export function contrasteComBranco(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const [r, g, b] = v.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

/** "4,55:1" */
export function textoContraste(c: number): string {
  return `${c.toFixed(2).replace(/0$/, '').replace('.', ',')}:1`;
}

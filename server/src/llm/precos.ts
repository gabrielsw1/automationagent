// Preço por milhão de tokens, em dólares. Fonte: tabela de modelos da Anthropic (out/2026).
// Gravação de cache (5 min) custa 1,25x a entrada; leitura de cache varia por modelo.
interface Preco {
  entrada: number;
  saida: number;
  cacheLeitura: number;
}

const PRECOS: Record<string, Preco> = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2 },
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5 },
  'claude-opus-4-8': { entrada: 5, saida: 25, cacheLeitura: 0.5 },
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01 },
};

function precoDe(modelo: string): Preco {
  if (PRECOS[modelo]) return PRECOS[modelo];
  const base = Object.keys(PRECOS).find((m) => modelo.startsWith(m));
  if (base) return PRECOS[base];
  return modelo.includes('haiku') ? PRECOS['claude-haiku-5-5'] : PRECOS['claude-opus-5-5'];
}

export function custoUsd(
  modelo: string,
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number },
): number {
  const p = precoDe(modelo);
  const total =
    tokens.entrada * p.entrada +
    tokens.saida * p.saida +
    tokens.cacheLeitura * p.cacheLeitura +
    tokens.cacheEscrita * p.entrada * 1.25;
  return total / 1_000_000;
}

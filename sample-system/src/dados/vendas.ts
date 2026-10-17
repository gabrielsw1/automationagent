// Vendas de exemplo para os relatórios. Geradas de forma determinística dia a dia, a partir de
// janeiro de 2025: o mesmo período sempre dá o mesmo relatório, sem precisar guardar as vendas.
import { Aleatorio } from '../util/aleatorio.ts';
import { centavos, diaDaSemana, diferencaDias, somarDias } from '../util/datas.ts';

export const INICIO_VENDAS = '2025-01-01';

export interface Venda {
  data: string;
  vendedor: string;
  regiao: string;
  produto: string;
  valor: number;
}

export const REGIOES = ['Sul', 'Sudeste', 'Centro-Oeste', 'Nordeste', 'Norte'] as const;

const VENDEDORES: readonly (readonly [string, string, number])[] = [
  // nome, região principal, peso
  ['Ana Ribeiro', 'Sul', 1.3],
  ['Paula Nunes', 'Sudeste', 1.2],
  ['Bruno Carvalho', 'Sul', 1.0],
  ['Letícia Ramos', 'Sudeste', 0.9],
  ['Thiago Moura', 'Centro-Oeste', 0.8],
  ['Renata Duarte', 'Nordeste', 0.7],
];

interface Produto {
  nome: string;
  peso: number;
  valor: (r: Aleatorio) => number;
}

const PRODUTOS: Produto[] = [
  { nome: 'Plano Básico (12 meses)', peso: 18, valor: () => 2278.8 },
  { nome: 'Plano Pro (12 meses)', peso: 12, valor: () => 4678.8 },
  { nome: 'Plano Premium (12 meses)', peso: 5, valor: () => 8998.8 },
  { nome: 'Implantação', peso: 8, valor: (r) => r.inteiro(30, 96) * 50 },
  { nome: 'Visita técnica avulsa', peso: 20, valor: (r) => 280 * r.inteiro(1, 3) },
  { nome: 'Manutenção preventiva', peso: 14, valor: (r) => r.inteiro(13, 36) * 50 },
  { nome: 'Treinamento de equipe', peso: 7, valor: (r) => r.inteiro(9, 24) * 100 },
  { nome: 'Suporte estendido', peso: 9, valor: (r) => r.inteiro(9, 24) * 50 },
];

export const NOMES_PRODUTOS = PRODUTOS.map((p) => p.nome);
export const NOMES_VENDEDORES = VENDEDORES.map((v) => v[0]);

const cache = new Map<string, Venda[]>();

export function vendasDoDia(data: string): Venda[] {
  const guardado = cache.get(data);
  if (guardado) return guardado;
  const r = new Aleatorio(`vendas:${data}`);
  const dia = diaDaSemana(data);
  const mesesDesdeInicio = Math.max(0, diferencaDias(INICIO_VENDAS, data) / 30);
  const crescimento = 1 + mesesDesdeInicio * 0.012;
  const mes = Number(data.slice(5, 7));
  const sazonal = mes === 12 || mes === 1 ? 0.8 : mes === 3 || mes === 8 ? 1.1 : 1;
  let quantidade = 0;
  if (dia >= 1 && dia <= 5) quantidade = Math.round(r.inteiro(4, 9) * crescimento * sazonal);
  else if (dia === 6) quantidade = r.inteiro(0, 2);
  const vendas: Venda[] = [];
  for (let i = 0; i < quantidade; i++) {
    const [vendedor, regiaoPrincipal] = r.ponderado(VENDEDORES.map((v) => [v, v[2]] as const));
    const regiao =
      r.proximo() < 0.72
        ? regiaoPrincipal
        : r.ponderado(REGIOES.map((reg) => [reg, reg === 'Norte' ? 0.6 : reg === 'Sul' ? 1.6 : 1] as const));
    const produto = r.ponderado(PRODUTOS.map((p) => [p, p.peso] as const));
    vendas.push({ data, vendedor, regiao, produto: produto.nome, valor: centavos(produto.valor(r)) });
  }
  cache.set(data, vendas);
  return vendas;
}

/** Vendas entre duas datas (inclusive), limitadas ao intervalo que existe (janeiro de 2025 até hoje). */
export function vendasEntre(inicio: string, fim: string, hoje: string): Venda[] {
  const de = inicio < INICIO_VENDAS ? INICIO_VENDAS : inicio;
  const ate = fim > hoje ? hoje : fim;
  const lista: Venda[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) lista.push(...vendasDoDia(d));
  return lista;
}

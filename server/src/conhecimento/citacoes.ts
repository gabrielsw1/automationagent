// Conversão entre trechos da base e os blocos da API do Claude (search_result e citações).
//
// Cada trecho vira um bloco search_result; os parágrafos do trecho viram blocos de texto separados,
// para que a citação aponte o parágrafo usado (o bloco de texto é a menor unidade citável).
// Nas respostas, as citações chegam como `search_result_location` com `search_result_index`
// (posição do bloco entre todos os search_result do pedido, na ordem em que aparecem).
import type Anthropic from '@anthropic-ai/sdk';
import type { BlocoResposta } from '../llm/tipos.ts';
import type { Trecho } from './tipos.ts';

export interface Citacao {
  n: number;
  titulo: string;
  local?: string;
  url?: string;
}

/** Endereço usado como `source` do search_result (a URL do trecho ou um identificador da fonte). */
export function fonteDoTrecho(t: Trecho): string {
  return t.url ?? `fonte:${t.fonteId}`;
}

/** Título mostrado ao Claude: título do trecho com o local, ex.: "Manual do financeiro.pdf (página 12)". */
export function tituloDoTrecho(t: Trecho): string {
  return t.local ? `${t.titulo} (${t.local})` : t.titulo;
}

/** Parágrafos do trecho (cada um vira um bloco de texto citável). */
export function paragrafosDoTrecho(t: Trecho): string[] {
  const partes = t.texto
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  return partes.length ? partes : [t.texto];
}

/** Trechos → blocos search_result (com citações ligadas) para um tool_result ou mensagem. */
export function paraSearchResults(trechos: Trecho[]): Anthropic.Beta.BetaSearchResultBlockParam[] {
  return trechos.map((t) => ({
    type: 'search_result',
    source: fonteDoTrecho(t),
    title: tituloDoTrecho(t),
    content: paragrafosDoTrecho(t).map((text) => ({ type: 'text' as const, text })),
    citations: { enabled: true },
  }));
}

type CitacaoApi = Extract<NonNullable<Extract<BlocoResposta, { type: 'text' }>['citations']>[number], { type: 'search_result_location' }>;

/**
 * Índice do trecho citado. Usa `search_result_index`; se ele não bater com a lista recebida
 * (ex.: o chamador passou só os trechos da última busca), procura pelo `source` e pelo título.
 */
function indiceDoTrecho(c: CitacaoApi, trechos: Trecho[]): number {
  const i = c.search_result_index;
  const confere = (t: Trecho | undefined) => !!t && fonteDoTrecho(t) === c.source && (c.title == null || tituloDoTrecho(t) === c.title);
  if (confere(trechos[i])) return i;
  const porFonte = trechos.findIndex(confere);
  if (porFonte >= 0) return porFonte;
  // Sem como conferir (título/fonte diferentes): confia no índice, se existir.
  return trechos[i] ? i : -1;
}

function chaveDaCitacao(t: Trecho): string {
  return `${t.titulo}\u0000${t.local ?? ''}\u0000${t.url ?? t.fonteId}`;
}

/** Numera as fontes citadas (na ordem em que aparecem) e devolve o número de cada trecho usado. */
function numerar(conteudo: BlocoResposta[], trechos: Trecho[]) {
  const citacoes: Citacao[] = [];
  const numeroPorChave = new Map<string, number>();
  const numeroDoIndice = (i: number): number => {
    const t = trechos[i];
    const chave = chaveDaCitacao(t);
    let n = numeroPorChave.get(chave);
    if (n === undefined) {
      n = citacoes.length + 1;
      numeroPorChave.set(chave, n);
      citacoes.push({ n, titulo: t.titulo, local: t.local, url: t.url });
    }
    return n;
  };
  const porBloco = conteudo.map((b) => {
    if (b.type !== 'text' || !b.citations) return [] as number[];
    const ns: number[] = [];
    for (const c of b.citations) {
      if (c.type !== 'search_result_location') continue;
      const i = indiceDoTrecho(c, trechos);
      if (i < 0) continue;
      const n = numeroDoIndice(i);
      if (!ns.includes(n)) ns.push(n);
    }
    return ns;
  });
  return { citacoes, porBloco };
}

/** Lista numerada das fontes citadas na resposta (na ordem em que aparecem). */
export function extrairCitacoes(conteudo: BlocoResposta[], trechos: Trecho[]): Citacao[] {
  return numerar(conteudo, trechos).citacoes;
}

/** Índices (em `trechos`) de todos os trechos citados na resposta, sem repetir. */
export function trechosCitados(conteudo: BlocoResposta[], trechos: Trecho[]): number[] {
  const usados: number[] = [];
  for (const b of conteudo) {
    if (b.type !== 'text' || !b.citations) continue;
    for (const c of b.citations) {
      if (c.type !== 'search_result_location') continue;
      const i = indiceDoTrecho(c, trechos);
      if (i >= 0 && !usados.includes(i)) usados.push(i);
    }
  }
  return usados;
}

/**
 * Texto da resposta com marcadores "[1]" logo depois de cada parte citada, e a lista numerada.
 * Ex.: "Acesse Financeiro › Segunda via.[1] O prazo é de 30 dias.[2]"
 */
export function montarRespostaCitada(conteudo: BlocoResposta[], trechos: Trecho[]): { texto: string; citacoes: Citacao[] } {
  const { citacoes, porBloco } = numerar(conteudo, trechos);
  let texto = '';
  conteudo.forEach((b, i) => {
    if (b.type !== 'text') return;
    const ns = porBloco[i];
    if (!ns.length) {
      texto += b.text;
      return;
    }
    const m = /^([\s\S]*?)(\s*)$/.exec(b.text)!;
    texto += `${m[1]}${ns.map((n) => `[${n}]`).join('')}${m[2]}`;
  });
  return { texto: texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), citacoes };
}

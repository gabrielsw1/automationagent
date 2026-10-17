// Recuperação visual: quando nenhum seletor acha o elemento de um passo (a tela mudou), o
// Claude olha o print e a lista de elementos da página e diz qual corresponde ao passo e com
// que confiança. Sem chave (modelo simulado), a regra compara textos e rótulos.
import type { Page } from 'playwright';
import { z } from 'zod';
import type { PassoFluxo } from '@copiloto/shared';
import type { BlocoEntrada, Llm, UsoLlm } from '../llm/tipos.ts';
import type { Caixa } from './mascara.ts';
import { papelDoSeletor, pistasDoSeletor } from './seletores.ts';
import { encurtar, humanizar, melhorSimilaridade, normalizar } from './texto.ts';

/* Código de página (page.evaluate): nomes do navegador declarados só neste arquivo (ver pagina.ts). */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const window: any;
declare const getComputedStyle: (el: any) => { display: string; visibility: string };
declare const CSS: { escape(s: string): string };
type HTMLElement = any;
type HTMLInputElement = any;

export const ATRIBUTO_ALVO = 'data-copiloto-alvo';

/** Elemento interativo da página, numerado para o Claude escolher. */
export interface ElementoPagina {
  indice: number;
  tag: string;
  tipo: string | null;
  papel: string | null;
  texto: string;
  rotulo: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  dataCampo: string | null;
  /** Fica no menu, no cabeçalho ou no rodapé da página (e não no conteúdo)? */
  navegacao: boolean;
  /** Está dentro de um formulário? */
  formulario: boolean;
  caixa: Caixa;
}

/** Lista os elementos interativos visíveis (e os marcados com data-campo) e numera cada um na página. */
export async function coletarElementos(page: Page, limite = 150): Promise<ElementoPagina[]> {
  return page.evaluate(
    ({ atributo, limite }) => {
      for (const el of Array.from<any>(document.querySelectorAll(`[${atributo}]`))) el.removeAttribute(atributo);
      const seletor =
        'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=checkbox], [role=radio], [role=combobox], [role=textbox], [data-campo]';
      const lista: ElementoPagina[] = [];
      const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const rotuloDe = (el: HTMLElement): string | null => {
        const id = el.getAttribute('id');
        const porFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const envolvente = el.closest('label');
        const porAria = el.getAttribute('aria-labelledby');
        const t =
          porFor?.textContent ||
          (envolvente && envolvente !== el ? envolvente.textContent : '') ||
          (porAria ? document.getElementById(porAria)?.textContent : '') ||
          el.getAttribute('aria-label') ||
          '';
        return limpar(t) || null;
      };
      const papelDe = (el: HTMLElement): string | null => {
        const r = el.getAttribute('role');
        if (r) return r;
        const tag = el.tagName.toLowerCase();
        const tipo = (el.getAttribute('type') ?? '').toLowerCase();
        if (tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(tipo))) return 'button';
        if (tag === 'a') return 'link';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea' || tag === 'input') return tipo === 'checkbox' ? 'checkbox' : tipo === 'radio' ? 'radio' : 'textbox';
        return null;
      };
      for (const el of Array.from<any>(document.querySelectorAll(seletor))) {
        if (lista.length >= limite) break;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width < 1 || r.height < 1 || st.visibility === 'hidden' || st.display === 'none') continue;
        const tag = el.tagName.toLowerCase();
        const ehCampo = ['input', 'select', 'textarea'].includes(tag);
        const indice = lista.length + 1;
        el.setAttribute(atributo, String(indice));
        lista.push({
          indice,
          tag,
          tipo: el.getAttribute('type'),
          papel: papelDe(el),
          texto: ehCampo ? '' : limpar(el.innerText || el.textContent || (el as HTMLInputElement).value),
          rotulo: rotuloDe(el),
          name: el.getAttribute('name'),
          id: el.getAttribute('id'),
          placeholder: el.getAttribute('placeholder'),
          dataCampo: el.getAttribute('data-campo'),
          navegacao: !!el.closest('nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]'),
          formulario: !!el.closest('form'),
          caixa: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
      return lista;
    },
    { atributo: ATRIBUTO_ALVO, limite },
  );
}

/** Tira as marcas numeradas deixadas na página. */
export async function limparMarcas(page: Page) {
  await page
    .evaluate((atributo) => {
      for (const el of Array.from<any>(document.querySelectorAll(`[${atributo}]`))) el.removeAttribute(atributo);
    }, ATRIBUTO_ALVO)
    .catch(() => {});
}

export function descreverElemento(e: ElementoPagina): string {
  const nome = e.texto || e.rotulo || e.placeholder || (e.name ? humanizar(e.name) : '') || e.dataCampo || e.tag;
  return encurtar(nome, 60);
}

/** Textos que descrevem o passo (rótulo, título sem o verbo, pistas dos seletores). */
export function textosDoPasso(passo: PassoFluxo): string[] {
  const textos = new Set<string>();
  if (passo.rotuloElemento) textos.add(passo.rotuloElemento);
  const semVerbo = passo.titulo.replace(/^\S+\s+(em\s+|no\s+|na\s+|o\s+|a\s+)?/i, '');
  if (semVerbo) textos.add(semVerbo);
  for (const s of passo.seletores) for (const p of pistasDoSeletor(s.seletor)) textos.add(humanizar(p));
  return [...textos].filter(Boolean);
}

function textosDoElemento(e: ElementoPagina): string[] {
  return [e.texto, e.rotulo, e.placeholder, e.name ? humanizar(e.name) : null, e.id ? humanizar(e.id) : null, e.dataCampo ? humanizar(e.dataCampo) : null].filter(
    (x): x is string => !!x,
  );
}

/** Quanto o tipo do elemento combina com o tipo do passo (0 = não serve). */
function compatibilidade(passo: PassoFluxo, e: ElementoPagina, papelOriginal: string | null): number {
  const tipo = (e.tipo ?? '').toLowerCase();
  const digitavel = (e.tag === 'input' && !['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file'].includes(tipo)) || e.tag === 'textarea';
  const clicavel = e.papel === 'button' || e.papel === 'link' || e.papel === 'menuitem' || e.papel === 'tab' || e.tag === 'summary' || tipo === 'checkbox' || tipo === 'radio';
  const interativo = clicavel || digitavel || e.tag === 'select' || e.papel === 'combobox' || e.papel === 'textbox';
  // Menu, cabeçalho e rodapé quase nunca são o alvo de um passo do formulário.
  const fora = e.navegacao ? (papelOriginal === 'link' ? 0.9 : 0.5) : 1;
  switch (passo.tipo) {
    case 'preencher':
      return digitavel ? fora : 0;
    case 'selecionar':
      return (e.tag === 'select' ? 1 : digitavel ? 0.6 : 0) * fora;
    case 'clique':
    case 'download': {
      if (!clicavel) return 0.2 * fora;
      const papel = papelOriginal && papelOriginal !== (e.papel ?? e.tag) ? 0.6 : 1;
      return papel * fora;
    }
    case 'leitura':
      if (e.dataCampo && !interativo) return fora;
      return (interativo ? 0.3 : 0.7) * fora;
    default:
      return 0.5 * fora;
  }
}

/** Pista de tipo: passo de data acha o único campo de data; botão de envio acha o único botão de envio. */
function bonusTipo(passo: PassoFluxo, e: ElementoPagina, todos: ElementoPagina[]): number {
  const tipo = (e.tipo ?? '').toLowerCase();
  const texto = normalizar([passo.titulo, passo.rotuloElemento, passo.formatoGravado].join(' '));
  const pareceData = /\bdata\b|\bdt\b/.test(texto) || /^9{4}-9{2}-9{2}$|^9{2}\/9{2}\/9{4}$/.test(passo.formatoGravado ?? '');
  if (passo.tipo === 'preencher' && pareceData && tipo === 'date') {
    return todos.filter((x) => (x.tipo ?? '').toLowerCase() === 'date').length === 1 ? 0.15 : 0.08;
  }
  if ((passo.tipo === 'clique' || passo.tipo === 'download') && tipo === 'submit') {
    const envios = todos.filter((x) => (x.tipo ?? '').toLowerCase() === 'submit' && !x.navegacao);
    return envios.length === 1 && !e.navegacao ? 0.1 : 0;
  }
  return 0;
}

/** Regra do modelo simulado: o elemento mais parecido com o passo, pela similaridade de textos. */
export function escolherPorSimilaridade(passo: PassoFluxo, elementos: ElementoPagina[]): { indice: number | null; confianca: number; motivo: string } {
  const papelOriginal = papelDoSeletor(passo.seletores);
  const doPasso = textosDoPasso(passo);
  let melhor: { indice: number; confianca: number; sim: number } | null = null;
  for (const e of elementos) {
    const comp = compatibilidade(passo, e, papelOriginal);
    if (comp === 0) continue;
    const sim = melhorSimilaridade(doPasso, textosDoElemento(e));
    const confianca = Math.min(0.98, (0.15 + 0.75 * sim + bonusTipo(passo, e, elementos)) * comp);
    if (!melhor || confianca > melhor.confianca) melhor = { indice: e.indice, confianca, sim };
  }
  if (!melhor || melhor.sim === 0) {
    return { indice: null, confianca: 0, motivo: 'Nenhum elemento da tela parece com o do passo.' };
  }
  const e = elementos.find((x) => x.indice === melhor!.indice)!;
  const confianca = Math.round(melhor.confianca * 100) / 100;
  return {
    indice: melhor.indice,
    confianca,
    motivo:
      confianca >= 0.8
        ? `“${descreverElemento(e)}” tem o mesmo papel e um nome muito parecido.`
        : `“${descreverElemento(e)}” é o mais parecido, mas o nome mudou bastante.`,
  };
}

const EsquemaRecuperacao = z.object({
  indice: z.number().int().nullable().describe('Número do elemento da lista que corresponde ao passo, ou null se nenhum corresponder.'),
  confianca: z.number().describe('Confiança de 0 a 1 de que o elemento faz a mesma coisa que o do passo.'),
  motivo: z.string().describe('Uma frase curta, em português simples, explicando a escolha.'),
});

const SISTEMA_RECUPERACAO = `Você ajuda o navegador do Copiloto a repetir um fluxo gravado numa tela que mudou.
O passo procurava um elemento que não existe mais do jeito que foi gravado (o nome interno, o rótulo ou o texto mudou).
Você recebe o print da tela atual (dados sensíveis aparecem borrados) e a lista numerada dos elementos que dá para usar.
Diga qual elemento da lista faz a MESMA coisa que o elemento do passo, com que confiança (0 a 1) e por quê.

Regras:
- Responda só com um índice que está na lista. Se nenhum servir, use null e confiança 0.
- Seja conservador: confiança acima de 0,85 só quando o elemento é claramente o mesmo campo ou o mesmo botão
  (mesmo papel na tela, mesmo lugar no formulário, nome com o mesmo sentido).
- Um botão que grava algo diferente (outra ação, outro formulário) não serve, mesmo com nome parecido.
- Para preencher, só campos onde se digita; para selecionar, listas; para clicar, botões e links.
- O motivo é para uma pessoa não técnica: uma frase, sem falar de seletores ou HTML.`;

export interface ResultadoRecuperacao {
  elemento: ElementoPagina | null;
  confianca: number;
  motivo: string;
  uso: UsoLlm | null;
}

/** Pergunta ao Claude qual elemento corresponde ao passo (com print e lista de elementos). */
export async function perguntarAoClaude(
  llm: Llm,
  passo: PassoFluxo,
  elementos: ElementoPagina[],
  print: Buffer | null,
  execucaoId: string,
  urlAtual: string,
): Promise<ResultadoRecuperacao> {
  const descricaoPasso = {
    numero: passo.n,
    tipo: passo.tipo,
    titulo: passo.titulo,
    rotulo_do_elemento: passo.rotuloElemento ?? null,
    jeitos_que_procuramos: passo.seletores.map((s) => s.seletor),
    formato_do_valor: passo.formatoGravado ?? null,
  };
  const listaElementos = elementos.map((e) => ({
    indice: e.indice,
    tag: e.tag,
    tipo: e.tipo,
    papel: e.papel,
    texto: e.texto || null,
    rotulo: e.rotulo,
    name: e.name,
    id: e.id,
    placeholder: e.placeholder,
    marca: e.dataCampo,
    no_menu_ou_cabecalho: e.navegacao,
    no_formulario: e.formulario,
    posicao: e.caixa,
  }));
  const conteudo: BlocoEntrada[] = [];
  if (print) {
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: print.toString('base64') } });
  }
  conteudo.push({
    type: 'text',
    text: [
      `Página atual: ${urlAtual}`,
      `Passo que precisa ser feito:\n${JSON.stringify(descricaoPasso, null, 2)}`,
      `Elementos da tela (as posições são em pixels da página inteira):\n${JSON.stringify(listaElementos)}`,
    ].join('\n\n'),
  });
  const { dados, uso } = await llm.estruturado({
    modelo: 'principal',
    finalidade: 'recuperacao_visual',
    execucaoId: execucaoId.startsWith('teste_') ? null : execucaoId,
    sistema: SISTEMA_RECUPERACAO,
    mensagens: [{ role: 'user', content: conteudo }],
    esquema: EsquemaRecuperacao,
    esforco: 'low',
    maxTokens: 4000,
    simulacao: () => escolherPorSimilaridade(passo, elementos),
  });
  const elemento = dados.indice === null ? null : (elementos.find((e) => e.indice === dados.indice) ?? null);
  const confianca = elemento ? Math.max(0, Math.min(1, dados.confianca)) : 0;
  return { elemento, confianca, motivo: dados.motivo, uso };
}

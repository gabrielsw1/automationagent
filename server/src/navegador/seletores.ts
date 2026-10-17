// Seletores dos passos: como achar o elemento na página (Playwright) e como montar os
// candidatos a partir do que o gravador capturou, do mais estável ao mais frágil.
import type { Locator, Page } from 'playwright';
import type { EventoGravado, SeletorCandidato, TipoPasso } from '@copiloto/shared';
import { caminhoDe, encurtar } from './texto.ts';

type ElementoGravado = NonNullable<EventoGravado['elemento']>;

/**
 * Converte um seletor guardado no fluxo num Locator. Além do CSS e dos motores do Playwright
 * (`role=`, `text=`, `:text()`), aceita `label=<rótulo>` e `placeholder=<texto>`.
 */
export function localizar(page: Page, seletor: string): Locator {
  const s = seletor.trim();
  const role = s.match(/^role=([a-z]+)(?:\[name=(["'])(.*)\2\])?$/i);
  if (role) {
    const nome = role[3]?.replace(/\\(["'])/g, '$1');
    return page.getByRole(role[1] as Parameters<Page['getByRole']>[0], nome !== undefined ? { name: nome, exact: true } : {});
  }
  if (s.startsWith('label=')) return page.getByLabel(semAspas(s.slice(6)), { exact: true });
  if (s.startsWith('placeholder=')) return page.getByPlaceholder(semAspas(s.slice(12)), { exact: true });
  if (s.startsWith('text=')) {
    const t = s.slice(5);
    const exato = /^(["']).*\1$/.test(t);
    return page.getByText(semAspas(t), { exact: exato });
  }
  return page.locator(s);
}

function semAspas(s: string): string {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1).replace(/\\(["'])/g, '$1') : t;
}

/** Valor entre aspas num seletor de atributo. */
export function aspas(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Textos que um seletor revela sobre o elemento (nome interno, rótulo, texto), para comparar telas. */
export function pistasDoSeletor(seletor: string): string[] {
  const pistas: string[] = [];
  for (const m of seletor.matchAll(/\[(?:name|id|data-testid|data-campo|aria-label|placeholder)=["']([^"']+)["']\]/g)) pistas.push(m[1]);
  const role = seletor.match(/^role=[a-z]+\[name=["'](.*)["']\]$/i);
  if (role) pistas.push(role[1]);
  const txt = seletor.match(/^(?:label|placeholder|text)=["']?(.*?)["']?$/);
  if (txt) pistas.push(txt[1]);
  const pseudo = seletor.match(/:(?:text|has-text)\(["'](.*)["']\)/);
  if (pseudo) pistas.push(pseudo[1]);
  const id = seletor.match(/^#([\w-]+)$/);
  if (id) pistas.push(id[1]);
  return pistas;
}

/** Papel do elemento pelo seletor `role=...`, quando há. */
export function papelDoSeletor(seletores: SeletorCandidato[]): string | null {
  for (const s of seletores) {
    const m = s.seletor.match(/^role=([a-z]+)/i);
    if (m) return m[1].toLowerCase();
    if (/^(button|input\[type=["']?(submit|button)["']?\])/.test(s.seletor)) return 'button';
    if (/^a[[.#:\s]|^a$/.test(s.seletor)) return 'link';
  }
  return null;
}

/** ID que parece gerado automaticamente (muda a cada carregamento) não serve como seletor estável. */
export function idEstavel(id: string): boolean {
  if (!id || id.length > 60) return false;
  if (/[:\s]/.test(id)) return false;
  if (/\d{3,}/.test(id)) return false;
  if (/[0-9a-f]{8,}/i.test(id)) return false;
  if (/^(ember|react|mui|radix|headlessui|yui|ext-|ng-|__|_r_)/i.test(id)) return false;
  return true;
}

const TIPOS_TEXTO = new Set(['', 'text', 'email', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'search', 'url', 'password']);

/** Campo onde se digita (input de texto/data/e-mail ou textarea). */
export function ehCampoDeDigitar(el: Pick<ElementoGravado, 'tag' | 'type'>): boolean {
  const tag = el.tag.toLowerCase();
  if (tag === 'textarea') return true;
  return tag === 'input' && TIPOS_TEXTO.has((el.type ?? '').toLowerCase());
}

export function ehClicavel(el: Pick<ElementoGravado, 'tag' | 'type' | 'role' | 'href'>): boolean {
  const tag = el.tag.toLowerCase();
  if (tag === 'button' || tag === 'a' || tag === 'summary') return true;
  if (tag === 'input' && ['submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes((el.type ?? '').toLowerCase())) return true;
  return ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'option'].includes((el.role ?? '').toLowerCase());
}

/** Papel implícito (ARIA) de um elemento gravado. */
export function papelDe(el: Pick<ElementoGravado, 'tag' | 'type' | 'role' | 'href'>): string | null {
  if (el.role) return el.role.toLowerCase();
  const tag = el.tag.toLowerCase();
  const tipo = (el.type ?? '').toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(tipo)) return 'button';
  if (tag === 'a' && el.href) return 'link';
  if (tag === 'input' && tipo === 'checkbox') return 'checkbox';
  if (tag === 'input' && tipo === 'radio') return 'radio';
  if (tag === 'select') return 'combobox';
  return null;
}

/** Atributo `data-campo` (marca de dado na tela) no contexto ou no caminho CSS. */
export function dataCampoDe(el: Pick<ElementoGravado, 'css' | 'contexto'>): string | null {
  const re = /data-campo=["']?([\w-]+)["']?/;
  const doCss = el.css?.match(re);
  if (doCss) return doCss[1];
  // No contexto, só vale se for o primeiro elemento (o próprio elemento gravado).
  const doContexto = el.contexto?.match(/^\s*<[a-z0-9-]+[^>]*?data-campo=["']?([\w-]+)["']?/i);
  return doContexto ? doContexto[1] : null;
}

/** Textos das opções de uma lista, lidos do HTML de contexto do gravador. */
export function opcoesDoContexto(contexto: string | undefined): string[] {
  if (!contexto) return [];
  const opcoes: string[] = [];
  for (const m of contexto.matchAll(/<option\b[^>]*>([^<]*)<\/option>/gi)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (t && !/^(selecione|escolha|--)/i.test(t) && !opcoes.includes(t)) opcoes.push(t);
  }
  return opcoes;
}

/** Nome visível do elemento: o que aparece para a pessoa. */
export function nomeVisivel(el: ElementoGravado): string {
  return encurtar(el.ariaLabel || el.texto || el.rotulo || el.placeholder || '', 80);
}

/**
 * Candidatos a seletor do elemento gravado, do mais estável ao mais frágil, com o motivo em
 * linguagem leiga: data-testid, data-campo, name, id, rótulo, endereço do link, papel+nome,
 * texto de exemplo, texto visível e, por último, o caminho CSS.
 */
export function candidatosDe(el: ElementoGravado, tipoPasso: TipoPasso): SeletorCandidato[] {
  const lista: SeletorCandidato[] = [];
  const add = (seletor: string, estabilidade: SeletorCandidato['estabilidade'], motivo: string) => {
    if (seletor && !lista.some((c) => c.seletor === seletor)) lista.push({ seletor, estabilidade, motivo });
  };
  const tag = el.tag.toLowerCase();
  const campoDeFormulario = ['input', 'select', 'textarea'].includes(tag);
  const papel = papelDe(el);
  const nome = encurtar(el.ariaLabel || el.texto || el.rotulo || '', 80);

  if (el.testId) add(`[data-testid=${aspas(el.testId)}]`, 'estavel', 'usa uma marca feita para automação, que a equipe do sistema mantém');
  const dataCampo = dataCampoDe(el);
  if (dataCampo) add(`[data-campo=${aspas(dataCampo)}]`, 'estavel', 'usa a marca do dado na tela, que não muda quando o visual muda');
  if (el.name && (campoDeFormulario || tag === 'button')) {
    add(`${tag}[name=${aspas(el.name)}]`, 'estavel', 'usa o nome interno do campo, que quase nunca muda');
  }
  if (el.id && idEstavel(el.id)) add(`#${cssId(el.id)}`, 'estavel', 'usa o identificador do elemento na página, que costuma ser fixo');
  if (el.rotulo && campoDeFormulario) {
    add(`label=${aspas(el.rotulo)}`, 'estavel', 'usa o rótulo que aparece ao lado do campo; só muda se alguém renomear o campo');
  }
  if (tag === 'a' && el.href && tipoPasso !== 'leitura') {
    const caminho = caminhoDe(el.href);
    if (caminho && caminho !== '/' && !caminho.startsWith('javascript')) {
      add(`a[href=${aspas(caminho)}]`, 'estavel', 'usa o endereço para onde o link leva, que raramente muda');
    }
  }
  if (papel && nome && ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio'].includes(papel)) {
    const coisa = papel === 'link' ? 'do link' : papel === 'button' ? 'do botão' : 'da opção';
    add(
      `role=${papel}[name=${aspas(nome)}]`,
      'fragil',
      `depende do texto ${coisa}; se o texto mudar, o copiloto procura um parecido na tela e avisa você`,
    );
  }
  if (el.placeholder && campoDeFormulario) {
    add(`placeholder=${aspas(el.placeholder)}`, 'fragil', 'usa o texto de exemplo dentro do campo, que pode mudar');
  }
  // Numa leitura o texto é o dado que muda a cada vez: não serve para achar o elemento.
  if (el.texto && !campoDeFormulario && tipoPasso !== 'leitura' && !papel) {
    const t = encurtar(el.texto, 60);
    if (t) add(`text=${aspas(t)}`, 'fragil', 'depende do texto que aparece na tela, que pode mudar');
  }
  if (el.css) add(el.css, 'fragil', 'usa a posição do elemento na página; quebra se o layout mudar');

  const estaveis = lista.filter((c) => c.estabilidade === 'estavel');
  const frageis = lista.filter((c) => c.estabilidade === 'fragil');
  return [...estaveis, ...frageis];
}

function cssId(id: string): string {
  return id.replace(/([^\w-])/g, '\\$1');
}

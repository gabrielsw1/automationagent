// Descreve um elemento da página para o EventoGravado: tudo que ajuda a achar o elemento de novo
// (id, name, rótulo, papel, texto, data-testid, caminho CSS) e um trecho de HTML ao redor SEM valores digitados.
import type { EventoGravado } from '@copiloto/shared';

export type ElementoGravado = NonNullable<EventoGravado['elemento']>;

const TIPOS_TEXTO = new Set(['', 'text', 'email', 'tel', 'url', 'search', 'number', 'date', 'datetime-local', 'month', 'week', 'time']);

export function ehCampoDeTexto(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return TIPOS_TEXTO.has((el.getAttribute('type') ?? '').toLowerCase());
}

/** Campos que nunca geram evento de preenchimento. */
export function ehCampoSensivel(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const tipo = (el.getAttribute('type') ?? '').toLowerCase();
  if (tipo === 'password' || tipo === 'hidden') return true;
  const auto = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  return /password|cc-number|cc-csc|one-time-code/.test(auto);
}

function limpar(s: string | null | undefined, max = 100): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function textoDe(el: Element): string {
  const html = el as HTMLElement;
  const inner = typeof html.innerText === 'string' ? html.innerText : '';
  return inner || el.textContent || '';
}

function escaparAtributo(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Texto visível do elemento. Campos de digitação não têm "texto" (seria o valor). */
export function textoVisivel(el: Element): string | undefined {
  if (el instanceof HTMLInputElement) {
    const tipo = (el.getAttribute('type') ?? '').toLowerCase();
    if (tipo === 'submit' || tipo === 'button' || tipo === 'reset') return limpar(el.getAttribute('value') ?? el.value);
    return undefined;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return undefined;
  if ((el as HTMLElement).isContentEditable) return undefined;
  return limpar(textoDe(el));
}

/** Rótulo do campo: <label for>, <label> em volta ou aria-labelledby. */
export function rotuloDe(el: Element): string | undefined {
  const doc = el.ownerDocument;
  const partes: string[] = [];
  const id = el.getAttribute('id');
  if (id) {
    const lab = doc.querySelector(`label[for="${escaparAtributo(id)}"]`);
    if (lab) partes.push(textoSemControles(lab));
  }
  if (!partes.length) {
    const envolve = el.closest('label');
    if (envolve) partes.push(textoSemControles(envolve));
  }
  if (!partes.length) {
    const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    for (const i of ids) {
      const alvo = doc.getElementById(i);
      if (alvo) partes.push(textoSemControles(alvo));
    }
  }
  return limpar(partes.join(' '));
}

function textoSemControles(el: Element): string {
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll('input, select, textarea, option, script, style').forEach((n) => n.remove());
  return copia.textContent ?? '';
}

export function papelDe(el: Element): string | undefined {
  const explicito = el.getAttribute('role');
  if (explicito) return explicito;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'summary') return 'button';
  if (tag === 'input') {
    const tipo = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (tipo === 'checkbox') return 'checkbox';
    if (tipo === 'radio') return 'radio';
    if (tipo === 'submit' || tipo === 'button' || tipo === 'reset' || tipo === 'image') return 'button';
    if (tipo === 'search') return 'searchbox';
    if (tipo === 'number') return 'spinbutton';
    if (TIPOS_TEXTO.has(tipo)) return 'textbox';
  }
  return undefined;
}

/** Caminho CSS completo, de html até o elemento (nth-of-type só quando há irmãos com a mesma tag). */
export function caminhoCss(el: Element): string {
  const partes: string[] = [];
  let atual: Element | null = el;
  while (atual && atual.nodeType === 1) {
    const tag = atual.tagName.toLowerCase();
    if (tag === 'html') break;
    const pai: Element | null = atual.parentElement;
    let parte = tag;
    if (pai) {
      const irmaos = Array.from(pai.children).filter((c) => c.tagName === atual!.tagName);
      if (irmaos.length > 1) parte += `:nth-of-type(${irmaos.indexOf(atual) + 1})`;
    }
    partes.unshift(parte);
    atual = pai;
  }
  partes.unshift('html');
  return partes.join(' > ');
}

/** Remove de um clone tudo que possa carregar o que a pessoa digitou ou escolheu. */
function tirarValores(raiz: Element): void {
  const todos = [raiz, ...Array.from(raiz.querySelectorAll('*'))];
  for (const n of todos) {
    const tag = n.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'iframe') {
      n.remove();
      continue;
    }
    if (tag === 'svg') {
      n.replaceChildren();
    }
    for (const attr of Array.from(n.attributes)) {
      const nome = attr.name.toLowerCase();
      if (
        nome === 'value' ||
        nome === 'selected' ||
        nome === 'checked' ||
        nome === 'style' ||
        nome.startsWith('on') ||
        (nome === 'src' && attr.value.startsWith('data:'))
      ) {
        n.removeAttribute(attr.name);
      }
    }
    if (tag === 'textarea') n.textContent = '';
    if ((n as HTMLElement).getAttribute?.('contenteditable') !== null && n.getAttribute('contenteditable') !== 'false') {
      n.textContent = '';
    }
  }
}

const MAX_CONTEXTO = 800;

/** HTML do elemento e arredores (campo + rótulo, ou o pai), sem valores digitados. */
export function contextoSemValores(el: Element): string | undefined {
  const marca = 'data-copiloto-alvo';
  const candidatos = [
    el.closest('label, .field, .form-group, .campo, fieldset, li, tr, td, th'),
    el.parentElement,
    el,
  ].filter((c): c is Element => Boolean(c) && c !== el.ownerDocument.body && c !== el.ownerDocument.documentElement);
  el.setAttribute(marca, '');
  try {
    for (const c of candidatos) {
      const copia = c.cloneNode(true) as Element;
      tirarValores(copia);
      const html = copia.outerHTML.replace(/\s+/g, ' ').trim();
      if (html.length <= MAX_CONTEXTO || c === el) {
        return html.length > MAX_CONTEXTO ? `${html.slice(0, MAX_CONTEXTO - 1)}…` : html;
      }
    }
  } finally {
    el.removeAttribute(marca);
  }
  return undefined;
}

function semTokenGravacao(href: string): string {
  try {
    const u = new URL(href, location.href);
    u.searchParams.delete('copiloto_gravacao');
    u.searchParams.delete('copiloto_api');
    return u.toString();
  } catch {
    return href;
  }
}

export function descreverElemento(el: Element): ElementoGravado {
  const d: ElementoGravado = { tag: el.tagName.toLowerCase(), css: caminhoCss(el) };
  const id = el.getAttribute('id');
  if (id) d.id = id;
  const name = el.getAttribute('name');
  if (name) d.name = name;
  const type = el.getAttribute('type');
  if (type) d.type = type.toLowerCase();
  const role = papelDe(el);
  if (role) d.role = role;
  const texto = textoVisivel(el);
  if (texto) d.texto = texto;
  const rotulo = rotuloDe(el);
  if (rotulo) d.rotulo = rotulo;
  const placeholder = limpar(el.getAttribute('placeholder'));
  if (placeholder) d.placeholder = placeholder;
  const aria = limpar(el.getAttribute('aria-label'));
  if (aria) d.ariaLabel = aria;
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id') ?? el.getAttribute('data-test');
  if (testId) d.testId = testId;
  const href = el.getAttribute('href');
  if (href && el.tagName.toLowerCase() === 'a') d.href = semTokenGravacao(href);
  const contexto = contextoSemValores(el);
  if (contexto) d.contexto = contexto;
  return d;
}

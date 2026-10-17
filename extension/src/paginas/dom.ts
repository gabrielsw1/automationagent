// Peças pequenas de DOM do popup e das opções (sem framework: são telas de poucos elementos).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  atributos: Record<string, string> = {},
  ...filhos: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const f of filhos) if (f) e.append(f);
  return e;
}

/** replaceChildren que pula os vazios (null viraria o texto "null"). */
export function trocar(pai: Element, ...filhos: (Node | string | null | undefined | false)[]): void {
  pai.replaceChildren(...filhos.filter((f): f is Node | string => !!f));
}

export function botao(texto: string, classe: string, aoClicar: () => void, extra: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn ${classe}`, ...extra }, texto);
  b.addEventListener('click', aoClicar);
  return b;
}

/** Ícone de traço (mesmo estilo dos ícones do console). */
export function icone(caminhos: string[], classe = 'i i-sm'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', classe);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of caminhos) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export const ICONES = {
  alerta: ['M12 9v4M12 17h.01', 'M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  externo: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5'],
};

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
  externo: ['M14 4h6v6M20 4l-9 9', 'M18 14v6H4V6h6'],
  /** Botão de gravar (círculo com o ponto). */
  gravar: ['M12 3a9 9 0 110 18 9 9 0 010-18z', 'M12 8.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7z'],
  pessoa: ['M12 4a4 4 0 110 8 4 4 0 010-8z', 'M4 21a8 8 0 0116 0'],
  cadeado: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 018 0v4'],
  semRede: ['M2 8.5a16 16 0 0120 0M5 12a11 11 0 0114 0M8.5 15.5a6 6 0 017 0M12 19.5v.01', 'M3 3l18 18'],
  tentar: ['M20 11a8 8 0 10-2.3 5.7', 'M20 4v7h-7'],
  fechar: ['M6 6l12 12M18 6L6 18'],
  info: ['M12 3a9 9 0 110 18 9 9 0 010-18z', 'M12 11v6M12 7.5v.01'],
};

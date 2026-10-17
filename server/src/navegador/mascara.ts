// Mascaramento dos prints: antes de fotografar a tela, acha os campos e textos com dados
// sensíveis (CPF, CNPJ, e-mail, senha, cartão); depois do print, borra essas regiões na própria
// imagem (canvas numa página auxiliar em branco). A página do sistema não é alterada.
import type { Page } from 'playwright';
import { avaliar } from './pagina.ts';

/* Código de página (page.evaluate): nomes do navegador declarados só neste arquivo (ver pagina.ts). */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const Image: any;
declare const window: any;
declare const getComputedStyle: (el: any) => { display: string; visibility: string };
declare const CSS: { escape(s: string): string };
declare const NodeFilter: { SHOW_TEXT: number };
type HTMLElement = any;
type Element = any;
type DOMRect = { left: number; top: number; width: number; height: number };

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Procura dados sensíveis na página. Devolve as caixas a borrar, em coordenadas da página
 * inteira (pixels CSS, as mesmas do print de página inteira).
 */
export async function acharSensiveis(page: Page): Promise<Caixa[]> {
  return avaliar(page, () => {
    const NOME_SENSIVEL = /cpf|cnpj|documento|\bdoc\b|doc_|_doc|e-?mail|senha|password|passwd|cart[aã]o|card|cvv|cvc|cc-|rg\b|pis\b|conta|agencia|token/i;
    const TEXTO_SENSIVEL = [
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, // CPF
      /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, // CNPJ
      /(?<![\d.])\d{11}(?![\d.])|(?<![\d.])\d{14}(?![\d.])/g, // CPF/CNPJ só dígitos
      /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail
      /\b(?:\d{4}[ -]){3}\d{4}\b/g, // cartão
    ];
    const caixas: { x: number; y: number; w: number; h: number }[] = [];
    const sx = window.scrollX;
    const sy = window.scrollY;
    const guardar = (r: DOMRect) => {
      if (r.width < 2 || r.height < 2) return;
      caixas.push({ x: r.left + sx - 2, y: r.top + sy - 2, w: r.width + 4, h: r.height + 4 });
    };
    const visivel = (el: Element) => {
      const st = getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    };
    const rotuloDe = (el: HTMLElement): string => {
      const id = el.getAttribute('id');
      const porFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
      return [porFor, el.closest('label')?.textContent, el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' ');
    };

    // Campos de formulário com dado sensível (pelo tipo, nome, rótulo ou valor).
    for (const el of Array.from<any>(document.querySelectorAll('input, textarea'))) {
      if (!visivel(el)) continue;
      const tipo = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'reset', 'image', 'file'].includes(tipo)) continue;
      const pistas = [el.name, el.id, el.getAttribute('autocomplete'), rotuloDe(el)].join(' ');
      const valor = el.value ?? '';
      const porValor = TEXTO_SENSIVEL.some((re) => {
        re.lastIndex = 0;
        return re.test(valor);
      });
      if (tipo === 'password' || tipo === 'email' || NOME_SENSIVEL.test(pistas) || porValor) guardar(el.getBoundingClientRect());
    }

    // Textos da página com CPF, CNPJ, e-mail ou cartão.
    const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let visitados = 0;
    for (let n = andar.nextNode(); n && visitados < 8000; n = andar.nextNode(), visitados++) {
      const texto = n.nodeValue ?? '';
      if (texto.trim().length < 5) continue;
      const pai = n.parentElement;
      if (!pai || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(pai.tagName) || !visivel(pai)) continue;
      for (const re of TEXTO_SENSIVEL) {
        re.lastIndex = 0;
        for (let m = re.exec(texto); m; m = re.exec(texto)) {
          const faixa = document.createRange();
          faixa.setStart(n, m.index);
          faixa.setEnd(n, m.index + m[0].length);
          for (const r of Array.from<DOMRect>(faixa.getClientRects())) guardar(r);
        }
      }
    }

    return caixas;
  }, null);
}

/**
 * Borra as caixas na imagem (PNG). Usa um canvas numa página auxiliar em branco, sem a política
 * de conteúdo do sistema. Se não conseguir borrar, lança erro: nunca devolve a imagem sem borrão.
 */
export async function borrarImagem(auxiliar: Page, png: Buffer, caixas: Caixa[]): Promise<Buffer> {
  if (caixas.length === 0) return png;
  const dataUrl: string = await avaliar(
    auxiliar,
    async ({ b64, caixas }: { b64: string; caixas: Caixa[] }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const c2d = canvas.getContext('2d');
      c2d.drawImage(img, 0, 0);
      for (const c of caixas) {
        const x = Math.max(0, Math.floor(c.x));
        const y = Math.max(0, Math.floor(c.y));
        const w = Math.ceil(c.w);
        const h = Math.ceil(c.h);
        // Pixeliza (reduz e amplia) e depois borra: o texto some de verdade.
        const passo = 6;
        const pw = Math.max(1, Math.ceil(w / passo));
        const ph = Math.max(1, Math.ceil(h / passo));
        const peq = document.createElement('canvas');
        peq.width = pw;
        peq.height = ph;
        const p2d = peq.getContext('2d');
        p2d.imageSmoothingEnabled = true;
        p2d.drawImage(canvas, x, y, w, h, 0, 0, pw, ph);
        c2d.save();
        c2d.beginPath();
        c2d.rect(x, y, w, h);
        c2d.clip();
        c2d.imageSmoothingEnabled = false;
        c2d.filter = 'blur(4px)';
        c2d.drawImage(peq, 0, 0, pw, ph, x - 2, y - 2, w + 4, h + 4);
        c2d.filter = 'none';
        c2d.fillStyle = 'rgba(214, 214, 214, 0.35)';
        c2d.fillRect(x, y, w, h);
        c2d.restore();
      }
      return canvas.toDataURL('image/png');
    },
    { b64: png.toString('base64'), caixas },
  );
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('não consegui borrar o print');
  return Buffer.from(base64, 'base64');
}

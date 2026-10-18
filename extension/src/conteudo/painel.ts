// Na página que está sendo gravada, além da barra "Gravando":
// - o painel "Passos gravados", com cada passo assim que o copiloto recebe (e os que ainda estão
//   saindo), para conferir enquanto grava;
// - o balão no campo em que a pessoa digita, com o formato que fica gravado (99.999.999/9999-99),
//   nunca o valor. Em campo de senha, nem o formato: o balão só diz que nada é gravado.
// Tudo desenhado com DOM simples dentro do Shadow DOM da barra.
import { formatoDoValor } from '@copiloto/shared';
import { ehCampoDeTexto, ehCampoSensivel } from '@copiloto/widget/gravador/descrever.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

export interface DadosPainel {
  itens: string[];
  pendentes: number;
}

export const TEXTOS_PAINEL = {
  titulo: 'Passos gravados',
  vazio: 'Os passos aparecem aqui assim que você clica ou preenche algo na página.',
  guardando: (n: number) => (n === 1 ? 'Guardando 1 ação…' : `Guardando ${n} ações…`),
  widget: 'O assistente do copiloto fica escondido enquanto você grava.',
  recolher: 'Recolher os passos gravados',
  mostrar: 'Mostrar os passos gravados',
};

export class PainelPassos {
  readonly elemento: HTMLElement;
  private recolhido: boolean;
  private dados: DadosPainel = { itens: [], pendentes: 0 };

  constructor(raiz: ShadowRoot | HTMLElement, recolhido = typeof window !== 'undefined' && window.innerWidth < 600) {
    this.recolhido = recolhido;
    this.elemento = el('section', 'cpx-painel');
    this.elemento.setAttribute('aria-label', TEXTOS_PAINEL.titulo);
    raiz.appendChild(this.elemento);
    this.desenhar();
  }

  atualizar(dados: DadosPainel): void {
    if (dados.itens.length === this.dados.itens.length && dados.pendentes === this.dados.pendentes && dados.itens.every((t, i) => t === this.dados.itens[i])) return;
    this.dados = { itens: [...dados.itens], pendentes: dados.pendentes };
    this.desenhar();
  }

  remover(): void {
    this.elemento.remove();
  }

  private desenhar(): void {
    const { itens, pendentes } = this.dados;
    const p = this.elemento;
    p.replaceChildren();
    p.classList.toggle('cpx-recolhido', this.recolhido);

    const topo = el('div', 'cpx-painel-topo');
    const titulo = el('p', 'cpx-painel-titulo', TEXTOS_PAINEL.titulo);
    const conta = el('span', 'cpx-painel-conta', String(itens.length));
    conta.setAttribute('aria-label', `${itens.length} ${itens.length === 1 ? 'passo' : 'passos'}`);
    titulo.appendChild(conta);
    topo.appendChild(titulo);
    const alternar = el('button', 'cpx-painel-alternar');
    alternar.type = 'button';
    alternar.setAttribute('aria-expanded', String(!this.recolhido));
    alternar.setAttribute('aria-label', this.recolhido ? TEXTOS_PAINEL.mostrar : TEXTOS_PAINEL.recolher);
    alternar.textContent = this.recolhido ? '▴' : '▾';
    alternar.addEventListener('click', () => {
      this.recolhido = !this.recolhido;
      this.desenhar();
    });
    topo.appendChild(alternar);
    p.appendChild(topo);
    if (this.recolhido) return;

    if (itens.length === 0 && pendentes === 0) {
      p.appendChild(el('p', 'cpx-painel-vazio', TEXTOS_PAINEL.vazio));
    } else {
      const lista = el('ol', 'cpx-painel-lista');
      lista.setAttribute('aria-live', 'polite');
      itens.forEach((t, i) => {
        const li = el('li', i === itens.length - 1 ? 'cpx-ultimo' : undefined);
        li.appendChild(el('span', 'cpx-n', String(i + 1)));
        li.appendChild(el('span', 'cpx-t', t));
        lista.appendChild(li);
      });
      p.appendChild(lista);
      // Rola até o último passo.
      queueMicrotask(() => {
        lista.scrollTop = lista.scrollHeight;
      });
      if (pendentes > 0) {
        const g = el('p', 'cpx-painel-guardando');
        const sp = el('span', 'cpx-giro');
        sp.setAttribute('aria-hidden', 'true');
        g.append(sp, TEXTOS_PAINEL.guardando(pendentes));
        p.appendChild(g);
      }
    }
    p.appendChild(el('p', 'cpx-painel-nota', TEXTOS_PAINEL.widget));
  }
}

/** O que o balão mostra para o campo, ou null para não mostrar nada. */
export function textoDoBalao(alvo: Element): { formato: string | null; senha: boolean } | null {
  if (alvo instanceof HTMLInputElement && ehCampoSensivel(alvo)) {
    return (alvo.getAttribute('type') ?? '').toLowerCase() === 'hidden' ? null : { formato: null, senha: true };
  }
  if (!ehCampoDeTexto(alvo)) return null;
  const valor = alvo.value ?? '';
  return { formato: valor ? formatoDoValor(valor) : null, senha: false };
}

export const TEXTOS_BALAO = {
  rotulo: 'Gravado só o formato',
  semValor: 'Gravado só o formato do que você digitar',
  senha: 'Senha: nada é gravado, nem o formato',
};

export class BalaoFormato {
  readonly elemento: HTMLElement;
  private alvo: Element | null = null;
  private ligado = false;

  constructor(
    raiz: ShadowRoot | HTMLElement,
    private readonly doc: Document = document,
  ) {
    this.elemento = el('div', 'cpx-balao');
    this.elemento.setAttribute('role', 'status');
    this.elemento.hidden = true;
    raiz.appendChild(this.elemento);
  }

  ligar(): void {
    if (this.ligado) return;
    this.ligado = true;
    this.doc.addEventListener('focusin', this.aoFocar, true);
    this.doc.addEventListener('input', this.aoDigitar, true);
    this.doc.addEventListener('focusout', this.aoSair, true);
    window.addEventListener('scroll', this.reposicionar, true);
    window.addEventListener('resize', this.reposicionar);
    const ativo = this.doc.activeElement;
    if (ativo) this.mostrarPara(ativo);
  }

  desligar(): void {
    if (!this.ligado) return;
    this.ligado = false;
    this.doc.removeEventListener('focusin', this.aoFocar, true);
    this.doc.removeEventListener('input', this.aoDigitar, true);
    this.doc.removeEventListener('focusout', this.aoSair, true);
    window.removeEventListener('scroll', this.reposicionar, true);
    window.removeEventListener('resize', this.reposicionar);
    this.esconder();
  }

  remover(): void {
    this.desligar();
    this.elemento.remove();
  }

  private aoFocar = (e: Event) => {
    if (e.target instanceof Element) this.mostrarPara(e.target);
  };

  private aoDigitar = (e: Event) => {
    if (e.target instanceof Element && (e.target === this.alvo || !this.alvo)) this.mostrarPara(e.target);
  };

  private aoSair = (e: Event) => {
    if (e.target === this.alvo) this.esconder();
  };

  private reposicionar = () => {
    if (this.alvo && !this.elemento.hidden) this.posicionar(this.alvo);
  };

  private esconder(): void {
    this.alvo = null;
    this.elemento.hidden = true;
    this.elemento.replaceChildren();
  }

  private mostrarPara(alvo: Element): void {
    // Os campos do próprio copiloto (barra, widget) não são gravados.
    if (alvo.closest('[data-copiloto]')) return;
    const t = textoDoBalao(alvo);
    if (!t) {
      if (this.alvo) this.esconder();
      return;
    }
    this.alvo = alvo;
    const b = this.elemento;
    b.replaceChildren();
    b.classList.toggle('cpx-balao-senha', t.senha);
    if (t.senha) {
      b.appendChild(el('span', 'cpx-balao-rotulo', TEXTOS_BALAO.senha));
    } else if (t.formato) {
      b.appendChild(el('span', 'cpx-balao-rotulo', `${TEXTOS_BALAO.rotulo}:`));
      b.appendChild(el('span', 'cpx-balao-formato', t.formato.length > 60 ? `${t.formato.slice(0, 59)}…` : t.formato));
    } else {
      b.appendChild(el('span', 'cpx-balao-rotulo', TEXTOS_BALAO.semValor));
    }
    b.hidden = false;
    this.posicionar(alvo);
  }

  private posicionar(alvo: Element): void {
    const r = alvo.getBoundingClientRect();
    const b = this.elemento;
    const altura = b.offsetHeight || 30;
    // Em cima do campo; sem espaço em cima, embaixo.
    const topo = r.top - altura - 8 >= 4 ? r.top - altura - 8 : r.bottom + 8;
    const largura = b.offsetWidth || 200;
    const esquerda = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
    b.style.top = `${Math.round(topo)}px`;
    b.style.left = `${Math.round(esquerda)}px`;
  }
}

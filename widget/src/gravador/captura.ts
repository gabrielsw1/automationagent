// Captura das ações do admin na tela do sistema durante a gravação de um fluxo.
// Cliques, preenchimentos (só o formato, nunca o valor), seleções (texto da opção), navegações e downloads.
import { formatoDoValor, type EventoGravado } from '@copiloto/shared';
import { descreverElemento, ehCampoDeTexto, ehCampoSensivel } from './descrever.ts';

export interface OpcoesCaptura {
  aoEvento: (evento: EventoGravado) => void;
  /** Elementos da interface do próprio copiloto (a barra de gravação), que não entram na gravação. */
  ignorar?: (alvo: EventTarget | null) => boolean;
  /** Chave de sessionStorage para não repetir a navegação ao recarregar a mesma página. */
  chaveUltimaUrl?: string;
  documento?: Document;
}

const SELETOR_INTERATIVO =
  'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], input, select, textarea, summary, label, [onclick], [data-testid]';

const ARQUIVO = /\.(pdf|csv|xlsx?|docx?|zip|txt|xml|ofx|ret|rem)(?:[?#]|$)/i;

export function urlSemToken(href: string): string {
  try {
    const u = new URL(href, location.href);
    u.searchParams.delete('copiloto_gravacao');
    return u.toString();
  } catch {
    return href;
  }
}

function ehDownload(a: HTMLAnchorElement): boolean {
  if (a.hasAttribute('download')) return true;
  const href = a.getAttribute('href') ?? '';
  return ARQUIVO.test(href) || /\/arquivos\//.test(href);
}

function pareceClicavel(alvo: Element): Element | null {
  const vista = alvo.ownerDocument.defaultView;
  if (!vista) return null;
  let el: Element | null = alvo;
  for (let i = 0; el && i < 6 && el !== alvo.ownerDocument.body; i++, el = el.parentElement) {
    if (vista.getComputedStyle(el).cursor === 'pointer') return el;
  }
  return null;
}

export class Captura {
  private readonly opcoes: OpcoesCaptura;
  private readonly doc: Document;
  /** Último valor visto de cada campo (só em memória, para não repetir o mesmo preenchimento). Nunca é enviado. */
  private readonly vistos = new WeakMap<Element, string>();
  private ativa = false;
  private readonly restaurar: (() => void)[] = [];

  constructor(opcoes: OpcoesCaptura) {
    this.opcoes = opcoes;
    this.doc = opcoes.documento ?? document;
  }

  iniciar(): void {
    if (this.ativa) return;
    this.ativa = true;
    const d = this.doc;
    d.addEventListener('click', this.aoClique, true);
    d.addEventListener('change', this.aoMudar, true);
    d.addEventListener('submit', this.aoEnviarFormulario, true);
    window.addEventListener('popstate', this.aoNavegarSpa);
    window.addEventListener('hashchange', this.aoNavegarSpa);
    this.restaurar.push(() => {
      d.removeEventListener('click', this.aoClique, true);
      d.removeEventListener('change', this.aoMudar, true);
      d.removeEventListener('submit', this.aoEnviarFormulario, true);
      window.removeEventListener('popstate', this.aoNavegarSpa);
      window.removeEventListener('hashchange', this.aoNavegarSpa);
    });
    this.envolverHistorico();
    this.envolverCliqueProgramatico();
    this.registrarNavegacao();
  }

  parar(): void {
    if (!this.ativa) return;
    this.ativa = false;
    while (this.restaurar.length) this.restaurar.pop()!();
  }

  private emitir(e: Omit<EventoGravado, 'ts' | 'url' | 'tituloPagina'>): void {
    if (!this.ativa) return;
    this.opcoes.aoEvento({
      ...e,
      ts: Date.now(),
      url: urlSemToken(location.href),
      tituloPagina: this.doc.title || undefined,
    } as EventoGravado);
  }

  /** Navegação para a página atual (uma vez por URL, mesmo recarregando). */
  registrarNavegacao(): void {
    const url = urlSemToken(location.href);
    const chave = this.opcoes.chaveUltimaUrl;
    if (chave) {
      try {
        if (sessionStorage.getItem(chave) === url) return;
        sessionStorage.setItem(chave, url);
      } catch {
        /* sem sessionStorage: registra sempre */
      }
    }
    this.emitir({ tipo: 'navegar' });
  }

  private ignorado(e: Event): boolean {
    if (this.opcoes.ignorar?.(e.target)) return true;
    const caminho = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return caminho.some((n) => this.opcoes.ignorar?.(n));
  }

  private aoClique = (e: MouseEvent) => {
    if (!this.ativa || this.ignorado(e)) return;
    const alvo = e.target instanceof Element ? e.target : null;
    if (!alvo) return;
    // Sem elemento interativo por perto, só vale o que parece clicável (cursor de mãozinha, comum em <div> com JS).
    // Clique em texto solto (título, parágrafo) não é passo do fluxo.
    const el = alvo.closest(SELETOR_INTERATIVO) ?? pareceClicavel(alvo);
    if (!el) return;
    // Clicar para pôr o foco num campo não é um passo: o preenchimento vira evento próprio.
    if (ehCampoDeTexto(el) || el instanceof HTMLSelectElement || el instanceof HTMLOptionElement) return;
    if (el instanceof HTMLInputElement && ehCampoSensivel(el)) return;
    // Clique num <label> de um controle: o navegador repete o clique no controle, que é o que gravamos.
    if (el instanceof HTMLLabelElement && el.control) return;
    if (el instanceof HTMLAnchorElement && ehDownload(el)) {
      this.emitir({ tipo: 'download', elemento: descreverElemento(el) });
      return;
    }
    this.emitir({ tipo: 'clique', elemento: descreverElemento(el) });
  };

  private aoMudar = (e: Event) => {
    if (!this.ativa || this.ignorado(e)) return;
    const el = e.target;
    if (el instanceof HTMLSelectElement) {
      const opcoes = Array.from(el.selectedOptions ?? []).map((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim());
      this.emitir({ tipo: 'selecionar', elemento: descreverElemento(el), opcaoTexto: opcoes.join(', ') || undefined });
      return;
    }
    if (el instanceof Element && ehCampoDeTexto(el)) this.preencher(el);
  };

  private aoEnviarFormulario = (e: Event) => {
    if (!this.ativa || this.ignorado(e)) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    // Enter sem sair do campo: garante o preenchimento antes do envio.
    for (const el of Array.from(form.elements)) {
      if (ehCampoDeTexto(el)) this.preencher(el);
    }
  };

  private preencher(el: HTMLInputElement | HTMLTextAreaElement): void {
    if (ehCampoSensivel(el)) return;
    const valor = el.value ?? '';
    if (this.vistos.get(el) === valor) return;
    this.vistos.set(el, valor);
    this.emitir({ tipo: 'preencher', elemento: descreverElemento(el), formatoValor: formatoDoValor(valor) });
  }

  private aoNavegarSpa = () => {
    if (this.ativa) this.registrarNavegacao();
  };

  private envolverHistorico(): void {
    const h = window.history;
    const push = h.pushState;
    const replace = h.replaceState;
    const self = this;
    h.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = push.apply(this, args);
      self.aoNavegarSpa();
      return r;
    };
    h.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      const antes = location.href;
      const r = replace.apply(this, args);
      if (location.href !== antes) self.aoNavegarSpa();
      return r;
    };
    this.restaurar.push(() => {
      h.pushState = push;
      h.replaceState = replace;
    });
  }

  /** Downloads feitos por script (link criado e clicado fora da página) não passam pelo listener de clique. */
  private envolverCliqueProgramatico(): void {
    const proto = HTMLAnchorElement.prototype;
    const original = proto.click;
    const self = this;
    proto.click = function (this: HTMLAnchorElement) {
      if (self.ativa && !this.isConnected && ehDownload(this)) {
        self.emitir({ tipo: 'download', elemento: descreverElemento(this) });
      }
      return original.call(this);
    };
    this.restaurar.push(() => {
      proto.click = original;
    });
  }
}

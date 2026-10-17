// Barra fixa "Gravando · N passos · Concluir · Cancelar", desenhada com DOM simples dentro do Shadow DOM.

type Estado =
  | { tipo: 'gravando' }
  | { tipo: 'confirmar_cancelar' }
  | { tipo: 'ocupado'; texto: string }
  | { tipo: 'final'; texto: string; sucesso: boolean };

export interface AcoesBarra {
  concluir: () => Promise<void>;
  cancelar: () => Promise<void>;
  fechar: () => void;
}

const SVG = 'http://www.w3.org/2000/svg';

function icone(caminhos: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'i i-sm');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of caminhos) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function botao(texto: string, classe: string, aoClicar: () => void): HTMLButtonElement {
  const b = el('button', classe, texto);
  b.type = 'button';
  b.addEventListener('click', aoClicar);
  return b;
}

export class BarraGravacao {
  readonly elemento: HTMLDivElement;
  private estado: Estado = { tipo: 'gravando' };
  private passos = 0;
  private nome = '';
  private erro: string | null = null;
  private readonly acoes: AcoesBarra;

  constructor(raiz: ShadowRoot | HTMLElement, acoes: AcoesBarra) {
    this.acoes = acoes;
    this.elemento = el('div', 'cp-gravador');
    this.elemento.setAttribute('role', 'region');
    this.elemento.setAttribute('aria-label', 'Gravação do fluxo');
    raiz.appendChild(this.elemento);
    this.desenhar();
  }

  definirPassos(n: number): void {
    if (n === this.passos) return;
    this.passos = n;
    if (this.estado.tipo === 'gravando') this.desenhar();
  }

  definirNome(nome: string): void {
    this.nome = nome;
    this.desenhar();
  }

  mostrarErro(texto: string | null): void {
    this.erro = texto;
    this.desenhar();
  }

  mostrarFinal(texto: string, sucesso = true): void {
    this.estado = { tipo: 'final', texto, sucesso };
    this.erro = null;
    this.desenhar();
  }

  voltarAGravar(): void {
    this.estado = { tipo: 'gravando' };
    this.desenhar();
  }

  remover(): void {
    this.elemento.remove();
  }

  private async executar(texto: string, fn: () => Promise<void>): Promise<void> {
    this.estado = { tipo: 'ocupado', texto };
    this.erro = null;
    this.desenhar();
    try {
      await fn();
    } catch (e) {
      this.estado = { tipo: 'gravando' };
      this.erro =
        e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message
          ? e.message
          : 'Não consegui falar com o copiloto. Tente de novo.';
      this.desenhar();
    }
  }

  private desenhar(): void {
    const b = this.elemento;
    b.replaceChildren();
    const linha = el('div', 'cp-grav-linha');
    b.appendChild(linha);
    const s = this.estado;

    if (s.tipo === 'gravando') {
      linha.appendChild(el('span', 'cp-grav-ponto'));
      const titulo = el('span', 'cp-grav-titulo');
      titulo.appendChild(el('span', 'strong', 'Gravando'));
      if (this.nome) titulo.appendChild(el('span', 'cp-grav-nome', ` · ${this.nome}`));
      linha.appendChild(titulo);
      const passos = el('span', 'cp-grav-passos', `· ${this.passos} ${this.passos === 1 ? 'passo' : 'passos'}`);
      passos.setAttribute('aria-live', 'polite');
      linha.appendChild(passos);
      linha.appendChild(botao('Concluir', 'btn btn-primary btn-sm', () => void this.executar('Enviando a gravação…', this.acoes.concluir)));
      linha.appendChild(
        botao('Cancelar', 'btn btn-ghost btn-sm', () => {
          this.estado = { tipo: 'confirmar_cancelar' };
          this.erro = null;
          this.desenhar();
        }),
      );
      b.appendChild(el('p', 'cp-grav-dica', 'Faça o caminho normalmente. O que você digita não é gravado, só o formato.'));
    } else if (s.tipo === 'confirmar_cancelar') {
      linha.appendChild(el('span', 'cp-grav-pergunta', 'Descartar a gravação? Os passos gravados até agora serão perdidos.'));
      linha.appendChild(botao('Descartar', 'btn btn-secondary btn-sm', () => void this.executar('Descartando…', this.acoes.cancelar)));
      linha.appendChild(botao('Continuar gravando', 'btn btn-primary btn-sm', () => this.voltarAGravar()));
    } else if (s.tipo === 'ocupado') {
      const sp = el('span', 'spinner');
      sp.setAttribute('aria-hidden', 'true');
      linha.appendChild(sp);
      linha.appendChild(el('span', 'cp-grav-titulo', s.texto));
    } else {
      const ic = icone(s.sucesso ? ['M5 12.5l4.5 4.5L19 7.5'] : ['M8 8l8 8M16 8l-8 8']);
      ic.classList.add(s.sucesso ? 'text-success' : 'muted');
      linha.appendChild(ic);
      const t = el('span', 'cp-grav-titulo', s.texto);
      t.setAttribute('role', 'status');
      linha.appendChild(t);
      const fechar = botao('', 'btn btn-ghost btn-icon btn-sm', () => this.acoes.fechar());
      fechar.setAttribute('aria-label', 'Fechar aviso');
      fechar.appendChild(icone(['M6 6l12 12M18 6L6 18']));
      linha.appendChild(fechar);
    }

    if (this.erro) {
      const e = el('p', 'cp-grav-erro', this.erro);
      e.setAttribute('role', 'alert');
      b.appendChild(e);
    }
  }
}

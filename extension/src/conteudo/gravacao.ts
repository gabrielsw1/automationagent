// Content script da extensão (mundo isolado): marca a página, pega o token da URL, mostra a barra
// "Gravando" (a mesma do widget, num Shadow DOM) e repassa ao fundo o que a Captura viu na página.
import { MARCA_EXTENSAO, type EventoGravado } from '@copiloto/shared';
import tokensCss from '@copiloto/shared/styles/tokens.css?inline';
import baseCss from '@copiloto/shared/styles/base.css?inline';
import gravadorCss from '@copiloto/widget/gravador/gravador.css?inline';
import { BarraGravacao } from '@copiloto/widget/gravador/barra.ts';
import { ehAvisoEstado, enviar, type EstadoAba, type Resultado } from '../comum/mensagens.ts';
import { lerParametros, semParametros } from '../comum/parametros.ts';
import { EVENTO_CAPTURA, enviarComando, lerEvento } from './ponte.ts';

const FONTES =
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';

const TEXTOS_FINAIS = {
  concluida: 'Gravação enviada. Volte ao console para revisar.',
  cancelada: 'Gravação descartada. Nada foi salvo.',
  encerrada: 'Esta gravação já foi encerrada. Volte ao console para continuar.',
};

/** Marca o <html> (o widget fica de fora e o console sabe que a extensão está instalada). */
export function marcarPagina(versao: string, doc: Document = document): void {
  doc.documentElement.setAttribute(MARCA_EXTENSAO, versao);
}

/** Token e servidor da URL de gravação, já tirados da barra de endereço (o site não chega a vê-los). */
export function pegarParametros(): { token: string; api: string | null } | null {
  const p = lerParametros(location.href);
  if (p) {
    try {
      history.replaceState(history.state, '', semParametros(location.href));
    } catch {
      /* página que não deixa trocar a URL: segue gravando */
    }
  }
  return p;
}

function domPronto(doc: Document): Promise<void> {
  if (doc.readyState !== 'loading') return Promise.resolve();
  return new Promise((r) => doc.addEventListener('DOMContentLoaded', () => r(), { once: true }));
}

/** Mesma fonte do widget, só enquanto a barra está na tela. */
function carregarFontes(doc: Document): void {
  if (doc.querySelector('link[data-copiloto-fontes]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONTES;
  link.setAttribute('data-copiloto-fontes', '');
  (doc.head ?? doc.documentElement).appendChild(link);
}

export class GravacaoNaPagina {
  private readonly doc: Document;
  private hospedeiro: HTMLElement | null = null;
  private barra: BarraGravacao | null = null;
  private capturando = false;
  private final = false;

  constructor(doc: Document = document) {
    this.doc = doc;
    doc.addEventListener(EVENTO_CAPTURA, this.aoCapturar);
  }

  /** Estado vindo do fundo (resposta ao começar, ou aviso de mudança). */
  atualizar(estado: EstadoAba | null): void {
    if (!estado) {
      this.pararCaptura();
      return;
    }
    if (estado.situacao === 'concluida' || estado.situacao === 'cancelada' || estado.situacao === 'encerrada') {
      this.finalizar(estado.situacao, estado.aviso ?? TEXTOS_FINAIS[estado.situacao]);
      return;
    }
    if (this.final) return;
    const barra = this.montarBarra();
    if (estado.nome) barra.definirNome(estado.nome);
    barra.definirPassos(estado.passos);
    if (estado.situacao === 'sem_permissao') {
      barra.mostrarErro(estado.aviso, { rotulo: 'Abrir as opções', aoClicar: () => void enviar({ tipo: 'permitir' }).catch(() => {}) });
    } else {
      barra.mostrarErro(estado.aviso);
    }
    this.iniciarCaptura();
  }

  get estaCapturando(): boolean {
    return this.capturando;
  }

  private iniciarCaptura(): void {
    if (this.capturando) return;
    this.capturando = true;
    enviarComando('comecar', this.doc);
  }

  private pararCaptura(): void {
    if (!this.capturando) return;
    this.capturando = false;
    enviarComando('parar', this.doc);
  }

  private finalizar(situacao: 'concluida' | 'cancelada' | 'encerrada', texto: string): void {
    this.pararCaptura();
    if (this.final) return;
    this.final = true;
    this.montarBarra().mostrarFinal(texto, situacao === 'concluida');
  }

  private aoCapturar = (e: Event) => {
    if (!this.capturando) return;
    const evento: EventoGravado | null = lerEvento((e as CustomEvent<unknown>).detail);
    if (!evento) return;
    enviar<{ passos: number } | null>({ tipo: 'eventos', eventos: [evento] })
      .then((r) => {
        if (r && typeof r.passos === 'number') this.barra?.definirPassos(r.passos);
      })
      .catch(() => {
        // Extensão recarregada no meio: este content script não fala mais com o fundo.
        this.desligar();
      });
  };

  /** Para de ouvir a página (a extensão foi recarregada; o content script novo assume). */
  desligar(): void {
    this.pararCaptura();
    this.doc.removeEventListener(EVENTO_CAPTURA, this.aoCapturar);
  }

  private montarBarra(): BarraGravacao {
    if (this.barra) return this.barra;
    const doc = this.doc;
    carregarFontes(doc);
    const hospedeiro = doc.createElement('copiloto-gravador');
    hospedeiro.setAttribute('data-copiloto', '');
    const raiz = hospedeiro.attachShadow({ mode: 'open' });
    const estilo = doc.createElement('style');
    estilo.textContent = [tokensCss, baseCss, gravadorCss].join('\n');
    raiz.appendChild(estilo);
    // No <html>, fora do <body>: sites que trocam o body inteiro não levam a barra junto.
    doc.documentElement.appendChild(hospedeiro);
    this.hospedeiro = hospedeiro;
    this.barra = new BarraGravacao(raiz, {
      concluir: () => this.concluir(),
      cancelar: () => this.cancelar(),
      fechar: () => {
        this.hospedeiro?.remove();
        this.hospedeiro = null;
        this.barra = null;
      },
    });
    return this.barra;
  }

  private async concluir(): Promise<void> {
    const r = await enviar<Resultado>({ tipo: 'concluir' });
    if (r.ok) return this.finalizar('concluida', TEXTOS_FINAIS.concluida);
    if (r.final) return this.finalizar('encerrada', r.mensagem);
    if (r.semPermissao) {
      this.barra?.voltarAGravar();
      this.barra?.mostrarErro(r.mensagem, { rotulo: 'Abrir as opções', aoClicar: () => void enviar({ tipo: 'permitir' }).catch(() => {}) });
      return;
    }
    throw new Error(r.mensagem);
  }

  private async cancelar(): Promise<void> {
    this.pararCaptura();
    const r = await enviar<Resultado>({ tipo: 'cancelar' });
    this.finalizar(r.ok ? 'cancelada' : 'encerrada', r.ok ? TEXTOS_FINAIS.cancelada : r.mensagem);
  }
}

/** Começo do content script (document_start). */
export async function iniciarConteudo(versao: string): Promise<GravacaoNaPagina | null> {
  marcarPagina(versao);
  const parametros = pegarParametros();
  let estado: EstadoAba | null;
  try {
    estado = await enviar<EstadoAba | null>(parametros ? { tipo: 'comecar', ...parametros } : { tipo: 'estado' });
  } catch {
    return null; // extensão sendo recarregada: nada a fazer nesta página
  }
  const gravacao = new GravacaoNaPagina();
  chrome.runtime.onMessage.addListener((mensagem) => {
    if (ehAvisoEstado(mensagem)) gravacao.atualizar(mensagem.estado);
  });
  if (estado) {
    await domPronto(document);
    gravacao.atualizar(estado);
  }
  return gravacao;
}

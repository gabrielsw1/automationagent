// Content script da extensão (mundo isolado): marca a página, pega o token da URL, mostra a barra
// "Gravando" (a mesma do widget, num Shadow DOM), o painel "Passos gravados" e o balão de formato,
// e repassa ao fundo o que a Captura viu na página. Na página do console, também é a ponte da
// entrada com a conta do Copiloto (window.postMessage ⇄ fundo).
import { MARCA_EXTENSAO, ehMensagemDaExtensao, ehMensagemDoConsole, type EventoGravado, type MensagemDaExtensao } from '@copiloto/shared';
import tokensCss from '@copiloto/shared/styles/tokens.css?inline';
import baseCss from '@copiloto/shared/styles/base.css?inline';
import gravadorCss from '@copiloto/widget/gravador/gravador.css?inline';
import { BarraGravacao, type AcaoErro } from '@copiloto/widget/gravador/barra.ts';
import painelCss from './painel.css?inline';
import { ehAvisoEstado, enviar, type EstadoAba, type Resultado } from '../comum/mensagens.ts';
import { lerParametros, semParametros } from '../comum/parametros.ts';
import { EVENTO_CAPTURA, EVENTO_SUBSTITUIR, enviarComando, lerEvento } from './ponte.ts';
import { BalaoFormato, PainelPassos } from './painel.ts';

const FONTES =
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';

export const TEXTOS_FINAIS = {
  concluida: 'Gravação enviada. Volte ao console para revisar.',
  cancelada: 'Gravação descartada. Nada foi salvo.',
  encerrada: 'Esta gravação já foi encerrada. Volte ao console para continuar.',
};

/** Host da barra na página (fica no <html>). */
const HOSPEDEIRO = 'copiloto-gravador';
/** Enquanto grava, o widget do copiloto sai de cena (o painel avisa). */
const ESTILO_SEM_WIDGET = 'copiloto-widget{display:none!important}';

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
  private painel: PainelPassos | null = null;
  private balao: BalaoFormato | null = null;
  private semWidget: HTMLStyleElement | null = null;
  private capturando = false;
  private final = false;
  private esperando = false;

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
    this.painel?.atualizar({ itens: estado.itens ?? [], pendentes: estado.pendentes ?? 0 });
    if (estado.situacao === 'sem_conexao') {
      // Concluiu sem internet: nada mais é capturado; os passos saem quando a conexão voltar.
      this.pararCaptura();
      this.esperando = true;
      barra.mostrarEspera(estado.aviso ?? '', this.acaoTentarAgora());
      return;
    }
    if (this.esperando) {
      this.esperando = false;
      barra.voltarAGravar();
    }
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

  private acaoTentarAgora(): AcaoErro {
    return { rotulo: 'Tentar agora', aoClicar: () => void this.tentarAgora() };
  }

  private async tentarAgora(): Promise<void> {
    const r = await enviar<Resultado>({ tipo: 'tentarAgora' }).catch(
      (): Resultado => ({ ok: false, mensagem: 'Não consegui falar com a extensão. Recarregue a página.' }),
    );
    if (r.ok) return this.finalizar('concluida', TEXTOS_FINAIS.concluida);
    if (r.final) return this.finalizar('encerrada', r.mensagem);
    this.barra?.mostrarEspera(r.mensagem, this.acaoTentarAgora());
  }

  private iniciarCaptura(): void {
    if (this.capturando) return;
    this.capturando = true;
    enviarComando('comecar', this.doc);
    this.balao?.ligar();
    this.esconderWidget(true);
  }

  private pararCaptura(): void {
    this.balao?.desligar();
    this.esconderWidget(false);
    if (!this.capturando) return;
    this.capturando = false;
    enviarComando('parar', this.doc);
  }

  private esconderWidget(esconder: boolean): void {
    if (esconder && !this.semWidget) {
      const s = this.doc.createElement('style');
      s.setAttribute('data-copiloto', '');
      s.textContent = ESTILO_SEM_WIDGET;
      this.doc.documentElement.appendChild(s);
      this.semWidget = s;
    } else if (!esconder && this.semWidget) {
      this.semWidget.remove();
      this.semWidget = null;
    }
  }

  private finalizar(situacao: 'concluida' | 'cancelada' | 'encerrada', texto: string): void {
    this.pararCaptura();
    if (this.final) return;
    this.final = true;
    this.esperando = false;
    this.painel?.remover();
    this.painel = null;
    this.balao?.remover();
    this.balao = null;
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

  /** Para de ouvir a página e tira a barra (a extensão foi recarregada; o content script novo assume). */
  desligar(): void {
    this.pararCaptura();
    this.doc.removeEventListener(EVENTO_CAPTURA, this.aoCapturar);
    this.balao?.remover();
    this.hospedeiro?.remove();
    this.hospedeiro = null;
    this.barra = null;
    this.painel = null;
    this.balao = null;
  }

  private montarBarra(): BarraGravacao {
    if (this.barra) return this.barra;
    const doc = this.doc;
    carregarFontes(doc);
    // Barra de uma cópia anterior da extensão (atualizada com a aba aberta): sai.
    for (const velho of Array.from(doc.querySelectorAll(HOSPEDEIRO))) velho.remove();
    const hospedeiro = doc.createElement(HOSPEDEIRO);
    hospedeiro.setAttribute('data-copiloto', '');
    const raiz = hospedeiro.attachShadow({ mode: 'open' });
    const estilo = doc.createElement('style');
    estilo.textContent = [tokensCss, baseCss, gravadorCss, painelCss].join('\n');
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
    if (!this.final) {
      this.painel = new PainelPassos(raiz);
      this.balao = new BalaoFormato(raiz, doc);
    }
    return this.barra;
  }

  private async concluir(): Promise<void> {
    const r = await enviar<Resultado>({ tipo: 'concluir' });
    if (r.ok) return this.finalizar('concluida', TEXTOS_FINAIS.concluida);
    if (r.final) return this.finalizar('encerrada', r.mensagem);
    if (r.semConexao) {
      this.pararCaptura();
      this.esperando = true;
      this.barra?.mostrarEspera(r.mensagem, this.acaoTentarAgora());
      return;
    }
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

/**
 * Ponte com a página do console: a página pergunta pela extensão (e pela conta) e entrega o código de
 * entrada por window.postMessage. Só mensagens da própria janela, no formato do console; quem decide
 * se a página é mesmo o console configurado é o fundo (pela origem da aba).
 */
export function ligarPonteDoConsole(janela: Window = window): () => void {
  const aoReceber = (e: MessageEvent) => {
    if (e.source !== janela || e.origin !== janela.location.origin) return;
    if (!ehMensagemDoConsole(e.data)) return;
    enviar<MensagemDaExtensao | null>({ tipo: 'console', mensagem: e.data })
      .then((resposta) => {
        if (ehMensagemDaExtensao(resposta)) janela.postMessage(resposta, janela.location.origin);
      })
      .catch(() => {
        /* extensão recarregada: a cópia nova responde */
      });
  };
  janela.addEventListener('message', aoReceber);
  return () => janela.removeEventListener('message', aoReceber);
}

/** Começo do content script (document_start). */
export async function iniciarConteudo(versao: string): Promise<GravacaoNaPagina | null> {
  // Uma cópia anterior (extensão atualizada com a aba aberta) para de ouvir; esta assume.
  document.dispatchEvent(new CustomEvent(EVENTO_SUBSTITUIR, { detail: 'conteudo' }));
  marcarPagina(versao);
  const desligarPonte = ligarPonteDoConsole();
  const parametros = pegarParametros();
  let estado: EstadoAba | null;
  try {
    estado = await enviar<EstadoAba | null>(parametros ? { tipo: 'comecar', ...parametros } : { tipo: 'estado' });
  } catch {
    desligarPonte();
    return null; // extensão sendo recarregada: nada a fazer nesta página
  }
  const gravacao = new GravacaoNaPagina();
  const aoAviso = (mensagem: unknown) => {
    if (ehAvisoEstado(mensagem)) gravacao.atualizar(mensagem.estado);
  };
  chrome.runtime.onMessage.addListener(aoAviso);
  const aoSubstituir = (e: Event) => {
    if ((e as CustomEvent<unknown>).detail !== 'conteudo') return;
    document.removeEventListener(EVENTO_SUBSTITUIR, aoSubstituir);
    desligarPonte();
    gravacao.desligar();
    try {
      chrome.runtime.onMessage.removeListener(aoAviso);
    } catch {
      /* contexto da extensão antiga já invalidado */
    }
  };
  document.addEventListener(EVENTO_SUBSTITUIR, aoSubstituir);
  if (estado) {
    await domPronto(document);
    gravacao.atualizar(estado);
  }
  return gravacao;
}

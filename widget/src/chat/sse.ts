// Conexão SSE com o servidor (GET /api/widget/eventos?token=&conversa=), com reconexão própria.
// O navegador já tenta reconectar sozinho, mas para quando o servidor responde com erro; aqui a
// reconexão é controlada (espera crescente) e a cada volta o chat sincroniza a conversa.
import type { EventoWidget } from '@copiloto/shared';
import { online } from './util.ts';

export type StatusConexao = 'ociosa' | 'conectando' | 'aberta' | 'reconectando' | 'instavel';

export type ConstrutorEventSource = new (url: string) => EventSource;

export interface OpcoesConexao {
  url: string;
  aoEvento: (evento: EventoWidget) => void;
  aoStatus: (status: StatusConexao) => void;
  /** Chamado quando a conexão volta depois de cair (para buscar o que se perdeu). */
  aoReabrir?: () => void;
  EventSourceImpl?: ConstrutorEventSource;
  /** Depois de quanto tempo sem conseguir reconectar a faixa vira "Conexão instável". */
  msAteInstavel?: number;
}

export class ConexaoEventos {
  private es: EventSource | null = null;
  private tentativas = 0;
  private jaAbriu = false;
  private fechada = false;
  private timerReconexao: ReturnType<typeof setTimeout> | null = null;
  private timerInstavel: ReturnType<typeof setTimeout> | null = null;
  private status: StatusConexao = 'ociosa';
  private readonly opcoes: OpcoesConexao;

  constructor(opcoes: OpcoesConexao) {
    this.opcoes = opcoes;
  }

  conectar(): void {
    this.fechada = false;
    this.mudarStatus('conectando');
    this.abrir();
  }

  /** Reconecta já (ex.: a internet voltou). */
  reconectarAgora(): void {
    if (this.fechada || this.status === 'aberta') return;
    this.limparTimerReconexao();
    this.abrir();
  }

  /** Sem internet: mostra a faixa na hora, sem esperar a próxima tentativa. */
  marcarOffline(): void {
    if (this.fechada) return;
    this.mudarStatus('instavel');
  }

  fechar(): void {
    this.fechada = true;
    this.limparTimerReconexao();
    this.limparTimerInstavel();
    this.es?.close();
    this.es = null;
    this.mudarStatus('ociosa');
  }

  private abrir(): void {
    this.es?.close();
    const ES = this.opcoes.EventSourceImpl ?? (globalThis as { EventSource?: ConstrutorEventSource }).EventSource;
    if (!ES) {
      this.mudarStatus('instavel');
      return;
    }
    let es: EventSource;
    try {
      es = new ES(this.opcoes.url);
    } catch {
      this.agendarReconexao();
      return;
    }
    this.es = es;
    es.onopen = () => {
      if (this.es !== es) return;
      const reabriu = this.jaAbriu;
      this.jaAbriu = true;
      this.tentativas = 0;
      this.limparTimerInstavel();
      this.mudarStatus('aberta');
      if (reabriu) this.opcoes.aoReabrir?.();
    };
    es.onmessage = (ev: MessageEvent) => {
      if (this.es !== es) return;
      let evento: EventoWidget;
      try {
        evento = JSON.parse(String(ev.data)) as EventoWidget;
      } catch {
        return;
      }
      if (evento && typeof evento === 'object' && 'tipo' in evento) this.opcoes.aoEvento(evento);
    };
    es.onerror = () => {
      if (this.es !== es) return;
      es.close();
      this.es = null;
      this.agendarReconexao();
    };
  }

  private agendarReconexao(): void {
    if (this.fechada) return;
    this.tentativas += 1;
    if (!online() || this.tentativas >= 3) this.mudarStatus('instavel');
    else {
      this.mudarStatus('reconectando');
      if (!this.timerInstavel) {
        this.timerInstavel = setTimeout(() => {
          this.timerInstavel = null;
          if (!this.fechada && this.status !== 'aberta') this.mudarStatus('instavel');
        }, this.opcoes.msAteInstavel ?? 8000);
      }
    }
    const espera = Math.min(1000 * 2 ** (this.tentativas - 1), 15000);
    this.limparTimerReconexao();
    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      if (!this.fechada) this.abrir();
    }, espera);
  }

  private mudarStatus(s: StatusConexao): void {
    if (this.status === s) return;
    this.status = s;
    this.opcoes.aoStatus(s);
  }

  private limparTimerReconexao(): void {
    if (this.timerReconexao) clearTimeout(this.timerReconexao);
    this.timerReconexao = null;
  }

  private limparTimerInstavel(): void {
    if (this.timerInstavel) clearTimeout(this.timerInstavel);
    this.timerInstavel = null;
  }
}

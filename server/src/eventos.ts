// Barramento de eventos em memória: leva atualizações para o widget (SSE por conversa)
// e para o console (SSE geral). Um processo só; para vários processos, troque por Redis pub/sub.
import { EventEmitter } from 'node:events';
import type { EventoWidget } from '@copiloto/shared';

export type EventoConsole =
  | { tipo: 'execucao'; execucaoId: string; status: string }
  | { tipo: 'conversa'; conversaId: string; estado: string }
  | { tipo: 'mensagem'; conversaId: string; mensagemId: string }
  | { tipo: 'fonte'; fonteId: string; status: string }
  | { tipo: 'fluxo'; fluxoId: string; etapa: string; passos: number }
  | { tipo: 'aprovacao'; aprovacaoId: string; estado: string };

export class Eventos {
  private readonly emissor = new EventEmitter();

  constructor() {
    this.emissor.setMaxListeners(0);
  }

  emitirConversa(conversaId: string, evento: EventoWidget) {
    this.emissor.emit(`conversa:${conversaId}`, evento);
  }

  ouvirConversa(conversaId: string, fn: (e: EventoWidget) => void): () => void {
    const nome = `conversa:${conversaId}`;
    this.emissor.on(nome, fn);
    return () => this.emissor.off(nome, fn);
  }

  /** Eventos por usuário do sistema (ex.: resposta de aprovação chega mesmo com outra conversa aberta). */
  emitirUsuario(usuarioId: string, evento: EventoWidget) {
    this.emissor.emit(`usuario:${usuarioId}`, evento);
  }

  ouvirUsuario(usuarioId: string, fn: (e: EventoWidget) => void): () => void {
    const nome = `usuario:${usuarioId}`;
    this.emissor.on(nome, fn);
    return () => this.emissor.off(nome, fn);
  }

  emitirConsole(evento: EventoConsole) {
    this.emissor.emit('console', evento);
  }

  ouvirConsole(fn: (e: EventoConsole) => void): () => void {
    this.emissor.on('console', fn);
    return () => this.emissor.off('console', fn);
  }
}

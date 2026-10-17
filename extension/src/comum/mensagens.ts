// Mensagens entre as partes da extensão: página (content script) ⇄ fundo (service worker) ⇄ popup e opções.
// O token da gravação chega ao fundo uma vez, no "comecar", e nunca mais sai de lá.
import type { EventoGravado } from '@copiloto/shared';

/** gravando: captura e envia; sem_permissao: captura e guarda até o servidor ser liberado nas opções. */
export type Situacao = 'gravando' | 'sem_permissao' | 'concluida' | 'cancelada' | 'encerrada';

/** O que a barra e o popup mostram de uma aba (sem o token). */
export interface EstadoAba {
  situacao: Situacao;
  /** Nome do fluxo (vem do servidor). */
  nome: string | null;
  /** Passos contados pelo servidor mais os eventos que ainda não saíram. */
  passos: number;
  /** Origem do servidor do copiloto desta gravação. */
  api: string;
  /** Aviso passageiro (sem conexão, sem permissão) ou o texto final. */
  aviso: string | null;
}

export type Pedido =
  | { tipo: 'comecar'; token: string; api: string | null }
  | { tipo: 'estado'; abaId?: number }
  | { tipo: 'eventos'; eventos: EventoGravado[] }
  | { tipo: 'concluir'; abaId?: number }
  | { tipo: 'cancelar'; abaId?: number }
  /** Abre as opções pedindo a liberação do servidor da gravação desta aba. */
  | { tipo: 'permitir'; abaId?: number }
  | { tipo: 'saude'; servidor?: string }
  | { tipo: 'gravarAba'; url: string };

export type Resultado =
  | { ok: true }
  | {
      ok: false;
      mensagem: string;
      /** A gravação acabou (concluída ou cancelada no console, ou não existe mais). */
      final?: boolean;
      /** Falta liberar o servidor do copiloto nas opções. */
      semPermissao?: boolean;
    };

export type Saude =
  | { ok: true; servidor: string; sistema: string; urlConsole: string }
  | { ok: false; servidor: string; mensagem: string; semPermissao?: boolean };

/** Fundo → página e popup: o estado da aba mudou (null: a aba não grava mais). */
export interface AvisoEstado {
  tipo: 'estadoAba';
  abaId: number;
  estado: EstadoAba | null;
}

export function ehAvisoEstado(m: unknown): m is AvisoEstado {
  return !!m && typeof m === 'object' && (m as { tipo?: unknown }).tipo === 'estadoAba';
}

export function enviar<R>(pedido: Pedido): Promise<R> {
  return chrome.runtime.sendMessage<R>(pedido);
}

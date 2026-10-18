// Mensagens entre as partes da extensão: página (content script) ⇄ fundo (service worker) ⇄ popup e opções.
// O token da gravação chega ao fundo uma vez, no "comecar", e nunca mais sai de lá. O token da conta
// (entrada com a conta do Copiloto) também fica só no fundo: popup e páginas recebem nome e empresa.
import type { EventoGravado, GravacaoRecente, MensagemDoConsole, SessaoExtensao } from '@copiloto/shared';

/**
 * gravando: captura e envia; sem_permissao: captura e guarda até o servidor ser liberado nas opções;
 * sem_conexao: a pessoa concluiu sem internet: a captura parou e os passos saem quando a conexão voltar.
 */
export type Situacao = 'gravando' | 'sem_permissao' | 'sem_conexao' | 'concluida' | 'cancelada' | 'encerrada';

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
  /** Fluxo no console ("Abrir no console"). */
  fluxoId?: string | null;
  /** Títulos dos passos já recebidos pelo servidor (painel "Passos gravados"). */
  itens?: string[];
  /** Eventos ainda não enviados (o painel mostra "Guardando…"). */
  pendentes?: number;
  /** Para onde vai: "Envia para Horizonte Gestão · Rafael Lima". */
  empresa?: string | null;
  pessoa?: string | null;
}

/** A conta da extensão como o popup vê (o token nunca sai do fundo). */
export type EstadoConta =
  | { conectada: false; aviso?: string | null }
  | {
      conectada: true;
      sessao: SessaoExtensao;
      /** Sem resposta do servidor agora: mostra o que estava guardado. */
      offline?: boolean;
    };

export type Pedido =
  | { tipo: 'comecar'; token: string; api: string | null }
  | { tipo: 'estado'; abaId?: number }
  | { tipo: 'eventos'; eventos: EventoGravado[] }
  | { tipo: 'concluir'; abaId?: number }
  | { tipo: 'cancelar'; abaId?: number }
  /** "Tentar agora" (sem conexão): manda os passos guardados e conclui. */
  | { tipo: 'tentarAgora'; abaId?: number }
  /** Abre as opções pedindo a liberação do servidor da gravação desta aba. */
  | { tipo: 'permitir'; abaId?: number }
  | { tipo: 'saude'; servidor?: string }
  | { tipo: 'gravarAba'; url: string }
  /** "Abrir no console": o fluxo gravado (ou o Aprender fluxo). */
  | { tipo: 'abrirConsole'; fluxoId?: string | null; api?: string | null }
  // Conta (só do popup e das opções):
  | { tipo: 'conta' }
  /** "Entrar com a conta do Copiloto" e "Trocar": abre a página de entrada do console. */
  | { tipo: 'entrar'; empresaId?: string }
  | { tipo: 'sair' }
  | { tipo: 'recentes' }
  // Da página do console (pelo content script): estado da extensão e o código de entrada.
  | { tipo: 'console'; mensagem: MensagemDoConsole };

export type Resultado =
  | { ok: true }
  | {
      ok: false;
      mensagem: string;
      /** A gravação acabou (concluída ou cancelada no console, ou não existe mais). */
      final?: boolean;
      /** Falta liberar o servidor do copiloto nas opções. */
      semPermissao?: boolean;
      /** Concluir sem internet: os passos ficam guardados e saem quando a conexão voltar. */
      semConexao?: boolean;
      /** Precisa entrar com a conta do Copiloto antes. */
      semConta?: boolean;
    };

export type Saude =
  | { ok: true; servidor: string; sistema: string; urlConsole: string }
  | { ok: false; servidor: string; mensagem: string; semPermissao?: boolean };

export type Recentes = { ok: true; gravacoes: GravacaoRecente[] } | { ok: false; mensagem: string };

/** Fundo → página e popup: o estado da aba mudou (null: a aba não grava mais). */
export interface AvisoEstado {
  tipo: 'estadoAba';
  abaId: number;
  estado: EstadoAba | null;
}

/** Fundo → popup: a conta entrou, trocou de empresa ou saiu. */
export interface AvisoConta {
  tipo: 'contaMudou';
}

export function ehAvisoEstado(m: unknown): m is AvisoEstado {
  return !!m && typeof m === 'object' && (m as { tipo?: unknown }).tipo === 'estadoAba';
}

export function ehAvisoConta(m: unknown): m is AvisoConta {
  return !!m && typeof m === 'object' && (m as { tipo?: unknown }).tipo === 'contaMudou';
}

export function enviar<R>(pedido: Pedido): Promise<R> {
  return chrome.runtime.sendMessage<R>(pedido);
}

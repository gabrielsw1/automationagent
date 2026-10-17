// Interface do modelo de linguagem usada pelo resto do servidor. Há duas implementações:
// anthropic.ts (Claude de verdade, pelo SDK oficial) e simulado.ts (regras fixas, para testes
// e para rodar sem ANTHROPIC_API_KEY). Os formatos de mensagem são os do SDK da Anthropic.
import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';

export type MensagemLlm = Anthropic.Beta.BetaMessageParam;
export type BlocoResposta = Anthropic.Beta.BetaContentBlock;
export type BlocoEntrada = Anthropic.Beta.BetaContentBlockParam;
export type FerramentaLlm = Anthropic.Beta.BetaTool;
export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface UsoLlm {
  /** Modelo que de fato respondeu (pode ser o modelo reserva, depois de uma recusa). */
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  custoUsd: number;
}

/** Atribuição do custo de uma chamada (tabela uso_llm). */
export interface Atribuicao {
  /** Ex.: "agente", "classificacao", "aprender_fluxo", "recuperacao_visual", "conhecimento", "teste". */
  finalidade: string;
  conversaId?: string | null;
  execucaoId?: string | null;
}

export interface PedidoTurno extends Atribuicao {
  /** Prompt de sistema estável (vai para o cache). Nada que mude a cada pedido. */
  sistema: string;
  ferramentas: FerramentaLlm[];
  /** Histórico completo, só acrescentado (append-only). Blocos de thinking voltam intactos. */
  mensagens: MensagemLlm[];
  esforco?: Esforco;
  maxTokens?: number;
  /** Recebe o texto da resposta enquanto chega (streaming). */
  aoTexto?: (delta: string) => void;
  sinal?: AbortSignal;
  /** Comportamento do modelo simulado para este turno (ignorado pelo Claude). */
  simulacao?: (pedido: PedidoTurno) => BlocoResposta[];
}

export type MotivoParada = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | 'stop_sequence' | 'outro';

export interface RespostaTurno {
  /** Conteúdo completo, para gravar na transcrição exatamente como veio. */
  conteudo: BlocoResposta[];
  parada: MotivoParada;
  uso: UsoLlm;
  /** true quando o pedido foi recusado pelo modelo principal e respondido pelo reserva. */
  usouReserva: boolean;
}

export interface PedidoEstruturado<T> extends Atribuicao {
  /** principal = Opus (raciocínio); rapido = Haiku (classificação e roteamento baratos). */
  modelo: 'principal' | 'rapido';
  sistema: string;
  /** Pode conter imagens (prints) e documentos. */
  mensagens: MensagemLlm[];
  esquema: z.ZodType<T>;
  esforco?: Esforco;
  maxTokens?: number;
  /** Resultado do modelo simulado (obrigatório: sem chave o servidor continua funcionando). */
  simulacao: () => T;
}

export interface Llm {
  readonly simulado: boolean;
  readonly modeloPrincipal: string;
  turno(pedido: PedidoTurno): Promise<RespostaTurno>;
  estruturado<T>(pedido: PedidoEstruturado<T>): Promise<{ dados: T; uso: UsoLlm }>;
}

/** O modelo recusou o pedido (stop_reason "refusal") mesmo depois do modelo reserva. */
export class RecusaDoModelo extends Error {
  constructor(readonly categoria: string | null) {
    super('O modelo recusou o pedido.');
    this.name = 'RecusaDoModelo';
  }
}

/** Falha ao falar com a API do Claude (rede, chave inválida, limite de taxa). */
export class ErroLlm extends Error {
  constructor(
    mensagem: string,
    readonly tipo: 'autenticacao' | 'limite' | 'indisponivel' | 'pedido_invalido' | 'resposta_invalida' | 'outro',
    readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = 'ErroLlm';
  }
}

export type RegistrarUso = (uso: UsoLlm, atribuicao: Atribuicao) => void;

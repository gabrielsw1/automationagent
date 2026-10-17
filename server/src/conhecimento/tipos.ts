// Contrato da base de conhecimento. O agente usa `buscar` dentro da ferramenta
// consultar_conhecimento e devolve os trechos ao Claude como blocos search_result (com citações).
import type { RespostaTeste } from '@copiloto/shared';

export interface Trecho {
  fonteId: string;
  /** Título da página, do documento ou da resposta. */
  titulo: string;
  /** Onde no documento. Ex.: "página 12", "seção Boletos", "02:14". */
  local?: string;
  url?: string;
  texto: string;
  /** Relevância (maior = melhor). */
  pontuacao: number;
}

export interface BaseConhecimento {
  /** Busca por texto (FTS5/bm25). Só fontes indexadas. */
  buscar(pergunta: string, limite?: number): Trecho[];
  /** Guarda uma pergunta que ficou sem resposta (C7 "Perguntas sem resposta"). Agrupa repetidas. */
  registrarSemResposta(pergunta: string, causa: string): void;
  /** Resposta completa com citações, usada no "Testar uma pergunta" do console. */
  responder(pergunta: string): Promise<RespostaTeste>;
  /** Retoma indexações que ficaram pela metade (chamado ao iniciar o servidor). */
  retomar(): void;
}

// Contrato do caminho navegador (Playwright). O motor de execução chama `executar` quando a
// tarefa usa um fluxo gravado (ou quando a API falha e a tarefa permite usar o fluxo).
import type { Fluxo, RegistroLido } from '@copiloto/shared';

export interface Destaque {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EventoNavegador {
  tipo: 'login' | 'passo_inicio' | 'passo_ok' | 'passo_falhou' | 'recuperacao' | 'aviso';
  /** Número do passo (1..n), quando se aplica. */
  passo?: number;
  /** Texto de negócio, sem jargão. Ex.: "Preencheu CPF/CNPJ". */
  titulo: string;
  detalhe?: string;
  printId?: string;
  destaque?: Destaque;
  /** Recuperação visual: o que o Claude achou na tela e com que confiança (0 a 1). */
  candidato?: { texto: string; confianca: number };
}

export interface PedidoExecucaoNavegador {
  execucaoId: string;
  fluxo: Fluxo;
  /** Valores da tarefa, por chave de campo, já validados e normalizados. */
  valores: Record<string, string>;
  /** O navegador entra como esta pessoa (sessão do adaptador), nunca com senha. */
  usuarioId: string;
  /** Abaixo disso a recuperação visual não age sozinha: para e chama uma pessoa. */
  confiancaMinima: number;
  mascararPrints: boolean;
  aoEvento: (e: EventoNavegador) => void;
  sinal: AbortSignal;
}

export interface ArquivoGerado {
  /** Nome para mostrar e baixar. Ex.: "boleto-outubro.pdf". */
  nome: string;
  /** Caminho absoluto do arquivo salvo em DATA_DIR/arquivos/<execucaoId>/. */
  caminho: string;
  tipo: string;
}

export type ResultadoNavegador =
  | {
      ok: true;
      /** Dados lidos da tela (passos de leitura), por nome. Ex.: { numero_boleto: "34191..." }. */
      gerados: Record<string, string>;
      arquivos: ArquivoGerado[];
      duracaoMs: number;
      /** Quantas vezes a recuperação visual achou um elemento que tinha mudado. */
      recuperacoes: number;
      /** Número do registro criado, lido da tela depois do último passo; null quando procurou e não achou. */
      registro?: RegistroLido | null;
    }
  | {
      ok: false;
      motivo: 'elemento_nao_encontrado' | 'tempo_esgotado' | 'sessao_expirada' | 'cancelado' | 'navegador_indisponivel' | 'erro';
      passo: number | null;
      /** Frase de negócio para o usuário e para o console. */
      mensagem: string;
      printId?: string;
      destaque?: Destaque;
      candidato?: { texto: string; confianca: number };
      duracaoMs: number;
    };

export interface Navegador {
  /** Chromium instalado e utilizável? (aparece no guia e no painel) */
  disponivel(): Promise<{ ok: boolean; detalhe: string }>;
  executar(pedido: PedidoExecucaoNavegador): Promise<ResultadoNavegador>;
  /** Entra no sistema como antes de um fluxo (conta de serviço ou sessão de `usuarioId`) e sai, para o admin conferir. */
  testarAcesso?(usuarioId?: string): Promise<{ ok: boolean; detalhe: string }>;
  fechar(): Promise<void>;
}

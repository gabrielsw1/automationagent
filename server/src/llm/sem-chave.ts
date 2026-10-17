// Servidor sem ANTHROPIC_API_KEY (e sem COPILOTO_LLM=simulado): o copiloto não finge responder.
// Toda chamada falha com SemChaveClaude; o widget explica que o assistente ainda não está ligado e
// o console mostra a faixa com o que falta configurar.
import { SemChaveClaude, type Llm, type PedidoEstruturado, type RespostaTurno, type UsoLlm } from './tipos.ts';

export class LlmSemChave implements Llm {
  readonly simulado = false;
  readonly semChave = true;

  constructor(readonly modeloPrincipal: string) {}

  async turno(): Promise<RespostaTurno> {
    throw new SemChaveClaude();
  }

  async estruturado<T>(_pedido: PedidoEstruturado<T>): Promise<{ dados: T; uso: UsoLlm }> {
    throw new SemChaveClaude();
  }
}

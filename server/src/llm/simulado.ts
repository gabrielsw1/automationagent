// Modelo simulado: usado nos testes e quando não há ANTHROPIC_API_KEY. Cada chamada traz a
// própria regra (pedido.simulacao); aqui só embrulhamos no mesmo formato do SDK.
import type { BlocoResposta, Llm, PedidoEstruturado, PedidoTurno, RegistrarUso, RespostaTurno, UsoLlm } from './tipos.ts';

const USO_ZERO = (modelo: string): UsoLlm => ({
  modelo,
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  custoUsd: 0,
});

export class LlmSimulado implements Llm {
  readonly simulado = true;
  readonly modeloPrincipal = 'simulado';

  constructor(
    private readonly registrarUso: RegistrarUso = () => {},
    /** Atraso entre pedaços de texto, para o streaming parecer real no widget. 0 nos testes. */
    private readonly atrasoMs = 0,
  ) {}

  async turno(pedido: PedidoTurno): Promise<RespostaTurno> {
    if (!pedido.simulacao) throw new Error('Turno simulado sem regra de simulação.');
    const conteudo = pedido.simulacao(pedido);
    for (const b of conteudo) {
      if (b.type === 'text' && pedido.aoTexto) {
        for (const pedaco of b.text.match(/\S+\s*/g) ?? []) {
          if (pedido.sinal?.aborted) break;
          pedido.aoTexto(pedaco);
          if (this.atrasoMs) await new Promise((r) => setTimeout(r, this.atrasoMs));
        }
      }
    }
    const uso = USO_ZERO('simulado');
    this.registrarUso(uso, pedido);
    const temFerramenta = conteudo.some((b) => b.type === 'tool_use');
    return { conteudo, parada: temFerramenta ? 'tool_use' : 'end_turn', uso, usouReserva: false };
  }

  async estruturado<T>(pedido: PedidoEstruturado<T>): Promise<{ dados: T; uso: UsoLlm }> {
    const dados = pedido.esquema.parse(pedido.simulacao());
    const uso = USO_ZERO('simulado');
    this.registrarUso(uso, pedido);
    return { dados, uso };
  }
}

let contador = 0;

/** Helpers para montar blocos no formato do SDK dentro das regras de simulação. */
export const sim = {
  texto(text: string): BlocoResposta {
    return { type: 'text', text, citations: null } as BlocoResposta;
  },
  ferramenta(name: string, input: Record<string, unknown>): BlocoResposta {
    contador += 1;
    return { type: 'tool_use', id: `toolu_sim_${Date.now().toString(36)}_${contador}`, name, input } as BlocoResposta;
  },
};

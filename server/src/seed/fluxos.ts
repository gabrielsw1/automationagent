// Fluxos gravados de exemplo (caminho navegador), alinhados às telas do sistema de exemplo.
// Ver docs/arquitetura.md, seção "Telas do Horizonte".
import type { Fluxo } from '@copiloto/shared';

/** Chaves usadas pelo seed das tarefas para ligar cada tarefa ao seu fluxo. */
export type ChaveFluxoExemplo = 'cadastro_cliente_tela' | 'agendar_visita' | 'segunda_via_boleto';

export function fluxosExemplo(): Record<ChaveFluxoExemplo, Omit<Fluxo, 'id' | 'tarefaId'>> | null {
  return null;
}

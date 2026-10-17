// Agente do copiloto: conversa com a pessoa, escolhe a tarefa, coleta e valida os dados,
// mostra o cartão de confirmação e responde dúvidas pela base de conhecimento.
import type { RodadaTestes, TarefaDefinicao } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';

export class Agente {
  constructor(protected readonly ctx: Contexto) {}

  /** Nova mensagem da pessoa: roda um turno do agente em segundo plano (respostas chegam por SSE). */
  async aoMensagem(_conversaId: string, _texto: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** Roda os casos de teste de uma tarefa (modo de teste: nada é gravado) e guarda a rodada. */
  async rodarTestes(_tarefaId: string, _opcoes: { usarRascunho: boolean }): Promise<RodadaTestes> {
    throw new Error('não implementado');
  }

  /** Ficha usada no teste: a do rascunho ou a publicada. */
  definicaoParaTeste(_tarefaId: string, _usarRascunho: boolean): TarefaDefinicao | null {
    throw new Error('não implementado');
  }
}

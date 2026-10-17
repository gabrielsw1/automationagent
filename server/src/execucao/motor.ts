// Motor de execução: cria execuções a partir do agente, espera o "confirmo" da pessoa,
// executa pela API do sistema (ou pelo navegador) e registra cada passo na linha do tempo.
import type { Contexto } from '../contexto.ts';

/** Quem fez a ação: a pessoa no widget, alguém da equipe no console ou o próprio sistema. */
export interface Ator {
  tipo: 'usuario' | 'membro' | 'sistema';
  id: string;
  nome: string;
}

export class Motor {
  constructor(protected readonly ctx: Contexto) {}

  /** A pessoa tocou "Confirmar e executar" no cartão. */
  async confirmar(_execucaoId: string, _usuarioId: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** A pessoa tocou "Corrigir": o cartão fica marcado e o agente pergunta o que mudar. */
  async corrigir(_execucaoId: string, _usuarioId: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** Cancela antes de executar (cartão) ou durante (navegador, entre passos). */
  async cancelar(_execucaoId: string, _por: Ator): Promise<void> {
    throw new Error('não implementado');
  }

  /** Desfaz pelo recibo (dentro da janela) ou pelo console (Admin, a qualquer momento). */
  async desfazer(_execucaoId: string, _por: Ator): Promise<void> {
    throw new Error('não implementado');
  }

  /** Tenta de novo uma execução que falhou. Devolve o id da nova execução. */
  async reexecutar(_execucaoId: string, _por: Ator): Promise<string> {
    throw new Error('não implementado');
  }

  /** Marca como concluída à mão (caso resolvido por uma pessoa fora do copiloto). */
  async concluirManual(_execucaoId: string, _por: Ator, _nota?: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** Conflito: "Atualizar o existente com os dados novos" (nova confirmação). */
  async atualizarExistente(_execucaoId: string, _usuarioId: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** Envia o pedido de aprovação ao aprovador (W7). */
  async enviarAprovacao(_aprovacaoId: string, _usuarioId: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** Aprovador decide (pelo console). Aprovado: executa em nome de quem pediu. */
  async decidirAprovacao(_aprovacaoId: string, _por: Ator, _aprovado: boolean, _motivo?: string): Promise<void> {
    throw new Error('não implementado');
  }
}

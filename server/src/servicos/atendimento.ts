// Passagem para uma pessoa (W8) e respostas da equipe de suporte pelo console.
import type { Contexto } from '../contexto.ts';
import type { MembroLogado } from '../auth/console.ts';

export class Atendimento {
  constructor(protected readonly ctx: Contexto) {}

  /** A pessoa pediu (ou o agente sugeriu) falar com alguém. Monta o resumo para o suporte. */
  async pedirPessoa(_conversaId: string, _motivo: string): Promise<void> {
    throw new Error('não implementado');
  }

  /** Alguém do suporte assume a conversa pelo console. */
  assumir(_conversaId: string, _membro: MembroLogado): void {
    throw new Error('não implementado');
  }

  /** Mensagem do suporte para a pessoa, no widget. */
  responder(_conversaId: string, _membro: MembroLogado, _texto: string): void {
    throw new Error('não implementado');
  }

  /** Encerra o atendimento e devolve a conversa ao copiloto. */
  encerrar(_conversaId: string, _membro: MembroLogado): void {
    throw new Error('não implementado');
  }

  /** "Avisar o usuário" no detalhe de uma execução. */
  avisarUsuario(_execucaoId: string, _membro: MembroLogado, _texto: string): void {
    throw new Error('não implementado');
  }
}

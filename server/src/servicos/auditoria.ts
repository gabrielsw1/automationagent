// Registro de auditoria: quem mudou o quê no console (C9 "Registro de auditoria").
import type { RegistroAuditoria } from '@copiloto/shared';
import { agoraIso, type Banco } from '../db/banco.ts';
import { novoId } from '../util/ids.ts';

export class Auditoria {
  constructor(private readonly banco: Banco) {}

  /** ator: nome de quem fez (ex.: "Rafael Lima" ou "Sistema"). acao: verbo no passado. alvo: o que mudou. */
  registrar(ator: string, acao: string, alvo: string, detalhe?: string | null) {
    this.banco.inserir('auditoria', { id: novoId('aud'), ts: agoraIso(), ator, acao, alvo, detalhe: detalhe ?? null });
  }

  listar(limite = 100, antesDe?: string): RegistroAuditoria[] {
    const linhas = antesDe
      ? this.banco.todos<RegistroAuditoria>(
          'SELECT id, ts, ator, acao, alvo, detalhe FROM auditoria WHERE ts < ? ORDER BY ts DESC LIMIT ?',
          antesDe,
          limite,
        )
      : this.banco.todos<RegistroAuditoria>(
          'SELECT id, ts, ator, acao, alvo, detalhe FROM auditoria ORDER BY ts DESC LIMIT ?',
          limite,
        );
    return linhas.map((l) => ({ ...l }));
  }
}

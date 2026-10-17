// Leitura dos fluxos gravados (tabela fluxos) para a ficha da tarefa. Quem grava e edita os
// fluxos é a área do navegador; aqui só lemos para mostrar "Fluxo gravado por ... com N passos".
import type { Fluxo } from '@copiloto/shared';
import { json, type Banco } from '../db/banco.ts';

interface LinhaFluxo {
  id: string;
  nome: string;
  tarefa_id: string | null;
  etapa: string;
  status: string;
  versao: number;
  passos: string;
  campos_sugeridos: string;
  gravado_por: string | null;
  gravado_em: string | null;
  duracao_gravacao_ms: number | null;
  url_inicial: string | null;
  ultimo_teste: string | null;
  salvo_em: string;
}

function fluxoDe(l: LinhaFluxo): Fluxo {
  return {
    id: l.id,
    nome: l.nome,
    tarefaId: l.tarefa_id,
    etapa: l.etapa as Fluxo['etapa'],
    status: l.status as Fluxo['status'],
    versao: l.versao,
    passos: json(l.passos, []),
    camposSugeridos: json(l.campos_sugeridos, []),
    gravadoPor: l.gravado_por,
    gravadoEm: l.gravado_em,
    duracaoGravacaoMs: l.duracao_gravacao_ms,
    urlInicial: l.url_inicial,
    ultimoTeste: json(l.ultimo_teste, null),
    salvoEm: l.salvo_em,
  };
}

export function lerFluxo(banco: Banco, id: string): Fluxo | null {
  const l = banco.um<LinhaFluxo>('SELECT * FROM fluxos WHERE id = ?', id);
  return l ? fluxoDe(l) : null;
}

/** Fluxo ligado à tarefa: o escolhido na ficha ou, sem escolha, o último gravado para ela. */
export function fluxoDaTarefa(banco: Banco, tarefaId: string, fluxoId: string | null | undefined): Fluxo | null {
  if (fluxoId) {
    const f = lerFluxo(banco, fluxoId);
    if (f) return f;
  }
  const l = banco.um<LinhaFluxo>(
    `SELECT * FROM fluxos WHERE tarefa_id = ? ORDER BY CASE status WHEN 'publicado' THEN 0 ELSE 1 END, salvo_em DESC LIMIT 1`,
    tarefaId,
  );
  return l ? fluxoDe(l) : null;
}

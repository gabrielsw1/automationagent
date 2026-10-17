// Catálogo de tarefas (C2): lista com números dos últimos 30 dias e "pedidos sem tarefa".
import type { ListaTarefas, PedidoSemTarefa, StatusTarefa, TarefaDefinicao, TarefaResumo } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import type { Banco } from '../db/banco.ts';
import { inicioDoDia } from '../servicos/gastos.ts';
import { diasAtras } from './tempo.ts';

/** Ficha que representa a tarefa no catálogo: a publicada ou, se ainda não houver, o rascunho. */
export function definicaoAtual(ctx: Contexto, tarefaId: string): TarefaDefinicao | null {
  return (ctx.catalogo.publicada(tarefaId) ?? ctx.catalogo.rascunho(tarefaId))?.definicao ?? null;
}

interface Numeros {
  execucoes: number;
  concluidas: number;
  falhas: number;
}

/** Execuções por tarefa desde uma data: total, concluídas (inclui desfeitas) e falhas. */
export function numerosPorTarefa(banco: Banco, desde: Date): Map<string, Numeros> {
  const linhas = banco.todos<{ tarefa_id: string; n: number; ok: number; falhas: number }>(
    `SELECT tarefa_id, COUNT(*) AS n,
            SUM(CASE WHEN status IN ('concluida', 'desfeita') THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN status = 'falhou' THEN 1 ELSE 0 END) AS falhas
     FROM execucoes
     WHERE tarefa_id IS NOT NULL AND criado_em >= ? AND status NOT IN ('aguardando_confirmacao', 'cancelada')
     GROUP BY tarefa_id`,
    desde.toISOString(),
  );
  return new Map(linhas.map((l) => [l.tarefa_id, { execucoes: l.n, concluidas: l.ok ?? 0, falhas: l.falhas ?? 0 }]));
}

export function taxaSucesso(concluidas: number, falhas: number): number | null {
  const base = concluidas + falhas;
  return base > 0 ? concluidas / base : null;
}

/** Pedidos que o copiloto não soube atender por falta de tarefa, agrupados por tema. */
export function pedidosSemTarefa(banco: Banco, desde: Date): PedidoSemTarefa[] {
  const linhas = banco.todos<{ tema: string; texto: string }>(
    `SELECT tema, texto FROM pedidos
     WHERE tipo = 'sem_tarefa' AND ignorado = 0 AND tema IS NOT NULL AND TRIM(tema) <> '' AND criado_em >= ?
     ORDER BY criado_em DESC`,
    desde.toISOString(),
  );
  const grupos = new Map<string, PedidoSemTarefa>();
  for (const l of linhas) {
    const tema = l.tema.trim();
    const g = grupos.get(tema) ?? { tema, quantidade: 0, exemplos: [] };
    g.quantidade++;
    const t = l.texto.trim();
    if (t && g.exemplos.length < 3 && !g.exemplos.includes(t)) g.exemplos.push(t);
    grupos.set(tema, g);
  }
  return [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade || a.tema.localeCompare(b.tema));
}

export function montarLista(ctx: Contexto, agora = new Date()): ListaTarefas {
  const { banco, catalogo } = ctx;
  const desde30 = diasAtras(agora, 29);
  const numeros = numerosPorTarefa(banco, desde30);
  const hoje = numerosPorTarefa(banco, inicioDoDia(agora));
  const tarefas: TarefaResumo[] = [];
  for (const t of catalogo.listar()) {
    const pub = catalogo.publicada(t.id);
    const rasc = catalogo.rascunho(t.id);
    const def = pub?.definicao ?? rasc?.definicao;
    if (!def) continue;
    const n = numeros.get(t.id);
    tarefas.push({
      id: t.id,
      slug: t.slug,
      nome: def.nome,
      descricao: def.descricao,
      caminho: def.caminho,
      status: t.status,
      versaoPublicada: t.versaoPublicada,
      temRascunho: !!rasc,
      execucoes30d: n?.execucoes ?? 0,
      sucesso30d: n ? taxaSucesso(n.concluidas, n.falhas) : null,
      falhasHoje: hoje.get(t.id)?.falhas ?? 0,
      atualizadoEm: t.atualizadoEm,
      atualizadoPor: t.atualizadoPor,
      liberadaPara: def.liberadaPara?.length ?? 0,
    });
  }
  const ordem: Record<StatusTarefa, number> = { ativa: 0, teste: 1, rascunho: 2, inativa: 3 };
  tarefas.sort((a, b) => ordem[a.status] - ordem[b.status] || b.execucoes30d - a.execucoes30d || a.nome.localeCompare(b.nome));
  const contagem: ListaTarefas['contagem'] = { todas: tarefas.length, ativa: 0, teste: 0, rascunho: 0, inativa: 0 };
  for (const t of tarefas) contagem[t.status]++;
  return { tarefas, contagem, semTarefa: pedidosSemTarefa(banco, desde30) };
}

// Lista de execuções do console (C5): filtros, contagens das abas, paginação e CSV.
import { z } from 'zod';
import { fmt, type ExecucaoLinha, type ListaExecucoes, type StatusExecucao } from '@copiloto/shared';
import type { Contexto } from '../../../contexto.ts';
import type { Banco, Valor } from '../../../db/banco.ts';
import { inicioDoDia, inicioDoMes } from '../../../servicos/gastos.ts';
import { pedidoInvalido } from '../../../util/erros.ts';

export const POR_PAGINA = 10;

export const STATUS: StatusExecucao[] = [
  'aguardando_confirmacao',
  'aguardando_aprovacao',
  'em_andamento',
  'concluida',
  'falhou',
  'desfeita',
  'cancelada',
];

export const ROTULO_STATUS: Record<StatusExecucao, string> = {
  aguardando_confirmacao: 'Aguardando confirmação',
  aguardando_aprovacao: 'Aguardando aprovação',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  falhou: 'Falhou',
  desfeita: 'Desfeita',
  cancelada: 'Cancelada',
};

export const ROTULO_CANAL: Record<string, string> = { widget: 'Widget', teste: 'Teste' };

/** Status em que a execução já terminou (não precisa mais de ninguém). */
export const STATUS_FINAIS: StatusExecucao[] = ['concluida', 'cancelada', 'desfeita'];

const vazioComoAusente = (v: unknown) => (v === '' || v === null ? undefined : v);

export const EsquemaFiltros = z.object({
  aba: z.preprocess(vazioComoAusente, z.enum(['todas', 'atencao', 'aprovacao']).default('todas')),
  status: z.preprocess(vazioComoAusente, z.enum(STATUS as [StatusExecucao, ...StatusExecucao[]]).optional()),
  canal: z.preprocess(vazioComoAusente, z.enum(['widget', 'teste']).optional()),
  tarefa: z.preprocess(vazioComoAusente, z.string().max(80).optional()),
  periodo: z.preprocess(vazioComoAusente, z.enum(['hoje', '7d', '30d', 'mes']).optional()),
  busca: z.preprocess(vazioComoAusente, z.string().trim().max(120).optional()),
  pagina: z.preprocess(vazioComoAusente, z.coerce.number().int().min(1).max(100_000).default(1)),
});

export type FiltrosExecucoes = z.infer<typeof EsquemaFiltros>;

export function lerFiltros(query: unknown): FiltrosExecucoes {
  const r = EsquemaFiltros.safeParse(query ?? {});
  if (!r.success) throw pedidoInvalido('Algum filtro está com um valor que não existe. Limpe os filtros e tente de novo.');
  return r.data;
}

/** Texto sem acento e em minúsculas, para a busca. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const registrados = new WeakSet<Banco>();

/** Registra no SQLite a função cb_norm (sem acento, minúsculas), usada na busca. */
export function prepararBanco(banco: Banco) {
  if (registrados.has(banco)) return;
  banco.db.function('cb_norm', { deterministic: true }, (v) => (typeof v === 'string' ? normalizar(v) : v));
  registrados.add(banco);
}

/** Condição "precisa de atenção": a mesma usada no contador do menu (resumo). */
export function condicaoAtencao(agora: Date): { sql: string; params: Valor[] } {
  return {
    sql: `((e.status = 'falhou' AND e.criado_em >= ?)
           OR (e.transferida_para IS NOT NULL AND e.status NOT IN ('concluida', 'cancelada', 'desfeita')))`,
    params: [inicioDoDia(agora).toISOString()],
  };
}

export const CONDICAO_APROVACAO =
  "EXISTS (SELECT 1 FROM aprovacoes a WHERE a.execucao_id = e.id AND a.estado = 'enviada')";

function inicioPeriodo(periodo: NonNullable<FiltrosExecucoes['periodo']>, agora: Date): Date {
  switch (periodo) {
    case 'hoje':
      return inicioDoDia(agora);
    case '7d':
      return new Date(agora.getTime() - 7 * 86400_000);
    case '30d':
      return new Date(agora.getTime() - 30 * 86400_000);
    case 'mes':
      return inicioDoMes(agora);
  }
}

/** WHERE com os filtros (sem a aba quando `semAba`). */
export function montarWhere(f: FiltrosExecucoes, agora: Date, semAba = false): { sql: string; params: Valor[] } {
  const partes: string[] = [];
  const params: Valor[] = [];
  if (!semAba && f.aba === 'atencao') {
    const c = condicaoAtencao(agora);
    partes.push(c.sql);
    params.push(...c.params);
  }
  if (!semAba && f.aba === 'aprovacao') partes.push(CONDICAO_APROVACAO);
  if (f.status) {
    partes.push('e.status = ?');
    params.push(f.status);
  }
  if (f.canal) {
    partes.push('e.canal = ?');
    params.push(f.canal);
  }
  if (f.tarefa) {
    partes.push('e.tarefa_id = ?');
    params.push(f.tarefa);
  }
  if (f.periodo) {
    partes.push('e.criado_em >= ?');
    params.push(inicioPeriodo(f.periodo, agora).toISOString());
  }
  if (f.busca) {
    const termo = `%${normalizar(f.busca).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    partes.push(
      `(cb_norm(e.id) LIKE ? ESCAPE '\\' OR cb_norm(e.pedido) LIKE ? ESCAPE '\\'
        OR cb_norm(e.usuario_nome) LIKE ? ESCAPE '\\' OR cb_norm(e.tarefa_nome) LIKE ? ESCAPE '\\')`,
    );
    params.push(termo, termo, termo, termo);
  }
  return { sql: partes.length ? `WHERE ${partes.join(' AND ')}` : '', params };
}

/** Linha da tabela execucoes. */
export interface LinhaExecucao {
  id: string;
  conversa_id: string | null;
  usuario_id: string;
  usuario_nome: string;
  tarefa_id: string | null;
  tarefa_nome: string;
  tarefa_versao: number | null;
  pedido: string;
  caminho: string | null;
  status: StatusExecucao;
  canal: string;
  dados: string;
  resultado: string | null;
  erro: string | null;
  diagnostico: string | null;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  duracao_ms: number | null;
  custo_modelo: number | null;
  custo_navegador: number | null;
  confirmado_por: string | null;
  confirmado_em: string | null;
  ip: string | null;
  desfazer_ate: string | null;
  transferida_para: string | null;
  transferida_em: string | null;
  exemplo: number;
}

/** Nomes da equipe por id (transferida_para pode guardar o id de quem recebeu). */
export function nomesEquipe(banco: Banco): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of banco.todos<{ id: string; nome: string | null; email: string }>('SELECT id, nome, email FROM equipe')) {
    m.set(l.id, l.nome ?? l.email);
  }
  return m;
}

/** Custo do modelo (R$) por execução, somado de uso_llm, para execuções sem custo_modelo gravado. */
export function custoModeloPorExecucao(ctx: Contexto, ids: string[] | null): Map<string, number> {
  const m = new Map<string, number>();
  if (ids && ids.length === 0) return m;
  const linhas = ids
    ? ctx.banco.todos<{ execucao_id: string; s: number }>(
        `SELECT execucao_id, SUM(custo_usd) AS s FROM uso_llm WHERE execucao_id IN (${ids.map(() => '?').join(', ')})
         GROUP BY execucao_id`,
        ...ids,
      )
    : ctx.banco.todos<{ execucao_id: string; s: number }>(
        'SELECT execucao_id, SUM(custo_usd) AS s FROM uso_llm WHERE execucao_id IS NOT NULL GROUP BY execucao_id',
      );
  for (const l of linhas) m.set(l.execucao_id, ctx.gastos.emReais(l.s ?? 0));
  return m;
}

export function custoModeloDe(r: LinhaExecucao, usoLlm: Map<string, number>): number | null {
  if (r.custo_modelo !== null && r.custo_modelo !== undefined) return r.custo_modelo;
  return usoLlm.has(r.id) ? usoLlm.get(r.id)! : null;
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

export function linhaDe(
  r: LinhaExecucao,
  agora: Date,
  membros: Map<string, string>,
  usoLlm: Map<string, number>,
): ExecucaoLinha {
  const modelo = custoModeloDe(r, usoLlm);
  const custo = modelo === null && r.custo_navegador === null ? null : arred((modelo ?? 0) + (r.custo_navegador ?? 0));
  let duracaoMs = r.duracao_ms;
  if (r.status === 'em_andamento') {
    duracaoMs = Math.max(0, agora.getTime() - Date.parse(r.iniciado_em ?? r.criado_em));
  } else if (duracaoMs === null && r.iniciado_em && r.concluido_em) {
    duracaoMs = Math.max(0, Date.parse(r.concluido_em) - Date.parse(r.iniciado_em));
  }
  return {
    id: r.id,
    inicio: r.criado_em,
    pedido: r.pedido,
    usuario: { id: r.usuario_id, nome: r.usuario_nome, iniciais: fmt.iniciais(r.usuario_nome) },
    tarefa: { id: r.tarefa_id, nome: r.tarefa_nome },
    caminho: r.caminho === 'api' || r.caminho === 'navegador' ? r.caminho : null,
    status: r.status,
    transferidaPara: r.transferida_para ? (membros.get(r.transferida_para) ?? r.transferida_para) : null,
    canal: r.canal === 'teste' ? 'teste' : 'widget',
    duracaoMs,
    custo,
    exemplo: r.exemplo === 1,
  };
}

export function listar(ctx: Contexto, f: FiltrosExecucoes, agora = new Date()): ListaExecucoes {
  const { banco } = ctx;
  prepararBanco(banco);
  const where = montarWhere(f, agora);
  const total = banco.um<{ n: number }>(`SELECT COUNT(*) AS n FROM execucoes e ${where.sql}`, ...where.params)!.n;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(f.pagina, paginas);
  const linhas = banco.todos<LinhaExecucao>(
    `SELECT e.* FROM execucoes e ${where.sql} ORDER BY e.criado_em DESC, e.id DESC LIMIT ? OFFSET ?`,
    ...where.params,
    POR_PAGINA,
    (pagina - 1) * POR_PAGINA,
  );
  const membros = nomesEquipe(banco);
  const uso = custoModeloPorExecucao(
    ctx,
    linhas.filter((l) => l.custo_modelo === null).map((l) => l.id),
  );
  const atencao = condicaoAtencao(agora);
  return {
    linhas: linhas.map((l) => linhaDe(l, agora, membros, uso)),
    total,
    pagina,
    paginas,
    totalGeral: banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM execucoes')!.n,
    contagem: {
      todas: banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM execucoes')!.n,
      atencao: banco.um<{ n: number }>(`SELECT COUNT(*) AS n FROM execucoes e WHERE ${atencao.sql}`, ...atencao.params)!.n,
      aprovacao: banco.um<{ n: number }>(`SELECT COUNT(*) AS n FROM execucoes e WHERE ${CONDICAO_APROVACAO}`)!.n,
    },
  };
}

/** Tarefas que aparecem no filtro: as do catálogo e as que já têm execuções. */
export function tarefasDoFiltro(ctx: Contexto): { id: string; nome: string }[] {
  const mapa = new Map<string, string>();
  for (const t of ctx.catalogo.listar()) {
    const v = ctx.catalogo.publicada(t.id) ?? ctx.catalogo.rascunho(t.id);
    if (v) mapa.set(t.id, v.definicao.nome);
  }
  for (const l of ctx.banco.todos<{ tarefa_id: string; tarefa_nome: string }>(
    `SELECT tarefa_id, tarefa_nome FROM execucoes WHERE tarefa_id IS NOT NULL
     GROUP BY tarefa_id ORDER BY MAX(criado_em) DESC`,
  )) {
    if (!mapa.has(l.tarefa_id)) mapa.set(l.tarefa_id, l.tarefa_nome);
  }
  return [...mapa.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---------- CSV ----------

function celula(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function decimal(v: number | null, casas = 2): string {
  if (v === null) return '';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false });
}

/** CSV com os mesmos filtros da lista (todas as páginas), separado por ponto e vírgula, UTF-8 com BOM. */
export function csv(ctx: Contexto, f: FiltrosExecucoes, agora = new Date()): string {
  const { banco } = ctx;
  prepararBanco(banco);
  const where = montarWhere(f, agora);
  const linhas = banco.todos<LinhaExecucao>(
    `SELECT e.* FROM execucoes e ${where.sql} ORDER BY e.criado_em DESC, e.id DESC`,
    ...where.params,
  );
  const membros = nomesEquipe(banco);
  const uso = custoModeloPorExecucao(ctx, null);
  const cabecalho = [
    'ID',
    'Data',
    'Hora',
    'Pedido',
    'Usuário',
    'ID do usuário',
    'Tarefa',
    'Caminho',
    'Status',
    'Transferida para',
    'Canal',
    'Duração (s)',
    'Custo (R$)',
    'Dados de exemplo',
  ];
  const corpo = linhas.map((r) => {
    const l = linhaDe(r, agora, membros, uso);
    return [
      l.id,
      fmt.data(l.inicio),
      fmt.horaSegundos(l.inicio),
      l.pedido,
      l.usuario.nome,
      l.usuario.id,
      l.tarefa.nome,
      l.caminho === 'api' ? 'API' : l.caminho === 'navegador' ? 'Navegador' : '',
      ROTULO_STATUS[l.status] ?? l.status,
      l.transferidaPara,
      ROTULO_CANAL[l.canal] ?? l.canal,
      l.duracaoMs === null ? '' : decimal(l.duracaoMs / 1000, 1),
      decimal(l.custo),
      l.exemplo ? 'Sim' : 'Não',
    ]
      .map(celula)
      .join(';');
  });
  return '﻿' + [cabecalho.map(celula).join(';'), ...corpo].join('\r\n') + '\r\n';
}

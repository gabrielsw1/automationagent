// Ficha da tarefa (C3) montada para o console: versão publicada, rascunho, testes, histórico.
import type { RodadaTestes, TarefaDetalhe, VersaoTarefa } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import { json } from '../db/banco.ts';
import { ErroHttp } from '../util/erros.ts';
import { contarAlteracoes } from './definicao.ts';
import { fluxoDaTarefa } from './fluxos.ts';

export const tarefaNaoEncontrada = () => new ErroHttp(404, 'nao_encontrado', 'Tarefa não encontrada.');

const cachePerfis = new WeakMap<object, { em: number; lista: string[] }>();

/** Perfis do sistema anfitrião (guardados por 1 min). Sem conexão, o último conhecido ou lista vazia. */
export async function perfisDoSistema(ctx: Contexto): Promise<string[]> {
  const guardado = cachePerfis.get(ctx.adaptador);
  if (guardado && Date.now() - guardado.em < 60_000) return guardado.lista;
  try {
    const lista = await ctx.adaptador.listarPerfis();
    cachePerfis.set(ctx.adaptador, { em: Date.now(), lista });
    return lista;
  } catch {
    return guardado?.lista ?? [];
  }
}

export function ultimaRodada(ctx: Contexto, tarefaId: string): RodadaTestes | null {
  const l = ctx.banco.um<{
    id: string;
    tarefa_id: string;
    versao: number;
    aprovados: number;
    total: number;
    resultados: string;
    criado_em: string;
  }>('SELECT * FROM testes_rodadas WHERE tarefa_id = ? ORDER BY criado_em DESC LIMIT 1', tarefaId);
  if (!l) return null;
  return {
    id: l.id,
    tarefaId: l.tarefa_id,
    versao: l.versao,
    aprovados: l.aprovados,
    total: l.total,
    resultados: json(l.resultados, []),
    criadoEm: l.criado_em,
  };
}

export async function montarDetalhe(ctx: Contexto, tarefaId: string): Promise<TarefaDetalhe> {
  const { catalogo, banco } = ctx;
  const t = catalogo.obter(tarefaId);
  if (!t) throw tarefaNaoEncontrada();
  const pub = catalogo.publicada(tarefaId);
  const rasc = catalogo.rascunho(tarefaId);
  const def = rasc?.definicao ?? pub?.definicao ?? null;
  const historico: VersaoTarefa[] = catalogo.versoes(tarefaId).map((v) => ({
    versao: v.versao,
    status: v.status,
    publicadoPor: v.publicadoPor,
    publicadoEm: v.publicadoEm,
    resumoMudancas: v.resumoMudancas,
  }));
  return {
    id: t.id,
    slug: t.slug,
    status: t.status,
    publicada: pub
      ? { versao: pub.versao, definicao: pub.definicao, publicadoPor: pub.publicadoPor, publicadoEm: pub.publicadoEm }
      : null,
    rascunho: rasc
      ? {
          versao: rasc.versao,
          definicao: rasc.definicao,
          alteracoes: contarAlteracoes(pub?.definicao ?? null, rasc.definicao),
          salvoEm: rasc.salvoEm,
        }
      : null,
    testes: catalogo.testes(tarefaId),
    ultimaRodada: ultimaRodada(ctx, tarefaId),
    historico,
    fluxo: fluxoDaTarefa(banco, tarefaId, def?.fluxoId),
    perfisSistema: await perfisDoSistema(ctx),
  };
}

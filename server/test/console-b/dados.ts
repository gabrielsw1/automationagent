// Dados de teste do console-b: execuções, eventos, prints, aprovações e conversas inseridos direto no banco.
import type { Contexto } from '../../src/contexto.ts';

let seq = 20400;

export interface ExecucaoTeste {
  id?: string;
  conversa_id?: string | null;
  usuario_id?: string;
  usuario_nome?: string;
  tarefa_id?: string | null;
  tarefa_nome?: string;
  tarefa_versao?: number | null;
  pedido?: string;
  caminho?: 'api' | 'navegador' | null;
  status?: string;
  canal?: 'widget' | 'teste';
  dados?: unknown;
  erro?: string | null;
  diagnostico?: unknown;
  criado_em?: string;
  iniciado_em?: string | null;
  concluido_em?: string | null;
  duracao_ms?: number | null;
  custo_modelo?: number | null;
  custo_navegador?: number | null;
  confirmado_por?: string | null;
  confirmado_em?: string | null;
  ip?: string | null;
  desfazer_ate?: string | null;
  transferida_para?: string | null;
  transferida_em?: string | null;
  exemplo?: number;
}

export function criarExecucao(ctx: Contexto, e: ExecucaoTeste = {}): string {
  const id = e.id ?? `EX-${++seq}`;
  const criado = e.criado_em ?? new Date().toISOString();
  ctx.banco.inserir('execucoes', {
    id,
    conversa_id: e.conversa_id ?? null,
    usuario_id: e.usuario_id ?? '101',
    usuario_nome: e.usuario_nome ?? 'Ana Ribeiro',
    tarefa_id: e.tarefa_id === undefined ? 'tar_cadastrar' : e.tarefa_id,
    tarefa_nome: e.tarefa_nome ?? 'Cadastrar cliente',
    tarefa_versao: e.tarefa_versao ?? null,
    pedido: e.pedido ?? 'cadastra o cliente ACME Logística',
    caminho: e.caminho === undefined ? 'api' : e.caminho,
    status: e.status ?? 'concluida',
    canal: e.canal ?? 'widget',
    dados: e.dados ?? {},
    erro: e.erro ?? null,
    diagnostico: e.diagnostico ?? null,
    criado_em: criado,
    iniciado_em: e.iniciado_em === undefined ? criado : e.iniciado_em,
    concluido_em: e.concluido_em ?? null,
    duracao_ms: e.duracao_ms === undefined ? 4000 : e.duracao_ms,
    custo_modelo: e.custo_modelo === undefined ? 0.4 : e.custo_modelo,
    custo_navegador: e.custo_navegador ?? null,
    confirmado_por: e.confirmado_por ?? null,
    confirmado_em: e.confirmado_em ?? null,
    ip: e.ip ?? null,
    desfazer_ate: e.desfazer_ate ?? null,
    transferida_para: e.transferida_para ?? null,
    transferida_em: e.transferida_em ?? null,
    exemplo: e.exemplo ?? 0,
  });
  return id;
}

export function criarEvento(
  ctx: Contexto,
  execucaoId: string,
  e: {
    ts: string;
    tipo: string;
    titulo: string;
    estado: string;
    detalhe?: string;
    dados?: unknown;
    print_id?: string;
    fim?: string;
    candidato?: { texto: string; confianca: number };
  },
) {
  const id = `ev_${Math.random().toString(36).slice(2, 10)}`;
  ctx.banco.inserir('execucao_eventos', {
    id,
    execucao_id: execucaoId,
    ts: e.ts,
    tipo: e.tipo,
    titulo: e.titulo,
    detalhe: e.detalhe ?? null,
    estado: e.estado,
    dados: e.dados === undefined ? null : e.dados,
    print_id: e.print_id ?? null,
    fim: e.fim ?? null,
    candidato: e.candidato ?? null,
  });
  return id;
}

export function criarPrint(ctx: Contexto, execucaoId: string, p: { id: string; legenda?: string; destaque?: unknown }) {
  ctx.banco.inserir('prints', {
    id: p.id,
    execucao_id: execucaoId,
    arquivo: `${p.id}.png`,
    legenda: p.legenda ?? null,
    destaque: p.destaque ?? null,
    mascarado: 1,
    criado_em: '2026-10-17T13:42:06.000Z',
  });
}

export function criarAprovacao(ctx: Contexto, execucaoId: string, estado = 'enviada'): string {
  const id = `apr_${Math.random().toString(36).slice(2, 10)}`;
  ctx.banco.inserir('aprovacoes', {
    id,
    execucao_id: execucaoId,
    solicitante_id: '101',
    solicitante_nome: 'Ana Ribeiro',
    aprovador_id: '105',
    aprovador_nome: 'Rafael Lima',
    perfil_necessario: 'Gestor financeiro',
    estado,
    criado_em: new Date().toISOString(),
  });
  return id;
}

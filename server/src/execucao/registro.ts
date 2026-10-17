// Leitura e gravação das execuções e da linha do tempo (tabelas execucoes e execucao_eventos).
import type { Caminho, EventoLinhaTempo, StatusExecucao } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import { novoId } from '../util/ids.ts';

export interface Diagnostico {
  titulo: string;
  detalhe: string;
  tom: 'erro' | 'aviso' | 'sucesso' | 'info';
}

/** Resultado guardado em execucoes.resultado. */
export interface ResultadoExecucao {
  titulo?: string;
  /** Identificador criado no sistema. Ex.: "4821". */
  id?: string;
  codigo?: string;
  link?: string;
  gerados?: Record<string, string>;
  arquivos?: { nome: string; tipo: string }[];
  /** Modo de teste: validado, nada gravado. */
  simulado?: boolean;
  /** Resposta da API (campos simples), usada nos títulos e no desfazer. */
  resposta?: Record<string, unknown>;
  /** Conflito: registro que já existia. */
  existente?: { titulo: string; codigo?: string };
}

/** Dados internos (execucoes.interno): nada disso aparece para as pessoas. */
export interface InternoExecucao {
  /** Conflito: atualizar este registro existente em vez de criar. */
  atualizarId?: string;
  /** Valores do registro existente, para mostrar o que muda. */
  existente?: Record<string, unknown>;
  /** Executa como outra pessoa (aprovador que deu permissão). */
  executarComo?: string;
  aprovacaoId?: string;
  /** Execução original quando esta é uma nova tentativa. */
  origem?: string;
  /** A API falhou e a execução seguiu pelo fluxo gravado. */
  reserva?: boolean;
}

export interface Execucao {
  id: string;
  conversaId: string | null;
  usuarioId: string;
  usuarioNome: string;
  tarefaId: string | null;
  tarefaNome: string;
  tarefaVersao: number | null;
  pedido: string;
  caminho: Caminho | null;
  status: StatusExecucao;
  canal: 'widget' | 'teste';
  dados: Record<string, string>;
  resultado: ResultadoExecucao | null;
  erro: string | null;
  diagnostico: Diagnostico | null;
  criadoEm: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  duracaoMs: number | null;
  custoModelo: number | null;
  custoNavegador: number | null;
  confirmadoPor: string | null;
  confirmadoEm: string | null;
  desfazerAte: string | null;
  transferidaPara: string | null;
  mensagemCartaoId: string | null;
  mensagemProgressoId: string | null;
  cancelar: boolean;
  exemplo: boolean;
  interno: InternoExecucao;
}

export function proximoIdExecucao(banco: Banco): string {
  return `EX-${banco.proximo('execucao', 20431)}`;
}

export function lerExecucao(banco: Banco, id: string): Execucao | null {
  const l = banco.um<Record<string, unknown>>('SELECT * FROM execucoes WHERE id = ?', id);
  return l ? converter(l) : null;
}

export function execucoesDaConversa(banco: Banco, conversaId: string): Execucao[] {
  return banco
    .todos<Record<string, unknown>>('SELECT * FROM execucoes WHERE conversa_id = ? ORDER BY criado_em', conversaId)
    .map(converter);
}

/** Altera colunas (nomes do banco). Objetos viram JSON. */
export function atualizarExecucao(banco: Banco, id: string, dados: Record<string, unknown>) {
  banco.atualizar('execucoes', id, dados);
}

export interface NovoEvento {
  tipo: EventoLinhaTempo['tipo'];
  titulo: string;
  detalhe?: string;
  estado: EventoLinhaTempo['estado'];
  dados?: { rotulo: string; valor: string }[];
  printId?: string;
  candidato?: { texto: string; confianca: number };
  /** ISO do fim (passos que levaram tempo). */
  fim?: string;
  /** ISO do início; padrão agora. */
  ts?: string;
}

export function registrarEvento(banco: Banco, execucaoId: string, e: NovoEvento): string {
  const id = novoId('ev');
  banco.inserir('execucao_eventos', {
    id,
    execucao_id: execucaoId,
    ts: e.ts ?? agoraIso(),
    tipo: e.tipo,
    titulo: e.titulo,
    detalhe: e.detalhe ?? null,
    estado: e.estado,
    dados: e.dados && e.dados.length ? e.dados : null,
    print_id: e.printId ?? null,
    fim: e.fim ?? null,
    candidato: e.candidato ?? null,
  });
  return id;
}

function converter(l: Record<string, unknown>): Execucao {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const t = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(l.id),
    conversaId: t(l.conversa_id),
    usuarioId: String(l.usuario_id),
    usuarioNome: String(l.usuario_nome),
    tarefaId: t(l.tarefa_id),
    tarefaNome: String(l.tarefa_nome),
    tarefaVersao: n(l.tarefa_versao),
    pedido: String(l.pedido),
    caminho: (t(l.caminho) as Caminho | null) ?? null,
    status: l.status as StatusExecucao,
    canal: l.canal as 'widget' | 'teste',
    dados: json<Record<string, string>>(l.dados, {}),
    resultado: json<ResultadoExecucao | null>(l.resultado, null),
    erro: t(l.erro),
    diagnostico: json<Diagnostico | null>(l.diagnostico, null),
    criadoEm: String(l.criado_em),
    iniciadoEm: t(l.iniciado_em),
    concluidoEm: t(l.concluido_em),
    duracaoMs: n(l.duracao_ms),
    custoModelo: n(l.custo_modelo),
    custoNavegador: n(l.custo_navegador),
    confirmadoPor: t(l.confirmado_por),
    confirmadoEm: t(l.confirmado_em),
    desfazerAte: t(l.desfazer_ate),
    transferidaPara: t(l.transferida_para),
    mensagemCartaoId: t(l.mensagem_cartao_id),
    mensagemProgressoId: t(l.mensagem_progresso_id),
    cancelar: Number(l.cancelar) === 1,
    exemplo: Number(l.exemplo) === 1,
    interno: json<InternoExecucao>(l.interno, {}),
  };
}

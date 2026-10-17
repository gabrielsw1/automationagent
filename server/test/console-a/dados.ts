// Dados de teste do console-a: ficha de exemplo e execuções/pedidos inseridos direto no banco.
import type { TarefaDefinicao } from '@copiloto/shared';
import type { Contexto } from '../../src/contexto.ts';
import type { Ambiente } from '../ajuda.ts';

export const FICHA_CLIENTE: TarefaDefinicao = {
  nome: 'Cadastrar cliente',
  descricao: 'Cria o cadastro de uma empresa nova no Horizonte.',
  quandoUsar: 'Use quando a pessoa quiser incluir uma empresa nova como cliente. Não use para alterar um cliente que já existe.',
  exemplos: ['cadastra o cliente ACME Logística', 'novo cliente'],
  campos: [
    { chave: 'nome_empresa', rotulo: 'Nome da empresa', tipo: 'texto', obrigatorio: true, pergunta: 'Qual é o nome da empresa?', minimo: 3 },
    { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', obrigatorio: true, pergunta: 'Qual é o CNPJ da empresa?', verificarExistente: true },
    { chave: 'email_cobranca', rotulo: 'E-mail de cobrança', tipo: 'email', obrigatorio: true, pergunta: 'Qual é o e-mail de cobrança?' },
    {
      chave: 'prazo_pagamento',
      rotulo: 'Prazo de pagamento',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Qual o prazo de pagamento: 15, 30, 45 ou 60 dias?',
      opcoes: ['15 dias', '30 dias', '45 dias', '60 dias'],
    },
    { chave: 'responsavel', rotulo: 'Responsável', tipo: 'pessoa', obrigatorio: false, pergunta: '', padrao: 'solicitante', perguntar: false },
  ],
  caminho: 'api',
  api: {
    metodo: 'POST',
    caminho: '/v1/clientes',
    mapeamento: [
      { campo: 'nome_empresa', destino: 'razao_social' },
      { campo: 'cnpj', destino: 'cnpj', transformacao: 'somente_digitos' },
      { campo: 'email_cobranca', destino: 'email_cobranca' },
      { campo: 'prazo_pagamento', destino: 'prazo_pagamento_dias', transformacao: 'numero' },
      { campo: 'responsavel', destino: 'responsavel_id', transformacao: 'id_usuario' },
    ],
    idRetorno: 'id',
  },
  fluxoId: null,
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 5,
  perfisPermitidos: ['Comercial', 'Financeiro', 'Administradores'],
  tituloRecibo: 'Cliente {nome_empresa} criado (#{id})',
  tituloConfirmacao: 'Confirme o cadastro',
  tituloProgresso: 'Cadastrando {nome_empresa}',
  proximosPassos: [],
  contextos: ['Clientes'],
  confiancaMinima: 0.85,
};

export async function pedir(a: Ambiente, cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return a.app.inject({ method, url: `/api/console${url}`, headers: { cookie }, payload: payload as object | undefined });
}

let seq = 51000;

export function execucao(
  ctx: Contexto,
  e: Partial<{
    tarefa_id: string | null;
    tarefa_nome: string;
    status: string;
    canal: string;
    caminho: string | null;
    criado_em: string;
    duracao_ms: number | null;
    custo_modelo: number | null;
    custo_navegador: number | null;
    usuario_id: string;
    usuario_nome: string;
    pedido: string;
    diagnostico: unknown;
    erro: string | null;
    transferida_para: string | null;
    exemplo: number;
  }> = {},
): string {
  const id = `EX-${++seq}`;
  const criado = e.criado_em ?? new Date().toISOString();
  ctx.banco.inserir('execucoes', {
    id,
    conversa_id: null,
    usuario_id: e.usuario_id ?? '101',
    usuario_nome: e.usuario_nome ?? 'Ana Ribeiro',
    tarefa_id: e.tarefa_id === undefined ? null : e.tarefa_id,
    tarefa_nome: e.tarefa_nome ?? 'Cadastrar cliente',
    tarefa_versao: null,
    pedido: e.pedido ?? 'cadastra o cliente ACME Logística',
    caminho: e.caminho === undefined ? 'api' : e.caminho,
    status: e.status ?? 'concluida',
    canal: e.canal ?? 'widget',
    dados: {},
    erro: e.erro ?? null,
    diagnostico: e.diagnostico ?? null,
    criado_em: criado,
    iniciado_em: criado,
    concluido_em: null,
    duracao_ms: e.duracao_ms === undefined ? 4000 : e.duracao_ms,
    custo_modelo: e.custo_modelo === undefined ? 0.4 : e.custo_modelo,
    custo_navegador: e.custo_navegador ?? null,
    confirmado_por: null,
    confirmado_em: null,
    ip: null,
    desfazer_ate: null,
    transferida_para: e.transferida_para ?? null,
    transferida_em: null,
    exemplo: e.exemplo ?? 0,
  });
  return id;
}

export function pedidoSemTarefa(ctx: Contexto, tema: string, texto: string, criadoEm = new Date().toISOString()) {
  ctx.banco.inserir('pedidos', {
    id: `ped_${++seq}`,
    conversa_id: null,
    usuario_id: '101',
    texto,
    tipo: 'sem_tarefa',
    tarefa_slug: null,
    tema,
    ignorado: 0,
    criado_em: criadoEm,
  });
}

export function auditorias(ctx: Contexto): { ator: string; acao: string; alvo: string; detalhe: string | null }[] {
  return ctx.banco.todos('SELECT ator, acao, alvo, detalhe FROM auditoria ORDER BY ts, rowid');
}

// Tipos do Horizonte. Os nomes dos campos seguem a API (snake_case), descrita em docs/arquitetura.md.

export type Perfil = 'Comercial' | 'Financeiro' | 'Atendimento' | 'Técnico' | 'Gestor financeiro' | 'Administradores';

export const PERFIS: Perfil[] = ['Comercial', 'Financeiro', 'Atendimento', 'Técnico', 'Gestor financeiro', 'Administradores'];

export type Plano = 'Básico' | 'Pro' | 'Premium';

export const PLANOS: Plano[] = ['Básico', 'Pro', 'Premium'];

export const PRECO_PLANO: Record<Plano, number> = { Básico: 189.9, Pro: 389.9, Premium: 749.9 };

export const PRAZOS = [15, 30, 45, 60] as const;

export const TECNICOS = ['Carlos Mendes', 'Fernanda Lopes', 'João Pereira'] as const;

export const PRIMEIRO_DISPONIVEL = 'Primeiro disponível';

export const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfis: Perfil[];
}

export interface Cliente {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string;
  email_cobranca: string;
  prazo_pagamento_dias: number;
  plano: Plano;
  responsavel_id: string;
  criado_em: string;
}

export interface AlteracaoPlano {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  plano_anterior: Plano;
  plano: Plano;
  a_partir_de: string;
  criado_em: string;
  criado_por: string;
  desfeita_em: string | null;
}

export interface SegundaVia {
  em: string;
  por: string;
  vencimento: string;
  valor: number;
}

export interface Boleto {
  numero: string;
  nosso_numero: string;
  pagador_nome: string;
  /** CPF ou CNPJ formatado. */
  pagador_doc: string;
  cliente_id: string | null;
  /** "10/2026". */
  competencia: string;
  descricao: string;
  emissao: string;
  vencimento: string;
  valor: number;
  pago_em: string | null;
  segundas_vias: SegundaVia[];
}

export interface Visita {
  id: string;
  protocolo: string;
  cliente_id: string;
  cliente_nome: string;
  data: string;
  horario: string;
  tecnico: string;
  observacoes: string;
  status: 'Agendada' | 'Concluída' | 'Cancelada';
  criado_em: string;
  criado_por: string;
}

export interface Chamado {
  id: string;
  numero: string;
  assunto: string;
  cliente_id: string | null;
  cliente_nome: string;
  prioridade: Prioridade;
  descricao: string;
  status: 'Aberto' | 'Em atendimento' | 'Resolvido';
  criado_em: string;
  criado_por: string;
}

export type AgruparPor = 'vendedor' | 'regiao' | 'produto';
export type FormatoRelatorio = 'pdf' | 'planilha';

export interface Relatorio {
  id: string;
  numero: number;
  periodo_inicio: string;
  periodo_fim: string;
  agrupar_por: AgruparPor;
  formato: FormatoRelatorio;
  linhas: number;
  total_vendas: number;
  criado_em: string;
  criado_por: string;
}

export interface EstadoDemo {
  api_instavel: boolean;
  tela_agendamento_v2: boolean;
}

export interface Estado {
  versao: number;
  /** Data (São Paulo) em que os dados de exemplo foram gerados. */
  gerado_em: string;
  clientes: Cliente[];
  alteracoes_plano: AlteracaoPlano[];
  boletos: Boleto[];
  visitas: Visita[];
  chamados: Chamado[];
  relatorios: Relatorio[];
  sequencias: { cliente: number; alteracao: number; visita: number; chamado: number; relatorio: number };
  demo: EstadoDemo;
}

export const VERSAO_ESTADO = 1;

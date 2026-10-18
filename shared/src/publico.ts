// Contratos das rotas públicas (/api/publico, sem sessão): o site do produto lê os planos e os
// textos jurídicos e manda os pedidos de "Agendar demonstração" e "Falar com vendas".
import type { FaixaUsuarios } from './console.ts';

// ---------- Planos (tabela planos do banco da plataforma) ----------

/** O botão do cartão: `cadastro` leva a /criar-conta; os outros abrem o pedido de contato. */
export type BotaoPlano = 'cadastro' | 'demonstracao' | 'vendas';

export const ROTULO_BOTAO_PLANO: Record<BotaoPlano, string> = {
  cadastro: 'Começar piloto',
  demonstracao: 'Agendar demonstração',
  vendas: 'Falar com vendas',
};

/** Valores em centavos de real. null: preço ainda não definido (o site mostra "Sob consulta"). */
export interface PrecosPlano {
  precoMensalCentavos: number | null;
  taxaImplantacaoCentavos: number | null;
  precoCreditoExtraCentavos: number | null;
}

export interface Plano extends PrecosPlano {
  id: string;
  nome: string;
  ordem: number;
  /** "Para validar com um grupo de clientes, com a Starta ao seu lado." */
  descricao: string;
  usuariosMin: number;
  /** null: sem limite ("Mais de 1.000 usuários"). */
  usuariosMax: number | null;
  /** Créditos por mês; null: sob medida. */
  creditosIncluidos: number | null;
  /** Créditos de um pacote avulso ("Comprar pacote" em Plano e créditos), ao preço do crédito extra. */
  pacoteCreditos: number;
  /** Linha abaixo do preço. "{implantacao}" vira a taxa de implantação. */
  notaPreco: string;
  /** Itens da lista que vêm depois de usuários, créditos e crédito extra. */
  destaques: string[];
  botao: BotaoPlano;
  atualizadoEm: string;
}

export interface PlanosPublicos {
  planos: Plano[];
  /** Algum preço do site ainda não foi definido: vale a nota "Faixas e créditos incluídos são de exemplo". */
  valoresDeExemplo: boolean;
  /** Cadastro de empresas novas aberto (COPILOTO_CADASTRO). Fechado, "Começar piloto" vira pedido de contato. */
  cadastroAberto: boolean;
}

/** Onde um preço não definido aparece sozinho (no lugar do valor do plano). */
export const SOB_CONSULTA = 'Sob consulta';

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const reaisComCentavos = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.990", "R$ 0,45"; null quando o preço não foi definido. */
export function precoEmReais(centavos: number | null): string | null {
  if (centavos === null) return null;
  const f = centavos % 100 === 0 ? reais : reaisComCentavos;
  return f.format(centavos / 100).replace(/ /g, ' ');
}

// ---------- Pedido de contato do site ----------

/** De qual botão do site veio o pedido. `piloto`: "Começar piloto" com o cadastro fechado. */
export type OrigemContato = 'demonstracao' | 'vendas' | 'piloto';
/** Origem de um pedido guardado: os botões do site e o "Mudar de plano" de Plano e créditos (Admin de uma empresa cliente). */
export type OrigemPedido = OrigemContato | 'mudanca_plano';

export const ROTULO_ORIGEM_CONTATO: Record<OrigemPedido, string> = {
  demonstracao: 'Agendar demonstração',
  vendas: 'Falar com vendas',
  piloto: 'Começar piloto',
  mudanca_plano: 'Mudar de plano',
};

/** POST /api/publico/contato → `{ ok: true }`. */
export interface ContatoPedido {
  nome: string;
  /** E-mail de trabalho: a equipe da Starta responde por ele. */
  email: string;
  empresa: string;
  telefone?: string;
  /** Quantos usuários o sistema tem (as mesmas faixas do cadastro). */
  faixa: FaixaUsuarios;
  mensagem?: string;
  origem: OrigemContato;
}

/** Pedido guardado no banco da plataforma (a área da Starta lista os mais novos primeiro). */
export interface ContatoRecebido {
  id: string;
  nome: string;
  email: string;
  empresa: string;
  telefone: string | null;
  /** null num pedido de mudança de plano de empresa que não informou a faixa no cadastro. */
  faixa: FaixaUsuarios | null;
  mensagem: string | null;
  origem: OrigemPedido;
  criadoEm: string;
  ip: string | null;
  /** Pedido de mudança de plano: a empresa cliente e o plano pedido. */
  empresaId?: string | null;
  planoId?: string | null;
}

// ---------- Textos jurídicos ----------

export type DocumentoLegal = 'termos' | 'privacidade' | 'contrato-lgpd';

export const TITULO_DOCUMENTO_LEGAL: Record<DocumentoLegal, string> = {
  termos: 'Termos de uso',
  privacidade: 'Privacidade',
  'contrato-lgpd': 'Contrato de tratamento de dados (LGPD)',
};

export const DOCUMENTOS_LEGAIS = Object.keys(TITULO_DOCUMENTO_LEGAL) as DocumentoLegal[];

/** GET /api/publico/textos/:documento */
export interface TextoLegal {
  documento: DocumentoLegal;
  titulo: string;
  /** Do cabeçalho do arquivo (`versao: 2026-10-17`) ou, sem ele, um hash curto do texto. */
  versao: string;
  /** minuta: o rascunho que vem com o produto (docs/legal); aprovado: o texto da pasta TEXTOS_LEGAIS_DIR. */
  fonte: 'minuta' | 'aprovado';
  markdown: string;
}

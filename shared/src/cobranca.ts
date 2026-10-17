// Plano e créditos (S5) e cobrança: o ciclo de créditos da empresa, para onde foram os créditos,
// as faturas (mensais e de pacotes) e a forma de pagamento. Rotas em /api/console/plano (só Admin;
// a Starta no modo suporte só vê) e, na Plataforma, /api/plataforma/empresas/:id/faturas.
import type { FaixaUsuarios } from './console.ts';
import type { Plano } from './publico.ts';

// ---------- Faturas ----------

/**
 * - `aberta`: fechada pelo copiloto, mas a cobrança ainda não saiu (o gateway não respondeu; tenta de novo a cada hora).
 * - `emitida`: cobrança enviada (pelo Asaas ou, sem ele, pela equipe Starta por e-mail), aguardando pagamento.
 * - `paga`, `vencida` e `cancelada` (cancelada também quando o pagamento foi estornado).
 */
export type StatusFatura = 'aberta' | 'emitida' | 'paga' | 'vencida' | 'cancelada';
/** `mensal`: assinatura do mês, taxa de implantação (na primeira) e créditos extras. `pacote`: créditos comprados. */
export type TipoFatura = 'mensal' | 'pacote';
/** `asaas`: cobrança pelo Asaas (ASAAS_API_KEY). `manual`: a equipe Starta cobra e marca como paga. */
export type GatewayFatura = 'asaas' | 'manual';
export type MetodoPagamento = 'boleto' | 'cartao';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-09" → "setembro de 2026". */
export function nomeCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return `${MESES[m - 1] ?? competencia} de ${a}`;
}

export const ROTULO_STATUS_FATURA: Record<StatusFatura, string> = {
  aberta: 'Aguardando cobrança',
  emitida: 'Aguardando pagamento',
  paga: 'Paga',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
};

/** Valores em centavos. null só em faturas de exemplo de um plano sem preço definido ("Sob consulta"). */
export interface ItemFatura {
  descricao: string;
  quantidade: number;
  unitarioCentavos: number | null;
  totalCentavos: number | null;
}

export interface Fatura {
  id: string;
  empresaId: string;
  /** "2026-09" nas mensais; null nos pacotes. */
  competencia: string | null;
  tipo: TipoFatura;
  itens: ItemFatura[];
  totalCentavos: number | null;
  status: StatusFatura;
  /** "2026-10-11" */
  vencimento: string | null;
  criadoEm: string;
  pagoEm: string | null;
  gateway: GatewayFatura;
  /** Página de pagamento do Asaas (boleto, Pix ou cartão). */
  urlPagamento: string | null;
  urlBoleto: string | null;
  urlNotaFiscal: string | null;
  /** Créditos que o pacote dá quando a fatura é paga. */
  creditos: number | null;
  /** Pacote comprado pela recarga automática. */
  automatica: boolean;
  /** Fatura de exemplo da empresa de demonstração. */
  exemplo: boolean;
}

/** Item da taxa de implantação (entra só na primeira fatura mensal). */
export const ITEM_IMPLANTACAO = 'Taxa de implantação';
/** Item dos créditos usados além dos incluídos e dos pacotes. */
export const ITEM_EXTRAS = 'Créditos extras';

/** "Assinatura Piloto + 180 créditos extras", "Taxa de implantação + assinatura Piloto", "Pacote de 1.000 créditos". */
export function resumoFatura(f: Pick<Fatura, 'tipo' | 'itens' | 'creditos'>): string {
  if (f.tipo === 'pacote') return `Pacote de ${(f.creditos ?? 0).toLocaleString('pt-BR')} créditos`;
  return f.itens
    .map((i, n) => {
      const texto = i.descricao === ITEM_EXTRAS ? `${i.quantidade.toLocaleString('pt-BR')} créditos extras` : i.descricao;
      return n === 0 ? texto : texto.charAt(0).toLowerCase() + texto.slice(1);
    })
    .join(' + ');
}

/** A fatura do mês corrente, calculada ao vivo (não fica no banco até o mês fechar). */
export interface FaturaAberta {
  competencia: string;
  itens: ItemFatura[];
  /** null quando falta algum preço do plano. */
  totalCentavos: number | null;
  /** Último dia do ciclo (ISO), para "fecha em 31/10". */
  fechaEm: string;
  /** Quando a fatura fechada aparece (primeiro dia do ciclo seguinte). */
  disponivelEm: string;
}

// ---------- Créditos do ciclo ----------

export interface CicloCreditos {
  /** Primeiro instante do ciclo e o primeiro do seguinte (ISO, mês do calendário em São Paulo). */
  inicio: string;
  fim: string;
  competencia: string;
  /** Do plano; null: sob medida (sem teto de créditos) ou sem plano. */
  incluidos: number | null;
  /** Créditos de pacotes pagos neste ciclo. */
  pacotes: number;
  usados: number;
  /** Créditos gastos pelo roteiro gravado e com conserto visual. */
  creditosRoteiro: number;
  creditosConserto: number;
  /** incluídos + pacotes − usados; null sem teto. Pode ficar negativo quando há créditos extras. */
  restantes: number | null;
  /** Créditos usados além dos incluídos e dos pacotes. */
  extras: number;
  /** extras × preço do crédito, em centavos; null sem preço. */
  valorExtrasCentavos: number | null;
  /** Créditos por dia no ciclo até agora; null sem uso. */
  porDia: number | null;
  /** No ritmo atual, quando os créditos acabam (ISO); null se não acabam neste ciclo. */
  acabaEm: string | null;
}

export interface UsoTarefa {
  tarefaId: string | null;
  nome: string;
  /** Execuções que gastaram crédito. */
  execucoes: number;
  /** Execuções pelo roteiro (1 crédito cada). */
  roteiro: number;
  /** Execuções com conserto visual (5 créditos cada). */
  conserto: number;
  creditos: number;
  /** Mais de CONSERTOS_PARA_QUEBRADO consertos no ciclo. */
  consertoFrequente: boolean;
}

/** A tarefa que mais gastou com conserto visual no ciclo. */
export interface DestaqueConserto {
  tarefaId: string;
  nome: string;
  /** Primeiro conserto no ciclo (ISO). */
  primeiroConserto: string;
  /** Execuções com conserto desde o primeiro, e todas as execuções da tarefa desde ele. */
  consertos: number;
  execucoes: number;
  creditosConserto: number;
  /** Fração de todos os créditos usados no ciclo (0 a 1). */
  fracaoCiclo: number;
  /** O que essas execuções teriam custado pelo roteiro (1 crédito cada). */
  creditosPeloRoteiro: number;
  /** A última execução com conserto, para "Ver a execução EX-20431". */
  execucaoId: string;
  /** Fluxo gravado da tarefa (o "Regravar o fluxo" abre o Aprender fluxo nele). */
  fluxoId: string | null;
}

export interface UsoCiclo {
  inicio: string;
  /** Até quando vão os números (agora, no ciclo atual; o fim, no anterior). */
  ate: string;
  competencia: string;
  tarefas: UsoTarefa[];
  total: { execucoes: number; roteiro: number; conserto: number; creditos: number };
  destaque: DestaqueConserto | null;
}

// ---------- Cobrança ----------

export interface CartaoGuardado {
  bandeira: string | null;
  /** Últimos 4 dígitos. */
  final: string;
  /** "08/28" quando o gateway informa (o Asaas não informa a validade de cartões salvos). */
  validade: string | null;
}

export interface DadosCobranca {
  razaoSocial: string | null;
  cnpj: string | null;
  emailCobranca: string | null;
  cep: string | null;
  numero: string | null;
  metodo: MetodoPagamento;
  cartao: CartaoGuardado | null;
}

export interface DadosCobrancaPedido {
  razaoSocial: string;
  cnpj: string;
  emailCobranca: string;
  cep?: string;
  numero?: string;
  metodo: MetodoPagamento;
}

export interface RecargaAutomatica {
  ligada: boolean;
  /** Compra um pacote quando restarem menos que isso. */
  limite: number | null;
}

export interface PedidoMudancaPlano {
  planoId: string | null;
  planoNome: string | null;
  em: string;
}

export interface PlanoECreditos {
  empresa: { nome: string; cnpj: string | null; demo: boolean; faixaUsuarios: FaixaUsuarios | null };
  /** Empresa de demonstração: números de exemplo, sem compras nem cobrança. */
  exemplo: boolean;
  plano: Plano | null;
  /** Situação da empresa com a Starta: implantação, piloto, ativo ou pausado. */
  situacao: 'implantacao' | 'piloto' | 'ativo' | 'pausado';
  /** Pessoas que usaram o assistente neste mês (conversas ou execuções). */
  usuariosMes: number;
  /** Primeiro dia do próximo ciclo (ISO). */
  renovaEm: string;
  ciclo: CicloCreditos;
  uso: { atual: UsoCiclo; anterior: UsoCiclo };
  faturaAberta: FaturaAberta | null;
  faturas: Fatura[];
  cobranca: DadosCobranca;
  recarga: RecargaAutomatica;
  pacote: {
    creditos: number;
    /** Preço do pacote (créditos × preço do crédito); null sem preço do crédito. */
    precoCentavos: number | null;
    /** Pacote comprado e ainda não pago. */
    pendente: Fatura | null;
  };
  /**
   * `asaas`: cobrança pelo Asaas; `manual`: a equipe Starta envia a cobrança por e-mail.
   * `cartaoGuardado`: há um cartão salvo no Asaas para a recarga automática.
   */
  pagamentos: { modo: GatewayFatura; notaFiscal: boolean; cartaoGuardado: boolean };
  /** Limite mensal de Equipe e limites, em R$ (os créditos extras param nele). */
  limiteMensal: number;
  pedidoMudanca: PedidoMudancaPlano | null;
  planos: Plano[];
  /** Admin da empresa fora do modo suporte e fora da demonstração. */
  podeAlterar: boolean;
  /** Por que não dá para comprar ou mudar (modo suporte, demonstração). */
  motivoSomenteLeitura: string | null;
}

/** POST /plano/pacotes */
export interface PacoteComprado {
  fatura: Fatura;
  /** O que acontece agora, para mostrar à pessoa. */
  mensagem: string;
}

// ---------- Plataforma: faturas de uma empresa ----------

export interface FaturasEmpresaStarta {
  faturas: Fatura[];
  pagamentos: { modo: GatewayFatura; notaFiscal: boolean };
  /** Faturas do mês anterior que não saíram porque falta um preço ("preço não definido"). */
  pendencias: string[];
}

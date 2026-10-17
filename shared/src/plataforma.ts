// Plataforma Starta: a área da equipe que vende e acompanha o copiloto (A7 e S7). Métricas por
// empresa, nunca o conteúdo das conversas; o conteúdo só com "Entrar como suporte".
import type { ConectorSistema, FaixaUsuarios, ModoAcesso } from './console.ts';

// ---------- Créditos ----------

/** Tarefa concluída pelo roteiro gravado. */
export const CREDITOS_POR_ROTEIRO = 1;
/** Tarefa em que o agente visual consertou algum passo (a tela mudou). */
export const CREDITOS_COM_CONSERTO = 5;

/** Créditos de uma execução concluída. Testes (simulados) não gastam. */
export function creditosDaExecucao(r: { simulado: boolean; recuperacoes?: number }): number {
  if (r.simulado) return 0;
  return (r.recuperacoes ?? 0) > 0 ? CREDITOS_COM_CONSERTO : CREDITOS_POR_ROTEIRO;
}

/** Fluxo "quebrado": o roteiro falhou e o agente visual consertou mais que isso em 30 dias. */
export const CONSERTOS_PARA_QUEBRADO = 10;

// ---------- Equipe Starta e entrada (A7) ----------

export interface PessoaStartaResumo {
  id: string;
  nome: string;
  email: string;
  iniciais: string;
}

/** Quem está na Plataforma. */
export interface EuStarta extends PessoaStartaResumo {
  /** Códigos de recuperação que ainda funcionam (a tela sugere gerar novos quando acabam). */
  codigosRecuperacao: number;
}

/** Resposta de "Continuar" (etapa 1): falta o código, ou o aparelho é confiável e já entrou. */
export type EntradaStarta =
  | { etapa: 'codigo'; pessoa: { nome: string; iniciais: string } }
  | { etapa: 'completa'; eu: EuStarta };

/** Link de ativação aberto: QR code para o aplicativo autenticador. */
export interface AtivacaoStarta {
  nome: string;
  email: string;
  /** Segredo em base32, para digitar no aplicativo se a câmera não ler o QR code. */
  segredo: string;
  uri: string;
  qrSvg: string;
  expiraEm: string;
}

/** Ativação concluída: a pessoa entra e vê os códigos de recuperação uma vez só. */
export interface AtivacaoConcluida {
  eu: EuStarta;
  codigosRecuperacao: string[];
}

export interface MembroStarta extends PessoaStartaResumo {
  ativa: boolean;
  /** Já criou senha e ligou o autenticador. */
  ativada: boolean;
  ultimoAcesso: string | null;
  criadoEm: string;
  /** Empresas pelas quais é responsável. */
  empresas: number;
}

/** Convite ou "Redefinir acesso": o link vai por e-mail e aparece aqui uma vez. */
export interface LinkAtivacao {
  membro: MembroStarta;
  link: string;
  expiraEm: string;
  envio: 'smtp' | 'caixa_local';
}

// ---------- Empresas clientes (S7) ----------

/** Fase combinada com a Starta. A pausa é a empresa suspensa. */
export type FaseEmpresa = 'implantacao' | 'piloto' | 'ativo';
/** O que a lista mostra em "Status". */
export type SituacaoEmpresa = FaseEmpresa | 'pausado';

export const ROTULO_SITUACAO: Record<SituacaoEmpresa, string> = {
  implantacao: 'Implantação',
  piloto: 'Piloto',
  ativo: 'Ativo',
  pausado: 'Pausado',
};

export interface LinhaEmpresaStarta {
  id: string;
  nome: string;
  iniciais: string;
  /** Só dígitos; a busca da lista também acha por CNPJ. */
  cnpj: string | null;
  demo: boolean;
  situacao: SituacaoEmpresa;
  fase: FaseEmpresa;
  faseDesde: string | null;
  suspensaEm: string | null;
  plano: { id: string; nome: string } | null;
  /** Pessoas do sistema que usaram o assistente nos últimos 30 dias. */
  usuarios: number;
  tarefasAtivas: number;
  tarefasEmTeste: number;
  tarefasPausadas: number;
  execucoes30d: number;
  /** Concluídas sobre terminadas (concluídas + falhas), de 0 a 1; null sem execuções. */
  sucesso30d: number | null;
  creditos30d: number;
  /** Tarefas com mais de 10 consertos visuais em 30 dias. */
  fluxosQuebrados: number;
  responsavel: PessoaStartaResumo | null;
}

export interface ResumoPlataforma {
  ativas: number;
  emImplantacao: number;
  pausadas: number;
  emPiloto: { total: number; nomes: string[] };
  /** Execuções em 30 dias, somando as empresas ativas. */
  execucoes30d: number;
  /** Preço do crédito menos o custo médio de navegador e IA por crédito, em R$; null sem preço definido ou sem uso. */
  margemPorCredito: number | null;
  /** Até quando vão os números ("até 17/10/2026"). */
  ate: string;
}

export interface PainelEmpresas {
  resumo: ResumoPlataforma;
  empresas: LinhaEmpresaStarta[];
}

export type ChaveImplantacao = 'contrato' | 'sistema' | 'marca' | 'tarefas' | 'avaliacao';

export interface EtapaImplantacao {
  chave: ChaveImplantacao;
  titulo: string;
  feita: boolean;
  /** Quando ficou pronta (ou a data marcada, na avaliação). */
  quando: string | null;
  detalhe: string | null;
}

export interface FluxoComConserto {
  tarefaId: string;
  nome: string;
  consertos30d: number;
  quebrado: boolean;
  /** Último conserto, para "a tela mudou em 12/10". */
  ultimoConserto: string | null;
  /** O que mudou, pelo último conserto ("o botão mudou de nome"). */
  detalhe: string | null;
}

export interface AcessoSuporteResumo {
  id: string;
  pessoa: string;
  empresaId: string;
  empresa: string;
  motivo: string;
  inicio: string;
  expiraEm: string;
  encerradoEm: string | null;
}

export interface DetalheEmpresaStarta extends LinhaEmpresaStarta {
  dominio: string | null;
  faixaUsuarios: FaixaUsuarios | null;
  /** Limite de usuários do plano ("180 de 200"); null sem plano ou sem limite. */
  limiteUsuarios: number | null;
  acesso: ModoAcesso;
  /** Como o copiloto fala com o sistema: pela API (sem login de pessoa) ou pela tela. */
  conector: ConectorSistema;
  adminEmpresa: { nome: string; email: string } | null;
  criadoEm: string;
  metaTarefas: number | null;
  avaliacaoPilotoEm: string | null;
  implantacao: EtapaImplantacao[];
  fluxosComConserto: FluxoComConserto[];
  acessosSuporte: AcessoSuporteResumo[];
}

/** "Nova empresa": a Starta cria o espaço e convida o primeiro Admin da empresa. */
export interface NovaEmpresaStarta {
  empresa: DetalheEmpresaStarta;
  linkConvite: string;
  envio: 'smtp' | 'caixa_local';
}

/** "Entrar como suporte": abre o console da empresa em outra aba, com o cookie de suporte. */
export interface SuporteAberto {
  acesso: AcessoSuporteResumo;
  /** Endereço do console para abrir (o cookie já foi definido). */
  url: string;
}

/** Faixa do modo suporte no console da empresa. */
export interface ModoSuporte {
  pessoa: string;
  motivo: string;
  ate: string;
}

// ---------- Uso e custos, saúde dos fluxos ----------

export interface UsoEmpresa {
  empresaId: string;
  nome: string;
  demo: boolean;
  execucoes: number;
  creditos: number;
  creditosRoteiro: number;
  creditosConserto: number;
  /** R$ gastos com o Claude (tokens) e com o navegador na nuvem. */
  custoIa: number;
  custoNavegador: number;
  /** Créditos x preço do crédito do plano da empresa, em R$; null sem plano com preço. */
  receitaCreditos: number | null;
}

export interface UsoPlataforma {
  desde: string;
  ate: string;
  empresas: UsoEmpresa[];
  total: Omit<UsoEmpresa, 'empresaId' | 'nome' | 'demo'>;
}

export interface SaudeFluxo extends FluxoComConserto {
  empresaId: string;
  empresa: string;
  execucoes30d: number;
  falhas30d: number;
}

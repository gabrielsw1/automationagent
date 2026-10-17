// Contrato entre o console de administração e o servidor. Rotas em /api/console,
// autenticadas por cookie de sessão (POST /api/console/auth/entrar).
import type {
  CasoDeTeste,
  Fluxo,
  RodadaTestes,
  StatusTarefa,
  TarefaDefinicao,
} from './tarefas.ts';
import type { Caminho, StatusExecucao, WidgetConfigPublica } from './widget.ts';

export type PerfilEquipe = 'admin' | 'editor' | 'suporte' | 'leitor';

export const ROTULO_PERFIL: Record<PerfilEquipe, string> = {
  admin: 'Admin',
  editor: 'Editor de tarefas',
  suporte: 'Suporte',
  leitor: 'Leitor',
};

export interface MembroEquipe {
  id: string;
  nome: string | null;
  email: string;
  perfil: PerfilEquipe;
  status: 'ativo' | 'convidado';
  /** ISO */
  ultimoAcesso: string | null;
  conviteExpiraEm?: string | null;
  conviteEnviadoEm?: string | null;
}

export interface Eu {
  id: string;
  nome: string;
  email: string;
  perfil: PerfilEquipe;
  iniciais: string;
  /** Empresa aberta no console agora. Cada empresa cliente tem dados, equipe e widget próprios. */
  empresa: EmpresaResumo;
  /** Todas as empresas em que esta pessoa está na equipe (para trocar no menu da conta). */
  empresas: EmpresaResumo[];
}

// ---------- Empresas (SaaS: cada empresa cliente com o próprio espaço) ----------

export interface EmpresaResumo {
  id: string;
  nome: string;
  /** Empresa de demonstração (Horizonte), com dados de exemplo. */
  demo: boolean;
}

/**
 * Como o copiloto fala com o sistema da empresa:
 * - `tela`: só pelas telas, com fluxos gravados (padrão para empresas novas; o cliente não abre API).
 * - `api`: adaptador de API, como o do Horizonte (demonstração).
 */
export type ConectorSistema = 'tela' | 'api';

export interface SistemaEmpresa {
  nome: string;
  /** Endereço das telas do sistema (onde o widget é instalado e o navegador do copiloto entra). */
  url: string;
  conector: ConectorSistema;
  /** Como o navegador do copiloto entra no sistema para executar fluxos. */
  acesso: {
    /** `nenhum`: as telas abrem sem login. `conta`: entra com uma conta de serviço antes de cada fluxo. */
    modo: 'nenhum' | 'conta';
    urlLogin: string;
    usuario: string;
    /** A senha nunca volta para o console; só se ela já foi guardada. */
    temSenha: boolean;
  };
  /** Perfis de acesso do sistema, para "Quem pode executar". Também entram os vistos no widget. */
  perfis: string[];
  /** false na empresa de demonstração, que usa a API do Horizonte. */
  editavel: boolean;
}

export interface SistemaEmpresaPedido {
  nome: string;
  url: string;
  acesso: {
    modo: 'nenhum' | 'conta';
    urlLogin: string;
    usuario: string;
    /** Vazio mantém a senha guardada. */
    senha?: string;
  };
  perfis: string[];
}

/** Cadastro de uma empresa nova (tela "Criar conta da empresa"). */
export interface CadastroEmpresaPedido {
  empresa: { nome: string; sistemaNome: string; sistemaUrl: string };
  /** Quem cria. Dispensado quando já há sessão: a empresa nova fica com quem está logado. */
  pessoa?: { nome: string; email: string; senha: string };
}

export interface PrimeiroAcesso {
  /** Ninguém tem acesso ainda: a tela de entrada mostra o cadastro da primeira empresa. */
  precisaCriarAdmin: boolean;
  demo: boolean;
  /** Qualquer pessoa pode criar a conta de uma empresa nova (COPILOTO_CADASTRO). */
  cadastroAberto: boolean;
}

export interface ConviteAberto {
  email: string;
  perfil: PerfilEquipe;
  empresa: string;
  /** O e-mail já tem acesso a outra empresa: aceitar pede a senha atual, não uma nova. */
  contaExistente: boolean;
}

/** Segredo do widget (só Admin): assina o usuário no snippet. */
export interface SegredoWidget {
  segredo: string;
}

/** Contadores do menu lateral e faixas globais. */
export interface ResumoConsole {
  eu: Eu;
  execucoesAtencao: number;
  aprovacoesPendentes: number;
  guia: { feitos: number; total: number };
  modoSimulado: boolean;
  /** Faixa "Você usou 80% do limite". */
  alertaGasto: null | { usado: number; limite: number; percentual: number };
  nomeSistema: string;
}

// ---------- Painel (C1) ----------

export type Periodo = '7d' | '30d' | 'mes';

export interface Painel {
  periodo: Periodo;
  inicio: string;
  fim: string;
  atualizadoEm: string;
  temDadosDeExemplo: boolean;
  executadas: number;
  /** Variação contra o período anterior (0.12 = +12%). null sem base. */
  variacao: number | null;
  taxaSucesso: number | null;
  falhas: number;
  tempoMedioApiS: number | null;
  tempoMedioNavegadorS: number | null;
  gastoMes: number;
  limiteMes: number;
  previsaoMes: number;
  porDia: { dia: string; concluidas: number; falhas: number }[];
  atencao: ItemAtencao[];
  maisUsadas: {
    tarefaId: string;
    nome: string;
    caminho: Caminho;
    status: StatusTarefa;
    execucoes: number;
    sucesso: number | null;
    custoMedio: number | null;
  }[];
  porCanal: { canal: string; rotulo: string; total: number }[];
}

export interface ItemAtencao {
  tipo: 'falhas' | 'sem_tarefa' | 'aprovacao' | 'fonte_erro' | 'transferidas';
  titulo: string;
  detalhe: string;
  acao: { rotulo: string; destino: string };
  quantidade: number;
}

// ---------- Tarefas (C2, C3) ----------

export interface TarefaResumo {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  caminho: Caminho;
  status: StatusTarefa;
  versaoPublicada: number | null;
  temRascunho: boolean;
  execucoes30d: number;
  sucesso30d: number | null;
  falhasHoje: number;
  atualizadoEm: string;
  atualizadoPor: string | null;
  liberadaPara: number;
}

export interface PedidoSemTarefa {
  tema: string;
  quantidade: number;
  exemplos: string[];
}

export interface ListaTarefas {
  tarefas: TarefaResumo[];
  contagem: Record<'todas' | StatusTarefa, number>;
  semTarefa: PedidoSemTarefa[];
}

export interface VersaoTarefa {
  versao: number;
  status: 'publicada' | 'rascunho' | 'arquivada';
  publicadoPor: string | null;
  publicadoEm: string | null;
  resumoMudancas: string | null;
}

export interface TarefaDetalhe {
  id: string;
  slug: string;
  status: StatusTarefa;
  publicada: { versao: number; definicao: TarefaDefinicao; publicadoPor: string | null; publicadoEm: string | null } | null;
  rascunho: { versao: number; definicao: TarefaDefinicao; alteracoes: number; salvoEm: string } | null;
  testes: CasoDeTeste[];
  ultimaRodada: RodadaTestes | null;
  historico: VersaoTarefa[];
  fluxo: Fluxo | null;
  /** Perfis existentes no sistema, para "Quem pode executar". */
  perfisSistema: string[];
}

// ---------- Execuções (C5, C6) ----------

export interface ExecucaoLinha {
  id: string;
  /** ISO */
  inicio: string;
  pedido: string;
  usuario: { id: string; nome: string; iniciais: string };
  tarefa: { id: string | null; nome: string };
  caminho: Caminho | null;
  status: StatusExecucao;
  transferidaPara: string | null;
  canal: 'widget' | 'teste';
  duracaoMs: number | null;
  custo: number | null;
  exemplo: boolean;
}

export interface ListaExecucoes {
  linhas: ExecucaoLinha[];
  total: number;
  pagina: number;
  paginas: number;
  totalGeral: number;
  contagem: { todas: number; atencao: number; aprovacao: number };
}

export interface EventoLinhaTempo {
  id: string;
  ts: string;
  tipo: 'pedido' | 'confirmacao' | 'login' | 'passo' | 'falha' | 'recuperacao' | 'transferencia' | 'conclusao' | 'aviso' | 'desfeito' | 'api';
  titulo: string;
  detalhe?: string;
  estado: 'ok' | 'falhou' | 'info' | 'aviso';
  dados?: { rotulo: string; valor: string }[];
  print?: { id: string; legenda: string; url: string; destaque?: { x: number; y: number; w: number; h: number } };
  candidato?: { texto: string; confianca: number };
  fim?: string;
}

export interface ExecucaoDetalhe {
  linha: ExecucaoLinha;
  /** Frase de topo em linguagem de negócio. Ex.: "A tela de agendamento mudou e nada foi gravado." */
  diagnostico: null | { titulo: string; detalhe: string; tom: 'erro' | 'aviso' | 'sucesso' | 'info' };
  linhaTempo: EventoLinhaTempo[];
  tarefaVersao: number | null;
  custoModelo: number | null;
  custoNavegador: number | null;
  dados: { rotulo: string; valor: string }[];
  conversa: { id: string; autor: string; autorTipo: 'usuario' | 'copiloto' | 'pessoa' | 'sistema'; texto: string; ts: string }[];
  conversaId: string | null;
  estadoConversa: 'copiloto' | 'aguardando_pessoa' | 'pessoa';
  auditoria: { rotulo: string; valor: string }[];
  acoes: {
    reexecutar: boolean;
    concluir: boolean;
    avisar: boolean;
    atualizarFluxo: boolean;
    desfazer: boolean;
    responder: boolean;
  };
  fluxoId: string | null;
  aprovacao: null | { id: string; estado: 'enviada' | 'aprovada' | 'recusada' | 'cancelada'; aprovador: string | null };
}

// ---------- Conhecimento (C7) ----------

export interface FonteConhecimento {
  id: string;
  tipo: 'site' | 'arquivo' | 'video' | 'respostas';
  nome: string;
  origem: string;
  status: 'indexado' | 'indexando' | 'erro' | 'pausado';
  detalhe: string;
  erro: string | null;
  comoResolver: string | null;
  progresso: null | { feitos: number; total: number };
  trechos: number;
  enviadoPor: string | null;
  criadoEm: string;
  sincronizadoEm: string | null;
}

export interface PerguntaSemResposta {
  id: string;
  pergunta: string;
  causa: string;
  vezes: number;
  ultimaEm: string;
}

export interface RespostaTeste {
  texto: string;
  citacoes: { n: number; titulo: string; local?: string; url?: string }[];
  confianca: 'alta' | 'media' | 'baixa';
  duracaoMs: number;
}

// ---------- Canais (C8) ----------

export interface ConfigWidget extends WidgetConfigPublica {
  dominios: string[];
}

export interface Canais {
  publicada: ConfigWidget;
  rascunho: ConfigWidget;
  temAlteracoes: boolean;
  chavePublica: string;
  urlScript: string;
  instalacao: null | { origem: string; vistoEm: string };
  /**
   * `tela`: o snippet leva nome, e-mail e perfis da pessoa (assinados), porque o copiloto não
   * consulta usuários por API. `api`: só o ID, e o resto vem da API do sistema.
   */
  conector: ConectorSistema;
}

// ---------- Equipe, limites e segurança (C9) ----------

export interface Limites {
  mensal: number;
  porUsuarioDia: number;
  alerta80: boolean;
  aoAtingir: 'pausar_navegador' | 'pausar_tudo';
  usoMes: number;
  previsaoMes: number;
  renovaEm: string;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
}

export interface Seguranca {
  mascararPrints: boolean;
  retencaoPrintsDias: 30 | 90 | 180;
  retencaoConversasMeses: 3 | 6 | 12 | 24;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
}

export interface RegistroAuditoria {
  id: string;
  ts: string;
  ator: string;
  acao: string;
  alvo: string;
  detalhe: string | null;
}

// ---------- Guia de início (C0) ----------

export interface Guia {
  feitos: number;
  total: number;
  passos: {
    chave: 'sistema' | 'tarefa' | 'testes' | 'widget' | 'equipe';
    titulo: string;
    feito: boolean;
    resumo: string;
  }[];
  sistema: { conectado: boolean; url: string; nome: string };
}

// ---------- Sistema (usuários do sistema anfitrião, para pré-visualização e aprovações) ----------

export interface UsuarioSistema {
  id: string;
  nome: string;
  email: string;
  perfis: string[];
}

// ---------- Erros ----------

/** Corpo de erro padrão de todas as rotas. */
export interface ErroApi {
  erro: string;
  /** Mensagem em português, pronta para mostrar. */
  mensagem: string;
  /** Código de referência para o suporte. Ex.: "7F3A-21". */
  ref?: string;
}

// ---------- Permissões do console ----------

export type Permissao =
  /** Ver painel e execuções. */
  | 'ver'
  /** Reexecutar, concluir casos transferidos, responder conversas, aprovar pedidos. */
  | 'operar'
  /** Criar, testar e publicar tarefas, fluxos e conhecimento; configurar o widget. */
  | 'editar'
  /** Equipe, limites de gasto e segurança. */
  | 'administrar';

export const PERMISSOES: Record<PerfilEquipe, Permissao[]> = {
  admin: ['ver', 'operar', 'editar', 'administrar'],
  editor: ['ver', 'editar'],
  suporte: ['ver', 'operar'],
  leitor: ['ver'],
};

export function pode(perfil: PerfilEquipe, permissao: Permissao): boolean {
  return PERMISSOES[perfil].includes(permissao);
}

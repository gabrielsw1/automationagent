// Ficha de uma tarefa do catálogo: o que o copiloto pode fazer no sistema.
// Cada publicação gera uma versão imutável; o copiloto usa sempre a versão publicada
// (ou o rascunho, no modo de teste do console).

export type TipoCampo =
  | 'texto'
  | 'documento' // CPF ou CNPJ, valida dígitos verificadores
  | 'email'
  | 'telefone'
  | 'lista'
  | 'data'
  | 'hora'
  | 'numero'
  | 'moeda'
  | 'pessoa'; // usuário do sistema; padrão: quem pediu

export interface Campo {
  /** Chave técnica, em snake_case. Ex.: "email_cobranca". */
  chave: string;
  /** Rótulo mostrado ao usuário. Ex.: "E-mail de cobrança". */
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  /** Pergunta que o agente faz quando o dado falta. */
  pergunta: string;
  /** Opções aceitas quando tipo = "lista". */
  opcoes?: string[];
  /** Texto: mínimo de letras. Número/moeda: valor mínimo. */
  minimo?: number;
  maximo?: number;
  /** Valor padrão. "solicitante" preenche com quem pediu (tipo pessoa). */
  padrao?: string;
  /** false: o agente não pergunta; o valor aparece no cartão para a pessoa trocar. */
  perguntar?: boolean;
  /** Documento: conferir se já existe cadastro antes de gravar. */
  verificarExistente?: boolean;
  /** Dica curta mostrada no console. */
  ajuda?: string;
}

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Transformacao = 'nenhuma' | 'somente_digitos' | 'numero' | 'id_usuario' | 'data_iso';

export interface MapeamentoCampo {
  /** Chave do campo da tarefa. */
  campo: string;
  /** Nome do campo no corpo da chamada da API. Ex.: "razao_social". */
  destino: string;
  transformacao?: Transformacao;
}

/** Chamada auxiliar (GET) usada antes ou depois da gravação. Aceita {campo} e {id} no caminho. */
export interface ChamadaAuxiliar {
  caminho: string;
  /** Texto de negócio mostrado nas etapas. Ex.: "Verificando se o cliente já existe". */
  descricao: string;
  /** Detalhe quando passa. Ex.: "Nenhum cliente com este CNPJ". */
  detalheOk?: string;
}

export interface ExecucaoApi {
  metodo: MetodoHttp;
  /** Caminho no sistema. Aceita {campo} e {id}. Ex.: "/v1/clientes". */
  caminho: string;
  mapeamento: MapeamentoCampo[];
  /** Campo do retorno com o identificador criado. Ex.: "id". */
  idRetorno?: string;
  verificarAntes?: ChamadaAuxiliar;
  conferirDepois?: ChamadaAuxiliar;
  desfazer?: { metodo: MetodoHttp; caminho: string };
  /** Rótulo da etapa que grava. Ex.: "Criando o cadastro". */
  rotuloExecucao?: string;
  /** Caminho da tela do sistema para abrir o resultado. Ex.: "/clientes/{id}". */
  linkResultado?: string;
  /** Última vez que a chamada foi testada pelo console (ISO). */
  testadaEm?: string;
}

export interface TarefaDefinicao {
  nome: string;
  /** Uma linha para o catálogo. */
  descricao: string;
  /** Instrução para o agente: quando usar e quando não usar. */
  quandoUsar: string;
  /** Frases de exemplo, do jeito que a equipe escreve. */
  exemplos: string[];
  campos: Campo[];
  /** Caminho principal. API é mais rápida e não quebra quando a tela muda. */
  caminho: 'api' | 'navegador';
  api?: ExecucaoApi;
  /** Fluxo gravado usado quando caminho = navegador, ou como reserva da API. */
  fluxoId?: string | null;
  usarFluxoSeApiFalhar: boolean;
  /** Sempre true: nada grava sem o "confirmo" da pessoa. Campo travado. */
  confirmacao: true;
  /** Janela para desfazer pelo recibo: 0 (não permite), 2, 5 ou 15 minutos. */
  desfazerMinutos: 0 | 2 | 5 | 15;
  /** Perfis do sistema que podem executar. */
  perfisPermitidos: string[];
  /** Perfil que aprova quando quem pede não tem permissão. */
  perfilAprovador?: string;
  /** Título do recibo. Aceita {campo} e {id}. Ex.: "Cliente {nome_empresa} criado (#{id})". */
  tituloRecibo: string;
  /** Título do cartão de confirmação. Ex.: "Confirme o cadastro". */
  tituloConfirmacao: string;
  /** Título do progresso, no gerúndio. Aceita {campo}. Ex.: "Cadastrando {nome_empresa}". Padrão: o nome da tarefa. */
  tituloProgresso?: string;
  /** Próximos passos sugeridos depois do recibo. Aceita {campo}. */
  proximosPassos: string[];
  /** Páginas do sistema onde a tarefa é sugerida. Ex.: ["Clientes"]. */
  contextos: string[];
  /** Texto da sugestão proativa. Ex.: "Quer que eu cadastre um cliente para você?" */
  sugestaoProativa?: string;
  /** Confiança mínima (0 a 1) para a recuperação visual agir sozinha no navegador. */
  confiancaMinima: number;
  /** Tempo típico, mostrado no cartão. Ex.: "cerca de 5 s". */
  tempoEstimado?: string;
  /** Em teste: lista de usuários do sistema liberados. Vazia = todos com permissão. */
  liberadaPara?: string[];
}

export type StatusTarefa = 'ativa' | 'teste' | 'rascunho' | 'inativa';

export interface CasoDeTeste {
  id: string;
  frase: string;
  /** O que se espera do primeiro turno do agente. */
  esperado: {
    resultado: 'pergunta' | 'confirmacao' | 'recusa';
    /** Campo que o agente deve perguntar (resultado = pergunta). */
    campoPerguntado?: string;
    /** Valores esperados no cartão (resultado = confirmacao). */
    campos?: Record<string, string>;
  };
}

export interface ResultadoTeste {
  casoId: string;
  frase: string;
  aprovado: boolean;
  /** Resumo do que o agente fez. Ex.: "Perguntou o e-mail de cobrança." */
  obtido: string;
  /** O que deveria ter feito, quando reprovado. */
  esperado?: string;
}

export interface RodadaTestes {
  id: string;
  tarefaId: string;
  versao: number;
  aprovados: number;
  total: number;
  resultados: ResultadoTeste[];
  criadoEm: string;
}

// ---------- Fluxos gravados (navegador) ----------

export type TipoPasso = 'navegar' | 'clique' | 'preencher' | 'selecionar' | 'leitura' | 'download' | 'esperar';

export interface SeletorCandidato {
  /** Seletor no formato do Playwright. Ex.: 'input[name="doc_pagador"]', 'role=button[name="Gerar 2ª via"]'. */
  seletor: string;
  estabilidade: 'estavel' | 'fragil';
  /** Explicação leiga. Ex.: "usa o nome interno do campo, que quase nunca muda". */
  motivo: string;
}

export interface PassoFluxo {
  n: number;
  tipo: TipoPasso;
  /** Verbo simples para quem não é técnico. Ex.: "Preencher CPF/CNPJ". */
  titulo: string;
  /** Rótulo do campo ou texto do elemento na tela. */
  rotuloElemento?: string;
  /** URL (navegar) ou caminho relativo da página onde o passo acontece. */
  url?: string;
  seletores: SeletorCandidato[];
  /** Índice do seletor escolhido em `seletores`. */
  seletorEscolhido: number;
  /** Para preencher/selecionar: de onde vem o valor. */
  valor?:
    | { origem: 'campo'; campo: string }
    | { origem: 'fixo'; valor: string }
    | { origem: 'nao_preencher' };
  /** Formato do valor digitado na gravação (dígitos viram 9, letras viram a). O valor real não é guardado. */
  formatoGravado?: string;
  /** Para leitura: nome do dado gerado. Ex.: "numero_boleto". */
  gera?: string;
  /** Print (id) capturado no teste do fluxo. */
  printId?: string;
  /** Pendências mostradas no console. Ex.: "falta mapear". */
  pendencia?: string;
}

export type EtapaFluxo = 'gravar' | 'revisar' | 'mapear' | 'testar' | 'publicar';

/**
 * Onde a tela mostra o número do registro que o fluxo criou (Mapear campos). Depois do último passo,
 * o navegador lê o número desse elemento e o recibo mostra "Chamado #1287". Sem `seletor`, ele procura
 * no aviso de confirmação da tela; se não achar, o recibo sai sem número.
 */
export interface ResultadoFluxo {
  /** Elemento da tela depois de salvar, no formato dos seletores dos passos. Ex.: '[data-campo="numero_chamado"]'. */
  seletor?: string;
  /** Formato do número, como no gravador: 9 é um dígito e a é uma letra. Ex.: "CH-9999-9999". Vazio: o primeiro número do elemento. */
  formato?: string;
  /** Nome do registro, para o recibo ("Chamado #1287", "Abrir o chamado"). Vazio: vem do aviso da tela ou do nome do fluxo. */
  nome?: string;
}

/** Número do registro criado, lido da tela no fim do fluxo. */
export interface RegistroLido {
  /** Como a tela mostra, sem o "#". Ex.: "1287", "CH-2026-0153". O recibo mostra "#1287" quando é só número. */
  numero: string;
  /** Nome do registro, quando a tela ou a configuração disse. Ex.: "Chamado". */
  nome?: string;
  /** Artigo do nome ("o chamado", "a visita"), para "Abrir o chamado". */
  artigo?: 'o' | 'a';
  /** Link da tela para abrir o registro, quando o sistema mostra um. */
  url?: string;
  /** Texto onde o número foi achado (para o console mostrar). */
  texto: string;
  /** Seletor do elemento onde o número estava (para "Usar este lugar" no Mapear campos). */
  seletor?: string;
  /** configurado: pelo seletor do fluxo; aviso: procurado no aviso de confirmação. */
  origem: 'configurado' | 'aviso';
}

export interface Fluxo {
  id: string;
  nome: string;
  tarefaId: string | null;
  etapa: EtapaFluxo;
  status: 'gravando' | 'rascunho' | 'publicado';
  versao: number;
  passos: PassoFluxo[];
  /** Campos da tarefa sugeridos pelo aprendizado (quando a tarefa ainda não existe). */
  camposSugeridos: Campo[];
  gravadoPor: string | null;
  gravadoEm: string | null;
  duracaoGravacaoMs: number | null;
  urlInicial: string | null;
  /** Onde ler o número do registro criado. null: procura no aviso de confirmação. */
  resultado?: ResultadoFluxo | null;
  ultimoTeste?: {
    em: string;
    ok: boolean;
    passoFalhou?: number;
    erro?: string;
    /** Quanto o teste levou. */
    duracaoMs?: number;
    /** Com quem o teste rodou ("como Ana Ribeiro"). */
    usuarioNome?: string;
    /** Número do registro que o teste criou, lido da tela. */
    registro?: RegistroLido | null;
  } | null;
  salvoEm: string;
}

/** Resposta de "Publicar" no Aprender fluxo (F3). */
export interface FluxoPublicado {
  fluxo: Fluxo;
  /** A tarefa do fluxo, quando há: com o widget ligado, publicada junto (fica ativa). */
  tarefa: {
    id: string;
    nome: string;
    status: StatusTarefa;
    /** Versão publicada (ativada) ou a do rascunho em que o fluxo entrou. */
    versao: number;
    ativada: boolean;
    publicadoPor: string | null;
    publicadoEm: string | null;
  } | null;
}

/** Evento bruto capturado pelo gravador no navegador do admin. */
export interface EventoGravado {
  tipo: 'navegar' | 'clique' | 'preencher' | 'selecionar' | 'download' | 'leitura';
  ts: number;
  url: string;
  tituloPagina?: string;
  elemento?: {
    tag: string;
    id?: string;
    name?: string;
    type?: string;
    role?: string;
    texto?: string;
    rotulo?: string;
    placeholder?: string;
    ariaLabel?: string;
    testId?: string;
    href?: string;
    /** Caminho CSS completo, último recurso. */
    css: string;
    /** HTML do elemento e arredores, sem valores digitados. */
    contexto?: string;
  };
  /** Formato do valor (9 para dígito, a para letra). Nunca o valor. */
  formatoValor?: string;
  /** Texto visível da opção escolhida (selecionar). */
  opcaoTexto?: string;
}

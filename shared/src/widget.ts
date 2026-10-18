// Contrato entre o widget (navegador do usuário final) e o servidor do copiloto.
// Todas as rotas ficam em /api/widget e usam o token devolvido por /api/widget/iniciar
// no cabeçalho Authorization: Bearer <token> (ou ?token= no SSE).

export type StatusExecucao =
  | 'aguardando_confirmacao'
  | 'aguardando_aprovacao'
  | 'em_andamento'
  | 'concluida'
  | 'falhou'
  | 'desfeita'
  | 'cancelada';

export type Caminho = 'api' | 'navegador';

export interface PaginaContexto {
  /** Nome da seção do sistema. Ex.: "Clientes". Vem de data-pagina ou do título. */
  secao?: string;
  titulo?: string;
  url?: string;
}

/** Logo da empresa no widget (Canais e widget › Aparência e a etapa "Sua marca" do cadastro). */
export interface LogoWidget {
  /** Nome do arquivo guardado na pasta da empresa: o hash do conteúdo e a extensão. Ex.: "3f9a…c1.svg". */
  arquivo: string;
  /** Nome do arquivo enviado. Ex.: "logo-horizonte.svg". */
  nome: string;
  /** Bytes. */
  tamanho: number;
  tipo: 'image/png' | 'image/svg+xml';
  /** ISO */
  enviadoEm: string;
  /** Endereço público (preso à chave do widget da empresa), com cache longo. Calculado pelo servidor a cada leitura. */
  url: string;
}

export interface WidgetConfigPublica {
  nome: string;
  boasVindas: string;
  /** Sugestões configuradas no console (até 4). */
  sugestoes: string[];
  /** Cor principal em hex. */
  cor: string;
  posicao: 'direita' | 'esquerda';
  atalho: boolean;
  proativa: { ativa: boolean; segundosParado: 15 | 30 | 60 };
  atendimentoHumano: { horario: string };
  /** Logo no topo do assistente e ao lado das respostas. Sem logo, o widget usa o ícone padrão. */
  logo?: LogoWidget | null;
}

export interface UsuarioWidget {
  id: string;
  nome: string;
  primeiroNome: string;
  perfis: string[];
}

export interface ItemRecente {
  execucaoId: string;
  titulo: string;
  status: StatusExecucao;
  /** ISO */
  quando: string;
}

export interface Sugestao {
  rotulo: string;
  /** Mensagem enviada ao tocar. */
  mensagem: string;
}

export interface WidgetInicioPedido {
  chave: string;
  usuario: string;
  /**
   * HMAC-SHA256 em hex, com o segredo do widget, calculado pelo sistema anfitrião. Assina só o ID,
   * ou, quando o snippet traz nome, e-mail ou perfis, o texto de `textoAssinado` (as quatro partes).
   */
  assinatura?: string;
  /** Identidade da pessoa (empresas ligadas só pelas telas): data-nome, data-email e data-perfis. */
  nome?: string;
  email?: string;
  perfis?: string[];
  pagina?: PaginaContexto;
}

/**
 * Texto que o sistema anfitrião assina no snippet. Só o ID quando não há outros dados; com nome,
 * e-mail ou perfis, as quatro partes separadas por quebra de linha, com os perfis separados por
 * vírgula, na ordem do snippet. Ex.: "101\nAna Ribeiro\nana@empresa.com.br\nAtendimento,Comercial".
 */
export function textoAssinado(usuario: string, identidade?: { nome?: string; email?: string; perfis?: string[] }): string {
  const nome = identidade?.nome ?? '';
  const email = identidade?.email ?? '';
  const perfis = identidade?.perfis ?? [];
  if (!nome && !email && perfis.length === 0) return usuario;
  return [usuario, nome, email, perfis.join(',')].join('\n');
}

export interface WidgetInicio {
  token: string;
  usuario: UsuarioWidget;
  config: WidgetConfigPublica;
  /** "Posso fazer agora": tarefas ativas que a pessoa pode executar + sugestões do console. */
  sugestoes: Sugestao[];
  recentes: ItemRecente[];
  /** Conversa em aberto (para retomar), se houver. */
  conversaId: string | null;
  /** true quando o servidor roda com COPILOTO_LLM=simulado (respostas por regras, para testes). */
  modoSimulado: boolean;
  /** true quando o servidor está sem a chave do Claude: o assistente não responde até alguém configurar. */
  semClaude: boolean;
  /** true quando o token é de teste do console: nada é gravado no sistema. */
  modoTeste: boolean;
  /** Limite de gasto atingido: tarefas pausadas (todas ou só navegador). */
  pausa: null | { tipo: 'navegador' | 'tudo'; mensagem: string };
}

export interface SugestaoProativa {
  texto: string;
  detalhe: string;
  /** Mensagem inicial sugerida, se a pessoa aceitar. */
  mensagem?: string;
}

export type AutorMensagem = 'usuario' | 'copiloto' | 'pessoa' | 'sistema';

export interface CampoExibido {
  rotulo: string;
  valor: string;
  /** Marca de validação ao lado do valor. */
  selo?: 'valido';
  /** Campo com valor padrão que a pessoa pode trocar. */
  editavel?: boolean;
}

export interface EtapaProgresso {
  titulo: string;
  detalhe?: string;
  estado: 'pendente' | 'ativa' | 'feita' | 'falhou';
}

export interface AcaoBloco {
  rotulo: string;
  /** abrir: link externo; mensagem: envia `mensagem` como se a pessoa tivesse escrito; humano: pede uma pessoa;
   *  atualizar: atualiza o cadastro existente (nova confirmação); tentar: tenta de novo a execução. */
  acao: 'abrir' | 'mensagem' | 'humano' | 'atualizar' | 'tentar';
  url?: string;
  mensagem?: string;
  estilo?: 'primario' | 'secundario' | 'fantasma';
}

export type Bloco =
  | {
      /** Lista do que o agente já entendeu e do que falta (W2). */
      tipo: 'coleta';
      itens: { rotulo: string; valor?: string; ok: boolean }[];
      /** Pergunta do dado que falta, mostrada abaixo da lista. Ex.: "Para qual e-mail devo mandar os boletos da ACME?" */
      pergunta?: string;
    }
  | {
      /** Cartão de confirmação: nada grava sem ele (W3). */
      tipo: 'confirmacao';
      execucaoId: string;
      tarefa: string;
      titulo: string;
      campos: CampoExibido[];
      caminho: Caminho;
      tempoEstimado: string;
      desfazerMinutos: number;
      estado: 'pendente' | 'confirmado' | 'corrigir' | 'cancelado' | 'substituido';
      /** Hora em que a pessoa confirmou (ISO). */
      confirmadoEm?: string;
    }
  | {
      /** Execução em andamento (W4). Atualizado por eventos mensagem_atualizada. */
      tipo: 'progresso';
      execucaoId: string;
      titulo: string;
      caminho: Caminho;
      etapas: EtapaProgresso[];
      percentual: number;
      /** Ex.: "Faltam cerca de 2 s". */
      restante?: string;
      podeCancelar: boolean;
      status: StatusExecucao;
    }
  | {
      /** Recibo com desfazer (W5). */
      tipo: 'recibo';
      execucaoId: string;
      titulo: string;
      campos: CampoExibido[];
      /** Ex.: "Feito via API em 4 s". */
      resumo: string;
      /**
       * Registro criado, lido da tela no fim do fluxo (caminho navegador). Vira a linha
       * "Chamado #1287 · Padaria Estrela · Prioridade alta" no topo do recibo.
       */
      registro?: { nome: string; numero: string; detalhes: string[] };
      link?: { rotulo: string; url: string };
      /** ISO; ausente quando a tarefa não permite desfazer. */
      desfazerAte?: string;
      desfeito?: boolean;
    }
  | {
      /** Regra de negócio: registro já existe (W6). */
      tipo: 'conflito';
      execucaoId: string;
      existente: { titulo: string; codigo?: string; campos: CampoExibido[]; url?: string };
      acoes: AcaoBloco[];
    }
  | {
      /** Erro com saída (sistema fora do ar, tela mudou, limite atingido). */
      tipo: 'erro';
      execucaoId?: string;
      titulo: string;
      detalhe?: string;
      codigo?: string;
      acoes: AcaoBloco[];
    }
  | {
      /** Sem permissão: pedido de aprovação (W7). */
      tipo: 'aprovacao';
      aprovacaoId: string;
      execucaoId: string;
      campos: CampoExibido[];
      aprovador: { id: string; nome: string } | null;
      estado: 'rascunho' | 'enviada' | 'aprovada' | 'recusada' | 'cancelada';
      motivoRecusa?: string;
    }
  | {
      /** Chips de próximos passos ou sugestões. */
      tipo: 'sugestoes';
      titulo?: string;
      itens: Sugestao[];
    }
  | {
      /** Fontes citadas numa resposta da base de conhecimento. */
      tipo: 'fontes';
      itens: { n: number; titulo: string; local?: string; url?: string }[];
      confianca: 'alta' | 'media' | 'baixa';
    }
  | {
      /** Resumo entregue à pessoa do suporte (W8). */
      tipo: 'resumo_humano';
      para: string;
      itens: { rotulo: string; valor: string }[];
    }
  | {
      /** Pergunta "Esta resposta ajudou?". */
      tipo: 'avaliacao';
    };

export interface MensagemWidget {
  id: string;
  conversaId: string;
  autor: AutorMensagem;
  /** Nome e iniciais de quem escreveu (pessoa do suporte). */
  autorNome?: string;
  autorIniciais?: string;
  /** Texto em markdown simples (negrito, listas, quebras de linha). Para autor sistema, vira a etiqueta central. */
  texto?: string;
  blocos: Bloco[];
  /** ISO */
  criadoEm: string;
  /** true enquanto o texto ainda chega por streaming. */
  emAndamento?: boolean;
  feedback?: 'util' | 'nao_util' | null;
  /** Rodapé curto. Ex.: "Só gravo depois que você confirmar." */
  nota?: string;
  /** Ícone da etiqueta do autor sistema. */
  icone?: 'check' | 'info' | 'pessoa' | 'relogio' | 'aviso';
}

export type EstadoConversa =
  | { modo: 'copiloto' }
  | { modo: 'aguardando_pessoa'; resumoEnviado: boolean }
  | { modo: 'pessoa'; atendente: { nome: string; iniciais: string; papel: string } };

export interface ConversaWidget {
  id: string;
  mensagens: MensagemWidget[];
  estado: EstadoConversa;
  contexto: PaginaContexto | null;
}

export type EventoWidget =
  | { tipo: 'mensagem'; mensagem: MensagemWidget }
  | { tipo: 'mensagem_atualizada'; mensagem: MensagemWidget }
  | { tipo: 'delta'; mensagemId: string; texto: string }
  | { tipo: 'digitando'; ativo: boolean; autor: 'copiloto' | 'pessoa' }
  | { tipo: 'estado'; estado: EstadoConversa }
  | { tipo: 'erro'; mensagem: string };

export interface EnviarMensagemPedido {
  texto: string;
  contexto?: PaginaContexto;
  anexos?: string[];
  /** Id gerado no widget, para não duplicar mensagens reenviadas depois de ficar offline. */
  idCliente?: string;
}

export interface AnexoEnviado {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
}

// ---------- Gravador de fluxos (roda no sistema anfitrião, ativado pelo console) ----------

export interface GravacaoEstado {
  fluxoId: string;
  nome: string;
  ativa: boolean;
  passos: number;
  /** Para onde a gravação vai: "Envia para Horizonte Gestão · Rafael Lima". */
  empresa?: string;
  pessoa?: string | null;
  /** Títulos dos passos até agora ("Preencher assunto"), para o painel "Passos gravados". */
  itens?: string[];
}

/** Resposta de POST /api/gravacao/:token/eventos. */
export interface GravacaoEventosAceitos {
  passos: number;
  itens?: string[];
}

/**
 * Atributo que a extensão do copiloto põe no <html> de toda página, logo no início (valor: versão da
 * extensão). Com ele, quem grava é a extensão: o gravador do widget não liga, e o console sabe que ela está instalada.
 */
export const MARCA_EXTENSAO = 'data-copiloto-extensao';

// Tarefas do seed (ver docs/arquitetura.md, "Tarefas do seed"), alinhadas à API e às telas do
// Horizonte (sample-system). Também usadas pelos testes do fluxo completo do widget.
import type { CasoDeTeste, ResultadoTeste, StatusTarefa, TarefaDefinicao } from '@copiloto/shared';
import type { ChaveFluxoExemplo } from './fluxos.ts';

export interface TarefaSeed {
  slug: string;
  status: StatusTarefa;
  definicao: TarefaDefinicao;
  /** Fluxo gravado de exemplo ligado à tarefa. */
  fluxo?: ChaveFluxoExemplo;
  /** Versões publicadas: a última é a atual. Cada uma com quem publicou, quando e o que mudou. */
  versoes: { por: string; diasAtras: number; resumo: string }[];
  /** Rascunho com mudanças ainda não publicadas (a ficha final), quando houver. */
  rascunho?: { definicao: TarefaDefinicao; diasAtras: number };
  testes: Omit<CasoDeTeste, 'id'>[];
  /** Última rodada de testes: frases reprovadas e o que o agente fez em cada uma. */
  rodada?: { diasAtras: number; reprovados: Record<string, { obtido: string; esperado: string }> };
}

const PRAZOS = ['15 dias', '30 dias', '45 dias', '60 dias'];

export const CADASTRAR_CLIENTE: TarefaDefinicao = {
  nome: 'Cadastrar cliente',
  descricao: 'Cria um cliente novo com CNPJ, cobrança e prazo.',
  quandoUsar:
    'Use quando a pessoa quiser incluir uma empresa nova como cliente. Não use para alterar um cliente que já existe: nesse caso, ofereça a tarefa “Alterar plano do cliente”. Se o CNPJ já estiver cadastrado, avise e mostre o link do cadastro existente.',
  exemplos: [
    'cadastra o cliente ACME Logística, CNPJ...',
    'novo cliente',
    'inclui a empresa Pólen Café no sistema',
    'abre cadastro pra Delta Transportes',
  ],
  campos: [
    { chave: 'nome_empresa', rotulo: 'Nome da empresa', tipo: 'texto', obrigatorio: true, pergunta: 'Qual é o nome da empresa?', minimo: 3 },
    {
      chave: 'cnpj',
      rotulo: 'CNPJ',
      tipo: 'documento',
      obrigatorio: true,
      pergunta: 'Qual é o CNPJ da empresa?',
      verificarExistente: true,
    },
    {
      chave: 'email_cobranca',
      rotulo: 'E-mail de cobrança',
      tipo: 'email',
      obrigatorio: true,
      pergunta: 'Qual é o e-mail de cobrança da empresa?',
    },
    {
      chave: 'prazo_pagamento',
      rotulo: 'Prazo de pagamento',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Qual o prazo de pagamento: 15, 30, 45 ou 60 dias?',
      opcoes: PRAZOS,
    },
    {
      chave: 'responsavel',
      rotulo: 'Responsável',
      tipo: 'pessoa',
      obrigatorio: false,
      pergunta: 'Quem é o responsável pela conta?',
      padrao: 'solicitante',
      perguntar: false,
    },
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
    verificarAntes: {
      caminho: '/v1/clientes?documento={cnpj}',
      descricao: 'Verificando se o CNPJ já existe',
      detalheOk: 'Nenhum cliente com este CNPJ',
    },
    conferirDepois: {
      caminho: '/v1/clientes/{id}',
      descricao: 'Conferindo o cadastro',
      detalheOk: 'Cadastro encontrado com os dados confirmados',
    },
    desfazer: { metodo: 'DELETE', caminho: '/v1/clientes/{id}' },
    rotuloExecucao: 'Criando o cadastro',
    linkResultado: '/clientes/{id}',
  },
  fluxoId: null,
  usarFluxoSeApiFalhar: true,
  confirmacao: true,
  desfazerMinutos: 5,
  perfisPermitidos: ['Comercial', 'Atendimento', 'Administradores'],
  tituloRecibo: 'Cliente {nome_empresa} criado (#{id})',
  tituloConfirmacao: 'Confirme o cadastro',
  tituloProgresso: 'Cadastrando {nome_empresa}',
  proximosPassos: ['Agendar visita técnica para {nome_empresa}', 'Alterar o plano de {nome_empresa}'],
  contextos: ['Clientes'],
  sugestaoProativa: 'Quer que eu cadastre um cliente para você?',
  confiancaMinima: 0.85,
  tempoEstimado: 'cerca de 5 s',
};

export const ALTERAR_PLANO: TarefaDefinicao = {
  nome: 'Alterar plano do cliente',
  descricao: 'Troca o plano contratado. Pede aprovação de um Admin.',
  quandoUsar:
    'Use quando a pessoa quiser mudar o plano (Básico, Pro ou Premium) de um cliente que já existe. Não use para cancelar a assinatura: isso ainda não é feito pelo copiloto.',
  exemplos: [
    'muda o plano da Padaria Estrela para o Pro a partir de novembro',
    'altera o plano da Loja Aurora para o Básico',
    'passa a ACME para Premium',
  ],
  campos: [
    {
      chave: 'cliente',
      rotulo: 'Cliente',
      tipo: 'texto',
      obrigatorio: true,
      pergunta: 'De qual cliente? Pode ser o nome ou o CNPJ.',
      minimo: 2,
    },
    {
      chave: 'plano',
      rotulo: 'Plano novo',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Para qual plano: Básico, Pro ou Premium?',
      opcoes: ['Básico', 'Pro', 'Premium'],
    },
    {
      chave: 'a_partir_de',
      rotulo: 'A partir de',
      tipo: 'data',
      obrigatorio: false,
      pergunta: 'A partir de quando vale o plano novo?',
      perguntar: false,
      ajuda: 'Se a pessoa não disser, vale a partir de hoje.',
    },
  ],
  caminho: 'api',
  api: {
    metodo: 'POST',
    caminho: '/v1/planos/alteracoes',
    mapeamento: [
      { campo: 'cliente', destino: 'cliente' },
      { campo: 'plano', destino: 'plano' },
      { campo: 'a_partir_de', destino: 'a_partir_de', transformacao: 'data_iso' },
    ],
    idRetorno: 'id',
    desfazer: { metodo: 'DELETE', caminho: '/v1/planos/alteracoes/{id}' },
    rotuloExecucao: 'Alterando o plano',
  },
  fluxoId: null,
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 15,
  perfisPermitidos: ['Gestor financeiro', 'Administradores'],
  perfilAprovador: 'Gestor financeiro',
  tituloRecibo: 'Plano de {cliente_nome} alterado para {plano}',
  tituloConfirmacao: 'Confirme a mudança de plano',
  tituloProgresso: 'Alterando o plano de {cliente}',
  proximosPassos: [],
  contextos: ['Clientes'],
  confiancaMinima: 0.9,
  tempoEstimado: 'cerca de 4 s',
};

export const EMITIR_RELATORIO: TarefaDefinicao = {
  nome: 'Emitir relatório de vendas',
  descricao: 'Gera o relatório por período e vendedor, em PDF ou planilha.',
  quandoUsar:
    'Use quando a pessoa pedir um relatório de vendas de um período (um mês, uma semana, um intervalo de datas). Não use para dúvidas sobre como ler o relatório: nesse caso, consulte a base de conhecimento.',
  exemplos: [
    'relatório de vendas de setembro separado por vendedor',
    'relatório de vendas da semana por região, em planilha',
    'me manda as vendas do mês passado em pdf',
  ],
  campos: [
    {
      chave: 'periodo_inicio',
      rotulo: 'Início do período',
      tipo: 'data',
      obrigatorio: true,
      pergunta: 'De qual período? Pode ser um mês, como “setembro”, ou duas datas.',
    },
    { chave: 'periodo_fim', rotulo: 'Fim do período', tipo: 'data', obrigatorio: true, pergunta: 'Até que dia?' },
    {
      chave: 'agrupar_por',
      rotulo: 'Agrupar por',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Quer separado por vendedor, região ou produto?',
      opcoes: ['vendedor', 'região', 'produto'],
    },
    {
      chave: 'formato',
      rotulo: 'Formato',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Prefere em PDF ou em planilha?',
      opcoes: ['PDF', 'planilha'],
    },
  ],
  caminho: 'api',
  api: {
    metodo: 'POST',
    caminho: '/v1/relatorios/vendas',
    mapeamento: [
      { campo: 'periodo_inicio', destino: 'periodo_inicio', transformacao: 'data_iso' },
      { campo: 'periodo_fim', destino: 'periodo_fim', transformacao: 'data_iso' },
      { campo: 'agrupar_por', destino: 'agrupar_por' },
      { campo: 'formato', destino: 'formato' },
    ],
    idRetorno: 'id',
    rotuloExecucao: 'Gerando o relatório',
  },
  fluxoId: null,
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 0,
  perfisPermitidos: ['Comercial', 'Financeiro', 'Gestor financeiro', 'Administradores'],
  perfilAprovador: 'Gestor financeiro',
  tituloRecibo: 'Relatório de vendas pronto ({linhas} linhas)',
  tituloConfirmacao: 'Confirme o relatório',
  tituloProgresso: 'Gerando o relatório de vendas',
  proximosPassos: [],
  contextos: ['Relatórios'],
  sugestaoProativa: 'Quer que eu gere um relatório de vendas para você?',
  confiancaMinima: 0.85,
  tempoEstimado: 'cerca de 8 s',
};

export const AGENDAR_VISITA: TarefaDefinicao = {
  nome: 'Agendar visita técnica',
  descricao: 'Marca data e técnico na agenda de atendimento.',
  quandoUsar:
    'Use quando a pessoa quiser marcar uma visita técnica num cliente, com data e horário. Não use para remarcar ou cancelar visitas.',
  exemplos: [
    'agenda visita técnica na Metalúrgica Sul na segunda, 19/10, às 9h',
    'marca uma visita na ACME quinta às 14h',
    'preciso de um técnico na Padaria Estrela amanhã de manhã',
  ],
  campos: [
    { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, pergunta: 'Em qual cliente?', minimo: 2 },
    { chave: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, pergunta: 'Para qual dia?' },
    { chave: 'horario', rotulo: 'Horário', tipo: 'hora', obrigatorio: true, pergunta: 'Em qual horário? Atendemos das 8h às 17h.' },
    {
      chave: 'tecnico',
      rotulo: 'Técnico',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Com qual técnico: Carlos Mendes, Fernanda Lopes, João Pereira ou o primeiro disponível?',
      opcoes: ['Carlos Mendes', 'Fernanda Lopes', 'João Pereira', 'Primeiro disponível'],
      padrao: 'Primeiro disponível',
      perguntar: false,
    },
  ],
  caminho: 'navegador',
  fluxoId: null,
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 0,
  perfisPermitidos: ['Atendimento', 'Técnico', 'Comercial', 'Administradores'],
  tituloRecibo: 'Visita agendada na {cliente} (protocolo {protocolo})',
  tituloConfirmacao: 'Confirme o agendamento',
  tituloProgresso: 'Agendando a visita na {cliente}',
  proximosPassos: [],
  contextos: ['Agenda'],
  sugestaoProativa: 'Quer que eu agende uma visita técnica para você?',
  confiancaMinima: 0.85,
  tempoEstimado: 'cerca de 50 s',
};

export const SEGUNDA_VIA: TarefaDefinicao = {
  nome: 'Segunda via de boleto',
  descricao: 'Gera e envia o PDF do boleto.',
  quandoUsar:
    'Use quando a pessoa pedir a segunda via de um boleto de um cliente, de um mês (competência). Não use para dúvidas sobre multa ou juros: consulte a base de conhecimento.',
  exemplos: [
    'manda a segunda via do boleto de outubro da Transportes Vale',
    'preciso da segunda via do boleto da Clínica Bem Viver, venceu dia 10',
    '2ª via do boleto do CNPJ 12.345.678/0001-95 de setembro',
  ],
  campos: [
    {
      chave: 'documento_pagador',
      rotulo: 'CPF/CNPJ do pagador',
      tipo: 'documento',
      obrigatorio: true,
      pergunta: 'Qual é o CPF ou CNPJ de quem paga o boleto?',
    },
    {
      chave: 'competencia',
      rotulo: 'Competência',
      tipo: 'texto',
      obrigatorio: true,
      pergunta: 'De qual mês é o boleto?',
      ajuda: 'Mês e ano, no formato MM/AAAA.',
    },
  ],
  caminho: 'navegador',
  fluxoId: null,
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 0,
  perfisPermitidos: ['Financeiro', 'Gestor financeiro', 'Administradores'],
  tituloRecibo: 'Segunda via do boleto {competencia} gerada',
  tituloConfirmacao: 'Confirme a segunda via',
  tituloProgresso: 'Gerando a segunda via',
  proximosPassos: [],
  contextos: ['Financeiro'],
  confiancaMinima: 0.85,
  tempoEstimado: 'cerca de 40 s',
  liberadaPara: ['102', '105', '106'],
};

export const ABRIR_CHAMADO: TarefaDefinicao = {
  nome: 'Abrir chamado de suporte',
  descricao: 'Registra um chamado com assunto, cliente e prioridade.',
  quandoUsar:
    'Use quando a pessoa relatar um problema de um cliente que precisa de acompanhamento do suporte técnico. Não use para dúvidas de uso: consulte a base de conhecimento.',
  exemplos: ['abre um chamado para a ACME: sistema lento desde ontem', 'registra chamado urgente da Padaria Estrela'],
  campos: [
    { chave: 'assunto', rotulo: 'Assunto', tipo: 'texto', obrigatorio: true, pergunta: 'Qual é o assunto, em poucas palavras?', minimo: 3 },
    { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, pergunta: 'De qual cliente?', minimo: 2 },
    {
      chave: 'prioridade',
      rotulo: 'Prioridade',
      tipo: 'lista',
      obrigatorio: true,
      pergunta: 'Qual a prioridade: baixa, média, alta ou urgente?',
      opcoes: ['Baixa', 'Média', 'Alta', 'Urgente'],
    },
    {
      chave: 'descricao',
      rotulo: 'Descrição',
      tipo: 'texto',
      obrigatorio: true,
      pergunta: 'Conte o que está acontecendo.',
      minimo: 10,
    },
  ],
  caminho: 'api',
  api: {
    metodo: 'POST',
    caminho: '/v1/chamados',
    mapeamento: [
      { campo: 'assunto', destino: 'assunto' },
      { campo: 'cliente', destino: 'cliente' },
      { campo: 'prioridade', destino: 'prioridade' },
      { campo: 'descricao', destino: 'descricao' },
    ],
    idRetorno: 'id',
    desfazer: { metodo: 'DELETE', caminho: '/v1/chamados/{id}' },
    rotuloExecucao: 'Abrindo o chamado',
  },
  fluxoId: null,
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 5,
  perfisPermitidos: [],
  tituloRecibo: 'Chamado {numero} aberto',
  tituloConfirmacao: 'Confirme o chamado',
  tituloProgresso: 'Abrindo o chamado',
  proximosPassos: [],
  contextos: ['Chamados'],
  confiancaMinima: 0.85,
};

/** Versão 5 em rascunho do cadastro: duas mudanças ainda não publicadas. */
const CADASTRAR_CLIENTE_V5: TarefaDefinicao = {
  ...CADASTRAR_CLIENTE,
  exemplos: [...CADASTRAR_CLIENTE.exemplos, 'cadastra a Farmácia Central, prazo 15 dias'],
  campos: CADASTRAR_CLIENTE.campos.map((c) =>
    c.chave === 'prazo_pagamento' ? { ...c, ajuda: 'Prazos fora da lista (como 90 dias) precisam de aprovação do financeiro.' } : c,
  ),
};

export const TAREFAS_SEED: TarefaSeed[] = [
  {
    slug: 'cadastrar_cliente',
    status: 'ativa',
    definicao: CADASTRAR_CLIENTE,
    fluxo: 'cadastro_cliente_tela',
    versoes: [
      { por: 'Júlia Martins', diasAtras: 90, resumo: 'Primeira versão.' },
      { por: 'Júlia Martins', diasAtras: 41, resumo: 'Confere se o CNPJ já existe antes de gravar.' },
      { por: 'Rafael Lima', diasAtras: 15, resumo: 'Usa o fluxo gravado quando a API falhar.' },
      { por: 'Júlia Martins', diasAtras: 3, resumo: 'Desfazer por 5 minutos e frases de exemplo novas.' },
    ],
    rascunho: { definicao: CADASTRAR_CLIENTE_V5, diasAtras: 0 },
    testes: [
      {
        frase: 'cadastra o cliente ACME Logística, CNPJ 12.345.678/0001-90, prazo 30 dias',
        esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' },
      },
      {
        frase: 'novo cliente Pólen Café, cobrança no financeiro@polencafe.com.br',
        esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' },
      },
      {
        frase: 'inclui a Delta Transportes com prazo de 90 dias',
        esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' },
      },
      { frase: 'novo cliente', esperado: { resultado: 'pergunta', campoPerguntado: 'nome_empresa' } },
      {
        frase: 'cadastra a Farmácia Central, CNPJ 11.222.333/0001-81, prazo 15 dias, cobrança financeiro@farmaciacentral.com.br',
        esperado: {
          resultado: 'confirmacao',
          campos: { nome_empresa: 'Farmácia Central', cnpj: '11.222.333/0001-81', prazo_pagamento: '15 dias' },
        },
      },
      { frase: 'abre cadastro pra Delta Transportes', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { frase: 'inclui a empresa Pólen Café no sistema', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { frase: 'cadastrar cliente CNPJ 11.222.333/0001-81', esperado: { resultado: 'pergunta', campoPerguntado: 'nome_empresa' } },
      {
        frase: 'cliente novo: Metalúrgica Sul, cobranca@metalurgicasul.com.br',
        esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' },
      },
      { frase: 'quero incluir um cliente', esperado: { resultado: 'pergunta', campoPerguntado: 'nome_empresa' } },
      { frase: 'cadastra a Loja Aurora, prazo 45 dias', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      {
        frase: 'novo cliente Padaria Estrela CNPJ 11.222.333/0001-81',
        esperado: { resultado: 'pergunta', campoPerguntado: 'email_cobranca' },
      },
      { frase: 'cadastra a Transportes Vale', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { frase: 'como cadastro um cliente?', esperado: { resultado: 'recusa' } },
      { frase: 'muda o plano da ACME para Premium', esperado: { resultado: 'recusa' } },
      { frase: 'cancela a assinatura da Delta Transportes', esperado: { resultado: 'recusa' } },
      { frase: 'cadastra a Clínica Bem Viver com prazo 60 dias', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { frase: 'inclui a Gráfica Ponto, CNPJ 123', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { frase: 'novo cliente Café Aroma, prazo 30 dias', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { frase: 'cadastra cliente Mercado Bom Preço', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
    ],
    rodada: {
      diasAtras: 0,
      reprovados: {
        'inclui a Delta Transportes com prazo de 90 dias': {
          obtido: 'Aceitou 90 dias.',
          esperado: 'Deveria oferecer 15, 30, 45 ou 60.',
        },
        'como cadastro um cliente?': {
          obtido: 'Começou o cadastro e perguntou o nome da empresa.',
          esperado: 'Deveria responder a dúvida pela base de conhecimento.',
        },
      },
    },
  },
  {
    slug: 'alterar_plano',
    status: 'ativa',
    definicao: ALTERAR_PLANO,
    versoes: [
      { por: 'Rafael Lima', diasAtras: 80, resumo: 'Primeira versão.' },
      { por: 'Rafael Lima', diasAtras: 8, resumo: 'Pede aprovação do Gestor financeiro para quem não tem o perfil.' },
    ],
    testes: [
      {
        frase: 'muda o plano da Padaria Estrela para o Pro',
        esperado: { resultado: 'confirmacao', campos: { cliente: 'Padaria Estrela', plano: 'Pro' } },
      },
      { frase: 'altera o plano da Loja Aurora', esperado: { resultado: 'pergunta', campoPerguntado: 'plano' } },
      { frase: 'quero mudar um plano', esperado: { resultado: 'pergunta', campoPerguntado: 'cliente' } },
      { frase: 'cadastra a ACME Logística', esperado: { resultado: 'recusa' } },
    ],
  },
  {
    slug: 'emitir_relatorio_vendas',
    status: 'ativa',
    definicao: EMITIR_RELATORIO,
    versoes: [{ por: 'Júlia Martins', diasAtras: 75, resumo: 'Primeira versão.' }],
    testes: [
      { frase: 'relatório de vendas de setembro', esperado: { resultado: 'pergunta', campoPerguntado: 'agrupar_por' } },
      {
        frase: 'relatório de vendas de setembro por vendedor em pdf',
        esperado: { resultado: 'confirmacao', campos: { agrupar_por: 'vendedor', formato: 'PDF' } },
      },
      { frase: 'quero um relatório de vendas', esperado: { resultado: 'pergunta', campoPerguntado: 'periodo_inicio' } },
    ],
  },
  {
    slug: 'agendar_visita',
    status: 'ativa',
    definicao: AGENDAR_VISITA,
    fluxo: 'agendar_visita',
    versoes: [
      { por: 'Júlia Martins', diasAtras: 70, resumo: 'Primeira versão.' },
      { por: 'Júlia Martins', diasAtras: 15, resumo: 'Fluxo regravado com o campo de técnico.' },
    ],
    testes: [
      {
        frase: 'agenda visita técnica na ACME Logística dia 22/10 às 14h',
        esperado: { resultado: 'confirmacao', campos: { cliente: 'ACME Logística', horario: '14:00' } },
      },
      { frase: 'marca uma visita técnica', esperado: { resultado: 'pergunta', campoPerguntado: 'cliente' } },
      { frase: 'agenda visita técnica na Padaria Estrela', esperado: { resultado: 'pergunta', campoPerguntado: 'data' } },
    ],
  },
  {
    slug: 'segunda_via_boleto',
    status: 'teste',
    definicao: SEGUNDA_VIA,
    fluxo: 'segunda_via_boleto',
    versoes: [{ por: 'Júlia Martins', diasAtras: 60, resumo: 'Primeira versão, em teste com 3 pessoas.' }],
    testes: [
      { frase: 'segunda via do boleto de setembro', esperado: { resultado: 'pergunta', campoPerguntado: 'documento_pagador' } },
      {
        frase: 'segunda via do boleto do CNPJ 12.345.678/0001-95 de 09/2026',
        esperado: { resultado: 'confirmacao', campos: { competencia: '09/2026' } },
      },
    ],
  },
  {
    slug: 'abrir_chamado',
    status: 'rascunho',
    definicao: ABRIR_CHAMADO,
    versoes: [],
    rascunho: { definicao: ABRIR_CHAMADO, diasAtras: 6 },
    testes: [{ frase: 'abre um chamado para a ACME', esperado: { resultado: 'pergunta', campoPerguntado: 'assunto' } }],
  },
];

/** Resultado de uma frase na rodada de exemplo (aprovada: descreve o que o agente fez). */
export function resultadoExemplo(caso: Omit<CasoDeTeste, 'id'>, id: string, reprovado?: { obtido: string; esperado: string }): ResultadoTeste {
  if (reprovado) return { casoId: id, frase: caso.frase, aprovado: false, obtido: reprovado.obtido, esperado: reprovado.esperado };
  const e = caso.esperado;
  const obtido =
    e.resultado === 'recusa'
      ? 'Não usou esta tarefa.'
      : e.resultado === 'confirmacao'
        ? 'Mostrou o cartão de confirmação com os dados certos.'
        : `Perguntou ${rotuloPerguntado(e.campoPerguntado)}.`;
  return { casoId: id, frase: caso.frase, aprovado: true, obtido };
}

function rotuloPerguntado(campo?: string): string {
  const todos = TAREFAS_SEED.flatMap((t) => t.definicao.campos);
  const c = todos.find((x) => x.chave === campo);
  return c ? `o campo “${c.rotulo}”` : 'o que faltava';
}

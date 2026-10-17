// Fluxos gravados de exemplo (caminho navegador), alinhados às telas do sistema de exemplo.
// Ver docs/arquitetura.md, seção "Telas do Horizonte".
import type { Fluxo, PassoFluxo, SeletorCandidato } from '@copiloto/shared';

/** Chaves usadas pelo seed das tarefas para ligar cada tarefa ao seu fluxo. */
export type ChaveFluxoExemplo = 'cadastro_cliente_tela' | 'agendar_visita' | 'segunda_via_boleto';

const NOME_INTERNO = 'usa o nome interno do campo, que quase nunca muda';
const ROTULO = 'usa o rótulo que aparece ao lado do campo; só muda se alguém renomear o campo';
const MARCA = 'usa a marca do dado na tela, que não muda quando o visual muda';
const TEXTO_BOTAO = 'depende do texto do botão; se o texto mudar, o copiloto procura um parecido na tela e avisa você';
const TEXTO_TELA = 'depende do texto que aparece na tela, que pode mudar';

const estavel = (seletor: string, motivo: string): SeletorCandidato => ({ seletor, estabilidade: 'estavel', motivo });
const fragil = (seletor: string, motivo: string): SeletorCandidato => ({ seletor, estabilidade: 'fragil', motivo });

/** Campo de digitar: nome interno e rótulo. */
const campoTexto = (name: string, rotulo: string, tag = 'input') => [estavel(`${tag}[name="${name}"]`, NOME_INTERNO), estavel(`label="${rotulo}"`, ROTULO)];
const botao = (texto: string) => [fragil(`role=button[name="${texto}"]`, TEXTO_BOTAO), fragil(`text="${texto}"`, TEXTO_TELA)];
const leitura = (campo: string) => [estavel(`[data-campo="${campo}"]`, MARCA)];

function numerar(passos: Omit<PassoFluxo, 'n'>[]): PassoFluxo[] {
  return passos.map((p, i) => ({ n: i + 1, ...p }));
}

function diasAtras(dias: number, hora = 14): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  d.setUTCHours(hora, 3, 0, 0);
  return d.toISOString();
}

export function fluxosExemplo(): Record<ChaveFluxoExemplo, Omit<Fluxo, 'id' | 'tarefaId'>> | null {
  const cadastro: PassoFluxo[] = numerar([
    {
      tipo: 'navegar',
      titulo: 'Abrir a tela de novo cliente',
      rotuloElemento: 'Clientes › Novo cliente',
      url: '/clientes/novo',
      seletores: [],
      seletorEscolhido: 0,
    },
    {
      tipo: 'preencher',
      titulo: 'Preencher razão social',
      rotuloElemento: 'Razão social',
      url: '/clientes/novo',
      seletores: campoTexto('razao_social', 'Razão social'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'nome_empresa' },
      formatoGravado: 'aaaa aaa aaaa',
    },
    {
      tipo: 'preencher',
      titulo: 'Preencher CNPJ',
      rotuloElemento: 'CNPJ',
      url: '/clientes/novo',
      seletores: campoTexto('cnpj', 'CNPJ'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'cnpj' },
      formatoGravado: '99.999.999/9999-99',
    },
    {
      tipo: 'preencher',
      titulo: 'Preencher e-mail de cobrança',
      rotuloElemento: 'E-mail de cobrança',
      url: '/clientes/novo',
      seletores: campoTexto('email_cobranca', 'E-mail de cobrança'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'email_cobranca' },
      formatoGravado: 'aaaaaaaaa@aaaaaa.aaa.aa',
    },
    {
      tipo: 'selecionar',
      titulo: 'Selecionar prazo de pagamento',
      rotuloElemento: 'Prazo de pagamento',
      url: '/clientes/novo',
      seletores: campoTexto('prazo_pagamento_dias', 'Prazo de pagamento', 'select'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'prazo_pagamento' },
      formatoGravado: '99 aaaa',
    },
    {
      tipo: 'selecionar',
      titulo: 'Selecionar responsável',
      rotuloElemento: 'Responsável',
      url: '/clientes/novo',
      seletores: campoTexto('responsavel_id', 'Responsável', 'select'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'responsavel' },
      formatoGravado: 'aaaaaa aaaa',
    },
    {
      tipo: 'clique',
      titulo: 'Clicar em Salvar cliente',
      rotuloElemento: 'Salvar cliente',
      url: '/clientes/novo',
      seletores: botao('Salvar cliente'),
      seletorEscolhido: 0,
    },
    {
      tipo: 'leitura',
      titulo: 'Ler o código do cliente',
      rotuloElemento: 'Código do cliente',
      url: '/clientes/:id',
      seletores: leitura('codigo'),
      seletorEscolhido: 0,
      gera: 'codigo',
    },
  ]);

  const agendamento: PassoFluxo[] = numerar([
    {
      tipo: 'navegar',
      titulo: 'Abrir a tela de nova visita',
      rotuloElemento: 'Agenda › Nova visita',
      url: '/agenda/nova-visita',
      seletores: [],
      seletorEscolhido: 0,
    },
    {
      tipo: 'preencher',
      titulo: 'Preencher cliente',
      rotuloElemento: 'Cliente',
      url: '/agenda/nova-visita',
      seletores: campoTexto('cliente', 'Cliente'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'cliente' },
      formatoGravado: 'aaaa aaa aaaa',
    },
    {
      tipo: 'preencher',
      titulo: 'Preencher data da visita',
      rotuloElemento: 'Data da visita',
      url: '/agenda/nova-visita',
      seletores: campoTexto('data_visita', 'Data da visita'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'data' },
      formatoGravado: '9999-99-99',
    },
    {
      tipo: 'selecionar',
      titulo: 'Selecionar horário',
      rotuloElemento: 'Horário',
      url: '/agenda/nova-visita',
      seletores: campoTexto('horario', 'Horário', 'select'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'horario' },
      formatoGravado: '99:99',
    },
    {
      tipo: 'selecionar',
      titulo: 'Selecionar técnico',
      rotuloElemento: 'Técnico',
      url: '/agenda/nova-visita',
      seletores: campoTexto('tecnico', 'Técnico', 'select'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'tecnico' },
      formatoGravado: 'aaaaaa aaaaaa',
    },
    {
      tipo: 'clique',
      titulo: 'Clicar em Agendar visita',
      rotuloElemento: 'Agendar visita',
      url: '/agenda/nova-visita',
      seletores: botao('Agendar visita'),
      seletorEscolhido: 0,
    },
    {
      tipo: 'leitura',
      titulo: 'Ler o protocolo da visita',
      rotuloElemento: 'Protocolo',
      url: '/agenda/visitas/:id',
      seletores: leitura('protocolo'),
      seletorEscolhido: 0,
      gera: 'protocolo',
    },
  ]);

  const boleto: PassoFluxo[] = numerar([
    {
      tipo: 'navegar',
      titulo: 'Abrir a tela de segunda via',
      rotuloElemento: 'Financeiro › Segunda via',
      url: '/financeiro/segunda-via',
      seletores: [],
      seletorEscolhido: 0,
    },
    {
      tipo: 'preencher',
      titulo: 'Preencher CPF/CNPJ',
      rotuloElemento: 'CPF/CNPJ do pagador',
      url: '/financeiro/segunda-via',
      seletores: campoTexto('doc_pagador', 'CPF/CNPJ do pagador'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'documento_pagador' },
      formatoGravado: '99.999.999/9999-99',
    },
    {
      tipo: 'selecionar',
      titulo: 'Selecionar competência',
      rotuloElemento: 'Competência',
      url: '/financeiro/segunda-via',
      seletores: campoTexto('competencia', 'Competência', 'select'),
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'competencia' },
      formatoGravado: '99/9999',
    },
    {
      tipo: 'clique',
      titulo: 'Clicar em Buscar boletos',
      rotuloElemento: 'Buscar boletos',
      url: '/financeiro/segunda-via',
      seletores: botao('Buscar boletos'),
      seletorEscolhido: 0,
    },
    {
      tipo: 'download',
      titulo: 'Gerar a 2ª via e baixar o PDF',
      rotuloElemento: 'Gerar 2ª via',
      url: '/financeiro/segunda-via',
      seletores: [
        fragil('role=button[name="Gerar 2ª via"]', TEXTO_BOTAO),
        fragil('role=link[name="Gerar 2ª via"]', 'depende do texto do link; se o texto mudar, o copiloto procura um parecido na tela e avisa você'),
        fragil('text="Gerar 2ª via"', TEXTO_TELA),
      ],
      seletorEscolhido: 0,
      gera: 'arquivo_boleto',
    },
    {
      tipo: 'leitura',
      titulo: 'Ler a linha digitável',
      rotuloElemento: 'Linha digitável',
      url: '/financeiro/segunda-via',
      seletores: leitura('linha_digitavel'),
      seletorEscolhido: 0,
      gera: 'linha_digitavel',
    },
  ]);

  const base = {
    etapa: 'publicar' as const,
    status: 'publicado' as const,
    camposSugeridos: [],
    gravadoPor: 'Júlia Martins',
  };

  return {
    cadastro_cliente_tela: {
      ...base,
      nome: 'Cadastrar cliente pela tela',
      versao: 1,
      passos: cadastro,
      gravadoEm: diasAtras(40),
      duracaoGravacaoMs: 58_000,
      urlInicial: '/clientes/novo',
      ultimoTeste: { em: diasAtras(40, 15), ok: true },
      salvoEm: diasAtras(40, 15),
    },
    agendar_visita: {
      ...base,
      nome: 'Agendar visita técnica',
      versao: 2,
      passos: agendamento,
      gravadoEm: diasAtras(19),
      duracaoGravacaoMs: 64_000,
      urlInicial: '/agenda/nova-visita',
      ultimoTeste: { em: diasAtras(19, 15), ok: true },
      salvoEm: diasAtras(19, 15),
    },
    segunda_via_boleto: {
      ...base,
      nome: 'Segunda via de boleto',
      versao: 1,
      passos: boleto,
      gravadoEm: diasAtras(61),
      duracaoGravacaoMs: 72_000,
      urlInicial: '/financeiro/segunda-via',
      ultimoTeste: { em: diasAtras(61, 15), ok: true },
      salvoEm: diasAtras(61, 15),
    },
  };
}

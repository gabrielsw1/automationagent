// Dados de exemplo: equipe do console, as 6 tarefas (com versões, testes e fluxos gravados),
// 1.284 execuções dos últimos 30 dias (e 1.146 nos 30 antes, para a comparação do painel), aprovações, pedidos sem tarefa, conversas, auditoria e a
// base de conhecimento. Tudo marcado como exemplo; os números batem com o design do painel.
// Roda sozinho no primeiro início (banco vazio) e com `npm run seed` (recria o banco).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fmt, type TarefaDefinicao, type CampoExibido, type MensagemWidget } from '@copiloto/shared';
import type { Banco } from '../db/banco.ts';
import type { Contexto } from '../contexto.ts';
import { camposExibidos } from '../execucao/motor.ts';
import { sistemaNovo, tokenDaEmpresa, type Empresa, type Plataforma } from '../plataforma/index.ts';
import { novoId } from '../util/ids.ts';
import { semearConhecimento } from './conhecimento.ts';
import { fluxosExemplo } from './fluxos.ts';
import { TAREFAS_SEED, resultadoExemplo, type TarefaSeed } from './tarefas.ts';

export const SENHA_PADRAO = 'copiloto123';

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
/** São Paulo não tem horário de verão desde 2019. */
const FUSO_SP = -3 * HORA;

interface Pessoa {
  id: string;
  nome: string;
  perfil: string;
}

const PESSOAS: Record<string, Pessoa> = {
  ana: { id: '101', nome: 'Ana Ribeiro', perfil: 'Comercial' },
  marcos: { id: '102', nome: 'Marcos Teixeira', perfil: 'Financeiro' },
  paula: { id: '103', nome: 'Paula Nunes', perfil: 'Comercial' },
  diego: { id: '104', nome: 'Diego Alves', perfil: 'Técnico' },
  rafael: { id: '105', nome: 'Rafael Lima', perfil: 'Gestor financeiro' },
  julia: { id: '106', nome: 'Júlia Martins', perfil: 'Administradores' },
  camila: { id: '107', nome: 'Camila Souza', perfil: 'Atendimento' },
};

/** Quem costuma pedir cada tarefa (peso pela repetição). */
const QUEM_PEDE: Record<string, string[]> = {
  cadastrar_cliente: ['ana', 'ana', 'ana', 'paula', 'paula', 'paula', 'camila', 'camila', 'diego', 'julia'],
  alterar_plano: ['rafael', 'rafael', 'rafael', 'julia', 'julia', 'ana', 'paula'],
  emitir_relatorio_vendas: ['paula', 'paula', 'paula', 'ana', 'ana', 'marcos', 'marcos', 'rafael'],
  agendar_visita: ['diego', 'diego', 'diego', 'ana', 'ana', 'camila', 'camila'],
  segunda_via_boleto: ['marcos', 'marcos', 'marcos', 'rafael', 'julia'],
};

/** Execuções que rodaram nos últimos 30 dias e quantas falharam (taxas do design). */
const VOLUME: Record<string, { total: number; falhas: number }> = {
  cadastrar_cliente: { total: 412, falhas: 8 },
  emitir_relatorio_vendas: { total: 356, falhas: 3 },
  alterar_plano: { total: 241, falhas: 6 },
  agendar_visita: { total: 187, falhas: 22 },
  segunda_via_boleto: { total: 88, falhas: 10 },
};

/** Os 30 dias antes desses, para o painel comparar ("+12% vs. período anterior"). */
const VOLUME_ANTERIOR: Record<string, { total: number; falhas: number }> = {
  cadastrar_cliente: { total: 372, falhas: 9 },
  emitir_relatorio_vendas: { total: 318, falhas: 4 },
  alterar_plano: { total: 222, falhas: 5 },
  agendar_visita: { total: 196, falhas: 31 },
  segunda_via_boleto: { total: 38, falhas: 6 },
};

const CLIENTES = [
  'ACME Logística',
  'Padaria Estrela',
  'Metalúrgica Sul',
  'Transportes Vale',
  'Clínica Bem Viver',
  'Farmácia Central',
  'Loja Aurora',
  'Pólen Café',
  'Delta Transportes',
  'Gráfica Ponto',
  'Café Aroma',
  'Mercado Bom Preço',
  'Construtora Alicerce',
  'Auto Peças Rota',
  'Escola Saber',
  'Hotel Mirante',
  'Laticínios Serra',
  'Ótica Visão',
  'Pet Shop Amigo',
  'Restaurante Sabor da Terra',
  'Vidraçaria Cristal',
  'Distribuidora Norte',
];
const TECNICOS = ['Carlos Mendes', 'Fernanda Lopes', 'João Pereira'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Gerador pseudoaleatório com semente (os dados saem iguais a cada seed). */
function aleatorio(semente: number) {
  let a = semente >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    r,
    entre: (min: number, max: number) => min + Math.floor(r() * (max - min + 1)),
    escolher: <T>(lista: readonly T[]): T => lista[Math.floor(r() * lista.length)],
    embaralhar: <T>(lista: T[]): T[] => {
      for (let i = lista.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [lista[i], lista[j]] = [lista[j], lista[i]];
      }
      return lista;
    },
  };
}

type Aleatorio = ReturnType<typeof aleatorio>;

function cnpjCom(base12: string): string {
  const calc = (s: string, pesos: number[]) => {
    const soma = s.split('').reduce((t, d, i) => t + Number(d) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = `${base12}${d1}${d2}`;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

function cnpjAleatorio(a: Aleatorio): string {
  return cnpjCom(`${String(a.entre(10, 99))}${String(a.entre(100000, 999999))}0001`);
}

function emailDe(cliente: string): string {
  const base = cliente
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '')
    .slice(0, 16);
  return `financeiro@${base}.com.br`;
}

/** Instante em São Paulo: dia (meia-noite UTC do dia local) + hora local em minutos. */
function emSp(diaLocal: number, minutos: number): Date {
  return new Date(diaLocal + minutos * MIN - FUSO_SP);
}

function inicioDoDiaSp(agora: Date): number {
  const local = agora.getTime() + FUSO_SP;
  return local - (local % DIA);
}

function isoDia(d: Date): string {
  return new Date(d.getTime() + FUSO_SP).toISOString().slice(0, 10);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ------------------------------------------------------------------ tarefas

interface TarefaCriada {
  id: string;
  slug: string;
  def: TarefaDefinicao;
  versao: number;
  fluxoId: string | null;
}

function semearTarefas(banco: Banco, agora: number): Map<string, TarefaCriada> {
  const fluxos = fluxosExemplo();
  const criadas = new Map<string, TarefaCriada>();
  for (const t of TAREFAS_SEED) {
    const id = novoId('tar');
    let fluxoId: string | null = null;
    if (t.fluxo && fluxos?.[t.fluxo]) {
      const f = fluxos[t.fluxo];
      fluxoId = novoId('flx');
      banco.inserir('fluxos', {
        id: fluxoId,
        nome: f.nome,
        tarefa_id: id,
        etapa: f.etapa,
        status: f.status,
        versao: f.versao,
        passos: f.passos,
        campos_sugeridos: f.camposSugeridos ?? [],
        eventos_gravados: [],
        token_gravacao: null,
        gravado_por: f.gravadoPor ?? null,
        gravado_em: f.gravadoEm ?? null,
        duracao_gravacao_ms: f.duracaoGravacaoMs ?? null,
        url_inicial: f.urlInicial ?? null,
        ultimo_teste: f.ultimoTeste ?? null,
        criado_em: f.gravadoEm ?? iso(agora),
        salvo_em: f.salvoEm ?? iso(agora),
      });
    }
    const comFluxo = (d: TarefaDefinicao): TarefaDefinicao => ({ ...d, fluxoId: d.caminho === 'navegador' || d.usarFluxoSeApiFalhar ? fluxoId : null });
    const def = comFluxo(t.definicao);
    const ultima = t.versoes[t.versoes.length - 1];
    const primeira = t.versoes[0] ?? t.rascunho;
    banco.inserir('tarefas', {
      id,
      slug: t.slug,
      status: t.status,
      versao_publicada: t.versoes.length || null,
      criado_em: iso(agora - (primeira?.diasAtras ?? 0) * DIA - 2 * HORA),
      atualizado_em: iso(agora - (t.rascunho?.diasAtras ?? ultima?.diasAtras ?? 0) * DIA - HORA),
      atualizado_por: ultima?.por ?? 'Rafael Lima',
    });
    t.versoes.forEach((v, i) => {
      const publicada = i === t.versoes.length - 1;
      banco.inserir('tarefa_versoes', {
        tarefa_id: id,
        versao: i + 1,
        status: publicada ? 'publicada' : 'arquivada',
        definicao: def,
        resumo_mudancas: v.resumo,
        salvo_em: iso(agora - v.diasAtras * DIA - 3 * HORA),
        publicado_por: v.por,
        publicado_em: iso(agora - v.diasAtras * DIA - 2 * HORA),
      });
    });
    if (t.rascunho) {
      banco.inserir('tarefa_versoes', {
        tarefa_id: id,
        versao: t.versoes.length + 1,
        status: 'rascunho',
        definicao: comFluxo(t.rascunho.definicao),
        salvo_em: iso(agora - t.rascunho.diasAtras * DIA - HORA),
      });
    }
    const casos = t.testes.map((c, i) => ({ id: novoId('tst'), ...c, ordem: i }));
    for (const c of casos) {
      banco.inserir('tarefa_testes', { id: c.id, tarefa_id: id, frase: c.frase, esperado: c.esperado, ordem: c.ordem });
    }
    if (t.rodada || t.versoes.length) semearRodada(banco, id, t, casos, agora);
    criadas.set(t.slug, { id, slug: t.slug, def, versao: t.versoes.length || 1, fluxoId });
  }
  return criadas;
}

function semearRodada(banco: Banco, tarefaId: string, t: TarefaSeed, casos: { id: string; frase: string; esperado: TarefaSeed['testes'][number]['esperado'] }[], agora: number) {
  const resultados = casos.map((c) => resultadoExemplo(c, c.id, t.rodada?.reprovados[c.frase]));
  const diasAtras = t.rodada?.diasAtras ?? t.versoes[t.versoes.length - 1]?.diasAtras ?? 0;
  banco.inserir('testes_rodadas', {
    id: novoId('rod'),
    tarefa_id: tarefaId,
    versao: t.rascunho ? t.versoes.length + 1 : t.versoes.length,
    aprovados: resultados.filter((r) => r.aprovado).length,
    total: resultados.length,
    resultados,
    criado_em: iso(agora - diasAtras * DIA - 20 * MIN),
  });
}

// ------------------------------------------------------------------ execuções

interface ExecSeed {
  id?: string;
  slug: string;
  quem: Pessoa;
  inicio: number;
  status: 'concluida' | 'falhou' | 'desfeita' | 'cancelada' | 'aguardando_confirmacao' | 'aguardando_aprovacao';
  pedido: string;
  dados: Record<string, string>;
  duracaoMs?: number;
  falha?: { etapa: string; detalhe: string; diagnostico: { titulo: string; detalhe: string; tom: 'erro' | 'aviso' }; erro: string };
  transferidaPara?: Pessoa;
  resultado?: Record<string, unknown>;
  conversa?: boolean;
  ip?: string;
  candidato?: { texto: string; confianca: number };
}

function dadosAleatorios(slug: string, a: Aleatorio, quem: Pessoa, inicio: number): { pedido: string; dados: Record<string, string> } {
  const cliente = a.escolher(CLIENTES);
  switch (slug) {
    case 'cadastrar_cliente': {
      const cnpj = cnpjAleatorio(a);
      const prazo = a.escolher(['15 dias', '30 dias', '30 dias', '30 dias', '45 dias', '60 dias']);
      const email = emailDe(cliente);
      const pedido = a.escolher([
        `cadastra o cliente ${cliente}, CNPJ ${cnpj}, prazo ${prazo}`,
        `novo cliente ${cliente}, CNPJ ${cnpj}, cobrança no ${email}`,
        `inclui a ${cliente} no sistema, CNPJ ${cnpj}`,
        `abre cadastro pra ${cliente}`,
      ]);
      return { pedido, dados: { nome_empresa: cliente, cnpj, email_cobranca: email, prazo_pagamento: prazo, responsavel: quem.nome } };
    }
    case 'alterar_plano': {
      const plano = a.escolher(['Básico', 'Pro', 'Pro', 'Premium']);
      const pedido = a.escolher([`muda o plano da ${cliente} para o ${plano}`, `altera o plano da ${cliente} para ${plano}`, `passa a ${cliente} para ${plano}`]);
      return { pedido, dados: { cliente, plano } };
    }
    case 'emitir_relatorio_vendas': {
      const d = new Date(inicio + FUSO_SP);
      const mesAnterior = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
      const ini = mesAnterior.toISOString().slice(0, 10);
      const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
      const agrupar = a.escolher(['vendedor', 'vendedor', 'região', 'produto']);
      const formato = a.escolher(['PDF', 'PDF', 'planilha']);
      const mes = MESES[mesAnterior.getUTCMonth()];
      const pedido = a.escolher([
        `relatório de vendas de ${mes} separado por ${agrupar}`,
        `me manda as vendas de ${mes} por ${agrupar} em ${formato === 'PDF' ? 'pdf' : 'planilha'}`,
        `relatório de vendas do mês passado por ${agrupar}`,
      ]);
      return { pedido, dados: { periodo_inicio: ini, periodo_fim: fim, agrupar_por: agrupar, formato } };
    }
    case 'agendar_visita': {
      const dias = a.entre(1, 6);
      const data = isoDia(new Date(inicio + dias * DIA));
      const horario = `${String(a.entre(8, 17)).padStart(2, '0')}:00`;
      const tecnico = a.escolher([...TECNICOS, 'Primeiro disponível']);
      const pedido = `agenda visita técnica na ${cliente} dia ${fmt.data(data + 'T12:00:00')} às ${horario.slice(0, 2)}h`;
      return { pedido, dados: { cliente, data, horario, tecnico } };
    }
    default: {
      const d = new Date(inicio + FUSO_SP);
      const comp = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      const doc = cnpjAleatorio(a);
      const pedido = a.escolher([
        `manda a segunda via do boleto de ${MESES[d.getUTCMonth()]} da ${cliente}`,
        `preciso da segunda via do boleto da ${cliente}, CNPJ ${doc}`,
        `2ª via do boleto ${comp} do CNPJ ${doc}`,
      ]);
      return { pedido, dados: { documento_pagador: doc, competencia: comp } };
    }
  }
}

const FALHAS: Record<string, ExecSeed['falha'][]> = {
  cadastrar_cliente: [
    {
      etapa: 'Criando o cadastro',
      detalhe: 'O Horizonte respondeu 409: o CNPJ já estava cadastrado.',
      diagnostico: { titulo: 'O CNPJ já estava cadastrado e nada foi gravado.', detalhe: 'O copiloto mostrou o cadastro existente para a pessoa.', tom: 'aviso' },
      erro: 'conflito',
    },
    {
      etapa: 'Criando o cadastro',
      detalhe: 'O Horizonte não respondeu em 15 s, nem depois de 2 novas tentativas.',
      diagnostico: { titulo: 'O Horizonte ficou fora do ar e nada foi gravado.', detalhe: 'A pessoa foi avisada para tentar de novo mais tarde.', tom: 'erro' },
      erro: 'sistema_indisponivel',
    },
  ],
  alterar_plano: [
    {
      etapa: 'Alterando o plano',
      detalhe: 'O Horizonte respondeu 409: o cliente já estava nesse plano.',
      diagnostico: { titulo: 'O cliente já estava nesse plano.', detalhe: 'Nada mudou no Horizonte.', tom: 'aviso' },
      erro: 'mesmo_plano',
    },
    {
      etapa: 'Alterando o plano',
      detalhe: 'O Horizonte respondeu 404: cliente não encontrado.',
      diagnostico: { titulo: 'O cliente não foi encontrado no Horizonte.', detalhe: 'O nome digitado não bate com nenhum cadastro.', tom: 'erro' },
      erro: 'cliente_nao_encontrado',
    },
  ],
  emitir_relatorio_vendas: [
    {
      etapa: 'Gerando o relatório',
      detalhe: 'O Horizonte não respondeu em 15 s, nem depois de 2 novas tentativas.',
      diagnostico: { titulo: 'O Horizonte demorou para responder e o relatório não foi gerado.', detalhe: 'A pessoa foi avisada para tentar de novo.', tom: 'erro' },
      erro: 'sistema_indisponivel',
    },
  ],
  agendar_visita: [
    {
      etapa: 'Selecionar horário',
      detalhe: 'A tela avisou que o técnico já tinha visita nesse horário.',
      diagnostico: { titulo: 'O técnico já tinha visita nesse horário e nada foi gravado.', detalhe: 'A pessoa foi avisada para escolher outro horário.', tom: 'aviso' },
      erro: 'regra_negocio',
    },
    {
      etapa: 'Abrir a tela de nova visita',
      detalhe: 'A tela não carregou em 30 s.',
      diagnostico: { titulo: 'A agenda do Horizonte não abriu e nada foi gravado.', detalhe: 'A pessoa foi avisada para tentar de novo.', tom: 'erro' },
      erro: 'tempo_esgotado',
    },
  ],
  segunda_via_boleto: [
    {
      etapa: 'Clicar em Buscar boletos',
      detalhe: 'Nenhum boleto encontrado para esse pagador nessa competência.',
      diagnostico: { titulo: 'Não havia boleto desse pagador nessa competência.', detalhe: 'A pessoa foi avisada e conferiu o mês.', tom: 'aviso' },
      erro: 'regra_negocio',
    },
  ],
};

const FALHA_TELA_MUDOU: NonNullable<ExecSeed['falha']> = {
  etapa: 'Clicar em Agendar visita',
  detalhe: 'Falhou: o botão “Agendar visita” não foi encontrado, a tela mudou.',
  diagnostico: {
    titulo: 'A tela de agendamento mudou e nada foi gravado.',
    detalhe:
      'O botão “Agendar visita” agora se chama “Confirmar agendamento”. Atualize o fluxo gravado para que as próximas visitas sejam agendadas sem ajuda. Até lá, esta tarefa vai transferir para o suporte quando não tiver certeza.',
    tom: 'erro',
  },
  erro: 'elemento_nao_encontrado',
};

/**
 * Prints de verdade da tela de agendamento mudada (tirados de uma execução real no Horizonte com a
 * demonstração "tela nova" ligada, já com os dados sensíveis borrados). Vão para o detalhe das falhas fixas.
 */
const PRINTS_AGENDA = [
  { arquivo: 'agenda-aberta.png', passo: 'Abrir a tela de nova visita', legenda: 'dados mascarados', destaque: null },
  {
    arquivo: 'agenda-preenchida.png',
    passo: 'Selecionar técnico',
    legenda: 'campos preenchidos',
    destaque: { x: 402, y: 378, w: 291, h: 36 },
  },
  {
    arquivo: 'agenda-candidato.png',
    passo: FALHA_TELA_MUDOU.etapa,
    legenda: 'botão parecido destacado pelo agente',
    destaque: { x: 179, y: 578, w: 199, h: 36 },
  },
];

/** Copia os prints da agenda para DATA_DIR/prints e devolve o id do print de cada passo. */
function semearPrints(ctx: Contexto, e: ExecSeed, quando: number): Map<string, string> {
  const pasta = path.join(ctx.config.dirDados, 'prints');
  fs.mkdirSync(pasta, { recursive: true });
  const ids = new Map<string, string>();
  PRINTS_AGENDA.forEach((p, i) => {
    const id = `prt_${e.id}_${i + 1}`;
    fs.copyFileSync(new URL(`./prints/${p.arquivo}`, import.meta.url), path.join(pasta, `${id}.png`));
    ctx.banco.inserir('prints', {
      id,
      execucao_id: e.id,
      fluxo_id: null,
      arquivo: `prints/${id}.png`,
      legenda: p.legenda,
      destaque: p.destaque,
      mascarado: 1,
      criado_em: iso(quando),
      apagar_em: null,
    });
    ids.set(p.passo, id);
  });
  return ids;
}

/** As execuções mais recentes, iguais às do design (C5, C6, W1, W7). Minutos antes de "agora". */
function execucoesFixas(agora: number): ExecSeed[] {
  const p = PESSOAS;
  const t = (min: number) => agora - min * MIN;
  return [
    {
      id: 'EX-20431',
      slug: 'cadastrar_cliente',
      quem: p.ana,
      inicio: t(3),
      status: 'concluida',
      pedido: 'cadastra o cliente ACME Logística, CNPJ 11.222.333/0001-81, prazo de pagamento 30 dias',
      dados: {
        nome_empresa: 'ACME Logística',
        cnpj: '11.222.333/0001-81',
        email_cobranca: 'financeiro@acmelog.com.br',
        prazo_pagamento: '30 dias',
        responsavel: 'Ana Ribeiro',
      },
      duracaoMs: 4100,
      resultado: { id: '4821', codigo: '#4821', titulo: 'Cliente ACME Logística criado (#4821)' },
      conversa: true,
    },
    {
      id: 'EX-20430',
      slug: 'segunda_via_boleto',
      quem: p.marcos,
      inicio: t(9),
      status: 'concluida',
      pedido: 'manda a segunda via do boleto de outubro da Transportes Vale',
      dados: { documento_pagador: '18.473.629/0001-14', competencia: isoMes(agora) },
      duracaoMs: 41_000,
      resultado: { titulo: `Segunda via do boleto ${isoMes(agora)} gerada`, gerados: { linha_digitavel: '23793.38128 60082.770004 31000.063304 1 96370000289900' } },
    },
    {
      id: 'EX-20428',
      slug: 'alterar_plano',
      quem: p.julia,
      inicio: t(21),
      status: 'aguardando_confirmacao',
      pedido: 'muda o plano da Padaria Estrela para o Pro a partir de novembro',
      dados: { cliente: 'Padaria Estrela', plano: 'Pro', a_partir_de: primeiroDoProximoMes(agora) },
    },
    {
      id: 'EX-20425',
      slug: 'emitir_relatorio_vendas',
      quem: p.paula,
      inicio: t(40),
      status: 'concluida',
      pedido: 'relatório de vendas de setembro separado por vendedor',
      dados: { periodo_inicio: '2026-09-01', periodo_fim: '2026-09-30', agrupar_por: 'vendedor', formato: 'PDF' },
      duracaoMs: 9200,
      resultado: { id: 'r8f2k1', titulo: 'Relatório de vendas pronto (214 linhas)' },
    },
    {
      id: 'EX-20424',
      slug: 'alterar_plano',
      quem: p.ana,
      inicio: t(122),
      status: 'aguardando_aprovacao',
      pedido: 'muda o plano da ACME para Premium',
      dados: { cliente: 'ACME Logística', plano: 'Premium' },
      conversa: true,
    },
    {
      id: 'EX-20422',
      slug: 'agendar_visita',
      quem: p.diego,
      inicio: t(56),
      status: 'concluida',
      pedido: 'agenda visita técnica na Metalúrgica Sul na segunda, 19/10, às 9h',
      dados: { cliente: 'Metalúrgica Sul', data: isoDia(new Date(agora + 2 * DIA)), horario: '09:00', tecnico: 'Carlos Mendes' },
      duracaoMs: 52_000,
      resultado: { titulo: 'Visita agendada na Metalúrgica Sul (protocolo VT-2026-0411)', gerados: { protocolo: 'VT-2026-0411' } },
    },
    {
      id: 'EX-20420',
      slug: 'segunda_via_boleto',
      quem: p.marcos,
      inicio: t(63),
      status: 'falhou',
      pedido: 'preciso da segunda via do boleto da Clínica Bem Viver, venceu dia 10',
      dados: { documento_pagador: '21.950.378/0001-26', competencia: '09/2026' },
      duracaoMs: 100_000,
      falha: FALHAS.segunda_via_boleto[0],
    },
    {
      id: 'EX-20419',
      slug: 'cadastrar_cliente',
      quem: p.paula,
      inicio: t(71),
      status: 'desfeita',
      pedido: 'cadastra a Farmácia Central, CNPJ 98.765.432/0001-98, prazo 15 dias',
      dados: {
        nome_empresa: 'Farmácia Central',
        cnpj: '98.765.432/0001-98',
        email_cobranca: 'financeiro@farmaciacentral.com.br',
        prazo_pagamento: '15 dias',
        responsavel: 'Paula Nunes',
      },
      duracaoMs: 5000,
      resultado: { id: '4819', codigo: '#4819', titulo: 'Cliente Farmácia Central criado (#4819)' },
    },
    {
      id: 'EX-20417',
      slug: 'agendar_visita',
      quem: p.ana,
      inicio: t(80),
      status: 'falhou',
      pedido: 'agenda visita técnica para a ACME Logística na quinta, 22/10, às 14h',
      dados: { cliente: 'ACME Logística', data: isoDia(new Date(agora + 5 * DIA)), horario: '14:00', tecnico: 'Primeiro disponível' },
      duracaoMs: 72_000,
      falha: FALHA_TELA_MUDOU,
      transferidaPara: p.camila,
      conversa: true,
      ip: '189.6.214.37',
      candidato: { texto: 'Confirmar agendamento', confianca: 0.58 },
    },
    {
      id: 'EX-20414',
      slug: 'alterar_plano',
      quem: p.rafael,
      inicio: t(99),
      status: 'cancelada',
      pedido: 'altera o plano da Loja Aurora para o Básico',
      dados: { cliente: 'Loja Aurora', plano: 'Básico' },
    },
    {
      id: 'EX-20411',
      slug: 'emitir_relatorio_vendas',
      quem: p.ana,
      inicio: t(112),
      status: 'falhou',
      pedido: 'relatório de vendas da semana por região, em planilha',
      dados: {
        periodo_inicio: isoDia(new Date(agora - 6 * DIA)),
        periodo_fim: isoDia(new Date(agora)),
        agrupar_por: 'região',
        formato: 'planilha',
      },
      duracaoMs: 12_000,
      falha: FALHAS.emitir_relatorio_vendas[0],
    },
    {
      id: 'EX-20410',
      slug: 'agendar_visita',
      quem: p.diego,
      inicio: t(150),
      status: 'falhou',
      pedido: 'agenda visita na Padaria Estrela amanhã às 9h',
      dados: { cliente: 'Padaria Estrela', data: isoDia(new Date(agora + DIA)), horario: '09:00', tecnico: 'Fernanda Lopes' },
      duracaoMs: 68_000,
      falha: FALHA_TELA_MUDOU,
      transferidaPara: p.camila,
      candidato: { texto: 'Confirmar agendamento', confianca: 0.52 },
    },
  ];
}

function isoMes(agora: number): string {
  const d = new Date(agora + FUSO_SP);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function primeiroDoProximoMes(agora: number): string {
  const d = new Date(agora + FUSO_SP);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** Execuções em massa: volume por dia (úteis 46–66, fins de semana 11–26) e por tarefa. */
function execucoesEmMassa(a: Aleatorio, agora: number, fixas: ExecSeed[]): ExecSeed[] {
  const hoje = inicioDoDiaSp(new Date(agora));
  const contadas = fixas.filter((f) => !['aguardando_confirmacao', 'cancelada'].includes(f.status));
  const restante: Record<string, { total: number; falhas: number }> = {};
  for (const [slug, v] of Object.entries(VOLUME)) {
    const f = contadas.filter((x) => x.slug === slug);
    restante[slug] = { total: v.total - f.length, falhas: v.falhas - f.filter((x) => x.status === 'falhou').length };
  }
  const total = Object.values(restante).reduce((s, v) => s + v.total, 0);

  // Volume por dia, ajustado para fechar o total.
  const dias = Array.from({ length: 30 }, (_, i) => hoje - (29 - i) * DIA);
  const fimDeSemana = (d: number) => [0, 6].includes(new Date(d).getUTCDay());
  const brutos = dias.map((d) => (fimDeSemana(d) ? a.entre(11, 26) : a.entre(46, 66)));
  // Hoje já tem as fixas: no máximo 8 a mais, para caber antes delas.
  brutos[29] = Math.min(brutos[29], 8);
  let soma = brutos.reduce((s, v) => s + v, 0);
  while (soma !== total) {
    const i = a.entre(0, 28);
    const lim = fimDeSemana(dias[i]) ? [11, 26] : [46, 66];
    if (soma < total && brutos[i] < lim[1] + 4) {
      brutos[i]++;
      soma++;
    } else if (soma > total && brutos[i] > lim[0]) {
      brutos[i]--;
      soma--;
    }
  }

  // Tarefa de cada execução (contagem exata por tarefa), em ordem aleatória.
  const tarefas = a.embaralhar(Object.entries(restante).flatMap(([slug, v]) => Array.from({ length: v.total }, () => slug)));
  const maisAntigaFixa = Math.min(...fixas.map((f) => f.inicio));
  const lista: ExecSeed[] = [];
  let k = 0;
  dias.forEach((d, i) => {
    for (let j = 0; j < brutos[i]; j++) {
      const slug = tarefas[k++];
      const inicio =
        i === 29
          ? maisAntigaFixa - a.entre(5, 300) * MIN - a.entre(0, 59) * 1000
          : emSp(d, a.entre(8 * 60, 18 * 60 + 30)).getTime() + a.entre(0, 59) * 1000;
      const quem = PESSOAS[a.escolher(QUEM_PEDE[slug])];
      const { pedido, dados } = dadosAleatorios(slug, a, quem, inicio);
      lista.push({ slug, quem, inicio, status: 'concluida', pedido, dados });
    }
  });

  // Falhas: só em dias anteriores a hoje (as de hoje são as fixas).
  for (const [slug, v] of Object.entries(restante)) {
    const candidatas = a.embaralhar(lista.filter((e) => e.slug === slug && e.inicio < hoje - FUSO_SP));
    for (const e of candidatas.slice(0, v.falhas)) {
      e.status = 'falhou';
      e.falha = a.escolher(FALHAS[slug]);
    }
  }
  // Alguns cadastros desfeitos pelo recibo.
  for (const e of a.embaralhar(lista.filter((x) => x.slug === 'cadastrar_cliente' && x.status === 'concluida')).slice(0, 6)) {
    e.status = 'desfeita';
  }
  return lista;
}

/** Execuções dos 30 dias anteriores (dias 30 a 59 antes de hoje), só para a comparação do painel. */
function execucoesPeriodoAnterior(a: Aleatorio, agora: number): ExecSeed[] {
  const hoje = inicioDoDiaSp(new Date(agora));
  const dias = Array.from({ length: 30 }, (_, i) => hoje - (59 - i) * DIA);
  const fimDeSemana = (d: number) => [0, 6].includes(new Date(d).getUTCDay());
  const total = Object.values(VOLUME_ANTERIOR).reduce((s, v) => s + v.total, 0);
  const brutos = dias.map((d) => (fimDeSemana(d) ? a.entre(9, 22) : a.entre(40, 58)));
  let soma = brutos.reduce((s, v) => s + v, 0);
  while (soma !== total) {
    const i = a.entre(0, 29);
    const lim = fimDeSemana(dias[i]) ? [9, 22] : [40, 58];
    if (soma < total && brutos[i] < lim[1] + 4) {
      brutos[i]++;
      soma++;
    } else if (soma > total && brutos[i] > lim[0]) {
      brutos[i]--;
      soma--;
    }
  }
  const tarefas = a.embaralhar(Object.entries(VOLUME_ANTERIOR).flatMap(([slug, v]) => Array.from({ length: v.total }, () => slug)));
  const lista: ExecSeed[] = [];
  let k = 0;
  dias.forEach((d, i) => {
    for (let j = 0; j < brutos[i]; j++) {
      const slug = tarefas[k++];
      const inicio = emSp(d, a.entre(8 * 60, 18 * 60 + 30)).getTime() + a.entre(0, 59) * 1000;
      const quem = PESSOAS[a.escolher(QUEM_PEDE[slug])];
      const { pedido, dados } = dadosAleatorios(slug, a, quem, inicio);
      lista.push({ slug, quem, inicio, status: 'concluida', pedido, dados });
    }
  });
  for (const [slug, v] of Object.entries(VOLUME_ANTERIOR)) {
    for (const e of a.embaralhar(lista.filter((x) => x.slug === slug)).slice(0, v.falhas)) {
      e.status = 'falhou';
      e.falha = a.escolher(FALHAS[slug]);
    }
  }
  for (const e of a.embaralhar(lista.filter((x) => x.slug === 'cadastrar_cliente' && x.status === 'concluida')).slice(0, 4)) {
    e.status = 'desfeita';
  }
  return lista;
}

function duracaoTipica(a: Aleatorio, caminho: 'api' | 'navegador', falhou: boolean): number {
  if (caminho === 'api') return (falhou ? a.entre(8, 20) : a.entre(3, 9)) * 1000 + a.entre(0, 999);
  return (falhou ? a.entre(55, 110) : a.entre(36, 62)) * 1000 + a.entre(0, 999);
}

/** Custo em R$ (modelo e navegador) próximo das médias do design. */
function custos(a: Aleatorio, slug: string, duracaoMs: number | null): { modelo: number; navegador: number | null } {
  const base: Record<string, number> = {
    cadastrar_cliente: 0.4,
    emitir_relatorio_vendas: 0.6,
    alterar_plano: 0.5,
    agendar_visita: 2.4,
    segunda_via_boleto: 2.1,
  };
  const variacao = 1 + (a.r() - 0.5) * 0.2;
  const modelo = Math.round(base[slug] * variacao * 100) / 100;
  const nav = ['agendar_visita', 'segunda_via_boleto'].includes(slug) ? Math.round(((duracaoMs ?? 48_000) / 60_000) * 0.8 * 100) / 100 : null;
  return { modelo, navegador: nav };
}

function semearExecucoes(ctx: Contexto, tarefas: Map<string, TarefaCriada>, agora: number, a: Aleatorio, b: Aleatorio) {
  const { banco } = ctx;
  const fixas = execucoesFixas(agora);
  const massa = execucoesEmMassa(a, agora, fixas);
  const todas = [...fixas, ...massa].sort((x, y) => y.inicio - x.inicio);
  // O período anterior usa outro gerador: assim os últimos 30 dias saem iguais com ou sem ele.
  const anteriores = execucoesPeriodoAnterior(b, agora).sort((x, y) => y.inicio - x.inicio);
  const usados = new Set(fixas.map((f) => f.id!));
  let cursor = Math.min(...fixas.map((f) => Number(f.id!.slice(3)))) - 1;
  for (const e of [...todas, ...anteriores]) {
    if (e.id) continue;
    while (usados.has(`EX-${cursor}`)) cursor--;
    e.id = `EX-${cursor--}`;
  }

  const sistema = ctx.adaptador.nome;
  const ger = new Map<ExecSeed, Aleatorio>([...todas.map((e) => [e, a] as const), ...anteriores.map((e) => [e, b] as const)]);
  for (const [e, a] of ger) {
    const t = tarefas.get(e.slug)!;
    const caminho = t.def.caminho;
    const rodou = !['aguardando_confirmacao', 'cancelada', 'aguardando_aprovacao'].includes(e.status);
    const duracao = rodou ? (e.duracaoMs ?? duracaoTipica(a, caminho, e.status === 'falhou')) : null;
    const custo = custos(a, e.slug, duracao);
    const confirmadoEm = e.inicio + a.entre(4, 9) * 1000;
    const inicioExec = confirmadoEm + 500;
    const fim = duracao ? inicioExec + duracao : null;
    const resultado = e.status === 'concluida' || e.status === 'desfeita' ? (e.resultado ?? resultadoPadrao(t.def, e, a)) : null;
    let conversaId: string | null = null;
    if (e.conversa) conversaId = semearConversa(ctx, e, t, { confirmadoEm, fim, resultado });
    banco.inserir('execucoes', {
      id: e.id,
      conversa_id: conversaId,
      usuario_id: e.quem.id,
      usuario_nome: e.quem.nome,
      tarefa_id: t.id,
      tarefa_nome: t.def.nome,
      tarefa_versao: t.versao,
      pedido: e.pedido,
      caminho,
      status: e.status,
      canal: 'widget',
      dados: e.dados,
      resultado,
      erro: e.falha?.erro ?? null,
      diagnostico: e.falha?.diagnostico ?? null,
      criado_em: iso(e.inicio),
      iniciado_em: rodou ? iso(inicioExec) : null,
      concluido_em: fim ? iso(fim) : null,
      duracao_ms: duracao,
      custo_modelo: e.status === 'cancelada' || e.status === 'aguardando_confirmacao' ? 0.4 : custo.modelo,
      custo_navegador: rodou ? custo.navegador : null,
      confirmado_por: rodou || e.status === 'aguardando_aprovacao' ? e.quem.nome : null,
      confirmado_em: rodou ? iso(confirmadoEm) : null,
      ip: rodou ? (e.ip ?? `189.6.${a.entre(10, 250)}.${a.entre(2, 250)}`) : null,
      desfazer_ate: null,
      transferida_para: e.transferidaPara?.nome ?? null,
      transferida_em: e.transferidaPara && fim ? iso(fim) : null,
      exemplo: 1,
    });
    const prints = e.falha === FALHA_TELA_MUDOU && e.candidato ? semearPrints(ctx, e, inicioExec) : undefined;
    semearEventos(banco, e, t, sistema, { confirmadoEm, inicioExec, fim, resultado }, prints);
    if (e.slug === 'alterar_plano' && (e.status === 'aguardando_aprovacao' || ((e.quem.id === '101' || e.quem.id === '103') && rodou))) {
      const aprovador = PESSOAS.rafael;
      banco.inserir('aprovacoes', {
        id: novoId('apr'),
        execucao_id: e.id,
        solicitante_id: e.quem.id,
        solicitante_nome: e.quem.nome,
        aprovador_id: aprovador.id,
        aprovador_nome: aprovador.nome,
        perfil_necessario: 'Gestor financeiro',
        estado: e.status === 'aguardando_aprovacao' ? 'enviada' : 'aprovada',
        motivo: null,
        mensagem_id: null,
        criado_em: iso(e.inicio + 10_000),
        decidido_em: e.status === 'aguardando_aprovacao' ? null : iso(e.inicio + 40 * MIN),
        decidido_por: e.status === 'aguardando_aprovacao' ? null : aprovador.nome,
      });
    }
  }
  // Próximas execuções reais continuam a numeração depois das de exemplo.
  banco.executar(
    `INSERT INTO sequencias (nome, valor) VALUES ('execucao', ?) ON CONFLICT(nome) DO UPDATE SET valor = excluded.valor`,
    Math.max(...fixas.map((f) => Number(f.id!.slice(3)))),
  );
  return todas.length + anteriores.length;
}

function resultadoPadrao(def: TarefaDefinicao, e: ExecSeed, a: Aleatorio): Record<string, unknown> {
  switch (e.slug) {
    case 'cadastrar_cliente': {
      const id = String(a.entre(3200, 4800));
      return { id, codigo: `#${id}`, titulo: fmt.preencherModelo(def.tituloRecibo, { ...e.dados, id }) };
    }
    case 'alterar_plano':
      return { id: String(a.entre(900, 1900)), titulo: `Plano de ${e.dados.cliente} alterado para ${e.dados.plano}` };
    case 'emitir_relatorio_vendas':
      return { id: crypto.randomBytes(3).toString('hex'), titulo: `Relatório de vendas pronto (${a.entre(80, 320)} linhas)` };
    case 'agendar_visita': {
      const protocolo = `VT-2026-0${a.entre(100, 410)}`;
      return { titulo: `Visita agendada na ${e.dados.cliente} (protocolo ${protocolo})`, gerados: { protocolo } };
    }
    default:
      return { titulo: `Segunda via do boleto ${e.dados.competencia} gerada` };
  }
}

function camposDe(def: TarefaDefinicao, dados: Record<string, string>): { rotulo: string; valor: string }[] {
  return camposExibidos(def, dados).map((c) => ({ rotulo: c.rotulo, valor: c.valor }));
}

function semearEventos(
  banco: Banco,
  e: ExecSeed,
  t: TarefaCriada,
  sistema: string,
  m: { confirmadoEm: number; inicioExec: number; fim: number | null; resultado: Record<string, unknown> | null },
  prints?: Map<string, string>,
) {
  let n = 0;
  const ev = (
    ts: number,
    x: { tipo: string; titulo: string; detalhe?: string; estado: string; dados?: unknown; candidato?: unknown; fim?: number },
  ) =>
    banco.inserir('execucao_eventos', {
      id: `${e.id}-${++n}`,
      execucao_id: e.id,
      ts: iso(ts),
      tipo: x.tipo,
      titulo: x.titulo,
      detalhe: x.detalhe ?? null,
      estado: x.estado,
      dados: x.dados ?? null,
      // Prints nos passos e na recuperação visual (o botão candidato destacado), como no design (C6).
      print_id: (x.tipo === 'recuperacao' ? prints?.get(e.falha!.etapa) : x.tipo === 'passo' ? prints?.get(x.titulo) : undefined) ?? null,
      candidato: x.candidato ?? null,
      fim: x.fim ? iso(x.fim) : null,
    });
  const primeiro = fmt.primeiroNome(e.quem.nome);
  ev(e.inicio, { tipo: 'pedido', titulo: 'Pedido recebido', detalhe: `Pelo widget: “${e.pedido}”.`, estado: 'info' });
  if (e.status === 'aguardando_confirmacao') return;
  if (e.status === 'cancelada') {
    ev(e.inicio + 30_000, { tipo: 'aviso', titulo: `Cancelada por ${e.quem.nome}`, detalhe: 'Nada foi gravado.', estado: 'info' });
    return;
  }
  if (e.status === 'aguardando_aprovacao') {
    ev(e.inicio + 10_000, {
      tipo: 'aviso',
      titulo: 'Pedido de aprovação enviado a Rafael Lima',
      detalhe: `${primeiro} não tem o perfil Gestor financeiro. Nada muda até a aprovação.`,
      estado: 'aviso',
    });
    return;
  }
  ev(m.confirmadoEm, { tipo: 'confirmacao', titulo: `Dados confirmados por ${e.quem.nome}`, estado: 'ok', dados: camposDe(t.def, e.dados) });
  const fim = m.fim ?? m.inicioExec;
  const passos: { titulo: string; detalhe?: string; dados?: unknown }[] = [];
  if (t.def.caminho === 'api') {
    const api = t.def.api!;
    if (api.verificarAntes) passos.push({ titulo: api.verificarAntes.descricao, detalhe: api.verificarAntes.detalheOk });
    passos.push({
      titulo: api.rotuloExecucao ?? `Gravando no ${sistema}`,
      dados: [
        { rotulo: 'Chamada', valor: `${api.metodo} ${api.caminho}` },
        { rotulo: 'Resposta', valor: e.status === 'falhou' ? 'erro' : `201 em ${200 + (n * 37) % 300} ms` },
      ],
    });
    if (api.conferirDepois) passos.push({ titulo: api.conferirDepois.descricao, detalhe: api.conferirDepois.detalheOk });
  } else {
    passos.push({
      titulo: `Login com a sessão de ${primeiro}`,
      detalhe: `O navegador abriu o ${sistema} com as permissões de ${primeiro}. A sessão vale só para esta execução.`,
    });
    const fluxo = fluxosExemplo()?.[e.slug === 'agendar_visita' ? 'agendar_visita' : 'segunda_via_boleto'];
    for (const p of fluxo?.passos ?? []) {
      // Na tela nova, o campo de data também mudou de nome, mas a recuperação visual teve certeza.
      const recuperado = e.falha === FALHA_TELA_MUDOU && p.titulo === 'Preencher data da visita';
      passos.push({ titulo: p.titulo, detalhe: recuperado ? 'O campo “Data da visita” agora se chama “Data”. A recuperação visual achou o campo com 93% de confiança e seguiu.' : undefined });
    }
  }
  const falhaEm = e.falha ? Math.max(0, passos.findIndex((p) => p.titulo === e.falha!.etapa)) : -1;
  const ate = e.falha ? (falhaEm >= 0 && passos[falhaEm]?.titulo === e.falha.etapa ? falhaEm : passos.length - 1) : passos.length;
  const passo = (fim - m.inicioExec) / Math.max(1, passos.length + 1);
  for (let i = 0; i < ate; i++) {
    const p = passos[i];
    ev(m.inicioExec + i * passo, { tipo: t.def.caminho === 'api' ? 'api' : i === 0 ? 'login' : 'passo', titulo: p.titulo, detalhe: p.detalhe, estado: 'ok', dados: p.dados });
  }
  if (e.falha) {
    ev(m.inicioExec + ate * passo, { tipo: 'falha', titulo: e.falha.etapa, detalhe: e.falha.detalhe, estado: 'falhou' });
    if (e.candidato) {
      ev(m.inicioExec + ate * passo + 3000, {
        tipo: 'recuperacao',
        titulo: 'Recuperação visual tentou 2 vezes',
        detalhe: `O agente procurou na tela ${e.falha.etapa.startsWith('Clicar') ? 'um botão parecido' : 'um campo parecido'}. Achou “${e.candidato.texto}” no mesmo lugar, mas não ${e.falha.etapa.startsWith('Clicar') ? 'clicou' : 'usou'}: baixa confiança, preferi não arriscar.`,
        estado: 'aviso',
        candidato: e.candidato,
        fim: m.inicioExec + ate * passo + 30_000,
      });
    }
    if (e.transferidaPara) {
      ev(fim, {
        tipo: 'transferencia',
        titulo: 'Transferida para pessoa',
        detalhe: `${e.transferidaPara.nome} (Suporte) recebeu o caso com os dados confirmados. ${primeiro} foi avisada no widget de que nada foi gravado.`,
        estado: 'info',
      });
    }
    return;
  }
  ev(fim, { tipo: 'conclusao', titulo: 'Concluída', detalhe: String(m.resultado?.titulo ?? ''), estado: 'ok' });
  if (e.status === 'desfeita') {
    ev(fim + 2 * MIN, { tipo: 'desfeito', titulo: `Desfeita por ${e.quem.nome} pelo recibo`, detalhe: `O cadastro foi excluído do ${sistema}.`, estado: 'info' });
  }
}

// ------------------------------------------------------------------ conversas de exemplo

function semearConversa(
  ctx: Contexto,
  e: ExecSeed,
  t: TarefaCriada,
  m: { confirmadoEm: number; fim: number | null; resultado: Record<string, unknown> | null },
): string {
  const { banco } = ctx;
  const id = novoId('cv');
  const fimConversa = m.fim ?? e.inicio + 30_000;
  const transferida = !!e.transferidaPara;
  banco.inserir('conversas', {
    id,
    usuario_id: e.quem.id,
    usuario_nome: e.quem.nome,
    canal: 'widget',
    usar_rascunhos: 0,
    contexto: { secao: e.slug === 'agendar_visita' ? 'Agenda' : 'Clientes' },
    estado: transferida
      ? { modo: 'pessoa', atendente: { nome: e.transferidaPara!.nome, iniciais: fmt.iniciais(e.transferidaPara!.nome), papel: 'Suporte' } }
      : { modo: 'copiloto' },
    atendente_id: null,
    criado_em: iso(e.inicio - 1000),
    atualizado_em: iso(fimConversa),
    encerrada_em: iso(fimConversa + 20 * MIN),
  });
  let seq = 0;
  const msg = (ts: number, autor: MensagemWidget['autor'], corpo: Partial<MensagemWidget>) =>
    banco.inserir('mensagens', {
      id: novoId('msg'),
      conversa_id: id,
      seq: ++seq,
      autor,
      corpo: { blocos: [], ...corpo },
      criado_em: iso(ts),
    });
  const campos: CampoExibido[] = camposExibidos(t.def, e.dados);
  msg(e.inicio, 'usuario', { texto: e.pedido });

  if (e.status === 'aguardando_aprovacao') {
    msg(e.inicio + 3000, 'copiloto', {
      texto: `Seu acesso não permite essa mudança: **${t.def.nome}** exige o perfil **Gestor financeiro**.`,
      blocos: [
        {
          tipo: 'aprovacao',
          aprovacaoId: 'exemplo',
          execucaoId: e.id!,
          campos: [
            { rotulo: 'Pedido', valor: t.def.nome },
            { rotulo: 'Cliente', valor: 'ACME Logística · #4821' },
            { rotulo: 'Mudança', valor: `Básico para ${e.dados.plano}` },
          ],
          aprovador: { id: PESSOAS.rafael.id, nome: PESSOAS.rafael.nome },
          estado: 'enviada',
        },
      ],
    });
    msg(e.inicio + 12_000, 'sistema', {
      texto: 'Pedido de aprovação enviado a Rafael Lima. Aviso você aqui quando ele responder.',
      icone: 'relogio',
    });
    return id;
  }

  const dataTexto = e.dados.data ? `${fmt.data(e.dados.data + 'T12:00:00')}, às ${e.dados.horario}` : '';
  msg(e.inicio + 2000, 'copiloto', {
    texto:
      e.slug === 'agendar_visita'
        ? `Vou agendar uma visita técnica na ${e.dados.cliente} em ${dataTexto}. Confere?`
        : 'Tenho tudo. Confira antes de eu gravar: nada foi salvo no Horizonte ainda.',
    nota: 'Só gravo depois que você confirmar.',
    blocos: [
      {
        tipo: 'confirmacao',
        execucaoId: e.id!,
        tarefa: t.def.nome,
        titulo: t.def.tituloConfirmacao,
        campos,
        caminho: t.def.caminho,
        tempoEstimado: t.def.tempoEstimado ?? 'cerca de 5 s',
        desfazerMinutos: t.def.desfazerMinutos,
        estado: 'confirmado',
        confirmadoEm: iso(m.confirmadoEm),
      },
    ],
  });
  msg(m.confirmadoEm + 200, 'sistema', { texto: `Você confirmou ${t.def.nome.toLowerCase()} às ${fmt.hora(iso(m.confirmadoEm))}`, icone: 'check' });

  if (e.status === 'falhou' && transferida) {
    msg(fimConversa, 'copiloto', {
      texto: `Não consegui concluir: a tela de agendamento mudou. Nada foi gravado. Passei o pedido para a ${e.transferidaPara!.nome}, do suporte, que vai agendar e te avisar por aqui.`,
    });
    msg(fimConversa + 60_000, 'pessoa', {
      autorNome: e.transferidaPara!.nome,
      autorIniciais: fmt.iniciais(e.transferidaPara!.nome),
      texto: `Oi, ${fmt.primeiroNome(e.quem.nome)}! Já estou com o seu pedido e aviso aqui assim que a visita estiver marcada.`,
    });
    return id;
  }
  if (m.resultado) {
    const via = t.def.caminho === 'api' ? 'via API' : 'pela tela';
    msg(fimConversa, 'copiloto', {
      blocos: [
        {
          tipo: 'recibo',
          execucaoId: e.id!,
          titulo: String(m.resultado.titulo),
          campos: campos.filter((c) => !String(m.resultado!.titulo).includes(c.valor)),
          resumo: `Feito ${via} em ${fmt.duracao((m.fim ?? 0) - m.confirmadoEm)} · ${e.id}`,
          link: m.resultado.id && t.def.api?.linkResultado
            ? { rotulo: `Abrir no ${ctx.adaptador.nome}`, url: `${ctx.adaptador.urlBase}${fmt.preencherModelo(t.def.api.linkResultado, { id: String(m.resultado.id) })}` }
            : undefined,
        },
      ],
    });
  }
  return id;
}

// ------------------------------------------------------------------ equipe, pedidos, auditoria

/** Equipe da demonstração. Quem está ativo entra com SENHA_PADRAO (conta da plataforma). */
const EQUIPE_DEMO: { nome: string | null; email: string; perfil: string; status: string; acesso: number | null; criado: number }[] = [
  { nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', perfil: 'admin', status: 'ativo', acesso: 2 * MIN, criado: 75 },
  { nome: 'Júlia Martins', email: 'julia.martins@seusistema.com.br', perfil: 'admin', status: 'ativo', acesso: 3 * HORA, criado: 70 },
  { nome: 'Camila Souza', email: 'camila.souza@seusistema.com.br', perfil: 'suporte', status: 'ativo', acesso: 70 * MIN, criado: 40 },
  { nome: 'Bruno Costa', email: 'bruno.costa@seusistema.com.br', perfil: 'leitor', status: 'ativo', acesso: 3 * DIA, criado: 25 },
  { nome: null, email: 'leticia.prado@seusistema.com.br', perfil: 'suporte', status: 'convidado', acesso: null, criado: 2 },
];

function semearEquipe(ctx: Contexto, agora: number) {
  for (const m of EQUIPE_DEMO) {
    const convidado = m.status === 'convidado';
    ctx.banco.inserir('equipe', {
      id: novoId('mbr'),
      nome: m.nome,
      email: m.email,
      perfil: m.perfil,
      status: m.status,
      convite_token: convidado ? tokenDaEmpresa(ctx.empresa.id, 18) : null,
      convite_enviado_em: convidado ? iso(agora - 2 * DIA) : null,
      convite_expira_em: convidado ? iso(agora + 5 * DIA) : null,
      ultimo_acesso: m.acesso ? iso(agora - m.acesso) : null,
      criado_em: iso(agora - m.criado * DIA),
    });
  }
}

const PEDIDOS_SEM_TAREFA: { tema: string; textos: string[]; vezes: number }[] = [
  {
    tema: 'cancelar assinatura',
    vezes: 14,
    textos: [
      'quero cancelar a assinatura do cliente Delta Transportes',
      'encerra o contrato da Pólen Café',
      'cancela a assinatura da Loja Aurora',
      'como faço pra cancelar o plano de um cliente?',
    ],
  },
  { tema: 'emitir nota fiscal', vezes: 4, textos: ['emite a nota fiscal da ACME Logística', 'gera a NF de outubro da Padaria Estrela'] },
  { tema: 'trocar senha', vezes: 2, textos: ['troca minha senha do Horizonte', 'esqueci minha senha'] },
];

function semearPedidos(banco: Banco, agora: number, a: Aleatorio) {
  for (const p of PEDIDOS_SEM_TAREFA) {
    for (let i = 0; i < p.vezes; i++) {
      const quem = a.escolher(Object.values(PESSOAS));
      banco.inserir('pedidos', {
        id: novoId('ped'),
        conversa_id: null,
        usuario_id: quem.id,
        texto: p.textos[i % p.textos.length],
        tipo: 'sem_tarefa',
        tarefa_slug: null,
        tema: p.tema,
        ignorado: 0,
        criado_em: iso(agora - a.entre(1, 29) * DIA - a.entre(0, 600) * MIN),
      });
    }
  }
}

function semearAuditoria(banco: Banco, agora: number, tarefas: Map<string, TarefaCriada>) {
  const registros: { dias: number; ator: string; acao: string; alvo: string; detalhe?: string }[] = [];
  for (const t of TAREFAS_SEED) {
    t.versoes.forEach((v, i) =>
      registros.push({ dias: v.diasAtras, ator: v.por, acao: 'publicou a tarefa', alvo: tarefas.get(t.slug)!.def.nome, detalhe: `Versão ${i + 1}: ${v.resumo}` }),
    );
  }
  registros.push(
    { dias: 8, ator: 'Rafael Lima', acao: 'alterou os limites de gasto', alvo: 'Limites', detalhe: 'Limite mensal de R$ 1.200,00 para R$ 1.500,00' },
    { dias: 8, ator: 'Rafael Lima', acao: 'alterou a segurança', alvo: 'Segurança', detalhe: 'Guardar prints por 90 dias' },
    { dias: 2, ator: 'Rafael Lima', acao: 'convidou', alvo: 'leticia.prado@seusistema.com.br', detalhe: 'Perfil Suporte' },
    { dias: 25, ator: 'Júlia Martins', acao: 'convidou', alvo: 'bruno.costa@seusistema.com.br', detalhe: 'Perfil Leitor' },
    { dias: 19, ator: 'Júlia Martins', acao: 'publicou o fluxo', alvo: 'Agendar visita técnica', detalhe: 'Versão 2' },
    { dias: 61, ator: 'Júlia Martins', acao: 'publicou o fluxo', alvo: 'Segunda via de boleto', detalhe: 'Versão 1' },
  );
  for (const r of registros) {
    banco.inserir('auditoria', {
      id: novoId('aud'),
      ts: iso(agora - r.dias * DIA - 90 * MIN),
      ator: r.ator,
      acao: r.acao,
      alvo: r.alvo,
      detalhe: r.detalhe ?? null,
    });
  }
}

// ------------------------------------------------------------------ entrada

export interface ResumoSeed {
  equipe: number;
  tarefas: number;
  execucoes: number;
  fontes: number;
}

/** Banco sem ninguém na equipe: primeiro início, precisa de seed. */
export function bancoVazio(banco: Banco): boolean {
  return !banco.um('SELECT 1 FROM equipe LIMIT 1');
}

/** Grava todos os dados de exemplo. Use num banco vazio. */
export function semear(ctx: Contexto, opcoes: { agora?: Date; semente?: number } = {}): ResumoSeed {
  const agora = (opcoes.agora ?? new Date()).getTime();
  const a = aleatorio(opcoes.semente ?? 20431);
  const b = aleatorio((opcoes.semente ?? 20431) + 1);
  return ctx.banco.transacao(() => {
    semearEquipe(ctx, agora);
    const tarefas = semearTarefas(ctx.banco, agora);
    const execucoes = semearExecucoes(ctx, tarefas, agora, a, b);
    semearPedidos(ctx.banco, agora, a);
    semearAuditoria(ctx.banco, agora, tarefas);
    const conhecimento = semearConhecimento(ctx.banco, new Date(agora));
    return { equipe: EQUIPE_DEMO.length, tarefas: tarefas.size, execucoes, fontes: conhecimento.fontes };
  });
}

/** Plataforma sem nenhuma empresa: primeiro início, precisa de seed. */
export function plataformaVazia(plataforma: Plataforma): boolean {
  return plataforma.listarEmpresas().length === 0;
}

/**
 * Cria a empresa de demonstração (o Horizonte, ligado pela API do sistema de exemplo), grava os
 * dados de exemplo no banco dela e cria as contas da equipe com SENHA_PADRAO.
 */
export function semearPlataforma(
  plataforma: Plataforma,
  opcoes: { agora?: Date; semente?: number } = {},
): ResumoSeed & { empresa: Empresa } {
  const { config } = plataforma;
  const empresa = plataforma.criarEmpresa({
    nome: config.sistema.nome,
    demo: true,
    chavePublica: process.env.WIDGET_CHAVE_PUBLICA || 'pk_local_horizonte',
    sistema: { ...sistemaNovo(config.sistema.nome, config.sistema.urlBase), conector: 'api' },
  });
  const ctx = plataforma.contexto(empresa.id);
  const resumo = semear(ctx, opcoes);
  for (const m of EQUIPE_DEMO) {
    if (m.status !== 'ativo') continue;
    if (!plataforma.conta(m.email)) plataforma.criarConta({ email: m.email, nome: m.nome, senha: SENHA_PADRAO });
    plataforma.vincular(m.email, empresa.id);
  }
  return { ...resumo, empresa };
}

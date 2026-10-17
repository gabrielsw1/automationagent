// Dados iniciais do Horizonte. As datas de boletos e visitas são relativas ao dia em que o
// servidor sobe, para a demonstração sempre ter "o boleto deste mês" e "visitas da semana".
//
// Reservado para demonstrações de cadastro (não use em dados iniciais):
//   - CNPJ 11.222.333/0001-81 (livre)
//   - razão social "ACME Logística" (o exemplo de cadastro novo do design)
import { Aleatorio } from '../util/aleatorio.ts';
import {
  centavos,
  competenciaDe,
  dataSP,
  fimDeSemana,
  inicioCompetencia,
  proximoDiaUtil,
  somarDias,
  ultimasCompetencias,
} from '../util/datas.ts';
import { completarCnpj, completarCpf } from '../util/texto.ts';
import { calcularRelatorio } from '../relatorios.ts';
import {
  PRECO_PLANO,
  TECNICOS,
  VERSAO_ESTADO,
  type AgruparPor,
  type AlteracaoPlano,
  type Boleto,
  type Chamado,
  type Cliente,
  type Estado,
  type FormatoRelatorio,
  type Plano,
  type Prioridade,
  type Relatorio,
  type Visita,
} from './tipos.ts';

type LinhaCliente = [id: string, razao: string, cnpjBase: string, email: string, prazo: number, plano: Plano, resp: string, criado: string];

const CLIENTES: LinhaCliente[] = [
  ['1024', 'Padaria Estrela Ltda', '073845120001', 'financeiro@padariaestrela.com.br', 30, 'Básico', '103', '2023-02-14T13:20:00Z'],
  ['1187', 'Transportes Vale Ltda', '184736290001', 'cobranca@transportesvale.com.br', 30, 'Pro', '101', '2023-04-03T17:05:00Z'],
  ['1342', 'Clínica Bem Viver Ltda', '219503780001', 'financeiro@clinicabemviver.com.br', 45, 'Premium', '103', '2023-07-19T12:40:00Z'],
  ['1519', 'Metalúrgica Sul S.A.', '038271650001', 'contasapagar@metalurgicasul.ind.br', 60, 'Premium', '105', '2023-10-02T14:10:00Z'],
  ['1876', 'Loja Aurora Ltda', '297461830001', 'financeiro@lojaaurora.com.br', 15, 'Básico', '103', '2024-01-22T16:30:00Z'],
  ['2045', 'Pólen Café Ltda', '315829470001', 'contato@polencafe.com.br', 30, 'Básico', '101', '2024-03-11T11:15:00Z'],
  ['2233', 'Delta Transportes Ltda', '096153280001', 'financeiro@deltatransportes.com.br', 45, 'Pro', '103', '2024-05-06T19:45:00Z'],
  ['2410', 'Farmácia Central Ltda', '142679350001', 'adm@farmaciacentral.com.br', 30, 'Pro', '101', '2024-07-15T13:00:00Z'],
  ['2588', 'Escola Raízes Ltda', '268340910001', 'secretaria@escolaraizes.com.br', 30, 'Pro', '103', '2024-09-02T12:25:00Z'],
  ['2761', 'Hotel Mirante do Lago Ltda', '051927380001', 'financeiro@hotelmirantedolago.com.br', 45, 'Premium', '101', '2024-11-18T18:00:00Z'],
  ['2934', 'Construtora Pilar Ltda', '334185620001', 'compras@construtorapilar.com.br', 60, 'Pro', '105', '2025-01-20T14:35:00Z'],
  ['3057', 'Auto Peças Rota 116 Ltda', '407219850001', 'financeiro@rota116pecas.com.br', 15, 'Básico', '103', '2025-03-10T15:50:00Z'],
  ['3190', 'ACME Log Ltda', '123456780001', 'contato@acmelog.com.br', 15, 'Básico', '101', '2025-05-12T13:10:00Z'],
  ['3342', 'Laboratório Vida Clara Ltda', '186452730001', 'financeiro@vidaclara.med.br', 30, 'Premium', '103', '2025-07-07T17:20:00Z'],
  ['3518', 'Mercado Bom Preço Ltda', '259873140001', 'financeiro@mercadobompreco.com.br', 30, 'Pro', '101', '2025-09-15T12:05:00Z'],
  ['3786', 'Gráfica Ponto Final Ltda', '421768930001', 'contato@graficapontofinal.com.br', 15, 'Básico', '103', '2025-12-01T14:45:00Z'],
  ['4102', 'Estúdio Movimento Pilates Ltda', '362915470001', 'administrativo@estudiomovimento.com.br', 30, 'Básico', '101', '2026-03-09T13:30:00Z'],
  ['4455', 'Agropecuária Campo Verde Ltda', '088437160001', 'financeiro@campoverdeagro.com.br', 45, 'Pro', '105', '2026-06-01T16:15:00Z'],
  ['4690', 'Contabilidade Prisma Ltda', '445029380001', 'contato@prismacontabil.com.br', 30, 'Básico', '103', '2026-08-17T11:40:00Z'],
  ['4817', 'Vidraçaria Cristal Ltda', '473816250001', 'financeiro@vidracariacristal.com.br', 30, 'Básico', '101', '2026-10-06T14:20:00Z'],
];

/** Mudanças de plano já feitas (o cliente está hoje no plano novo). */
const ALTERACOES: [id: string, clienteId: string, anterior: Plano, novo: Plano, aPartirDe: string][] = [
  ['83', '1187', 'Básico', 'Pro', '2025-08-01'],
  ['84', '2761', 'Pro', 'Premium', '2025-11-01'],
  ['85', '1342', 'Pro', 'Premium', '2026-02-01'],
  ['86', '3518', 'Básico', 'Pro', '2026-05-01'],
];

/** Boletos em atraso de propósito: [cliente, quantos meses atrás (0 = competência atual)]. */
const EM_ATRASO: [string, number][] = [
  ['1187', 1], // Transportes Vale: setembro vencido
  ['1342', 1], // Clínica Bem Viver: dois meses vencidos
  ['1342', 2],
  ['1876', 1], // Loja Aurora
  ['3057', 0], // Auto Peças: vencido no mês atual
];

/** Pagadores pessoa física (serviços avulsos). */
const PAGADORES_CPF: { nome: string; cpfBase: string; descricao: (i: number, total: number) => string; valor: number; meses: number }[] = [
  {
    nome: 'Mariana Couto Ferreira',
    cpfBase: '384915276',
    descricao: (i, total) => `Instalação de rede Wi-Fi residencial, parcela ${total - i} de ${total}`,
    valor: 420,
    meses: 3,
  },
  {
    nome: 'Roberto Antunes Lima',
    cpfBase: '271604938',
    descricao: () => 'Suporte técnico residencial, mensalidade',
    valor: 89.9,
    meses: 6,
  },
  {
    nome: 'Beatriz Siqueira Prado',
    cpfBase: '615203847',
    descricao: () => 'Visita técnica avulsa',
    valor: 280,
    meses: 1,
  },
];

function planoNaData(clienteId: string, planoAtual: Plano, data: string): Plano {
  const doCliente = ALTERACOES.filter((a) => a[1] === clienteId).sort((a, b) => a[4].localeCompare(b[4]));
  if (doCliente.length === 0) return planoAtual;
  let plano = doCliente[0][2];
  for (const a of doCliente) if (a[4] <= data) plano = a[3];
  return plano;
}

/** Boletos dos últimos 12 meses para os clientes (e alguns pagadores pessoa física). */
export function gerarBoletos(hoje: string, clientes: Cliente[]): Boleto[] {
  const r = new Aleatorio('boletos');
  const competencias = ultimasCompetencias(hoje, 12).reverse();
  const boletos: Boleto[] = [];
  let numero = 700101;
  const novo = (b: Omit<Boleto, 'numero' | 'nosso_numero' | 'segundas_vias'>): void => {
    const n = String(numero++);
    boletos.push({ numero: n, nosso_numero: n.padStart(11, '0'), segundas_vias: [], ...b });
  };

  competencias.forEach((competencia, i) => {
    const mesesAtras = competencias.length - 1 - i;
    const emissao = inicioCompetencia(competencia);
    for (const c of clientes) {
      if (c.criado_em.slice(0, 7) >= emissao.slice(0, 7)) continue; // primeiro boleto: mês seguinte ao cadastro
      const vencimento = proximoDiaUtil(somarDias(emissao, c.prazo_pagamento_dias));
      const plano = planoNaData(c.id, c.plano, emissao);
      const atrasado = EM_ATRASO.some(([id, m]) => id === c.id && m === mesesAtras);
      let pagoEm: string | null = null;
      if (!atrasado) {
        if (vencimento < hoje) {
          const antes = r.inteiro(0, 4);
          pagoEm = proximoDiaUtil(somarDias(vencimento, -antes));
          if (pagoEm > vencimento || pagoEm < emissao) pagoEm = vencimento;
        } else if (r.proximo() < 0.12 && emissao < hoje) {
          pagoEm = proximoDiaUtil(somarDias(emissao, r.inteiro(2, 6)));
          if (pagoEm >= hoje) pagoEm = null;
        }
      }
      novo({
        pagador_nome: c.razao_social,
        pagador_doc: c.cnpj,
        cliente_id: c.id,
        competencia,
        descricao: `Mensalidade do plano ${plano}, competência ${competencia}`,
        emissao,
        vencimento,
        valor: PRECO_PLANO[plano],
        pago_em: pagoEm,
      });
    }
    for (const p of PAGADORES_CPF) {
      if (mesesAtras >= p.meses) continue;
      const vencimento = proximoDiaUtil(somarDias(emissao, 10));
      const pago = vencimento < hoje && !(p.cpfBase === '271604938' && mesesAtras === 1);
      novo({
        pagador_nome: p.nome,
        pagador_doc: completarCpf(p.cpfBase),
        cliente_id: null,
        competencia,
        descricao: p.descricao(mesesAtras, p.meses),
        emissao,
        vencimento,
        valor: centavos(p.valor),
        pago_em: pago ? somarDias(vencimento, -1) : null,
      });
    }
  });
  return boletos;
}

const OBSERVACOES = [
  'Manutenção preventiva do servidor e dos nobreaks.',
  'Revisão da rede Wi-Fi do depósito. Procurar o responsável na portaria.',
  'Troca do nobreak da recepção.',
  'Configuração das câmeras do estacionamento.',
  'Visita de implantação: levantamento dos equipamentos.',
  'Impressora fiscal travando no fechamento do caixa.',
  'Treinamento rápido da equipe no sistema novo.',
  'Cabeamento da sala nova no segundo andar.',
];

function gerarVisitas(hoje: string, agora: Date, clientes: Cliente[]): Visita[] {
  const r = new Aleatorio('visitas');
  const ano = hoje.slice(0, 4);
  const visitas: Visita[] = [];
  const ocupado = new Set<string>();
  let numero = 394;
  const ontemUtil = (() => {
    let d = somarDias(hoje, -1);
    while (fimDeSemana(d)) d = somarDias(d, -1);
    return d;
  })();
  const planejadas: { data: string; clienteId?: string; obs?: string }[] = [
    { data: ontemUtil, clienteId: '1187', obs: 'Visita técnica: revisão dos rastreadores da frota e do servidor de monitoramento.' },
  ];
  for (let i = 0; i < 17; i++) {
    const deslocamento = r.inteiro(-20, 18);
    planejadas.push({ data: proximoDiaUtil(somarDias(hoje, deslocamento)) });
  }
  planejadas.sort((a, b) => a.data.localeCompare(b.data));
  for (const p of planejadas) {
    let horario = '';
    let tecnico = '';
    for (let t = 0; t < 20; t++) {
      horario = `${String(r.inteiro(8, 17)).padStart(2, '0')}:00`;
      tecnico = r.escolher(TECNICOS);
      if (!ocupado.has(`${p.data} ${horario} ${tecnico}`)) break;
    }
    ocupado.add(`${p.data} ${horario} ${tecnico}`);
    const cliente = p.clienteId ? clientes.find((c) => c.id === p.clienteId)! : r.escolher(clientes.slice(0, -1));
    const id = String(numero++);
    const criado = new Date(agora.getTime() - r.inteiro(3, 25) * 86_400_000);
    visitas.push({
      id,
      protocolo: `VT-${ano}-${id.padStart(4, '0')}`,
      cliente_id: cliente.id,
      cliente_nome: cliente.razao_social,
      data: p.data,
      horario,
      tecnico,
      observacoes: p.obs ?? r.escolher(OBSERVACOES),
      status: p.data < hoje ? 'Concluída' : 'Agendada',
      criado_em: criado.toISOString(),
      criado_por: r.escolher(['101', '104', '107']),
    });
  }
  return visitas;
}

function gerarChamados(agora: Date, clientes: Cliente[]): Chamado[] {
  const ano = dataSP(agora).slice(0, 4);
  const lista: [string, string, Prioridade, string, Chamado['status'], number, string][] = [
    ['Impressora fiscal não imprime', '1024', 'Alta', 'A impressora do caixa 2 parou de imprimir cupons desde a manhã.', 'Resolvido', 21, '107'],
    ['Lentidão no servidor de arquivos', '1519', 'Média', 'Abrir pastas na rede está demorando mais de um minuto.', 'Resolvido', 16, '104'],
    ['Câmera do estacionamento sem imagem', '2761', 'Média', 'A câmera 4 está sem imagem desde a chuva de ontem.', 'Em atendimento', 9, '101'],
    ['Wi-Fi caindo no depósito', '1187', 'Alta', 'A rede sem fio do depósito cai várias vezes por dia e os coletores perdem a conexão.', 'Em atendimento', 6, '107'],
    ['Acesso ao sistema para funcionária nova', '3342', 'Baixa', 'Criar acesso para a nova recepcionista, que começa na segunda.', 'Resolvido', 5, '101'],
    ['Servidor desligando sozinho', '1342', 'Urgente', 'O servidor da clínica desligou duas vezes hoje e os prontuários ficaram fora do ar.', 'Em atendimento', 2, '107'],
    ['Troca de toner', '3786', 'Baixa', 'Toner da impressora laser da produção está no fim.', 'Aberto', 1, '104'],
    ['Leitor de código de barras sem resposta', '3518', 'Média', 'O leitor do caixa 1 não lê nenhum produto.', 'Aberto', 0, '107'],
  ];
  return lista.map(([assunto, clienteId, prioridade, descricao, status, diasAtras, por], i) => {
    const id = String(145 + i);
    const cliente = clientes.find((c) => c.id === clienteId)!;
    return {
      id,
      numero: `CH-${ano}-${id.padStart(4, '0')}`,
      assunto,
      cliente_id: cliente.id,
      cliente_nome: cliente.razao_social,
      prioridade,
      descricao,
      status,
      criado_em: new Date(agora.getTime() - diasAtras * 86_400_000 - (i + 1) * 3_600_000).toISOString(),
      criado_por: por,
    };
  });
}

function gerarRelatorios(hoje: string, agora: Date): Relatorio[] {
  const mesPassado = ultimasCompetencias(hoje, 2)[1];
  const inicio = inicioCompetencia(mesPassado);
  const fim = somarDias(inicioCompetencia(competenciaDe(hoje)), -1);
  const lista: [string, number, AgruparPor, FormatoRelatorio, number, string][] = [
    ['hz7m2x9kd4ra', 55, 'vendedor', 'pdf', 15, '103'],
    ['hz4q8wnc2tbe', 56, 'regiao', 'planilha', 14, '102'],
    ['hz9p3vfs6ykm', 57, 'produto', 'pdf', 3, '105'],
  ];
  return lista.map(([id, numero, agrupar, formato, diasAtras, por]) => {
    const res = calcularRelatorio(inicio, fim, agrupar, hoje);
    return {
      id,
      numero,
      periodo_inicio: inicio,
      periodo_fim: fim,
      agrupar_por: agrupar,
      formato,
      linhas: res.linhas.length,
      total_vendas: res.total,
      criado_em: new Date(agora.getTime() - diasAtras * 86_400_000).toISOString(),
      criado_por: por,
    };
  });
}

export function estadoInicial(agora: Date = new Date()): Estado {
  const hoje = dataSP(agora);
  const clientes: Cliente[] = CLIENTES.map(([id, razao, base, email, prazo, plano, resp, criado]) => ({
    id,
    codigo: `#${id}`,
    razao_social: razao,
    cnpj: completarCnpj(base),
    email_cobranca: email,
    prazo_pagamento_dias: prazo,
    plano,
    responsavel_id: resp,
    criado_em: criado,
  }));
  const alteracoes: AlteracaoPlano[] = ALTERACOES.map(([id, clienteId, anterior, novo, aPartirDe]) => ({
    id,
    cliente_id: clienteId,
    cliente_nome: clientes.find((c) => c.id === clienteId)!.razao_social,
    plano_anterior: anterior,
    plano: novo,
    a_partir_de: aPartirDe,
    criado_em: `${somarDias(aPartirDe, -3)}T14:00:00.000Z`,
    criado_por: '105',
    desfeita_em: null,
  }));
  return {
    versao: VERSAO_ESTADO,
    gerado_em: hoje,
    clientes,
    alteracoes_plano: alteracoes,
    boletos: gerarBoletos(hoje, clientes),
    visitas: gerarVisitas(hoje, agora, clientes),
    chamados: gerarChamados(agora, clientes),
    relatorios: gerarRelatorios(hoje, agora),
    sequencias: { cliente: 4821, alteracao: 87, visita: 412, chamado: 153, relatorio: 58 },
    demo: { api_instavel: false, tela_agendamento_v2: false },
  };
}

/** CNPJ livre, reservado para demonstrar cadastros novos. */
export const CNPJ_LIVRE_DEMO = '11.222.333/0001-81';

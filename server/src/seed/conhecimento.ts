// Fontes de conhecimento de exemplo (central de ajuda do Horizonte), já divididas em trechos.
//
// `semearConhecimento(banco)` grava tudo (fontes, trechos e perguntas sem resposta) do jeito que a
// base espera; o seed principal pode chamá-lo direto. As fontes de exemplo não são retomadas ao
// iniciar o servidor (a "indexando" fica parada de propósito, para a demonstração).
import type { Banco } from '../db/banco.ts';
import { normalizarChave } from '../conhecimento/texto.ts';
import { dividirEmTrechos } from '../conhecimento/trechos.ts';
import { novoId } from '../util/ids.ts';

export interface FonteExemplo {
  tipo: 'site' | 'arquivo' | 'video' | 'respostas';
  nome: string;
  origem: string;
  status: 'indexado' | 'indexando' | 'erro' | 'pausado';
  erro?: string;
  comoResolver?: string;
  trechos: { titulo: string; local?: string; url?: string; texto: string }[];
  /** Progresso da fonte que ainda está indexando. */
  progresso?: { feitos: number; total: number };
  /** Dados extras da fonte (coluna meta): páginas, tamanho, respostas prontas... */
  meta?: Record<string, unknown>;
  enviadoPor?: string;
  /** Há quantas horas a fonte foi adicionada e sincronizada pela última vez. */
  criadaHaHoras?: number;
  sincronizadaHaHoras?: number;
}

const AJUDA = 'http://localhost:4000/ajuda';

interface Artigo {
  slug: string;
  titulo: string;
  secoes: { secao?: string; texto: string }[];
}

const ARTIGOS: Artigo[] = [
  {
    slug: 'segunda-via-de-boleto',
    titulo: 'Como emitir a segunda via de um boleto',
    secoes: [
      {
        texto:
          'A segunda via serve para quando o cliente perdeu o boleto, não recebeu o e-mail de cobrança ou deixou o boleto vencer. Podem emitir a segunda via as pessoas com perfil Financeiro, Gestor financeiro ou Administradores.',
      },
      {
        secao: 'Passo a passo',
        texto:
          'Acesse Financeiro › Segunda via. Informe o CPF/CNPJ do pagador e escolha a competência (mês e ano) do boleto. Clique em Buscar boletos. Na lista, clique em Gerar 2ª via no boleto desejado: o PDF é baixado na hora e a linha digitável aparece na tela, pronta para copiar e enviar ao cliente.',
      },
      {
        secao: 'Boletos vencidos',
        texto:
          'Para emitir a segunda via de um boleto vencido, o caminho é o mesmo. O sistema recalcula o valor com multa de 2% e juros de 1% ao mês até a nova data de vencimento, que fica 3 dias úteis depois da emissão. A segunda via só pode ser gerada até 60 dias depois do vencimento original; depois disso, a cobrança vai para negociação com o Financeiro.',
      },
      {
        secao: 'Nenhum boleto encontrado',
        texto:
          'Se aparecer a mensagem "Nenhum boleto encontrado para este pagador e competência", confira se o CPF/CNPJ é o do pagador (e não o do responsável) e se a competência é a do mês de referência da cobrança, que pode ser diferente do mês de vencimento. Você também pode pedir ao copiloto: "gera a segunda via do boleto da ACME de 09/2026".',
      },
    ],
  },
  {
    slug: 'cadastrar-cliente',
    titulo: 'Como cadastrar um cliente',
    secoes: [
      {
        texto:
          'Para cadastrar um cliente novo, acesse Clientes › Novo cliente e preencha Razão social, CNPJ, E-mail de cobrança, Prazo de pagamento e Responsável. Depois clique em Salvar cliente. O cliente recebe um código (por exemplo, #4821) e a ficha abre em seguida.',
      },
      {
        secao: 'Regras do cadastro',
        texto:
          'O CNPJ é conferido na hora: números inválidos não são aceitos. Se o CNPJ já estiver cadastrado, o sistema avisa e mostra o link para a ficha existente, em vez de criar um cliente duplicado. O e-mail de cobrança recebe os boletos e os avisos de vencimento. O responsável é a pessoa da equipe que cuida do cliente; se você não escolher ninguém, fica você mesmo.',
      },
      {
        secao: 'Quem pode cadastrar',
        texto:
          'Podem cadastrar clientes os perfis Comercial, Financeiro, Atendimento e Administradores. Se você errou algum dado logo depois de salvar, o copiloto permite desfazer o cadastro em até 5 minutos; depois disso, edite a ficha do cliente.',
      },
    ],
  },
  {
    slug: 'prazos-de-pagamento',
    titulo: 'Prazos de pagamento aceitos',
    secoes: [
      {
        texto:
          'O Horizonte aceita quatro prazos de pagamento: 15, 30, 45 ou 60 dias. O prazo padrão para clientes novos é de 30 dias. Prazos acima de 60 dias não são aceitos pelo sistema, nem com aprovação.',
      },
      {
        secao: 'Como o prazo é contado',
        texto:
          'O prazo conta a partir da data de emissão da cobrança, em dias corridos. Quando o vencimento cai em fim de semana ou feriado, ele passa para o próximo dia útil sem multa. Para mudar o prazo de um cliente que já existe, abra a ficha em Clientes, clique em Editar e escolha o novo prazo; ele vale a partir da próxima cobrança.',
      },
    ],
  },
  {
    slug: 'alterar-plano',
    titulo: 'Como alterar o plano de um cliente',
    secoes: [
      {
        secao: 'Quem pode alterar',
        texto:
          'Só pessoas com perfil Gestor financeiro ou Administradores podem alterar o plano de um cliente. Quem tem outro perfil pode fazer o pedido normalmente: ele fica "Aguardando aprovação" e o Gestor financeiro recebe um aviso para aprovar ou recusar, com o motivo.',
      },
      {
        secao: 'Passo a passo',
        texto:
          'Abra a ficha do cliente, vá em Plano e clique em Alterar plano. Escolha o novo plano (Básico, Pro ou Premium) e a data a partir da qual a mudança vale; se você não escolher, vale no próximo ciclo de cobrança, no dia 1º. Confirme e o histórico do cliente registra o plano anterior e o novo.',
      },
      {
        secao: 'Cobrança depois da mudança',
        texto:
          'Ao subir de plano, a diferença proporcional aos dias que faltam no ciclo entra na próxima cobrança. Ao descer de plano, o novo valor vale a partir do ciclo seguinte, sem devolução do mês em curso. Uma alteração feita por engano pode ser desfeita pelo copiloto logo após a confirmação.',
      },
    ],
  },
  {
    slug: 'planos',
    titulo: 'Planos Básico, Pro e Premium',
    secoes: [
      {
        secao: 'Básico',
        texto:
          'O plano Básico (R$ 199 por mês) inclui até 3 usuários, cadastro de clientes, boletos e o relatório de vendas mensal. O suporte é por e-mail, com resposta em até 2 dias úteis.',
      },
      {
        secao: 'Pro',
        texto:
          'O plano Pro (R$ 499 por mês) inclui até 15 usuários, relatórios de vendas por vendedor, por região ou por produto, agenda de visitas técnicas e suporte por chat em horário comercial.',
      },
      {
        secao: 'Premium',
        texto:
          'O plano Premium (R$ 1.290 por mês) tem usuários ilimitados, todos os relatórios com download em planilha, visitas técnicas prioritárias (em até 2 dias úteis), um gerente de conta e suporte 24 horas para chamados urgentes.',
      },
    ],
  },
  {
    slug: 'agendar-visita-tecnica',
    titulo: 'Como agendar uma visita técnica',
    secoes: [
      {
        secao: 'Passo a passo',
        texto:
          'Acesse Agenda › Nova visita. Escolha o Cliente, a Data da visita e o Horário (das 08:00 às 17:00). Em Técnico, escolha Carlos Mendes, Fernanda Lopes, João Pereira ou "Primeiro disponível". Use Observações para o endereço de referência ou o problema a verificar e clique em Agendar visita.',
      },
      {
        secao: 'Depois de agendar',
        texto:
          'A visita recebe um protocolo no formato VT-2026-0412, que aparece na tela e vai por e-mail para o contato do cliente. As visitas precisam de pelo menos 1 dia útil de antecedência. Para remarcar ou desmarcar, abra a visita pela Agenda até 24 horas antes do horário marcado.',
      },
      {
        secao: 'Quem pode agendar',
        texto: 'Podem agendar visitas os perfis Técnico, Atendimento e Administradores.',
      },
    ],
  },
  {
    slug: 'abrir-chamado',
    titulo: 'Como abrir um chamado de suporte',
    secoes: [
      {
        texto:
          'Acesse Chamados › Novo chamado e preencha Assunto, Cliente, Prioridade e Descrição. Ao salvar, o chamado recebe um número e você acompanha as respostas pela mesma tela. Descreva o que aconteceu, o que você esperava e, se puder, anexe um print.',
      },
      {
        secao: 'Prioridades e prazos de resposta',
        texto:
          'Urgente: sistema parado ou cobrança errada para muitos clientes, primeira resposta em até 1 hora. Alta: uma função importante não funciona, até 4 horas. Média: dúvida ou problema com solução alternativa, até 1 dia útil. Baixa: sugestões e ajustes, até 3 dias úteis.',
      },
    ],
  },
  {
    slug: 'relatorios-de-vendas',
    titulo: 'Relatórios de vendas',
    secoes: [
      {
        texto:
          'Acesse Relatórios › Vendas, escolha o período (data de início e de fim) e como agrupar: por vendedor, por região ou por produto. Escolha o formato PDF ou planilha e clique em Gerar relatório. O arquivo fica disponível para baixar por 7 dias na mesma tela.',
      },
      {
        secao: 'Limites',
        texto:
          'Cada relatório cobre no máximo 12 meses. Os valores consideram as vendas com cobrança emitida no período. O copiloto também gera o relatório se você pedir, por exemplo: "relatório de vendas de setembro por região em PDF".',
      },
    ],
  },
  {
    slug: 'perfis-de-acesso',
    titulo: 'Perfis de acesso',
    secoes: [
      {
        texto:
          'O que cada pessoa pode fazer no Horizonte depende dos perfis dela. Comercial: clientes e relatórios de vendas. Financeiro: boletos, segunda via e cadastro de clientes. Atendimento: clientes, chamados e agenda. Técnico: agenda de visitas técnicas.',
      },
      {
        texto:
          'Gestor financeiro: tudo do Financeiro, mais alterar planos e aprovar os pedidos de alteração de plano. Administradores: acesso a tudo, inclusive usuários e perfis. Uma pessoa pode ter mais de um perfil.',
      },
      {
        secao: 'Como pedir um perfil',
        texto:
          'Peça a um Administrador. Ele muda os perfis em Configurações › Usuários, e a mudança vale no próximo acesso. O copiloto sempre age com os perfis de quem pediu: ele nunca faz o que a pessoa não poderia fazer sozinha.',
      },
    ],
  },
];

function trechosDoSite() {
  // A mesma divisão usada na leitura real do site (seções curtas seguidas viram um trecho só).
  return ARTIGOS.flatMap((a) =>
    dividirEmTrechos(
      a.secoes.map((s) => ({
        cabecalho: s.secao,
        local: s.secao ? `seção ${s.secao}` : undefined,
        paragrafos: s.texto.split('\n'),
      })),
      { titulo: a.titulo, url: `${AJUDA}/${a.slug}` },
    ),
  );
}

const MANUAL_FINANCEIRO: { pagina: number; texto: string }[] = [
  {
    pagina: 3,
    texto:
      'Visão geral do módulo Financeiro\nO módulo Financeiro reúne Boletos, Segunda via, Conciliação bancária e os relatórios de recebimento. Têm acesso as pessoas com perfil Financeiro, Gestor financeiro ou Administradores. As telas mostram valores em reais e datas no horário de Brasília.',
  },
  {
    pagina: 7,
    texto:
      'Emissão de boletos\nOs boletos são gerados automaticamente no dia 1º de cada mês para todos os clientes ativos, com vencimento conforme o prazo de pagamento do cliente (15, 30, 45 ou 60 dias). O boleto vai para o e-mail de cobrança do cadastro e fica disponível em Financeiro › Boletos. Boletos avulsos podem ser emitidos pelo botão Novo boleto, informando cliente, valor, competência e vencimento.',
  },
  {
    pagina: 12,
    texto:
      'Segunda via e boletos vencidos\nA segunda via mantém o número do boleto original e recalcula o valor: multa de 2% sobre o valor original e juros de 1% ao mês, proporcionais aos dias de atraso. A nova data de vencimento é sempre 3 dias úteis depois da emissão da segunda via. Boletos com mais de 60 dias de atraso não aceitam segunda via: o valor passa para a negociação de débitos (página 21).',
  },
  {
    pagina: 15,
    texto:
      'Conciliação bancária\nO arquivo de retorno do banco (CNAB 240) é importado todos os dias às 7h. Os pagamentos aparecem com o status Compensado em até 2 dias úteis depois do pagamento. Pagamentos feitos com a linha digitável de uma segunda via são ligados automaticamente ao boleto original.',
  },
  {
    pagina: 21,
    texto:
      'Inadimplência e negociação de débitos\nO cliente recebe avisos automáticos por e-mail no 1º, no 5º e no 15º dia de atraso. Com 30 dias de atraso, o acesso do cliente aos serviços fica restrito até a regularização. A negociação de débitos pode dividir o valor em até 3 parcelas mensais, com aprovação do Gestor financeiro.',
  },
  {
    pagina: 28,
    texto:
      'Alteração de plano e cobrança proporcional\nA alteração de plano precisa do perfil Gestor financeiro ou Administradores. Pedidos feitos por outros perfis ficam Aguardando aprovação e o Gestor financeiro tem até 2 dias úteis para decidir. Ao subir de plano, a diferença proporcional aos dias restantes do ciclo entra na próxima cobrança; ao descer, o novo valor vale a partir do ciclo seguinte.',
  },
];

const TREINAMENTO_VISITAS: { tempo: string; texto: string }[] = [
  {
    tempo: '00:00',
    texto:
      'Oi, pessoal, aqui é a Fernanda, do time técnico. Neste vídeo eu mostro como agendar uma visita técnica no Horizonte, do começo ao fim, e os cuidados para a visita não precisar ser remarcada. A tela fica em Agenda, no menu da esquerda, e o botão é Nova visita.',
  },
  {
    tempo: '01:12',
    texto:
      'Primeiro, o cliente. Comecem a digitar o nome que a lista aparece; confiram o CNPJ na lista quando houver dois clientes com nome parecido. Depois, a data da visita: o sistema só deixa escolher a partir do próximo dia útil, porque a equipe precisa de um dia para montar a rota.',
  },
  {
    tempo: '02:14',
    texto:
      'O horário vai das oito da manhã às cinco da tarde, de hora em hora. No campo Técnico, se o cliente não pediu ninguém, deixem "Primeiro disponível": o sistema escolhe entre o Carlos, a Fernanda e o João quem tem a agenda mais livre naquele dia e naquela região.',
  },
  {
    tempo: '03:40',
    texto:
      'Usem as Observações para o que o técnico precisa saber antes de sair: ponto de referência, nome de quem vai receber e o problema que o cliente relatou. Visita sem observação é a que mais volta para remarcar. Aí é só clicar em Agendar visita e anotar o protocolo, que começa com VT.',
  },
  {
    tempo: '05:05',
    texto:
      'Para remarcar ou desmarcar, abram a visita na Agenda e usem os botões no topo, sempre até 24 horas antes. Com menos de 24 horas, liguem para o técnico ou abram um chamado com prioridade Alta. E lembrem: o copiloto também agenda se vocês pedirem no chat, com os mesmos campos.',
  },
];

const RESPOSTAS_PRONTAS: { pergunta: string; resposta: string; autor: string }[] = [
  {
    pergunta: 'Qual o horário de atendimento do suporte?',
    resposta:
      'O suporte do Horizonte atende de segunda a sexta, das 8h às 18h, pelo chat e pelo telefone 0800 000 1234. Chamados com prioridade Urgente são atendidos 24 horas.',
    autor: 'Camila Souza',
  },
  {
    pergunta: 'Como troco o e-mail de cobrança de um cliente?',
    resposta:
      'Abra a ficha do cliente em Clientes, clique em Editar, troque o E-mail de cobrança e salve. Os próximos boletos e avisos já vão para o novo e-mail; para reenviar um boleto que já saiu, gere a segunda via.',
    autor: 'Júlia Martins',
  },
  {
    pergunta: 'O Horizonte emite nota fiscal?',
    resposta:
      'Ainda não. A nota fiscal é emitida pelo Financeiro no sistema contábil, até o 5º dia útil do mês. Para pedir uma nota, abra um chamado com o assunto "Nota fiscal" e o código do cliente.',
    autor: 'Rafael Lima',
  },
  {
    pergunta: 'Posso ter dois usuários com o mesmo e-mail?',
    resposta:
      'Não. Cada pessoa precisa de um e-mail próprio para entrar no Horizonte. Se alguém mudou de área, peça a um Administrador para trocar os perfis do usuário em vez de criar outro.',
    autor: 'Júlia Martins',
  },
];

export function fontesExemplo(): FonteExemplo[] {
  return [
    {
      tipo: 'site',
      nome: 'Central de ajuda do Horizonte',
      origem: AJUDA,
      status: 'indexado',
      trechos: trechosDoSite(),
      meta: { limitePaginas: 50, paginas: ARTIGOS.length + 1, ignoradas: 0 },
      enviadoPor: 'Rafael Lima',
      criadaHaHoras: 24 * 20,
      sincronizadaHaHoras: 2,
    },
    {
      tipo: 'arquivo',
      nome: 'Manual do financeiro.pdf',
      origem: 'Manual do financeiro.pdf',
      status: 'indexado',
      trechos: MANUAL_FINANCEIRO.map((p) => ({ titulo: 'Manual do financeiro.pdf', local: `página ${p.pagina}`, texto: p.texto })),
      meta: { formato: 'pdf', paginas: 32, tamanho: 2_412_000, nomeArquivo: 'Manual do financeiro.pdf' },
      enviadoPor: 'Júlia Martins',
      criadaHaHoras: 24 * 15,
      sincronizadaHaHoras: 24 * 15,
    },
    {
      tipo: 'video',
      nome: 'Treinamento: agendamento de visitas',
      origem: 'https://videos.horizonte.com.br/treinamento-agendamento-de-visitas',
      status: 'indexado',
      trechos: TREINAMENTO_VISITAS.map((t) => ({
        titulo: 'Treinamento: agendamento de visitas',
        local: t.tempo,
        url: `https://videos.horizonte.com.br/treinamento-agendamento-de-visitas#t=${segundos(t.tempo)}`,
        texto: t.texto,
      })),
      meta: { formato: 'vtt', duracao: 6 * 60 + 20, url: 'https://videos.horizonte.com.br/treinamento-agendamento-de-visitas' },
      enviadoPor: 'Rafael Lima',
      criadaHaHoras: 24 * 9,
      sincronizadaHaHoras: 24 * 9,
    },
    {
      tipo: 'respostas',
      nome: 'Respostas prontas da equipe',
      origem: 'Escritas pela equipe no console',
      status: 'indexado',
      trechos: RESPOSTAS_PRONTAS.map((r) => ({ titulo: r.pergunta, local: 'resposta pronta', texto: `${r.pergunta}\n${r.resposta}` })),
      meta: {
        itens: RESPOSTAS_PRONTAS.map((r, i) => ({
          id: `rsp_exemplo_${i + 1}`,
          pergunta: r.pergunta,
          resposta: r.resposta,
          autor: r.autor,
          em: horasAtras(24 * (12 - i * 3)),
        })),
      },
      enviadoPor: 'Camila Souza',
      criadaHaHoras: 24 * 12,
      sincronizadaHaHoras: 24 * 3,
    },
    {
      tipo: 'site',
      nome: 'Base antiga no Confluence',
      origem: 'https://horizonte.atlassian.net/wiki/spaces/SUP',
      status: 'erro',
      erro: 'O site pede login, então o copiloto não consegue ler as páginas.',
      comoResolver:
        'Use o endereço público da central de ajuda (o que abre numa janela anônima sem pedir senha). Se o conteúdo só existe com login, exporte o espaço em PDF (no Confluence: ••• › Exportar) e envie como arquivo.',
      trechos: [],
      meta: { limitePaginas: 100 },
      enviadoPor: 'Rafael Lima',
      criadaHaHoras: 26,
    },
    {
      tipo: 'arquivo',
      nome: 'Manual do comercial.pdf',
      origem: 'Manual do comercial.pdf',
      status: 'indexando',
      trechos: [],
      progresso: { feitos: 34, total: 120 },
      meta: { formato: 'pdf', paginas: 120, tamanho: 8_734_000, nomeArquivo: 'Manual do comercial.pdf' },
      enviadoPor: 'Júlia Martins',
      criadaHaHoras: 0.2,
    },
  ];
}

export function perguntasSemRespostaExemplo(): { pergunta: string; causa: string; vezes: number }[] {
  return [
    { pergunta: 'Como cancelo a assinatura de um cliente?', causa: 'Nenhuma fonte fala disso', vezes: 14 },
    {
      pergunta: 'Onde vejo as comissões por vendedor?',
      causa: 'Pode estar em “Manual do comercial.pdf”, que ainda está indexando',
      vezes: 6,
    },
    { pergunta: 'Qual o prazo para estorno no cartão?', causa: 'Nenhuma fonte fala disso', vezes: 4 },
    { pergunta: 'Como integro o Horizonte com o meu ERP?', causa: 'Nenhuma fonte fala disso', vezes: 3 },
    { pergunta: 'Tem aplicativo do Horizonte para celular?', causa: 'Nenhuma fonte fala disso', vezes: 2 },
  ];
}

function segundos(tempo: string): number {
  const [m, s] = tempo.split(':').map(Number);
  return m * 60 + s;
}

function horasAtras(h: number, agora = Date.now()): string {
  return new Date(agora - h * 3600_000).toISOString();
}

/**
 * Grava as fontes de exemplo, seus trechos e as perguntas sem resposta. Não faz nada se a base
 * já tiver fontes (para não duplicar ao rodar o seed de novo).
 */
export function semearConhecimento(banco: Banco, agora = new Date()): { fontes: number; trechos: number; perguntas: number } {
  const ja = banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM conhecimento_fontes')?.n ?? 0;
  if (ja > 0) return { fontes: 0, trechos: 0, perguntas: 0 };
  const t = agora.getTime();
  let trechos = 0;
  const perguntas = perguntasSemRespostaExemplo();
  banco.transacao(() => {
    for (const f of fontesExemplo()) {
      const id = novoId('fnt');
      banco.inserir('conhecimento_fontes', {
        id,
        tipo: f.tipo,
        nome: f.nome,
        origem: f.origem,
        status: f.status,
        erro: f.erro ?? null,
        como_resolver: f.comoResolver ?? null,
        meta: { ...(f.meta ?? {}), exemplo: true },
        progresso_feitos: f.progresso?.feitos ?? null,
        progresso_total: f.progresso?.total ?? null,
        arquivo: null,
        enviado_por: f.enviadoPor ?? null,
        criado_em: horasAtras(f.criadaHaHoras ?? 24, t),
        sincronizado_em: f.sincronizadaHaHoras !== undefined ? horasAtras(f.sincronizadaHaHoras, t) : null,
      });
      for (const tr of f.trechos) {
        banco.executar(
          'INSERT INTO conhecimento_trechos (fonte_id, titulo, local, url, texto) VALUES (?, ?, ?, ?, ?)',
          id,
          tr.titulo,
          tr.local ?? null,
          tr.url ?? null,
          tr.texto,
        );
        trechos += 1;
      }
    }
    perguntas.forEach((p, i) => {
      banco.executar(
        `INSERT INTO perguntas_sem_resposta (id, pergunta, chave, causa, vezes, ultima_em, resolvida)
         VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(chave) DO NOTHING`,
        novoId('psr'),
        p.pergunta,
        normalizarChave(p.pergunta),
        p.causa,
        p.vezes,
        horasAtras(3 + i * 7, t),
      );
    });
  });
  return { fontes: fontesExemplo().length, trechos, perguntas: perguntas.length };
}

// Central de ajuda do Horizonte. O copiloto indexa estas páginas como fonte de conhecimento.
// De propósito, não há artigo sobre cancelamento de assinatura (lacuna usada na demonstração).

export interface Artigo {
  slug: string;
  titulo: string;
  categoria: 'Financeiro' | 'Clientes' | 'Agenda' | 'Suporte' | 'Relatórios' | 'Conta e acesso';
  resumo: string;
  atualizadoEm: string;
  /** HTML confiável (escrito aqui, sem dados de usuário). */
  corpo: string;
}

export const ARTIGOS: Artigo[] = [
  {
    slug: 'como-emitir-a-segunda-via-de-um-boleto',
    titulo: 'Como emitir a segunda via de um boleto',
    categoria: 'Financeiro',
    resumo: 'Gere o PDF e a linha digitável de um boleto pelo CPF ou CNPJ de quem paga e pela competência.',
    atualizadoEm: '2026-09-22',
    corpo: `
<p>A segunda via serve para reenviar um boleto ao cliente, seja porque ele perdeu o original, seja porque o boleto venceu.
Ela pode ser emitida por quem tem o perfil <strong>Financeiro</strong>, <strong>Gestor financeiro</strong>, <strong>Atendimento</strong> ou <strong>Administradores</strong>.</p>
<h2>Passo a passo</h2>
<ol>
  <li>No menu, abra <strong>Financeiro › Boletos</strong>.</li>
  <li>Em <strong>CPF/CNPJ do pagador</strong>, digite o documento de quem paga o boleto. Pode ser com ou sem pontuação.</li>
  <li>Em <strong>Competência</strong>, escolha o mês de referência do boleto, por exemplo 10/2026. A lista mostra os últimos 12 meses.</li>
  <li>Clique em <strong>Buscar boletos</strong>. Os boletos daquele pagador e daquela competência aparecem numa tabela.</li>
  <li>Na linha do boleto, clique em <strong>Gerar 2ª via</strong>. O PDF é baixado com o nome <em>boleto-número.pdf</em> e a linha digitável aparece logo abaixo da tabela, com o botão para copiar.</li>
</ol>
<h2>Boleto vencido</h2>
<p>A segunda via de um boleto vencido sai com <strong>novo vencimento em 3 dias corridos</strong> (passa para o próximo dia útil se cair no fim de semana)
e o valor já inclui <strong>multa de 2%</strong> e <strong>juros de 1% ao mês</strong>, proporcionais aos dias de atraso. Veja
<a href="/ajuda/boletos-vencidos-multa-e-juros">Boletos vencidos: multa e juros</a>.</p>
<h2>Boleto em aberto ou pago</h2>
<p>Boleto ainda no prazo: a segunda via mantém o vencimento e o valor originais. Boleto já pago: a via serve só como cópia para conferência,
e o PDF avisa que o pagamento já foi feito. Não pague de novo.</p>
<h2>Não encontrou o boleto?</h2>
<p>Se aparecer a mensagem <em>"Nenhum boleto encontrado para este pagador e competência."</em>, confira o documento digitado e o mês.
O boleto de cada mês é emitido no dia 1º do mês de competência, em nome da empresa (CNPJ) ou da pessoa (CPF) que paga.</p>
<p>Dica: envie a linha digitável ao cliente por e-mail ou mensagem. Ela vale para pagamento em qualquer banco até o vencimento.</p>`,
  },
  {
    slug: 'como-cadastrar-um-cliente',
    titulo: 'Como cadastrar um cliente',
    categoria: 'Clientes',
    resumo: 'Os dados obrigatórios, quem pode cadastrar e o que fazer quando o CNPJ já existe.',
    atualizadoEm: '2026-08-30',
    corpo: `
<p>Podem cadastrar clientes as pessoas com perfil <strong>Comercial</strong>, <strong>Atendimento</strong> ou <strong>Administradores</strong>.
Os clientes do Horizonte são empresas, por isso o cadastro pede CNPJ.</p>
<h2>Passo a passo</h2>
<ol>
  <li>No menu, abra <strong>Clientes</strong> e clique em <strong>Novo cliente</strong>.</li>
  <li>Preencha todos os campos:
    <ul>
      <li><strong>Razão social</strong>: o nome registrado da empresa, como aparece no cartão CNPJ.</li>
      <li><strong>CNPJ</strong>: com ou sem pontuação. O sistema confere os dígitos e recusa CNPJ inválido.</li>
      <li><strong>E-mail de cobrança</strong>: para onde vão os boletos e as notas fiscais.</li>
      <li><strong>Prazo de pagamento</strong>: 15, 30, 45 ou 60 dias. Veja <a href="/ajuda/prazos-de-pagamento-aceitos">Prazos de pagamento aceitos</a>.</li>
      <li><strong>Responsável</strong>: quem cuida da conta. Vem preenchido com o seu nome.</li>
    </ul>
  </li>
  <li>Clique em <strong>Salvar cliente</strong>. O sistema abre a ficha do cliente já com o código, por exemplo #4821.</li>
</ol>
<h2>CNPJ já cadastrado</h2>
<p>O Horizonte não aceita dois clientes com o mesmo CNPJ. Se o CNPJ já existir, nada é gravado e a tela mostra qual cliente usa o número,
com o link para a ficha. Para mudar dados de um cliente que já existe, abra a ficha e use <strong>Editar</strong>.</p>
<h2>Depois do cadastro</h2>
<p>Todo cliente novo começa no plano <strong>Básico</strong>. Para mudar, veja <a href="/ajuda/como-alterar-o-plano-de-um-cliente">Como alterar o plano de um cliente</a>.
O primeiro boleto sai no dia 1º do mês seguinte ao cadastro.</p>`,
  },
  {
    slug: 'prazos-de-pagamento-aceitos',
    titulo: 'Prazos de pagamento aceitos',
    categoria: 'Financeiro',
    resumo: 'O Horizonte aceita prazos de 15, 30, 45 ou 60 dias. Veja como o vencimento é calculado.',
    atualizadoEm: '2026-07-14',
    corpo: `
<p>O prazo de pagamento define quantos dias o cliente tem para pagar cada boleto, contados a partir da emissão.
O Horizonte aceita <strong>quatro prazos: 15, 30, 45 ou 60 dias</strong>. Outros prazos, como 20 ou 90 dias, não são aceitos pelo sistema.</p>
<h2>Como o vencimento é calculado</h2>
<p>O boleto de cada mês é emitido no dia 1º do mês de competência e vence depois do prazo do cliente.
Se o vencimento cair num sábado ou domingo, passa para o próximo dia útil.</p>
<table>
  <thead><tr><th>Prazo</th><th>Boleto de outubro emitido em 01/10 vence em</th></tr></thead>
  <tbody>
    <tr><td>15 dias</td><td>16/10</td></tr>
    <tr><td>30 dias</td><td>31/10</td></tr>
    <tr><td>45 dias</td><td>15/11</td></tr>
    <tr><td>60 dias</td><td>30/11</td></tr>
  </tbody>
</table>
<h2>Qual prazo escolher</h2>
<p>30 dias é o prazo mais comum. Prazos de 45 e 60 dias costumam ser combinados em contratos anuais.
O prazo é escolhido no cadastro e pode ser mudado depois na ficha do cliente, em <strong>Editar</strong>, por quem tem perfil Comercial, Atendimento ou Administradores.
A mudança vale a partir do próximo boleto emitido.</p>`,
  },
  {
    slug: 'como-alterar-o-plano-de-um-cliente',
    titulo: 'Como alterar o plano de um cliente',
    categoria: 'Clientes',
    resumo: 'Só Gestor financeiro e Administradores mudam planos. Os demais pedem aprovação ao Gestor financeiro.',
    atualizadoEm: '2026-09-05',
    corpo: `
<p>A mudança de plano altera o valor cobrado do cliente, por isso só pode ser feita por quem tem o perfil
<strong>Gestor financeiro</strong> ou <strong>Administradores</strong>.</p>
<h2>Não tenho esse perfil</h2>
<p>Peça a mudança a um <strong>Gestor financeiro</strong>, que é quem aprova alterações de plano (hoje, Rafael Lima).
Informe o cliente, o plano novo e a partir de quando a mudança deve valer. Até a aprovação, o cliente continua no plano atual.</p>
<h2>Passo a passo (Gestor financeiro e Administradores)</h2>
<ol>
  <li>Abra <strong>Clientes</strong> e clique no nome do cliente para abrir a ficha.</li>
  <li>Na seção <strong>Plano</strong>, escolha o <strong>Novo plano</strong>: Básico, Pro ou Premium.</li>
  <li>Em <strong>A partir de</strong>, escolha a data em que o plano novo começa. O padrão é hoje; a data pode ser até um ano à frente, nunca no passado.</li>
  <li>Clique em <strong>Alterar plano</strong>.</li>
</ol>
<p>O próximo boleto já sai com o valor do plano novo. O sistema não aceita mudar para o plano em que o cliente já está.</p>
<h2>Mudou por engano?</h2>
<p>No <strong>Histórico de planos</strong> da ficha, a alteração mais recente tem o botão <strong>Desfazer</strong>, que devolve o cliente ao plano anterior.</p>
<p>Preços e o que cada plano inclui: <a href="/ajuda/planos-e-precos">Planos e preços</a>.</p>`,
  },
  {
    slug: 'planos-e-precos',
    titulo: 'Planos e preços',
    categoria: 'Clientes',
    resumo: 'Básico, Pro e Premium: preço mensal, visitas técnicas incluídas e prazos de atendimento.',
    atualizadoEm: '2026-06-02',
    corpo: `
<p>O Horizonte oferece três planos de manutenção e suporte técnico para empresas. Todo cliente novo começa no <strong>Básico</strong>.</p>
<table>
  <thead><tr><th></th><th>Básico</th><th>Pro</th><th>Premium</th></tr></thead>
  <tbody>
    <tr><td>Preço mensal</td><td>R$ 189,90</td><td>R$ 389,90</td><td>R$ 749,90</td></tr>
    <tr><td>Visitas preventivas incluídas</td><td>1 por semestre</td><td>1 por mês</td><td>2 por mês</td></tr>
    <tr><td>Chamados</td><td>Horário comercial</td><td>Horário comercial, com prioridade</td><td>24 horas para chamados urgentes</td></tr>
    <tr><td>Primeira resposta</td><td>Até 1 dia útil</td><td>Até 8 horas úteis</td><td>Até 2 horas (urgentes)</td></tr>
    <tr><td>Visita avulsa</td><td>R$ 280,00</td><td>R$ 252,00 (10% de desconto)</td><td>Sem custo de deslocamento</td></tr>
    <tr><td>Técnico de referência</td><td>Não</td><td>Sim</td><td>Sim, com gestor de conta</td></tr>
  </tbody>
</table>
<h2>Como escolher</h2>
<ul>
  <li><strong>Básico</strong>: pequenos negócios com poucos equipamentos, como lojas, cafés e escritórios.</li>
  <li><strong>Pro</strong>: empresas que dependem dos equipamentos no dia a dia, como transportadoras, escolas e farmácias.</li>
  <li><strong>Premium</strong>: operações que não podem parar, como clínicas, hotéis e indústrias.</li>
</ul>
<p>Os valores são cobrados por boleto mensal. Para trocar de plano, veja <a href="/ajuda/como-alterar-o-plano-de-um-cliente">Como alterar o plano de um cliente</a>.</p>`,
  },
  {
    slug: 'como-agendar-uma-visita-tecnica',
    titulo: 'Como agendar uma visita técnica',
    categoria: 'Agenda',
    resumo: 'Escolha cliente, data, horário e técnico. Visitas de segunda a sexta, das 08:00 às 17:00.',
    atualizadoEm: '2026-09-18',
    corpo: `
<p>Podem agendar visitas as pessoas com perfil <strong>Atendimento</strong>, <strong>Comercial</strong>, <strong>Técnico</strong> ou <strong>Administradores</strong>.</p>
<h2>Passo a passo</h2>
<ol>
  <li>No menu, abra <strong>Agenda › Nova visita</strong>.</li>
  <li>Em <strong>Cliente</strong>, comece a digitar o nome e escolha o cliente na lista.</li>
  <li>Em <strong>Data da visita</strong>, escolha um dia de segunda a sexta, a partir de hoje e até 6 meses à frente.</li>
  <li>Em <strong>Horário</strong>, escolha de 08:00 a 17:00. As visitas começam sempre na hora cheia.</li>
  <li>Em <strong>Técnico</strong>, escolha Carlos Mendes, Fernanda Lopes, João Pereira ou <strong>Primeiro disponível</strong>, que escolhe quem estiver livre no horário.</li>
  <li>Em <strong>Observações</strong> (opcional), anote o endereço, o contato no local ou o equipamento.</li>
  <li>Clique em <strong>Agendar visita</strong>. A tela mostra o <strong>protocolo</strong> da visita, por exemplo VT-2026-0412.</li>
</ol>
<h2>Técnico ocupado</h2>
<p>Se o técnico escolhido já tiver visita no mesmo dia e horário, o sistema avisa e nada é gravado. Escolha outro horário, outro técnico ou Primeiro disponível.</p>
<h2>Remarcar</h2>
<p>Abra a visita em <strong>Agenda › Visitas</strong>, clique em <strong>Cancelar visita</strong> e agende de novo na data certa.</p>`,
  },
  {
    slug: 'como-abrir-um-chamado-de-suporte',
    titulo: 'Como abrir um chamado de suporte',
    categoria: 'Suporte',
    resumo: 'Registre um problema de um cliente com assunto, prioridade e descrição. Veja os prazos de resposta.',
    atualizadoEm: '2026-08-11',
    corpo: `
<p>Qualquer pessoa da equipe pode abrir um chamado em nome de um cliente.</p>
<h2>Passo a passo</h2>
<ol>
  <li>No menu, abra <strong>Chamados</strong>.</li>
  <li>Em <strong>Abrir chamado</strong>, preencha o <strong>Assunto</strong> (resumo em poucas palavras) e o <strong>Cliente</strong>.</li>
  <li>Escolha a <strong>Prioridade</strong>: Baixa, Média, Alta ou Urgente.</li>
  <li>Na <strong>Descrição</strong>, conte o que está acontecendo, desde quando e o que já foi tentado.</li>
  <li>Clique em <strong>Abrir chamado</strong>. O chamado recebe um número, por exemplo CH-2026-0153.</li>
</ol>
<h2>Prioridade e prazo de primeira resposta</h2>
<table>
  <thead><tr><th>Prioridade</th><th>Quando usar</th><th>Primeira resposta</th></tr></thead>
  <tbody>
    <tr><td>Urgente</td><td>Operação parada: sistema fora do ar, servidor desligado, caixa sem funcionar.</td><td>Até 2 horas</td></tr>
    <tr><td>Alta</td><td>Problema que atrapalha muito, mas tem contorno.</td><td>Até 8 horas úteis</td></tr>
    <tr><td>Média</td><td>Problema pontual em um equipamento ou usuário.</td><td>Até 1 dia útil</td></tr>
    <tr><td>Baixa</td><td>Dúvidas, pedidos de acesso e trocas programadas.</td><td>Até 3 dias úteis</td></tr>
  </tbody>
</table>
<p>Clientes Premium têm atendimento 24 horas para chamados urgentes. Se o problema precisar de alguém no local, o suporte agenda uma visita técnica.</p>`,
  },
  {
    slug: 'relatorios-de-vendas',
    titulo: 'Relatórios de vendas',
    categoria: 'Relatórios',
    resumo: 'Gere o relatório de um período agrupado por vendedor, região ou produto, em PDF ou planilha.',
    atualizadoEm: '2026-09-29',
    corpo: `
<p>Podem emitir relatórios de vendas as pessoas com perfil <strong>Comercial</strong>, <strong>Financeiro</strong>, <strong>Gestor financeiro</strong> ou <strong>Administradores</strong>.</p>
<h2>Passo a passo</h2>
<ol>
  <li>No menu, abra <strong>Relatórios</strong>.</li>
  <li>Escolha o <strong>Início do período</strong> e o <strong>Fim do período</strong>. O período pode ter até 2 anos.</li>
  <li>Em <strong>Agrupar por</strong>, escolha <strong>Vendedor</strong>, <strong>Região</strong> ou <strong>Produto</strong>.</li>
  <li>Em <strong>Formato</strong>, escolha <strong>PDF</strong> (para ler e enviar) ou <strong>Planilha</strong> (arquivo CSV, abre no Excel e no Google Planilhas).</li>
  <li>Clique em <strong>Gerar relatório</strong>. O arquivo fica na lista "Gerados recentemente" para baixar quando quiser.</li>
</ol>
<h2>O que o relatório mostra</h2>
<p>Para cada vendedor, região ou produto: quantidade de vendas, total vendido, ticket médio e participação no total do período.
No fim, a linha de total. Os dados vão de janeiro de 2025 até hoje.</p>
<p>Regiões: Sul, Sudeste, Centro-Oeste, Nordeste e Norte. Produtos: planos anuais (Básico, Pro e Premium), implantação, visita técnica avulsa,
manutenção preventiva, treinamento de equipe e suporte estendido.</p>`,
  },
  {
    slug: 'perfis-de-acesso',
    titulo: 'Perfis de acesso',
    categoria: 'Conta e acesso',
    resumo: 'O que cada perfil pode fazer no Horizonte: Comercial, Financeiro, Atendimento, Técnico, Gestor financeiro e Administradores.',
    atualizadoEm: '2026-05-20',
    corpo: `
<p>Cada pessoa tem um ou mais perfis. O que ela pode fazer é a soma do que os perfis permitem.
Todos os perfis podem consultar clientes, abrir chamados e ler a central de ajuda.</p>
<table>
  <thead><tr><th>Perfil</th><th>O que pode fazer</th></tr></thead>
  <tbody>
    <tr><td>Comercial</td><td>Cadastrar e editar clientes, agendar visitas e emitir relatórios de vendas.</td></tr>
    <tr><td>Atendimento</td><td>Cadastrar e editar clientes, emitir segunda via de boletos e agendar visitas.</td></tr>
    <tr><td>Financeiro</td><td>Emitir segunda via de boletos e relatórios de vendas.</td></tr>
    <tr><td>Técnico</td><td>Agendar visitas técnicas.</td></tr>
    <tr><td>Gestor financeiro</td><td>Tudo do Financeiro e também alterar o plano de clientes. É quem aprova pedidos de mudança de plano.</td></tr>
    <tr><td>Administradores</td><td>Tudo no sistema.</td></tr>
  </tbody>
</table>
<h2>Preciso de outro perfil</h2>
<p>Peça a um Administrador. Quando uma tarefa exige um perfil que você não tem, a tela avisa qual perfil é necessário e nada é gravado.</p>`,
  },
  {
    slug: 'boletos-vencidos-multa-e-juros',
    titulo: 'Boletos vencidos: multa e juros',
    categoria: 'Financeiro',
    resumo: 'Como o Horizonte calcula multa e juros e como fica a segunda via de um boleto em atraso.',
    atualizadoEm: '2026-09-22',
    corpo: `
<p>Depois do vencimento, o boleto passa a aparecer como <strong>Vencido</strong> e a ficha do cliente mostra o aviso <strong>Boleto vencido</strong>.</p>
<h2>Cálculo</h2>
<ul>
  <li><strong>Multa</strong>: 2% sobre o valor do boleto, uma vez só.</li>
  <li><strong>Juros</strong>: 1% ao mês, proporcional aos dias entre o vencimento original e o novo vencimento.</li>
</ul>
<p>Exemplo: boleto de R$ 389,90 vencido há 20 dias, com segunda via para daqui a 3 dias (23 dias de atraso):
multa de R$ 7,80 e juros de R$ 2,99, total de R$ 400,69.</p>
<h2>Segunda via</h2>
<p>A segunda via de um boleto vencido já sai com o novo vencimento (3 dias corridos, no próximo dia útil) e o valor atualizado.
Veja <a href="/ajuda/como-emitir-a-segunda-via-de-um-boleto">Como emitir a segunda via de um boleto</a>.</p>`,
  },
];

export function artigoPorSlug(slug: string): Artigo | undefined {
  return ARTIGOS.find((a) => a.slug === slug);
}

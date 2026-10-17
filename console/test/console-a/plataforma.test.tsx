// Plataforma Starta (S7): moldura própria com a sessão da equipe Starta, Empresas clientes com os
// números da API, filtros, busca, painel da empresa, "Entrar como suporte", "Nova empresa" e preços.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DetalheEmpresaStarta, EuStarta, LinhaEmpresaStarta, PainelEmpresas, Plano, SaudeFluxo, UsoPlataforma } from '@copiloto/shared';
import { recarregar } from '../../src/componentes/sessao.tsx';
import AreaPlataforma from '../../src/paginas/plataforma/AreaPlataforma.tsx';
import { campoParaCentavos, centavosParaCampo } from '../../src/paginas/plataforma/Configuracoes.tsx';
import { instalarFetch, local, renderizar, status } from './ambiente.tsx';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EU: EuStarta = { id: 'stp_gm', nome: 'Gabriel Moreno', email: 'gabriel@starta.com.br', iniciais: 'GM', codigosRecuperacao: 10 };
const MILENA = { id: 'stp_mt', nome: 'Milena Teodoro', email: 'milena@starta.com.br', iniciais: 'MT' };

function linha(p: Partial<LinhaEmpresaStarta>): LinhaEmpresaStarta {
  return {
    id: 'emp_x',
    nome: 'X',
    iniciais: 'X',
    cnpj: null,
    demo: false,
    situacao: 'ativo',
    fase: 'ativo',
    faseDesde: '2026-09-22T12:00:00.000Z',
    suspensaEm: null,
    plano: null,
    usuarios: 0,
    tarefasAtivas: 0,
    tarefasEmTeste: 0,
    tarefasPausadas: 0,
    execucoes30d: 0,
    sucesso30d: null,
    creditos30d: 0,
    fluxosQuebrados: 0,
    responsavel: null,
    ...p,
  };
}

const EMPRESAS = [
  linha({
    id: 'emp_polen',
    nome: 'Pólen ERP',
    iniciais: 'PE',
    plano: { id: 'escala', nome: 'Escala' },
    usuarios: 2400,
    tarefasAtivas: 12,
    execucoes30d: 18420,
    sucesso30d: 0.978,
    creditos30d: 19380,
    fluxosQuebrados: 1,
    responsavel: MILENA,
  }),
  linha({
    id: 'emp_clinica',
    nome: 'Clínica Mais Agenda',
    iniciais: 'CM',
    cnpj: '11222333000181',
    situacao: 'piloto',
    fase: 'piloto',
    plano: { id: 'piloto', nome: 'Piloto' },
    usuarios: 180,
    tarefasAtivas: 3,
    execucoes30d: 2310,
    sucesso30d: 0.912,
    creditos30d: 2522,
    fluxosQuebrados: 2,
    responsavel: MILENA,
  }),
  linha({ id: 'emp_horizonte', nome: 'Horizonte', iniciais: 'HO', demo: true, usuarios: 164, tarefasAtivas: 6, execucoes30d: 3010, sucesso30d: 0.951, creditos30d: 3490, responsavel: EU }),
  linha({ id: 'emp_rota', nome: 'RotaCerta Logística', iniciais: 'RC', situacao: 'implantacao', fase: 'implantacao', tarefasEmTeste: 2, responsavel: MILENA }),
  linha({ id: 'emp_vetor', nome: 'Vetor CRM', iniciais: 'VC', situacao: 'pausado', suspensaEm: '2026-09-30T15:00:00.000Z', usuarios: 640, tarefasPausadas: 7 }),
];

const PAINEL: PainelEmpresas = {
  resumo: {
    ativas: 3,
    emImplantacao: 1,
    pausadas: 1,
    emPiloto: { total: 1, nomes: ['Clínica Mais Agenda'] },
    execucoes30d: 23740,
    margemPorCredito: null,
    ate: '2026-10-17T15:00:00.000Z',
  },
  empresas: EMPRESAS,
};

const SAUDE: SaudeFluxo[] = [
  { tarefaId: 'trf_remarcar', nome: 'Remarcar consulta', consertos30d: 41, quebrado: true, ultimoConserto: '2026-10-12T14:00:00.000Z', detalhe: null, empresaId: 'emp_clinica', empresa: 'Clínica Mais Agenda', execucoes30d: 300, falhas30d: 2 },
  { tarefaId: 'trf_confirmar', nome: 'Confirmar presença', consertos30d: 12, quebrado: true, ultimoConserto: '2026-10-15T14:00:00.000Z', detalhe: null, empresaId: 'emp_clinica', empresa: 'Clínica Mais Agenda', execucoes30d: 200, falhas30d: 0 },
  { tarefaId: 'trf_boleto', nome: 'Segunda via', consertos30d: 3, quebrado: false, ultimoConserto: '2026-10-11T14:00:00.000Z', detalhe: null, empresaId: 'emp_polen', empresa: 'Pólen ERP', execucoes30d: 80, falhas30d: 0 },
];

const DETALHE: DetalheEmpresaStarta = {
  ...EMPRESAS[1],
  dominio: 'agenda.clinicamais.com.br',
  faixaUsuarios: 'ate_200',
  limiteUsuarios: 200,
  acesso: 'sessao',
  conector: 'tela',
  adminEmpresa: { nome: 'Patrícia Nunes', email: 'patricia@clinicamais.com.br' },
  criadoEm: '2026-09-20T12:00:00.000Z',
  metaTarefas: 5,
  avaliacaoPilotoEm: '2026-10-22T12:00:00.000Z',
  implantacao: [
    { chave: 'contrato', titulo: 'Contrato e LGPD assinados', feita: true, quando: '2026-09-22T12:00:00.000Z', detalhe: null },
    { chave: 'sistema', titulo: 'Sistema conectado', feita: true, quando: '2026-09-25T12:00:00.000Z', detalhe: 'widget assinado pelo sistema' },
    { chave: 'marca', titulo: 'Marca e widget no ar', feita: true, quando: '2026-09-29T12:00:00.000Z', detalhe: null },
    { chave: 'tarefas', titulo: 'Tarefas publicadas: 3 de 5', feita: false, quando: null, detalhe: 'Faltam Cancelar consulta e Enviar lembrete' },
    { chave: 'avaliacao', titulo: 'Avaliação do piloto', feita: false, quando: '2026-10-22T12:00:00.000Z', detalhe: 'Reunião em 22/10/2026 com a empresa' },
  ],
  fluxosComConserto: SAUDE.slice(0, 2).map(({ tarefaId, nome, consertos30d, quebrado, ultimoConserto, detalhe }) => ({ tarefaId, nome, consertos30d, quebrado, ultimoConserto, detalhe })),
  acessosSuporte: [],
};

function abrirPlataforma(caminho = '/plataforma', rotas: Record<string, unknown> = {}) {
  const f = instalarFetch({
    'GET /api/plataforma/auth/eu': EU,
    'GET /api/plataforma/empresas': PAINEL,
    'GET /api/plataforma/saude': SAUDE,
    'GET /api/plataforma/empresas/emp_clinica': DETALHE,
    ...rotas,
  });
  renderizar(<AreaPlataforma />, { caminho, rota: '/plataforma/*' });
  return f;
}

const tabela = () => screen.getByRole('table', { name: 'Empresas clientes' });
const linhaDe = (nome: string) => within(tabela()).getByText(nome, { selector: '.strong' }).closest('tr')!;

describe('Plataforma Starta › Empresas clientes', () => {
  it('mostra a moldura, o resumo e a lista com os números da API', async () => {
    abrirPlataforma();
    expect(await screen.findByRole('heading', { name: 'Empresas clientes' })).toBeTruthy();
    const menu = screen.getByRole('navigation', { name: 'Menu da plataforma' });
    for (const [nome, destino] of [
      ['Empresas', '/plataforma'],
      ['Implantações', '/plataforma/implantacoes'],
      ['Uso e custos', '/plataforma/uso'],
      ['Saúde dos fluxos', '/plataforma/saude'],
      ['Suporte', '/plataforma/suporte'],
      ['Configurações', '/plataforma/configuracoes'],
    ]) {
      expect(within(menu).getByRole('link', { name: new RegExp(`^${nome}`) }).getAttribute('href')).toBe(destino);
    }
    // Contadores: Implantações conta implantação e piloto (sem a demonstração); Saúde conta os quebrados.
    await waitFor(() => expect(within(menu).getByRole('link', { name: /Saúde dos fluxos/ }).textContent).toContain('2'));
    expect(within(menu).getByRole('link', { name: /Implantações/ }).textContent).toContain('2');
    expect(within(menu).getByText('Admin da plataforma')).toBeTruthy();
    expect(document.title).toBe('Empresas clientes · Plataforma Starta');

    const kpis = await screen.findByRole('region', { name: 'Resumo das empresas' });
    const cartao = (rotulo: string) => within(kpis).getByText(rotulo).parentElement!;
    expect(cartao('Empresas ativas').querySelector('.kpi-value')?.textContent).toBe('3');
    expect(cartao('Empresas ativas').textContent).toContain('Mais 1 em implantação e 1 pausada');
    expect(cartao('Em piloto').textContent).toContain('Clínica Mais Agenda');
    expect(cartao('Execuções em 30 dias').querySelector('.kpi-value')?.textContent).toBe('23.740');
    // Sem preço do crédito, a margem fica em aberto, nunca um número inventado.
    expect(cartao('Margem por crédito').querySelector('.kpi-value')?.textContent).toBe('—');
    expect(screen.queryByText('Dados de exemplo')).toBeNull();
    expect(screen.getByText(/Aqui você vê métricas, não conteúdo/)).toBeTruthy();

    const polen = linhaDe('Pólen ERP');
    expect(within(polen).getByText('2.400')).toBeTruthy();
    expect(within(polen).getByText('97,8%')).toBeTruthy();
    expect(within(polen).getByText('19.380')).toBeTruthy();
    expect(within(polen).getByText('1 quebrado')).toBeTruthy();
    expect(within(polen).getByText('Milena Teodoro')).toBeTruthy();
    expect(within(linhaDe('Clínica Mais Agenda')).getByText('91,2%').className).toContain('text-warning');
    expect(within(linhaDe('Clínica Mais Agenda')).getByText('2 quebrados')).toBeTruthy();
    expect(within(linhaDe('Horizonte')).getByText('Demonstração')).toBeTruthy();
    expect(within(linhaDe('Horizonte')).getByText('Tudo certo')).toBeTruthy();
    expect(within(linhaDe('RotaCerta Logística')).getByText('Sem produção')).toBeTruthy();
    expect(within(linhaDe('RotaCerta Logística')).getByText('(2 em teste)')).toBeTruthy();
    expect(within(linhaDe('Vetor CRM')).getByText('Pausado em 30/09')).toBeTruthy();
    expect(within(linhaDe('Vetor CRM')).getByText('Sem responsável')).toBeTruthy();
    expect(screen.getByText(/até 17\/10\/2026\. “Quebrado” é um fluxo/).textContent).toContain('mais de 10 vezes');
  });

  it('filtra por status e pela busca', async () => {
    abrirPlataforma();
    await screen.findByRole('table', { name: 'Empresas clientes' });
    expect(screen.getByRole('tab', { name: /Todas/ }).textContent).toBe('Todas5');
    expect(screen.getByRole('tab', { name: /Ativas/ }).textContent).toBe('Ativas3');
    expect(screen.getByRole('tab', { name: /Implantação/ }).textContent).toBe('Implantação1');

    fireEvent.click(screen.getByRole('tab', { name: /Pausadas/ }));
    expect(within(tabela()).getAllByRole('row')).toHaveLength(2);
    expect(within(tabela()).getByText('Vetor CRM')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Ativas/ }));
    expect(within(tabela()).queryByText('Vetor CRM')).toBeNull();
    expect(within(tabela()).queryByText('RotaCerta Logística')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Todas/ }));
    const busca = screen.getAllByLabelText('Buscar empresa')[0];
    fireEvent.change(busca, { target: { value: 'clinica' } });
    await waitFor(() => expect(within(tabela()).getAllByRole('row')).toHaveLength(2));
    expect(within(tabela()).getByText('Clínica Mais Agenda')).toBeTruthy();
    expect(local()).toBe('/plataforma?busca=clinica');
    // Pelo nome do responsável também.
    fireEvent.change(busca, { target: { value: 'Gabriel' } });
    await waitFor(() => expect(within(tabela()).getByText('Horizonte')).toBeTruthy());
    expect(within(tabela()).getAllByRole('row')).toHaveLength(2);
    // E pelo CNPJ, com ou sem pontuação.
    fireEvent.change(busca, { target: { value: '11.222.333' } });
    await waitFor(() => expect(within(tabela()).getByText('Clínica Mais Agenda')).toBeTruthy());
    expect(within(tabela()).getAllByRole('row')).toHaveLength(2);
    expect(busca.getAttribute('placeholder')).toBe('Buscar empresa, CNPJ ou responsável');
    fireEvent.change(busca, { target: { value: 'nada disso' } });
    expect(await within(tabela()).findByText('Nenhuma empresa encontrada para “nada disso”.')).toBeTruthy();
  });

  it('“Abrir” mostra o painel da empresa com a implantação e os fluxos', async () => {
    const { pedidos } = abrirPlataforma();
    await screen.findByRole('table', { name: 'Empresas clientes' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Clínica Mais Agenda' }));
    const painel = await screen.findByRole('complementary', { name: 'Clínica Mais Agenda' });
    expect(local()).toBe('/plataforma?empresa=emp_clinica');
    expect(pedidos.some((p) => p.caminho === '/api/plataforma/empresas/emp_clinica')).toBe(true);
    expect(within(linhaDe('Clínica Mais Agenda')).getByText('Aberta')).toBeTruthy();
    expect(linhaDe('Clínica Mais Agenda').getAttribute('aria-current')).toBe('true');

    expect(await within(painel).findByText('Patrícia Nunes')).toBeTruthy();
    expect(painel.textContent).toContain('Piloto desde 22/09/2026');
    expect(painel.textContent).toContain('agenda.clinicamais.com.br');
    expect(within(painel).getByText('Sessão de quem pede')).toBeTruthy();
    expect(within(painel).getByText('180 de 200')).toBeTruthy();
    expect(within(painel).getByText('3 de 5')).toBeTruthy();
    expect(within(painel).getByText('25/09 · widget assinado pelo sistema')).toBeTruthy();
    expect(within(painel).getByText('Faltam Cancelar consulta e Enviar lembrete')).toBeTruthy();
    expect(within(painel).getByText('Remarcar consulta')).toBeTruthy();
    expect(within(painel).getByText(/41 consertos em 30 dias/)).toBeTruthy();
    expect(within(painel).getAllByText('Quebrado')).toHaveLength(2);
    expect(within(painel).getByRole('button', { name: 'Sugerir regravação à empresa' })).toBeTruthy();

    fireEvent.click(within(painel).getByRole('button', { name: 'Fechar detalhe' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Clínica Mais Agenda' })).toBeNull());
    expect(local()).toBe('/plataforma');
  });

  it('“Entrar como suporte” pede o motivo e abre o console da empresa', async () => {
    const abrir = vi.spyOn(recarregar, 'console').mockImplementation(() => {});
    const { pedidos } = abrirPlataforma('/plataforma?empresa=emp_clinica', {
      'POST /api/plataforma/empresas/emp_clinica/suporte': ({ corpo }: { corpo: { motivo: string } }) => ({
        acesso: { id: 'sup_1', pessoa: 'Gabriel Moreno', empresaId: 'emp_clinica', empresa: 'Clínica Mais Agenda', motivo: corpo.motivo, inicio: '', expiraEm: '', encerradoEm: null },
        url: 'http://localhost:5173/',
      }),
    });
    const painel = await screen.findByRole('complementary', { name: 'Clínica Mais Agenda' });
    fireEvent.click(await within(painel).findByRole('button', { name: 'Entrar como suporte' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Entrar como suporte na Clínica Mais Agenda' });
    expect(dialogo.textContent).toContain('registrado na auditoria da Clínica Mais Agenda');
    expect(dialogo.textContent).toContain('Admins dela recebem um e-mail');

    const motivo = within(dialogo).getByLabelText(/Motivo do acesso/);
    fireEvent.change(motivo, { target: { value: 'ajuda' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Entrar como suporte' }));
    expect(await within(dialogo).findByText('Diga o motivo do acesso, em pelo menos 10 caracteres.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(motivo, { target: { value: '  A empresa pediu ajuda com a remarcação  ' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Entrar como suporte' }));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('http://localhost:5173/'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ motivo: 'A empresa pediu ajuda com a remarcação' });
  });

  it('pausa a empresa com confirmação e atualiza a lista', async () => {
    const pausada = { ...DETALHE, situacao: 'pausado' as const, suspensaEm: '2026-10-17T15:00:00.000Z' };
    const { pedidos } = abrirPlataforma('/plataforma?empresa=emp_clinica', { 'PUT /api/plataforma/empresas/emp_clinica/status': pausada });
    const painel = await screen.findByRole('complementary', { name: 'Clínica Mais Agenda' });
    fireEvent.click(await within(painel).findByRole('button', { name: 'Mais ações para Clínica Mais Agenda' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pausar empresa' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Pausar Clínica Mais Agenda?' });
    expect(dialogo.textContent).toContain('Nada é apagado');
    const antes = pedidos.filter((p) => p.caminho === '/api/plataforma/empresas').length;
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Pausar empresa' }));
    expect(await screen.findByText('Clínica Mais Agenda foi pausada.')).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'PUT')?.corpo).toEqual({ status: 'suspensa' });
    expect(painel.textContent).toContain('Pausado desde 17/10/2026');
    expect((within(painel).getByRole('button', { name: 'Entrar como suporte' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(pedidos.filter((p) => p.caminho === '/api/plataforma/empresas').length).toBeGreaterThan(antes));
  });

  it('“Nova empresa” cria o espaço e mostra o link do convite', async () => {
    const { pedidos } = abrirPlataforma('/plataforma', {
      'GET /api/plataforma/planos': status(500, { erro: 'interno', mensagem: 'Falhou.' }),
      'POST /api/plataforma/empresas': { empresa: { ...DETALHE, id: 'emp_nova', nome: 'Nova Ltda', situacao: 'implantacao' }, linkConvite: 'http://localhost/convite/abc', envio: 'caixa_local' },
      'GET /api/plataforma/empresas/emp_nova': { ...DETALHE, id: 'emp_nova', nome: 'Nova Ltda' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Nova empresa' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nova empresa' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar empresa' }));
    expect(within(dialogo).getByText('Diga o nome da empresa.')).toBeTruthy();
    fireEvent.change(within(dialogo).getByLabelText(/Nome da empresa/), { target: { value: 'Nova Ltda' } });
    fireEvent.change(within(dialogo).getByLabelText(/E-mail do primeiro Admin/), { target: { value: 'ti@nova.com.br' } });
    fireEvent.change(within(dialogo).getByLabelText('CNPJ'), { target: { value: '11.222.333/0001-80' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar empresa' }));
    expect(within(dialogo).getByText('CNPJ inválido. Confira os números.')).toBeTruthy();
    fireEvent.change(within(dialogo).getByLabelText('CNPJ'), { target: { value: '' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar empresa' }));

    const pronto = await screen.findByRole('dialog', { name: 'Nova Ltda foi criada' });
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ nome: 'Nova Ltda', fase: 'implantacao', admin: { email: 'ti@nova.com.br' } });
    expect((within(pronto).getByLabelText('Link do convite') as HTMLInputElement).value).toBe('http://localhost/convite/abc');
    expect(pronto.textContent).toContain('caixa de saída local');
    await waitFor(() => expect(local()).toBe('/plataforma?empresa=emp_nova'));
  });

  it('sem a sessão da equipe Starta, vai para a entrada da Plataforma', async () => {
    instalarFetch({ 'GET /api/plataforma/auth/eu': status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' }) });
    renderizar(<AreaPlataforma />, { caminho: '/plataforma/uso', rota: '/plataforma/*' });
    await waitFor(() => expect(local()).toBe('/plataforma/entrar?voltar=%2Fplataforma%2Fuso'));
  });

  it('Sair encerra a sessão da Plataforma', async () => {
    const { pedidos } = abrirPlataforma();
    fireEvent.click(await screen.findByRole('button', { name: /Gabriel Moreno, Admin da plataforma/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sair' }));
    await waitFor(() => expect(local()).toBe('/plataforma/entrar'));
    expect(pedidos.some((p) => p.metodo === 'POST' && p.caminho === '/api/plataforma/auth/sair')).toBe(true);
  });
});

describe('Plataforma Starta › Configurações', () => {
  it('preços em reais viram centavos', () => {
    expect(campoParaCentavos('1.990,00')).toBe(199000);
    expect(campoParaCentavos('1.990')).toBe(199000);
    expect(campoParaCentavos('R$ 0,45')).toBe(45);
    expect(campoParaCentavos('12')).toBe(1200);
    expect(campoParaCentavos('')).toBeNull();
    expect(campoParaCentavos('dez')).toBeUndefined();
    expect(centavosParaCampo(199000)).toBe('1.990,00');
    expect(centavosParaCampo(null)).toBe('');
  });

  it('salva os preços do plano em centavos', async () => {
    const plano: Plano = {
      id: 'piloto',
      nome: 'Piloto',
      ordem: 1,
      descricao: 'Para validar.',
      usuariosMin: 1,
      usuariosMax: 200,
      creditosIncluidos: 3000,
      pacoteCreditos: 1000,
      precoMensalCentavos: null,
      taxaImplantacaoCentavos: null,
      precoCreditoExtraCentavos: 40,
      notaPreco: 'por mês',
      destaques: [],
      botao: 'cadastro',
      atualizadoEm: '2026-10-10T12:00:00.000Z',
    };
    const { pedidos } = abrirPlataforma('/plataforma/configuracoes?aba=planos', {
      'GET /api/plataforma/equipe': [],
      'GET /api/plataforma/planos': [plano],
      'PUT /api/plataforma/planos/piloto': ({ corpo }: { corpo: object }) => ({ ...plano, ...corpo }),
    });
    const cartao = await screen.findByRole('article', { name: 'Piloto' });
    expect((within(cartao).getByLabelText(/Preço do crédito extra/) as HTMLInputElement).value).toBe('0,40');
    fireEvent.change(within(cartao).getByLabelText(/Preço mensal/), { target: { value: '1.990,00' } });
    fireEvent.click(within(cartao).getByRole('button', { name: 'Salvar preços' }));
    expect(await screen.findByText('Preços do plano Piloto salvos.')).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'PUT')?.corpo).toEqual({ precoMensalCentavos: 199000 });
  });
});

describe('Plataforma Starta › painel e uso', () => {
  it('empresa ligada pela API mostra o acesso certo', async () => {
    abrirPlataforma('/plataforma?empresa=emp_clinica', {
      'GET /api/plataforma/empresas/emp_clinica': { ...DETALHE, conector: 'api', acesso: 'nenhum' },
    });
    const painel = await screen.findByRole('complementary', { name: 'Clínica Mais Agenda' });
    expect(await within(painel).findByText('Pela API do sistema')).toBeTruthy();
    expect(within(painel).queryByText('Sem login')).toBeNull();
  });

  it('Uso e custos marca a demonstração pela linha do uso e troca o período', async () => {
    const valores = { execucoes: 3010, creditos: 3490, creditosRoteiro: 2600, creditosConserto: 890, custoIa: 41.2, custoNavegador: 12.5, receitaCreditos: null };
    const uso: UsoPlataforma = {
      desde: '2026-09-17T15:00:00.000Z',
      ate: '2026-10-17T15:00:00.000Z',
      // A demonstração vem marcada no próprio uso, mesmo fora da lista de empresas.
      empresas: [{ empresaId: 'emp_outra_demo', nome: 'Demo Avulsa', demo: true, ...valores }],
      total: valores,
    };
    const { pedidos } = abrirPlataforma('/plataforma/uso', { 'GET /api/plataforma/uso': uso });
    const tabelaUso = await screen.findByRole('table', { name: 'Uso e custos por empresa' });
    const linhaDemo = within(tabelaUso).getByRole('link', { name: 'Demo Avulsa' }).closest('tr')!;
    expect(within(linhaDemo).getByText('Demonstração')).toBeTruthy();
    expect(within(linhaDemo).getByText('3.490')).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/api/plataforma/uso?dias=30')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    await waitFor(() => expect(pedidos.some((p) => p.caminho === '/api/plataforma/uso?dias=7')).toBe(true));
  });
});

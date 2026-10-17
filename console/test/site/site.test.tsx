// Site do produto (S1) e páginas dos textos jurídicos: planos da tabela com e sem preço, pedido de
// contato (sucesso, validação e erro do servidor) e a faixa de minuta só com o texto não aprovado.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Plano, PlanosPublicos, TextoLegal } from '@copiloto/shared';
import Site from '../../src/paginas/site/Site.tsx';
import PaginaLegal from '../../src/paginas/site/PaginaLegal.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Pedido {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

/** fetch falso para /api/publico. Chave: "METODO /caminho"; valor: corpo (200) ou { status, corpo }. */
function instalarFetch(rotas: Record<string, unknown>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = (init?.method ?? 'GET').toUpperCase();
      const caminho = String(url).replace(/^\/api\/publico/, '');
      pedidos.push({ metodo, caminho, corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      const r = rotas[`${metodo} ${caminho}`] as { status?: number; corpo?: unknown } | undefined;
      const [status, corpo] = r && typeof r.status === 'number' ? [r.status, r.corpo] : r ? [200, r] : [404, { erro: 'nao_encontrado', mensagem: 'Sem rota.' }];
      return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return pedidos;
}

function plano(p: Partial<Plano> & Pick<Plano, 'id' | 'nome' | 'botao'>): Plano {
  return {
    ordem: 1,
    descricao: '',
    usuariosMin: 1,
    usuariosMax: null,
    creditosIncluidos: null,
    precoMensalCentavos: null,
    taxaImplantacaoCentavos: null,
    precoCreditoExtraCentavos: null,
    notaPreco: '',
    destaques: [],
    atualizadoEm: '2026-10-17T12:00:00.000Z',
    ...p,
  };
}

const PLANOS: Plano[] = [
  plano({
    id: 'piloto',
    nome: 'Piloto',
    botao: 'cadastro',
    descricao: 'Para validar com um grupo de clientes, com a Starta ao seu lado.',
    usuariosMax: 200,
    creditosIncluidos: 3000,
    notaPreco: 'mais taxa de implantação {implantacao}, cobrada uma vez',
    destaques: ['Implantação assistida: gravamos as primeiras tarefas com você', 'Assistente no seu sistema, com a sua marca'],
  }),
  plano({
    id: 'crescimento',
    nome: 'Crescimento',
    botao: 'demonstracao',
    ordem: 2,
    usuariosMin: 201,
    usuariosMax: 1000,
    creditosIncluidos: 15000,
    notaPreco: 'sem taxa de implantação para quem vem do piloto',
  }),
  plano({ id: 'escala', nome: 'Escala', botao: 'vendas', ordem: 3, usuariosMin: 1001, notaPreco: 'proposta conforme volume' }),
];

const SEM_PRECO: PlanosPublicos = { planos: PLANOS, valoresDeExemplo: true, cadastroAberto: true };
const COM_PRECO: PlanosPublicos = {
  planos: [
    { ...PLANOS[0], precoMensalCentavos: 199_000, taxaImplantacaoCentavos: 450_000, precoCreditoExtraCentavos: 45 },
    { ...PLANOS[1], precoMensalCentavos: 690_000, precoCreditoExtraCentavos: 40 },
    { ...PLANOS[2], precoMensalCentavos: 1_500_000, precoCreditoExtraCentavos: 35 },
  ],
  valoresDeExemplo: false,
  cadastroAberto: true,
};

const NOTA_EXEMPLO = 'Faixas e créditos incluídos são de exemplo. Os valores finais saem na proposta.';

function abrir(elemento: ReactNode, caminho = '/site') {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path={caminho} element={elemento} />
        <Route path="*" element={<div>outra página</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Cartão do plano pelo título. */
const cartao = async (nome: string) => (await screen.findByRole('article', { name: nome })) as HTMLElement;
const itens = (el: HTMLElement) => within(el).getAllByRole('listitem').map((li) => li.textContent);

describe('Site · planos', () => {
  it('sem preço definido: "Sob consulta", sem "/mês", e a nota de valores de exemplo', async () => {
    instalarFetch({ 'GET /planos': SEM_PRECO });
    abrir(<Site />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Um copiloto que faz o trabalho dentro do seu sistema, pelos seus clientes',
    );

    const piloto = await cartao('Piloto');
    expect(within(piloto).getByText('Comece por aqui')).toBeTruthy();
    expect(within(piloto).getByText('Sob consulta')).toBeTruthy();
    expect(within(piloto).queryByText('/mês')).toBeNull();
    expect(within(piloto).getByText('mais taxa de implantação sob consulta, cobrada uma vez')).toBeTruthy();
    expect(itens(piloto)).toEqual([
      'Até 200 usuários do seu sistema',
      '3.000 créditos incluídos por mês',
      'Crédito extra sob consulta',
      'Implantação assistida: gravamos as primeiras tarefas com você',
      'Assistente no seu sistema, com a sua marca',
    ]);
    expect(within(piloto).getByRole('link', { name: 'Começar piloto' }).getAttribute('href')).toBe('/criar-conta');

    const crescimento = await cartao('Crescimento');
    expect(itens(crescimento).slice(0, 3)).toEqual(['De 201 a 1.000 usuários', '15.000 créditos incluídos por mês', 'Crédito extra sob consulta']);
    expect(within(crescimento).getByRole('button', { name: 'Agendar demonstração' })).toBeTruthy();
    const escala = await cartao('Escala');
    expect(itens(escala).slice(0, 2)).toEqual(['Mais de 1.000 usuários', 'Créditos incluídos sob medida']);
    expect(within(escala).getByText('proposta conforme volume')).toBeTruthy();
    expect(within(escala).getByRole('button', { name: 'Falar com vendas' })).toBeTruthy();

    expect(screen.getAllByText('Sob consulta')).toHaveLength(3);
    expect(screen.getByText(NOTA_EXEMPLO)).toBeTruthy();
  });

  it('com os preços definidos: "R$ 1.990/mês" e sem a nota de exemplo', async () => {
    instalarFetch({ 'GET /planos': COM_PRECO });
    abrir(<Site />);
    const piloto = await cartao('Piloto');
    expect(within(piloto).getByText('R$ 1.990').parentElement?.textContent).toBe('R$ 1.990/mês');
    expect(within(piloto).getByText('mais taxa de implantação R$ 4.500, cobrada uma vez')).toBeTruthy();
    expect(itens(piloto)[2]).toBe('Crédito extra R$ 0,45');
    expect(within(await cartao('Crescimento')).getByText('R$ 6.900')).toBeTruthy();
    expect(within(await cartao('Escala')).getByText('R$ 15.000')).toBeTruthy();
    expect(screen.queryByText('Sob consulta')).toBeNull();
    expect(screen.queryByText(NOTA_EXEMPLO)).toBeNull();
  });

  it('com o cadastro fechado, "Começar piloto" vira pedido de contato', async () => {
    const pedidos = instalarFetch({ 'GET /planos': { ...SEM_PRECO, cadastroAberto: false }, 'POST /contato': { ok: true } });
    abrir(<Site />);
    fireEvent.click(within(await cartao('Piloto')).getByRole('button', { name: 'Começar piloto' }));
    const modal = await screen.findByRole('dialog', { name: 'Começar piloto' });
    expect(within(modal).getByText(/O cadastro de empresas novas está fechado agora/)).toBeTruthy();
    preencher(modal);
    fireEvent.click(within(modal).getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(pedidos.find((p) => p.caminho === '/contato')?.corpo).toMatchObject({ origem: 'piloto' }));
  });

  it('se os planos não carregam, oferece tentar de novo', async () => {
    instalarFetch({ 'GET /planos': { status: 500, corpo: { erro: 'erro_interno', mensagem: 'Algo deu errado do nosso lado.' } } });
    abrir(<Site />);
    expect(await screen.findByText('Não conseguimos carregar os planos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});

function preencher(modal: HTMLElement, extra: Partial<Record<'telefone' | 'mensagem', string>> = {}) {
  fireEvent.change(within(modal).getByLabelText(/^Nome/), { target: { value: 'Luana Freitas' } });
  fireEvent.change(within(modal).getByLabelText(/E-mail de trabalho/), { target: { value: 'luana@pedrabranca.com.br' } });
  fireEvent.change(within(modal).getByLabelText(/^Empresa/), { target: { value: 'Pedra Branca' } });
  fireEvent.change(within(modal).getByLabelText(/Quantos usuários o seu sistema tem/), { target: { value: 'ate_1000' } });
  if (extra.telefone !== undefined) fireEvent.change(within(modal).getByLabelText(/Telefone/), { target: { value: extra.telefone } });
  if (extra.mensagem !== undefined) fireEvent.change(within(modal).getByLabelText(/Mensagem/), { target: { value: extra.mensagem } });
}

describe('Site · pedido de contato', () => {
  it('"Agendar demonstração" abre o formulário, envia e mostra o sucesso', async () => {
    const pedidos = instalarFetch({ 'GET /planos': SEM_PRECO, 'POST /contato': { ok: true } });
    abrir(<Site />);
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Agendar demonstração' }));
    const modal = await screen.findByRole('dialog', { name: 'Agendar demonstração' });
    preencher(modal, { telefone: '(51) 99999-0000', mensagem: 'Queremos ver com o nosso ERP.' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Enviar pedido' }));
    expect(
      await within(modal).findByText('Recebemos seu pedido. A equipe da Starta vai falar com você pelo e-mail informado.'),
    ).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/contato')).toEqual({
      metodo: 'POST',
      caminho: '/contato',
      corpo: {
        nome: 'Luana Freitas',
        email: 'luana@pedrabranca.com.br',
        empresa: 'Pedra Branca',
        telefone: '(51) 99999-0000',
        faixa: 'ate_1000',
        mensagem: 'Queremos ver com o nosso ERP.',
        origem: 'demonstracao',
      },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Voltar ao site' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Falar com vendas" manda a origem vendas, sem os campos opcionais vazios', async () => {
    const pedidos = instalarFetch({ 'GET /planos': SEM_PRECO, 'POST /contato': { ok: true } });
    abrir(<Site />);
    fireEvent.click(within(await cartao('Escala')).getByRole('button', { name: 'Falar com vendas' }));
    const modal = await screen.findByRole('dialog', { name: 'Falar com vendas' });
    preencher(modal);
    fireEvent.click(within(modal).getByRole('button', { name: 'Enviar pedido' }));
    await within(modal).findByText(/Recebemos seu pedido/);
    const corpo = pedidos.find((p) => p.caminho === '/contato')?.corpo as Record<string, unknown>;
    expect(corpo.origem).toBe('vendas');
    expect('telefone' in corpo || 'mensagem' in corpo).toBe(false);
  });

  it('valida antes de enviar e mostra o erro do servidor (ex.: muitos pedidos)', async () => {
    const pedidos = instalarFetch({
      'GET /planos': SEM_PRECO,
      'POST /contato': {
        status: 429,
        corpo: { erro: 'muitos_pedidos', mensagem: 'Recebemos muitos pedidos deste endereço na última hora. Tente de novo em 42 min.', aguardarS: 2500 },
      },
    });
    abrir(<Site />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Agendar demonstração' })[0]);
    const modal = await screen.findByRole('dialog', { name: 'Agendar demonstração' });

    fireEvent.click(within(modal).getByRole('button', { name: 'Enviar pedido' }));
    expect(await within(modal).findByText('Diga seu nome.')).toBeTruthy();
    expect(within(modal).getByText('Digite um e-mail completo, por exemplo nome@suaempresa.com.br')).toBeTruthy();
    expect(within(modal).getByText('Diga o nome da empresa.')).toBeTruthy();
    expect(within(modal).getByText('Escolha quantos usuários o seu sistema tem.')).toBeTruthy();
    preencher(modal, { telefone: '9999-000' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Enviar pedido' }));
    expect(await within(modal).findByText('Digite o telefone com DDD, por exemplo (51) 99999-0000.')).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/contato')).toBe(false);

    fireEvent.change(within(modal).getByLabelText(/Telefone/), { target: { value: '' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Enviar pedido' }));
    expect(await within(modal).findByRole('alert')).toBeTruthy();
    expect(within(modal).getByText('Recebemos muitos pedidos deste endereço na última hora. Tente de novo em 42 min.')).toBeTruthy();
    expect(within(modal).queryByText(/Recebemos seu pedido/)).toBeNull();
  });
});

const TEXTO: TextoLegal = {
  documento: 'termos',
  titulo: 'Termos de uso',
  versao: '2026-10-17',
  fonte: 'minuta',
  markdown: [
    '# Termos de uso',
    '',
    'Estes Termos regem o uso do **Copiloto Starta**. Veja o [Contrato](/contrato-lgpd).',
    '',
    '## 1. Quem é quem',
    '',
    '- **Starta**: quem oferece.',
    '- **Cliente**: a empresa.',
    '',
    '<script>alert(1)</script> e [isto](javascript:alert(1)) não viram código nem link.',
  ].join('\n'),
};

describe('Textos jurídicos', () => {
  // A página volta ao topo ao abrir (o jsdom não rola).
  beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));

  it('a minuta mostra a faixa de revisão jurídica e o Markdown vira títulos, listas e links', async () => {
    instalarFetch({ 'GET /textos/termos': TEXTO });
    const { container } = abrir(<PaginaLegal documento="termos" />, '/termos');
    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de uso' })).toBeTruthy();
    expect(screen.getByText('Minuta em revisão jurídica: este texto ainda não é a versão final.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '1. Quem é quem' })).toBeTruthy();
    const lista = container.querySelector('article ul') as HTMLElement;
    expect(within(lista).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Starta: quem oferece.', 'Cliente: a empresa.']);
    expect(within(lista).getByText('Starta').tagName).toBe('STRONG');
    const artigo = container.querySelector('article') as HTMLElement;
    expect(within(artigo).getByRole('link', { name: 'Contrato' }).getAttribute('href')).toBe('/contrato-lgpd');
    expect(within(artigo).getAllByRole('link')).toHaveLength(1);
    expect(artigo.querySelector('script')).toBeNull();
    expect(artigo.textContent).toContain('<script>alert(1)</script> e isto');
    expect(screen.getByText('Versão de 17/10/2026')).toBeTruthy();
    expect(document.title).toBe('Termos de uso · Copiloto Starta');
  });

  it('o texto aprovado (TEXTOS_LEGAIS_DIR) aparece sem a faixa', async () => {
    instalarFetch({ 'GET /textos/privacidade': { ...TEXTO, documento: 'privacidade', fonte: 'aprovado', versao: '3f9a1c2b7d4e' } });
    abrir(<PaginaLegal documento="privacidade" />, '/privacidade');
    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de uso' })).toBeTruthy();
    expect(screen.queryByText(/Minuta em revisão jurídica/)).toBeNull();
    expect(screen.getByText('Versão 3f9a1c2b7d4e')).toBeTruthy();
  });
});

// Moldura do console: menu com contadores, faixas, busca, "Testar copiloto" e menu da conta.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { recarregar } from '../../src/componentes/sessao.tsx';
import Layout from '../../src/layout/Layout.tsx';
import { HORIZONTE, instalarEventSource, instalarFetch, local, renderizar, USUARIOS } from './ambiente.tsx';

vi.mock('@copiloto/widget/chat', () => ({
  ChatCopiloto: ({ token }: { token: string }) => <div data-testid="chat">chat {token}</div>,
}));

beforeEach(() => {
  instalarEventSource();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ACME = { id: 'emp-acme', nome: 'Acme Logística', demo: false };

const pagina = (
  <Layout>
    <p>conteúdo da página</p>
  </Layout>
);

describe('Moldura do console', () => {
  it('menu com grupos, contadores e guia', async () => {
    instalarFetch({});
    renderizar(pagina, { caminho: '/painel' });
    const nav = screen.getByRole('navigation', { name: 'Menu principal' });
    for (const g of ['Copiloto', 'Configurar', 'Conta']) expect(within(nav).getByRole('group', { name: g })).toBeTruthy();
    // Painel e Execuções ficam no topo, sem rótulo visível (como no design); "Sistema" no fim de Configurar.
    expect(nav.querySelectorAll('.nav-label')[0]?.textContent).toBe('Configurar');
    const configurar = within(within(nav).getByRole('group', { name: 'Configurar' })).getAllByRole('link');
    expect(configurar.map((l) => l.textContent)).toEqual(['Tarefas', 'Aprender fluxo', 'Conhecimento', 'Canais e widget', 'Sistema']);
    expect(within(nav).queryByRole('group', { name: 'Plataforma' })).toBeNull();
    expect(within(nav).getByRole('link', { name: /Execuções/ }).textContent).toContain('3');
    expect(within(nav).getByRole('link', { name: /Guia de início/ }).textContent).toContain('3/5');
    expect(within(nav).getByRole('link', { name: /Painel/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('conteúdo da página').closest('main')?.className).toContain('page');
    expect(screen.getByText('Horizonte · Demonstração')).toBeTruthy();
    expect(document.title).toBe('Painel · Copiloto');
  });

  it('faixas de modo simulado e de gasto', async () => {
    instalarFetch({});
    renderizar(pagina, {
      caminho: '/painel',
      extra: { modoSimulado: true, alertaGasto: { usado: 1200, limite: 1500, percentual: 0.8 } },
    });
    const simulado = 'O copiloto está em modo simulado (COPILOTO_LLM=simulado): as respostas seguem regras de teste, sem o Claude.';
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === simulado)).toBeTruthy();
    expect(screen.queryByText('O copiloto está sem a chave do Claude')).toBeNull();
    expect(screen.getByText('Você usou 80% do limite de gasto deste mês')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ajustar limite' }).getAttribute('href')).toBe('/equipe');
    fireEvent.click(screen.getByRole('button', { name: 'Lembrar amanhã' }));
    expect(screen.queryByText('Você usou 80% do limite de gasto deste mês')).toBeNull();
  });

  it('faixa vermelha quando o servidor está sem a chave do Claude', () => {
    instalarFetch({});
    renderizar(pagina, { caminho: '/painel', extra: { semClaude: true } });
    const faixa = screen.getByRole('alert');
    expect(faixa.textContent).toContain('O copiloto está sem a chave do Claude');
    expect(faixa.textContent).toContain('ANTHROPIC_API_KEY');
  });

  it('busca no console e abre o resultado', async () => {
    const { pedidos } = instalarFetch({
      'GET /busca': {
        itens: [
          { tipo: 'tarefa', titulo: 'Cadastrar cliente', detalhe: 'Ativa · API', destino: '/tarefas/tar-1' },
          { tipo: 'pessoa', titulo: 'Ana Ribeiro', detalhe: 'Comercial', destino: '/execucoes?pessoa=Ana%20Ribeiro' },
        ],
      },
    });
    renderizar(pagina, { caminho: '/painel' });
    const busca = screen.getByRole('combobox', { name: 'Buscar no console' });
    fireEvent.change(busca, { target: { value: 'cli' } });
    const opcao = await screen.findByRole('option', { name: /Cadastrar cliente/ });
    expect(pedidos.some((p) => p.caminho === '/busca?q=cli')).toBe(true);
    expect(screen.getByRole('group', { name: 'Pessoas' })).toBeTruthy();
    fireEvent.click(opcao);
    await waitFor(() => expect(local()).toBe('/tarefas/tar-1'));
  });

  it('"Testar copiloto" abre o chat de teste com o usuário escolhido', async () => {
    const { pedidos } = instalarFetch({
      'GET /sistema/usuarios': USUARIOS,
      'POST /teste/token': { token: 'tok-ana', usuario: USUARIOS[0] },
    });
    renderizar(pagina, { caminho: '/painel' });
    fireEvent.click(screen.getByRole('button', { name: 'Testar copiloto' }));
    const gaveta = await screen.findByRole('dialog', { name: 'Testar copiloto' });
    expect(await within(gaveta).findByTestId('chat')).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/teste/token')?.corpo).toEqual({ usuarioId: '101' });
    fireEvent.change(within(gaveta).getByLabelText('Testar como'), { target: { value: '102' } });
    await waitFor(() => expect(pedidos.filter((p) => p.caminho === '/teste/token').at(-1)?.corpo).toEqual({ usuarioId: '102' }));
    expect(localStorage.getItem('copiloto:teste:usuario')).toBe('"102"');
  });

  it('menu da conta sai do console', async () => {
    instalarFetch({});
    const { sessao } = renderizar(pagina, { caminho: '/painel' });
    fireEvent.click(screen.getByRole('button', { name: /Rafael Lima, Admin\. Abrir menu da conta/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Sair/ }));
    await waitFor(() => expect(sessao.sair).toHaveBeenCalled());
  });

  it('topo mostra "· Produção" numa empresa de verdade', async () => {
    instalarFetch({});
    renderizar(pagina, { caminho: '/painel', eu: { empresa: ACME, empresas: [ACME] } });
    expect(screen.getByText('Acme Logística · Produção')).toBeTruthy();
    expect(screen.queryByText(/Demonstração/)).toBeNull();
  });

  it('seletor de empresa no menu lateral troca de empresa e recarrega o console', async () => {
    const recarregou = vi.spyOn(recarregar, 'console').mockImplementation(() => {});
    const { pedidos } = instalarFetch({ 'POST /auth/empresa': { id: 'mem-9', empresa: ACME } });
    renderizar(pagina, { caminho: '/painel', eu: { empresas: [HORIZONTE, ACME] } });
    const nav = screen.getByRole('navigation', { name: 'Menu principal' });
    const seletor = within(nav).getByRole('button', { name: 'Trocar de empresa. Empresa atual: Horizonte' });
    expect(seletor.getAttribute('aria-haspopup')).toBe('menu');
    // O selo "Demonstração" só aparece no menu, não no botão.
    expect(within(seletor).queryByText('Demonstração')).toBeNull();
    fireEvent.click(seletor);
    const menu = within(nav).getByRole('menu');
    expect(within(menu).getByText('Demonstração')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Criar outra empresa/ }).getAttribute('href')).toBe('/criar-conta');
    expect(within(menu).queryByRole('menuitem', { name: /Empresas clientes/ })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Acme Logística/ }));
    await waitFor(() => expect(recarregou).toHaveBeenCalledWith('/'));
    expect(pedidos.find((p) => p.caminho === '/auth/empresa')?.corpo).toEqual({ empresaId: 'emp-acme' });
  });

  it('menu da conta: empresa aberta, troca de empresa e erro ao trocar', async () => {
    const recarregou = vi.spyOn(recarregar, 'console').mockImplementation(() => {});
    instalarFetch({ 'POST /auth/empresa': { __status: 403, corpo: { erro: 'sem_permissao', mensagem: 'Você não está mais nesta empresa.' } } });
    renderizar(pagina, { caminho: '/painel', eu: { empresas: [HORIZONTE, ACME] } });
    fireEvent.click(screen.getByRole('button', { name: /Rafael Lima, Admin\. Abrir menu da conta/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Empresa aberta')).toBeTruthy();
    expect(within(within(menu).getByRole('group', { name: 'Trocar de empresa' })).getByRole('menuitem', { name: /Acme Logística/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Criar outra empresa/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Acme Logística/ }));
    expect(await screen.findByText(/Não consegui abrir Acme Logística\. Você não está mais nesta empresa\./)).toBeTruthy();
    expect(recarregou).not.toHaveBeenCalled();
  });

  it('só quem administra a plataforma vê "Empresas clientes"', async () => {
    instalarFetch({});
    renderizar(pagina, { caminho: '/painel', eu: { adminPlataforma: true } });
    const nav = screen.getByRole('navigation', { name: 'Menu principal' });
    const grupo = within(nav).getByRole('group', { name: 'Plataforma' });
    expect(within(grupo).getByRole('link', { name: 'Empresas clientes' }).getAttribute('href')).toBe('/plataforma');
    fireEvent.click(within(nav).getByRole('button', { name: /Trocar de empresa/ }));
    expect(within(within(nav).getByRole('menu')).getByRole('menuitem', { name: /Empresas clientes/ }).getAttribute('href')).toBe('/plataforma');
  });
});

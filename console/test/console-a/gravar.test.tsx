// Começar gravação (C4) vindo da extensão do navegador: ?gravar=<endereço> abre o modal preenchido,
// e o modal diz se a extensão está instalada.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MARCA_EXTENSAO } from '@copiloto/shared';
import ListaFluxos, { enderecoParaGravar } from '../../src/paginas/aprender/ListaFluxos.tsx';
import { recarregar } from '../../src/componentes/sessao.tsx';
import { HORIZONTE, instalarEventSource, instalarFetch, local, renderizar, status } from './ambiente.tsx';

const TAREFAS = { tarefas: [], contagem: { todas: 0, ativa: 0, teste: 0, rascunho: 0, inativa: 0 }, semTarefa: [] };
const CONEXAO = { ok: true, nome: 'Horizonte', url: 'http://localhost:4000', urlTelas: 'http://localhost:4000' };

beforeEach(() => instalarEventSource());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(MARCA_EXTENSAO);
});

const campoUrl = () => screen.getByLabelText(/Página onde a tarefa começa/) as HTMLInputElement;

describe('C4 · Começar gravação pela extensão', () => {
  it('endereço do sistema vira caminho; de outro site fica completo', () => {
    expect(enderecoParaGravar('http://localhost:4000/chamados?x=1#topo', 'http://localhost:4000')).toBe('/chamados?x=1#topo');
    expect(enderecoParaGravar('https://portal.fornecedor.com.br/pedidos', 'http://localhost:4000')).toBe('https://portal.fornecedor.com.br/pedidos');
    expect(enderecoParaGravar('http://localhost:4000/chamados')).toBe('http://localhost:4000/chamados');
  });

  it('?gravar= abre o modal com a página preenchida e manda o caminho', async () => {
    const aba = { closed: false, opener: {}, location: { href: '' }, close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => aba));
    const { pedidos } = instalarFetch({
      'GET /fluxos': [],
      'GET /tarefas': TAREFAS,
      'GET /sistema/conexao': CONEXAO,
      'POST /fluxos': {
        fluxo: { id: 'flu-9' },
        urlGravacao: 'http://localhost:4000/chamados?copiloto_gravacao=tok&copiloto_api=http%3A%2F%2Flocalhost%3A3000',
      },
    });
    renderizar(<ListaFluxos />, { caminho: `/aprender?gravar=${encodeURIComponent('http://localhost:4000/chamados')}` });

    expect(await screen.findByRole('dialog', { name: 'Começar gravação' })).toBeTruthy();
    await waitFor(() => expect(campoUrl().value).toBe('/chamados'));
    expect(screen.getByText(/instale o gravador de fluxos \(extensão do navegador\)/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Como instalar' }).getAttribute('href')).toBe('/aprender/instalar');
    expect(screen.getByText(/Veio da aba em que você clicou em Gravar esta aba/)).toBeTruthy();
    expect(screen.getByText('Entre no Horizonte antes de gravar')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Nome do fluxo/), { target: { value: 'Abrir chamado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir e gravar' }));
    await waitFor(() => expect(local()).toBe('/aprender/flu-9'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ nome: 'Abrir chamado', tarefaId: null, urlInicial: '/chamados' });
    expect(aba.location.href).toContain('copiloto_gravacao=tok');
  });

  it('sem a extensão: a lista leva para Instalar o gravador', async () => {
    instalarFetch({ 'GET /fluxos': [], 'GET /tarefas': TAREFAS });
    renderizar(<ListaFluxos />, { caminho: '/aprender' });
    expect((await screen.findByRole('link', { name: 'Instalar o gravador' })).getAttribute('href')).toBe('/aprender/instalar');
  });

  it('?empresa= de outra empresa da conta: troca a empresa do console antes de gravar', async () => {
    const ir = vi.spyOn(recarregar, 'console').mockImplementation(() => {});
    const { pedidos } = instalarFetch({ 'GET /fluxos': [], 'GET /tarefas': TAREFAS, 'POST /auth/empresa': { ok: true } });
    const ACME = { id: 'emp-acme', nome: 'Acme', demo: false };
    renderizar(<ListaFluxos />, {
      caminho: `/aprender?nova=1&gravar=${encodeURIComponent('http://localhost:4000/chamados')}&empresa=emp-acme`,
      eu: { empresas: [HORIZONTE, ACME] },
    });
    expect(screen.getByText('Abrindo a Acme para gravar…')).toBeTruthy();
    await waitFor(() => expect(ir).toHaveBeenCalled());
    expect(pedidos.find((p) => p.metodo === 'POST')).toMatchObject({ caminho: '/auth/empresa', corpo: { empresaId: 'emp-acme' } });
    const destino = ir.mock.calls[0][0];
    expect(destino.startsWith('/aprender?')).toBe(true);
    expect(destino).not.toContain('empresa=');
    expect(new URLSearchParams(destino.split('?')[1]).get('gravar')).toBe('http://localhost:4000/chamados');
    ir.mockRestore();
  });

  it('?empresa= da empresa aberta: só abre o modal; de empresa fora da conta: avisa', async () => {
    instalarFetch({ 'GET /fluxos': [], 'GET /tarefas': TAREFAS, 'GET /sistema/conexao': CONEXAO });
    renderizar(<ListaFluxos />, { caminho: `/aprender?nova=1&empresa=${HORIZONTE.id}` });
    expect(await screen.findByRole('dialog', { name: 'Começar gravação' })).toBeTruthy();
    await waitFor(() => expect(local()).toBe('/aprender?nova=1'));
    cleanup();

    const { pedidos } = instalarFetch({ 'GET /fluxos': [], 'GET /tarefas': TAREFAS, 'POST /auth/empresa': status(403, {}) });
    renderizar(<ListaFluxos />, { caminho: '/aprender?nova=1&empresa=emp-sumida' });
    expect(await screen.findByText(/conectado a uma empresa em que você não está mais/)).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
  });

  it('com a extensão instalada, o modal avisa', async () => {
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.1.0');
    instalarFetch({ 'GET /fluxos': [], 'GET /tarefas': TAREFAS });
    renderizar(<ListaFluxos />, { caminho: '/aprender?nova=1' });
    expect(await screen.findByText(/Extensão instalada/)).toBeTruthy();
    expect(campoUrl().value).toBe('');
  });
});

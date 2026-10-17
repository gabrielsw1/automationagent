// Começar gravação (C4) vindo da extensão do navegador: ?gravar=<endereço> abre o modal preenchido,
// e o modal diz se a extensão está instalada.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MARCA_EXTENSAO } from '@copiloto/shared';
import ListaFluxos, { enderecoParaGravar } from '../../src/paginas/aprender/ListaFluxos.tsx';
import { instalarEventSource, instalarFetch, local, renderizar } from './ambiente.tsx';

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
    expect(screen.getByText(/instale a extensão do navegador/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Como instalar' }).getAttribute('href')).toContain('#extens%C3%A3o-para-gravar-fluxos');

    fireEvent.change(screen.getByLabelText(/Nome do fluxo/), { target: { value: 'Abrir chamado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir e gravar' }));
    await waitFor(() => expect(local()).toBe('/aprender/flu-9'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ nome: 'Abrir chamado', tarefaId: null, urlInicial: '/chamados' });
    expect(aba.location.href).toContain('copiloto_gravacao=tok');
  });

  it('com a extensão instalada, o modal avisa', async () => {
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.1.0');
    instalarFetch({ 'GET /fluxos': [], 'GET /tarefas': TAREFAS });
    renderizar(<ListaFluxos />, { caminho: '/aprender?nova=1' });
    expect(await screen.findByText(/Extensão instalada/)).toBeTruthy();
    expect(campoUrl().value).toBe('');
  });
});

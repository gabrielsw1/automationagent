// Faixa do modo suporte na moldura do console: quem da Starta entrou, o motivo, até quando, e
// "Sair do modo suporte", que encerra o acesso e volta para a Plataforma.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { recarregar } from '../../src/componentes/sessao.tsx';
import Layout from '../../src/layout/Layout.tsx';
import { instalarEventSource, instalarFetch, renderizar } from './ambiente.tsx';

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

const pagina = (
  <Layout>
    <p>conteúdo da página</p>
  </Layout>
);

const SUPORTE = { pessoa: 'Gabriel Moreno', motivo: 'A empresa pediu ajuda com a remarcação', ate: '2026-10-17T17:30:00.000Z' };

describe('Modo suporte no console da empresa', () => {
  it('mostra quem entrou, o motivo e até quando', () => {
    instalarFetch({});
    renderizar(pagina, { caminho: '/painel', perfil: 'suporte', eu: { modoSuporte: SUPORTE } });
    const faixa = screen.getByRole('status', { name: 'Modo suporte' });
    expect(faixa.textContent).toContain('Modo suporte · Gabriel Moreno (Starta) · Motivo: A empresa pediu ajuda com a remarcação · até 14:30');
    expect(screen.getByText('conteúdo da página')).toBeTruthy();
  });

  it('“Sair do modo suporte” encerra o acesso e volta para a Plataforma', async () => {
    const abrir = vi.spyOn(recarregar, 'console').mockImplementation(() => {});
    const { pedidos } = instalarFetch({ 'POST /auth/sair': { ok: true } });
    renderizar(pagina, { caminho: '/painel', perfil: 'suporte', eu: { modoSuporte: SUPORTE } });
    fireEvent.click(screen.getByRole('button', { name: 'Sair do modo suporte' }));
    await waitFor(() => expect(abrir).toHaveBeenCalledWith('/plataforma'));
    expect(pedidos.some((p) => p.metodo === 'POST' && p.caminho === '/auth/sair')).toBe(true);
  });

  it('sem modo suporte, não há faixa', () => {
    instalarFetch({});
    renderizar(pagina, { caminho: '/painel' });
    expect(screen.queryByRole('status', { name: 'Modo suporte' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair do modo suporte' })).toBeNull();
  });
});

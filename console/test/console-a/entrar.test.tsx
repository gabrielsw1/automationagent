// Entrar, primeiro acesso e convite.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import Convite from '../../src/paginas/entrar/Convite.tsx';
import Entrar from '../../src/paginas/entrar/Entrar.tsx';
import { instalarFetch, local, renderizar, status } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EU = { id: 'mem-1', nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', perfil: 'admin', iniciais: 'RL' };

describe('Entrar', () => {
  it('valida, mostra o erro do servidor e entra', async () => {
    let tentativas = 0;
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: true },
      'POST /auth/entrar': () =>
        ++tentativas === 1 ? status(401, { erro: 'credenciais', mensagem: 'E-mail ou senha não conferem.' }) : EU,
    });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    expect(await screen.findByRole('heading', { name: 'Entrar no console' })).toBeTruthy();
    expect(screen.getByText(/rafael\.lima@seusistema\.com\.br/)).toBeTruthy();
    expect(screen.getByText(/copiloto123/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Digite o e-mail e a senha.')).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/auth/entrar')).toBe(false);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'rafael.lima@seusistema.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('E-mail ou senha não conferem.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'copiloto123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.filter((p) => p.caminho === '/auth/entrar').at(-1)?.corpo).toEqual({ email: 'rafael.lima@seusistema.com.br', senha: 'copiloto123' });
  });

  it('sem modo demonstração não mostra a dica', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: false } });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    await screen.findByRole('heading', { name: 'Entrar no console' });
    expect(screen.queryByText(/copiloto123/)).toBeNull();
  });

  it('primeiro acesso cria o Admin e abre o guia', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': { precisaCriarAdmin: true, demo: false },
      'POST /auth/primeiro-admin': EU,
    });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    const botao = await screen.findByRole('button', { name: 'Criar acesso e entrar' });
    fireEvent.change(screen.getByLabelText(/Seu nome/), { target: { value: 'Rafael Lima' } });
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'rafael@horizonte.com.br' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'curta' } });
    fireEvent.click(botao);
    expect(pedidos.some((p) => p.caminho === '/auth/primeiro-admin')).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'uma senha boa' } });
    fireEvent.click(botao);
    await waitFor(() => expect(local()).toBe('/guia'));
    expect(pedidos.find((p) => p.caminho === '/auth/primeiro-admin')?.corpo).toEqual({
      nome: 'Rafael Lima',
      email: 'rafael@horizonte.com.br',
      senha: 'uma senha boa',
    });
  });

  it('servidor fora do ar mostra erro com "Tentar de novo"', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': status(500, { erro: 'interno', mensagem: 'Erro interno.', ref: '7F3A-21' }) });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    expect(await screen.findByText('Não consegui falar com o servidor do copiloto')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tentar de novo/ })).toBeTruthy();
  });
});

describe('Convite', () => {
  it('cria o acesso com o perfil do convite', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/convite/abc': { email: 'julia@horizonte.com.br', perfil: 'editor' },
      'POST /auth/convite/abc': EU,
    });
    renderizar(<Convite />, { caminho: '/convite/abc', rota: '/convite/:token' });
    expect(await screen.findByRole('heading', { name: 'Crie o seu acesso' })).toBeTruthy();
    expect(screen.getByText('Editor de tarefas')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Seu nome/), { target: { value: 'Júlia Martins' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'senha forte 1' } });
    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: 'senha forte 2' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/ }));
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: 'senha forte 1' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/ }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ nome: 'Júlia Martins', senha: 'senha forte 1' });
  });

  it('convite expirado', async () => {
    instalarFetch({ 'GET /auth/convite/velho': status(410, { erro: 'expirado', mensagem: 'Este convite passou de 7 dias.' }) });
    renderizar(<Convite />, { caminho: '/convite/velho', rota: '/convite/:token' });
    expect(await screen.findByRole('heading', { name: 'Este convite expirou' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para a tela de entrada' })).toBeTruthy();
  });
});

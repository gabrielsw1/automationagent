// A6 · Aceitar o convite: conta nova (nome e senha) e e-mail que já tem conta (entra e aceita).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ConviteAberto, Eu } from '@copiloto/shared';
import Convite from '../../src/paginas/entrar/Convite.tsx';
import Entrar from '../../src/paginas/entrar/Entrar.tsx';
import { HORIZONTE, instalarFetch, local, renderizarRotas, status } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACME = { id: 'emp-acme', nome: 'Acme Logística', demo: false };
const CONVITE: ConviteAberto = {
  email: 'julia@horizonte.com.br',
  perfil: 'editor',
  empresa: 'Horizonte',
  contaExistente: false,
  convidadoPor: { nome: 'Rafael Lima', perfil: 'admin' },
  validoAte: '2026-10-24T13:00:00.000Z',
};
const JULIA: Eu = {
  id: 'mem-2',
  nome: 'Júlia Martins',
  email: 'julia@horizonte.com.br',
  perfil: 'editor',
  iniciais: 'JM',
  emailConfirmado: true,
  empresa: HORIZONTE,
  empresas: [HORIZONTE],
  adminPlataforma: false,
};
const RAFAEL: Eu = { ...JULIA, id: 'mem-1', nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', perfil: 'admin', iniciais: 'RL' };
const SEM_SESSAO = status(401, { erro: 'sem_sessao', mensagem: 'Entre para continuar.' });
const ACESSO = { precisaCriarAdmin: false, demo: false, cadastroAberto: true, envioEmail: 'smtp' };

const telas = { '/convite/:token': <Convite />, '/entrar': <Entrar /> };

describe('A6 · Convite', () => {
  it('e-mail novo: mostra quem convidou e o perfil, confere as senhas, cria a conta e entra', async () => {
    const { pedidos } = instalarFetch({ 'GET /auth/convite/abc': CONVITE, 'GET /auth/eu': SEM_SESSAO, 'POST /auth/convite/abc': JULIA });
    renderizarRotas(telas, '/convite/abc');
    expect(await screen.findByRole('heading', { name: 'Você recebeu um convite para o Copiloto da Horizonte' })).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Convite de Rafael Lima, Admin')).toBeTruthy();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && el.textContent === 'Você entra como Editor de tarefas: vai poder criar, testar e publicar tarefas, fluxos e conhecimento.',
      ),
    ).toBeTruthy();
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect(email.value).toBe('julia@horizonte.com.br');
    expect(email.readOnly).toBe(true);
    expect(screen.getByText('O convite vale só para este e-mail.')).toBeTruthy();
    expect(screen.getByText('Convite válido até 24/10/2026.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');

    // Sem nome e com as senhas diferentes: nada vai ao servidor.
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'horizonte26' } });
    fireEvent.change(screen.getByLabelText(/^Repita a senha/), { target: { value: 'horizonte62' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(screen.getByText('Diga seu nome, como a equipe conhece você.')).toBeTruthy();
    expect(screen.getByText('As senhas não são iguais. Digite a mesma senha nos dois campos.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText(/^Seu nome/), { target: { value: ' Júlia Martins ' } });
    fireEvent.change(screen.getByLabelText(/^Repita a senha/), { target: { value: 'horizonte26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.find((p) => p.metodo === 'POST')).toMatchObject({ caminho: '/auth/convite/abc', corpo: { nome: 'Júlia Martins', senha: 'horizonte26' } });
  });

  it('e-mail que já tem conta: entra na tela de entrada e o convite é aceito na mesma entrada', async () => {
    const existente = { ...CONVITE, email: 'rafael.lima@seusistema.com.br', perfil: 'suporte' as const, empresa: 'Acme Logística', contaExistente: true };
    const { pedidos } = instalarFetch({
      'GET /auth/convite/xyz': existente,
      'GET /auth/eu': SEM_SESSAO,
      'GET /auth/primeiro-acesso': ACESSO,
      'POST /auth/entrar': {
        eu: { ...RAFAEL, perfil: 'suporte', empresa: ACME, empresas: [HORIZONTE, ACME] },
        empresas: [{ ...HORIZONTE, perfil: 'admin', iniciais: 'HO', ultimoAcesso: null }],
        avisos: [],
      },
    });
    renderizarRotas(telas, '/convite/xyz');
    expect(await screen.findByRole('heading', { name: 'Você recebeu um convite para o Copiloto da Acme Logística' })).toBeTruthy();
    expect(screen.getByText('Você já tem conta com este e-mail. Entre para aceitar o convite.')).toBeTruthy();
    expect(screen.getByText('Depois de entrar, a Acme Logística aparece na sua lista de empresas, como Suporte.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Seu nome/)).toBeNull();
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).readOnly).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Entrar e aceitar o convite' }));
    expect(await screen.findByRole('heading', { name: 'Entrar no Copiloto' })).toBeTruthy();
    expect(local()).toBe('/entrar?convite=xyz');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('rafael.lima@seusistema.com.br');
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'copiloto123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.filter((p) => p.metodo === 'POST')).toMatchObject([
      { caminho: '/auth/entrar', corpo: { email: 'rafael.lima@seusistema.com.br', senha: 'copiloto123', convite: 'xyz' } },
    ]);
  });

  it('entrando com outro e-mail, a tela de entrada mostra para qual e-mail é o convite', async () => {
    instalarFetch({
      'GET /auth/primeiro-acesso': ACESSO,
      'POST /auth/entrar': status(403, {
        erro: 'outro_email',
        mensagem: 'Este convite é para rafael.lima@seusistema.com.br. Entre com esse e-mail para aceitar.',
      }),
    });
    renderizarRotas(telas, '/entrar?convite=xyz');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'julia@horizonte.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'horizonte26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Este convite é para rafael.lima@seusistema.com.br. Entre com esse e-mail para aceitar.')).toBeTruthy();
    expect(local()).toBe('/entrar?convite=xyz');
  });

  it('já logado com o e-mail do convite: aceita sem pedir a senha de novo', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/convite/xyz': { ...CONVITE, email: 'Rafael.Lima@seusistema.com.br', contaExistente: true },
      'GET /auth/eu': RAFAEL,
      'POST /auth/convite/xyz/aceitar': RAFAEL,
    });
    renderizarRotas(telas, '/convite/xyz');
    fireEvent.click(await screen.findByRole('button', { name: 'Entrar e aceitar o convite' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.filter((p) => p.metodo === 'POST').map((p) => p.caminho)).toEqual(['/auth/convite/xyz/aceitar']);
  });

  it('a conta foi criada em outra aba: o 409 troca para "Entrar e aceitar o convite"', async () => {
    instalarFetch({
      'GET /auth/convite/abc': CONVITE,
      'GET /auth/eu': SEM_SESSAO,
      'POST /auth/convite/abc': status(409, { erro: 'conta_existente', mensagem: 'Você já tem conta com este e-mail. Entre para aceitar o convite.' }),
    });
    renderizarRotas(telas, '/convite/abc');
    fireEvent.change(await screen.findByLabelText(/^Seu nome/), { target: { value: 'Júlia Martins' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'horizonte26' } });
    fireEvent.change(screen.getByLabelText(/^Repita a senha/), { target: { value: 'horizonte26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar e entrar' }));
    expect(await screen.findByRole('button', { name: 'Entrar e aceitar o convite' })).toBeTruthy();
    expect(screen.queryByLabelText(/^Seu nome/)).toBeNull();
  });

  it('convite expirado diz quem pode reenviar', async () => {
    instalarFetch({
      'GET /auth/convite/velho': status(410, {
        erro: 'convite_expirado',
        mensagem: 'Este convite expirou. Peça ao Rafael Lima para reenviar em Equipe e limites.',
        email: 'ana.ribeiro@horizonte.com.br',
      }),
      'GET /auth/eu': SEM_SESSAO,
    });
    renderizarRotas(telas, '/convite/velho');
    expect(await screen.findByRole('heading', { name: 'Este convite expirou' })).toBeTruthy();
    expect(screen.getByText('Este convite expirou. Peça ao Rafael Lima para reenviar em Equipe e limites.')).toBeTruthy();
    expect(screen.getByText(/Cada convite vale por 7 dias\. O novo chega no mesmo e-mail,/).textContent).toBe(
      'Cada convite vale por 7 dias. O novo chega no mesmo e-mail, ana.ribeiro@horizonte.com.br.',
    );
    expect(screen.getByRole('link', { name: 'Ir para a tela de entrada' }).getAttribute('href')).toBe('/entrar');
  });

  it('convite que não existe ou já foi usado', async () => {
    instalarFetch({
      'GET /auth/convite/nada': status(404, { erro: 'convite_invalido', mensagem: 'Este convite não existe ou já foi usado.' }),
      'GET /auth/eu': SEM_SESSAO,
    });
    renderizarRotas(telas, '/convite/nada');
    expect(await screen.findByRole('heading', { name: 'Convite não encontrado' })).toBeTruthy();
    expect(
      screen.getByText('Este convite não existe ou já foi usado. Confira se o link está completo ou peça um convite novo a um Admin.'),
    ).toBeTruthy();
  });
});

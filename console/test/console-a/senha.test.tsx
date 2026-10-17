// Redefinir a senha (A3) e criar a senha nova pelo link do e-mail (A4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Entrada, Eu } from '@copiloto/shared';
import Entrar from '../../src/paginas/entrar/Entrar.tsx';
import EsqueciSenha from '../../src/paginas/entrar/EsqueciSenha.tsx';
import { horaEDia } from '../../src/paginas/entrar/pecas.tsx';
import SenhaNova from '../../src/paginas/entrar/SenhaNova.tsx';
import { HORIZONTE, instalarFetch, local, renderizarRotas, status } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const EU: Eu = {
  id: 'mem-1',
  nome: 'Rafael Lima',
  email: 'rafael.lima@horizonte.com.br',
  perfil: 'admin',
  iniciais: 'RL',
  emailConfirmado: true,
  empresa: HORIZONTE,
  empresas: [HORIZONTE],
  adminPlataforma: false,
};
const ENTRADA: Entrada = { eu: EU, empresas: [{ ...HORIZONTE, perfil: 'admin', iniciais: 'HO', ultimoAcesso: null }], avisos: [] };
const CAIXA_LOCAL =
  'O envio de e-mail ainda não está configurado neste servidor (SMTP_URL). A mensagem ficou na pasta caixa-de-saida dos dados do servidor.';

const telas = {
  '/entrar': <Entrar />,
  '/senha': <EsqueciSenha />,
  '/senha-nova/:token': <SenhaNova />,
};

/** Deixa rodar o que o React agendou fora do act (o efeito que liga a contagem depois da resposta). */
const respirar = () => act(() => new Promise((r) => setTimeout(r, 0)));

/** Passa `segundos` no relógio falso, um segundo de cada vez (cada tique agenda o próximo). */
function passar(segundos: number) {
  for (let i = 0; i < segundos; i++) act(() => vi.advanceTimersByTime(1000));
}

describe('A3 · Redefinir a senha', () => {
  it('e-mail incompleto não envia; enviado, mostra o aviso e só libera o reenvio depois de 60 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { pedidos } = instalarFetch({ 'POST /auth/senha/esqueci': { ok: true, reenviarEmS: 60, envio: 'smtp' } });
    renderizarRotas(telas, { pathname: '/senha', state: { email: 'rafael.lima@horizonte' } });
    expect(await screen.findByRole('heading', { name: 'Redefinir a senha' })).toBeTruthy();
    expect(screen.getByText('A senha nova vale para todas as empresas em que você entra com este e-mail.')).toBeTruthy();
    expect(screen.getByText('Lembrou a senha?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByText('Digite um e-mail completo, por exemplo nome@empresa.com.br')).toBeTruthy();
    expect(screen.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
    expect(pedidos).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'rafael.lima@horizonte.com.br' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByRole('heading', { name: 'Confira o seu e-mail' })).toBeTruthy();
    expect(pedidos[0]).toMatchObject({ metodo: 'POST', caminho: '/auth/senha/esqueci', corpo: { email: 'rafael.lima@horizonte.com.br' } });
    expect(screen.getByRole('status').textContent).toBe(
      'Se houver uma conta com rafael.lima@horizonte.com.br, enviamos um link para criar uma senha nova. O link vale por 1 hora.',
    );
    expect(screen.getByText('Não chegou em alguns minutos? Confira a caixa de spam ou se o e-mail foi digitado certo.')).toBeTruthy();
    expect(screen.queryByText(CAIXA_LOCAL)).toBeNull();
    expect(screen.queryByText(/Atalho do protótipo/)).toBeNull();

    const reenviar = screen.getByRole('button', { name: 'Reenviar em 60 s' }) as HTMLButtonElement;
    expect(reenviar.disabled).toBe(true);
    await respirar();
    passar(1);
    expect(screen.getByRole('button', { name: 'Reenviar em 59 s' })).toBeTruthy();
    passar(59);
    const liberado = screen.getByRole('button', { name: 'Reenviar link' }) as HTMLButtonElement;
    expect(liberado.disabled).toBe(false);
    fireEvent.click(liberado);
    expect(await screen.findByRole('button', { name: 'Reenviar em 60 s' })).toBeTruthy();
    expect(pedidos.filter((p) => p.caminho === '/auth/senha/esqueci')).toHaveLength(2);

    expect(screen.getByRole('link', { name: 'Voltar para entrar' }).getAttribute('href')).toBe('/entrar');
  });

  it('sem SMTP no servidor, diz que o e-mail ficou na caixa-de-saida', async () => {
    instalarFetch({ 'POST /auth/senha/esqueci': { ok: true, reenviarEmS: 60, envio: 'caixa_local' } });
    renderizarRotas(telas, '/senha');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'ana@acme.com.br' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    const nota = await screen.findByRole('note');
    expect(nota.textContent).toBe(CAIXA_LOCAL);
  });
});

describe('A4 · Crie uma senha nova', () => {
  it('confere a regra e as duas senhas, salva e entra', async () => {
    const expiraEm = new Date(Date.now() + 60 * 60_000).toISOString();
    const { pedidos } = instalarFetch({
      'GET /auth/senha/tok-1': { email: 'rafael.lima@horizonte.com.br', expiraEm },
      'POST /auth/senha/tok-1': ENTRADA,
    });
    renderizarRotas(telas, '/senha-nova/tok-1');
    expect(await screen.findByRole('heading', { name: 'Crie uma senha nova' })).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Para rafael.lima@horizonte.com.br.')).toBeTruthy();
    expect(screen.getByText(`Este link vale até ${horaEDia(expiraEm)} e funciona uma vez só.`)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    const sair = screen.getByLabelText('Sair de todos os outros aparelhos') as HTMLInputElement;
    expect(sair.checked).toBe(true);

    // Curta: a regra fica vermelha e nada vai ao servidor.
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'curta' } });
    fireEvent.change(screen.getByLabelText('Repetir senha'), { target: { value: 'curta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e entrar' }));
    expect(screen.getByText('Pelo menos 8 caracteres').closest('li')?.className).toBe('text-danger');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    // Diferentes: o erro do design embaixo do segundo campo.
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'horizonte-nova26' } });
    expect(screen.getByText('Pelo menos 8 caracteres').closest('li')?.className).toBe('text-success');
    fireEvent.change(screen.getByLabelText('Repetir senha'), { target: { value: 'horizonte-nova62' } });
    fireEvent.blur(screen.getByLabelText('Repetir senha'));
    expect(screen.getByText('As senhas não são iguais. Digite a mesma senha nos dois campos.')).toBeTruthy();
    expect(screen.getByLabelText('Repetir senha').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e entrar' }));
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText('Repetir senha'), { target: { value: 'horizonte-nova26' } });
    expect(screen.getByText('As duas senhas são iguais')).toBeTruthy();
    fireEvent.click(sair);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e entrar' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ senha: 'horizonte-nova26', sairDosOutros: false });
  });

  it('link expirado ou já usado oferece pedir outro', async () => {
    instalarFetch({ 'GET /auth/senha/velho': status(410, { erro: 'link_expirado', mensagem: 'Este link expirou ou já foi usado.' }) });
    renderizarRotas(telas, '/senha-nova/velho');
    expect(await screen.findByRole('heading', { name: 'Este link expirou ou já foi usado.' })).toBeTruthy();
    expect(screen.getByText('Por segurança, cada link vale por 1 hora e funciona uma vez só. Peça outro e use o mais recente que chegar.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pedir um link novo' }).getAttribute('href')).toBe('/senha');
    expect(screen.getByRole('link', { name: 'Voltar para entrar' }).getAttribute('href')).toBe('/entrar');
  });

  it('o link vence enquanto a pessoa digita: mostra a mesma tela de link expirado', async () => {
    instalarFetch({
      'GET /auth/senha/tok-2': { email: 'rafael.lima@horizonte.com.br', expiraEm: new Date(Date.now() + 60_000).toISOString() },
      'POST /auth/senha/tok-2': status(410, { erro: 'link_expirado', mensagem: 'Este link expirou ou já foi usado.' }),
    });
    renderizarRotas(telas, '/senha-nova/tok-2');
    fireEvent.change(await screen.findByLabelText('Nova senha'), { target: { value: 'horizonte-nova26' } });
    fireEvent.change(screen.getByLabelText('Repetir senha'), { target: { value: 'horizonte-nova26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e entrar' }));
    expect(await screen.findByRole('link', { name: 'Pedir um link novo' })).toBeTruthy();
  });

  it('horaEDia: hoje, amanhã ou a data', () => {
    const agora = new Date('2026-10-17T13:00:00.000Z');
    expect(horaEDia('2026-10-17T13:40:00.000Z', agora)).toBe('10:40 de hoje');
    expect(horaEDia('2026-10-18T03:30:00.000Z', agora)).toBe('00:30 de amanhã');
    expect(horaEDia('2026-10-20T13:40:00.000Z', agora)).toBe('10:40 de 20/10/2026');
  });
});

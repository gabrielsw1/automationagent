// Entrar, primeiro acesso e convite.
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App.tsx';
import Convite from '../../src/paginas/entrar/Convite.tsx';
import Entrar, { destinoDepoisDeEntrar } from '../../src/paginas/entrar/Entrar.tsx';
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

  it('volta para onde ia depois de entrar (ex.: "Gravar esta aba" da extensão)', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: false }, 'POST /auth/entrar': EU });
    const destino = '/aprender?gravar=http%3A%2F%2Flocalhost%3A4000%2Fchamados';
    renderizar(<Entrar />, { caminho: `/entrar?voltar=${encodeURIComponent(destino)}`, rota: '/entrar' });
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'rafael.lima@seusistema.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'copiloto123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(local()).toBe(destino));
    expect(destinoDepoisDeEntrar('https://outro.site/x')).toBe('/');
    expect(destinoDepoisDeEntrar('//outro.site/x')).toBe('/');
    expect(destinoDepoisDeEntrar('/entrar')).toBe('/');
  });

  it('sem sessão, leva à entrada uma vez só, guardando para onde ia', async () => {
    const { pedidos } = instalarFetch({
      'GET /resumo': status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' }),
      'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: false },
    });
    const destino = '/aprender?gravar=http%3A%2F%2Flocalhost%3A4000%2Fchamados';
    window.history.replaceState(null, '', destino);
    // Como no main.tsx: o StrictMode carrega o resumo duas vezes, e as duas respostas são 401.
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Entrar no console' });
    await waitFor(() => expect(pedidos.filter((p) => p.caminho === '/resumo').length).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/entrar?voltar=${encodeURIComponent(destino)}`);
    window.history.replaceState(null, '', '/');
  });

  it('sem modo demonstração não mostra a dica', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: false } });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    await screen.findByRole('heading', { name: 'Entrar no console' });
    expect(screen.queryByText(/copiloto123/)).toBeNull();
  });

  it('primeiro acesso leva ao cadastro da primeira empresa', async () => {
    const { pedidos } = instalarFetch({ 'GET /auth/primeiro-acesso': { precisaCriarAdmin: true, demo: false, cadastroAberto: false } });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    await waitFor(() => expect(local()).toBe('/criar-conta'));
    expect(pedidos.some((p) => p.caminho === '/auth/primeiro-admin')).toBe(false);
  });

  it('com o cadastro aberto, oferece criar a conta da empresa', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: true, cadastroAberto: true } });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    const link = await screen.findByRole('link', { name: 'Criar a conta da sua empresa' });
    expect(link.getAttribute('href')).toBe('/criar-conta');
    expect(screen.getByText(/copiloto123/)).toBeTruthy();
  });

  it('acesso fora de todas as equipes (403 sem_empresa)', async () => {
    instalarFetch({
      'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: false, cadastroAberto: true },
      'POST /auth/entrar': status(403, { erro: 'sem_empresa', mensagem: 'Seu acesso não está em nenhuma empresa.' }),
    });
    renderizar(<Entrar />, { caminho: '/entrar', rota: '/entrar' });
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'ana@acme.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Seu acesso não está em nenhuma equipe agora')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'crie a conta de uma empresa nova' }).getAttribute('href')).toBe('/criar-conta');
    expect(local()).toBe('/entrar');
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
      'GET /auth/convite/abc': { email: 'julia@horizonte.com.br', perfil: 'editor', empresa: 'Horizonte', contaExistente: false },
      'POST /auth/convite/abc': EU,
    });
    renderizar(<Convite />, { caminho: '/convite/abc', rota: '/convite/:token' });
    expect(await screen.findByRole('heading', { name: 'Crie o seu acesso' })).toBeTruthy();
    expect(screen.getByText('Convite para a equipe da Horizonte')).toBeTruthy();
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

  it('e-mail que já tem acesso: entra na equipe só com a senha atual', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/convite/xyz': { email: 'rafael.lima@seusistema.com.br', perfil: 'suporte', empresa: 'Acme Logística', contaExistente: true },
      'POST /auth/convite/xyz': ({ corpo }: { corpo: unknown }) =>
        (corpo as { senha: string }).senha === 'copiloto123'
          ? EU
          : status(401, { erro: 'credenciais', mensagem: 'Este e-mail já tem acesso ao copiloto. Use a senha que você já usa para entrar.' }),
    });
    renderizar(<Convite />, { caminho: '/convite/xyz', rota: '/convite/:token' });
    expect(await screen.findByRole('heading', { name: 'Entre na equipe' })).toBeTruthy();
    expect(screen.getByText('Convite para a equipe da Acme Logística')).toBeTruthy();
    const texto = 'Você já tem acesso ao copiloto com este e-mail. Digite sua senha para entrar também na equipe da Acme Logística.';
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === texto)).toBeTruthy();
    expect(screen.queryByLabelText(/Seu nome/)).toBeNull();
    expect(screen.queryByLabelText(/Repita a senha/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Sua senha/), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na equipe' }));
    expect(await screen.findByText(/Use a senha que você já usa para entrar/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Sua senha/), { target: { value: 'copiloto123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na equipe' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.filter((p) => p.metodo === 'POST').at(-1)?.corpo).toEqual({ senha: 'copiloto123' });
  });

  it('senha nova segue a regra do servidor (8 caracteres, letras e números)', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/convite/abc': { email: 'julia@horizonte.com.br', perfil: 'editor', empresa: 'Horizonte', contaExistente: false },
    });
    renderizar(<Convite />, { caminho: '/convite/abc', rota: '/convite/:token' });
    fireEvent.change(await screen.findByLabelText(/Seu nome/), { target: { value: 'Júlia Martins' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'sónumeros' } });
    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: 'sónumeros' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/ }));
    expect(await screen.findByText('Use letras e números na senha.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'horizonte1' } });
    expect(await screen.findByText('A senha precisa ser diferente do nome da empresa.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
  });

  it('convite expirado', async () => {
    instalarFetch({ 'GET /auth/convite/velho': status(410, { erro: 'expirado', mensagem: 'Este convite passou de 7 dias.' }) });
    renderizar(<Convite />, { caminho: '/convite/velho', rota: '/convite/:token' });
    expect(await screen.findByRole('heading', { name: 'Este convite expirou' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para a tela de entrada' })).toBeTruthy();
  });
});

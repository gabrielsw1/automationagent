// Entrar (A1), escolher a empresa (A2), primeiro acesso e a confirmação do e-mail como porta do console.
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fmt, type EmpresaDaConta, type Entrada, type Eu } from '@copiloto/shared';
import App from '../../src/App.tsx';
import Entrar from '../../src/paginas/entrar/Entrar.tsx';
import EscolherEmpresa from '../../src/paginas/entrar/EscolherEmpresa.tsx';
import EsqueciSenha from '../../src/paginas/entrar/EsqueciSenha.tsx';
import { destinoDepoisDeEntrar } from '../../src/paginas/entrar/pecas.tsx';
import { HORIZONTE, instalarFetch, local, renderizarRotas, status } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACME = { id: 'emp-acme', nome: 'Acme Logística', demo: false };
const EU: Eu = {
  id: 'mem-1',
  nome: 'Rafael Lima',
  email: 'rafael.lima@seusistema.com.br',
  perfil: 'admin',
  iniciais: 'RL',
  emailConfirmado: true,
  empresa: HORIZONTE,
  empresas: [HORIZONTE, ACME],
  adminPlataforma: false,
};
const AGORA = new Date().toISOString();
const EMPRESAS: EmpresaDaConta[] = [
  { ...HORIZONTE, perfil: 'admin', iniciais: 'HO', ultimoAcesso: AGORA },
  { ...ACME, perfil: 'editor', iniciais: 'AL', ultimoAcesso: '2026-10-14T15:00:00.000Z' },
];
const entrada = (p: Partial<Entrada> = {}): Entrada => ({ eu: EU, empresas: [EMPRESAS[0]], avisos: [], ...p });
const ACESSO = { precisaCriarAdmin: false, demo: false, cadastroAberto: true, envioEmail: 'smtp' };
const REMOVIDO = 'Seu acesso à Vetor CRM foi removido por um Admin dessa empresa.';

const telas = { '/entrar': <Entrar />, '/entrar/empresa': <EscolherEmpresa />, '/senha': <EsqueciSenha /> };

async function entrarCom(email: string, senha: string) {
  fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('A1 · Entrar', () => {
  it('valida, mostra o erro do servidor e, com uma empresa só, vai direto para o painel', async () => {
    let tentativas = 0;
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': { ...ACESSO, demo: true },
      'POST /auth/entrar': () =>
        ++tentativas === 1 ? status(401, { erro: 'credenciais', mensagem: 'E-mail ou senha incorretos. Confira e tente de novo.' }) : entrada(),
    });
    renderizarRotas(telas, '/entrar');
    expect(await screen.findByRole('heading', { name: 'Entrar no Copiloto' })).toBeTruthy();
    expect(screen.getByText('Acompanhe o que o copiloto faz e configure as tarefas dele.')).toBeTruthy();
    expect(screen.getByText(/copiloto123/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Conhecer o Copiloto' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Esqueci a senha' }).getAttribute('href')).toBe('/senha');
    expect(screen.getByRole('link', { name: 'Entrar na plataforma' }).getAttribute('href')).toBe('/plataforma/entrar');
    expect(screen.getByRole('link', { name: 'Criar conta da empresa' }).getAttribute('href')).toBe('/criar-conta');
    // Sem ?voltar=, nada de "Depois de entrar".
    expect(screen.queryByText(/Depois de entrar/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Digite o e-mail e a senha.')).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/auth/entrar')).toBe(false);

    await entrarCom('rafael.lima@seusistema.com.br', 'errada');
    expect(await screen.findByText('E-mail ou senha incorretos. Confira e tente de novo.')).toBeTruthy();
    // O e-mail continua; a senha volta vazia, com o foco nela.
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('rafael.lima@seusistema.com.br');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(screen.getByLabelText('Senha'));

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('text');
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'copiloto123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.filter((p) => p.caminho === '/auth/entrar').at(-1)?.corpo).toEqual({ email: 'rafael.lima@seusistema.com.br', senha: 'copiloto123' });
  });

  it('mostra no cartão para onde volta e volta para lá depois de entrar', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': ACESSO, 'POST /auth/entrar': entrada() });
    renderizarRotas(telas, `/entrar?voltar=${encodeURIComponent('/execucoes/EX-20431')}`);
    await screen.findByRole('heading', { name: 'Entrar no Copiloto' });
    expect(document.querySelector('.context-pill')?.textContent).toBe('Depois de entrar: Execuções › EX-20431');
    await entrarCom('rafael.lima@seusistema.com.br', 'copiloto123');
    await waitFor(() => expect(local()).toBe('/execucoes/EX-20431'));
    expect(destinoDepoisDeEntrar('https://outro.site/x')).toBe('/');
    expect(destinoDepoisDeEntrar('//outro.site/x')).toBe('/');
    expect(destinoDepoisDeEntrar('/entrar/empresa')).toBe('/');
    expect(destinoDepoisDeEntrar('/aprender?gravar=x')).toBe('/aprender?gravar=x');
  });

  it('sem sessão, leva à entrada uma vez só, guardando para onde ia', async () => {
    const { pedidos } = instalarFetch({
      'GET /resumo': status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' }),
      'GET /auth/primeiro-acesso': ACESSO,
    });
    const destino = '/aprender?gravar=http%3A%2F%2Flocalhost%3A4000%2Fchamados';
    window.history.replaceState(null, '', destino);
    // Como no main.tsx: o StrictMode carrega o resumo duas vezes, e as duas respostas são 401.
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Entrar no Copiloto' });
    await waitFor(() => expect(pedidos.filter((p) => p.caminho === '/resumo').length).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/entrar?voltar=${encodeURIComponent(destino)}`);
    expect(document.querySelector('.context-pill')?.textContent).toBe('Depois de entrar: Aprender fluxo');
    window.history.replaceState(null, '', '/');
  });

  it('bloqueio depois de 5 senhas erradas: diz até quando e oferece redefinir a senha', async () => {
    const ate = new Date(Date.now() + 15 * 60_000).toISOString();
    instalarFetch({
      'GET /auth/primeiro-acesso': ACESSO,
      'POST /auth/entrar': status(423, { erro: 'bloqueado', mensagem: 'Por segurança, o acesso ficou bloqueado por 15 minutos.', ate }),
    });
    renderizarRotas(telas, '/entrar');
    await entrarCom('rafael.lima@horizonte.com.br', 'errada5');
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Por segurança, o acesso ficou bloqueado por 15 minutos.Você pode redefinir a senha agora.');
    expect(screen.getByText(`Entrar com senha volta a funcionar às ${fmt.hora(ate)}.`)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('Senha')).toBeNull();

    // Outro e-mail não está bloqueado.
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@horizonte.com.br' } });
    expect(screen.getByLabelText('Senha')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'rafael.lima@horizonte.com.br' } });

    fireEvent.click(screen.getByRole('link', { name: 'Redefinir a senha' }));
    await waitFor(() => expect(local()).toBe('/senha'));
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('rafael.lima@horizonte.com.br');
  });

  it('e-mail ainda sem confirmar vai ao código do cadastro', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': ACESSO, 'POST /auth/entrar': entrada({ eu: { ...EU, emailConfirmado: false } }) });
    renderizarRotas(telas, '/entrar');
    await entrarCom('ana@acme.com.br', 'segura2026');
    await waitFor(() => expect(local()).toBe('/criar-conta'));
  });

  it('primeiro acesso leva ao cadastro da primeira empresa', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': { ...ACESSO, precisaCriarAdmin: true, cadastroAberto: false } });
    renderizarRotas(telas, '/entrar');
    await waitFor(() => expect(local()).toBe('/criar-conta'));
  });

  it('com o cadastro fechado, não oferece criar a conta da empresa', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': { ...ACESSO, cadastroAberto: false } });
    renderizarRotas(telas, '/entrar');
    await screen.findByRole('heading', { name: 'Entrar no Copiloto' });
    expect(screen.queryByRole('link', { name: 'Criar conta da empresa' })).toBeNull();
    expect(screen.queryByText(/copiloto123/)).toBeNull();
  });

  it('servidor fora do ar mostra erro com "Tentar de novo"', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': status(500, { erro: 'interno', mensagem: 'Erro interno.', ref: '7F3A-21' }) });
    renderizarRotas(telas, '/entrar');
    expect(await screen.findByText('Não consegui falar com o servidor do copiloto')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tentar de novo/ })).toBeTruthy();
  });
});

describe('A2 · Em qual empresa você quer entrar?', () => {
  it('com duas empresas, pergunta depois de entrar e abre a escolhida', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ACESSO,
      'POST /auth/entrar': entrada({ empresas: EMPRESAS }),
      'POST /auth/empresa': { ...EU, empresa: ACME },
    });
    renderizarRotas(telas, `/entrar?voltar=${encodeURIComponent('/tarefas')}`);
    await entrarCom('rafael.lima@seusistema.com.br', 'copiloto123');
    expect(await screen.findByRole('heading', { name: 'Olá, Rafael. Em qual empresa você quer entrar?' })).toBeTruthy();
    expect(local()).toBe(`/entrar/empresa?voltar=${encodeURIComponent('/tarefas')}`);
    expect(screen.getByText('Você faz parte de 2 empresas. Depois dá para trocar pelo seletor no topo do menu.')).toBeTruthy();
    expect(screen.getByText('rafael.lima@seusistema.com.br')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();

    const [horizonte, acme] = within(screen.getByRole('list', { name: /Em qual empresa/ })).getAllByRole('button');
    expect(horizonte.className).toContain('ce-empresa-recente');
    expect(horizonte.textContent).toBe(`HOHorizonteAdminDemonstraçãoÚltimo acesso: hoje, ${fmt.hora(AGORA)}`);
    expect(acme.textContent).toBe('ALAcme LogísticaEditor de tarefasÚltimo acesso: 14/10/2026');

    fireEvent.click(acme);
    await waitFor(() => expect(local()).toBe('/tarefas'));
    expect(pedidos.find((p) => p.caminho === '/auth/empresa')?.corpo).toEqual({ empresaId: 'emp-acme' });
  });

  it('aviso de acesso removido aparece mesmo com uma empresa só; a aberta não troca de novo', async () => {
    const { pedidos } = instalarFetch({ 'GET /auth/primeiro-acesso': ACESSO, 'POST /auth/entrar': entrada({ avisos: [REMOVIDO] }) });
    renderizarRotas(telas, '/entrar');
    await entrarCom('rafael.lima@seusistema.com.br', 'copiloto123');
    expect(await screen.findByRole('heading', { name: 'Olá, Rafael. Em qual empresa você quer entrar?' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(REMOVIDO);
    expect(screen.queryByText(/Você faz parte de/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Horizonte/ }));
    await waitFor(() => expect(local()).toBe('/'));
    expect(pedidos.some((p) => p.caminho === '/auth/empresa')).toBe(false);
  });

  it('conta sem nenhuma empresa: explica como voltar a entrar', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': ACESSO, 'POST /auth/entrar': { eu: null, empresas: [], avisos: [REMOVIDO] } });
    renderizarRotas(telas, '/entrar');
    await entrarCom('rafael.lima@vetor.com.br', 'copiloto123');
    expect(await screen.findByRole('heading', { name: 'Sua conta não está em nenhuma empresa agora' })).toBeTruthy();
    expect(screen.getByText(REMOVIDO)).toBeTruthy();
    expect(
      screen.getByText(
        'Para entrar, peça a um Admin da sua empresa um convite em Equipe e limites. Se a sua empresa ainda não usa o Copiloto, você pode criar a conta dela.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Criar conta da empresa' }).getAttribute('href')).toBe('/criar-conta');
    expect(screen.getByRole('link', { name: 'Entrar com outra conta' }).getAttribute('href')).toBe('/entrar');
    // Nenhuma sessão foi aberta: o topo mostra o e-mail digitado, sem "Sair".
    expect(screen.getByText('rafael.lima@vetor.com.br')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
  });

  it('"Trocar de empresa" no menu: busca as empresas da sessão e "Entrar com outra conta" sai', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/empresas': { empresas: EMPRESAS, avisos: [] },
      'GET /auth/eu': EU,
      'POST /auth/sair': { ok: true },
      'GET /auth/primeiro-acesso': ACESSO,
    });
    renderizarRotas(telas, '/entrar/empresa');
    expect(await screen.findByRole('heading', { name: 'Olá, Rafael. Em qual empresa você quer entrar?' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com outra conta' }));
    await waitFor(() => expect(local()).toBe('/entrar'));
    expect(pedidos.some((p) => p.metodo === 'POST' && p.caminho === '/auth/sair')).toBe(true);
  });

  it('sem sessão, a escolha leva à entrada', async () => {
    const semSessao = status(401, { erro: 'nao_autenticado', mensagem: 'Sua sessão expirou. Entre de novo.' });
    instalarFetch({ 'GET /auth/empresas': semSessao, 'GET /auth/eu': semSessao, 'GET /auth/primeiro-acesso': ACESSO });
    renderizarRotas(telas, '/entrar/empresa');
    await waitFor(() => expect(local()).toBe('/entrar'));
  });
});

describe('Porta do console', () => {
  it('sem sessão, o endereço principal mostra o site do produto (S1), não a entrada', async () => {
    const { pedidos } = instalarFetch({ 'GET /resumo': status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' }) });
    window.history.replaceState(null, '', '/');
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: /Um copiloto que faz o trabalho dentro do seu sistema/ })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.pathname).toBe('/');
    expect(pedidos.some((p) => p.caminho === '/api/publico/planos')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Entrar' })[0].getAttribute('href')).toBe('/entrar');
  });

  it('sessão com o e-mail sem confirmar abre a confirmação (A5) no lugar do console', async () => {
    instalarFetch({
      'GET /resumo': status(403, { erro: 'email_nao_confirmado', mensagem: 'Confirme o seu e-mail para continuar.' }),
      'GET /auth/primeiro-acesso': ACESSO,
      'GET /auth/eu': { ...EU, emailConfirmado: false },
      'GET /auth/email': { email: EU.email, reenviarEmS: 0, expiraEm: null, envio: 'smtp' },
    });
    window.history.replaceState(null, '', '/painel');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Confirme o seu e-mail' })).toBeTruthy();
    expect(window.location.pathname).toBe('/criar-conta');
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    window.history.replaceState(null, '', '/');
  });
});

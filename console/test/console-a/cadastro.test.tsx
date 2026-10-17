// Cadastro de uma empresa nova em três etapas: Sua conta, Seu sistema e Sua marca.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ConfigWidget, Eu, SistemaEmpresa } from '@copiloto/shared';
import Cadastro from '../../src/paginas/cadastro/Cadastro.tsx';
import { regrasSenha } from '../../src/paginas/cadastro/regras.ts';
import { instalarFetch, local, renderizar, status } from './ambiente.tsx';

vi.mock('@copiloto/widget/chat', () => ({
  PreviaWidget: ({ config }: { config: { nome: string } }) => <div data-testid="previa">prévia {config.nome}</div>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACME = { id: 'emp-acme', nome: 'Acme Logística', demo: false };
const EU: Eu = {
  id: 'mem-7',
  nome: 'Ana Ribeiro',
  email: 'ana@acme.com.br',
  perfil: 'admin',
  iniciais: 'AR',
  emailConfirmado: true,
  empresa: ACME,
  empresas: [ACME],
  adminPlataforma: false,
};
const ABERTO = { precisaCriarAdmin: false, demo: false, cadastroAberto: true };
const SEM_SESSAO = status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' });

const SISTEMA: SistemaEmpresa = {
  nome: '',
  url: '',
  conector: 'tela',
  acesso: { modo: 'nenhum', urlSessao: '', urlLogin: '', usuario: '', temSenha: false },
  perfis: [],
  editavel: true,
};

const WIDGET: ConfigWidget = {
  nome: 'Copiloto',
  boasVindas: 'Olá! Como posso ajudar?',
  sugestoes: [],
  cor: '#1F6FEB',
  posicao: 'direita',
  atalho: true,
  proativa: { ativa: false, segundosParado: 30 },
  atendimentoHumano: { horario: '' },
  dominios: [],
};

const pagina = <Cadastro />;
const rota = '/criar-conta/:etapa?';

function preencherConta() {
  fireEvent.change(screen.getByLabelText(/Seu nome/), { target: { value: 'Ana Ribeiro' } });
  fireEvent.change(screen.getByLabelText(/E-mail de trabalho/), { target: { value: 'ana@acme.com.br' } });
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'segura2026' } });
  fireEvent.change(screen.getByLabelText(/Nome da empresa/), { target: { value: 'Acme Logística' } });
  fireEvent.change(screen.getByLabelText(/^CNPJ/), { target: { value: '11.222.333/0001-81' } });
  fireEvent.change(screen.getByLabelText(/Quantas pessoas usam o seu sistema/), { target: { value: 'ate_1000' } });
  fireEvent.click(screen.getByLabelText(/Termos de uso/));
  fireEvent.click(screen.getByLabelText(/Contrato de tratamento de dados/));
}

describe('Regras da senha', () => {
  it('pelo menos 8 caracteres, letras e números e sem o nome da empresa', () => {
    expect(regrasSenha('abc1234', 'Acme').map((r) => r.ok)).toEqual([false, true, true]);
    expect(regrasSenha('abcdefgh', 'Acme').map((r) => r.ok)).toEqual([true, false, true]);
    expect(regrasSenha('acme2026!', 'Acme').map((r) => r.ok)).toEqual([true, true, false]);
    expect(regrasSenha('segura2026', 'Acme').map((r) => r.rotulo)).toEqual([
      'Pelo menos 8 caracteres',
      'Letras e números',
      'Diferente do nome da empresa',
    ]);
  });
});

describe('Cadastro · etapa 1 (Sua conta)', () => {
  it('cria o espaço com os aceites e segue para "Seu sistema"', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': SEM_SESSAO,
      'POST /auth/cadastro': EU,
      'GET /sistema/config': SISTEMA,
    });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    expect(await screen.findByRole('heading', { name: 'Crie o espaço da sua empresa' })).toBeTruthy();
    const etapas = screen.getByRole('list', { name: 'Etapas do cadastro' });
    expect(within(etapas).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['1Sua conta', '2Seu sistema', '3Sua marca']);
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    expect(screen.getByText('Nada é cobrado agora.')).toBeTruthy();

    // E-mail pessoal e aceites faltando: não envia.
    preencherConta();
    fireEvent.change(screen.getByLabelText(/E-mail de trabalho/), { target: { value: 'ana@gmail.com' } });
    fireEvent.click(screen.getByLabelText(/Termos de uso/));
    fireEvent.click(screen.getByRole('button', { name: 'Criar espaço' }));
    expect(await screen.findByText('Use o e-mail da empresa, por exemplo nome@suaempresa.com.br')).toBeTruthy();
    expect(screen.getByText('Para criar o espaço, aceite os Termos de uso e o Contrato de tratamento de dados.')).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/auth/cadastro')).toBe(false);

    fireEvent.change(screen.getByLabelText(/E-mail de trabalho/), { target: { value: 'ana@acme.com.br' } });
    fireEvent.click(screen.getByLabelText(/Termos de uso/));
    fireEvent.click(screen.getByRole('button', { name: 'Criar espaço' }));
    await waitFor(() => expect(local()).toBe('/criar-conta/sistema'));
    expect(pedidos.find((p) => p.caminho === '/auth/cadastro')?.corpo).toEqual({
      empresa: { nome: 'Acme Logística', cnpj: '11222333000181', faixaUsuarios: 'ate_1000' },
      pessoa: { nome: 'Ana Ribeiro', email: 'ana@acme.com.br', senha: 'segura2026' },
      aceites: { termos: true, dados: true },
    });
    expect(await screen.findByRole('heading', { name: 'Seu sistema' })).toBeTruthy();
  });

  it('e-mail que já tem acesso: explica e oferece entrar', async () => {
    instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': SEM_SESSAO,
      'POST /auth/cadastro': status(409, { erro: 'conta_existente', mensagem: 'Este e-mail já tem acesso. Digite a senha que você já usa.' }),
    });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    await screen.findByRole('heading', { name: 'Crie o espaço da sua empresa' });
    preencherConta();
    fireEvent.click(screen.getByRole('button', { name: 'Criar espaço' }));
    expect(await screen.findByText('Este e-mail já tem acesso ao copiloto')).toBeTruthy();
    expect(local()).toBe('/criar-conta');
  });

  it('logado ("Criar outra empresa"): não pede o acesso de novo', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': { precisaCriarAdmin: false, demo: true, cadastroAberto: false },
      'GET /auth/eu': EU,
      'POST /auth/cadastro': { ...EU, empresa: { id: 'emp-nova', nome: 'Beta', demo: false } },
      'GET /sistema/config': SISTEMA,
    });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    expect(await screen.findByRole('heading', { name: 'Criar outra empresa' })).toBeTruthy();
    expect(screen.queryByLabelText(/Seu nome/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Nome da empresa/), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText(/Quantas pessoas usam o seu sistema/), { target: { value: 'ate_200' } });
    fireEvent.click(screen.getByLabelText(/Termos de uso/));
    fireEvent.click(screen.getByLabelText(/Contrato de tratamento de dados/));
    fireEvent.click(screen.getByRole('button', { name: 'Criar espaço' }));
    await waitFor(() => expect(local()).toBe('/criar-conta/sistema'));
    expect(pedidos.find((p) => p.caminho === '/auth/cadastro')?.corpo).toEqual({
      empresa: { nome: 'Beta', faixaUsuarios: 'ate_200' },
      aceites: { termos: true, dados: true },
    });
  });
});

describe('Cadastro · etapas 2 e 3', () => {
  it('Seu sistema: verifica o endereço e salva o acesso pela sessão de quem pede', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': EU,
      'GET /sistema/config': SISTEMA,
      'POST /sistema/verificar': { ok: true, detalhe: 'Telas no ar · https://erp.acme.com.br' },
      'PUT /sistema/config': ({ corpo }: { corpo: unknown }) => ({ ...SISTEMA, ...(corpo as object) }),
      'GET /canais': { publicada: WIDGET, rascunho: WIDGET, temAlteracoes: false, chavePublica: 'pk', urlScript: 'x', instalacao: null, conector: 'tela' },
    });
    renderizar(pagina, { caminho: '/criar-conta/sistema', rota });
    expect(await screen.findByRole('heading', { name: 'Seu sistema' })).toBeTruthy();
    expect(screen.getByText(/Etapa 2 de 3/)).toBeTruthy();
    const endereco = screen.getByLabelText(/Endereço do sistema/);
    fireEvent.change(endereco, { target: { value: 'erp.acme.com.br' } });
    fireEvent.blur(endereco);
    expect((endereco as HTMLInputElement).value).toBe('https://erp.acme.com.br');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar endereço' }));
    expect(await screen.findByText('Encontramos erp.acme.com.br')).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/sistema/verificar')?.corpo).toEqual({ url: 'https://erp.acme.com.br' });

    // "Com a sessão de quem pede" vem marcado (recomendado).
    expect((screen.getByLabelText(/Com a sessão de quem pede/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(/Endereço de sessão/), { target: { value: 'https://erp.acme.com.br/copiloto/sessao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para Sua marca' }));
    await waitFor(() => expect(local()).toBe('/criar-conta/marca'));
    expect(pedidos.find((p) => p.metodo === 'PUT' && p.caminho === '/sistema/config')?.corpo).toEqual({
      nome: 'Acme Logística',
      url: 'https://erp.acme.com.br',
      acesso: { modo: 'sessao', urlSessao: 'https://erp.acme.com.br/copiloto/sessao', urlLogin: '', usuario: '' },
      perfis: [],
    });
  });

  it('Seu sistema: conta de serviço pede página de login, usuário e senha', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': EU,
      'GET /sistema/config': { ...SISTEMA, url: 'https://erp.acme.com.br' },
      'PUT /sistema/config': SISTEMA,
    });
    renderizar(pagina, { caminho: '/criar-conta/sistema', rota });
    fireEvent.click(await screen.findByLabelText(/Com uma conta de serviço/));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para Sua marca' }));
    expect(await screen.findByText('Diga em que página o copiloto entra no sistema.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'PUT')).toBe(false);
    fireEvent.change(screen.getByLabelText(/Página de login/), { target: { value: '/login' } });
    fireEvent.change(screen.getByLabelText(/^Usuário/), { target: { value: 'copiloto@acme.com.br' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 's3gredo!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para Sua marca' }));
    await waitFor(() => expect(local()).toBe('/criar-conta/marca'));
    expect((pedidos.find((p) => p.metodo === 'PUT')?.corpo as { acesso: unknown }).acesso).toEqual({
      modo: 'conta',
      urlSessao: '',
      urlLogin: '/login',
      usuario: 'copiloto@acme.com.br',
      senha: 's3gredo!',
    });
  });

  it('Sua marca: salva, publica e entra no console', async () => {
    const canais = { publicada: WIDGET, rascunho: WIDGET, temAlteracoes: false, chavePublica: 'pk', urlScript: 'x', instalacao: null, conector: 'tela' };
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': EU,
      'GET /canais': canais,
      'PUT /canais/rascunho': canais,
      'POST /canais/publicar': canais,
    });
    renderizar(pagina, { caminho: '/criar-conta/marca', rota });
    expect(await screen.findByRole('heading', { name: 'Sua marca' })).toBeTruthy();
    expect(screen.getByText('Você pode mudar tudo isso depois em Canais e widget.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Nome do assistente/), { target: { value: 'Assistente Acme' } });
    fireEvent.change(screen.getByLabelText('Outra cor, em código hexadecimal'), { target: { value: '0b5cad' } });
    expect(screen.getByText(/Texto branco fica legível sobre esta cor/)).toBeTruthy();
    expect(screen.getByTestId('previa').textContent).toBe('prévia Assistente Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar no console' }));
    await waitFor(() => expect(local()).toBe('/guia'));
    const rascunho = pedidos.find((p) => p.caminho === '/canais/rascunho')?.corpo as { config: ConfigWidget };
    expect(rascunho.config).toMatchObject({ nome: 'Assistente Acme', cor: '#0B5CAD', boasVindas: 'Olá! Como posso ajudar?' });
    expect(pedidos.some((p) => p.caminho === '/canais/publicar')).toBe(true);
  });

  it('sem sessão, as etapas 2 e 3 levam à entrada', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': ABERTO, 'GET /auth/eu': SEM_SESSAO });
    renderizar(pagina, { caminho: '/criar-conta/marca', rota });
    await waitFor(() => expect(local()).toBe(`/entrar?voltar=${encodeURIComponent('/criar-conta/marca')}`));
  });
});

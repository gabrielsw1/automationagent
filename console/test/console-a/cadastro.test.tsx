// Cadastro de uma empresa nova em três etapas: Sua conta, Seu sistema e Sua marca.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ConfigWidget, ConfirmacaoEmail, Eu, SistemaEmpresa } from '@copiloto/shared';
import Cadastro from '../../src/paginas/cadastro/Cadastro.tsx';
import { regrasSenha } from '../../src/paginas/cadastro/regras.ts';
import { instalarFetch, local, renderizar, status } from './ambiente.tsx';

vi.mock('@copiloto/widget/chat', () => ({
  PreviaWidget: ({ config }: { config: { nome: string; logo?: { url: string } | null } }) => (
    <div data-testid="previa">
      prévia {config.nome}
      {config.logo ? ` · logo ${config.logo.url}` : ''}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
const NOVA: Eu = { ...EU, emailConfirmado: false };
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

const CODIGO: ConfirmacaoEmail = { email: 'ana@acme.com.br', reenviarEmS: 45, expiraEm: '2026-10-17T13:10:00.000Z', envio: 'smtp' };
const CAIXA_LOCAL =
  'O envio de e-mail ainda não está configurado neste servidor (SMTP_URL). A mensagem ficou na pasta caixa-de-saida dos dados do servidor.';

/** Cola o código no primeiro quadrado, como o preenchimento do celular. */
function colarCodigo(codigo: string) {
  fireEvent.paste(screen.getByLabelText('Dígito 1 de 6'), { clipboardData: { getData: () => codigo } });
}
const digitos = () => [1, 2, 3, 4, 5, 6].map((n) => (screen.getByLabelText(`Dígito ${n} de 6`) as HTMLInputElement).value).join('');

/** Deixa rodar o que o React agendou fora do act (o efeito que liga a contagem depois da resposta). */
const respirar = () => act(() => new Promise((r) => setTimeout(r, 0)));
function passar(segundos: number) {
  for (let i = 0; i < segundos; i++) act(() => vi.advanceTimersByTime(1000));
}

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
  it('cria o espaço com os aceites, confirma o e-mail pelo código e segue para "Seu sistema"', async () => {
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': SEM_SESSAO,
      'POST /auth/cadastro': NOVA,
      'GET /auth/email': CODIGO,
      'POST /auth/email/confirmar': EU,
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
    expect(pedidos.find((p) => p.caminho === '/auth/cadastro')?.corpo).toEqual({
      empresa: { nome: 'Acme Logística', cnpj: '11222333000181', faixaUsuarios: 'ate_1000' },
      pessoa: { nome: 'Ana Ribeiro', email: 'ana@acme.com.br', senha: 'segura2026' },
      aceites: { termos: true, dados: true },
    });

    // A5: o código chega no e-mail; ainda é a etapa 1.
    expect(await screen.findByRole('heading', { name: 'Confirme o seu e-mail' })).toBeTruthy();
    expect(local()).toBe('/criar-conta');
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Enviamos um código de 6 dígitos para ana@acme.com.br.')).toBeTruthy();
    expect(screen.getByText('Pode colar o código inteiro no primeiro quadrado. Ele vale por 10 minutos.')).toBeTruthy();
    expect(screen.getByText('Não chegou? Confira a caixa de spam ou de promoções. O assunto é “Seu código do Copiloto Starta”.')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    colarCodigo('482 710');
    expect(digitos()).toBe('482710');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(local()).toBe('/criar-conta/sistema'));
    expect(pedidos.find((p) => p.caminho === '/auth/email/confirmar')?.corpo).toEqual({ codigo: '482710' });
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

describe('A5 · Confirme o seu e-mail', () => {
  const sessaoNova = (rotas: Record<string, unknown> = {}) =>
    instalarFetch({ 'GET /auth/primeiro-acesso': ABERTO, 'GET /auth/eu': NOVA, 'GET /auth/email': CODIGO, ...rotas });

  it('quem volta sem confirmar vê o código no lugar da etapa; código curto e código incorreto', async () => {
    const { pedidos } = sessaoNova({
      'POST /auth/email/confirmar': status(400, { erro: 'codigo_incorreto', mensagem: 'Código incorreto. Restam 4 tentativas.', restantes: 4 }),
    });
    renderizar(pagina, { caminho: '/criar-conta/sistema', rota });
    expect(await screen.findByRole('heading', { name: 'Confirme o seu e-mail' })).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/sistema/config')).toBe(false);

    // Um dígito por quadrado, o foco anda sozinho.
    fireEvent.change(screen.getByLabelText('Dígito 1 de 6'), { target: { value: '4' } });
    expect(document.activeElement).toBe(screen.getByLabelText('Dígito 2 de 6'));
    fireEvent.change(screen.getByLabelText('Dígito 2 de 6'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('alert').textContent).toBe('Digite os 6 dígitos do código.');
    expect(pedidos.some((p) => p.caminho === '/auth/email/confirmar')).toBe(false);

    fireEvent.change(screen.getByLabelText('Dígito 3 de 6'), { target: { value: '2711' } });
    expect(digitos()).toBe('482711');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Código incorreto. Restam 4 tentativas.')).toBeTruthy();
    expect(screen.getByLabelText('Dígito 1 de 6').getAttribute('aria-invalid')).toBe('true');
    expect(local()).toBe('/criar-conta/sistema');
  });

  it('código expirado: "Enviar outro código" pede um novo e volta aos quadrados', async () => {
    const { pedidos } = sessaoNova({
      'POST /auth/email/confirmar': status(410, {
        erro: 'codigo_expirado',
        mensagem: 'Este código expirou. Cada código vale por 10 minutos. Peça outro e use o mais recente.',
      }),
      'POST /auth/email/reenviar': CODIGO,
    });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    await screen.findByRole('heading', { name: 'Confirme o seu e-mail' });
    colarCodigo('482710');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Este código expirou. Cada código vale por 10 minutos. Peça outro e use o mais recente.')).toBeTruthy();
    expect(screen.queryByLabelText('Dígito 1 de 6')).toBeNull();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Vamos enviar para ana@acme.com.br. Trocar e-mail')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar outro código' }));
    expect(await screen.findByLabelText('Dígito 1 de 6')).toBeTruthy();
    expect(digitos()).toBe('');
    expect(screen.getByRole('status').textContent).toBe('Enviamos um código novo para ana@acme.com.br.');
    expect(pedidos.filter((p) => p.caminho === '/auth/email/reenviar')).toHaveLength(1);
  });

  it('"Reenviar código" só libera depois da espera do servidor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reenvios = 0;
    const { pedidos } = sessaoNova({
      'POST /auth/email/reenviar': () =>
        ++reenvios === 1 ? CODIGO : status(429, { erro: 'aguarde', mensagem: 'Aguarde 30 s para pedir outro código.', aguardarS: 30 }),
    });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    const botao = (await screen.findByRole('button', { name: 'Reenviar código em 45 s' })) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await respirar();
    passar(1);
    expect(screen.getByRole('button', { name: 'Reenviar código em 44 s' })).toBeTruthy();
    passar(44);
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(await screen.findByRole('button', { name: 'Reenviar código em 45 s' })).toBeTruthy();
    expect(pedidos.filter((p) => p.caminho === '/auth/email/reenviar')).toHaveLength(1);

    // Outra aba pediu antes: o servidor diz quanto falta e a contagem segue o servidor.
    await respirar();
    passar(45);
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(await screen.findByText('Aguarde 30 s para pedir outro código.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reenviar código em 30 s' })).toBeTruthy();
  });

  it('"Trocar e-mail" pede um e-mail de trabalho e manda o código para ele', async () => {
    const { pedidos } = sessaoNova({
      'POST /auth/email/trocar': ({ corpo }: { corpo: unknown }) => ({ ...CODIGO, email: (corpo as { email: string }).email }),
    });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    await screen.findByRole('heading', { name: 'Confirme o seu e-mail' });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }));
    expect(screen.getByRole('heading', { name: 'Trocar e-mail' })).toBeTruthy();
    const campo = screen.getByLabelText(/E-mail de trabalho/) as HTMLInputElement;
    expect(campo.value).toBe('ana@acme.com.br');

    fireEvent.change(campo, { target: { value: 'ana@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(screen.getByText('Use o e-mail da empresa, por exemplo nome@suaempresa.com.br')).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/auth/email/trocar')).toBe(false);

    fireEvent.change(campo, { target: { value: ' ana.ribeiro@acme.com.br ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('heading', { name: 'Confirme o seu e-mail' })).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/auth/email/trocar')?.corpo).toEqual({ email: 'ana.ribeiro@acme.com.br' });
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Enviamos um código de 6 dígitos para ana.ribeiro@acme.com.br.')).toBeTruthy();
  });

  it('sem SMTP no servidor, diz que o código ficou na caixa-de-saida', async () => {
    sessaoNova({ 'GET /auth/email': { ...CODIGO, envio: 'caixa_local' } });
    renderizar(pagina, { caminho: '/criar-conta', rota });
    expect((await screen.findByRole('note')).textContent).toBe(CAIXA_LOCAL);
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

  it('Sua marca: envia o logo, mostra o arquivo e a prévia com ele', async () => {
    const canais = { publicada: WIDGET, rascunho: WIDGET, temAlteracoes: false, chavePublica: 'pk', urlScript: 'x', instalacao: null, conector: 'tela' };
    const logo = {
      arquivo: '0123456789abcdef0123456789abcdef.svg',
      nome: 'logo-horizonte.svg',
      tamanho: 12 * 1024,
      tipo: 'image/svg+xml',
      enviadoEm: new Date().toISOString(),
      url: 'http://localhost:3000/api/widget/marca/pk/0123456789abcdef0123456789abcdef.svg',
    };
    const { pedidos } = instalarFetch({
      'GET /auth/primeiro-acesso': ABERTO,
      'GET /auth/eu': EU,
      'GET /canais': canais,
      'POST /canais/logo': { ...canais, rascunho: { ...WIDGET, logo }, temAlteracoes: true },
      'DELETE /canais/logo': canais,
    });
    renderizar(pagina, { caminho: '/criar-conta/marca', rota });
    expect(await screen.findByText('Arraste o logo para cá ou')).toBeTruthy();
    expect(screen.getByText('PNG ou SVG quadrado, até 1 MB. Aparece no topo e ao lado das respostas.')).toBeTruthy();
    expect(screen.getByText('Atualiza enquanto você edita. É assim que seus clientes vão ver.')).toBeTruthy();
    const arquivo = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'], 'logo-horizonte.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('escolha um arquivo'), { target: { files: [arquivo] } });
    expect(await screen.findByText('logo-horizonte.svg')).toBeTruthy();
    expect(screen.getByText('12 KB · enviado agora')).toBeTruthy();
    expect(screen.getByTestId('previa').textContent).toContain(`logo ${logo.url}`);
    expect(pedidos.find((p) => p.caminho === '/canais/logo')?.corpo).toBeInstanceOf(FormData);
    fireEvent.click(screen.getByRole('button', { name: 'Remover logo-horizonte.svg' }));
    await waitFor(() => expect(screen.queryByText('logo-horizonte.svg')).toBeNull());
    expect(screen.getByTestId('previa').textContent).not.toContain('logo');
  });

  it('sem sessão, as etapas 2 e 3 levam à entrada', async () => {
    instalarFetch({ 'GET /auth/primeiro-acesso': ABERTO, 'GET /auth/eu': SEM_SESSAO });
    renderizar(pagina, { caminho: '/criar-conta/marca', rota });
    await waitFor(() => expect(local()).toBe(`/entrar?voltar=${encodeURIComponent('/criar-conta/marca')}`));
  });
});

// E1 · Instalar o gravador (/aprender/instalar) e a entrada da extensão (/extensao/conectar): a página
// percebe a extensão sozinha, diz a empresa em que ela entrou e entrega o código só pela própria janela.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  FONTE_CONSOLE,
  FONTE_EXTENSAO,
  MARCA_EXTENSAO,
  type ConexaoExtensao,
  type EmpresaDaConta,
  type Eu,
  type InfoExtensao,
  type MensagemDaExtensao,
  type MensagemDoConsole,
} from '@copiloto/shared';
import Instalar from '../../src/paginas/extensao/Instalar.tsx';
import Conectar, { empresaInicial } from '../../src/paginas/extensao/Conectar.tsx';
import { navegadorAtual, perguntarExtensao } from '../../src/paginas/extensao/ponte.ts';
import { HORIZONTE, instalarFetch, local, renderizar, renderizarRotas, status } from './ambiente.tsx';

const INFO: InfoExtensao = {
  lojas: { chrome: null, edge: null },
  ajudaInstalar: 'https://github.com/starta/copiloto#instalar-pelo-pacote-sem-a-loja',
  quemPodeGravar: [
    { id: 'mem-1', nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', iniciais: 'RL', perfil: 'admin', voce: true },
    { id: 'mem-2', nome: 'Júlia Martins', email: 'julia@seusistema.com.br', iniciais: 'JM', perfil: 'editor', voce: false },
  ],
};

const CONEXAO_HORIZONTE: ConexaoExtensao = { empresa: { id: HORIZONTE.id, nome: 'Horizonte' }, pessoa: { nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br' } };

/**
 * Extensão de mentira na própria janela: responde às perguntas do console como o content script
 * (mesma janela, mesma origem). `responder` devolve a resposta (sem fonte e id) ou null para calar.
 */
function extensaoFalsa(responder: (m: MensagemDoConsole) => Record<string, unknown> | null) {
  const recebidas: MensagemDoConsole[] = [];
  const ouvir = (e: MessageEvent) => {
    const m = e.data as MensagemDoConsole;
    if (!m || m.fonte !== FONTE_CONSOLE) return;
    recebidas.push(m);
    const r = responder(m);
    if (!r) return;
    const data = { ...r, fonte: FONTE_EXTENSAO, id: m.id } as MensagemDaExtensao;
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin })), 0);
  };
  window.addEventListener('message', ouvir);
  return { recebidas, parar: () => window.removeEventListener('message', ouvir) };
}

let pararExtensao: (() => void) | null = null;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pararExtensao?.();
  pararExtensao = null;
  document.documentElement.removeAttribute(MARCA_EXTENSAO);
});

describe('E1 · Instalar o gravador', () => {
  it('sem a extensão: procura sozinha, explica o pacote sem loja e mostra quem pode gravar', async () => {
    instalarFetch({ 'GET /extensao': INFO });
    renderizar(<Instalar />, { caminho: '/aprender/instalar' });

    expect(screen.getByText('Procurando a extensão…')).toBeTruthy();
    expect(screen.getByText(/Não precisa recarregar/)).toBeTruthy();
    expect(await screen.findByText(/ainda não está publicada na loja/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Como instalar pelo pacote' }).getAttribute('href')).toBe(INFO.ajudaInstalar);
    expect(screen.queryByRole('link', { name: /Instalar no Chrome/ })).toBeNull();

    const passo3 = screen.getByText(/Neste console você está como/);
    expect(passo3.textContent).toBe('Neste console você está como Rafael Lima, na Horizonte.');

    const quem = screen.getByRole('list', { name: 'Pessoas que podem gravar' });
    expect(within(quem).getByText('Júlia Martins')).toBeTruthy();
    expect(within(quem).getByText('Editor de tarefas')).toBeTruthy();
    expect(within(quem).getByText('(você)')).toBeTruthy();
    // Horizonte é a empresa de demonstração.
    expect(screen.getByText('Dados de exemplo')).toBeTruthy();

    // O que grava e o que nunca grava.
    expect(screen.getByText('Senhas, nem o formato delas')).toBeTruthy();
    expect(screen.getByText('Os valores que você digita')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Começar gravação' })).toBeNull();
  });

  it('com as lojas configuradas: botão da loja do navegador primeiro', async () => {
    instalarFetch({ 'GET /extensao': { ...INFO, lojas: { chrome: 'https://chromewebstore.google.com/detail/x', edge: 'https://microsoftedge.microsoft.com/addons/detail/y' } } });
    renderizar(<Instalar />, { caminho: '/aprender/instalar', eu: { empresa: { id: 'emp-acme', nome: 'Acme', demo: false } } });
    const chrome = await screen.findByRole('link', { name: 'Instalar no Chrome' });
    expect(chrome.getAttribute('href')).toBe('https://chromewebstore.google.com/detail/x');
    expect(screen.getByRole('link', { name: 'Instalar no Edge' })).toBeTruthy();
    expect(screen.queryByText(/ainda não está publicada na loja/)).toBeNull();
    // Empresa de verdade: sem o selo de exemplo.
    expect(screen.queryByText('Dados de exemplo')).toBeNull();
  });

  it('percebe a instalação e a entrada sem recarregar, e libera Começar gravação', async () => {
    instalarFetch({ 'GET /extensao': INFO });
    let conexao: ConexaoExtensao | null = null;
    pararExtensao = extensaoFalsa((m) => (m.tipo === 'extensao:estado' ? { tipo: 'extensao:estado', versao: '0.2.0', conexao, consoleConfigurado: true } : null)).parar;
    renderizar(<Instalar />, { caminho: '/aprender/instalar' });
    expect(screen.getByText('Procurando a extensão…')).toBeTruthy();

    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.2.0');
    expect(await screen.findByText('Extensão instalada · versão 0.2.0 · falta entrar', {}, { timeout: 4000 })).toBeTruthy();

    conexao = CONEXAO_HORIZONTE;
    expect(await screen.findByText('Extensão instalada · versão 0.2.0 · conectada a Horizonte', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Começar gravação' }).getAttribute('href')).toBe('/aprender?nova=1');
    expect(screen.getByText(/como Rafael Lima\. Já dá para gravar\./)).toBeTruthy();
  });

  it('extensão em outra empresa: avisa e não oferece gravar aqui', async () => {
    instalarFetch({ 'GET /extensao': INFO });
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.2.0');
    pararExtensao = extensaoFalsa(() => ({
      tipo: 'extensao:estado',
      versao: '0.2.0',
      conexao: { ...CONEXAO_HORIZONTE, empresa: { id: 'emp-acme', nome: 'Acme' } },
      consoleConfigurado: true,
    })).parar;
    renderizar(<Instalar />, { caminho: '/aprender/instalar' });
    expect(await screen.findByText('Extensão instalada · versão 0.2.0 · conectada a Acme')).toBeTruthy();
    expect(screen.getByText(/Para gravar para a Horizonte, use Trocar no ícone do gravador/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Começar gravação' })).toBeNull();
  });

  it('extensão ligada a outro servidor', async () => {
    instalarFetch({ 'GET /extensao': INFO });
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.2.0');
    pararExtensao = extensaoFalsa(() => ({ tipo: 'extensao:estado', versao: '0.2.0', conexao: null, consoleConfigurado: false })).parar;
    renderizar(<Instalar />, { caminho: '/aprender/instalar' });
    expect(await screen.findByText(/ligada a outro servidor do copiloto/)).toBeTruthy();
  });
});

describe('Ponte console ↔ extensão', () => {
  it('só aceita a resposta da própria janela, da mesma origem e com o mesmo id', async () => {
    const espiao = vi.spyOn(window, 'postMessage');
    const pergunta = perguntarExtensao({ tipo: 'extensao:estado' }, 300);
    const enviada = espiao.mock.calls[0];
    expect(enviada[1]).toBe(window.location.origin);
    const { id } = enviada[0] as MensagemDoConsole;
    const resposta = { fonte: FONTE_EXTENSAO, tipo: 'extensao:estado', id, versao: '9.9.9', conexao: null, consoleConfigurado: true };
    // Outra origem, outra janela e outro id: ignorados.
    window.dispatchEvent(new MessageEvent('message', { data: resposta, source: window, origin: 'https://golpe.example' }));
    window.dispatchEvent(new MessageEvent('message', { data: resposta, source: null, origin: window.location.origin }));
    window.dispatchEvent(new MessageEvent('message', { data: { ...resposta, id: 'outro' }, source: window, origin: window.location.origin }));
    expect(await pergunta).toBeNull();
    espiao.mockRestore();
  });

  it('navegador pelo user agent', () => {
    expect(navegadorAtual('Mozilla/5.0 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge');
    expect(navegadorAtual('Mozilla/5.0 Chrome/130.0 Safari/537.36')).toBe('Chrome');
    expect(navegadorAtual('Mozilla/5.0 Firefox/131.0')).toBe('outro');
  });
});

const EMPRESAS: EmpresaDaConta[] = [
  { ...HORIZONTE, perfil: 'admin', iniciais: 'HO', ultimoAcesso: null },
  { id: 'emp-acme', nome: 'Acme', demo: false, perfil: 'editor', iniciais: 'AC', ultimoAcesso: null },
  { id: 'emp-leitura', nome: 'Leitura Ltda', demo: false, perfil: 'leitor', iniciais: 'LL', ultimoAcesso: null },
];
const EU = { id: 'mem-1', nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', iniciais: 'RL', perfil: 'admin', empresa: HORIZONTE } as unknown as Eu;
const ESTADO = 'estado-da-extensao-123456';
const DESAFIO = 'a'.repeat(43);

describe('Entrada da extensão (/extensao/conectar)', () => {
  it('empresa inicial: a pedida, a aberta ou a primeira que grava', () => {
    expect(empresaInicial(EMPRESAS, 'emp-acme', HORIZONTE.id)).toBe('emp-acme');
    expect(empresaInicial(EMPRESAS, 'emp-leitura', HORIZONTE.id)).toBe(HORIZONTE.id);
    expect(empresaInicial(EMPRESAS, null, 'emp-leitura')).toBe(HORIZONTE.id);
    expect(empresaInicial([EMPRESAS[2]], null, null)).toBeNull();
  });

  it('pede o código para a empresa escolhida e entrega à extensão pela janela', async () => {
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.2.0');
    const { pedidos } = instalarFetch({
      'GET /auth/empresas': { empresas: EMPRESAS, avisos: [] },
      'GET /auth/eu': EU,
      'POST /extensao/codigo': { codigo: 'codigo-curto', expiraEm: '2026-10-17T12:02:00.000Z' },
    });
    const ext = extensaoFalsa((m) =>
      m.tipo === 'extensao:conectar' ? { tipo: 'extensao:conectada', ok: true, conexao: { empresa: { id: 'emp-acme', nome: 'Acme' }, pessoa: { nome: 'Rafael Lima', email: EU.email } } } : null,
    );
    pararExtensao = ext.parar;
    renderizarRotas({ '/extensao/conectar': <Conectar /> }, `/extensao/conectar?estado=${ESTADO}&desafio=${DESAFIO}&empresa=emp-acme`);

    expect(await screen.findByRole('heading', { name: 'Para qual empresa vão as gravações?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Acme/ }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('radio', { name: /Leitura Ltda/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/este perfil não grava fluxos/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Horizonte/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Acme/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Conectar o gravador' }));

    expect(await screen.findByRole('heading', { name: 'Gravador conectado' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('na Acme');
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ empresaId: 'emp-acme', desafio: DESAFIO });
    const conectar = ext.recebidas.find((m) => m.tipo === 'extensao:conectar');
    expect(conectar).toMatchObject({ estado: ESTADO, codigo: 'codigo-curto' });
  });

  it('mostra o erro que a extensão devolve', async () => {
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.2.0');
    instalarFetch({
      'GET /auth/empresas': { empresas: EMPRESAS, avisos: [] },
      'GET /auth/eu': EU,
      'POST /extensao/codigo': { codigo: 'codigo-curto', expiraEm: '2026-10-17T12:02:00.000Z' },
    });
    pararExtensao = extensaoFalsa((m) =>
      m.tipo === 'extensao:conectar' ? { tipo: 'extensao:conectada', ok: false, mensagem: 'Este pedido de entrada expirou. Clique de novo em Entrar no ícone do gravador.' } : null,
    ).parar;
    renderizarRotas({ '/extensao/conectar': <Conectar /> }, `/extensao/conectar?estado=${ESTADO}&desafio=${DESAFIO}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar o gravador' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Este pedido de entrada expirou');
  });

  it('servidor recusa o código: mostra a mensagem e não fala com a extensão', async () => {
    document.documentElement.setAttribute(MARCA_EXTENSAO, '0.2.0');
    instalarFetch({
      'GET /auth/empresas': { empresas: EMPRESAS, avisos: [] },
      'GET /auth/eu': EU,
      'POST /extensao/codigo': status(403, { erro: 'sem_permissao', mensagem: 'Seu perfil nesta empresa não permite gravar fluxos.' }),
    });
    const ext = extensaoFalsa(() => null);
    pararExtensao = ext.parar;
    renderizarRotas({ '/extensao/conectar': <Conectar /> }, `/extensao/conectar?estado=${ESTADO}&desafio=${DESAFIO}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar o gravador' }));
    expect((await screen.findByRole('alert')).textContent).toContain('não permite gravar fluxos');
    expect(ext.recebidas.some((m) => m.tipo === 'extensao:conectar')).toBe(false);
  });

  it('sem sessão no console: vai para Entrar e volta para cá', async () => {
    instalarFetch({
      'GET /auth/empresas': status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' }),
      'GET /auth/eu': status(401, { erro: 'sem_sessao', mensagem: 'Entre de novo.' }),
    });
    renderizarRotas({ '/extensao/conectar': <Conectar />, '/entrar': <div>tela de entrar</div> }, `/extensao/conectar?estado=${ESTADO}&desafio=${DESAFIO}`);
    expect(await screen.findByText('tela de entrar')).toBeTruthy();
    expect(decodeURIComponent(local())).toBe(`/entrar?voltar=/extensao/conectar?estado=${ESTADO}&desafio=${DESAFIO}`);
  });

  it('endereço sem estado ou desafio: explica e não carrega nada', async () => {
    const { pedidos } = instalarFetch({});
    renderizarRotas({ '/extensao/conectar': <Conectar /> }, '/extensao/conectar?estado=curto');
    expect(screen.getByRole('heading', { name: 'Este endereço de entrada está incompleto' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver como instalar o gravador' }).getAttribute('href')).toBe('/aprender/instalar');
    await waitFor(() => expect(pedidos).toHaveLength(0));
  });
});

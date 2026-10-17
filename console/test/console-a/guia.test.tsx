// Guia de início (C0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Canais, Guia as DadosGuia } from '@copiloto/shared';
import Guia, { codigoInstalacao, textoFaltam } from '../../src/paginas/guia/Guia.tsx';
import { instalarEventSource, instalarFetch, renderizar, status, USUARIOS, type Pedido } from './ambiente.tsx';

vi.mock('@copiloto/widget/chat', () => ({
  ChatCopiloto: ({ token }: { token: string }) => <div data-testid="chat">chat {token}</div>,
}));

function guia(feitos: Record<string, boolean>): DadosGuia {
  const passos: DadosGuia['passos'] = [
    { chave: 'sistema', titulo: 'Conectar o seu sistema', feito: feitos.sistema ?? true, resumo: 'API respondeu em 120 ms.' },
    {
      chave: 'tarefa',
      titulo: 'Criar a primeira tarefa',
      feito: feitos.tarefa ?? true,
      resumo: 'Tarefa Cadastrar cliente criada, com 5 campos e confirmação antes de gravar.',
    },
    {
      chave: 'testes',
      titulo: 'Testar com pedidos reais',
      feito: feitos.testes ?? true,
      resumo: '18 de 20 acertos em pedidos escritos como a sua equipe escreve.',
    },
    { chave: 'widget', titulo: 'Personalizar e instalar o widget', feito: feitos.widget ?? false, resumo: 'Escolha como o copiloto se apresenta.' },
    { chave: 'equipe', titulo: 'Convidar a equipe', feito: feitos.equipe ?? false, resumo: 'Chame quem vai criar tarefas.' },
  ];
  const n = passos.filter((p) => p.feito).length;
  return { feitos: n, total: 5, passos, sistema: { conectado: true, url: 'https://api.horizonte.com.br', nome: 'Horizonte' } };
}

const CONFIG = {
  nome: 'Copiloto Horizonte',
  boasVindas: 'Olá! Sou o copiloto da Horizonte.',
  sugestoes: [],
  cor: '#1F6FEB',
  posicao: 'direita' as const,
  atalho: true,
  proativa: { ativa: false, segundosParado: 30 as const },
  atendimentoHumano: { horario: '' },
  dominios: [],
};
const CANAIS: Canais = {
  publicada: CONFIG,
  rascunho: CONFIG,
  temAlteracoes: false,
  chavePublica: 'pk_hz_7f3a91',
  urlScript: 'http://localhost:3201/copiloto.js',
  instalacao: null,
  conector: 'api',
};

const TAREFAS = {
  tarefas: [{ id: 'tar-1', nome: 'Cadastrar cliente', versaoPublicada: 4 }],
  contagem: { todas: 1, ativa: 1, teste: 0, rascunho: 0, inativa: 0 },
  semTarefa: [],
};

beforeEach(() => instalarEventSource());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('C0 · Guia de início', () => {
  it('textos auxiliares', () => {
    expect(textoFaltam(2)).toBe('Faltam dois passos');
    expect(textoFaltam(1)).toBe('Falta um passo');
    expect(codigoInstalacao('https://x/copiloto.js', 'pk_1')).toContain('data-chave="pk_1"');
    expect(codigoInstalacao('https://x/copiloto.js', 'pk_1')).not.toContain('data-nome');
    expect(codigoInstalacao('https://x/copiloto.js', 'pk_1', 'tela')).toContain('data-perfis="PERFIS_SEPARADOS_POR_VIRGULA"');
  });

  it('mostra o progresso, os passos feitos e instala o widget', async () => {
    let verificar = 0;
    const { pedidos } = instalarFetch({
      'GET /guia': guia({}),
      'GET /tarefas': TAREFAS,
      'GET /canais': CANAIS,
      'GET /sistema/usuarios': USUARIOS,
      'POST /teste/token': { token: 'tok', usuario: USUARIOS[0] },
      'PUT /canais/rascunho': (p: Pedido) => ({ ...CANAIS, rascunho: (p.corpo as { config: typeof CONFIG }).config, temAlteracoes: true }),
      'POST /guia/widget-verificado': () =>
        ++verificar === 1
          ? status(409, { erro: 'widget_nao_visto', mensagem: 'Ainda não vimos o widget no Horizonte.' })
          : guia({ widget: true }),
    });
    const { sessao } = renderizar(<Guia />, { caminho: '/guia', rota: '/guia' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Vamos colocar o copiloto no ar' })).toBeTruthy();
    expect(screen.getByText(/Olá, Rafael\. Faltam dois passos/)).toBeTruthy();
    expect(screen.getByText('3 de 5 passos')).toBeTruthy();
    expect(screen.getByText('https://api.horizonte.com.br')).toBeTruthy();
    expect(screen.getByText('18 de 20 acertos')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver testes' }).getAttribute('href')).toBe('/tarefas/tar-1?aba=testes');
    expect(screen.getByText('Passo atual')).toBeTruthy();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();

    const codigo = await screen.findByText(/data-chave="pk_hz_7f3a91"/);
    expect(codigo.textContent).toContain('src="http://localhost:3201/copiloto.js"');

    fireEvent.change(screen.getByLabelText('Nome do copiloto'), { target: { value: 'Copiloto HZ' } });
    await waitFor(() => expect(pedidos.some((p) => p.metodo === 'PUT')).toBe(true), { timeout: 2000 });
    expect((pedidos.find((p) => p.metodo === 'PUT')!.corpo as { config: { nome: string } }).config.nome).toBe('Copiloto HZ');
    expect(await screen.findByRole('button', { name: 'Publicar no widget' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Já instalei, verificar' }));
    expect(await screen.findByText('Ainda não vimos o widget no Horizonte.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Já instalei, verificar' }));
    expect(await screen.findByText('4 de 5 passos')).toBeTruthy();
    expect(sessao.recarregarResumo).toHaveBeenCalled();
    // Agora o passo atual é convidar a equipe.
    expect(screen.getByRole('link', { name: /Convidar agora/ }).getAttribute('href')).toBe('/equipe');
  });

  it('sem tarefa publicada, o passo atual oferece descrever ou gravar', async () => {
    instalarFetch({
      'GET /guia': guia({ tarefa: false, testes: false }),
      'GET /tarefas': { ...TAREFAS, tarefas: [] },
      'GET /sistema/usuarios': USUARIOS,
      'POST /teste/token': { token: 'tok', usuario: USUARIOS[0] },
    });
    renderizar(<Guia />, { caminho: '/guia', rota: '/guia' });
    fireEvent.click(await screen.findByRole('button', { name: 'Descrever a tarefa' }));
    expect(await screen.findByRole('dialog', { name: 'Descrever a tarefa' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Gravar o fluxo na tela/ }).getAttribute('href')).toBe('/aprender');
  });

  it('tudo feito leva ao painel', async () => {
    instalarFetch({
      'GET /guia': guia({ widget: true, equipe: true }),
      'GET /tarefas': TAREFAS,
      'GET /sistema/usuarios': USUARIOS,
      'POST /teste/token': { token: 'tok', usuario: USUARIOS[0] },
    });
    renderizar(<Guia />, { caminho: '/guia', rota: '/guia' });
    expect(await screen.findByRole('heading', { level: 1, name: 'O copiloto está no ar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para o painel' }).getAttribute('href')).toBe('/painel');
  });

  it('sistema pelas telas: o passo do sistema leva à tela Sistema', async () => {
    const pelasTelas = guia({ sistema: false });
    pelasTelas.passos[0].resumo = 'Não consegui abrir https://erp.acme.com.br. O endereço está certo e o sistema está no ar?';
    pelasTelas.sistema = { conectado: false, url: 'https://erp.acme.com.br', nome: 'ERP Acme' };
    instalarFetch({
      'GET /guia': pelasTelas,
      'GET /tarefas': TAREFAS,
      'GET /canais': { ...CANAIS, conector: 'tela' },
      'GET /sistema/config': {
        nome: 'ERP Acme',
        url: 'https://erp.acme.com.br',
        conector: 'tela',
        acesso: { modo: 'sessao', urlSessao: '', urlLogin: '', usuario: '', temSenha: false },
        perfis: [],
        editavel: true,
      },
      'GET /sistema/usuarios': USUARIOS,
      'POST /teste/token': { token: 'tok', usuario: USUARIOS[0] },
    });
    renderizar(<Guia />, { caminho: '/guia', rota: '/guia' });
    expect(await screen.findByText('Ainda não conseguimos abrir o ERP Acme')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir Sistema' }).getAttribute('href')).toBe('/sistema');
    expect(screen.queryByText(/endereço da API/)).toBeNull();
  });
});

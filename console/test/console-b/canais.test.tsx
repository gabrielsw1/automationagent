// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Canais as DadosCanais, ConfigWidget } from '@copiloto/shared';
import Canais, {
  contrasteComBranco,
  dominioValido,
  mesmaConfig,
  normalizarConfig,
  normalizarDominio,
  validarConfig,
} from '../../src/paginas/canais/Canais.tsx';
import { HORIZONTE, instalarEventSource, instalarFetch, renderizar } from './ambiente.tsx';

function config(parcial: Partial<ConfigWidget> = {}): ConfigWidget {
  return {
    nome: 'Copiloto',
    boasVindas: 'Oi! Eu agendo visitas, cadastro clientes e tiro dúvidas do sistema.',
    sugestoes: ['Agendar visita', 'Cadastrar cliente'],
    cor: '#c2185b',
    posicao: 'direita',
    atalho: true,
    proativa: { ativa: false, segundosParado: 30 },
    atendimentoHumano: { horario: 'segunda a sexta, das 8h às 18h' },
    dominios: ['app.horizonte.com.br'],
    ...parcial,
  };
}

function canais(parcial: Partial<DadosCanais> = {}): DadosCanais {
  return {
    publicada: config(),
    rascunho: config(),
    temAlteracoes: false,
    chavePublica: 'pk_live_8f3a2c1b9d7e6f5a',
    urlScript: 'http://localhost:3000/copiloto.js',
    instalacao: { origem: 'app.horizonte.com.br', vistoEm: new Date(Date.now() - 3 * 60_000).toISOString() },
    conector: 'api',
    ...parcial,
  };
}

beforeEach(() => {
  instalarEventSource();
  try {
    localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACME = { id: 'emp-acme', nome: 'Acme Logística', demo: false };

describe('regras do widget', () => {
  it('normaliza e valida domínios como o servidor', () => {
    expect(normalizarDominio(' https://App.Horizonte.com.br/clientes?x=1 ')).toBe('app.horizonte.com.br');
    expect(normalizarDominio('localhost:5173/')).toBe('localhost:5173');
    expect(dominioValido('app.horizonte.com.br')).toBe(true);
    expect(dominioValido('localhost:5173')).toBe(true);
    expect(dominioValido('*.horizonte.com.br')).toBe(false);
    expect(dominioValido('com espaço')).toBe(false);
  });

  it('aponta cada campo inválido com a mensagem certa', () => {
    expect(validarConfig(config())).toEqual({});
    const e = validarConfig(
      config({ nome: ' ', boasVindas: 'x'.repeat(281), sugestoes: ['a', 'b', 'c', 'd', 'e'], cor: 'rosa', dominios: ['*.x.com'] }),
    );
    expect(e.nome).toBe('Dê um nome ao assistente.');
    expect(e.boasVindas).toBe('A mensagem de boas-vindas pode ter até 280 caracteres.');
    expect(e.sugestoes).toBe('Use no máximo 4 sugestões.');
    expect(e.cor).toMatch(/^Use a cor no formato #RRGGBB/);
    expect(e.dominios).toContain('“*.x.com” não parece um domínio');
  });

  it('mede o contraste do texto branco', () => {
    expect(contrasteComBranco('#000000')).toBeCloseTo(21, 0);
    expect(contrasteComBranco('#ffffff')).toBeCloseTo(1, 1);
    expect(contrasteComBranco('#ffeb3b')!).toBeLessThan(3);
    expect(contrasteComBranco('rosa')).toBeNull();
  });

  it('compara rascunhos depois de normalizar', () => {
    const a = config({ nome: ' Copiloto ', dominios: ['https://APP.horizonte.com.br/', 'app.horizonte.com.br'] });
    expect(mesmaConfig(normalizarConfig(a), config())).toBe(true);
  });
});

describe('C8 · Canais e widget', () => {
  it('mostra rascunho não publicado, canais em breve, instalação e trecho com assinatura', async () => {
    instalarFetch({
      'GET /canais': canais({ rascunho: config({ nome: 'Ajuda Horizonte' }), temAlteracoes: true }),
      'GET /sistema/usuarios': [],
    });
    renderizar(<Canais />, { caminho: '/canais' });
    expect(await screen.findByRole('heading', { name: 'Canais e widget' })).toBeTruthy();
    expect(screen.getAllByText('Alterações não publicadas').length).toBe(2); // cabeçalho + faixa
    for (const canal of ['WhatsApp', 'E-mail', 'Voz']) {
      const aba = screen.getByRole('tab', { name: new RegExp(canal) });
      expect(aba.getAttribute('aria-disabled')).toBe('true');
      expect(within(aba).getByText('Em breve')).toBeTruthy();
    }
    expect((screen.getByLabelText('Nome do assistente') as HTMLInputElement).value).toBe('Ajuda Horizonte');
    expect(screen.getByText(/Detectado em app\.horizonte\.com\.br/)).toBeTruthy();
    const trecho = screen.getByLabelText('Trecho de instalação').textContent ?? '';
    expect(trecho).toContain('src="http://localhost:3000/copiloto.js"');
    expect(trecho).toContain('data-assinatura=');
    expect(trecho).not.toContain('pk_live_8f3a2c1b9d7e6f5a'); // a chave aparece mascarada; o Copiar leva a inteira
  });

  it('salva o rascunho sozinho e publica', async () => {
    const { pedidos } = instalarFetch({
      'GET /canais': canais(),
      'GET /sistema/usuarios': [],
      'PUT /canais/rascunho': ({ corpo }: { corpo: unknown }) => {
        const c = (corpo as { config: ConfigWidget }).config;
        return canais({ rascunho: normalizarConfig(c), temAlteracoes: true });
      },
      'POST /canais/publicar': () => canais({ publicada: config({ nome: 'Ajuda' }), rascunho: config({ nome: 'Ajuda' }) }),
    });
    renderizar(<Canais />, { caminho: '/canais' });
    const nome = (await screen.findByLabelText('Nome do assistente')) as HTMLInputElement;
    expect(screen.getByText('Tudo publicado')).toBeTruthy();
    fireEvent.change(nome, { target: { value: 'Ajuda' } });
    await waitFor(
      () => expect(pedidos.some((p) => p.metodo === 'PUT' && (p.corpo as { config: ConfigWidget }).config.nome === 'Ajuda')).toBe(true),
      { timeout: 2500 },
    );
    await waitFor(() => expect(screen.getAllByText('Alterações não publicadas').length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Publicar alterações' }));
    expect(await screen.findByText(/Widget publicado/)).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST' && p.caminho === '/canais/publicar')).toBe(true);
    expect(screen.getByText('Tudo publicado')).toBeTruthy();
  });

  it('campo inválido não salva e mostra o erro', async () => {
    const { pedidos } = instalarFetch({ 'GET /canais': canais(), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais' });
    const nome = await screen.findByLabelText('Nome do assistente');
    fireEvent.change(nome, { target: { value: '' } });
    expect(await screen.findByText('Dê um nome ao assistente.')).toBeTruthy();
    expect(screen.getByText('Corrija os campos destacados para salvar.')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1000));
    expect(pedidos.some((p) => p.metodo === 'PUT')).toBe(false);
  });

  it('Leitor vê a configuração sem poder mudar', async () => {
    instalarFetch({ 'GET /canais': canais({ instalacao: null }), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais', perfil: 'leitor' });
    expect(await screen.findByText(/Seu perfil só permite ver esta configuração/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publicar alterações' })).toBeNull();
    expect((screen.getByLabelText('Nome do assistente') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Ainda não detectado')).toBeTruthy();
  });

  it('sistema pelas telas: trecho com nome, e-mail e perfis assinados e o endereço de sessão', async () => {
    instalarFetch({ 'GET /canais': canais({ conector: 'tela' }), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais', eu: { empresa: ACME, empresas: [ACME] } });
    const trecho = (await screen.findByLabelText('Trecho de instalação')).textContent ?? '';
    expect(trecho).toContain('data-usuario="ID_DO_USUARIO_LOGADO"');
    expect(trecho).toContain('data-nome="NOME_DO_USUARIO"');
    expect(trecho).toContain('data-email="EMAIL_DO_USUARIO"');
    expect(trecho).toContain('data-perfis="PERFIS_SEPARADOS_POR_VIRGULA"');
    expect(trecho).toContain('data-assinatura="HMAC_DOS_DADOS_DO_USUARIO"');
    expect(screen.getByLabelText('Exemplo do texto assinado').textContent).toBe('101\nAna Ribeiro\nana@suaempresa.com.br\nAtendimento,Comercial');
    expect(screen.getAllByText(/usuario\.perfis\.join\(','\)/).length).toBeGreaterThan(0);

    // Endereço de sessão: pedido assinado e as duas respostas aceitas.
    const pedido = screen.getByLabelText('Pedido de sessão').textContent ?? '';
    expect(pedido).toContain('X-Copiloto-Assinatura');
    expect(pedido).toContain('{"usuario":"101","ts":1760700000000}');
    expect(screen.getByLabelText('Resposta com cookies').textContent).toBe('{"cookies":[{"name":"sessao","value":"..."}]}');
    expect(screen.getByLabelText('Resposta com link').textContent).toContain('"url":"https://');
    expect(screen.getByText(/no máximo 5 minutos/)).toBeTruthy();
    expect(screen.getByText('Ver exemplos do endereço de sessão')).toBeTruthy();
  });

  it('sistema pela API: o trecho leva só o ID e não há endereço de sessão', async () => {
    instalarFetch({ 'GET /canais': canais({ conector: 'api' }), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais' });
    const trecho = (await screen.findByLabelText('Trecho de instalação')).textContent ?? '';
    expect(trecho).toContain('data-assinatura="HMAC_DO_ID_DO_USUARIO"');
    expect(trecho).not.toContain('data-nome');
    expect(screen.queryByLabelText('Pedido de sessão')).toBeNull();
  });

  it('Admin mostra o segredo do widget e gera um novo com confirmação', async () => {
    const { pedidos } = instalarFetch({
      'GET /canais': canais({ conector: 'tela' }),
      'GET /sistema/usuarios': [],
      'GET /canais/segredo': { segredo: 'seg_antigo_123' },
      'POST /canais/segredo/novo': { segredo: 'seg_novo_456' },
    });
    renderizar(<Canais />, { caminho: '/canais', eu: { empresa: ACME, empresas: [ACME] } });
    fireEvent.click(await screen.findByRole('button', { name: /Mostrar segredo/ }));
    expect(((await screen.findByLabelText('Segredo do widget')) as HTMLInputElement).value).toBe('seg_antigo_123');
    fireEvent.click(screen.getByRole('button', { name: 'Esconder' }));
    expect(screen.queryByLabelText('Segredo do widget')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Gerar novo segredo/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Gerar um segredo novo?' });
    expect(within(dialogo).getByText(/O segredo atual para de valer na hora/)).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/canais/segredo/novo')).toBe(false);
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Gerar segredo novo' }));
    expect(((await screen.findByLabelText('Segredo do widget')) as HTMLInputElement).value).toBe('seg_novo_456');
    expect(screen.getByText('Segredo novo gerado. Atualize o seu sistema para assinar com ele.')).toBeTruthy();
    expect(pedidos.filter((p) => p.caminho === '/canais/segredo/novo').length).toBe(1);
  });

  it('demonstração: o segredo vem do servidor e não aparece', async () => {
    const { pedidos } = instalarFetch({ 'GET /canais': canais(), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais', eu: { empresa: HORIZONTE, empresas: [HORIZONTE] } });
    expect(await screen.findByText(/o segredo vem da variável WIDGET_SEGREDO do servidor do copiloto/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mostrar segredo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gerar novo segredo/ })).toBeNull();
    expect(pedidos.some((p) => p.caminho.startsWith('/canais/segredo'))).toBe(false);
  });

  it('segredo do ambiente (409): explica em vez de mostrar', async () => {
    instalarFetch({
      'GET /canais': canais({ conector: 'tela' }),
      'GET /sistema/usuarios': [],
      'GET /canais/segredo': {
        status: 409,
        corpo: { erro: 'segredo_do_ambiente', mensagem: 'Na demonstração o segredo vem da variável WIDGET_SEGREDO do servidor, a mesma que o Horizonte usa.' },
      },
    });
    renderizar(<Canais />, { caminho: '/canais', eu: { empresa: ACME, empresas: [ACME] } });
    fireEvent.click(await screen.findByRole('button', { name: /Mostrar segredo/ }));
    expect(await screen.findByText(/a mesma que o Horizonte usa/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mostrar segredo/ })).toBeNull();
  });

  it('só Admin vê o bloco do segredo', async () => {
    instalarFetch({ 'GET /canais': canais({ conector: 'tela' }), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais', perfil: 'editor', eu: { empresa: ACME, empresas: [ACME] } });
    await screen.findByLabelText('Trecho de instalação');
    expect(screen.queryByRole('button', { name: /Mostrar segredo/ })).toBeNull();
    expect(screen.getByText(/Um Admin da sua equipe vê o segredo do widget nesta tela/)).toBeTruthy();
  });

  it('o rascunho guardado sem conexão é de cada empresa', async () => {
    localStorage.setItem('copiloto.console.canais.rascunho.emp-outra', JSON.stringify(config({ nome: 'De outra empresa' })));
    instalarFetch({ 'GET /canais': canais(), 'GET /sistema/usuarios': [] });
    renderizar(<Canais />, { caminho: '/canais' });
    expect(((await screen.findByLabelText('Nome do assistente')) as HTMLInputElement).value).toBe('Copiloto');
    cleanup();

    localStorage.setItem('copiloto.console.canais.rascunho.emp-horizonte', JSON.stringify(config({ nome: 'Guardado offline' })));
    renderizar(<Canais />, { caminho: '/canais', perfil: 'admin' });
    expect(((await screen.findByLabelText('Nome do assistente')) as HTMLInputElement).value).toBe('Guardado offline');
  });
});

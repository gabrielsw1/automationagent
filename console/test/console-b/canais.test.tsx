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
import { instalarEventSource, instalarFetch, renderizar } from './ambiente.tsx';

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
});

// Content scripts: marca no <html>, token tirado da URL, barra "Gravando" no Shadow DOM (a do widget),
// captura no mundo da página (a Captura do widget) e a ponte entre os dois mundos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARCA_EXTENSAO, type EventoGravado } from '@copiloto/shared';
import type { EstadoAba, Pedido } from '../src/comum/mensagens.ts';
import { GravacaoNaPagina, iniciarConteudo, marcarPagina, pegarParametros } from '../src/conteudo/gravacao.ts';
import { EVENTO_CAPTURA, EVENTO_COMANDO, ehDoCopiloto, lerEvento } from '../src/conteudo/ponte.ts';
import { instalarChrome } from './chrome-falso.ts';

const gravando = (p: Partial<EstadoAba> = {}): EstadoAba => ({
  situacao: 'gravando',
  nome: 'Abrir chamado',
  passos: 0,
  api: 'http://localhost:3000',
  aviso: null,
  ...p,
});

function barra() {
  const host = document.querySelector('copiloto-gravador');
  const raiz = host?.shadowRoot ?? null;
  return {
    host,
    raiz,
    texto: () => raiz?.querySelector('.cp-gravador')?.textContent ?? '',
    botao: (nome: string) => [...(raiz?.querySelectorAll('button') ?? [])].find((b) => b.textContent === nome) as HTMLButtonElement | undefined,
  };
}

const comandos: string[] = [];
const guardarComando = (e: Event) => comandos.push(String((e as CustomEvent).detail));

let ch: ReturnType<typeof instalarChrome>;
let pedidos: Pedido[];
beforeEach(() => {
  ch = instalarChrome();
  pedidos = [];
  comandos.length = 0;
  document.addEventListener(EVENTO_COMANDO, guardarComando);
  history.replaceState(null, '', '/');
});
afterEach(() => {
  document.removeEventListener(EVENTO_COMANDO, guardarComando);
  document.documentElement.removeAttribute(MARCA_EXTENSAO);
  document.querySelectorAll('copiloto-gravador, link[data-copiloto-fontes]').forEach((e) => e.remove());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('content script · começo da página', () => {
  it('marca o <html> com a versão da extensão', () => {
    marcarPagina('0.1.0');
    expect(document.documentElement.getAttribute(MARCA_EXTENSAO)).toBe('0.1.0');
  });

  it('tira o token e o servidor da barra de endereço', () => {
    history.replaceState(null, '', '/chamados?aba=2&copiloto_gravacao=grv_1&copiloto_api=http%3A%2F%2Flocalhost%3A3601#fim');
    expect(pegarParametros()).toEqual({ token: 'grv_1', api: 'http://localhost:3601' });
    expect(location.pathname + location.search + location.hash).toBe('/chamados?aba=2#fim');
    expect(pegarParametros()).toBeNull();
  });

  it('com o token: pede ao fundo para começar, mostra a barra e liga a captura', async () => {
    history.replaceState(null, '', '/chamados?copiloto_gravacao=grv_1&copiloto_api=http%3A%2F%2Flocalhost%3A3000');
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return gravando({ passos: 1 });
    });
    const g = await iniciarConteudo('0.1.0');
    expect(pedidos[0]).toEqual({ tipo: 'comecar', token: 'grv_1', api: 'http://localhost:3000' });
    expect(document.documentElement.hasAttribute(MARCA_EXTENSAO)).toBe(true);
    const b = barra();
    expect(b.host?.hasAttribute('data-copiloto')).toBe(true);
    expect(b.host?.parentElement).toBe(document.documentElement);
    expect(b.texto().replace(/\u00a0/g, ' ')).toContain('Gravando · Abrir chamado· 1 passo');
    expect(b.raiz?.querySelector('style')?.textContent).toContain('--brand-600');
    expect(comandos).toEqual(['comecar']);
    expect(g?.estaCapturando).toBe(true);
    g?.desligar();
  });

  it('sem token e sem gravação na aba: nada de barra', async () => {
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return null;
    });
    await iniciarConteudo('0.1.0');
    expect(pedidos).toEqual([{ tipo: 'estado' }]);
    expect(barra().host).toBeNull();
    expect(comandos).toEqual([]);
  });

  it('extensão sendo recarregada: a página segue normal', async () => {
    ch.chrome.runtime.sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    expect(await iniciarConteudo('0.1.0')).toBeNull();
  });
});

describe('content script · gravando', () => {
  const ligadas: GravacaoNaPagina[] = [];
  afterEach(() => ligadas.splice(0).forEach((g) => g.desligar()));
  function comecar(estado: EstadoAba = gravando()) {
    const g = new GravacaoNaPagina();
    ligadas.push(g);
    g.atualizar(estado);
    return g;
  }
  const capturado = (e: unknown) => document.dispatchEvent(new CustomEvent(EVENTO_CAPTURA, { detail: typeof e === 'string' ? e : JSON.stringify(e) }));

  it('repassa ao fundo o que a captura viu e atualiza a contagem', async () => {
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return { passos: 3 };
    });
    comecar();
    const evento: EventoGravado = { tipo: 'clique', ts: 1, url: 'http://localhost/chamados', elemento: { tag: 'button', css: 'form > button' } };
    capturado(evento);
    capturado('{"tipo":1}');
    capturado({ tipo: 'clique', ts: 1, url: 'x', elemento: { tag: 'a' } });
    await vi.waitFor(() => expect(barra().texto()).toContain('3 passos'));
    expect(pedidos).toEqual([{ tipo: 'eventos', eventos: [evento] }]);
  });

  it('Concluir pela barra: o fundo envia e a barra mostra o fim', async () => {
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return { ok: true };
    });
    comecar();
    barra().botao('Concluir')!.click();
    await vi.waitFor(() => expect(barra().texto()).toContain('Gravação enviada. Volte ao console para revisar.'));
    expect(pedidos).toEqual([{ tipo: 'concluir' }]);
    expect(comandos).toEqual(['comecar', 'parar']);
    // Depois do fim, um aviso atrasado de "gravando" não liga a captura de novo.
    const g = comecar();
    g.atualizar({ ...gravando(), situacao: 'concluida', aviso: null });
    g.atualizar(gravando());
    expect(g.estaCapturando).toBe(false);
  });

  it('Concluir sem conexão: avisa na barra e continua gravando', async () => {
    ch.aoMensagem(() => ({ ok: false, mensagem: 'Não consegui falar com o copiloto em http://localhost:3000.' }));
    const g = comecar();
    barra().botao('Concluir')!.click();
    await vi.waitFor(() => expect(barra().raiz?.querySelector('[role=alert]')?.textContent).toMatch(/Não consegui falar/));
    expect(barra().botao('Concluir')).toBeTruthy();
    expect(g.estaCapturando).toBe(true);
  });

  it('Cancelar pede confirmação e descarta', async () => {
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return { ok: true };
    });
    comecar();
    barra().botao('Cancelar')!.click();
    expect(barra().texto()).toContain('Descartar a gravação?');
    barra().botao('Descartar')!.click();
    await vi.waitFor(() => expect(barra().texto()).toContain('Gravação descartada. Nada foi salvo.'));
    expect(pedidos).toEqual([{ tipo: 'cancelar' }]);
    barra().raiz!.querySelector<HTMLButtonElement>('[aria-label="Fechar aviso"]')!.click();
    expect(barra().host).toBeNull();
  });

  it('servidor sem permissão: a barra oferece abrir as opções', async () => {
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return { ok: true };
    });
    comecar(gravando({ situacao: 'sem_permissao', aviso: 'A extensão ainda não pode falar com o copiloto em https://copiloto.empresa.com.br.' }));
    expect(barra().texto()).toContain('ainda não pode falar');
    barra().botao('Abrir as opções')!.click();
    expect(pedidos).toEqual([{ tipo: 'permitir' }]);
  });

  it('o fundo encerrou (concluído pelo popup): a barra mostra o fim e para a captura', () => {
    const g = comecar();
    g.atualizar({ ...gravando(), situacao: 'concluida', aviso: 'Gravação enviada. Volte ao console para revisar.' });
    expect(barra().texto()).toContain('Gravação enviada');
    expect(comandos).toEqual(['comecar', 'parar']);
  });
});

describe('content script · mundo da página', () => {
  it('a Captura do widget só liga com o comando e ignora a barra do copiloto', async () => {
    vi.resetModules();
    await import('../src/conteudo/pagina.ts');
    const vistos: EventoGravado[] = [];
    const ouvir = (e: Event) => vistos.push(lerEvento((e as CustomEvent).detail)!);
    document.addEventListener(EVENTO_CAPTURA, ouvir);
    document.body.innerHTML = '<form><button type="button" id="abrir">Abrir chamado</button></form><div data-copiloto><button id="nosso">Concluir</button></div>';

    document.getElementById('abrir')!.click();
    expect(vistos).toEqual([]);

    document.dispatchEvent(new CustomEvent(EVENTO_COMANDO, { detail: 'comecar' }));
    document.getElementById('nosso')!.click();
    document.getElementById('abrir')!.click();
    await vi.waitFor(() => expect(vistos.some((v) => v.tipo === 'clique')).toBe(true));
    const cliques = vistos.filter((v) => v.tipo === 'clique');
    expect(cliques).toHaveLength(1);
    expect(cliques[0].elemento?.texto).toBe('Abrir chamado');

    document.dispatchEvent(new CustomEvent(EVENTO_COMANDO, { detail: 'parar' }));
    const antes = vistos.length;
    document.getElementById('abrir')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(vistos).toHaveLength(antes);
    document.removeEventListener(EVENTO_CAPTURA, ouvir);
  });

  it('ehDoCopiloto e lerEvento', () => {
    document.body.innerHTML = '<copiloto-widget data-copiloto><button>x</button></copiloto-widget><p>y</p>';
    expect(ehDoCopiloto(document.querySelector('button'))).toBe(true);
    expect(ehDoCopiloto(document.querySelector('p'))).toBe(false);
    expect(ehDoCopiloto(null)).toBe(false);
    expect(lerEvento('não é json')).toBeNull();
    expect(lerEvento({ tipo: 'clique' })).toBeNull();
    expect(lerEvento('{"tipo":"navegar","ts":1,"url":"http://a/"}')).toEqual({ tipo: 'navegar', ts: 1, url: 'http://a/' });
  });

  it('extensão recarregada no meio: para de capturar', async () => {
    ch.chrome.runtime.sendMessage.mockRejectedValue(new Error('Extension context invalidated.'));
    const g = new GravacaoNaPagina();
    g.atualizar(gravando());
    document.dispatchEvent(new CustomEvent(EVENTO_CAPTURA, { detail: '{"tipo":"clique","ts":1,"url":"http://a/"}' }));
    await vi.waitFor(() => expect(g.estaCapturando).toBe(false));
    expect(comandos).toEqual(['comecar', 'parar']);
  });
});

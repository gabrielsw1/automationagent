// Content scripts: marca no <html>, token tirado da URL, barra "Gravando" no Shadow DOM (a do widget),
// captura no mundo da página (a Captura do widget) e a ponte entre os dois mundos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONTE_CONSOLE, FONTE_EXTENSAO, MARCA_EXTENSAO, type EventoGravado } from '@copiloto/shared';
import type { EstadoAba, Pedido } from '../src/comum/mensagens.ts';
import { GravacaoNaPagina, iniciarConteudo, ligarPonteDoConsole, marcarPagina, pegarParametros } from '../src/conteudo/gravacao.ts';
import { textoDoBalao } from '../src/conteudo/painel.ts';
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
  document.querySelectorAll('copiloto-gravador, link[data-copiloto-fontes], style[data-copiloto]').forEach((e) => e.remove());
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

  it('Concluir sem internet: a captura para e a barra espera a conexão, com "Tentar agora"', async () => {
    const respostas: Record<string, unknown> = {
      concluir: { ok: false, semConexao: true, mensagem: 'Sem conexão agora. Os 2 passos estão guardados e serão enviados quando a internet voltar.' },
      tentarAgora: { ok: true },
    };
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return respostas[(p as Pedido).tipo];
    });
    const g = comecar(gravando({ passos: 2 }));
    barra().botao('Concluir')!.click();
    await vi.waitFor(() => expect(barra().texto()).toContain('Os 2 passos estão guardados'));
    expect(g.estaCapturando).toBe(false);
    expect(barra().botao('Concluir')).toBeUndefined();
    // O aviso do fundo (situação sem_conexao) mantém a espera, sem religar a captura.
    g.atualizar(gravando({ situacao: 'sem_conexao', passos: 2, aviso: 'Sem conexão agora.' }));
    expect(g.estaCapturando).toBe(false);
    barra().botao('Tentar agora')!.click();
    await vi.waitFor(() => expect(barra().texto()).toContain('Gravação enviada. Volte ao console para revisar.'));
    expect(pedidos.map((p) => p.tipo)).toEqual(['concluir', 'tentarAgora']);
  });

  it('painel "Passos gravados": os passos chegam ao vivo e o widget sai de cena', () => {
    const g = comecar(gravando({ itens: [], pendentes: 0 }));
    const painel = () => barra().raiz!.querySelector('.cpx-painel')!;
    expect(painel().getAttribute('aria-label')).toBe('Passos gravados');
    expect(painel().textContent).toContain('Os passos aparecem aqui assim que você clica ou preenche algo na página.');
    expect(painel().textContent).toContain('O assistente do copiloto fica escondido enquanto você grava.');
    expect(document.querySelector('style[data-copiloto]')?.textContent).toBe('copiloto-widget{display:none!important}');
    g.atualizar(gravando({ passos: 3, itens: ['Abrir a página Chamados', 'Clicar em Novo chamado'], pendentes: 1 }));
    expect([...painel().querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1Abrir a página Chamados', '2Clicar em Novo chamado']);
    expect(painel().textContent).toContain('Guardando 1 ação…');
    // Recolher e mostrar de novo.
    painel().querySelector<HTMLButtonElement>('[aria-label="Recolher os passos gravados"]')!.click();
    expect(painel().querySelector('li')).toBeNull();
    painel().querySelector<HTMLButtonElement>('[aria-label="Mostrar os passos gravados"]')!.click();
    expect(painel().querySelectorAll('li')).toHaveLength(2);
    // No fim, o painel sai e o widget volta.
    g.atualizar({ ...gravando(), situacao: 'concluida', aviso: null });
    expect(barra().raiz!.querySelector('.cpx-painel')).toBeNull();
    expect(document.querySelector('style[data-copiloto]')).toBeNull();
  });

  it('balão no campo: mostra só o formato, nunca o valor; em senha, nem o formato', () => {
    document.body.innerHTML = `
      <input id="cnpj" type="text" value="12.345.678/0001-90">
      <textarea id="obs">Cliente VIP</textarea>
      <input id="senha" type="password" value="segredo123">
      <input id="cartao" type="text" autocomplete="cc-number" value="4111 1111 1111 1111">
      <input id="oculto" type="hidden" value="x">
      <input id="vazio" type="email">
      <select id="lista"><option>A</option></select>`;
    comecar();
    const balao = () => barra().raiz!.querySelector<HTMLElement>('.cpx-balao')!;
    const focar = (id: string) => document.getElementById(id)!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    focar('cnpj');
    expect(balao().hidden).toBe(false);
    expect(balao().textContent).toBe('Gravado só o formato:99.999.999/9999-99');
    expect(balao().textContent).not.toContain('12.345');
    const cnpj = document.getElementById('cnpj') as HTMLInputElement;
    cnpj.value = '98.7';
    cnpj.dispatchEvent(new Event('input', { bubbles: true }));
    expect(balao().textContent).toBe('Gravado só o formato:99.9');

    focar('obs');
    expect(balao().textContent).toBe('Gravado só o formato:aaaaaaa aaa');

    focar('senha');
    expect(balao().textContent).toBe('Senha: nada é gravado, nem o formato');
    focar('cartao');
    expect(balao().textContent).toBe('Senha: nada é gravado, nem o formato');
    expect(balao().textContent).not.toMatch(/9{4}/);

    focar('vazio');
    expect(balao().textContent).toBe('Gravado só o formato do que você digitar');
    focar('lista');
    expect(balao().hidden).toBe(true);
    expect(textoDoBalao(document.getElementById('oculto')!)).toBeNull();
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

describe('content script · ponte com o console', () => {
  /** Mensagem como a página do console manda (window.postMessage na própria janela). */
  const doConsole = (data: unknown, origem = location.origin, fonte: Window | null = window) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin: origem, source: fonte }));

  it('repassa ao fundo e devolve a resposta à página, só para a mesma origem', async () => {
    const respostas: MessageEvent[] = [];
    const ouvir = (e: MessageEvent) => {
      if (e.data?.fonte === FONTE_EXTENSAO) respostas.push(e);
    };
    window.addEventListener('message', ouvir);
    const postar = vi.spyOn(window, 'postMessage');
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return { fonte: FONTE_EXTENSAO, tipo: 'extensao:estado', id: 'e1', versao: '0.1.0', conexao: null, consoleConfigurado: false };
    });
    const desligar = ligarPonteDoConsole();
    const pergunta = { fonte: FONTE_CONSOLE, tipo: 'extensao:estado', id: 'e1' };
    doConsole(pergunta);
    await vi.waitFor(() => expect(postar).toHaveBeenCalledTimes(1));
    expect(pedidos).toEqual([{ tipo: 'console', mensagem: pergunta }]);
    expect(postar).toHaveBeenCalledWith(expect.objectContaining({ fonte: FONTE_EXTENSAO, id: 'e1', versao: '0.1.0' }), location.origin);

    // De outra origem, de outro quadro, ou fora do formato: nada vai ao fundo.
    doConsole(pergunta, 'https://outro.site.com');
    doConsole(pergunta, location.origin, null);
    doConsole({ fonte: 'qualquer', tipo: 'extensao:estado', id: 'e2' });
    doConsole({ fonte: FONTE_CONSOLE, tipo: 'extensao:conectar', id: 'e3', estado: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(pedidos).toHaveLength(1);

    // Resposta fora do formato não volta para a página.
    ch.aoMensagem(() => ({ token: 'cpx_segredo' }));
    doConsole(pergunta);
    await new Promise((r) => setTimeout(r, 10));
    expect(postar).toHaveBeenCalledTimes(1);
    desligar();
    window.removeEventListener('message', ouvir);
    postar.mockRestore();
  });

  it('extensão atualizada com a aba aberta: a cópia antiga sai de cena', async () => {
    ch.aoMensagem(() => gravando({ passos: 1 }));
    history.replaceState(null, '', '/chamados?copiloto_gravacao=grv_1');
    const antiga = await iniciarConteudo('0.1.0');
    expect(antiga?.estaCapturando).toBe(true);
    const nova = await iniciarConteudo('0.2.0');
    expect(antiga?.estaCapturando).toBe(false);
    expect(nova?.estaCapturando).toBe(true);
    expect(document.querySelectorAll('copiloto-gravador')).toHaveLength(1);
    expect(document.documentElement.getAttribute(MARCA_EXTENSAO)).toBe('0.2.0');
    nova?.desligar();
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

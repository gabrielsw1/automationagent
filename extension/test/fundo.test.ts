// Fundo da extensão (service worker): gravação por aba guardada no storage.session, envio em lotes
// pela ApiGravacao do widget, permissão de servidor, concluir, cancelar, aba fechada e "Gravar esta aba".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoGravado } from '@copiloto/shared';
import { Gravacoes, TEXTOS } from '../src/fundo/gravacoes.ts';
import type { EstadoAba, Resultado } from '../src/comum/mensagens.ts';
import { URL_EXTENSAO, instalarChrome } from './chrome-falso.ts';

const API = 'http://localhost:3000';
const TOKEN = 'grv_abc';

interface Servidor {
  eventos: EventoGravado[];
  lotes: number[];
  concluida: boolean;
  cancelada: boolean;
  ativa: boolean;
  /** Sem rede: todo fetch falha. */
  foraDoAr: boolean;
  urls: string[];
}

/** Copiloto de mentira para as rotas /api/gravacao/:token e /api/saude. */
function servidorFalso(): Servidor {
  const s: Servidor = { eventos: [], lotes: [], concluida: false, cancelada: false, ativa: true, foraDoAr: false, urls: [] };
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      s.urls.push(String(url));
      if (s.foraDoAr) throw new TypeError('Failed to fetch');
      const u = new URL(url);
      const metodo = init?.method ?? 'GET';
      if (u.pathname === '/api/saude') return json({ ok: true, sistema: 'Horizonte', urlConsole: 'http://localhost:5173/' });
      const m = u.pathname.match(/^\/api\/gravacao\/([^/]+)(\/\w+)?$/);
      if (!m || decodeURIComponent(m[1]) !== TOKEN) return json({ erro: 'nao_encontrado', mensagem: 'Gravação não encontrada.' }, 404);
      if (!m[2] && metodo === 'GET') return json({ fluxoId: 'flu-1', nome: 'Abrir chamado', ativa: s.ativa, passos: s.eventos.length });
      if (!s.ativa) return json({ erro: 'gravacao_encerrada', mensagem: 'Esta gravação já foi encerrada.' }, 409);
      if (m[2] === '/eventos') {
        const { eventos } = JSON.parse(String(init?.body)) as { eventos: EventoGravado[] };
        s.lotes.push(eventos.length);
        s.eventos.push(...eventos);
        return json({ passos: s.eventos.length });
      }
      if (m[2] === '/concluir') {
        s.concluida = true;
        s.ativa = false;
        return json({ ok: true, fluxoId: 'flu-1' });
      }
      if (m[2] === '/cancelar') {
        s.cancelada = true;
        s.ativa = false;
        return json({ ok: true });
      }
      return json({ erro: 'nao_encontrado', mensagem: 'Rota?' }, 404);
    }),
  );
  return s;
}

const ev = (tipo: EventoGravado['tipo'], url = 'http://localhost:4000/chamados', extra: Partial<EventoGravado> = {}): EventoGravado => ({
  tipo,
  ts: Date.now(),
  url,
  ...extra,
});
const daPagina = (abaId: number) => ({ tab: { id: abaId }, url: 'http://localhost:4000/chamados' });

let ch: ReturnType<typeof instalarChrome>;
let srv: Servidor;
beforeEach(() => {
  ch = instalarChrome();
  srv = servidorFalso();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fundo · começar', () => {
  it('guarda a gravação da aba e traz o nome do fluxo do servidor', async () => {
    const g = new Gravacoes();
    const estado = (await g.tratar({ tipo: 'comecar', token: TOKEN, api: `${API}/` }, daPagina(7))) as EstadoAba;
    expect(estado).toEqual({ situacao: 'gravando', nome: 'Abrir chamado', passos: 0, api: API, aviso: null });
    expect(Object.keys(ch.chrome.storage.session.dados)).toEqual(['aba:7']);
    // Outra página da mesma aba (ou de outro site) pergunta o estado: a gravação continua.
    expect(await g.tratar({ tipo: 'estado' }, { tab: { id: 7 }, url: 'https://outro.site.com.br/' })).toMatchObject({ situacao: 'gravando' });
    expect(await g.tratar({ tipo: 'estado' }, daPagina(8))).toBeNull();
    // O mesmo token de novo (recarregar a página com ele) não recomeça.
    expect(srv.urls.filter((u) => u.endsWith(`/api/gravacao/${TOKEN}`))).toHaveLength(1);
    await g.comecar(7, TOKEN, API);
    expect(srv.urls.filter((u) => u.endsWith(`/api/gravacao/${TOKEN}`))).toHaveLength(1);
  });

  it('sem copiloto_api na URL, usa o servidor das opções', async () => {
    await ch.chrome.storage.local.set({ servidor: 'http://127.0.0.1:3601' });
    const g = new Gravacoes();
    const estado = await g.comecar(1, TOKEN, null);
    expect(estado.api).toBe('http://127.0.0.1:3601');
    expect(srv.urls[0]).toBe(`http://127.0.0.1:3601/api/gravacao/${TOKEN}`);
  });

  it('gravação já encerrada no console: avisa e esquece a aba', async () => {
    srv.ativa = false;
    const estado = await new Gravacoes().comecar(3, TOKEN, API);
    expect(estado.situacao).toBe('encerrada');
    expect(ch.chrome.storage.session.dados).toEqual({});
    const token404 = await new Gravacoes().comecar(3, 'outro', API);
    expect(token404).toMatchObject({ situacao: 'encerrada', aviso: TEXTOS.naoEncontrada });
  });

  it('servidor fora do ar: continua gravando e avisa', async () => {
    srv.foraDoAr = true;
    const estado = await new Gravacoes().comecar(3, TOKEN, API);
    expect(estado).toMatchObject({ situacao: 'gravando', aviso: TEXTOS.semConexao(API) });
  });

  it('servidor sem permissão: guarda os passos até liberar nas opções', async () => {
    const api = 'https://copiloto.empresa.com.br';
    const g = new Gravacoes({ esperaMs: 0 });
    const estado = await g.comecar(5, TOKEN, api);
    expect(estado).toMatchObject({ situacao: 'sem_permissao', aviso: TEXTOS.semPermissao(api) });
    expect(srv.urls).toEqual([]);
    await g.adicionar(5, [ev('navegar'), ev('clique')]);
    expect(await g.estado(5)).toMatchObject({ passos: 2, situacao: 'sem_permissao' });
    expect(await g.concluir(5)).toEqual({ ok: false, semPermissao: true, mensagem: TEXTOS.semPermissao(api) });

    // O botão da barra abre as opções pedindo esse servidor.
    await g.tratar({ tipo: 'permitir' }, daPagina(5));
    expect(ch.chrome.tabs.create).toHaveBeenCalledWith({ url: `${URL_EXTENSAO}opcoes.html?permitir=${encodeURIComponent(api)}` });

    // Liberado: volta a gravar e manda o que estava guardado.
    ch.permitidos.add('https://copiloto.empresa.com.br/*');
    await g.permissoesMudaram();
    await vi.waitFor(() => expect(srv.eventos).toHaveLength(2));
    expect(await g.estado(5)).toMatchObject({ situacao: 'gravando', passos: 2, aviso: null, nome: 'Abrir chamado' });
  });
});

describe('fundo · eventos', () => {
  it('junta eventos próximos num envio e não repete a mesma página', async () => {
    vi.useFakeTimers();
    const g = new Gravacoes({ esperaMs: 800 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('navegar')]);
    await g.adicionar(2, [ev('navegar')]); // recarregou a mesma página
    const r = await g.adicionar(2, [ev('preencher', undefined, { formatoValor: 'aaaa', elemento: { tag: 'input', css: '#assunto' } })]);
    expect(r).toEqual({ passos: 2 });
    expect(srv.eventos).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(srv.lotes).toEqual([2]);
    expect(srv.eventos.map((e) => e.tipo)).toEqual(['navegar', 'preencher']);
    expect(await g.estado(2)).toMatchObject({ passos: 2 });
  });

  it('manda em lotes de até 10 (o keepalive limita o corpo)', async () => {
    const g = new Gravacoes({ esperaMs: 60_000, tamanhoLote: 10 });
    await g.comecar(2, TOKEN, API);
    const muitos = Array.from({ length: 23 }, (_, i) => ev('clique', `http://localhost:4000/p${i}`));
    await g.adicionar(2, muitos);
    await g.descarregar(2);
    expect(srv.lotes).toEqual([10, 10, 3]);
    expect(await g.estado(2)).toMatchObject({ passos: 23 });
  });

  it('ignora o que não é evento gravado', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    const r = await g.adicionar(2, [{ tipo: 'roubar', ts: 1, url: 'x' }, null, ev('clique')]);
    expect(r).toEqual({ passos: 1 });
    expect(await g.adicionar(99, [ev('clique')])).toBeNull();
  });

  it('sem rede, guarda e tenta de novo depois', async () => {
    vi.useFakeTimers();
    const g = new Gravacoes({ esperaMs: 100 });
    await g.comecar(2, TOKEN, API);
    srv.foraDoAr = true;
    await g.adicionar(2, [ev('clique')]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await g.estado(2)).toMatchObject({ passos: 1, aviso: TEXTOS.semConexao(API) });
    srv.foraDoAr = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.eventos).toHaveLength(1);
    expect(await g.estado(2)).toMatchObject({ passos: 1, aviso: null });
  });

  it('avisa a página e o popup a cada mudança', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(4, TOKEN, API);
    await g.adicionar(4, [ev('clique')]);
    const aviso = { tipo: 'estadoAba', abaId: 4, estado: expect.objectContaining({ passos: 1 }) };
    expect(ch.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(4, aviso);
    expect(ch.chrome.runtime.sendMessage).toHaveBeenLastCalledWith(aviso);
  });
});

describe('fundo · concluir, cancelar e aba fechada', () => {
  it('Concluir manda o que falta e encerra', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('navegar'), ev('clique')]);
    // Do popup: a aba vem no pedido; o remetente é a própria extensão.
    const r = (await g.tratar({ tipo: 'concluir', abaId: 2 }, { url: `${URL_EXTENSAO}popup.html` })) as Resultado;
    expect(r).toEqual({ ok: true });
    expect(srv.eventos).toHaveLength(2);
    expect(srv.concluida).toBe(true);
    expect(ch.chrome.storage.session.dados).toEqual({});
    expect(ch.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(2, {
      tipo: 'estadoAba',
      abaId: 2,
      estado: expect.objectContaining({ situacao: 'concluida', aviso: TEXTOS.concluida }),
    });
    expect(await g.concluir(2)).toEqual({ ok: false, final: true, mensagem: TEXTOS.encerrada });
  });

  it('o popup não manda na aba de outro pelo remetente; a página não escolhe a aba', async () => {
    const g = new Gravacoes();
    await g.comecar(2, TOKEN, API);
    // Uma página tentando concluir a aba 2 pelo abaId: vale a aba de quem mandou (a 9, sem gravação).
    expect(await g.tratar({ tipo: 'concluir', abaId: 2 }, daPagina(9))).toEqual({ ok: false, final: true, mensagem: TEXTOS.encerrada });
    expect(srv.concluida).toBe(false);
  });

  it('Concluir sem conexão: a gravação continua para tentar de novo', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    srv.foraDoAr = true;
    const r = await g.concluir(2);
    expect(r.ok).toBe(false);
    expect(await g.estado(2)).toMatchObject({ situacao: 'gravando' });
  });

  it('encerrada no console no meio: o Concluir diz que acabou', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('clique')]);
    srv.ativa = false;
    expect(await g.concluir(2)).toEqual({ ok: false, final: true, mensagem: 'Esta gravação já foi encerrada.' });
    expect(await g.estado(2)).toBeNull();
  });

  it('Cancelar descarta no servidor e esquece a aba', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('clique')]);
    expect(await g.cancelar(2)).toEqual({ ok: true });
    expect(srv.cancelada).toBe(true);
    expect(srv.eventos).toHaveLength(0);
    expect(await g.estado(2)).toBeNull();
  });

  it('aba fechada: manda o que faltava e esquece a aba', async () => {
    const g = new Gravacoes({ esperaMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('clique')]);
    await g.abaFechada(2);
    expect(srv.eventos).toHaveLength(1);
    expect(srv.concluida).toBe(false);
    expect(await g.estado(2)).toBeNull();
  });

  it('service worker acordou: retoma o que ficou pendente', async () => {
    await new Gravacoes({ esperaMs: 60_000 }).comecar(2, TOKEN, API).then(async () => {
      const antigo = new Gravacoes({ esperaMs: 60_000 });
      await antigo.adicionar(2, [ev('clique'), ev('clique', 'http://localhost:4000/b')]);
    });
    expect(srv.eventos).toHaveLength(0);
    await new Gravacoes().retomar();
    await vi.waitFor(() => expect(srv.eventos).toHaveLength(2));
  });
});

describe('fundo · servidor e console', () => {
  it('saúde traz o sistema e o endereço do console', async () => {
    const g = new Gravacoes();
    expect(await g.saude()).toEqual({ ok: true, servidor: API, sistema: 'Horizonte', urlConsole: 'http://localhost:5173' });
    srv.foraDoAr = true;
    expect(await g.saude('http://localhost:3601/x')).toMatchObject({ ok: false, servidor: 'http://localhost:3601', mensagem: expect.stringMatching(/Confira se ele está no ar/) });
    expect(await g.saude('https://copiloto.empresa.com.br')).toMatchObject({ ok: false, semPermissao: true });
  });

  it('"Gravar esta aba" abre o Aprender fluxo com o endereço sem o token', async () => {
    const g = new Gravacoes();
    const url = 'http://localhost:4000/chamados?copiloto_gravacao=velho&aba=2';
    expect(await g.tratar({ tipo: 'gravarAba', url }, { url: `${URL_EXTENSAO}popup.html` })).toEqual({ ok: true });
    expect(ch.chrome.tabs.create).toHaveBeenCalledWith({
      url: `http://localhost:5173/aprender?gravar=${encodeURIComponent('http://localhost:4000/chamados?aba=2')}`,
    });
    expect(await g.gravarAba('chrome://extensions')).toMatchObject({ ok: false });
  });
});

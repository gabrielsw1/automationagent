// Fundo da extensão (service worker): gravação por aba guardada no storage.session, envio em lotes
// pela ApiGravacao do widget, permissão de servidor, concluir, cancelar, aba fechada e "Gravar esta aba".
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONTE_CONSOLE, FONTE_EXTENSAO, type EventoGravado, type MensagemDoConsole, type SessaoExtensao } from '@copiloto/shared';
import { Gravacoes, TEXTOS } from '../src/fundo/gravacoes.ts';
import { TEXTOS_CONTA } from '../src/fundo/conta.ts';
import type { EstadoAba, EstadoConta, Recentes, Resultado } from '../src/comum/mensagens.ts';
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
  /** Rotas da extensão (/api/extensao): token válido, pedidos de troca e saídas. */
  token: string | null;
  trocas: Array<{ codigo: string; verificador: string; navegador?: string }>;
  saidas: string[];
  autorizacoes: string[];
  sessao: SessaoExtensao;
}

const SESSAO: SessaoExtensao = {
  pessoa: { nome: 'Rafael Lima', email: 'rafael@horizonte.com.br', iniciais: 'RL' },
  empresa: { id: 'emp-h', nome: 'Horizonte Gestão', demo: false, iniciais: 'HG' },
  perfil: 'editor',
  podeGravar: true,
  empresas: [{ id: 'emp-h', nome: 'Horizonte Gestão', demo: false, iniciais: 'HG', perfil: 'editor' }],
  urlConsole: 'http://localhost:5173',
};

/** Copiloto de mentira para as rotas /api/gravacao/:token e /api/saude. */
function servidorFalso(): Servidor {
  const s: Servidor = {
    eventos: [],
    lotes: [],
    concluida: false,
    cancelada: false,
    ativa: true,
    foraDoAr: false,
    urls: [],
    token: null,
    trocas: [],
    saidas: [],
    autorizacoes: [],
    sessao: SESSAO,
  };
  const itens = () => s.eventos.map((e, i) => `Passo ${i + 1} (${e.tipo})`);
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      s.urls.push(String(url));
      if (s.foraDoAr) throw new TypeError('Failed to fetch');
      const u = new URL(url);
      const metodo = init?.method ?? 'GET';
      if (u.pathname === '/api/saude') return json({ ok: true, sistema: 'Horizonte', urlConsole: 'http://localhost:5173/' });
      if (u.pathname.startsWith('/api/extensao/')) {
        const rota = u.pathname.slice('/api/extensao/'.length);
        const autorizacao = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
        s.autorizacoes.push(autorizacao);
        if (rota === 'trocar') {
          const corpo = JSON.parse(String(init?.body)) as Servidor['trocas'][number];
          s.trocas.push(corpo);
          if (corpo.codigo !== 'cod-ok') return json({ erro: 'codigo_invalido', mensagem: 'Este pedido de entrada venceu ou já foi usado.' }, 400);
          s.token = `cpx_${s.trocas.length}`;
          return json({ token: s.token, sessao: s.sessao });
        }
        if (rota === 'sair') {
          s.saidas.push(autorizacao);
          if (autorizacao === `Bearer ${s.token}`) s.token = null;
          return json({ ok: true });
        }
        if (!s.token || autorizacao !== `Bearer ${s.token}`) {
          return json({ erro: 'extensao_desconectada', mensagem: 'A extensão saiu da sua conta. Entre de novo para gravar.' }, 401);
        }
        if (rota === 'sessao') return json(s.sessao);
        if (rota === 'gravacoes') {
          return json({
            gravacoes: [{ fluxoId: 'flu-1', nome: 'Abrir chamado', situacao: 'enviada', passos: 6, em: new Date().toISOString(), url: 'http://localhost:5173/aprender/flu-1' }],
          });
        }
        return json({ erro: 'nao_encontrado', mensagem: 'Rota?' }, 404);
      }
      const m = u.pathname.match(/^\/api\/gravacao\/([^/]+)(\/\w+)?$/);
      if (!m || decodeURIComponent(m[1]) !== TOKEN) return json({ erro: 'nao_encontrado', mensagem: 'Gravação não encontrada.' }, 404);
      if (!m[2] && metodo === 'GET') {
        return json({ fluxoId: 'flu-1', nome: 'Abrir chamado', ativa: s.ativa, passos: s.eventos.length, empresa: 'Horizonte Gestão', pessoa: 'Rafael Lima', itens: itens() });
      }
      if (!s.ativa) return json({ erro: 'gravacao_encerrada', mensagem: 'Esta gravação já foi encerrada.' }, 409);
      if (m[2] === '/eventos') {
        const { eventos } = JSON.parse(String(init?.body)) as { eventos: EventoGravado[] };
        s.lotes.push(eventos.length);
        s.eventos.push(...eventos);
        return json({ passos: s.eventos.length, itens: itens() });
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
    expect(estado).toEqual({
      situacao: 'gravando',
      nome: 'Abrir chamado',
      passos: 0,
      api: API,
      aviso: null,
      fluxoId: 'flu-1',
      itens: [],
      pendentes: 0,
      empresa: 'Horizonte Gestão',
      pessoa: 'Rafael Lima',
    });
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
    // O painel "Passos gravados" recebe os títulos que o servidor devolve.
    expect(await g.estado(2)).toMatchObject({ passos: 2, pendentes: 0, itens: ['Passo 1 (navegar)', 'Passo 2 (preencher)'] });
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

  it('Concluir sem conexão: a captura para, os passos ficam guardados e saem quando a conexão volta', async () => {
    vi.useFakeTimers();
    const g = new Gravacoes({ esperaMs: 60_000, esperaConexaoMs: 1000 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('navegar'), ev('clique')]);
    srv.foraDoAr = true;
    const r = await g.concluir(2);
    expect(r).toEqual({ ok: false, semConexao: true, mensagem: TEXTOS.esperandoConexao(2) });
    expect(TEXTOS.esperandoConexao(2)).toBe('Sem conexão agora. Os 2 passos estão guardados e serão enviados quando a internet voltar.');
    expect(await g.estado(2)).toMatchObject({ situacao: 'sem_conexao', passos: 2, pendentes: 2 });
    // Fechar a aba não perde a conclusão.
    await g.abaFechada(2);
    expect(await g.estado(2)).toMatchObject({ situacao: 'sem_conexao' });
    // Primeira tentativa (1 s) ainda sem rede; a segunda (2 s depois) conclui.
    await vi.advanceTimersByTimeAsync(1000);
    expect(srv.concluida).toBe(false);
    srv.foraDoAr = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.eventos).toHaveLength(2);
    expect(srv.concluida).toBe(true);
    expect(await g.estado(2)).toBeNull();
    expect(ch.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(2, {
      tipo: 'estadoAba',
      abaId: 2,
      estado: expect.objectContaining({ situacao: 'concluida', passos: 2 }),
    });
  });

  it('"Tentar agora" conclui sem esperar o relógio', async () => {
    vi.useFakeTimers();
    const g = new Gravacoes({ esperaMs: 60_000, esperaConexaoMs: 60_000 });
    await g.comecar(2, TOKEN, API);
    await g.adicionar(2, [ev('clique')]);
    srv.foraDoAr = true;
    expect(await g.concluir(2)).toMatchObject({ semConexao: true });
    expect(await g.tratar({ tipo: 'tentarAgora', abaId: 2 }, { url: `${URL_EXTENSAO}popup.html` })).toMatchObject({ ok: false, semConexao: true });
    srv.foraDoAr = false;
    expect(await g.tratar({ tipo: 'tentarAgora' }, daPagina(2))).toEqual({ ok: true });
    expect(srv.concluida).toBe(true);
    expect(await g.estado(2)).toBeNull();
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

  it('"Abrir no console" abre o fluxo enviado', async () => {
    const g = new Gravacoes();
    expect(await g.tratar({ tipo: 'abrirConsole', fluxoId: 'flu-1', api: API }, { url: `${URL_EXTENSAO}popup.html` })).toEqual({ ok: true });
    expect(ch.chrome.tabs.create).toHaveBeenCalledWith({ url: 'http://localhost:5173/aprender/flu-1' });
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

// ---------- Conta da extensão (entrada pelo console) ----------

const POPUP = { url: `${URL_EXTENSAO}popup.html` };
/** A aba do console (content script no quadro principal). */
const doConsole = (origem = 'http://localhost:5173') => ({ tab: { id: 50, url: `${origem}/extensao/conectar` }, url: `${origem}/extensao/conectar`, origin: origem, frameId: 0 });
const msg = (m: Omit<MensagemDoConsole, 'fonte'> & Record<string, unknown>) => ({ fonte: FONTE_CONSOLE, ...m }) as MensagemDoConsole;

/** "Entrar com a conta do Copiloto": devolve o estado e o desafio da URL aberta no console. */
async function entrar(g: Gravacoes, empresaId?: string) {
  expect(await g.tratar(empresaId ? { tipo: 'entrar', empresaId } : { tipo: 'entrar' }, POPUP)).toEqual({ ok: true });
  const url = new URL((ch.chrome.tabs.create.mock.calls.at(-1)![0] as { url: string }).url);
  return { url, estado: url.searchParams.get('estado')!, desafio: url.searchParams.get('desafio')! };
}

describe('fundo · conta da extensão', () => {
  it('entrar abre o console com estado e desafio; o verificador fica só no fundo', async () => {
    const g = new Gravacoes();
    const { url, estado, desafio } = await entrar(g, 'emp-h');
    expect(`${url.origin}${url.pathname}`).toBe('http://localhost:5173/extensao/conectar');
    expect(url.searchParams.get('empresa')).toBe('emp-h');
    expect(estado).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(desafio).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const entrada = ch.chrome.storage.session.dados.entrada as { verificador: string; estado: string };
    expect(entrada.estado).toBe(estado);
    expect(url.toString()).not.toContain(entrada.verificador);
    expect(createHash('sha256').update(entrada.verificador).digest('base64url')).toBe(desafio);
  });

  it('a página do console entrega o código: troca pelo token, guarda e avisa o popup', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    const verificador = (ch.chrome.storage.session.dados.entrada as { verificador: string }).verificador;
    const r = await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'p1', estado, codigo: 'cod-ok' }) }, doConsole());
    expect(r).toEqual({
      fonte: FONTE_EXTENSAO,
      tipo: 'extensao:conectada',
      id: 'p1',
      ok: true,
      conexao: { empresa: { id: 'emp-h', nome: 'Horizonte Gestão' }, pessoa: { nome: 'Rafael Lima', email: 'rafael@horizonte.com.br' } },
    });
    expect(srv.trocas).toEqual([{ codigo: 'cod-ok', verificador, navegador: 'Chrome' }]);
    expect(ch.chrome.storage.local.dados.conta).toMatchObject({ token: 'cpx_1', servidor: API });
    expect(ch.chrome.storage.session.dados.entrada).toBeUndefined();
    expect(ch.chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ tipo: 'contaMudou' });
    // O popup recebe a conta, nunca o token.
    const conta = (await g.tratar({ tipo: 'conta' }, POPUP)) as EstadoConta;
    expect(conta).toEqual({ conectada: true, sessao: SESSAO });
    expect(JSON.stringify(conta)).not.toContain('cpx_');
    expect(srv.autorizacoes.at(-1)).toBe('Bearer cpx_1');
    // A mesma entrada não vale duas vezes.
    expect(await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'p2', estado, codigo: 'cod-ok' }) }, doConsole())).toMatchObject({
      ok: false,
      mensagem: TEXTOS_CONTA.entradaVencida,
    });
  });

  it('código só vale da aba do console configurado, no quadro principal e com o estado certo', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    const conectar = (mensagem: MensagemDoConsole, remetente: chrome.runtime.MessageSender) => g.tratar({ tipo: 'console', mensagem }, remetente);
    const certo = msg({ tipo: 'extensao:conectar', id: 'x', estado, codigo: 'cod-ok' });
    // Outro site (mesmo com a mensagem certa): recusado, sem gastar a entrada.
    expect(await conectar(certo, doConsole('https://site-malicioso.com'))).toMatchObject({ ok: false, mensagem: TEXTOS_CONTA.outraAba });
    // Um iframe dentro do console: recusado.
    expect(await conectar(certo, { ...doConsole(), frameId: 3 })).toMatchObject({ ok: false, mensagem: TEXTOS_CONTA.outraAba });
    // Estado errado: recusado.
    expect(await conectar(msg({ tipo: 'extensao:conectar', id: 'x', estado: 'outro', codigo: 'cod-ok' }), doConsole())).toMatchObject({ ok: false });
    // Das páginas da extensão (popup) o pedido "console" não vale.
    expect(await g.tratar({ tipo: 'console', mensagem: certo }, POPUP)).toBeNull();
    // Mensagem fora do formato: ignorada.
    expect(await g.tratar({ tipo: 'console', mensagem: { fonte: 'outra', tipo: 'extensao:conectar' } as never }, doConsole())).toBeNull();
    expect(srv.trocas).toEqual([]);
    // A entrada continua de pé para a aba certa.
    expect(await conectar(certo, doConsole())).toMatchObject({ ok: true });
  });

  it('página comum pergunta pela extensão: versão sim, conta não', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado, codigo: 'cod-ok' }) }, doConsole());
    const pergunta = msg({ tipo: 'extensao:estado', id: 'e1' });
    expect(await g.tratar({ tipo: 'console', mensagem: pergunta }, doConsole('https://loja.qualquer.com'))).toEqual({
      fonte: FONTE_EXTENSAO,
      tipo: 'extensao:estado',
      id: 'e1',
      versao: '0.1.0',
      consoleConfigurado: false,
      conexao: null,
    });
    expect(await g.tratar({ tipo: 'console', mensagem: pergunta }, doConsole())).toMatchObject({
      consoleConfigurado: true,
      conexao: { empresa: { nome: 'Horizonte Gestão' } },
    });
  });

  it('a página e o console não mexem na conta pelos pedidos do popup', async () => {
    const g = new Gravacoes();
    for (const pedido of [{ tipo: 'entrar' }, { tipo: 'sair' }, { tipo: 'conta' }, { tipo: 'recentes' }, { tipo: 'gravarAba', url: 'http://localhost:4000/' }] as const) {
      expect(await g.tratar(pedido, doConsole())).toBeNull();
    }
    expect(ch.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('Sair cancela o token no servidor e apaga a conta', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado, codigo: 'cod-ok' }) }, doConsole());
    expect(await g.tratar({ tipo: 'sair' }, POPUP)).toEqual({ ok: true });
    expect(srv.saidas).toEqual(['Bearer cpx_1']);
    expect(ch.chrome.storage.local.dados.conta).toBeUndefined();
    expect(await g.tratar({ tipo: 'conta' }, POPUP)).toEqual({ conectada: false });
  });

  it('token cancelado no servidor (pessoa saiu da empresa): a conta some com o aviso', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado, codigo: 'cod-ok' }) }, doConsole());
    srv.token = null;
    expect(await g.tratar({ tipo: 'conta' }, POPUP)).toEqual({ conectada: false, aviso: 'A extensão saiu da sua conta. Entre de novo para gravar.' });
    expect(ch.chrome.storage.local.dados.conta).toBeUndefined();
  });

  it('sem conexão: mostra a conta guardada; servidor trocado nas opções: sai', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado, codigo: 'cod-ok' }) }, doConsole());
    srv.foraDoAr = true;
    expect(await g.tratar({ tipo: 'conta' }, POPUP)).toEqual({ conectada: true, sessao: SESSAO, offline: true });
    srv.foraDoAr = false;
    await ch.chrome.storage.local.set({ servidor: 'http://127.0.0.1:3601' });
    expect(await g.tratar({ tipo: 'conta' }, POPUP)).toEqual({ conectada: false, aviso: TEXTOS_CONTA.servidorMudou });
  });

  it('gravações recentes e "Gravar esta aba" na empresa da conta', async () => {
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado, codigo: 'cod-ok' }) }, doConsole());
    const r = (await g.tratar({ tipo: 'recentes' }, POPUP)) as Recentes;
    expect(r).toMatchObject({ ok: true, gravacoes: [{ nome: 'Abrir chamado', situacao: 'enviada' }] });
    await g.tratar({ tipo: 'gravarAba', url: 'http://localhost:4000/chamados' }, POPUP);
    expect(ch.chrome.tabs.create).toHaveBeenLastCalledWith({
      url: `http://localhost:5173/aprender?gravar=${encodeURIComponent('http://localhost:4000/chamados')}&empresa=emp-h`,
    });
  });

  it('perfil sem permissão de gravar: "Gravar esta aba" explica', async () => {
    srv.sessao = { ...SESSAO, perfil: 'leitor', podeGravar: false, empresas: [] };
    const g = new Gravacoes();
    const { estado } = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado, codigo: 'cod-ok' }) }, doConsole());
    expect(await g.tratar({ tipo: 'gravarAba', url: 'http://localhost:4000/chamados' }, POPUP)).toEqual({
      ok: false,
      mensagem: 'Seu perfil na Horizonte Gestão não permite gravar fluxos.',
    });
  });

  it('trocar de empresa: o token anterior é cancelado', async () => {
    const g = new Gravacoes();
    let e = await entrar(g);
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado: e.estado, codigo: 'cod-ok' }) }, doConsole());
    e = await entrar(g, 'emp-v');
    await g.tratar({ tipo: 'console', mensagem: msg({ tipo: 'extensao:conectar', id: 'c', estado: e.estado, codigo: 'cod-ok' }) }, doConsole());
    expect(ch.chrome.storage.local.dados.conta).toMatchObject({ token: 'cpx_2' });
    await vi.waitFor(() => expect(srv.saidas).toEqual(['Bearer cpx_1']));
  });
});

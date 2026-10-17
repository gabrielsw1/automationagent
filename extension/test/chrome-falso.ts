// chrome.* de mentira para os testes de unidade: só o que a extensão usa (runtime, storage, tabs e
// permissions), guardado em memória. As mensagens vão para o "fundo" que o teste ligar com aoMensagem.
import { vi } from 'vitest';

type Ouvinte = (mensagem: unknown, remetente: chrome.runtime.MessageSender, responder: (r?: unknown) => void) => unknown;

function area(): chrome.storage.Area & { dados: Record<string, unknown> } {
  const dados: Record<string, unknown> = {};
  const copia = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    dados,
    async get(chaves) {
      if (chaves === null || chaves === undefined) return copia({ ...dados });
      const lista = typeof chaves === 'string' ? [chaves] : chaves;
      return Object.fromEntries(lista.filter((k) => k in dados).map((k) => [k, copia(dados[k])]));
    },
    async set(itens) {
      for (const [k, v] of Object.entries(itens)) dados[k] = copia(v);
    },
    async remove(chaves) {
      for (const k of typeof chaves === 'string' ? [chaves] : chaves) delete dados[k];
    },
  };
}

export interface OpcoesChrome {
  /** Padrões de permissão já liberados (o manifesto libera localhost e 127.0.0.1). */
  permitidos?: string[];
  /** Resposta do chrome.permissions.request. */
  aceitarPedido?: boolean;
  abas?: chrome.tabs.Tab[];
}

export const URL_EXTENSAO = 'chrome-extension://copiloto-teste/';

export function instalarChrome(opcoes: OpcoesChrome = {}) {
  const ouvintes: Ouvinte[] = [];
  const permitidos = new Set(opcoes.permitidos ?? ['http://localhost/*', 'http://127.0.0.1/*']);
  const abas = [...(opcoes.abas ?? [])];
  let fundo: ((pedido: unknown, remetente: chrome.runtime.MessageSender) => unknown) | null = null;
  const removidas: Array<(abaId: number) => void> = [];
  const adicionadas: Array<(p: chrome.permissions.Permissoes) => void> = [];

  const falso = {
    runtime: {
      id: 'copiloto-teste',
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (caminho: string) => `${URL_EXTENSAO}${caminho.replace(/^\//, '')}`,
      openOptionsPage: vi.fn(async () => {}),
      /** Da página (ou do popup) para o fundo. */
      sendMessage: vi.fn(async (mensagem: unknown) => (fundo ? fundo(mensagem, { url: URL_EXTENSAO }) : undefined)),
      onMessage: {
        addListener: (fn: Ouvinte) => void ouvintes.push(fn),
        removeListener: (fn: Ouvinte) => {
          const i = ouvintes.indexOf(fn);
          if (i >= 0) ouvintes.splice(i, 1);
        },
      },
    },
    storage: { session: area(), local: area(), onChanged: { addListener: () => {} } },
    tabs: {
      query: vi.fn(async () => abas.filter((a) => a.active)),
      get: vi.fn(async (id: number) => {
        const a = abas.find((x) => x.id === id);
        if (!a) throw new Error(`No tab with id: ${id}.`);
        return a;
      }),
      create: vi.fn(async (p: { url: string }) => ({ id: 900 + abas.length, url: p.url })),
      sendMessage: vi.fn(async () => undefined),
      onRemoved: { addListener: (fn: (abaId: number) => void) => void removidas.push(fn) },
    },
    permissions: {
      contains: vi.fn(async (p: chrome.permissions.Permissoes) => (p.origins ?? []).every((o) => permitidos.has(o))),
      request: vi.fn(async (p: chrome.permissions.Permissoes) => {
        if (!opcoes.aceitarPedido) return false;
        for (const o of p.origins ?? []) permitidos.add(o);
        for (const fn of adicionadas) fn(p);
        return true;
      }),
      onAdded: { addListener: (fn: (p: chrome.permissions.Permissoes) => void) => void adicionadas.push(fn) },
    },
  };
  vi.stubGlobal('chrome', falso);

  return {
    chrome: falso,
    permitidos,
    /** Liga o chrome.runtime.sendMessage a um "fundo" (o remetente diz de onde veio). */
    aoMensagem(fn: (pedido: unknown, remetente: chrome.runtime.MessageSender) => unknown) {
      fundo = fn;
    },
    /** Entrega uma mensagem aos ouvintes de chrome.runtime.onMessage (o fundo avisando a página ou o popup). */
    avisar(mensagem: unknown) {
      for (const fn of [...ouvintes]) fn(mensagem, { id: 'copiloto-teste' }, () => {});
    },
    fecharAba(abaId: number) {
      for (const fn of removidas) fn(abaId);
    },
  };
}

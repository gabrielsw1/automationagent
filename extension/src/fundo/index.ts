// Service worker da extensão: guarda as gravações por aba e fala com o servidor do copiloto.
import type { Pedido } from '../comum/mensagens.ts';
import { Gravacoes } from './gravacoes.ts';

const gravacoes = new Gravacoes();

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  if (!mensagem || typeof mensagem !== 'object' || (mensagem as { tipo?: unknown }).tipo === 'estadoAba') return;
  gravacoes.tratar(mensagem as Pedido, remetente).then(responder, (e: unknown) =>
    responder({ ok: false, mensagem: e instanceof Error ? e.message : 'Algo deu errado na extensão.' }),
  );
  return true; // resposta assíncrona
});

chrome.tabs.onRemoved.addListener((abaId) => void gravacoes.abaFechada(abaId));
chrome.permissions.onAdded.addListener(() => void gravacoes.permissoesMudaram());

void gravacoes.retomar();

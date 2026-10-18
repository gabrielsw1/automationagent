// Service worker da extensão: guarda as gravações por aba, a conta da extensão e fala com o servidor do copiloto.
import type { Pedido } from '../comum/mensagens.ts';
import { Gravacoes } from './gravacoes.ts';
import { injetarNasAbasAbertas } from './instalar.ts';

const gravacoes = new Gravacoes();

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  if (!mensagem || typeof mensagem !== 'object') return;
  const tipo = (mensagem as { tipo?: unknown }).tipo;
  if (tipo === 'estadoAba' || tipo === 'contaMudou') return;
  gravacoes.tratar(mensagem as Pedido, remetente).then(responder, (e: unknown) =>
    responder({ ok: false, mensagem: e instanceof Error ? e.message : 'Algo deu errado na extensão.' }),
  );
  return true; // resposta assíncrona
});

chrome.tabs.onRemoved.addListener((abaId) => void gravacoes.abaFechada(abaId));
chrome.permissions.onAdded.addListener(() => void gravacoes.permissoesMudaram());
// Instalou ou atualizou: as abas já abertas (como a página "Instalar o gravador" do console) passam
// a ter a extensão sem recarregar.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install' || d.reason === 'update') void injetarNasAbasAbertas();
});

void gravacoes.retomar();

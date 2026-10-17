// Popup (estado da aba, Concluir, Cancelar, "Gravar esta aba") e opções ("Servidor do copiloto",
// permissão pedida no clique). Mais o manifesto e os ícones gerados na compilação.
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoAba, Pedido } from '../src/comum/mensagens.ts';
import { montarOpcoes } from '../src/paginas/opcoes.ts';
import { montarPopup } from '../src/paginas/popup.ts';
import { iconePng, lerCores } from '../build/icones.ts';
import { manifesto } from '../build/manifesto.ts';
import { instalarChrome } from './chrome-falso.ts';

const ABA = { id: 12, url: 'http://localhost:4000/chamados', active: true };
const gravando = (p: Partial<EstadoAba> = {}): EstadoAba => ({
  situacao: 'gravando',
  nome: 'Abrir chamado',
  passos: 3,
  api: 'http://localhost:3000',
  aviso: null,
  ...p,
});

let raiz: HTMLElement;
let pedidos: Pedido[];
const texto = () => raiz.textContent ?? '';
const botao = (nome: string) => [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim() === nome) as HTMLButtonElement | undefined;

beforeEach(() => {
  raiz = document.createElement('div');
  document.body.replaceChildren(raiz);
  pedidos = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('popup', () => {
  function chromeCom(respostas: Partial<Record<Pedido['tipo'], unknown>>, abas = [ABA]) {
    const ch = instalarChrome({ abas });
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return respostas[(p as Pedido).tipo];
    });
    return ch;
  }

  it('gravando: nome, passos ao vivo, Concluir', async () => {
    const ch = chromeCom({ estado: gravando(), concluir: { ok: true } });
    await montarPopup(raiz);
    expect(pedidos[0]).toEqual({ tipo: 'estado', abaId: 12 });
    expect(texto()).toContain('Gravando');
    expect(texto()).toContain('Abrir chamado');
    expect(texto()).toContain('3 passos até agora');
    expect(texto()).not.toContain('null');
    ch.avisar({ tipo: 'estadoAba', abaId: 12, estado: gravando({ passos: 4 }) });
    ch.avisar({ tipo: 'estadoAba', abaId: 99, estado: gravando({ passos: 40 }) });
    expect(texto()).toContain('4 passos até agora');
    botao('Concluir')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Gravação enviada. Volte ao console para revisar.'));
    expect(pedidos.at(-1)).toEqual({ tipo: 'concluir', abaId: 12 });
  });

  it('Cancelar pergunta antes de descartar', async () => {
    chromeCom({ estado: gravando({ passos: 1 }), cancelar: { ok: true } });
    await montarPopup(raiz);
    expect(texto()).toContain('1 passo até agora');
    botao('Cancelar')!.click();
    expect(texto()).toContain('Descartar a gravação?');
    botao('Continuar gravando')!.click();
    expect(botao('Concluir')).toBeTruthy();
    botao('Cancelar')!.click();
    botao('Descartar')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Gravação descartada. Nada foi salvo.'));
    expect(pedidos.at(-1)).toEqual({ tipo: 'cancelar', abaId: 12 });
  });

  it('erro ao concluir fica no popup, com a gravação de pé', async () => {
    chromeCom({ estado: gravando(), concluir: { ok: false, mensagem: 'Não consegui falar com o copiloto em http://localhost:3000.' } });
    await montarPopup(raiz);
    botao('Concluir')!.click();
    await vi.waitFor(() => expect(raiz.querySelector('[role=alert]')?.textContent).toContain('Não consegui falar'));
    expect(botao('Concluir')).toBeTruthy();
  });

  it('sem permissão: aviso com "Abrir as opções"', async () => {
    chromeCom({ estado: gravando({ situacao: 'sem_permissao', aviso: 'A extensão ainda não pode falar com o copiloto.' }), permitir: { ok: true } });
    await montarPopup(raiz);
    expect(texto()).toContain('ainda não pode falar');
    botao('Abrir as opções')!.click();
    expect(pedidos.at(-1)).toEqual({ tipo: 'permitir', abaId: 12 });
  });

  it('sem gravação: "Gravar esta aba" abre o console e fecha o popup', async () => {
    chromeCom({ estado: null, gravarAba: { ok: true } });
    const fechar = vi.fn();
    await montarPopup(raiz, { fechar });
    expect(texto()).toContain('Gravar um fluxo nesta aba');
    expect(texto()).toContain('Servidor: http://localhost:3000');
    expect(texto()).not.toContain('null');
    botao('Gravar esta aba')!.click();
    await vi.waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(pedidos.at(-1)).toEqual({ tipo: 'gravarAba', url: ABA.url });
  });

  it('"Gravar esta aba" com o copiloto fora do ar: diz o porquê', async () => {
    chromeCom({ estado: null, gravarAba: { ok: false, mensagem: 'Não consegui falar com o copiloto em http://localhost:3000.' } });
    await montarPopup(raiz, { fechar: vi.fn() });
    botao('Gravar esta aba')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Não consegui falar'));
    expect(botao('Gravar esta aba')!.disabled).toBe(false);
  });

  it('em página que não é do sistema (chrome://), não oferece gravar', async () => {
    chromeCom({ estado: null }, [{ id: 3, url: 'chrome://extensions/', active: true }]);
    await montarPopup(raiz);
    expect(botao('Gravar esta aba')!.disabled).toBe(true);
    expect(texto()).toContain('Abra uma página do sistema');
  });

  it('popup aberto numa aba escolhida (?aba=)', async () => {
    chromeCom({ estado: gravando() }, [ABA, { id: 30, url: 'https://portal.fornecedor.com.br/', active: false }]);
    await montarPopup(raiz, { abaId: 30 });
    expect(pedidos[0]).toEqual({ tipo: 'estado', abaId: 30 });
  });
});

describe('opções', () => {
  const campo = () => raiz.querySelector<HTMLInputElement>('#servidor')!;
  const salvar = () => raiz.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

  it('mostra o servidor padrão e salva outro depois da permissão', async () => {
    const ch = instalarChrome({ aceitarPedido: true });
    await montarOpcoes(raiz);
    expect(raiz.querySelector('label[for=servidor]')?.textContent).toBe('Servidor do copiloto');
    expect(campo().value).toBe('http://localhost:3000');
    campo().value = 'https://copiloto.empresa.com.br/painel';
    salvar();
    // O pedido sai no mesmo clique (o Chrome exige o gesto da pessoa).
    expect(ch.chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://copiloto.empresa.com.br/*'] });
    await vi.waitFor(() => expect(texto()).toContain('Servidor salvo: https://copiloto.empresa.com.br.'));
    expect(await ch.chrome.storage.local.get('servidor')).toEqual({ servidor: 'https://copiloto.empresa.com.br' });
  });

  it('permissão negada: não troca o servidor', async () => {
    const ch = instalarChrome({ aceitarPedido: false });
    await montarOpcoes(raiz);
    campo().value = 'https://copiloto.empresa.com.br';
    salvar();
    await vi.waitFor(() => expect(texto()).toContain('O servidor não foi trocado'));
    expect(ch.chrome.storage.local.dados).toEqual({});
  });

  it('endereço inválido', async () => {
    instalarChrome();
    await montarOpcoes(raiz);
    campo().value = 'copiloto';
    salvar();
    expect(texto()).toContain('Use um endereço completo');
  });

  it('Testar conexão', async () => {
    const ch = instalarChrome();
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return { ok: true, servidor: 'http://localhost:3000', sistema: 'Horizonte', urlConsole: 'http://localhost:5173' };
    });
    await montarOpcoes(raiz);
    botao('Testar conexão')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Conectado ao copiloto do Horizonte. O console fica em http://localhost:5173.'));
    expect(pedidos).toEqual([{ tipo: 'saude', servidor: 'http://localhost:3000' }]);
  });

  it('aberta pela barra (?permitir=): pede a liberação daquele servidor', async () => {
    const ch = instalarChrome({ aceitarPedido: true });
    await montarOpcoes(raiz, `?permitir=${encodeURIComponent('https://copiloto.empresa.com.br')}`);
    expect(texto()).toContain('Uma gravação precisa deste servidor');
    botao('Liberar https://copiloto.empresa.com.br')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Pronto. A gravação continua na aba do sistema'));
    expect(ch.permitidos.has('https://copiloto.empresa.com.br/*')).toBe(true);
  });
});

describe('manifesto e ícones', () => {
  it('manifesto MV3 com localhost liberado e o resto opcional', () => {
    const m = manifesto('1.2.3');
    expect(m.manifest_version).toBe(3);
    expect(m.version).toBe('1.2.3');
    expect(m.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect(m.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(m.content_scripts.map((c) => [c.js[0], c.run_at, c.world ?? 'ISOLATED'])).toEqual([
      ['pagina.js', 'document_start', 'MAIN'],
      ['conteudo.js', 'document_start', 'ISOLATED'],
    ]);
    expect(Object.keys(m.icons)).toEqual(['16', '32', '48', '128']);
  });

  it('ícone PNG na cor da marca de tokens.css, com o ponto branco no meio', () => {
    const tokens = fs.readFileSync(path.resolve(__dirname, '../../shared/styles/tokens.css'), 'utf8');
    const cores = lerCores(tokens);
    const png = iconePng(32, cores);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(32);
    // Pixels: pula a assinatura e o IHDR, descompacta o IDAT.
    const idat = png.indexOf('IDAT');
    const dados = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    const pixel = (x: number, y: number) => [...dados.subarray(y * (32 * 4 + 1) + 1 + x * 4, y * (32 * 4 + 1) + 1 + x * 4 + 4)];
    expect(pixel(16, 16)).toEqual([...cores.ponto, 255]);
    expect(pixel(6, 16)).toEqual([...cores.marca, 255]);
    expect(pixel(0, 0)[3]).toBe(0);
  });
});

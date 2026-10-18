// Popup (estado da aba, Concluir, Cancelar, "Gravar esta aba") e opções ("Servidor do copiloto",
// permissão pedida no clique). Mais o manifesto e os ícones gerados na compilação.
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GravacaoRecente, SessaoExtensao } from '@copiloto/shared';
import type { EstadoAba, Pedido } from '../src/comum/mensagens.ts';
import { montarOpcoes } from '../src/paginas/opcoes.ts';
import { montarPopup } from '../src/paginas/popup.ts';
import { iconePng, imagemLojaPng, lerCores, noS } from '../build/icones.ts';
import { criarZip } from '../build/zip.ts';
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

const SESSAO: SessaoExtensao = {
  pessoa: { nome: 'Rafael Lima', email: 'rafael@horizonte.com.br', iniciais: 'RL' },
  empresa: { id: 'emp-h', nome: 'Horizonte Gestão', demo: false, iniciais: 'HG' },
  perfil: 'editor',
  podeGravar: true,
  empresas: [
    { id: 'emp-h', nome: 'Horizonte Gestão', demo: false, iniciais: 'HG', perfil: 'editor' },
    { id: 'emp-v', nome: 'Vetor Logística', demo: false, iniciais: 'VL', perfil: 'admin' },
  ],
  urlConsole: 'http://localhost:5173',
};
const AGORA = new Date('2026-10-17T15:00:00Z');
const RECENTES: GravacaoRecente[] = [
  { fluxoId: 'f1', nome: 'Abrir chamado', situacao: 'enviada', passos: 6, em: '2026-10-17T14:58:00Z', url: 'http://localhost:5173/aprender/f1' },
  { fluxoId: 'f2', nome: 'Agendar visita técnica', situacao: 'publicada', passos: 9, em: '2026-10-16T10:00:00Z', url: 'http://localhost:5173/aprender/f2' },
  { fluxoId: 'f3', nome: 'Emitir boleto', situacao: 'em_revisao', passos: 4, em: '2026-10-17T12:00:00Z', url: 'http://localhost:5173/aprender/f3' },
];
const comConta = (sessao: SessaoExtensao = SESSAO) => ({ conectada: true, sessao });

describe('popup', () => {
  function chromeCom(respostas: Partial<Record<Pedido['tipo'], unknown>>, abas = [ABA]) {
    const ch = instalarChrome({ abas });
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      return respostas[(p as Pedido).tipo];
    });
    return ch;
  }
  const montar = (extra: Parameters<typeof montarPopup>[1] = {}) => montarPopup(raiz, { fechar: vi.fn(), agora: () => AGORA, ...extra });

  it('sem conta: "Entre para gravar fluxos" abre a entrada no console e fecha o popup', async () => {
    chromeCom({ estado: null, conta: { conectada: false }, entrar: { ok: true } });
    const fechar = vi.fn();
    await montar({ fechar });
    expect(raiz.querySelector('h1')?.textContent).toBe('Entre para gravar fluxos para a sua empresa');
    expect(texto()).toContain('Use o mesmo e-mail do console do Copiloto. Depois de entrar, você escolhe a empresa.');
    expect(texto()).toContain('Ainda não tem conta? Fale com o admin da sua empresa.');
    expect(botao('Opções')).toBeUndefined();
    botao('Entrar com a conta do Copiloto')!.click();
    await vi.waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(pedidos.at(-1)).toEqual({ tipo: 'entrar' });
  });

  it('sem conta, servidor fora do ar: diz o porquê e oferece as opções', async () => {
    chromeCom({ estado: null, conta: { conectada: false, aviso: 'A extensão saiu da sua conta. Entre de novo para gravar.' }, entrar: { ok: false, mensagem: 'Não consegui falar com o copiloto em http://localhost:3000.' } });
    await montar();
    expect(texto()).toContain('A extensão saiu da sua conta.');
    botao('Entrar com a conta do Copiloto')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Não consegui falar'));
    expect(botao('Abrir as opções')).toBeTruthy();
  });

  it('com conta: empresa, "Esta aba", gravações recentes com a situação de cada uma', async () => {
    chromeCom({ estado: null, conta: comConta(), recentes: { ok: true, gravacoes: RECENTES }, gravarAba: { ok: true } });
    const fechar = vi.fn();
    await montar({ fechar });
    await vi.waitFor(() => expect(texto()).toContain('Gravações recentes'));
    expect(raiz.querySelector('.pp-empresa')?.textContent).toBe('HGHorizonte Gestão · Rafael LimaTrocar');
    expect(raiz.querySelector('[aria-label="Trocar de empresa ou de conta"]')).toBeTruthy();
    expect(texto()).not.toContain('Dados de exemplo');
    expect(raiz.querySelector<HTMLInputElement>('#aba-atual')!.value).toBe(ABA.url);
    expect(raiz.querySelector('label[for=aba-atual]')?.textContent).toBe('Esta aba');
    const selos = [...raiz.querySelectorAll('.pp-recente')].map((a) => a.textContent);
    expect(selos).toEqual(['Abrir chamadoEnviada há 2 min', 'Agendar visita técnicaPublicada', 'Emitir boletoEm revisão']);
    expect(texto()).toContain('A enviada espera a sua revisão no console antes de virar tarefa.');
    expect(botao('Opções')).toBeTruthy();
    botao('Gravar esta aba')!.click();
    await vi.waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(pedidos.at(-1)).toEqual({ tipo: 'gravarAba', url: ABA.url });
  });

  it('empresa de demonstração: selo "Dados de exemplo"', async () => {
    chromeCom({ estado: null, conta: comConta({ ...SESSAO, empresa: { ...SESSAO.empresa, demo: true } }), recentes: { ok: true, gravacoes: [] } });
    await montar();
    expect(texto()).toContain('Dados de exemplo');
    await vi.waitFor(() => expect(texto()).toContain('Suas gravações aparecem aqui depois de enviadas.'));
  });

  it('"Gravar esta aba" com o copiloto fora do ar: diz o porquê', async () => {
    chromeCom({ estado: null, conta: comConta(), recentes: { ok: true, gravacoes: [] }, gravarAba: { ok: false, mensagem: 'Não consegui falar com o copiloto em http://localhost:3000.' } });
    await montar();
    botao('Gravar esta aba')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Não consegui falar'));
    expect(botao('Gravar esta aba')!.disabled).toBe(false);
  });

  it('em página que não é do sistema (chrome://), não oferece gravar', async () => {
    chromeCom({ estado: null, conta: comConta(), recentes: { ok: true, gravacoes: [] } }, [{ id: 3, url: 'chrome://extensions/', active: true }]);
    await montar();
    expect(botao('Gravar esta aba')!.disabled).toBe(true);
    expect(texto()).toContain('Abra uma página do sistema');
    expect(raiz.querySelector('#aba-atual')).toBeNull();
  });

  it('perfil que não grava: explica e oferece trocar de empresa, sem "Gravar esta aba"', async () => {
    chromeCom({ estado: null, conta: comConta({ ...SESSAO, perfil: 'leitor', podeGravar: false }) });
    await montar();
    expect(texto()).toContain('Seu perfil não permite gravar fluxos');
    expect(texto()).toContain('Na Horizonte Gestão você está como Leitor. Quem grava fluxos são Admin e Editor de tarefas.');
    expect(botao('Gravar esta aba')).toBeUndefined();
    expect(pedidos.map((p) => p.tipo)).not.toContain('recentes');
    botao('Trocar de empresa')!.click();
    expect(texto()).toContain('Trocar de empresa ou de conta');
  });

  it('Trocar: escolhe outra empresa (entrada no console) ou sai da extensão', async () => {
    chromeCom({ estado: null, conta: comConta(), recentes: { ok: true, gravacoes: [] }, entrar: { ok: false, mensagem: 'Sem conexão com o copiloto agora.' }, sair: { ok: true } });
    await montar();
    botao('Trocar')!.click();
    const opcoes = [...raiz.querySelectorAll<HTMLButtonElement>('.pp-empresa-opcao')];
    expect(opcoes.map((b) => b.textContent)).toEqual(['HGHorizonte GestãoEditor de tarefasAtual', 'VLVetor LogísticaAdmin']);
    expect(opcoes[0].disabled).toBe(true);
    opcoes[1].click();
    await vi.waitFor(() => expect(texto()).toContain('Sem conexão com o copiloto agora.'));
    expect(pedidos.at(-1)).toEqual({ tipo: 'entrar', empresaId: 'emp-v' });
    botao('Sair da extensão')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Entre para gravar fluxos para a sua empresa'));
    expect(pedidos.at(-1)).toEqual({ tipo: 'sair' });
  });

  it('a conta entra pelo console com o popup aberto: a tela muda sozinha', async () => {
    const respostas: Partial<Record<Pedido['tipo'], unknown>> = { estado: null, conta: { conectada: false }, recentes: { ok: true, gravacoes: [] } };
    const ch = chromeCom(respostas);
    await montar();
    expect(texto()).toContain('Entre para gravar');
    respostas.conta = comConta();
    ch.avisar({ tipo: 'contaMudou' });
    await vi.waitFor(() => expect(texto()).toContain('Gravar um fluxo nesta aba'));
  });

  it('gravando: nome, endereço, passos ao vivo, Concluir e "Abrir no console"', async () => {
    const ch = chromeCom({ estado: gravando({ empresa: 'Horizonte Gestão', pessoa: 'Rafael Lima', fluxoId: 'f1' }), concluir: { ok: true }, abrirConsole: { ok: true } });
    const fechar = vi.fn();
    await montar({ fechar });
    expect(pedidos[0]).toEqual({ tipo: 'estado', abaId: 12 });
    expect(raiz.querySelector('h1')?.textContent).toBe('Abrir chamado');
    expect(texto()).toContain('localhost:4000/chamados');
    expect(raiz.querySelector('[role=status]')?.textContent).toBe('3 passosaté agora');
    expect(texto()).toContain('O que você digita não é gravado, só o formato.');
    expect(raiz.querySelector('footer')?.textContent).toBe('Envia para Horizonte Gestão · Rafael Lima');
    expect(texto()).not.toContain('null');
    ch.avisar({ tipo: 'estadoAba', abaId: 12, estado: gravando({ passos: 4, empresa: 'Horizonte Gestão', pessoa: 'Rafael Lima', fluxoId: 'f1' }) });
    ch.avisar({ tipo: 'estadoAba', abaId: 99, estado: gravando({ passos: 40 }) });
    expect(raiz.querySelector('[role=status]')?.textContent).toBe('4 passosaté agora');
    botao('Concluir')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Gravação enviada. Volte ao console para revisar.'));
    expect(pedidos.at(-1)).toEqual({ tipo: 'concluir', abaId: 12 });
    expect(texto()).toContain('Abrir chamado · 4 passos');
    expect(raiz.querySelector('footer')?.textContent).toBe('Enviada para Horizonte Gestão · Rafael Lima');
    botao('Abrir no console')!.click();
    await vi.waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(pedidos.at(-1)).toEqual({ tipo: 'abrirConsole', fluxoId: 'f1', api: 'http://localhost:3000' });
  });

  it('Cancelar pergunta antes de descartar; "Gravar de novo" volta para gravar', async () => {
    chromeCom({ estado: gravando({ passos: 1 }), cancelar: { ok: true }, conta: comConta(), recentes: { ok: true, gravacoes: [] } });
    await montar();
    expect(raiz.querySelector('[role=status]')?.textContent).toBe('1 passoaté agora');
    botao('Cancelar')!.click();
    expect(texto()).toContain('Descartar a gravação?');
    expect(texto()).toContain('Os passos gravados até agora serão perdidos.');
    expect(texto()).toContain('1 passo até agora');
    botao('Continuar gravando')!.click();
    expect(botao('Concluir')).toBeTruthy();
    botao('Cancelar')!.click();
    botao('Descartar')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Gravação descartada. Nada foi salvo.'));
    expect(texto()).toContain('Quando quiser, grave o fluxo de novo nesta aba.');
    expect(pedidos.at(-1)).toEqual({ tipo: 'cancelar', abaId: 12 });
    botao('Gravar de novo')!.click();
    await vi.waitFor(() => expect(botao('Gravar esta aba')).toBeTruthy());
  });

  it('erro ao concluir fica no popup, com a gravação de pé', async () => {
    chromeCom({ estado: gravando(), concluir: { ok: false, mensagem: 'Não consegui falar com o copiloto em http://localhost:3000.' } });
    await montar();
    botao('Concluir')!.click();
    await vi.waitFor(() => expect(raiz.querySelector('[role=alert]')?.textContent).toContain('Não consegui falar'));
    expect(botao('Concluir')).toBeTruthy();
  });

  it('Concluir sem conexão: os passos ficam guardados; "Tentar agora" envia', async () => {
    const respostas: Partial<Record<Pedido['tipo'], unknown>> = {
      estado: gravando({ passos: 6, empresa: 'Horizonte Gestão', pessoa: 'Rafael Lima' }),
      concluir: { ok: false, semConexao: true, mensagem: 'Sem conexão agora.' },
      tentarAgora: { ok: false, semConexao: true, mensagem: 'Sem conexão agora.' },
    };
    chromeCom(respostas);
    await montar();
    botao('Concluir')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Sem conexão agora.'));
    expect(texto()).toContain('Os 6 passos estão guardados e serão enviados quando a internet voltar.');
    expect(texto()).toContain('Esperando a conexão voltar');
    expect(raiz.querySelector('footer')?.textContent).toBe('Vai para Horizonte Gestão · Rafael Lima');
    botao('Tentar agora')!.click();
    await vi.waitFor(() => expect(pedidos.at(-1)).toEqual({ tipo: 'tentarAgora', abaId: 12 }));
    await vi.waitFor(() => expect(botao('Tentar agora')!.disabled).toBe(false));
    respostas.tentarAgora = { ok: true };
    botao('Tentar agora')!.click();
    await vi.waitFor(() => expect(texto()).toContain('Gravação enviada. Volte ao console para revisar.'));
  });

  it('aberto numa aba que espera a conexão: mostra "Sem conexão"', async () => {
    chromeCom({ estado: gravando({ situacao: 'sem_conexao', passos: 1 }) });
    await montar();
    expect(texto()).toContain('O passo está guardado e será enviado quando a internet voltar.');
  });

  it('sem permissão: aviso com "Abrir as opções"', async () => {
    chromeCom({ estado: gravando({ situacao: 'sem_permissao', aviso: 'A extensão ainda não pode falar com o copiloto.' }), permitir: { ok: true } });
    await montar();
    expect(texto()).toContain('ainda não pode falar');
    botao('Abrir as opções')!.click();
    expect(pedidos.at(-1)).toEqual({ tipo: 'permitir', abaId: 12 });
  });

  it('popup aberto numa aba escolhida (?aba=)', async () => {
    chromeCom({ estado: gravando() }, [ABA, { id: 30, url: 'https://portal.fornecedor.com.br/', active: false }]);
    await montar({ abaId: 30 });
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
    await vi.waitFor(() => expect(texto()).toContain('Conectado ao copiloto. O console fica em http://localhost:5173.'));
    expect(pedidos).toEqual([{ tipo: 'conta' }, { tipo: 'saude', servidor: 'http://localhost:3000' }]);
  });

  it('mostra a conta da extensão, com Sair', async () => {
    const ch = instalarChrome();
    let conectada = true;
    ch.aoMensagem((p) => {
      pedidos.push(p as Pedido);
      if ((p as Pedido).tipo === 'sair') conectada = false;
      return (p as Pedido).tipo === 'conta' ? (conectada ? { conectada: true, sessao: SESSAO } : { conectada: false }) : { ok: true };
    });
    await montarOpcoes(raiz);
    expect(texto()).toContain('Horizonte Gestão · Rafael Lima (rafael@horizonte.com.br)');
    botao('Sair')!.click();
    await vi.waitFor(() => expect(texto()).toContain('A extensão ainda não entrou em nenhuma conta.'));
    expect(botao('Entrar com a conta do Copiloto')).toBeTruthy();
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

  it('ícone PNG na cor da marca de tokens.css, com o "S" branco', () => {
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

  it('o "S" do ícone: traço no meio e nas pontas, vazio dentro das curvas', () => {
    expect(noS(0.5, 0.5)).toBe(true); // meio do S
    expect(noS(0.5, 0.24)).toBe(true); // topo
    expect(noS(0.5, 0.76)).toBe(true); // base
    expect(noS(0.5, 0.37)).toBe(false); // dentro da curva de cima
    expect(noS(0.5, 0.63)).toBe(false); // dentro da curva de baixo
    expect(noS(0.62, 0.45)).toBe(false); // abertura da direita
    expect(noS(0.38, 0.55)).toBe(false); // abertura da esquerda
  });

  it('imagens da loja no tamanho pedido, com o ícone no meio', () => {
    const cores = lerCores(fs.readFileSync(path.resolve(__dirname, '../../shared/styles/tokens.css'), 'utf8'));
    const tamanho = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(tamanho(imagemLojaPng(128, 128, 96, cores))).toEqual([128, 128]);
    expect(tamanho(imagemLojaPng(440, 280, 152, cores, [255, 240, 245]))).toEqual([440, 280]);
  });
});

describe('pacote da loja (.zip)', () => {
  /** Lê o zip pelo diretório central (o que as lojas fazem) e descompacta cada arquivo. */
  function lerZip(zip: Buffer): Record<string, Buffer> {
    const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(fim).toBeGreaterThan(0);
    const total = zip.readUInt16LE(fim + 10);
    let p = zip.readUInt32LE(fim + 16);
    const arquivos: Record<string, Buffer> = {};
    for (let i = 0; i < total; i++) {
      expect(zip.readUInt32LE(p)).toBe(0x02014b50);
      const metodo = zip.readUInt16LE(p + 10);
      const tamanho = zip.readUInt32LE(p + 20);
      const original = zip.readUInt32LE(p + 24);
      const nome = zip.subarray(p + 46, p + 46 + zip.readUInt16LE(p + 28)).toString('utf8');
      const local = zip.readUInt32LE(p + 42);
      expect(zip.readUInt32LE(local)).toBe(0x04034b50);
      const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const corpo = zip.subarray(inicio, inicio + tamanho);
      arquivos[nome] = metodo === 8 ? inflateRawSync(corpo) : Buffer.from(corpo);
      expect(arquivos[nome]).toHaveLength(original);
      p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    }
    return arquivos;
  }

  it('guarda os arquivos (com pastas e acentos) e o manifest.json na raiz', () => {
    const manifestJson = Buffer.from(JSON.stringify(manifesto('1.2.3')));
    const js = Buffer.from('console.log("gravação");\n'.repeat(50));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const zip = criarZip([
      { caminho: 'manifest.json', dados: manifestJson },
      { caminho: 'assets/popup.js', dados: js },
      { caminho: 'icones/16.png', dados: png },
    ]);
    const lidos = lerZip(zip);
    expect(Object.keys(lidos)).toEqual(['manifest.json', 'assets/popup.js', 'icones/16.png']);
    expect(lidos['manifest.json'].equals(manifestJson)).toBe(true);
    expect(lidos['assets/popup.js'].equals(js)).toBe(true);
    expect(lidos['icones/16.png'].equals(png)).toBe(true);
    // O texto repetido comprime.
    expect(zip.length).toBeLessThan(js.length);
  });
});

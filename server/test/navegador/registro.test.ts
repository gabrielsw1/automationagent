// Número do registro criado ("Chamado #1287"): padrões conservadores no texto, formato do Mapear
// campos e leitura na página de verdade (Chromium), pelo elemento configurado ou pelo aviso de
// confirmação. Sem exatamente um número, não chuta.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { Campo, TarefaDefinicao } from '@copiloto/shared';
import { camposExibidos, montarLinhaRegistro } from '../../src/execucao/motor.ts';
import { SCRIPT_NOMES } from '../../src/navegador/pagina.ts';
import { artigoDe, extrairRegistro, formatoParaRegex, lerRegistro, numeroDoElemento, numeroParaRecibo } from '../../src/navegador/registro.ts';

describe('número do registro no texto de confirmação', () => {
  it.each([
    ['Chamado #1287 criado com sucesso.', { numero: '1287', nome: 'Chamado', artigo: 'o' }],
    ['Chamado CH-2026-0153 aberto.', { numero: 'CH-2026-0153', nome: 'Chamado', artigo: 'o' }],
    ['Pedido nº 4521 registrado.', { numero: '4521', nome: 'Pedido', artigo: 'o' }],
    ['Cliente cadastrado com o código 1043.', { numero: '1043', nome: 'Cliente', artigo: 'o' }],
    ['Visita agendada. Protocolo VT-2026-0042.', { numero: 'VT-2026-0042', nome: 'Protocolo', artigo: 'o' }],
    ['Solicitação #88 enviada para aprovação', { numero: '88', nome: 'Solicitação', artigo: 'a' }],
    ['Número do chamado: 1287', { numero: '1287', nome: 'Chamado', artigo: 'o' }],
    // O mesmo número duas vezes ainda é um número só.
    ['Chamado #1287 criado. Abrir #1287', { numero: '1287', nome: 'Chamado', artigo: 'o' }],
    ['#1287 criado', { numero: '1287' }],
  ])('"%s"', (texto, esperado) => {
    expect(extrairRegistro(texto)).toEqual(esperado);
  });

  it.each([
    ['sem número', 'Dados salvos com sucesso.'],
    ['data', 'Atualizado em 16/10/2026.'],
    ['protocolo que é data', 'Protocolo 16/10/2026'],
    ['CPF', 'Cliente cadastrado com o código 123.456.789-09'],
    ['valor', 'Pedido nº 1.250'],
    ['número solto no texto', 'Você tem 3 chamados em andamento e 12 resolvidos.'],
    ['dois números', 'Chamado #1287 criado. Veja também o chamado #1290.'],
    ['vazio', '   '],
  ])('não chuta: %s', (_caso, texto) => {
    expect(extrairRegistro(texto)).toBeNull();
  });

  it('formato do Mapear campos (9 é dígito, a é letra) e número dentro do elemento', () => {
    const re = formatoParaRegex('CH-9999-9999')!;
    expect('CH-2026-0153').toMatch(re);
    expect('CH-2026-10000').toMatch(re); // o sequencial cresce
    expect('XCH-2026-0153').not.toMatch(re);
    expect(formatoParaRegex('')).toBeNull();
    expect(formatoParaRegex('---')).toBeNull();
    expect(numeroDoElemento('Chamado CH-2026-0153 aberto.', 'CH-9999-9999')).toBe('CH-2026-0153');
    expect(numeroDoElemento('Chamado aberto.', 'CH-9999-9999')).toBeNull();
    expect(numeroDoElemento('#1287')).toBe('1287');
    expect(numeroDoElemento(' CH-2026-0153 ')).toBe('CH-2026-0153');
    expect(numeroDoElemento('Número: 1287')).toBe('1287');
    expect(numeroDoElemento('1287 e 1288')).toBeNull();
    expect(numeroDoElemento('')).toBeNull();
  });

  it('artigo pelo nome e número como o recibo mostra', () => {
    expect(artigoDe('Chamado')).toBe('o');
    expect(artigoDe('Visita')).toBe('a');
    expect(artigoDe('Ordem de serviço')).toBe('a');
    expect(artigoDe('Solicitação')).toBe('a');
    expect(artigoDe('Sistema')).toBe('o');
    expect(numeroParaRecibo('1287')).toBe('#1287');
    expect(numeroParaRecibo('CH-2026-0153')).toBe('CH-2026-0153');
  });
});

describe('linha do registro no recibo', () => {
  const campo = (chave: string, rotulo: string, tipo: Campo['tipo'], extra: Partial<Campo> = {}): Campo => ({
    chave,
    rotulo,
    tipo,
    obrigatorio: true,
    pergunta: `Qual é ${rotulo.toLowerCase()}?`,
    ...extra,
  });
  const def = {
    campos: [
      campo('assunto', 'Assunto', 'texto'),
      campo('cliente', 'Cliente', 'texto'),
      campo('prioridade', 'Prioridade', 'lista', { opcoes: ['Baixa', 'Média', 'Alta'] }),
      campo('descricao', 'Descrição', 'texto'),
    ],
  } as TarefaDefinicao;
  const valores = {
    assunto: 'Impressora sem tinta',
    cliente: 'Padaria Estrela',
    prioridade: 'Alta',
    descricao: 'A impressora do caixa parou de imprimir os cupons fiscais',
  };

  it('"Chamado #1287 · Padaria Estrela · Prioridade alta": o resto continua na lista', () => {
    const campos = camposExibidos(def, valores);
    const r = montarLinhaRegistro(def, valores, { numero: '1287', nome: 'Chamado', artigo: 'o', texto: '', origem: 'aviso' }, campos);
    expect(r.registro).toEqual({ nome: 'Chamado', numero: '#1287', detalhes: ['Padaria Estrela', 'Prioridade alta'] });
    expect([...r.usados]).toEqual(['Cliente', 'Prioridade']);
  });

  it('código como a tela mostra; sem nome, "Registro"; texto longo e o primeiro campo ficam de fora', () => {
    const longo = { ...valores, cliente: 'Padaria e Confeitaria Estrela do Norte Ltda' };
    const r = montarLinhaRegistro(def, longo, { numero: 'CH-2026-0153', texto: '', origem: 'configurado' }, camposExibidos(def, longo));
    expect(r.registro).toEqual({ nome: 'Registro', numero: 'CH-2026-0153', detalhes: ['Prioridade alta'] });
    expect([...r.usados]).toEqual(['Prioridade']);
  });
});

// ---------------------------------------------------------------- na página

const PAGINAS: Record<string, string> = {
  // O aviso só aparece depois de um tempo (como uma tela que confirma por JavaScript).
  '/aviso-atrasado': `<h1>Chamados</h1><p>Você tem 4 chamados em andamento.</p><div id="lugar"></div>
<table><tr><td><a href="/chamados/7">CH-2026-0007</a></td></tr><tr><td><a href="/chamados/153">CH-2026-0153</a></td></tr></table>
<script>setTimeout(() => { document.getElementById('lugar').innerHTML =
  '<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Chamado <strong data-campo="numero_chamado">CH-2026-0153</strong> aberto.</div>'; }, 400);</script>`,
  '/configurado': `<h1>Pedido salvo</h1><div class="cabecalho">Pedido <span id="codigo-pedido">PED/1287</span> · aguardando faturamento</div>
<p><a href="/pedidos/1287">PED/1287</a></p>`,
  '/sem-aviso': `<h1>Chamados</h1><p>Chamado CH-2026-0153 aberto por Ana na semana passada.</p>`,
  '/dois-avisos': `<div role="status">Chamado #1287 criado.</div><div class="toast">Chamado #1290 criado.</div>`,
  '/link-externo': `<div role="alert">Ticket #555 aberto. <a href="https://outro.exemplo.com/t/555">#555</a></div>`,
};

let servidor: http.Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    const corpo = PAGINAS[new URL(req.url ?? '/', 'http://x').pathname];
    res.writeHead(corpo ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Horizonte</title></head><body>${corpo ?? 'Não encontrado'}</body></html>`);
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  servidor?.closeAllConnections();
  await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r()));
});

/** Página com o mesmo script de nomes que o executor põe no contexto (código transformado pelo tsx). */
async function abrir(caminho: string): Promise<Page> {
  const contexto = await browser.newContext();
  await contexto.addInitScript({ content: SCRIPT_NOMES });
  const page = await contexto.newPage();
  await page.goto(`${base}${caminho}`);
  return page;
}

describe('lendo o número na página', { timeout: 30_000 }, () => {
  it('sem configuração: espera o aviso de confirmação, lê o número, o link para abrir e sugere o lugar', async () => {
    const page = await abrir('/aviso-atrasado');
    try {
      const r = await lerRegistro(page, null, 3_000);
      expect(r).toEqual({
        numero: 'CH-2026-0153',
        nome: 'Chamado',
        artigo: 'o',
        url: `${base}/chamados/153`,
        texto: 'Chamado CH-2026-0153 aberto.',
        seletor: '[data-campo="numero_chamado"]',
        origem: 'aviso',
      });
    } finally {
      await page.context().close();
    }
  });

  it('com o lugar configurado: lê daquele elemento pelo formato, com o nome dado no Mapear campos', async () => {
    const page = await abrir('/configurado');
    try {
      const r = await lerRegistro(page, { seletor: '#codigo-pedido', formato: 'aaa/9999', nome: 'Pedido de venda' }, 1_000);
      expect(r).toMatchObject({
        numero: 'PED/1287',
        nome: 'Pedido de venda',
        artigo: 'o',
        url: `${base}/pedidos/1287`,
        seletor: '#codigo-pedido',
        origem: 'configurado',
      });
      // Sem formato, o código inteiro do elemento vale.
      expect((await lerRegistro(page, { seletor: '#codigo-pedido' }, 1_000))?.numero).toBe('PED/1287');
      // Formato que não confere com o que a tela mostra: sem número.
      expect(await lerRegistro(page, { seletor: '#codigo-pedido', formato: 'CH-9999-9999' }, 1_000)).toBeNull();
    } finally {
      await page.context().close();
    }
  });

  it('o elemento configurado não aparece: sem número (não procura em outro lugar)', async () => {
    const page = await abrir('/aviso-atrasado');
    try {
      const inicio = Date.now();
      expect(await lerRegistro(page, { seletor: '[data-campo="nao_existe"]' }, 500)).toBeNull();
      expect(Date.now() - inicio).toBeLessThan(5_000);
    } finally {
      await page.context().close();
    }
  });

  it('número fora de um aviso de confirmação não conta; dois números diferentes também não', async () => {
    const semAviso = await abrir('/sem-aviso');
    const dois = await abrir('/dois-avisos');
    try {
      expect(await lerRegistro(semAviso, null, 600)).toBeNull();
      expect(await lerRegistro(dois, null, 600)).toBeNull();
    } finally {
      await semAviso.context().close();
      await dois.context().close();
    }
  });

  it('link para outro site não vira o "Abrir" do recibo', async () => {
    const page = await abrir('/link-externo');
    try {
      const r = await lerRegistro(page, null, 1_000);
      expect(r).toMatchObject({ numero: '555', nome: 'Ticket', origem: 'aviso', seletor: '[role=alert]' });
      expect(r?.url).toBeUndefined();
    } finally {
      await page.context().close();
    }
  });
});

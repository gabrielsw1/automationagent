// Executor real (Chromium) contra telas HTML servidas pelo próprio teste.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import type { Fluxo, PassoFluxo } from '@copiloto/shared';
import { lerConfig } from '../../src/config.ts';
import { Banco } from '../../src/db/banco.ts';
import { LlmSimulado } from '../../src/llm/simulado.ts';
import { NavegadorPlaywright } from '../../src/navegador/executor.ts';
import { acharSensiveis, borrarImagem } from '../../src/navegador/mascara.ts';
import { avaliar } from '../../src/navegador/pagina.ts';
import type { EventoNavegador, PedidoExecucaoNavegador } from '../../src/navegador/tipos.ts';
import { AdaptadorTelas, LINHA_DIGITAVEL, pastaTemporaria, subirTelas, type ServidorTelas } from './ajuda-navegador.ts';

// Código que roda dentro da página nos testes de máscara.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const Image: any;

const label = (t: string) => `label="${t}"`;

function fluxoBoleto(): Fluxo {
  const passos: PassoFluxo[] = [
    { n: 1, tipo: 'navegar', titulo: 'Abrir a tela de segunda via', url: '/financeiro/segunda-via', seletores: [], seletorEscolhido: 0 },
    {
      n: 2,
      tipo: 'preencher',
      titulo: 'Preencher CPF/CNPJ',
      rotuloElemento: 'CPF/CNPJ do pagador',
      seletores: [
        { seletor: 'input[name="doc_pagador"]', estabilidade: 'estavel', motivo: 'nome interno' },
        { seletor: label('CPF/CNPJ do pagador'), estabilidade: 'estavel', motivo: 'rótulo' },
      ],
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'documento_pagador' },
      formatoGravado: '99.999.999/9999-99',
    },
    {
      n: 3,
      tipo: 'selecionar',
      titulo: 'Selecionar competência',
      rotuloElemento: 'Competência',
      seletores: [{ seletor: 'select[name="competencia"]', estabilidade: 'estavel', motivo: 'nome interno' }],
      seletorEscolhido: 0,
      valor: { origem: 'campo', campo: 'competencia' },
    },
    {
      n: 4,
      tipo: 'preencher',
      titulo: 'Preencher e-mail para envio',
      rotuloElemento: 'E-mail para envio',
      seletores: [{ seletor: 'input[name="email"]', estabilidade: 'estavel', motivo: 'nome interno' }],
      seletorEscolhido: 0,
      valor: { origem: 'fixo', valor: 'financeiro@cliente.com.br' },
    },
    {
      n: 5,
      tipo: 'clique',
      titulo: 'Clicar em Buscar boletos',
      rotuloElemento: 'Buscar boletos',
      seletores: [
        { seletor: 'role=button[name="Buscar boletos"]', estabilidade: 'fragil', motivo: 'texto do botão' },
        { seletor: 'text="Buscar boletos"', estabilidade: 'fragil', motivo: 'texto' },
      ],
      seletorEscolhido: 0,
    },
    {
      n: 6,
      tipo: 'download',
      titulo: 'Gerar a 2ª via e baixar o PDF',
      rotuloElemento: 'Gerar 2ª via',
      seletores: [
        { seletor: 'role=button[name="Gerar 2ª via"]', estabilidade: 'fragil', motivo: 'texto do botão' },
        { seletor: 'text="Gerar 2ª via"', estabilidade: 'fragil', motivo: 'texto' },
      ],
      seletorEscolhido: 0,
    },
    {
      n: 7,
      tipo: 'leitura',
      titulo: 'Ler a linha digitável',
      rotuloElemento: 'Linha digitável',
      seletores: [{ seletor: '[data-campo="linha_digitavel"]', estabilidade: 'estavel', motivo: 'marca' }],
      seletorEscolhido: 0,
      gera: 'linha_digitavel',
    },
  ];
  return {
    id: 'flx_teste',
    nome: 'Segunda via de boleto',
    tarefaId: null,
    etapa: 'publicar',
    status: 'publicado',
    versao: 1,
    passos,
    camposSugeridos: [],
    gravadoPor: null,
    gravadoEm: null,
    duracaoGravacaoMs: null,
    urlInicial: '/financeiro/segunda-via',
    salvoEm: new Date().toISOString(),
  };
}

let telas: ServidorTelas;
let navegador: NavegadorPlaywright;
let banco: Banco;
let adaptador: AdaptadorTelas;
let dirDados: string;
let contador = 0;

beforeAll(async () => {
  telas = await subirTelas();
  dirDados = pastaTemporaria();
  banco = new Banco(':memory:');
  adaptador = new AdaptadorTelas(telas.url);
  navegador = new NavegadorPlaywright(
    { config: { ...lerConfig(), dirDados, navegadorVisivel: false }, banco, adaptador, llm: new LlmSimulado() },
    { tempoElementoMs: 1_500, tempoNavegacaoMs: 10_000, tempoDownloadMs: 5_000, esperaPosCliqueMs: 500 },
  );
});

afterAll(async () => {
  await navegador?.fechar();
  await telas?.fechar();
  banco?.fechar();
});

function pedido(extra: Partial<PedidoExecucaoNavegador> = {}): PedidoExecucaoNavegador & { eventos: EventoNavegador[] } {
  const eventos: EventoNavegador[] = [];
  return {
    execucaoId: `EX-${++contador}`,
    fluxo: fluxoBoleto(),
    valores: { documento_pagador: '12.345.678/0001-95', competencia: '10/2026' },
    usuarioId: '102',
    confiancaMinima: 0.8,
    mascararPrints: true,
    aoEvento: (e) => eventos.push(e),
    sinal: new AbortController().signal,
    ...extra,
    eventos,
  };
}

describe('executor do navegador (Chromium)', { timeout: 60_000 }, () => {
  it('diz que o navegador está disponível', async () => {
    const r = await navegador.disponivel();
    expect(r.ok).toBe(true);
    expect(r.detalhe).toMatch(/Chromium/);
  });

  it('preenche, seleciona, clica, baixa e lê, com um print mascarado por passo', async () => {
    telas.estado.versao = 'v1';
    const p = pedido();
    const r = await navegador.executar(p);
    expect(r).toMatchObject({ ok: true, recuperacoes: 0 });
    if (!r.ok) return;
    expect(r.gerados.linha_digitavel).toBe(LINHA_DIGITAVEL);
    expect(r.arquivos).toHaveLength(1);
    expect(r.arquivos[0]).toMatchObject({ nome: 'boleto-123.pdf', tipo: 'application/pdf' });
    expect(r.arquivos[0].caminho).toBe(path.join(dirDados, 'arquivos', p.execucaoId, 'boleto-123.pdf'));
    expect(fs.readFileSync(r.arquivos[0].caminho, 'utf8')).toMatch(/^%PDF/);

    expect(adaptador.sessoes.at(-1)).toBe('102');
    const titulos = p.eventos.filter((e) => e.tipo === 'passo_ok').map((e) => e.titulo);
    expect(titulos).toEqual([
      'Abriu a tela de segunda via',
      'Preencheu CPF/CNPJ',
      'Selecionou competência',
      'Preencheu e-mail para envio',
      'Clicou em Buscar boletos',
      'Gerou a 2ª via e baixou o PDF',
      'Leu a linha digitável',
    ]);
    expect(p.eventos[0]).toMatchObject({ tipo: 'login', titulo: 'Entrou no Horizonte com a sessão de Marcos Teixeira' });
    const comPrint = p.eventos.filter((e) => e.tipo === 'passo_ok' && e.printId);
    expect(comPrint).toHaveLength(7);
    const prints = banco.todos<{ id: string; execucao_id: string; mascarado: number; arquivo: string; apagar_em: string }>(
      'SELECT * FROM prints WHERE execucao_id = ?',
      p.execucaoId,
    );
    expect(prints).toHaveLength(7);
    expect(prints.every((x) => x.mascarado === 1)).toBe(true);
    expect(prints.every((x) => fs.existsSync(path.join(dirDados, x.arquivo)))).toBe(true);
    // retenção padrão: 90 dias
    const dias = (Date.parse(prints[0].apagar_em) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThan(91);
    // o passo de preencher tem destaque no lugar do campo
    expect(p.eventos.find((e) => e.tipo === 'passo_ok' && e.passo === 2)?.destaque).toMatchObject({ w: expect.any(Number) });
    // o passo de selecionar conta a opção escolhida
    expect(p.eventos.find((e) => e.tipo === 'passo_ok' && e.passo === 3)?.detalhe).toBe('Opção “10/2026”');
  });

  it('recupera pela tela quando o campo mudou de nome e rótulo (regra simulada)', async () => {
    telas.estado.versao = 'v2';
    const p = pedido();
    const r = await navegador.executar(p);
    expect(r).toMatchObject({ ok: true, recuperacoes: 1 });
    const rec = p.eventos.find((e) => e.tipo === 'recuperacao');
    expect(rec).toMatchObject({ passo: 2, candidato: { texto: 'CPF/CNPJ' } });
    expect(rec!.candidato!.confianca).toBeGreaterThanOrEqual(0.8);
    expect(rec!.destaque).toMatchObject({ w: expect.any(Number), h: expect.any(Number) });
    expect(rec!.printId).toBeTruthy();
    expect(rec!.titulo).toBe('A tela mudou: usou “CPF/CNPJ” no lugar do campo “CPF/CNPJ do pagador”');
    if (r.ok) expect(r.gerados.linha_digitavel).toBe(LINHA_DIGITAVEL);
  });

  it('para e devolve o candidato quando a confiança fica abaixo do mínimo', async () => {
    telas.estado.versao = 'v3';
    const p = pedido();
    const r = await navegador.executar(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('elemento_nao_encontrado');
    expect(r.passo).toBe(5);
    expect(r.candidato?.texto).toBe('Buscar 2ª via');
    expect(r.candidato!.confianca).toBeLessThan(0.8);
    expect(r.candidato!.confianca).toBeGreaterThan(0.3);
    expect(r.printId).toBeTruthy();
    expect(r.destaque).toBeTruthy();
    expect(r.mensagem).toMatch(/não achei o botão “Buscar boletos”. O mais parecido é “Buscar 2ª via”/);
    expect(r.mensagem).toMatch(/parei sem clicar/);
    const falhou = p.eventos.find((e) => e.tipo === 'passo_falhou');
    expect(falhou).toMatchObject({ passo: 5, candidato: { texto: 'Buscar 2ª via' } });
  });

  it('para quando a sessão não vale (tela de entrar)', async () => {
    telas.estado.versao = 'v1';
    adaptador.sessaoValida = false;
    try {
      const r = await navegador.executar(pedido());
      expect(r).toMatchObject({ ok: false, motivo: 'sessao_expirada', passo: 1 });
    } finally {
      adaptador.sessaoValida = true;
    }
  });

  it('cancela no meio pelo sinal', async () => {
    telas.estado.versao = 'v1';
    const controle = new AbortController();
    const f = fluxoBoleto();
    f.passos.splice(2, 0, { n: 3, tipo: 'esperar', titulo: 'Esperar', seletores: [], seletorEscolhido: 0, valor: { origem: 'fixo', valor: '20000' } });
    f.passos.forEach((p, i) => (p.n = i + 1));
    const p = pedido({ fluxo: f, sinal: controle.signal });
    setTimeout(() => controle.abort(), 2_500);
    const inicio = Date.now();
    const r = await navegador.executar(p);
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(r).toMatchObject({ ok: false, motivo: 'cancelado', passo: 3 });
  });

  it('não começa quando já veio cancelado', async () => {
    const controle = new AbortController();
    controle.abort();
    const r = await navegador.executar(pedido({ sinal: controle.signal }));
    expect(r).toMatchObject({ ok: false, motivo: 'cancelado', passo: null });
  });

  it('sem mascarar, grava o print com mascarado = 0', async () => {
    telas.estado.versao = 'v1';
    const p = pedido({ mascararPrints: false });
    const r = await navegador.executar(p);
    expect(r.ok).toBe(true);
    const linhas = banco.todos<{ mascarado: number }>('SELECT mascarado FROM prints WHERE execucao_id = ?', p.execucaoId);
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l) => l.mascarado === 0)).toBe(true);
  });
});

describe('mascaramento dos prints', { timeout: 30_000 }, () => {
  it('acha CPF, CNPJ, e-mail, senha e cartão e borra só essas regiões do print', async () => {
    const b = await chromium.launch({ headless: true });
    try {
      const page = await b.newPage({ viewport: { width: 800, height: 400 } });
      await page.setContent(`
        <label for="d">Documento</label><input id="d" name="doc_pagador" value="12.345.678/0001-95">
        <label for="n">Nome</label><input id="n" name="nome" value="Ana Ribeiro">
        <input type="password" name="senha" value="segredo">
        <p>Contato: fulano@acme.com.br · CPF 123.456.789-09</p>
        <p>Cartão 4111 1111 1111 1111</p>
        <p>Texto comum sem dados</p>`);
      const caixas = await acharSensiveis(page);
      // documento, senha, e-mail, CPF no texto e cartão (o nome não é sensível)
      expect(caixas.length).toBe(5);
      const limpo = await page.screenshot();
      const aux = await b.newPage();
      const borrado = await borrarImagem(aux, limpo, caixas);
      expect(borrado.equals(limpo)).toBe(false);
      expect(borrado.subarray(1, 4).toString('ascii')).toBe('PNG');
      // a página do sistema não muda
      expect((await page.screenshot()).equals(limpo)).toBe(true);
      // conferência pixel a pixel: dentro da caixa mudou, fora (texto comum) ficou igual
      const comparar = await aux.evaluate(
        async ({ a, b, dentro, fora }) => {
          const ler = async (b64: string) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const x = c.getContext('2d');
            x.drawImage(img, 0, 0);
            return x;
          };
          const [ca, cb] = [await ler(a), await ler(b)];
          const dif = (r: { x: number; y: number; w: number; h: number }) => {
            const da = ca.getImageData(r.x, r.y, r.w, r.h).data;
            const db = cb.getImageData(r.x, r.y, r.w, r.h).data;
            let n = 0;
            for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) n++;
            return n;
          };
          return { dentro: dif(dentro), fora: dif(fora) };
        },
        {
          a: limpo.toString('base64'),
          b: borrado.toString('base64'),
          dentro: { x: Math.ceil(caixas[0].x), y: Math.ceil(caixas[0].y), w: 20, h: 10 },
          fora: { x: 0, y: 300, w: 400, h: 60 },
        },
      );
      expect(comparar.dentro).toBeGreaterThan(0);
      expect(comparar.fora).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('roda código de página transformado pelo tsx (chamadas a __name)', async () => {
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      await page.setContent('<p>ok</p>');
      // O tsx (esbuild com keepNames) escreve funções internas assim:
      const comoTsx = new Function('return (n) => { const dobro = __name((x) => x * 2, "dobro"); return dobro(n); }')() as (n: number) => number;
      await expect(page.evaluate(comoTsx, 21)).rejects.toThrow(/__name/);
      expect(await avaliar(page, comoTsx, 21)).toBe(42);
    } finally {
      await b.close();
    }
  });
});

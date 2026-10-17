// @vitest-environment node
// De ponta a ponta com a extensão carregada no Chromium de verdade (Playwright, sem janela):
// 1. Grava "Abrir chamado" no Horizonte pela extensão, cria a tarefa pelo fluxo, testa, publica,
//    pede no widget como Ana Ribeiro, confirma e recebe o recibo, com o chamado aberto no Horizonte.
// 2. A gravação continua quando a aba vai para outro site, e o popup conclui.
// O copiloto (modo simulado) e o Horizonte sobem aqui mesmo, em portas livres de 127.0.0.1.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Bloco, Fluxo, MensagemWidget } from '@copiloto/shared';
import { criarApp } from '@copiloto/server/src/app.ts';
import { assinarUsuario } from '@copiloto/server/src/auth/widget.ts';
import { lerConfig, type Config } from '@copiloto/server/src/config.ts';
import type { Contexto } from '@copiloto/server/src/contexto.ts';
import { LlmSimulado } from '@copiloto/server/src/llm/simulado.ts';
import { Fluxos } from '@copiloto/server/src/navegador/fluxos.ts';
import { Plataforma, sistemaNovo } from '@copiloto/server/src/plataforma/index.ts';
import { entrarComo } from '@copiloto/server/test/ajuda.ts';
import { criarServidor } from '@copiloto/sistema-exemplo/src/servidor.ts';
import { compilar } from '../../build/compilar.ts';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'copiloto-extensao-'));
let horizonte: FastifyInstance;
let urlHorizonte: string;
let copiloto: FastifyInstance;
let plataforma: Plataforma;
let ctx: Contexto;
let config: Config;
let cookieConsole: string;
let navegador: BrowserContext;
let fundo: Worker;
let idExtensao: string;

async function ouvir(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

function consoleApi(metodo: 'GET' | 'POST', url: string, payload?: object) {
  return copiloto.inject({ method: metodo, url: `/api/console${url}`, headers: { cookie: cookieConsole }, payload });
}

function ok(r: LightMyRequestResponse) {
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
}

/** Aba do navegador pela URL (o id que o popup e o fundo usam). */
function abaDe(prefixo: string): Promise<number> {
  return fundo.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(p))?.id ?? -1, prefixo);
}

const barra = (p: Page) => p.locator('copiloto-gravador');

beforeAll(async () => {
  const dist = await compilar({ saida: path.join(temp, 'extensao') });

  horizonte = criarServidor({ arquivoDados: null, logger: false });
  urlHorizonte = await ouvir(horizonte);

  config = {
    ...lerConfig(),
    llmSimulado: true,
    dirDados: path.join(temp, 'dados'),
    navegadorVisivel: false,
    sistema: { nome: 'Horizonte', urlBase: urlHorizonte, urlApi: urlHorizonte, chaveServico: 'chave-servico-local' },
  };
  // A empresa de demonstração, ligada pela API ao Horizonte que subiu aqui.
  plataforma = new Plataforma(config, { emMemoria: true, llm: () => new LlmSimulado() });
  const empresa = plataforma.criarEmpresa({
    nome: 'Horizonte',
    demo: true,
    sistema: { ...sistemaNovo('Horizonte', urlHorizonte), conector: 'api' },
  });
  ctx = plataforma.contexto(empresa.id);
  copiloto = await criarApp(plataforma);
  // O console põe este endereço na URL de gravação (copiloto_api): é para onde a extensão manda os passos.
  config.urlPublica = ctx.config.urlPublica = await ouvir(copiloto);
  cookieConsole = entrarComo(ctx).cookie;

  navegador = await chromium.launchPersistentContext(path.join(temp, 'perfil'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  fundo = navegador.serviceWorkers()[0] ?? (await navegador.waitForEvent('serviceworker'));
  idExtensao = new URL(fundo.url()).host;
}, 120_000);

afterAll(async () => {
  await navegador?.close();
  await copiloto?.close();
  await horizonte?.close();
  await plataforma?.fechar();
  // No Windows o Chromium solta os arquivos do perfil um pouco depois de fechar.
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('extensão no Chromium de verdade', { timeout: 180_000 }, () => {
  it('grava no Horizonte, vira tarefa e roda pelo widget até o recibo', async () => {
    // Ana entra no Horizonte (a gravação abre já com a sessão dela).
    const hz = await navegador.newPage();
    await hz.goto(`${urlHorizonte}/entrar`);
    await hz.click('button[data-usuario-id="101"]');
    await hz.waitForURL(/\/clientes/);

    // Console: começa a gravação.
    const { fluxo, urlGravacao } = ok(await consoleApi('POST', '/fluxos', { nome: 'Abrir chamado', urlInicial: '/chamados' }));
    expect(urlGravacao).toContain(`copiloto_api=${encodeURIComponent(config.urlPublica)}`);

    // A aba de gravação: a extensão marca a página, tira o token da URL e mostra a barra.
    await hz.goto(urlGravacao);
    await expect.poll(() => hz.evaluate(() => document.documentElement.getAttribute('data-copiloto-extensao'))).toBe('0.1.0');
    await barra(hz).getByText('Abrir chamado').waitFor();
    expect(hz.url()).toBe(`${urlHorizonte}/chamados`);

    await hz.getByLabel('Assunto').fill('Impressora sem tinta');
    await hz.getByLabel('Cliente').fill('Padaria Estrela');
    await hz.getByLabel('Cliente').press('Tab');
    await hz.getByLabel('Prioridade').selectOption('Alta');
    await hz.getByLabel('Descrição').fill('A impressora do caixa parou de imprimir os cupons.');
    await hz.getByRole('button', { name: 'Abrir chamado' }).click();
    await hz.waitForURL(/aberto=/);
    // Página nova: a barra volta, com a contagem que veio do fundo.
    await barra(hz).getByText(/\d+ passos/).waitFor();
    await barra(hz).getByRole('button', { name: 'Concluir' }).click();
    await barra(hz).getByText('Gravação enviada. Volte ao console para revisar.').waitFor();

    const gravado = ok(await consoleApi('GET', `/fluxos/${fluxo.id}`)) as Fluxo;
    expect(gravado.etapa).toBe('revisar');
    expect(gravado.passos.map((p) => p.titulo)).toEqual([
      'Abrir a tela de chamados',
      'Preencher assunto',
      'Preencher cliente',
      'Selecionar prioridade',
      'Preencher descrição',
      'Clicar em Abrir chamado',
    ]);
    // Cada evento chegou uma vez só, e nenhum valor digitado.
    const eventos = new Fluxos(ctx.banco, ctx.empresa.id).obter(fluxo.id)!.eventosGravados;
    expect(JSON.stringify(eventos)).not.toMatch(/Impressora sem tinta|Padaria Estrela|cupons/);
    expect(eventos.filter((e) => e.tipo === 'preencher')).toHaveLength(3);
    expect(eventos.filter((e) => e.tipo === 'selecionar')).toHaveLength(1);

    // Mapear: a tarefa nasce dos campos sugeridos. Testar como Ana. Publicar o fluxo e a tarefa.
    const { tarefaId } = ok(await consoleApi('POST', `/fluxos/${fluxo.id}/criar-tarefa`));
    const teste = ok(
      await consoleApi('POST', `/fluxos/${fluxo.id}/testar`, {
        usuarioId: '101',
        valores: { assunto: 'Teste do fluxo gravado', cliente: 'Padaria Estrela', prioridade: 'Baixa', descricao: 'Teste do fluxo gravado pela extensão.' },
      }),
    );
    expect(teste.resultado.ok, JSON.stringify(teste.resultado)).toBe(true);
    ok(await consoleApi('POST', `/fluxos/${fluxo.id}/publicar`));
    const tarefa = ok(await consoleApi('POST', `/tarefas/${tarefaId}/publicar`, {}));
    expect(tarefa.status).toBe('ativa');

    // Widget como Ana: pede do jeito dela, responde o que falta, confirma.
    const inicio = ok(
      await copiloto.inject({
        method: 'POST',
        url: '/api/widget/iniciar',
        payload: {
          chave: ctx.configuracoes.ler('widget_chave_publica'),
          usuario: '101',
          assinatura: assinarUsuario('101', config.segredoWidget),
          pagina: { secao: 'Chamados', titulo: 'Chamados · Horizonte' },
        },
      }),
    );
    const widget = (metodo: 'GET' | 'POST', url: string, payload?: object) =>
      copiloto.inject({ method: metodo, url: `/api/widget${url}`, headers: { authorization: `Bearer ${inicio.token}` }, payload });
    const conversaId = ok(await widget('POST', '/conversas', { contexto: { secao: 'Chamados' } })).id as string;
    const ultimo = <T extends Bloco['tipo']>(tipo: T) =>
      (ctx.conversas.mensagens(conversaId) as MensagemWidget[])
        .flatMap((m) => m.blocos)
        .filter((b): b is Extract<Bloco, { tipo: T }> => b.tipo === tipo)
        .at(-1);
    const dizer = async (texto: string) => {
      ok(await widget('POST', `/conversas/${conversaId}/mensagens`, { texto, idCliente: `e2e-${Date.now()}` }));
      await ctx.agente.ocioso();
      await ctx.motor.ocioso();
    };

    await dizer('Abre um chamado para a Padaria Estrela sobre impressora sem tinta, prioridade alta');
    expect(ultimo('coleta')?.pergunta).toBe('Qual é a descrição?');
    await dizer('A impressora do caixa parou de imprimir os cupons fiscais.');
    const cartao = ultimo('confirmacao')!;
    expect(cartao.campos.map((c) => [c.rotulo, c.valor])).toEqual([
      ['Assunto', 'impressora sem tinta'],
      ['Cliente', 'Padaria Estrela'],
      ['Prioridade', 'Alta'],
      ['Descrição', 'A impressora do caixa parou de imprimir os cupons fiscais'],
    ]);
    const antes = horizonte.horizonte.chamados().length;
    ok(await widget('POST', `/execucoes/${cartao.execucaoId}/confirmar`));
    await expect.poll(() => ultimo('recibo')?.titulo, { timeout: 90_000, interval: 500 }).toBe('Abrir chamado: feito');

    // O navegador do copiloto abriu o chamado no Horizonte, como Ana.
    const chamados = horizonte.horizonte.chamados();
    expect(chamados).toHaveLength(antes + 1);
    expect(chamados.find((c) => c.assunto === 'impressora sem tinta')).toMatchObject({
      prioridade: 'Alta',
      cliente_nome: 'Padaria Estrela Ltda',
      criado_por: '101',
    });
    await hz.close();
  });

  it('continua gravando em outro site na mesma aba, e o popup conclui', async () => {
    // Duas "empresas": 127.0.0.1 e localhost são origens diferentes para o navegador.
    const paginas = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const porta = (paginas.address() as AddressInfo).port;
      if (req.url?.startsWith('/b')) {
        res.end(`<!doctype html><title>Pedidos</title><label for="cod">Código do pedido</label><input id="cod" name="codigo">
<button type="button">Salvar pedido</button>`);
      } else {
        res.end(`<!doctype html><title>Portal</title><h1>Portal do fornecedor</h1><a href="http://localhost:${porta}/b">Ir para pedidos</a>`);
      }
    });
    await new Promise<void>((r) => paginas.listen(0, '127.0.0.1', r));
    const porta = (paginas.address() as AddressInfo).port;
    try {
      const { fluxo, urlGravacao } = ok(
        await consoleApi('POST', '/fluxos', { nome: 'Pedido no portal', urlInicial: `http://127.0.0.1:${porta}/a` }),
      );
      const aba = await navegador.newPage();
      await aba.goto(urlGravacao);
      await barra(aba).getByText('Pedido no portal').waitFor();
      await aba.getByRole('link', { name: 'Ir para pedidos' }).click();
      await aba.waitForURL(`http://localhost:${porta}/b`);
      await barra(aba).getByText('Pedido no portal').waitFor();
      await aba.getByLabel('Código do pedido').fill('PED-123');
      await aba.getByRole('button', { name: 'Salvar pedido' }).click();
      // A barra conta os passos das duas origens.
      await barra(aba).getByText(/· [45] passos/).waitFor();

      // Popup da extensão para esta aba.
      const popup = await navegador.newPage();
      await popup.goto(`chrome-extension://${idExtensao}/popup.html?aba=${await abaDe(`http://localhost:${porta}/b`)}`);
      await popup.getByText(/[45] passos até agora/).waitFor();
      await popup.getByRole('button', { name: 'Concluir' }).click();
      await popup.getByText('Gravação enviada. Volte ao console para revisar.').waitFor();
      // A barra da página fica sabendo.
      await barra(aba).getByText('Gravação enviada. Volte ao console para revisar.').waitFor();

      const gravado = ok(await consoleApi('GET', `/fluxos/${fluxo.id}`)) as Fluxo;
      expect(gravado.etapa).toBe('revisar');
      expect(gravado.passos.map((p) => [p.tipo, p.url])).toEqual([
        ['navegar', '/a'],
        ['clique', '/a'],
        ['preencher', '/b'],
        ['clique', '/b'],
      ]);
      await popup.close();
      await aba.close();
    } finally {
      // O Chromium mantém conexões abertas (keep-alive): fecha na marra para o close terminar.
      paginas.closeAllConnections();
      await new Promise<void>((r) => paginas.close(() => r()));
    }
  });
});

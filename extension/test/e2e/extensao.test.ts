// @vitest-environment node
// De ponta a ponta com a extensão carregada no Chromium de verdade (Playwright, sem janela):
// 1. O popup entra com a conta do console (código curto entregue na aba do console), "Gravar esta
//    aba" abre o Aprender fluxo, a gravação passa por outro site (consulta de CNPJ), o popup conclui,
//    a revisão no console resolve os passos do outro site, o fluxo vira tarefa, é testado e publicado
//    pelo console; no widget, Ana Ribeiro pede, confirma e recebe o recibo, com o chamado aberto.
// 2. A gravação continua quando a aba vai para outro site, e o popup conclui.
// 3. O token da extensão não abre rotas do console e deixa de valer em "Sair".
// 4. Num Chromium sem a extensão, "Instalar o gravador" fica procurando e explica a instalação pelo pacote.
// O copiloto (modo simulado, com o console compilado) e o Horizonte sobem aqui mesmo, em portas
// livres de 127.0.0.1. Com COPILOTO_TELAS=<pasta>, guarda os prints das telas nessa pasta.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { build as compilarVite } from 'vite';
import { chromium, type BrowserContext, type Locator, type Page, type Worker } from 'playwright';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Bloco, Fluxo, MensagemWidget } from '@copiloto/shared';
import { criarApp } from '@copiloto/server/src/app.ts';
import { assinarUsuario } from '@copiloto/server/src/auth/widget.ts';
import { COOKIE_SESSAO } from '@copiloto/server/src/auth/console.ts';
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
let urlCopiloto: string;
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

/** Com COPILOTO_TELAS=<pasta>: guarda o print da página (ou do elemento) para comparar com o design. */
const PASTA_TELAS = process.env.COPILOTO_TELAS;
async function foto(alvo: Page | Locator, nome: string): Promise<void> {
  if (!PASTA_TELAS) return;
  fs.mkdirSync(PASTA_TELAS, { recursive: true });
  await alvo.screenshot({ path: path.join(PASTA_TELAS, `${nome}.png`), animations: 'disabled' });
}

/** O popup numa aba (o tamanho dele é o do .pp), ligado à aba `abaId`. */
async function abrirPopup(abaId: number): Promise<Page> {
  const popup = await navegador.newPage();
  await popup.setViewportSize({ width: 420, height: 720 });
  await popup.goto(`chrome-extension://${idExtensao}/popup.html?aba=${abaId}`);
  return popup;
}

/** Consulta de CNPJ em outro site (localhost é outra origem para o navegador), com uma senha que nunca é gravada. */
function siteDeConsulta(): Promise<{ url: string; host: string; fechar: () => Promise<void> }> {
  const servidor = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="pt-BR"><title>Consulta CNPJ</title><body style="font-family: sans-serif; padding: 24px">
<h1>Consulta de CNPJ</h1><label for="cnpj">CNPJ</label> <input id="cnpj" name="cnpj"><br><br>
<label for="senha">Senha do portal</label> <input id="senha" type="password" name="senha"><br><br>
<button type="button">Consultar</button></body></html>`);
  });
  return new Promise((r) =>
    servidor.listen(0, '127.0.0.1', () => {
      const porta = (servidor.address() as AddressInfo).port;
      r({
        url: `http://localhost:${porta}/consulta`,
        host: `localhost:${porta}`,
        fechar: () => {
          servidor.closeAllConnections();
          return new Promise<void>((f) => servidor.close(() => f()));
        },
      });
    }),
  );
}

beforeAll(async () => {
  const dist = await compilar({ saida: path.join(temp, 'extensao') });
  // O console compilado, servido pelo próprio copiloto (a entrada da extensão e a revisão são telas dele).
  const distConsole = path.join(temp, 'console');
  await compilarVite({
    root: fileURLToPath(new URL('../../../console', import.meta.url)),
    logLevel: 'error',
    build: { outDir: distConsole, emptyOutDir: true },
  });

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
  copiloto = await criarApp(plataforma, { distConsole });
  // O console põe este endereço na URL de gravação (copiloto_api): é para onde a extensão manda os passos.
  // O console é servido no mesmo endereço: é a origem de onde a extensão aceita o código de entrada.
  urlCopiloto = config.urlPublica = ctx.config.urlPublica = await ouvir(copiloto);
  config.urlConsole = ctx.config.urlConsole = urlCopiloto;
  cookieConsole = entrarComo(ctx, 'admin', 'Rafael Lima', 'rafael.lima@horizonte.com.br').cookie;

  navegador = await chromium.launchPersistentContext(path.join(temp, 'perfil'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  fundo = navegador.serviceWorkers()[0] ?? (await navegador.waitForEvent('serviceworker'));
  idExtensao = new URL(fundo.url()).host;
  // O servidor do copiloto nas opções da extensão, e a sessão do console no navegador.
  await fundo.evaluate((s) => chrome.storage.local.set({ servidor: s }), urlCopiloto);
  const [nome, valor] = cookieConsole.split('=');
  expect(nome).toBe(COOKIE_SESSAO);
  await navegador.addCookies([{ name: nome, value: valor, url: urlCopiloto }]);
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
  it('entra pelo popup, grava esta aba, resolve o outro site na revisão, publica e roda pelo widget', async () => {
    // Ana entra no Horizonte (a gravação abre já com a sessão dela).
    const hz = await navegador.newPage();
    await hz.goto(`${urlHorizonte}/entrar`);
    await hz.click('button[data-usuario-id="101"]');
    await hz.waitForURL(/\/clientes/);
    await hz.goto(`${urlHorizonte}/chamados`);
    const abaHz = await abaDe(`${urlHorizonte}/chamados`);

    // E3 · Popup sem conta: "Entrar com a conta do Copiloto" abre a entrada no console.
    let popup = await abrirPopup(abaHz);
    await popup.getByText('Entre para gravar fluxos para a sua empresa').waitFor();
    await foto(popup.locator('.pp'), 'E3-popup-entrar');
    // O popup fecha sozinho depois de abrir a aba do console (como o popup de verdade).
    const [conectar] = await Promise.all([navegador.waitForEvent('page'), popup.getByRole('button', { name: 'Entrar com a conta do Copiloto' }).click()]);
    await conectar.waitForURL(/\/extensao\/conectar\?estado=/);
    await conectar.getByRole('heading', { name: 'Para qual empresa vão as gravações?' }).waitFor();
    expect(await conectar.getByRole('radio', { name: /Horizonte/ }).getAttribute('aria-checked')).toBe('true');
    await foto(conectar, 'E3-console-conectar');
    await conectar.setViewportSize({ width: 390, height: 844 });
    await foto(conectar, 'E3-console-conectar-390');
    await conectar.setViewportSize({ width: 1280, height: 720 });
    await conectar.getByRole('button', { name: 'Conectar o gravador' }).click();
    await conectar.getByRole('heading', { name: 'Gravador conectado' }).waitFor();
    await foto(conectar, 'E3-console-conectado');

    // O token fica na extensão (e só o hash dele no servidor).
    const conta = (await fundo.evaluate(() => chrome.storage.local.get('conta'))).conta as { token: string; sessao: { empresa: { id: string } } };
    expect(conta.token).toMatch(/^cpx_/);
    expect(conta.sessao.empresa.id).toBe(ctx.empresa.id);
    expect(JSON.stringify(plataforma.banco.todos('SELECT * FROM tokens_extensao'))).not.toContain(conta.token);

    // E1 · A página Instalar o gravador percebe a extensão conectada.
    await conectar.goto(`${urlCopiloto}/aprender/instalar`);
    await conectar.getByText('Extensão instalada · versão 0.1.0 · conectada a Horizonte').waitFor();
    await conectar.setViewportSize({ width: 1440, height: 1000 });
    await foto(conectar, 'E1-instalar-conectada-1440');
    await conectar.setViewportSize({ width: 390, height: 844 });
    await foto(conectar, 'E1-instalar-conectada-390');
    await conectar.close();

    // E4 · O popup mostra a empresa e Gravar esta aba.
    popup = await abrirPopup(abaHz);
    await popup.getByText('Horizonte · Rafael Lima').waitFor();
    await popup.getByText('Dados de exemplo').waitFor();
    expect(await popup.locator('#aba-atual').inputValue()).toBe(`${urlHorizonte}/chamados`);
    await popup.getByText('Suas gravações aparecem aqui depois de enviadas.').waitFor();
    await foto(popup.locator('.pp'), 'E4-popup-pronto-vazio');

    // "Gravar esta aba": o Aprender fluxo do console abre com o endereço desta aba já preenchido.
    const [consoleAba] = await Promise.all([navegador.waitForEvent('page'), popup.getByRole('button', { name: 'Gravar esta aba' }).click()]);
    await consoleAba.setViewportSize({ width: 1440, height: 1000 });
    await consoleAba.getByRole('dialog', { name: 'Começar gravação' }).waitFor();
    expect(await consoleAba.getByLabel(/Página onde a tarefa começa/).inputValue()).toBe('/chamados');
    await consoleAba.getByText(/Veio da aba em que você clicou em Gravar esta aba/).waitFor();
    await consoleAba.getByLabel(/Nome do fluxo/).fill('Abrir chamado');
    await foto(consoleAba, 'E5-console-comecar-gravacao');
    const [gravando] = await Promise.all([consoleAba.waitForEvent('popup'), consoleAba.getByRole('button', { name: 'Abrir e gravar' }).click()]);
    await consoleAba.waitForURL(/\/aprender\/flx/);
    const fluxoId = decodeURIComponent(new URL(consoleAba.url()).pathname.split('/').pop()!);
    if (!popup.isClosed()) await popup.close();

    // A aba de gravação: a extensão marca a página, tira o token da URL e mostra a barra e o painel.
    await gravando.setViewportSize({ width: 1440, height: 900 });
    await gravando.waitForURL(`${urlHorizonte}/chamados`);
    await expect.poll(() => gravando.evaluate(() => document.documentElement.getAttribute('data-copiloto-extensao'))).toBe('0.1.0');
    await barra(gravando).getByText('Abrir chamado').waitFor();
    const painel = barra(gravando).getByRole('region', { name: 'Passos gravados' });
    await painel.waitFor();

    await gravando.getByLabel('Assunto').fill('Impressora sem tinta');
    await gravando.getByLabel('Cliente').fill('Padaria Estrela');
    await gravando.getByLabel('Cliente').press('Tab');
    await gravando.getByLabel('Prioridade').selectOption('Alta');
    await gravando.getByLabel('Descrição').fill('A impressora do caixa parou de imprimir os cupons.');
    await gravando.getByLabel('Descrição').press('Tab');
    await painel.getByText('Preencher descrição').waitFor();
    await foto(gravando, 'E7-pagina-gravando-painel');
    await gravando.getByRole('button', { name: 'Abrir chamado' }).click();
    await gravando.waitForURL(/aberto=/);
    await barra(gravando).getByText(/\d+ passos/).waitFor();

    // O caminho passa por outro site: a consulta de CNPJ. O balão mostra só o formato; senha, nem isso.
    const consulta = await siteDeConsulta();
    try {
      await gravando.goto(consulta.url);
      await barra(gravando).getByText('Abrir chamado').waitFor();
      await gravando.getByLabel('CNPJ').fill('12.345.678/0001-90');
      await barra(gravando).getByText('99.999.999/9999-99').waitFor();
      await foto(gravando, 'E7-pagina-balao-formato');
      await gravando.getByLabel('Senha do portal').fill('segredo-do-portal');
      await barra(gravando).getByText('Senha: nada é gravado, nem o formato').waitFor();
      await foto(gravando, 'E7-pagina-balao-senha');
      await gravando.getByRole('button', { name: 'Consultar' }).click();
      await barra(gravando).getByText(/9 passos/).waitFor();

      // E7 → E8 · O popup desta aba está gravando; Concluir envia.
      popup = await abrirPopup(await abaDe(consulta.url));
      await popup.getByText('9 passos').waitFor();
      await popup.getByText('até agora').waitFor();
      await foto(popup.locator('.pp'), 'E7-popup-gravando');
      await popup.getByRole('button', { name: 'Concluir' }).click();
      await popup.getByText('Gravação enviada. Volte ao console para revisar.').waitFor();
      await popup.getByRole('button', { name: 'Abrir no console' }).waitFor();
      await foto(popup.locator('.pp'), 'E8-popup-enviada');
      await barra(gravando).getByText('Gravação enviada. Volte ao console para revisar.').waitFor();
      await popup.close();
    } finally {
      await consulta.fechar();
    }

    const gravado = ok(await consoleApi('GET', `/fluxos/${fluxoId}`)) as Fluxo;
    expect(gravado.etapa).toBe('revisar');
    expect(gravado.passos.map((p) => [p.titulo, p.outroSite ?? null])).toEqual([
      ['Abrir a tela de chamados', null],
      ['Preencher assunto', null],
      ['Preencher cliente', null],
      ['Selecionar prioridade', null],
      ['Preencher descrição', null],
      ['Clicar em Abrir chamado', null],
      [`Abrir o site ${consulta.host}`, consulta.host],
      ['Preencher CNPJ', consulta.host],
      ['Clicar em Consultar', consulta.host],
    ]);
    // Cada evento chegou uma vez só, nenhum valor digitado, e a senha nem virou passo.
    const eventos = new Fluxos(ctx.banco, ctx.empresa.id).obter(fluxoId)!.eventosGravados;
    expect(JSON.stringify(eventos)).not.toMatch(/Impressora sem tinta|Padaria Estrela|cupons|12\.345|segredo-do-portal/);
    expect(eventos.filter((e) => e.tipo === 'preencher')).toHaveLength(4);
    expect(eventos.some((e) => e.elemento?.type === 'password')).toBe(false);
    expect(eventos.filter((e) => e.tipo === 'selecionar')).toHaveLength(1);

    // E4 · Gravações recentes no popup da aba do Horizonte.
    popup = await abrirPopup(abaHz);
    await popup.getByText('Abrir chamado').waitFor();
    await popup.getByText('Enviada agora').waitFor();
    await popup.getByText('A enviada espera a sua revisão no console antes de virar tarefa.').waitFor();
    await foto(popup.locator('.pp'), 'E4-popup-pronto-recentes');
    await popup.close();

    // Revisão: com passo em outro site sem escolha, o fluxo não testa.
    const bloqueado = await consoleApi('POST', `/fluxos/${fluxoId}/testar`, { usuarioId: '101', valores: {} });
    expect(bloqueado.statusCode).toBe(409);
    expect(bloqueado.json().erro).toBe('outro_site_pendente');

    await consoleAba.reload();
    const escolha = (n: number) => consoleAba.getByRole('group', { name: `Passo ${n} foi feito em outro site: ${consulta.host}` });
    await escolha(9).waitFor();
    await foto(consoleAba, 'R-revisar-outro-site-1440');
    await consoleAba.setViewportSize({ width: 390, height: 844 });
    await foto(consoleAba, 'R-revisar-outro-site-390');
    await consoleAba.setViewportSize({ width: 1440, height: 1000 });
    // A consulta em si sai do fluxo; o clique em Consultar fica como instrução para a pessoa.
    await escolha(7).getByRole('button', { name: 'Remover' }).click();
    await consoleAba.getByText(`Passo 7 removido: Abrir o site ${consulta.host}.`).waitFor();
    await escolha(7).getByRole('button', { name: 'Remover' }).click();
    await consoleAba.getByText('Passo 7 removido: Preencher CNPJ.').waitFor();
    await escolha(7).getByRole('button', { name: 'Manter como instrução' }).click();
    await consoleAba.getByText('Passo 7 fica como instrução para a pessoa.').waitFor();

    const revisado = ok(await consoleApi('GET', `/fluxos/${fluxoId}`)) as Fluxo;
    expect(revisado.passos.map((p) => p.titulo).at(-1)).toBe('Clicar em Consultar');
    expect(revisado.passos.at(-1)).toMatchObject({ outroSite: consulta.host, instrucao: true });
    expect(revisado.outrosSitesRemovidos).toEqual([
      { titulo: `Abrir o site ${consulta.host}`, site: consulta.host },
      { titulo: 'Preencher CNPJ', site: consulta.host },
    ]);
    // O CNPJ só servia ao passo removido: não vira campo da tarefa.
    expect(revisado.camposSugeridos.map((c) => c.chave)).not.toContain('cnpj');

    // Mapear: a tarefa nasce dos campos sugeridos. Testar como Ana (a instrução não roda).
    const { tarefaId } = ok(await consoleApi('POST', `/fluxos/${fluxoId}/criar-tarefa`));
    const teste = ok(
      await consoleApi('POST', `/fluxos/${fluxoId}/testar`, {
        usuarioId: '101',
        valores: { assunto: 'Teste do fluxo gravado', cliente: 'Padaria Estrela', prioridade: 'Baixa', descricao: 'Teste do fluxo gravado pela extensão.' },
      }),
    );
    expect(teste.resultado.ok, JSON.stringify(teste.resultado)).toBe(true);

    // Publicar pelo console: o Antes de publicar mostra o outro site resolvido.
    // O teste com sucesso leva o fluxo à etapa Publicar: a página abre nela.
    await consoleAba.reload();
    await consoleAba.getByRole('heading', { name: 'Publicar a versão 1' }).waitFor();
    await consoleAba.getByText('Passos em outro site resolvidos').waitFor();
    await consoleAba.getByText(`Passos em ${consulta.host} removidos · 1 mantido como instrução`).waitFor();
    await consoleAba.getByText('6 passos no Horizonte, sem pendência').waitFor();
    await foto(consoleAba, 'F3-publicar-1440');
    await consoleAba.getByRole('button', { name: 'Publicar versão 1' }).click();
    await consoleAba.getByText('Versão 1 publicada').waitFor();
    await consoleAba.close();
    const tarefa = ok(await consoleApi('POST', `/tarefas/${tarefaId}/publicar`, {}));
    expect(tarefa.status).toBe('ativa');
    // O copiloto conhece a instrução do outro site (vai na descrição da tarefa para o agente).
    expect(ctx.catalogo.instrucoesDoFluxo(fluxoId)).toEqual([`Clicar em Consultar (em ${consulta.host})`]);

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
      await popup.getByText(/^[45] passos$/).waitFor();
      await popup.getByRole('button', { name: 'Concluir' }).click();
      await popup.getByText('Gravação enviada. Volte ao console para revisar.').waitFor();
      // A barra da página fica sabendo.
      await barra(aba).getByText('Gravação enviada. Volte ao console para revisar.').waitFor();

      const gravado = ok(await consoleApi('GET', `/fluxos/${fluxo.id}`)) as Fluxo;
      expect(gravado.etapa).toBe('revisar');
      // Nenhuma das duas origens é o Horizonte: todos os passos ficam marcados como outro site, com o
      // endereço completo, e a troca de site vira um passo de abrir a página.
      const a = `127.0.0.1:${porta}`;
      const b = `localhost:${porta}`;
      expect(gravado.passos.map((p) => [p.tipo, p.url, p.outroSite])).toEqual([
        ['navegar', `http://${a}/a`, a],
        ['clique', `http://${a}/a`, a],
        ['navegar', `http://${b}/b`, b],
        ['preencher', `http://${b}/b`, b],
        ['clique', `http://${b}/b`, b],
      ]);
      await popup.close();
      await aba.close();
    } finally {
      // O Chromium mantém conexões abertas (keep-alive): fecha na marra para o close terminar.
      paginas.closeAllConnections();
      await new Promise<void>((r) => paginas.close(() => r()));
    }
  });
  it('o token da extensão só vale nas rotas dela e deixa de valer em Sair', async () => {
    const { token } = (await fundo.evaluate(() => chrome.storage.local.get('conta'))).conta as { token: string };
    const comToken = (url: string) => copiloto.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    expect((await comToken('/api/extensao/sessao')).statusCode).toBe(200);
    expect((await comToken('/api/console/fluxos')).statusCode).toBe(401);
    expect((await comToken('/api/console/auth/eu')).statusCode).toBe(401);

    const hz = await navegador.newPage();
    await hz.goto(`${urlHorizonte}/entrar`);
    const popup = await abrirPopup(await abaDe(`${urlHorizonte}/entrar`));
    await popup.getByRole('button', { name: 'Trocar de empresa ou de conta' }).click();
    await foto(popup.locator('.pp'), 'E4-popup-trocar');
    await popup.getByRole('button', { name: 'Sair da extensão' }).click();
    await popup.getByText('Entre para gravar fluxos para a sua empresa').waitFor();
    expect((await comToken('/api/extensao/sessao')).statusCode).toBe(401);
    expect((await fundo.evaluate(() => chrome.storage.local.get('conta'))).conta).toBeUndefined();
    await popup.close();
    await hz.close();
  });
  it('sem a extensão: Instalar o gravador procura sozinha e explica a instalação pelo pacote', async () => {
    const semExtensao = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const contexto = await semExtensao.newContext({ viewport: { width: 1440, height: 1000 } });
      const [nome, valor] = cookieConsole.split('=');
      await contexto.addCookies([{ name: nome, value: valor, url: urlCopiloto }]);
      const pagina = await contexto.newPage();
      await pagina.goto(`${urlCopiloto}/aprender/instalar`);
      await pagina.getByText('Procurando a extensão…').waitFor();
      await pagina.getByText(/A extensão ainda não está publicada na loja/).waitFor();
      expect(await pagina.getByRole('link', { name: 'Como instalar pelo pacote' }).getAttribute('href')).toMatch(/#instalar-pelo-pacote-sem-a-loja$/);
      await pagina.getByText('Neste console você está como Rafael Lima, na Horizonte.', { exact: false }).waitFor();
      await pagina.getByRole('list', { name: 'Pessoas que podem gravar' }).getByText('Rafael Lima').waitFor();
      await foto(pagina, 'E1-instalar-procurando-1440');
      await pagina.setViewportSize({ width: 390, height: 844 });
      await foto(pagina, 'E1-instalar-procurando-390');
      // Sem a extensão, a entrada do gravador avisa que não a encontrou nesta aba.
      await pagina.goto(`${urlCopiloto}/extensao/conectar?estado=${'e'.repeat(22)}&desafio=${'d'.repeat(43)}`);
      await pagina.getByText('Não encontrei o gravador nesta aba').waitFor();
      await contexto.close();
    } finally {
      await semExtensao.close();
    }
  });
});

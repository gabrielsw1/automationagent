// Executor do caminho navegador: abre um Chromium compartilhado (Playwright), cria um contexto
// isolado por execução com a sessão de quem pediu (cookies do adaptador, nunca senha), repete os
// passos do fluxo gravado, tira um print mascarado por passo e, quando a tela mudou, pede ajuda
// à recuperação visual. Cada passo vira um evento com texto de negócio.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { casarOpcao, interpretarHora, somenteDigitos, type PassoFluxo } from '@copiloto/shared';
import type { Config } from '../config.ts';
import type { Banco } from '../db/banco.ts';
import { ErroAcessoSistema, type AdaptadorSistema, type CookieNavegador, type SessaoNavegador } from '../adaptadores/tipos.ts';
import type { Llm } from '../llm/tipos.ts';
import type {
  ArquivoGerado,
  Destaque,
  EventoNavegador,
  Navegador,
  PedidoExecucaoNavegador,
  ResultadoNavegador,
} from './tipos.ts';
import { acharSensiveis, borrarImagem } from './mascara.ts';
import { SCRIPT_NOMES } from './pagina.ts';
import { apagarPrintsVencidos, salvarPrint } from './prints.ts';
import { ATRIBUTO_ALVO, coletarElementos, descreverElemento, limparMarcas, perguntarAoClaude } from './recuperacao.ts';
import { localizar, papelDoSeletor } from './seletores.ts';
import { chaveDe, encurtar, mesPorExtenso, minusculaInicial, noPassado } from './texto.ts';

/* Código de página (page.evaluate): nomes do navegador declarados só neste arquivo (ver pagina.ts). */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const window: any;
declare const getComputedStyle: (el: any) => { display: string; visibility: string };
type HTMLElement = any;
type HTMLInputElement = any;
type HTMLOptionElement = any;

export interface DependenciasNavegador {
  config: Config;
  banco: Banco;
  adaptador: AdaptadorSistema;
  llm: Llm;
}

export interface OpcoesNavegador {
  /** Quanto esperar um elemento aparecer (todos os seletores) antes da recuperação visual. */
  tempoElementoMs?: number;
  /** Tempo máximo para abrir uma página. */
  tempoNavegacaoMs?: number;
  /** Tempo máximo para um download começar. */
  tempoDownloadMs?: number;
  /** Depois de um clique, quanto esperar para ver se a página começou a navegar. */
  esperaPosCliqueMs?: number;
  /** Fecha o Chromium depois deste tempo sem execuções. */
  ociosoMs?: number;
  /** Tamanho da janela do navegador (os prints e os destaques usam estas medidas). */
  janela?: { width: number; height: number };
}

const PADROES: Required<OpcoesNavegador> = {
  tempoElementoMs: 10_000,
  tempoNavegacaoMs: 30_000,
  tempoDownloadMs: 30_000,
  esperaPosCliqueMs: 800,
  ociosoMs: 5 * 60_000,
  janela: { width: 1280, height: 800 },
};

type Motivo = Extract<ResultadoNavegador, { ok: false }>['motivo'];

/** Falha de um passo, com a frase de negócio e o que mostrar no console. */
export class FalhaPasso extends Error {
  constructor(
    readonly motivo: Motivo,
    mensagem: string,
    readonly extra: { printId?: string; destaque?: Destaque; candidato?: { texto: string; confianca: number } } = {},
  ) {
    super(mensagem);
    this.name = 'FalhaPasso';
  }
}

class Cancelado extends Error {
  constructor() {
    super('cancelado');
  }
}

export class NavegadorPlaywright implements Navegador {
  private browser: Browser | null = null;
  private abrindo: Promise<Browser> | null = null;
  private ultimaFalha: { em: number; detalhe: string } | null = null;
  private ativos = 0;
  private relogioOcioso: NodeJS.Timeout | null = null;
  private ultimaLimpeza = 0;
  readonly opcoes: Required<OpcoesNavegador>;

  constructor(
    private readonly deps: DependenciasNavegador,
    opcoes: OpcoesNavegador = {},
  ) {
    this.opcoes = { ...PADROES, ...opcoes };
  }

  async disponivel(): Promise<{ ok: boolean; detalhe: string }> {
    try {
      const b = await this.obterBrowser();
      this.agendarFechamento();
      return { ok: true, detalhe: `Navegador pronto (Chromium ${b.version()}).` };
    } catch (e) {
      return { ok: false, detalhe: this.ultimaFalha?.detalhe ?? explicarFalhaAbertura(e) };
    }
  }

  async executar(pedido: PedidoExecucaoNavegador): Promise<ResultadoNavegador> {
    const inicio = Date.now();
    if (pedido.sinal.aborted) return cancelado(pedido, null, inicio);
    this.limparPrintsVencidos();
    let browser: Browser;
    try {
      browser = await this.obterBrowser();
    } catch (e) {
      return {
        ok: false,
        motivo: 'navegador_indisponivel',
        passo: null,
        mensagem: `O fluxo “${pedido.fluxo.nome}” não pode rodar agora: o navegador não abriu neste servidor. ${this.ultimaFalha?.detalhe ?? explicarFalhaAbertura(e)}`,
        duracaoMs: Date.now() - inicio,
      };
    }
    this.ativos++;
    if (this.relogioOcioso) clearTimeout(this.relogioOcioso);
    try {
      const execucao = new ExecucaoFluxo(this.deps, this.opcoes, browser, pedido, inicio);
      return await execucao.rodar();
    } finally {
      this.ativos--;
      this.agendarFechamento();
    }
  }

  /**
   * Entra no sistema como o copiloto entraria antes de um fluxo, sem rodar passos (botão "Testar
   * acesso" do console): com a conta de serviço ou com a sessão pedida para `usuarioId`.
   */
  async testarAcesso(usuarioId = ''): Promise<{ ok: boolean; detalhe: string }> {
    const { adaptador } = this.deps;
    let sessao: SessaoNavegador;
    try {
      sessao = await adaptador.sessaoNavegador(usuarioId);
    } catch (e) {
      return { ok: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
    if (!sessao.login && !sessao.urlEntrada && sessao.cookies.length === 0) {
      return { ok: true, detalhe: `Sem login: o navegador abre as telas do ${adaptador.nome} direto.` };
    }
    let browser: Browser;
    try {
      browser = await this.obterBrowser();
    } catch (e) {
      return { ok: false, detalhe: this.ultimaFalha?.detalhe ?? explicarFalhaAbertura(e) };
    }
    this.ativos++;
    if (this.relogioOcioso) clearTimeout(this.relogioOcioso);
    const contexto = await browser.newContext({
      viewport: this.opcoes.janela,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      extraHTTPHeaders: sessao.cabecalhos,
    });
    try {
      await contexto.route(/\/copiloto\.js(\?.*)?$/, (r) => r.abort());
      if (sessao.cookies.length) await contexto.addCookies(sessao.cookies.map((c) => cookieParaPlaywright(c, adaptador.urlBase)));
      const page = await contexto.newPage();
      if (sessao.login) {
        await entrarComConta(page, sessao.login, adaptador.nome, this.opcoes);
        return { ok: true, detalhe: `Entrou no ${adaptador.nome} como ${sessao.login.usuario}. Depois de entrar, a tela era ${caminhoCurto(page.url())}.` };
      }
      await page.goto(sessao.urlEntrada ?? adaptador.urlBase, { waitUntil: 'load', timeout: this.opcoes.tempoNavegacaoMs });
      if (pareceTelaDeLogin(page.url())) {
        return { ok: false, detalhe: `O ${adaptador.nome} entregou uma sessão para ${usuarioId}, mas pediu para entrar de novo (${caminhoCurto(page.url())}).` };
      }
      return { ok: true, detalhe: `Entrou no ${adaptador.nome} com a sessão de ${usuarioId}. A tela aberta foi ${caminhoCurto(page.url())}.` };
    } catch (e) {
      return { ok: false, detalhe: e instanceof Error ? e.message : String(e) };
    } finally {
      await contexto.close().catch(() => {});
      this.ativos--;
      this.agendarFechamento();
    }
  }

  async fechar(): Promise<void> {
    if (this.relogioOcioso) clearTimeout(this.relogioOcioso);
    this.relogioOcioso = null;
    const b = this.browser ?? (this.abrindo ? await this.abrindo.catch(() => null) : null);
    this.browser = null;
    this.abrindo = null;
    await b?.close().catch(() => {});
  }

  private async obterBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.abrindo) return this.abrindo;
    if (this.ultimaFalha && Date.now() - this.ultimaFalha.em < 60_000) throw new Error(this.ultimaFalha.detalhe);
    this.abrindo = chromium
      .launch({
        headless: !this.deps.config.navegadorVisivel,
        executablePath: this.deps.config.chromiumPath,
        args: ['--disable-dev-shm-usage', '--lang=pt-BR'],
        env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' },
      })
      .then((b) => {
        this.browser = b;
        this.ultimaFalha = null;
        b.on('disconnected', () => {
          if (this.browser === b) this.browser = null;
        });
        return b;
      })
      .catch((e) => {
        this.ultimaFalha = { em: Date.now(), detalhe: explicarFalhaAbertura(e) };
        throw e;
      })
      .finally(() => {
        this.abrindo = null;
      });
    return this.abrindo;
  }

  private agendarFechamento() {
    if (this.relogioOcioso) clearTimeout(this.relogioOcioso);
    if (this.ativos > 0 || !this.browser) return;
    this.relogioOcioso = setTimeout(() => {
      if (this.ativos === 0) void this.fechar();
    }, this.opcoes.ociosoMs);
    this.relogioOcioso.unref();
  }

  private limparPrintsVencidos() {
    if (Date.now() - this.ultimaLimpeza < 3_600_000) return;
    this.ultimaLimpeza = Date.now();
    try {
      apagarPrintsVencidos(this.deps.banco, this.deps.config.dirDados);
    } catch {
      /* a limpeza tenta de novo na próxima hora */
    }
  }
}

function explicarFalhaAbertura(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Executable doesn't exist|executable/i.test(msg)) {
    return 'O Chromium não está instalado. Rode “npx playwright install chromium” no servidor (ou defina CHROMIUM_PATH) e reinicie.';
  }
  return 'O Chromium não abriu neste servidor. Confira a instalação do Playwright e reinicie o servidor.';
}

const CAMPO_USUARIO = 'input:is([type="email"], [type="text"], [type="tel"], :not([type])):visible';

/**
 * Entra no sistema com a conta de serviço: abre a página de login, preenche o primeiro campo de
 * texto do formulário da senha e a senha, envia e espera o campo de senha sumir.
 */
export async function entrarComConta(
  page: Page,
  login: NonNullable<SessaoNavegador['login']>,
  sistema: string,
  opcoes: Pick<Required<OpcoesNavegador>, 'tempoElementoMs' | 'tempoNavegacaoMs'>,
): Promise<void> {
  const conferir = `Confira em Sistema, no console, a página de login, o usuário e a senha da conta do copiloto.`;
  try {
    await page.goto(login.url, { waitUntil: 'load', timeout: opcoes.tempoNavegacaoMs });
  } catch {
    throw new FalhaPasso('sessao_expirada', `Não consegui abrir a página de login do ${sistema} (${caminhoCurto(login.url)}). ${conferir}`);
  }
  const senha = page.locator('input[type="password"]:visible').first();
  try {
    await senha.waitFor({ state: 'visible', timeout: opcoes.tempoElementoMs });
  } catch {
    throw new FalhaPasso('sessao_expirada', `A página ${caminhoCurto(page.url())} do ${sistema} não tem campo de senha. ${conferir}`);
  }
  const formulario = page.locator('form', { has: page.locator('input[type="password"]') }).first();
  const escopo = (await formulario.count()) > 0 ? formulario : page.locator('body');
  const usuario = escopo.locator(CAMPO_USUARIO).first();
  if ((await usuario.count()) === 0) {
    throw new FalhaPasso('sessao_expirada', `Na página de login do ${sistema} não achei o campo do usuário. ${conferir}`);
  }
  await usuario.fill(login.usuario);
  await senha.fill(login.senha);
  const enviar = escopo.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:not([type]):visible').first();
  const navegou = page
    .waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: opcoes.tempoElementoMs })
    .catch(() => null);
  if ((await enviar.count()) > 0) await enviar.click();
  else await senha.press('Enter');
  await navegou;
  await page.waitForLoadState('load', { timeout: opcoes.tempoNavegacaoMs }).catch(() => {});
  // Entrou quando o campo de senha some. Se ele continua e a tela mostra um aviso, o sistema recusou.
  const limite = Date.now() + opcoes.tempoElementoMs;
  const desde = Date.now();
  let avisos: string[] = [];
  while (Date.now() < limite) {
    if (!(await senha.isVisible().catch(() => false))) return;
    avisos = await lerAvisosDaPagina(page);
    if (avisos.length && Date.now() - desde > 1_500) break;
    await page.waitForTimeout(250);
  }
  const motivo = avisos.length ? ` A tela disse: “${encurtar(avisos.join(' · '), 160)}”.` : '';
  throw new FalhaPasso('sessao_expirada', `O ${sistema} não aceitou a conta do copiloto (${login.usuario}).${motivo} ${conferir}`);
}

function cancelado(p: PedidoExecucaoNavegador, passo: number | null, inicio: number): ResultadoNavegador {
  return {
    ok: false,
    motivo: 'cancelado',
    passo,
    mensagem: passo
      ? `A execução foi cancelada no passo ${passo}. O que já tinha sido feito na tela até ali pode ter ficado gravado.`
      : 'A execução foi cancelada antes de começar. Nada foi feito no sistema.',
    duracaoMs: Date.now() - inicio,
  };
}

interface Achado {
  loc: Locator;
  caixa?: Destaque;
  /** Como o elemento foi achado, para contar no detalhe do passo. */
  detalhe?: string;
  recuperado?: boolean;
}

interface FimPasso {
  titulo?: string;
  detalhe?: string;
  destaque?: Destaque;
}

/** Uma execução de fluxo: contexto próprio, passos em ordem, prints e eventos. */
class ExecucaoFluxo {
  private contexto: BrowserContext | null = null;
  private page!: Page;
  private passoAtual: number | null = null;
  private readonly gerados: Record<string, string> = {};
  private readonly arquivos: ArquivoGerado[] = [];
  private recuperacoes = 0;
  private nomePessoa = 'a pessoa que pediu';
  private readonly sistema: string;

  constructor(
    private readonly deps: DependenciasNavegador,
    private readonly opcoes: Required<OpcoesNavegador>,
    private readonly browser: Browser,
    private readonly pedido: PedidoExecucaoNavegador,
    private readonly inicio: number,
  ) {
    this.sistema = deps.adaptador.nome;
  }

  async rodar(): Promise<ResultadoNavegador> {
    const { pedido } = this;
    const aoCancelar = () => void this.contexto?.close().catch(() => {});
    pedido.sinal.addEventListener('abort', aoCancelar, { once: true });
    try {
      await this.abrirSessao();
      const passos = pedido.fluxo.passos;
      if (passos[0]?.tipo !== 'navegar') await this.irPara(pedido.fluxo.urlInicial ?? '/');
      for (const passo of passos) {
        this.verificarCancelamento();
        this.passoAtual = passo.n;
        this.emitir({ tipo: 'passo_inicio', passo: passo.n, titulo: passo.titulo });
        const fim = await this.rodarPasso(passo);
        const titulo = fim.titulo ?? noPassado(passo.titulo);
        const printId = await this.fotografar(`Passo ${passo.n} · ${titulo}`, fim.destaque);
        this.emitir({ tipo: 'passo_ok', passo: passo.n, titulo, detalhe: fim.detalhe, printId, destaque: fim.destaque });
      }
      return {
        ok: true,
        gerados: this.gerados,
        arquivos: this.arquivos,
        duracaoMs: Date.now() - this.inicio,
        recuperacoes: this.recuperacoes,
      };
    } catch (e) {
      return await this.resultadoDeFalha(e);
    } finally {
      pedido.sinal.removeEventListener('abort', aoCancelar);
      await this.contexto?.close().catch(() => {});
    }
  }

  // ---------- Sessão e navegação ----------

  private async abrirSessao() {
    const { adaptador } = this.deps;
    const pessoa = await adaptador.buscarUsuario(this.pedido.usuarioId).catch(() => null);
    if (pessoa) this.nomePessoa = pessoa.nome;
    let sessao;
    try {
      sessao = await adaptador.sessaoNavegador(this.pedido.usuarioId);
    } catch (e) {
      if (e instanceof ErroAcessoSistema) throw new FalhaPasso('sessao_expirada', `${e.message} Nada foi feito no sistema.`);
      throw new FalhaPasso(
        'sessao_expirada',
        `Não consegui abrir uma sessão no ${this.sistema} para ${this.nomePessoa}. Confira se o ${this.sistema} está no ar e se a pessoa ainda tem acesso.`,
      );
    }
    this.verificarCancelamento();
    this.contexto = await this.browser.newContext({
      viewport: this.opcoes.janela,
      acceptDownloads: true,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      extraHTTPHeaders: sessao.cabecalhos,
    });
    // O widget do copiloto também está nas telas do sistema; no navegador do copiloto ele só atrapalha.
    await this.contexto.route(/\/copiloto\.js(\?.*)?$/, (r) => r.abort());
    // Código de página transformado pelo tsx chama __name (ver pagina.ts).
    await this.contexto.addInitScript({ content: SCRIPT_NOMES });
    if (sessao.cookies.length) await this.contexto.addCookies(sessao.cookies.map((c) => cookieParaPlaywright(c, adaptador.urlBase)));
    this.page = await this.contexto.newPage();
    this.page.setDefaultTimeout(this.opcoes.tempoElementoMs);
    this.page.setDefaultNavigationTimeout(this.opcoes.tempoNavegacaoMs);
    if (sessao.login) {
      // Conector só pela tela: o navegador entra com a conta de serviço que a empresa cadastrou.
      await entrarComConta(this.page, sessao.login, this.sistema, this.opcoes);
      this.verificarCancelamento();
      this.emitir({
        tipo: 'login',
        titulo: `Entrou no ${this.sistema} com a conta do copiloto`,
        detalhe: `Usou a conta de serviço ${sessao.login.usuario}, cadastrada pela empresa. O pedido foi de ${this.nomePessoa}.`,
      });
      return;
    }
    if (sessao.urlEntrada) {
      // Modo sessão com link de entrada única: abrir o link deixa o navegador logado como a pessoa.
      try {
        await this.page.goto(sessao.urlEntrada, { waitUntil: 'load', timeout: this.opcoes.tempoNavegacaoMs });
      } catch {
        this.verificarCancelamento();
        throw new FalhaPasso('sessao_expirada', `O link de entrada do ${this.sistema} para ${this.nomePessoa} não abriu. Nada foi feito no sistema.`);
      }
      if (pareceTelaDeLogin(this.page.url())) throw this.falhaSessao();
    }
    const logado = sessao.cookies.length > 0 || !!sessao.urlEntrada;
    this.emitir({
      tipo: 'login',
      titulo: logado ? `Entrou no ${this.sistema} com a sessão de ${this.nomePessoa}` : `Abriu o ${this.sistema}`,
      detalhe: logado
        ? `O navegador usa as permissões de ${this.nomePessoa}, sem senha. A sessão vale só para esta execução.`
        : `O navegador abre as telas do ${this.sistema} sem entrar com nenhuma conta.`,
    });
  }

  private async irPara(url: string) {
    const destino = new URL(url || '/', this.deps.adaptador.urlBase).toString();
    let resposta;
    try {
      resposta = await this.page.goto(destino, { waitUntil: 'load', timeout: this.opcoes.tempoNavegacaoMs });
    } catch (e) {
      this.verificarCancelamento();
      if (e instanceof errors.TimeoutError) {
        throw new FalhaPasso('tempo_esgotado', `O ${this.sistema} demorou demais para abrir a tela ${caminhoCurto(destino)}. Tente de novo em alguns minutos.`);
      }
      throw new FalhaPasso('erro', `Não consegui abrir a tela ${caminhoCurto(destino)} do ${this.sistema}: o sistema não respondeu.`);
    }
    const status = resposta?.status() ?? 200;
    await this.verificarSessao(destino);
    if (status === 401) throw this.falhaSessao();
    if (status === 403) {
      throw new FalhaPasso('erro', `${this.nomePessoa} não tem permissão para abrir a tela ${caminhoCurto(destino)} no ${this.sistema}.`);
    }
    if (status === 404) throw new FalhaPasso('erro', `A tela ${caminhoCurto(destino)} não existe mais no ${this.sistema}. O fluxo precisa ser gravado de novo.`);
    if (status >= 500) throw new FalhaPasso('erro', `O ${this.sistema} não respondeu direito (erro ${status}). Tente de novo em alguns minutos.`);
  }

  private falhaSessao() {
    return new FalhaPasso(
      'sessao_expirada',
      `A sessão de ${this.nomePessoa} no ${this.sistema} não vale mais: o sistema pediu para entrar de novo. Nada foi feito a partir daqui.`,
    );
  }

  /** A tela atual é a de entrar no sistema (sessão expirada ou recusada)? */
  private async verificarSessao(destino?: string) {
    const atual = new URL(this.page.url());
    const pedido = destino ? new URL(destino) : null;
    if (pareceTelaDeLogin(atual.toString()) && (!pedido || pedido.pathname !== atual.pathname)) throw this.falhaSessao();
  }

  private async aguardarNavegacaoDepoisDoClique(navegou: Promise<unknown>) {
    const houve = await navegou;
    if (houve) await this.page.waitForLoadState('load', { timeout: this.opcoes.tempoNavegacaoMs }).catch(() => {});
  }

  private esperarNavegacao(): Promise<unknown> {
    return this.page
      .waitForEvent('framenavigated', { predicate: (f) => f === this.page.mainFrame(), timeout: this.opcoes.esperaPosCliqueMs })
      .catch(() => null);
  }

  // ---------- Passos ----------

  private async rodarPasso(passo: PassoFluxo): Promise<FimPasso> {
    switch (passo.tipo) {
      case 'navegar':
        await this.irPara(passo.url ?? this.pedido.fluxo.urlInicial ?? '/');
        return {};
      case 'esperar':
        return this.esperar(passo);
      case 'preencher':
        return this.preencher(passo);
      case 'selecionar':
        return this.selecionar(passo);
      case 'clique':
        return this.clicar(passo);
      case 'leitura':
        return this.ler(passo);
      case 'download':
        return this.baixar(passo);
      default:
        throw new FalhaPasso('erro', `O passo ${(passo as PassoFluxo).n} tem um tipo que o navegador não conhece.`);
    }
  }

  private async esperar(passo: PassoFluxo): Promise<FimPasso> {
    if (passo.seletores.length) {
      const achado = await this.procurar(passo, this.opcoes.tempoNavegacaoMs);
      if (!achado) {
        throw new FalhaPasso('tempo_esgotado', `Esperei ${rotuloDo(passo)} aparecer na tela, mas não apareceu a tempo.`);
      }
      return { destaque: achado.caixa };
    }
    const ms = passo.valor?.origem === 'fixo' ? Number(passo.valor.valor) : NaN;
    if (Number.isFinite(ms) && ms > 0) await this.dormir(Math.min(ms, 30_000));
    else await this.page.waitForLoadState('networkidle', { timeout: this.opcoes.tempoElementoMs }).catch(() => {});
    return { titulo: passo.titulo ? noPassado(passo.titulo) : 'Esperou a tela carregar' };
  }

  /** Valor do passo: do campo da tarefa, fixo, ou null (não preencher / sem valor). */
  private valorDoPasso(passo: PassoFluxo): { valor: string | null; aviso?: string } {
    const v = passo.valor;
    if (!v || v.origem === 'nao_preencher') return { valor: null };
    if (v.origem === 'fixo') return { valor: v.valor };
    const valor = this.pedido.valores[v.campo];
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return { valor: null, aviso: `O pedido não trouxe “${v.campo}”, então ${rotuloDo(passo)} ficou como estava.` };
    }
    return { valor: String(valor) };
  }

  private async preencher(passo: PassoFluxo): Promise<FimPasso> {
    const { valor, aviso } = this.valorDoPasso(passo);
    if (valor === null) {
      if (aviso) this.emitir({ tipo: 'aviso', passo: passo.n, titulo: `Deixou ${rotuloDo(passo)} em branco`, detalhe: aviso });
      return { titulo: `Deixou ${rotuloDo(passo)} como estava` };
    }
    const achado = await this.acharElemento(passo);
    const info = await achado.loc.evaluate((el) => ({ tag: el.tagName.toLowerCase(), tipo: (el.getAttribute('type') ?? '').toLowerCase() }));
    if (info.tag === 'select') {
      const det = await this.escolherNaLista(achado.loc, valor, passo);
      return this.fim(achado, det);
    }
    if (info.tipo === 'checkbox' || info.tipo === 'radio') {
      await achado.loc.setChecked(/^(sim|s|true|1|marcar|marcado|yes)$/i.test(valor.trim()));
    } else {
      await achado.loc.fill(ajustarFormato(valor, info.tipo, passo.formatoGravado));
    }
    return this.fim(achado);
  }

  private async selecionar(passo: PassoFluxo): Promise<FimPasso> {
    const { valor, aviso } = this.valorDoPasso(passo);
    if (valor === null) {
      if (aviso) this.emitir({ tipo: 'aviso', passo: passo.n, titulo: `Deixou ${rotuloDo(passo)} como estava`, detalhe: aviso });
      return { titulo: `Deixou ${rotuloDo(passo)} como estava` };
    }
    const achado = await this.acharElemento(passo);
    const tag = await achado.loc.evaluate((el) => el.tagName.toLowerCase());
    if (tag !== 'select') {
      await achado.loc.fill(valor);
      return this.fim(achado);
    }
    const det = await this.escolherNaLista(achado.loc, valor, passo);
    return this.fim(achado, det);
  }

  private async escolherNaLista(loc: Locator, valor: string, passo: PassoFluxo): Promise<string> {
    const opcoes = await loc
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ texto: (o.textContent ?? '').replace(/\s+/g, ' ').trim(), valor: (o as HTMLOptionElement).value })));
    const escolhida = escolherOpcao(valor, opcoes);
    if (!escolhida) {
      const lista = opcoes
        .map((o) => o.texto)
        .filter(Boolean)
        .slice(0, 8)
        .join(', ');
      throw new FalhaPasso('erro', `${maiuscula(rotuloDo(passo))} não tem a opção “${encurtar(valor, 60)}”. Opções da tela: ${lista}.`);
    }
    await loc.selectOption({ value: escolhida.valor });
    return `Opção “${escolhida.texto}”`;
  }

  private async clicar(passo: PassoFluxo): Promise<FimPasso> {
    const achado = await this.acharElemento(passo);
    const navegou = this.esperarNavegacao();
    await achado.loc.click();
    await limparMarcas(this.page);
    await this.aguardarNavegacaoDepoisDoClique(navegou);
    return this.fim(achado);
  }

  private async ler(passo: PassoFluxo): Promise<FimPasso> {
    const achado = await this.acharElemento(passo);
    const limite = Date.now() + Math.max(2_000, this.opcoes.tempoElementoMs / 2);
    let texto = '';
    for (;;) {
      texto = await achado.loc
        .evaluate((el) => {
          const tag = el.tagName.toLowerCase();
          const v = ['input', 'textarea', 'select'].includes(tag) ? (el as HTMLInputElement).value : (el as HTMLElement).innerText || el.textContent;
          return (v ?? '').replace(/\s+/g, ' ').trim();
        })
        .catch(() => '');
      if (texto || Date.now() > limite) break;
      await this.dormir(250);
    }
    if (!texto) throw new FalhaPasso('erro', `${maiuscula(rotuloDo(passo))} apareceu vazio na tela, então não deu para ler.`);
    const chave = passo.gera || chaveDe(passo.rotuloElemento || passo.titulo);
    this.gerados[chave] = texto;
    return this.fim(achado, `${passo.rotuloElemento ?? chave}: ${encurtar(texto, 120)}`);
  }

  private async baixar(passo: PassoFluxo): Promise<FimPasso> {
    const achado = await this.acharElemento(passo);
    const download = this.page.waitForEvent('download', { timeout: this.opcoes.tempoDownloadMs });
    download.catch(() => {});
    const navegou = this.esperarNavegacao();
    await achado.loc.click();
    let d;
    try {
      d = await download;
    } catch {
      this.verificarCancelamento();
      throw new FalhaPasso('tempo_esgotado', `Cliquei ${comPreposicao('em', rotuloDo(passo))}, mas nenhum arquivo foi baixado.`, { destaque: achado.caixa });
    }
    const falha = await d.failure();
    if (falha) throw new FalhaPasso('erro', `O ${this.sistema} começou a enviar o arquivo, mas o download falhou.`);
    const nome = nomeArquivoSeguro(d.suggestedFilename() || 'arquivo');
    const pasta = path.join(this.deps.config.dirDados, 'arquivos', pastaSegura(this.pedido.execucaoId));
    fs.mkdirSync(pasta, { recursive: true });
    const caminho = caminhoLivre(pasta, nome);
    await d.saveAs(caminho);
    const arquivo: ArquivoGerado = { nome: path.basename(caminho), caminho, tipo: tipoDoArquivo(caminho) };
    this.arquivos.push(arquivo);
    if (passo.gera) this.gerados[passo.gera] = arquivo.nome;
    await limparMarcas(this.page);
    await this.aguardarNavegacaoDepoisDoClique(navegou);
    return this.fim(achado, `Arquivo “${arquivo.nome}”`);
  }

  private fim(achado: Achado, detalhe?: string): FimPasso {
    const partes = [detalhe, achado.detalhe].filter(Boolean);
    return { destaque: achado.caixa, detalhe: partes.length ? partes.join(' · ') : undefined };
  }

  // ---------- Achar o elemento ----------

  private async acharElemento(passo: PassoFluxo): Promise<Achado> {
    if (!passo.seletores.length) {
      throw new FalhaPasso('erro', `O passo ${passo.n} não diz qual elemento da tela usar. Revise o fluxo em Aprender fluxo.`);
    }
    const achado = await this.procurar(passo, this.opcoes.tempoElementoMs);
    if (achado) return achado;
    await this.verificarSessao();
    return this.recuperar(passo);
  }

  /** Tenta o seletor escolhido e depois os outros candidatos, até o tempo limite. */
  private async procurar(passo: PassoFluxo, tempoMs: number): Promise<Achado | null> {
    const escolhido = Math.min(Math.max(0, passo.seletorEscolhido ?? 0), passo.seletores.length - 1);
    const ordem = [escolhido, ...passo.seletores.map((_, i) => i).filter((i) => i !== escolhido)];
    const exigeVisivel = passo.tipo !== 'leitura' && passo.tipo !== 'selecionar';
    const limite = Date.now() + tempoMs;
    for (;;) {
      this.verificarCancelamento();
      for (const i of ordem) {
        let loc: Locator;
        try {
          loc = localizar(this.page, passo.seletores[i].seletor);
          const alvo = exigeVisivel ? loc.filter({ visible: true }).first() : loc.first();
          if ((await alvo.count()) === 0) continue;
          const caixa = await caixaDe(alvo);
          return {
            loc: alvo,
            caixa,
            detalhe: i === escolhido ? undefined : `Achou pelo jeito ${i + 1} (${descreverJeito(passo.seletores[i].seletor)}), porque o principal não serviu mais`,
          };
        } catch (e) {
          if (this.pedido.sinal.aborted) throw new Cancelado();
          if (isFechado(e)) throw e;
          // seletor inválido ou página trocando: tenta o próximo
        }
      }
      if (Date.now() >= limite) return null;
      await this.dormir(200);
    }
  }

  /** Recuperação visual: print + elementos da tela → Claude escolhe; age só com confiança suficiente. */
  private async recuperar(passo: PassoFluxo): Promise<Achado> {
    const minima = this.pedido.confiancaMinima;
    const elementos = await coletarElementos(this.page).catch(() => []);
    const imagem = await this.capturar();
    let elemento: (typeof elementos)[number] | null = null;
    let confianca = 0;
    let motivo = '';
    try {
      const r = await perguntarAoClaude(this.deps.llm, passo, elementos, imagem, this.pedido.execucaoId, this.page.url());
      elemento = r.elemento;
      confianca = r.confianca;
      motivo = r.motivo;
    } catch {
      this.verificarCancelamento();
      motivo = 'A recuperação visual não respondeu agora.';
    }
    const destaque = elemento?.caixa;
    const candidato = elemento ? { texto: descreverElemento(elemento), confianca: arredondar(confianca) } : undefined;
    const printId = imagem
      ? salvarPrint(this.deps.banco, this.deps.config.dirDados, imagem, {
          execucaoId: this.pedido.execucaoId,
          legenda: `Passo ${passo.n} · a tela mudou${candidato ? ` · candidato “${candidato.texto}”` : ''}`,
          destaque,
          mascarado: this.pedido.mascararPrints,
        })
      : undefined;
    if (!elemento || !candidato || confianca < minima) {
      await limparMarcas(this.page);
      const avisos = await lerAvisosDaPagina(this.page);
      throw new FalhaPasso('elemento_nao_encontrado', this.mensagemNaoAchou(passo, candidato, minima, avisos), { printId, destaque, candidato });
    }
    this.recuperacoes++;
    this.emitir({
      tipo: 'recuperacao',
      passo: passo.n,
      titulo: `A tela mudou: usou “${candidato.texto}” no lugar ${comPreposicao('de', rotuloDo(passo))}`,
      detalhe: `${motivo} Confiança de ${pct(confianca)}; o mínimo desta tarefa é ${pct(minima)}.`,
      printId,
      destaque,
      candidato,
    });
    return {
      loc: this.page.locator(`[${ATRIBUTO_ALVO}="${elemento.indice}"]`),
      caixa: destaque,
      detalhe: `Achado pela recuperação visual (confiança de ${pct(confianca)})`,
      recuperado: true,
    };
  }

  private mensagemNaoAchou(passo: PassoFluxo, candidato: { texto: string; confianca: number } | undefined, minima: number, avisos: string[]): string {
    const acao = { clique: 'clicar', download: 'clicar', preencher: 'preencher', selecionar: 'escolher', leitura: 'ler' }[passo.tipo as string] ?? 'seguir';
    let msg = candidato
      ? `A tela mudou e não achei ${rotuloDo(passo)}. O mais parecido é “${candidato.texto}”, com confiança de ${pct(candidato.confianca)}, abaixo do mínimo de ${pct(minima)} desta tarefa; por isso parei sem ${acao}.`
      : `A tela mudou e não achei ${rotuloDo(passo)} nem nada parecido; por isso parei sem ${acao}.`;
    if (avisos.length) msg += ` O ${this.sistema} mostrou: “${encurtar(avisos[0], 160)}”.`;
    return msg;
  }

  // ---------- Prints ----------

  /**
   * Print da página inteira. Com a segurança pedindo, acha os dados sensíveis, tira o print e
   * borra essas regiões na imagem. Se o borrão falhar, não há print (nunca sai sem máscara).
   */
  private async capturar(): Promise<Buffer | null> {
    if (!this.page || this.page.isClosed()) return null;
    try {
      const caixas = this.pedido.mascararPrints ? await acharSensiveis(this.page) : [];
      const imagem = await this.page.screenshot({ fullPage: true, animations: 'disabled', timeout: 10_000 });
      if (!caixas.length) return imagem;
      return await borrarImagem(await this.paginaAuxiliar(), imagem, caixas);
    } catch {
      return null;
    }
  }

  /** Página em branco do mesmo contexto, usada só para borrar os prints. */
  private auxiliar: Page | null = null;
  private async paginaAuxiliar(): Promise<Page> {
    if (this.auxiliar && !this.auxiliar.isClosed()) return this.auxiliar;
    this.auxiliar = await this.contexto!.newPage();
    await this.auxiliar.evaluate(SCRIPT_NOMES);
    return this.auxiliar;
  }

  private async fotografar(legenda: string, destaque?: Destaque): Promise<string | undefined> {
    const imagem = await this.capturar();
    if (!imagem) return undefined;
    return salvarPrint(this.deps.banco, this.deps.config.dirDados, imagem, {
      execucaoId: this.pedido.execucaoId,
      legenda,
      destaque: destaque ?? null,
      mascarado: this.pedido.mascararPrints,
    });
  }

  // ---------- Fim com falha ----------

  private async resultadoDeFalha(e: unknown): Promise<ResultadoNavegador> {
    const { pedido } = this;
    if (pedido.sinal.aborted || e instanceof Cancelado) return cancelado(pedido, this.passoAtual, this.inicio);
    let falha: FalhaPasso;
    if (e instanceof FalhaPasso) falha = e;
    else if (e instanceof errors.TimeoutError) {
      falha = new FalhaPasso('tempo_esgotado', `O ${this.sistema} demorou demais para responder no passo ${this.passoAtual ?? 1}.`);
    } else {
      const avisos = this.page ? await lerAvisosDaPagina(this.page) : [];
      falha = new FalhaPasso(
        'erro',
        `Algo deu errado no passo ${this.passoAtual ?? 1} do fluxo “${pedido.fluxo.nome}”.${avisos.length ? ` O ${this.sistema} mostrou: “${encurtar(avisos[0], 160)}”.` : ''}`,
      );
    }
    let printId = falha.extra.printId;
    if (!printId && this.page && this.passoAtual !== null) {
      printId = await this.fotografar(`Passo ${this.passoAtual} · falhou`, falha.extra.destaque);
    }
    if (this.passoAtual !== null) {
      const passo = pedido.fluxo.passos.find((p) => p.n === this.passoAtual);
      this.emitir({
        tipo: 'passo_falhou',
        passo: this.passoAtual,
        titulo: passo ? `Não conseguiu: ${minusculaInicial(passo.titulo)}` : 'O passo falhou',
        detalhe: falha.message,
        printId,
        destaque: falha.extra.destaque,
        candidato: falha.extra.candidato,
      });
    }
    return {
      ok: false,
      motivo: falha.motivo,
      passo: this.passoAtual,
      mensagem: falha.message,
      printId,
      destaque: falha.extra.destaque,
      candidato: falha.extra.candidato,
      duracaoMs: Date.now() - this.inicio,
    };
  }

  // ---------- Utilidades ----------

  private emitir(e: EventoNavegador) {
    try {
      this.pedido.aoEvento(e);
    } catch {
      /* quem ouve não pode derrubar a execução */
    }
  }

  private verificarCancelamento() {
    if (this.pedido.sinal.aborted) throw new Cancelado();
  }

  private dormir(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.pedido.sinal.aborted) return reject(new Cancelado());
      const t = setTimeout(() => {
        this.pedido.sinal.removeEventListener('abort', parar);
        resolve();
      }, ms);
      const parar = () => {
        clearTimeout(t);
        reject(new Cancelado());
      };
      this.pedido.sinal.addEventListener('abort', parar, { once: true });
    });
  }
}

// ---------- Funções de apoio ----------

/** Como o passo se refere ao elemento, em linguagem simples: o botão “Salvar”, o campo “CNPJ”. */
export function rotuloDo(passo: PassoFluxo): string {
  const nome = passo.rotuloElemento?.trim() || passo.titulo.replace(/^\S+\s+(em\s+)?/i, '').trim();
  switch (passo.tipo) {
    case 'clique':
    case 'download':
      return papelDoSeletor(passo.seletores) === 'link' ? `o link “${nome}”` : `o botão “${nome}”`;
    case 'preencher':
      return `o campo “${nome}”`;
    case 'selecionar':
      return `a lista “${nome}”`;
    default:
      return `“${nome}”`;
  }
}

/** Junta a preposição ao artigo, como se fala: de + o campo = do campo; em + a lista = na lista. */
export function comPreposicao(prep: 'de' | 'em', rotulo: string): string {
  const m = rotulo.match(/^(o|a) (.*)$/);
  if (!m) return `${prep} ${rotulo}`;
  const junto = prep === 'de' ? (m[1] === 'o' ? 'do' : 'da') : m[1] === 'o' ? 'no' : 'na';
  return `${junto} ${m[2]}`;
}

function maiuscula(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function descreverJeito(seletor: string): string {
  if (seletor.startsWith('label=')) return 'pelo rótulo';
  if (seletor.startsWith('role=')) return 'pelo texto do botão';
  if (seletor.startsWith('text=')) return 'pelo texto na tela';
  if (seletor.startsWith('placeholder=')) return 'pelo texto de exemplo';
  if (/\[name=/.test(seletor)) return 'pelo nome interno';
  if (/^#/.test(seletor)) return 'pelo identificador';
  if (/data-(testid|campo)/.test(seletor)) return 'pela marca do sistema';
  return 'pela posição na tela';
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function isFechado(e: unknown): boolean {
  return e instanceof Error && /Target (page|context|browser|closed)|has been closed/i.test(e.message);
}

async function caixaDe(loc: Locator): Promise<Destaque | undefined> {
  try {
    const caixa = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return caixa.w > 0 && caixa.h > 0 ? caixa : undefined;
  } catch {
    return undefined;
  }
}

/** Textos de aviso e erro visíveis na tela (para explicar por que um passo falhou). */
export async function lerAvisosDaPagina(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const sel =
        '[role=alert], [role=status], .alert, .alerta, .erro, .error, .errors, .aviso, .invalid-feedback, .field-error, .flash, .notice, .vazio, .empty, [data-erro], [aria-live]';
      const textos: string[] = [];
      for (const el of Array.from<any>(document.querySelectorAll(sel))) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 3 && t.length <= 300 && !textos.includes(t)) textos.push(t);
        if (textos.length >= 3) break;
      }
      return textos;
    })
    .catch(() => []);
}

/** Opção da lista que corresponde ao valor: pelo texto, pelo valor interno ou pelo mês por extenso. */
export function escolherOpcao(valor: string, opcoes: { texto: string; valor: string }[]): { texto: string; valor: string } | null {
  const validas = opcoes.filter((o) => o.texto || o.valor);
  const textos = validas.map((o) => o.texto);
  const v = valor.trim();
  const exata = validas.find((o) => o.texto === v || o.valor === v);
  if (exata) return exata;
  const porTexto = casarOpcao(v, textos);
  if (porTexto) return validas.find((o) => o.texto === porTexto) ?? null;
  const porValor = validas.find((o) => o.valor && o.valor.toLowerCase() === v.toLowerCase());
  if (porValor) return porValor;
  const tentativas: string[] = [];
  const mes = mesPorExtenso(v);
  if (mes) tentativas.push(mes);
  const iso = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (iso) tentativas.push(`${iso[2]}/${iso[1]}`);
  for (const t of tentativas) {
    const c = casarOpcao(t, textos);
    if (c) return validas.find((o) => o.texto === c) ?? null;
  }
  return null;
}

/** Ajusta o formato do valor ao campo: data ISO em campo de data, dd/mm/aaaa em campo de texto, só dígitos. */
export function ajustarFormato(valor: string, tipoInput: string, formatoGravado?: string): string {
  const v = valor.trim();
  if (tipoInput === 'date') {
    const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return br ? `${br[3]}-${br[2]}-${br[1]}` : v;
  }
  if (tipoInput === 'time') return interpretarHora(v) ?? v;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso && formatoGravado && /^9{2}\/9{2}\/9{4}$/.test(formatoGravado)) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (formatoGravado && /^9+$/.test(formatoGravado)) {
    const d = somenteDigitos(v);
    if (d.length === formatoGravado.length) return d;
  }
  return v;
}

function cookieParaPlaywright(c: CookieNavegador, urlBase: string) {
  if (c.domain) {
    return { name: c.name, value: c.value, domain: c.domain, path: c.path ?? '/', httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite };
  }
  return { name: c.name, value: c.value, url: c.url ?? urlBase, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite };
}

/** O endereço é de uma tela de entrar no sistema? */
function pareceTelaDeLogin(url: string): boolean {
  try {
    return /\/(entrar|login|signin|sign-in|logon|acesso)(\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function caminhoCurto(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function pastaSegura(id: string): string {
  return id.replace(/[^\w-]+/g, '_').slice(0, 80) || 'execucao';
}

function nomeArquivoSeguro(nome: string): string {
  const base = path.basename(nome).replace(/[^\w.\- ]+/g, '_').trim();
  return base.slice(-120) || 'arquivo';
}

function caminhoLivre(pasta: string, nome: string): string {
  let destino = path.join(pasta, nome);
  const ext = path.extname(nome);
  const base = nome.slice(0, nome.length - ext.length);
  for (let i = 2; fs.existsSync(destino); i++) destino = path.join(pasta, `${base}-${i}${ext}`);
  return destino;
}

const TIPOS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
};

export function tipoDoArquivo(nome: string): string {
  return TIPOS[path.extname(nome).toLowerCase()] ?? 'application/octet-stream';
}

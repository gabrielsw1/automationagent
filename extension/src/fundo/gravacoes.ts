// Gravações por aba, no service worker. O estado (token, servidor, passos e eventos ainda não
// enviados) fica no chrome.storage.session: sobrevive à troca de página, à navegação para outro site
// na mesma aba e ao service worker dormir, até concluir, cancelar ou fechar a aba.
// Toda a rede passa por aqui (o CORS do site gravado não interfere) e usa a ApiGravacao do widget.
import { ehMensagemDoConsole, type EventoGravado } from '@copiloto/shared';
import { ErroCliente, juntarUrl, pedirJson } from '@copiloto/widget/chat/api.ts';
import { ApiGravacao } from '@copiloto/widget/gravador/envio.ts';
import type { AvisoEstado, EstadoAba, Pedido, Resultado, Saude } from '../comum/mensagens.ts';
import { origemDe, servidorConfigurado, temPermissao } from '../comum/servidor.ts';
import { paginaGravavel, semParametros } from '../comum/parametros.ts';
import { Conta } from './conta.ts';

interface GravacaoAba {
  token: string;
  api: string;
  nome: string | null;
  passos: number;
  pendentes: EventoGravado[];
  ultimaUrl: string | null;
  situacao: 'gravando' | 'sem_permissao' | 'sem_conexao';
  aviso: string | null;
  fluxoId?: string | null;
  itens?: string[];
  empresa?: string | null;
  pessoa?: string | null;
}

const PREFIXO = 'aba:';
const TIPOS = new Set(['navegar', 'clique', 'preencher', 'selecionar', 'download', 'leitura']);

export const TEXTOS = {
  concluida: 'Gravação enviada. Volte ao console para revisar.',
  cancelada: 'Gravação descartada. Nada foi salvo.',
  encerrada: 'Esta gravação já foi encerrada. Volte ao console para continuar.',
  naoEncontrada: 'Não encontrei esta gravação. Comece de novo pelo console.',
  semConexao: (api: string) => `Não consegui falar com o copiloto em ${api}. Os passos ficam guardados e saem quando a conexão voltar.`,
  semPermissao: (api: string) =>
    `A extensão ainda não pode falar com o copiloto em ${api}. Libere esse endereço nas opções; os passos ficam guardados até lá.`,
  /** Concluir sem internet (E8). */
  esperandoConexao: (passos: number) =>
    `Sem conexão agora. ${passos === 1 ? 'O passo está guardado e será enviado' : `Os ${passos} passos estão guardados e serão enviados`} quando a internet voltar.`,
  semConta: 'Entre com a conta do Copiloto para gravar.',
};

function publico(g: GravacaoAba): EstadoAba {
  return {
    situacao: g.situacao,
    nome: g.nome,
    passos: g.passos + g.pendentes.length,
    api: g.api,
    aviso: g.aviso,
    fluxoId: g.fluxoId ?? null,
    itens: g.itens ?? [],
    pendentes: g.pendentes.length,
    empresa: g.empresa ?? null,
    pessoa: g.pessoa ?? null,
  };
}

/** Só o formato de um EventoGravado (o servidor valida de novo, campo a campo). */
function eventoValido(e: unknown): e is EventoGravado {
  if (!e || typeof e !== 'object') return false;
  const x = e as Partial<EventoGravado>;
  return typeof x.tipo === 'string' && TIPOS.has(x.tipo) && typeof x.ts === 'number' && typeof x.url === 'string';
}

/** Falha de rede (ou servidor fora do ar): vale guardar e tentar de novo. */
function semRede(e: unknown): boolean {
  return e instanceof ErroCliente && e.temporario;
}

function fimDaGravacao(e: unknown): boolean {
  return e instanceof ErroCliente && (e.status === 404 || e.status === 409 || e.status === 410);
}

function mensagem(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

export interface OpcoesGravacoes {
  /** Espera antes de mandar um lote (junta eventos próximos num POST só). */
  esperaMs?: number;
  /** Eventos por POST. O fetch com keepalive aceita até 64 KB de corpo: lotes pequenos. */
  tamanhoLote?: number;
  /** Primeira espera para concluir de novo quando não havia conexão (depois dobra, até 30 s). */
  esperaConexaoMs?: number;
}

export class Gravacoes {
  private readonly esperaMs: number;
  private readonly tamanhoLote: number;
  /** Fila por aba: mudanças no estado de uma aba acontecem uma de cada vez. */
  private readonly filas = new Map<number, Promise<unknown>>();
  private readonly enviando = new Map<number, Promise<boolean>>();
  private readonly relogios = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly falhas = new Map<number, number>();
  private readonly esperaConexaoMs: number;
  private readonly relogiosConclusao = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly tentativasConclusao = new Map<number, number>();
  /** Conta da extensão (entrar, empresa, sair). */
  readonly conta: Conta;

  constructor(opcoes: OpcoesGravacoes = {}) {
    this.esperaMs = opcoes.esperaMs ?? 800;
    this.tamanhoLote = opcoes.tamanhoLote ?? 10;
    this.esperaConexaoMs = opcoes.esperaConexaoMs ?? 2000;
    this.conta = new Conta((servidor) => this.saude(servidor), chrome.runtime.getManifest().version);
  }

  /** Atende uma mensagem. Da página, a aba é a de quem mandou; do popup, a que ele informa. */
  async tratar(pedido: Pedido, remetente: chrome.runtime.MessageSender): Promise<unknown> {
    const daExtensao = !!remetente.url && remetente.url.startsWith(chrome.runtime.getURL(''));
    const abaPedida = 'abaId' in pedido ? pedido.abaId : undefined;
    const abaId = daExtensao ? abaPedida : remetente.tab?.id;
    // A conta só se mexe pelo popup e pelas opções; a página do console só fala pelo pedido "console".
    if (!daExtensao && ['conta', 'entrar', 'sair', 'recentes', 'gravarAba', 'abrirConsole', 'saude'].includes(pedido.tipo)) return null;
    switch (pedido.tipo) {
      case 'comecar':
        return abaId === undefined ? null : this.comecar(abaId, pedido.token, pedido.api);
      case 'estado':
        return abaId === undefined ? null : this.estado(abaId);
      case 'eventos':
        return abaId === undefined ? null : this.adicionar(abaId, pedido.eventos);
      case 'concluir':
        return abaId === undefined ? { ok: false, mensagem: 'Esta aba não está gravando.' } : this.concluir(abaId);
      case 'cancelar':
        return abaId === undefined ? { ok: false, mensagem: 'Esta aba não está gravando.' } : this.cancelar(abaId);
      case 'permitir':
        return abaId === undefined ? null : this.abrirPermissao(abaId);
      case 'tentarAgora':
        return abaId === undefined ? { ok: false, mensagem: 'Esta aba não está gravando.' } : this.tentarAgora(abaId);
      case 'saude':
        return this.saude(pedido.servidor);
      case 'gravarAba':
        return this.gravarAba(pedido.url);
      case 'abrirConsole':
        return this.abrirConsole(pedido.fluxoId ?? null, pedido.api ?? null);
      case 'conta':
        return this.conta.estado();
      case 'entrar':
        return this.conta.entrar(typeof pedido.empresaId === 'string' ? pedido.empresaId : undefined);
      case 'sair':
        return this.conta.sair();
      case 'recentes':
        return this.conta.recentes();
      case 'console':
        // Só de uma aba (content script), nunca das páginas da extensão.
        if (daExtensao || !remetente.tab || !ehMensagemDoConsole(pedido.mensagem)) return null;
        return this.conta.doConsole(pedido.mensagem, remetente);
      default:
        return null;
    }
  }

  // ---------- Estado ----------

  private async ler(abaId: number): Promise<GravacaoAba | null> {
    const chave = `${PREFIXO}${abaId}`;
    const r = await chrome.storage.session.get(chave);
    return (r[chave] as GravacaoAba | undefined) ?? null;
  }

  private async gravar(abaId: number, g: GravacaoAba | null): Promise<void> {
    const chave = `${PREFIXO}${abaId}`;
    if (g) await chrome.storage.session.set({ [chave]: g });
    else await chrome.storage.session.remove(chave);
  }

  private naFila<T>(abaId: number, fn: () => Promise<T>): Promise<T> {
    const antes = this.filas.get(abaId) ?? Promise.resolve();
    const agora = antes.catch(() => {}).then(fn);
    this.filas.set(abaId, agora);
    return agora;
  }

  /** Muda o estado guardado de uma aba (na fila) e avisa a página e o popup. */
  private mudar(abaId: number, fn: (g: GravacaoAba) => GravacaoAba | null): Promise<GravacaoAba | null> {
    return this.naFila(abaId, async () => {
      const g = await this.ler(abaId);
      if (!g) return null;
      const novo = fn(g);
      await this.gravar(abaId, novo);
      if (novo) this.avisar(abaId, publico(novo));
      return novo;
    });
  }

  private avisar(abaId: number, estado: EstadoAba | null): void {
    const aviso: AvisoEstado = { tipo: 'estadoAba', abaId, estado };
    chrome.tabs.sendMessage(abaId, aviso).catch(() => {});
    chrome.runtime.sendMessage(aviso).catch(() => {});
  }

  private async abas(): Promise<number[]> {
    const tudo = await chrome.storage.session.get(null);
    return Object.keys(tudo)
      .filter((k) => k.startsWith(PREFIXO))
      .map((k) => Number(k.slice(PREFIXO.length)))
      .filter((n) => Number.isInteger(n));
  }

  /** Termina a gravação nesta aba: apaga o estado e avisa com o texto final. */
  private async encerrar(abaId: number, situacao: 'concluida' | 'cancelada' | 'encerrada', aviso: string): Promise<EstadoAba> {
    this.pararRelogio(abaId);
    this.pararConclusao(abaId);
    const g = await this.naFila(abaId, async () => {
      const atual = await this.ler(abaId);
      await this.gravar(abaId, null);
      return atual;
    });
    const estado: EstadoAba = {
      situacao,
      nome: g?.nome ?? null,
      passos: g ? g.passos : 0,
      api: g?.api ?? '',
      aviso,
      fluxoId: g?.fluxoId ?? null,
      itens: g?.itens ?? [],
      pendentes: 0,
      empresa: g?.empresa ?? null,
      pessoa: g?.pessoa ?? null,
    };
    this.avisar(abaId, estado);
    return estado;
  }

  async estado(abaId: number): Promise<EstadoAba | null> {
    const g = await this.ler(abaId);
    return g ? publico(g) : null;
  }

  // ---------- Começo ----------

  async comecar(abaId: number, token: string, apiDaUrl: string | null): Promise<EstadoAba> {
    const api = origemDe(apiDaUrl) ?? (await servidorConfigurado());
    const anterior = await this.ler(abaId);
    if (anterior?.token === token) return publico(anterior);
    // Outra gravação nesta aba: a anterior fica como está no servidor (o console conclui ou cancela).
    if (anterior) await this.descarregar(abaId).catch(() => {});
    const permitido = await temPermissao(api);
    const g: GravacaoAba = {
      token,
      api,
      nome: null,
      passos: 0,
      pendentes: [],
      ultimaUrl: null,
      situacao: permitido ? 'gravando' : 'sem_permissao',
      aviso: permitido ? null : TEXTOS.semPermissao(api),
      fluxoId: null,
      itens: [],
      empresa: null,
      pessoa: null,
    };
    await this.naFila(abaId, () => this.gravar(abaId, g));
    if (!permitido) return publico(g);
    return this.conferir(abaId);
  }

  /** Pergunta ao servidor se a gravação ainda vale e traz o nome do fluxo. */
  private async conferir(abaId: number): Promise<EstadoAba> {
    const g = await this.ler(abaId);
    if (!g) return { situacao: 'encerrada', nome: null, passos: 0, api: '', aviso: TEXTOS.naoEncontrada };
    try {
      const r = await new ApiGravacao(g.api, g.token).estado();
      if (!r.ativa) return this.encerrar(abaId, 'encerrada', TEXTOS.encerrada);
      const novo = await this.mudar(abaId, (x) => ({
        ...x,
        nome: r.nome || x.nome,
        passos: Math.max(x.passos, r.passos ?? 0),
        aviso: null,
        fluxoId: r.fluxoId ?? x.fluxoId ?? null,
        itens: Array.isArray(r.itens) ? r.itens : (x.itens ?? []),
        empresa: r.empresa ?? x.empresa ?? null,
        pessoa: r.pessoa ?? x.pessoa ?? null,
      }));
      return novo ? publico(novo) : publico(g);
    } catch (e) {
      if (e instanceof ErroCliente && (e.status === 404 || e.status === 410)) return this.encerrar(abaId, 'encerrada', TEXTOS.naoEncontrada);
      const novo = await this.mudar(abaId, (x) => ({ ...x, aviso: TEXTOS.semConexao(x.api) }));
      return novo ? publico(novo) : publico(g);
    }
  }

  // ---------- Eventos ----------

  async adicionar(abaId: number, eventos: unknown[]): Promise<{ passos: number } | null> {
    const validos = (Array.isArray(eventos) ? eventos : []).filter(eventoValido);
    const g = await this.mudar(abaId, (x) => {
      const pendentes = [...x.pendentes];
      let ultimaUrl = x.ultimaUrl;
      for (const e of validos) {
        // Recarregar a mesma página (ou voltar a ela pelo SPA sem mudar nada) não é passo novo.
        if (e.tipo === 'navegar') {
          if (e.url === ultimaUrl) continue;
          ultimaUrl = e.url;
        }
        pendentes.push(e);
      }
      return { ...x, pendentes, ultimaUrl };
    });
    if (!g) return null;
    if (g.situacao === 'gravando') {
      if (g.pendentes.length >= this.tamanhoLote) this.descarregar(abaId).catch(() => {});
      else this.agendar(abaId, this.esperaMs);
    }
    return { passos: publico(g).passos };
  }

  private agendar(abaId: number, ms: number): void {
    this.pararRelogio(abaId);
    this.relogios.set(
      abaId,
      setTimeout(() => {
        this.relogios.delete(abaId);
        this.descarregar(abaId).catch(() => {});
      }, ms),
    );
  }

  private pararRelogio(abaId: number): void {
    const r = this.relogios.get(abaId);
    if (r) clearTimeout(r);
    this.relogios.delete(abaId);
  }

  /** Envia tudo que está pendente, em lotes. Rejeita se o servidor não aceitar (para o "Concluir" avisar). */
  async descarregar(abaId: number): Promise<void> {
    for (;;) {
      const emCurso = this.enviando.get(abaId);
      if (emCurso) {
        await emCurso.catch(() => {});
        continue;
      }
      // Marcado antes de qualquer await: dois descarregar ao mesmo tempo não mandam o mesmo lote.
      const envio = this.enviarProximo(abaId);
      this.enviando.set(abaId, envio);
      let enviou: boolean;
      try {
        enviou = await envio;
      } finally {
        this.enviando.delete(abaId);
      }
      if (!enviou) return;
    }
  }

  /** Manda o próximo lote; false quando não havia nada a mandar. */
  private async enviarProximo(abaId: number): Promise<boolean> {
    const g = await this.ler(abaId);
    if (!g || g.situacao === 'sem_permissao' || g.pendentes.length === 0) return false;
    this.pararRelogio(abaId);
    await this.enviarLote(abaId, g, g.pendentes.slice(0, this.tamanhoLote));
    return true;
  }

  private async enviarLote(abaId: number, g: GravacaoAba, lote: EventoGravado[]): Promise<void> {
    try {
      const r = await new ApiGravacao(g.api, g.token).eventos(lote);
      this.falhas.delete(abaId);
      // Só sai da fila o que foi aceito (eventos novos podem ter chegado enquanto enviava).
      await this.mudar(abaId, (x) => ({
        ...x,
        pendentes: x.pendentes.slice(lote.length),
        passos: typeof r?.passos === 'number' ? r.passos : x.passos,
        itens: Array.isArray(r?.itens) ? r.itens : x.itens,
        aviso: x.situacao === 'sem_conexao' ? x.aviso : null,
      }));
    } catch (e) {
      if (fimDaGravacao(e)) {
        await this.encerrar(abaId, 'encerrada', mensagem(e, TEXTOS.encerrada));
        throw e;
      }
      const falhas = (this.falhas.get(abaId) ?? 0) + 1;
      this.falhas.set(abaId, falhas);
      await this.mudar(abaId, (x) => (x.situacao === 'sem_conexao' ? x : { ...x, aviso: TEXTOS.semConexao(x.api) }));
      // Esperando para concluir: quem tenta de novo é o relógio da conclusão.
      if (g.situacao !== 'sem_conexao') this.agendar(abaId, Math.min(2000 * 2 ** (falhas - 1), 20_000));
      throw e;
    }
  }

  // ---------- Concluir e cancelar ----------

  async concluir(abaId: number): Promise<Resultado> {
    const g = await this.ler(abaId);
    if (!g) return { ok: false, final: true, mensagem: TEXTOS.encerrada };
    if (g.situacao === 'sem_permissao') return { ok: false, semPermissao: true, mensagem: TEXTOS.semPermissao(g.api) };
    try {
      await this.descarregar(abaId);
      await new ApiGravacao(g.api, g.token).concluir();
    } catch (e) {
      if (fimDaGravacao(e)) {
        const texto = mensagem(e, TEXTOS.encerrada);
        await this.encerrar(abaId, 'encerrada', texto);
        return { ok: false, final: true, mensagem: texto };
      }
      if (semRede(e)) {
        // Sem internet (E8): a captura para, os passos ficam guardados e a conclusão tenta sozinha.
        const novo = await this.mudar(abaId, (x) => ({ ...x, situacao: 'sem_conexao', aviso: TEXTOS.esperandoConexao(x.passos + x.pendentes.length) }));
        this.pararRelogio(abaId);
        if (!this.relogiosConclusao.has(abaId)) this.agendarConclusao(abaId);
        return { ok: false, semConexao: true, mensagem: novo?.aviso ?? TEXTOS.esperandoConexao(g.passos) };
      }
      return { ok: false, mensagem: mensagem(e, TEXTOS.semConexao(g.api)) };
    }
    this.tentativasConclusao.delete(abaId);
    await this.encerrar(abaId, 'concluida', TEXTOS.concluida);
    return { ok: true };
  }

  /** "Tentar agora" (sem conexão): tenta concluir já, sem esperar o relógio. */
  async tentarAgora(abaId: number): Promise<Resultado> {
    const g = await this.ler(abaId);
    if (!g) return { ok: false, final: true, mensagem: TEXTOS.encerrada };
    this.pararConclusao(abaId);
    return this.concluir(abaId);
  }

  private agendarConclusao(abaId: number): void {
    this.pararConclusao(abaId, false);
    const n = (this.tentativasConclusao.get(abaId) ?? 0) + 1;
    this.tentativasConclusao.set(abaId, n);
    const espera = Math.min(this.esperaConexaoMs * 2 ** (n - 1), 30_000);
    this.relogiosConclusao.set(
      abaId,
      setTimeout(() => {
        this.relogiosConclusao.delete(abaId);
        void this.concluir(abaId);
      }, espera),
    );
  }

  private pararConclusao(abaId: number, esquecer = true): void {
    const r = this.relogiosConclusao.get(abaId);
    if (r) clearTimeout(r);
    this.relogiosConclusao.delete(abaId);
    if (esquecer) this.tentativasConclusao.delete(abaId);
  }

  async cancelar(abaId: number): Promise<Resultado> {
    const g = await this.ler(abaId);
    if (!g) return { ok: false, final: true, mensagem: TEXTOS.encerrada };
    this.pararRelogio(abaId);
    if (g.situacao === 'gravando') {
      // Mesmo sem resposta do servidor a aba para de gravar; o console ainda pode cancelar por lá.
      await new ApiGravacao(g.api, g.token).cancelar().catch(() => {});
    }
    await this.encerrar(abaId, 'cancelada', TEXTOS.cancelada);
    return { ok: true };
  }

  // ---------- Ciclo de vida ----------

  /** Aba fechada: manda o que faltava (o fluxo continua em gravação no console) e esquece a aba. */
  async abaFechada(abaId: number): Promise<void> {
    const g = await this.ler(abaId);
    // Fechou a aba esperando a conexão para concluir: a conclusão continua, a aba não importa mais.
    if (g?.situacao === 'sem_conexao') return;
    await this.descarregar(abaId).catch(() => {});
    this.pararRelogio(abaId);
    await this.naFila(abaId, () => this.gravar(abaId, null));
    this.filas.delete(abaId);
    this.falhas.delete(abaId);
  }

  /** Uma permissão nova nas opções: as abas que esperavam por ela voltam a enviar. */
  async permissoesMudaram(): Promise<void> {
    for (const abaId of await this.abas()) {
      const g = await this.ler(abaId);
      if (!g || g.situacao !== 'sem_permissao' || !(await temPermissao(g.api))) continue;
      await this.mudar(abaId, (x) => ({ ...x, situacao: 'gravando', aviso: null }));
      await this.conferir(abaId);
      this.descarregar(abaId).catch(() => {});
    }
  }

  /** O service worker acordou: retoma os envios que ficaram pela metade. */
  async retomar(): Promise<void> {
    for (const abaId of await this.abas()) {
      const g = await this.ler(abaId);
      if (g?.situacao === 'sem_conexao') this.agendarConclusao(abaId);
      else this.descarregar(abaId).catch(() => {});
    }
  }

  private async abrirPermissao(abaId: number): Promise<{ ok: true }> {
    const g = await this.ler(abaId);
    const busca = g ? `?permitir=${encodeURIComponent(g.api)}` : '';
    await chrome.tabs.create({ url: chrome.runtime.getURL(`opcoes.html${busca}`) });
    return { ok: true };
  }

  // ---------- Servidor e console ----------

  async saude(servidorPedido?: string): Promise<Saude> {
    const servidor = origemDe(servidorPedido) ?? (await servidorConfigurado());
    if (!(await temPermissao(servidor))) return { ok: false, servidor, semPermissao: true, mensagem: TEXTOS.semPermissao(servidor) };
    try {
      const r = await pedirJson<{ sistema?: string; urlConsole?: string }>(juntarUrl(servidor, '/api/saude'));
      return { ok: true, servidor, sistema: r?.sistema ?? 'sistema', urlConsole: origemDe(r?.urlConsole) ? r!.urlConsole!.replace(/\/+$/, '') : servidor };
    } catch (e) {
      const texto = e instanceof ErroCliente && e.rede ? `Não consegui falar com o copiloto em ${servidor}. Confira se ele está no ar e o endereço nas opções.` : mensagem(e, 'O copiloto não respondeu.');
      return { ok: false, servidor, mensagem: texto };
    }
  }

  /**
   * "Gravar esta aba": abre o Aprender fluxo do console com o endereço desta aba preenchido, na
   * empresa da conta da extensão (o console troca de empresa se estiver em outra).
   */
  async gravarAba(url: string): Promise<Resultado> {
    if (!paginaGravavel(url)) return { ok: false, mensagem: 'Abra uma página do sistema (http ou https) para gravar.' };
    const conta = await this.conta.guardada();
    let busca = `gravar=${encodeURIComponent(semParametros(url))}`;
    let urlConsole: string;
    if (conta) {
      if (!conta.sessao.podeGravar) return { ok: false, mensagem: `Seu perfil na ${conta.sessao.empresa.nome} não permite gravar fluxos.` };
      urlConsole = conta.sessao.urlConsole;
      busca += `&empresa=${encodeURIComponent(conta.sessao.empresa.id)}`;
    } else {
      const s = await this.saude();
      if (!s.ok) return { ok: false, mensagem: s.mensagem, semPermissao: s.semPermissao };
      urlConsole = s.urlConsole;
    }
    await chrome.tabs.create({ url: `${urlConsole.replace(/\/+$/, '')}/aprender?${busca}` });
    return { ok: true };
  }

  /** "Abrir no console": o fluxo recém-enviado (ou o Aprender fluxo). */
  async abrirConsole(fluxoId: string | null, api: string | null): Promise<Resultado> {
    const conta = await this.conta.guardada();
    let urlConsole = conta && (!api || origemDe(api) === conta.servidor) ? conta.sessao.urlConsole : null;
    if (!urlConsole) {
      const s = await this.saude(api ?? undefined);
      if (!s.ok) return { ok: false, mensagem: s.mensagem, semPermissao: s.semPermissao };
      urlConsole = s.urlConsole;
    }
    const caminho = fluxoId ? `/aprender/${encodeURIComponent(fluxoId)}` : '/aprender';
    await chrome.tabs.create({ url: `${urlConsole.replace(/\/+$/, '')}${caminho}` });
    return { ok: true };
  }
}

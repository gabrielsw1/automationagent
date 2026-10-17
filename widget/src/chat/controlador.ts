// Estado do chat fora do React: conversa, mensagens, SSE, fila de mensagens offline e ações.
// Os componentes leem com useSyncExternalStore (ver useChat em painel.tsx).
import type {
  AcaoBloco,
  AnexoEnviado,
  Bloco,
  ConversaWidget,
  EstadoConversa,
  EventoWidget,
  ItemRecente,
  MensagemWidget,
  PaginaContexto,
  WidgetInicio,
} from '@copiloto/shared';
import { ClienteApi, ErroCliente } from './api.ts';
import { ConexaoEventos, type ConstrutorEventSource, type StatusConexao } from './sse.ts';
import { armazenamento, gerarId, mensagemDeErro, online, textoPuro, type Armazenamento } from './util.ts';

export type SituacaoLocal = 'enviando' | 'na_fila' | 'falhou';

export interface MensagemLocal extends MensagemWidget {
  /** Presente enquanto a mensagem da pessoa ainda não foi aceita pelo servidor. */
  local?: { idCliente: string; situacao: SituacaoLocal; erro?: string };
  /** Anexos enviados com a mensagem (só no navegador de quem enviou). */
  anexos?: AnexoEnviado[];
}

export interface EstadoChat {
  tela: 'boas_vindas' | 'conversa';
  conversaId: string | null;
  estadoConversa: EstadoConversa;
  contexto: PaginaContexto | null;
  mensagens: MensagemLocal[];
  digitando: null | { autor: 'copiloto' | 'pessoa' };
  conexao: StatusConexao;
  online: boolean;
  carregando: boolean;
  erroCarregar: string | null;
  /** Aviso passageiro (evento "erro" do servidor). */
  aviso: string | null;
  recentes: ItemRecente[];
  /** Conversa que estava aberta antes de "Nova conversa" (para voltar). */
  conversaAnteriorId: string | null;
  /** Nome da pessoa do suporte que devolveu a conversa ao copiloto. */
  devolvidoPor: string | null;
  /** Texto para o leitor de tela (aria-live). */
  anuncio: { id: number; texto: string } | null;
}

interface ItemFila {
  idCliente: string;
  conversaId: string | null;
  texto: string;
  anexos: AnexoEnviado[];
  contexto?: PaginaContexto;
  criadoEm: string;
  tentativas: number;
}

export interface OpcoesControlador {
  api: ClienteApi;
  inicio: WidgetInicio;
  obterContexto?: () => PaginaContexto | undefined;
  EventSourceImpl?: ConstrutorEventSource;
  armazenamento?: Armazenamento;
  /** Mensagem nova do copiloto, de uma pessoa ou do sistema (para avisar com o painel fechado). */
  aoNovaMensagem?: (m: MensagemWidget) => void;
  /** Espera máxima entre tentativas de reenviar a fila (ms). */
  esperaMaximaFila?: number;
}

const BLOCOS_TERMINAIS = new Set<Bloco['tipo']>(['recibo', 'erro', 'conflito']);

export function resumoMensagem(m: MensagemWidget): string {
  const partes: string[] = [];
  if (m.texto) partes.push(textoPuro(m.texto));
  for (const b of m.blocos) {
    if (b.tipo === 'confirmacao') partes.push(`${b.titulo}. Confira os dados e confirme.`);
    else if (b.tipo === 'recibo') partes.push(b.titulo);
    else if (b.tipo === 'erro') partes.push(b.titulo);
    else if (b.tipo === 'progresso') partes.push(b.titulo);
    else if (b.tipo === 'aprovacao') partes.push('Precisa de aprovação.');
    else if (b.tipo === 'conflito') partes.push(`${b.existente.titulo} já está cadastrado.`);
  }
  return partes.join(' ').trim();
}

export class ControladorChat {
  readonly api: ClienteApi;
  readonly inicio: WidgetInicio;
  private estado: EstadoChat;
  private readonly ouvintes = new Set<() => void>();
  private readonly opcoes: OpcoesControlador;
  private readonly guarda: Armazenamento;
  private conexao: ConexaoEventos | null = null;
  private fila: ItemFila[] = [];
  private descarregando = false;
  private criandoConversa: Promise<string> | null = null;
  private timerFila: ReturnType<typeof setTimeout> | null = null;
  private timerDigitando: ReturnType<typeof setTimeout> | null = null;
  private timerAviso: ReturnType<typeof setTimeout> | null = null;
  private iniciado = false;
  private destruido = false;
  private contadorAnuncio = 0;

  constructor(opcoes: OpcoesControlador) {
    this.opcoes = opcoes;
    this.api = opcoes.api;
    this.inicio = opcoes.inicio;
    this.guarda = opcoes.armazenamento ?? armazenamento('sessao');
    this.estado = {
      tela: opcoes.inicio.conversaId ? 'conversa' : 'boas_vindas',
      conversaId: null,
      estadoConversa: { modo: 'copiloto' },
      contexto: null,
      mensagens: [],
      digitando: null,
      conexao: 'ociosa',
      online: online(),
      carregando: Boolean(opcoes.inicio.conversaId),
      erroCarregar: null,
      aviso: null,
      recentes: opcoes.inicio.recentes ?? [],
      conversaAnteriorId: null,
      devolvidoPor: null,
      anuncio: null,
    };
  }

  // ---------- leitura (useSyncExternalStore) ----------

  assinar = (fn: () => void): (() => void) => {
    this.ouvintes.add(fn);
    return () => {
      this.ouvintes.delete(fn);
    };
  };

  obter = (): EstadoChat => this.estado;

  private definir(parcial: Partial<EstadoChat> | ((e: EstadoChat) => Partial<EstadoChat>)): void {
    if (this.destruido) return;
    const p = typeof parcial === 'function' ? parcial(this.estado) : parcial;
    this.estado = { ...this.estado, ...p };
    for (const fn of this.ouvintes) fn();
  }

  private get chaveFila(): string {
    return `copiloto_fila:${this.inicio.usuario.id}`;
  }

  // ---------- ciclo de vida ----------

  async iniciar(): Promise<void> {
    if (this.iniciado || this.destruido) return;
    this.iniciado = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.aoOnline);
      window.addEventListener('offline', this.aoOffline);
    }
    this.restaurarFila();
    if (this.inicio.conversaId) await this.abrirConversa(this.inicio.conversaId);
    else this.definir({ tela: this.estado.mensagens.length ? 'conversa' : 'boas_vindas', carregando: false });
    if (this.fila.length) void this.descarregar();
  }

  destruir(): void {
    if (this.destruido) return;
    this.conexao?.fechar();
    this.conexao = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.aoOnline);
      window.removeEventListener('offline', this.aoOffline);
    }
    for (const t of [this.timerFila, this.timerDigitando, this.timerAviso]) if (t) clearTimeout(t);
    this.destruido = true;
    this.ouvintes.clear();
  }

  get ativo(): boolean {
    return this.iniciado && !this.destruido;
  }

  private aoOnline = () => {
    this.definir({ online: true });
    this.conexao?.reconectarAgora();
    void this.descarregar();
  };

  private aoOffline = () => {
    this.definir({ online: false });
    this.conexao?.marcarOffline();
  };

  // ---------- conversa ----------

  async abrirConversa(id: string): Promise<void> {
    this.definir({ tela: 'conversa', conversaId: id, carregando: true, erroCarregar: null });
    try {
      const c = await this.api.conversa(id);
      if (this.destruido || this.estado.conversaId !== id) return;
      this.aplicarConversa(c);
      this.conectarEventos(c.id);
    } catch (e) {
      if (this.destruido) return;
      if (e instanceof ErroCliente && (e.status === 404 || e.status === 403)) {
        this.definir({ tela: 'boas_vindas', conversaId: null, mensagens: this.locaisSemConversa() });
      } else {
        this.definir({ erroCarregar: mensagemDeErro(e, 'Não consegui abrir a conversa.') });
      }
    } finally {
      this.definir({ carregando: false });
    }
  }

  /** Tenta de novo depois de erro ao abrir a conversa. */
  recarregar(): void {
    const id = this.estado.conversaId ?? this.inicio.conversaId;
    if (id) void this.abrirConversa(id);
  }

  novaConversa(): void {
    this.conexao?.fechar();
    this.conexao = null;
    const anterior = this.estado.conversaId;
    this.definir({
      tela: 'boas_vindas',
      conversaAnteriorId: anterior ?? this.estado.conversaAnteriorId,
      conversaId: null,
      mensagens: this.locaisSemConversa(),
      estadoConversa: { modo: 'copiloto' },
      contexto: null,
      digitando: null,
      devolvidoPor: null,
      conexao: 'ociosa',
      erroCarregar: null,
      aviso: null,
    });
    void this.atualizarRecentes();
  }

  voltarConversaAnterior(): void {
    const id = this.estado.conversaAnteriorId;
    if (!id) return;
    this.definir({ conversaAnteriorId: null });
    void this.abrirConversa(id);
  }

  async atualizarRecentes(): Promise<void> {
    try {
      const recentes = await this.api.recentes();
      if (Array.isArray(recentes)) this.definir({ recentes });
    } catch {
      /* mantém os recentes que já tinha */
    }
  }

  private locaisSemConversa(): MensagemLocal[] {
    return this.estado.mensagens.filter((m) => m.local && !m.conversaId);
  }

  private aplicarConversa(c: ConversaWidget): void {
    this.definir((e) => {
      const locais = e.mensagens.filter(
        (m) => m.local && (!m.conversaId || m.conversaId === c.id) && !c.mensagens.some((s) => s.id === m.id),
      );
      return {
        conversaId: c.id,
        tela: 'conversa',
        estadoConversa: c.estado ?? { modo: 'copiloto' },
        contexto: c.contexto ?? null,
        mensagens: [...c.mensagens, ...locais],
        erroCarregar: null,
      };
    });
  }

  private conectarEventos(conversaId: string): void {
    this.conexao?.fechar();
    const conexao = new ConexaoEventos({
      url: this.api.urlEventos(conversaId),
      EventSourceImpl: this.opcoes.EventSourceImpl,
      aoEvento: (ev) => this.aoEvento(ev),
      aoStatus: (s) => this.definir({ conexao: s }),
      aoReabrir: () => {
        void this.ressincronizar();
        void this.descarregar();
      },
    });
    this.conexao = conexao;
    conexao.conectar();
  }

  /** Depois de reconectar: busca a conversa para pegar o que chegou enquanto a conexão estava fora. */
  async ressincronizar(): Promise<void> {
    const id = this.estado.conversaId;
    if (!id) return;
    try {
      const c = await this.api.conversa(id);
      if (this.estado.conversaId === id) this.aplicarConversa(c);
    } catch {
      /* tenta na próxima reconexão */
    }
  }

  private garantirConversa(contexto?: PaginaContexto): Promise<string> {
    if (this.estado.conversaId) return Promise.resolve(this.estado.conversaId);
    if (this.criandoConversa) return this.criandoConversa;
    const p = this.api
      .novaConversa(contexto ?? this.opcoes.obterContexto?.())
      .then((c) => {
        // Mensagens locais ainda sem conversa passam a pertencer a esta.
        this.definir((e) => ({
          mensagens: e.mensagens.map((m) => (m.local && !m.conversaId ? { ...m, conversaId: c.id } : m)),
        }));
        for (const item of this.fila) if (!item.conversaId) item.conversaId = c.id;
        this.salvarFila();
        this.aplicarConversa(c);
        this.conectarEventos(c.id);
        return c.id;
      })
      .finally(() => {
        this.criandoConversa = null;
      });
    this.criandoConversa = p;
    return p;
  }

  // ---------- eventos do servidor ----------

  aoEvento(ev: EventoWidget): void {
    if (this.destruido) return;
    switch (ev.tipo) {
      case 'mensagem':
        if (!this.daConversa(ev.mensagem)) return;
        this.upsert(ev.mensagem, true);
        break;
      case 'mensagem_atualizada':
        if (!this.daConversa(ev.mensagem)) return;
        this.upsert(ev.mensagem, false);
        break;
      case 'delta':
        this.aplicarDelta(ev.mensagemId, ev.texto);
        break;
      case 'digitando':
        this.definirDigitando(ev.ativo ? { autor: ev.autor } : null);
        break;
      case 'estado':
        this.definir((e) => {
          const antes = e.estadoConversa;
          const devolvidoPor =
            antes.modo === 'pessoa' && ev.estado.modo === 'copiloto'
              ? antes.atendente.nome
              : ev.estado.modo === 'copiloto'
                ? e.devolvidoPor
                : null;
          return { estadoConversa: ev.estado, devolvidoPor, digitando: null };
        });
        break;
      case 'erro':
        this.mostrarAviso(ev.mensagem);
        break;
    }
  }

  private daConversa(m: MensagemWidget): boolean {
    return !m.conversaId || !this.estado.conversaId || m.conversaId === this.estado.conversaId;
  }

  private upsert(m: MensagemWidget, nova: boolean): void {
    let anunciar: string | null = null;
    let completa = false;
    this.definir((e) => {
      const lista = [...e.mensagens];
      let i = lista.findIndex((x) => x.id === m.id);
      if (i < 0 && m.autor === 'usuario') {
        // A mensagem da própria pessoa pode chegar pelo SSE antes da resposta do POST.
        i = lista.findIndex((x) => x.local && x.local.situacao !== 'falhou' && x.texto === m.texto);
      }
      const anterior = i >= 0 ? lista[i] : null;
      if (anterior) {
        // O texto pode ter chegado antes por "delta": não perde o que já foi recebido.
        const textoAnterior = anterior.texto ?? '';
        const manterTexto = Boolean(m.emAndamento) && textoAnterior.length > (m.texto ?? '').length;
        lista[i] = { ...m, texto: manterTexto ? textoAnterior : m.texto, anexos: anterior.anexos };
      } else {
        const primeiroLocal = lista.findIndex((x) => x.local);
        if (primeiroLocal >= 0) lista.splice(primeiroLocal, 0, m);
        else lista.push(m);
      }
      // Conta como "chegou" quando a mensagem fica completa: nova e pronta, ou terminou o streaming.
      if (m.autor !== 'usuario' && !m.emAndamento && (anterior ? anterior.emAndamento : true) && (nova || anterior)) {
        completa = true;
        anunciar = resumoMensagem(m);
      }
      const digitando =
        m.autor !== 'usuario' && e.digitando?.autor === (m.autor === 'pessoa' ? 'pessoa' : 'copiloto') ? null : e.digitando;
      return { mensagens: lista, digitando };
    });
    if (completa) this.opcoes.aoNovaMensagem?.(m);
    if (anunciar) this.anunciar(m.autor, anunciar);
    if (m.blocos.some((b) => BLOCOS_TERMINAIS.has(b.tipo))) void this.atualizarRecentesDepois();
  }

  private atualizarRecentesDepois = (() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    return async () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        if (!this.destruido) void this.atualizarRecentes();
      }, 800);
    };
  })();

  private aplicarDelta(mensagemId: string, texto: string): void {
    this.definir((e) => {
      const lista = [...e.mensagens];
      const i = lista.findIndex((x) => x.id === mensagemId);
      if (i >= 0) {
        lista[i] = { ...lista[i], texto: (lista[i].texto ?? '') + texto, emAndamento: true };
      } else {
        const nova: MensagemLocal = {
          id: mensagemId,
          conversaId: e.conversaId ?? '',
          autor: 'copiloto',
          texto,
          blocos: [],
          criadoEm: new Date().toISOString(),
          emAndamento: true,
        };
        const primeiroLocal = lista.findIndex((x) => x.local);
        if (primeiroLocal >= 0) lista.splice(primeiroLocal, 0, nova);
        else lista.push(nova);
      }
      return { mensagens: lista, digitando: e.digitando?.autor === 'copiloto' ? null : e.digitando };
    });
  }

  private definirDigitando(d: EstadoChat['digitando']): void {
    if (this.timerDigitando) clearTimeout(this.timerDigitando);
    this.timerDigitando = null;
    this.definir({ digitando: d });
    if (d) {
      this.timerDigitando = setTimeout(() => this.definir({ digitando: null }), 45000);
    }
  }

  private anunciar(autor: MensagemWidget['autor'], texto: string): void {
    if (!texto) return;
    const quem =
      autor === 'pessoa'
        ? this.estado.estadoConversa.modo === 'pessoa'
          ? this.estado.estadoConversa.atendente.nome
          : 'Suporte'
        : autor === 'sistema'
          ? ''
          : this.inicio.config.nome;
    this.contadorAnuncio += 1;
    this.definir({ anuncio: { id: this.contadorAnuncio, texto: quem ? `${quem}: ${texto}` : texto } });
  }

  mostrarAviso(texto: string): void {
    if (this.timerAviso) clearTimeout(this.timerAviso);
    this.definir({ aviso: texto });
    this.timerAviso = setTimeout(() => this.definir({ aviso: null }), 12000);
  }

  fecharAviso(): void {
    if (this.timerAviso) clearTimeout(this.timerAviso);
    this.definir({ aviso: null });
  }

  // ---------- envio e fila offline ----------

  enviar(texto: string, anexos: AnexoEnviado[] = []): void {
    const limpo = texto.trim();
    if ((!limpo && !anexos.length) || this.destruido) return;
    const item: ItemFila = {
      idCliente: gerarId(),
      conversaId: this.estado.conversaId,
      texto: limpo,
      anexos,
      contexto: this.opcoes.obterContexto?.(),
      criadoEm: new Date().toISOString(),
      tentativas: 0,
    };
    this.fila.push(item);
    this.salvarFila();
    this.definir((e) => ({
      tela: 'conversa',
      devolvidoPor: null,
      mensagens: [...e.mensagens, this.mensagemLocal(item, online() ? 'enviando' : 'na_fila')],
    }));
    this.guarda.gravar('copiloto_conectar', '1');
    void this.descarregar();
  }

  /** Mensagem que falhou de vez: põe de volta na fila com o mesmo idCliente (o servidor não duplica). */
  reenviar(idCliente: string): void {
    const m = this.estado.mensagens.find((x) => x.local?.idCliente === idCliente);
    if (!m || m.local?.situacao !== 'falhou') return;
    this.fila.push({
      idCliente,
      conversaId: m.conversaId || this.estado.conversaId,
      texto: m.texto ?? '',
      anexos: m.anexos ?? [],
      contexto: this.opcoes.obterContexto?.(),
      criadoEm: m.criadoEm,
      tentativas: 0,
    });
    this.salvarFila();
    this.marcarLocal(idCliente, 'enviando');
    void this.descarregar();
  }

  descartar(idCliente: string): void {
    this.fila = this.fila.filter((i) => i.idCliente !== idCliente);
    this.salvarFila();
    this.definir((e) => ({ mensagens: e.mensagens.filter((m) => m.local?.idCliente !== idCliente) }));
  }

  /** Quantas mensagens estão esperando a conexão voltar. */
  get naFila(): number {
    return this.fila.length;
  }

  private mensagemLocal(item: ItemFila, situacao: SituacaoLocal): MensagemLocal {
    return {
      id: `local-${item.idCliente}`,
      conversaId: item.conversaId ?? '',
      autor: 'usuario',
      texto: item.texto,
      blocos: [],
      criadoEm: item.criadoEm,
      anexos: item.anexos.length ? item.anexos : undefined,
      local: { idCliente: item.idCliente, situacao },
    };
  }

  private marcarLocal(idCliente: string, situacao: SituacaoLocal, erro?: string): void {
    this.definir((e) => ({
      mensagens: e.mensagens.map((m) =>
        m.local?.idCliente === idCliente ? { ...m, local: { idCliente, situacao, erro } } : m,
      ),
    }));
  }

  private substituirLocal(idCliente: string, m: MensagemWidget): void {
    this.definir((e) => {
      const local = e.mensagens.find((x) => x.local?.idCliente === idCliente);
      const jaTem = e.mensagens.some((x) => x.id === m.id && !x.local);
      let mensagens: MensagemLocal[];
      if (jaTem || !local) {
        mensagens = e.mensagens.filter((x) => x.local?.idCliente !== idCliente);
        if (!jaTem && !local) mensagens.push(m);
        else if (jaTem && local?.anexos)
          mensagens = mensagens.map((x) => (x.id === m.id ? { ...x, anexos: local.anexos } : x));
      } else {
        // Sai da posição de "pendente" e entra antes das outras mensagens locais.
        const resto = e.mensagens.filter((x) => x.local?.idCliente !== idCliente);
        const nova: MensagemLocal = { ...m, anexos: local.anexos };
        const primeiroLocal = resto.findIndex((x) => x.local);
        if (primeiroLocal >= 0) resto.splice(primeiroLocal, 0, nova);
        else resto.push(nova);
        mensagens = resto;
      }
      return { mensagens };
    });
  }

  async descarregar(): Promise<void> {
    if (this.descarregando || this.destruido) return;
    this.descarregando = true;
    if (this.timerFila) clearTimeout(this.timerFila);
    this.timerFila = null;
    try {
      while (this.fila.length && !this.destruido) {
        const item = this.fila[0];
        if (!online()) {
          this.marcarLocal(item.idCliente, 'na_fila');
          break;
        }
        this.marcarLocal(item.idCliente, 'enviando');
        try {
          const conversaId = item.conversaId ?? (await this.garantirConversa(item.contexto));
          item.conversaId = conversaId;
          const r = await this.api.enviarMensagem(conversaId, {
            texto: item.texto,
            contexto: item.contexto,
            anexos: item.anexos.length ? item.anexos.map((a) => a.id) : undefined,
            idCliente: item.idCliente,
          });
          if (this.fila[0] === item) this.fila.shift();
          else this.fila = this.fila.filter((i) => i !== item);
          this.salvarFila();
          if (r?.mensagem) this.substituirLocal(item.idCliente, r.mensagem);
          else this.marcarLocal(item.idCliente, 'enviando');
          if (this.estado.estadoConversa.modo === 'copiloto' && this.estado.conversaId === conversaId && !this.estado.digitando)
            this.definirDigitando({ autor: 'copiloto' });
        } catch (e) {
          const erro = e instanceof ErroCliente ? e : new ErroCliente(mensagemDeErro(e), 0, 'desconhecido');
          if (erro.temporario && item.tentativas < 8) {
            item.tentativas += 1;
            this.salvarFila();
            this.marcarLocal(item.idCliente, 'na_fila');
            const espera = Math.min(2000 * 2 ** (item.tentativas - 1), this.opcoes.esperaMaximaFila ?? 30000);
            this.timerFila = setTimeout(() => void this.descarregar(), espera);
            break;
          }
          this.fila = this.fila.filter((i) => i !== item);
          this.salvarFila();
          this.marcarLocal(item.idCliente, 'falhou', erro.message);
        }
      }
    } finally {
      this.descarregando = false;
    }
  }

  private salvarFila(): void {
    if (this.fila.length) this.guarda.gravar(this.chaveFila, JSON.stringify(this.fila));
    else this.guarda.remover(this.chaveFila);
  }

  private restaurarFila(): void {
    const bruto = this.guarda.ler(this.chaveFila);
    if (!bruto) return;
    try {
      const itens = JSON.parse(bruto) as ItemFila[];
      if (!Array.isArray(itens)) return;
      const conhecidos = new Set(this.fila.map((i) => i.idCliente));
      for (const item of itens) {
        if (!item || typeof item.idCliente !== 'string' || conhecidos.has(item.idCliente)) continue;
        this.fila.push({ ...item, anexos: item.anexos ?? [], tentativas: 0 });
      }
      if (this.fila.length) {
        this.definir((e) => ({
          mensagens: [...e.mensagens, ...this.fila.map((i) => this.mensagemLocal(i, 'na_fila'))],
        }));
      }
    } catch {
      this.guarda.remover(this.chaveFila);
    }
  }

  // ---------- ações dos cartões ----------

  private atualizarBloco(filtro: (b: Bloco) => boolean, mudar: (b: Bloco) => Bloco): void {
    this.definir((e) => ({
      mensagens: e.mensagens.map((m) =>
        m.blocos.some(filtro) ? { ...m, blocos: m.blocos.map((b) => (filtro(b) ? mudar(b) : b)) } : m,
      ),
    }));
  }

  async confirmar(execucaoId: string): Promise<void> {
    await this.api.confirmar(execucaoId);
    this.guarda.gravar('copiloto_conectar', '1');
    const agora = new Date().toISOString();
    this.atualizarBloco(
      (b) => b.tipo === 'confirmacao' && b.execucaoId === execucaoId && b.estado === 'pendente',
      (b) => (b.tipo === 'confirmacao' ? { ...b, estado: 'confirmado', confirmadoEm: b.confirmadoEm ?? agora } : b),
    );
  }

  async corrigir(execucaoId: string): Promise<void> {
    await this.api.corrigir(execucaoId);
    this.atualizarBloco(
      (b) => b.tipo === 'confirmacao' && b.execucaoId === execucaoId && b.estado === 'pendente',
      (b) => (b.tipo === 'confirmacao' ? { ...b, estado: 'corrigir' } : b),
    );
  }

  async cancelarExecucao(execucaoId: string): Promise<void> {
    await this.api.cancelar(execucaoId);
    this.atualizarBloco(
      (b) => b.tipo === 'confirmacao' && b.execucaoId === execucaoId && b.estado === 'pendente',
      (b) => (b.tipo === 'confirmacao' ? { ...b, estado: 'cancelado' } : b),
    );
  }

  async desfazer(execucaoId: string): Promise<void> {
    await this.api.desfazer(execucaoId);
    this.atualizarBloco(
      (b) => b.tipo === 'recibo' && b.execucaoId === execucaoId,
      (b) => (b.tipo === 'recibo' ? { ...b, desfeito: true } : b),
    );
  }

  tentar(execucaoId: string): Promise<unknown> {
    return this.api.tentar(execucaoId);
  }

  atualizarExistente(execucaoId: string): Promise<unknown> {
    return this.api.atualizarExistente(execucaoId);
  }

  async enviarAprovacao(aprovacaoId: string): Promise<void> {
    await this.api.enviarAprovacao(aprovacaoId);
    this.atualizarBloco(
      (b) => b.tipo === 'aprovacao' && b.aprovacaoId === aprovacaoId && b.estado === 'rascunho',
      (b) => (b.tipo === 'aprovacao' ? { ...b, estado: 'enviada' } : b),
    );
  }

  async cancelarAprovacao(aprovacaoId: string): Promise<void> {
    await this.api.cancelarAprovacao(aprovacaoId);
    this.atualizarBloco(
      (b) => b.tipo === 'aprovacao' && b.aprovacaoId === aprovacaoId && (b.estado === 'rascunho' || b.estado === 'enviada'),
      (b) => (b.tipo === 'aprovacao' ? { ...b, estado: 'cancelada' } : b),
    );
  }

  async pedirHumano(motivo?: string): Promise<void> {
    const id = await this.garantirConversa();
    await this.api.pedirHumano(id, motivo);
    if (this.estado.estadoConversa.modo === 'copiloto') {
      this.definir({ estadoConversa: { modo: 'aguardando_pessoa', resumoEnviado: false }, devolvidoPor: null });
    }
  }

  async feedback(mensagemId: string, valor: 'util' | 'nao_util'): Promise<void> {
    const anterior = this.estado.mensagens.find((m) => m.id === mensagemId)?.feedback ?? null;
    const aplicar = (v: 'util' | 'nao_util' | null) =>
      this.definir((e) => ({ mensagens: e.mensagens.map((m) => (m.id === mensagemId ? { ...m, feedback: v } : m)) }));
    aplicar(valor);
    try {
      await this.api.feedback(mensagemId, valor);
    } catch (e) {
      aplicar(anterior);
      throw e;
    }
  }

  anexar(arquivo: File): Promise<AnexoEnviado> {
    return this.api.anexar(arquivo);
  }

  /** Executa a ação de um botão dentro de uma mensagem (tabela "Ações de botão" do documento). */
  async executarAcao(acao: AcaoBloco, execucaoId: string | undefined, abrir: (url: string) => void): Promise<void> {
    switch (acao.acao) {
      case 'abrir':
        if (acao.url) abrir(acao.url);
        return;
      case 'mensagem':
        this.enviar(acao.mensagem ?? acao.rotulo);
        return;
      case 'humano':
        await this.pedirHumano(acao.mensagem);
        return;
      case 'atualizar':
        if (!execucaoId) throw new Error('Não encontrei o pedido para atualizar.');
        await this.atualizarExistente(execucaoId);
        return;
      case 'tentar':
        if (!execucaoId) throw new Error('Não encontrei o pedido para tentar de novo.');
        await this.tentar(execucaoId);
        return;
    }
  }
}

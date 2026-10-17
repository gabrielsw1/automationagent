// Cliente da API do widget (/api/widget). Ver docs/arquitetura.md, seção "API do widget".
import type {
  AnexoEnviado,
  ConversaWidget,
  EnviarMensagemPedido,
  ErroApi,
  ItemRecente,
  MensagemWidget,
  PaginaContexto,
  SugestaoProativa,
  WidgetInicio,
  WidgetInicioPedido,
} from '@copiloto/shared';

export class ErroCliente extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly ref?: string;

  constructor(mensagem: string, status: number, codigo: string, ref?: string) {
    super(mensagem);
    this.name = 'ErroCliente';
    this.status = status;
    this.codigo = codigo;
    this.ref = ref;
  }

  /** Sem resposta do servidor (sem internet, servidor fora, CORS). */
  get rede(): boolean {
    return this.status === 0;
  }

  /** Vale a pena tentar de novo mais tarde. */
  get temporario(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 502;
  }
}

export function juntarUrl(base: string, caminho: string): string {
  return base.replace(/\/+$/, '') + caminho;
}

async function lerCorpo(resp: Response): Promise<unknown> {
  const texto = await resp.text();
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

export async function pedirJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch {
    throw new ErroCliente('Sem conexão com o copiloto. Confira a internet e tente de novo.', 0, 'rede');
  }
  let corpo: unknown;
  try {
    corpo = await lerCorpo(resp);
  } catch {
    // Corpo cortado no meio (rede caiu ou a página saiu): é falta de conexão, não uma resposta vazia.
    throw new ErroCliente('Sem conexão com o copiloto. Confira a internet e tente de novo.', 0, 'rede');
  }
  if (!resp.ok) {
    const e = (corpo && typeof corpo === 'object' ? corpo : {}) as Partial<ErroApi>;
    const padrao =
      resp.status >= 500
        ? 'O copiloto teve um problema agora. Tente de novo em instantes.'
        : 'Não foi possível concluir o pedido.';
    throw new ErroCliente(e.mensagem || padrao, resp.status, e.erro || `http_${resp.status}`, e.ref);
  }
  return corpo as T;
}

export class ClienteApi {
  /** Origem do servidor do copiloto ('' = mesma origem). */
  readonly servidor: string;
  /** Base das rotas do widget. Ex.: http://localhost:3000/api/widget */
  readonly base: string;
  readonly token: string;

  constructor(servidor: string, token: string) {
    this.servidor = servidor.replace(/\/+$/, '');
    this.base = juntarUrl(this.servidor, '/api/widget');
    this.token = token;
  }

  static iniciar(servidor: string, pedido: WidgetInicioPedido): Promise<WidgetInicio> {
    return pedirJson<WidgetInicio>(juntarUrl(servidor.replace(/\/+$/, ''), '/api/widget/iniciar'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pedido),
    });
  }

  private pedir<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    let body: BodyInit | undefined;
    if (corpo instanceof FormData) body = corpo;
    else if (corpo !== undefined || metodo === 'POST') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(corpo ?? {});
    }
    return pedirJson<T>(juntarUrl(this.base, caminho), { method: metodo, headers, body });
  }

  sessao() {
    return this.pedir<WidgetInicio>('GET', '/sessao');
  }
  conversaAberta() {
    return this.pedir<ConversaWidget | null>('GET', '/conversa');
  }
  novaConversa(contexto?: PaginaContexto) {
    return this.pedir<ConversaWidget>('POST', '/conversas', contexto ? { contexto } : {});
  }
  conversa(id: string) {
    return this.pedir<ConversaWidget>('GET', `/conversas/${encodeURIComponent(id)}`);
  }
  enviarMensagem(conversaId: string, pedido: EnviarMensagemPedido) {
    return this.pedir<{ mensagem: MensagemWidget }>('POST', `/conversas/${encodeURIComponent(conversaId)}/mensagens`, pedido);
  }
  private execucao(id: string, acao: string) {
    return this.pedir<{ ok: boolean }>('POST', `/execucoes/${encodeURIComponent(id)}/${acao}`);
  }
  confirmar(execucaoId: string) {
    return this.execucao(execucaoId, 'confirmar');
  }
  corrigir(execucaoId: string) {
    return this.execucao(execucaoId, 'corrigir');
  }
  cancelar(execucaoId: string) {
    return this.execucao(execucaoId, 'cancelar');
  }
  desfazer(execucaoId: string) {
    return this.execucao(execucaoId, 'desfazer');
  }
  tentar(execucaoId: string) {
    return this.execucao(execucaoId, 'tentar');
  }
  atualizarExistente(execucaoId: string) {
    return this.execucao(execucaoId, 'atualizar-existente');
  }
  enviarAprovacao(aprovacaoId: string) {
    return this.pedir<{ ok: boolean }>('POST', `/aprovacoes/${encodeURIComponent(aprovacaoId)}/enviar`);
  }
  cancelarAprovacao(aprovacaoId: string) {
    return this.pedir<{ ok: boolean }>('POST', `/aprovacoes/${encodeURIComponent(aprovacaoId)}/cancelar`);
  }
  pedirHumano(conversaId: string, motivo?: string) {
    return this.pedir<{ ok: boolean }>('POST', `/conversas/${encodeURIComponent(conversaId)}/humano`, motivo ? { motivo } : {});
  }
  feedback(mensagemId: string, valor: 'util' | 'nao_util') {
    return this.pedir<{ ok: boolean }>('POST', `/mensagens/${encodeURIComponent(mensagemId)}/feedback`, { valor });
  }
  anexar(arquivo: File) {
    const dados = new FormData();
    dados.append('arquivo', arquivo, arquivo.name);
    return this.pedir<AnexoEnviado>('POST', '/anexos', dados);
  }
  /** `pagina`: nome da seção (data-pagina ou título), comparado com os contextos das tarefas. */
  proativa(pagina: string, segundosParado: number) {
    return this.pedir<{ sugestao: SugestaoProativa | null }>('POST', '/proativa', { pagina: pagina.slice(0, 120), segundosParado });
  }
  recentes() {
    return this.pedir<ItemRecente[]>('GET', '/recentes');
  }

  urlEventos(conversaId: string): string {
    const q = new URLSearchParams({ token: this.token, conversa: conversaId });
    return `${juntarUrl(this.base, '/eventos')}?${q.toString()}`;
  }

  /**
   * Resolve um link vindo do servidor. Caminhos da API do copiloto (ex.: arquivo gerado, que já vem com
   * `?chave=` assinada) ganham só a origem do servidor; o resto é resolvido contra a página atual.
   */
  resolverLink(url: string): string {
    if (/^\/api\//.test(url)) return juntarUrl(this.servidor, url);
    try {
      return new URL(url, typeof location !== 'undefined' ? location.href : undefined).toString();
    } catch {
      return url;
    }
  }
}

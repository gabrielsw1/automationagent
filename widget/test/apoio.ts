// Peças comuns dos testes: servidor (fetch) e EventSource simulados, dados de exemplo.
import { vi } from 'vitest';
import type { Bloco, ConversaWidget, EventoWidget, MensagemWidget, WidgetInicio } from '@copiloto/shared';

export class EventSourceFalso {
  static instancias: EventSourceFalso[] = [];
  readonly url: string;
  readyState = 0;
  fechado = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    EventSourceFalso.instancias.push(this);
  }

  static ultima(): EventSourceFalso {
    const e = EventSourceFalso.instancias[EventSourceFalso.instancias.length - 1];
    if (!e) throw new Error('nenhum EventSource aberto');
    return e;
  }

  static reiniciar(): void {
    EventSourceFalso.instancias = [];
  }

  close(): void {
    this.fechado = true;
    this.readyState = 2;
  }

  abrir(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  emitir(evento: EventoWidget): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(evento) }));
  }

  falhar(): void {
    this.onerror?.(new Event('error'));
  }
}

export interface Chamada {
  metodo: string;
  caminho: string;
  busca: URLSearchParams;
  corpo: unknown;
  headers: Record<string, string>;
}

type Manipulador = (c: Chamada) => unknown | Promise<unknown>;

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

/** Simula o servidor do copiloto: "METODO /caminho" → resposta (objeto vira JSON 200; Response passa direto). */
export function servidorFalso(rotas: Record<string, Manipulador>) {
  const chamadas: Chamada[] = [];
  const fetchFalso = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(entrada), 'http://localhost:3000');
    const metodo = (init?.method ?? 'GET').toUpperCase();
    let corpo: unknown = init?.body;
    if (typeof init?.body === 'string') {
      try {
        corpo = JSON.parse(init.body);
      } catch {
        corpo = init.body;
      }
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const chamada: Chamada = { metodo, caminho: url.pathname, busca: url.searchParams, corpo, headers };
    chamadas.push(chamada);
    const m = rotas[`${metodo} ${url.pathname}`];
    if (!m) return json({ erro: 'nao_encontrado', mensagem: `Rota simulada ausente: ${metodo} ${url.pathname}` }, 404);
    const r = await m(chamada);
    if (r instanceof Response) return r;
    return json(r === undefined ? { ok: true } : r);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return {
    chamadas,
    fetch: fetchFalso,
    de: (metodo: string, caminho: string) => chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho),
  };
}

export function inicioFalso(mudar: Partial<WidgetInicio> = {}): WidgetInicio {
  return {
    token: 'tk-teste',
    usuario: { id: '101', nome: 'Ana Ribeiro', primeiroNome: 'Ana', perfis: ['Atendimento', 'Comercial'] },
    config: {
      nome: 'Copiloto',
      boasVindas: 'Faço tarefas no Horizonte para você. Diga o que precisa do seu jeito; eu pergunto o que faltar.',
      sugestoes: ['Cadastrar cliente'],
      cor: '#FA276B',
      posicao: 'direita',
      atalho: true,
      proativa: { ativa: true, segundosParado: 30 },
      atendimentoHumano: { horario: 'segunda a sexta, das 8h às 18h' },
    },
    sugestoes: [
      { rotulo: 'Cadastrar cliente', mensagem: 'Quero cadastrar um cliente' },
      { rotulo: 'Emitir relatório de vendas', mensagem: 'Quero emitir o relatório de vendas' },
    ],
    recentes: [],
    conversaId: null,
    modoSimulado: false,
    semClaude: false,
    modoTeste: false,
    pausa: null,
    ...mudar,
  };
}

let seq = 0;
export function msg(parcial: Partial<MensagemWidget> & Pick<MensagemWidget, 'autor'>): MensagemWidget {
  seq += 1;
  return {
    id: `m${seq}`,
    conversaId: 'c1',
    blocos: [],
    criadoEm: new Date().toISOString(),
    ...parcial,
  };
}

export function conversa(mensagens: MensagemWidget[], mudar: Partial<ConversaWidget> = {}): ConversaWidget {
  return { id: 'c1', mensagens, estado: { modo: 'copiloto' }, contexto: { secao: 'Clientes' }, ...mudar };
}

export const CONFIRMACAO: Extract<Bloco, { tipo: 'confirmacao' }> = {
  tipo: 'confirmacao',
  execucaoId: 'EX-20431',
  tarefa: 'Cadastrar cliente',
  titulo: 'Confirme o cadastro',
  campos: [
    { rotulo: 'Cliente', valor: 'ACME Logística' },
    { rotulo: 'CNPJ', valor: '12.345.678/0001-95', selo: 'valido' },
    { rotulo: 'E-mail de cobrança', valor: 'financeiro@acmelog.com.br' },
    { rotulo: 'Prazo', valor: '30 dias' },
    { rotulo: 'Responsável', valor: 'Ana Ribeiro', editavel: true },
  ],
  caminho: 'api',
  tempoEstimado: 'cerca de 5 s',
  desfazerMinutos: 5,
  estado: 'pendente',
};

/** Espera as promessas pendentes (respostas do fetch simulado). */
export async function esperarPromessas(vezes = 5): Promise<void> {
  for (let i = 0; i < vezes; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

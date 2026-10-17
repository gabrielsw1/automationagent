// Cliente HTTP do console. As rotas do console ficam em /api/console e usam o cookie de sessão; as
// do site do produto (planos, pedido de contato, textos jurídicos) ficam em /api/publico, sem sessão.
import type { ErroApi } from '@copiloto/shared';

export class ErroApiCliente extends Error {
  constructor(
    readonly status: number,
    readonly erro: string,
    mensagem: string,
    readonly ref?: string,
    /** Campos extras do corpo: `ate` (entrada bloqueada), `restantes` (código incorreto), `aguardarS` (429), `email` (convite vencido). */
    readonly extra: Pick<ErroApi, 'ate' | 'restantes' | 'aguardarS' | 'email'> = {},
  ) {
    super(mensagem);
    this.name = 'ErroApiCliente';
  }
  /** Sem conexão com o servidor (offline ou servidor parado). */
  get offline() {
    return this.status === 0;
  }
}

const BASE = '/api/console';

/** Chamado quando qualquer rota responde 401 (o App leva para a tela de entrada). */
export let aoSessaoExpirar: () => void = () => {};
export function definirAoSessaoExpirar(fn: () => void) {
  aoSessaoExpirar = fn;
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown, base = BASE): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(base + caminho, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo instanceof FormData || corpo === undefined ? {} : { 'content-type': 'application/json' },
      body: corpo instanceof FormData ? corpo : corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApiCliente(0, 'offline', 'Sem conexão. Confira a internet e tente de novo.');
  }
  if (resposta.status === 204) return undefined as T;
  const tipo = resposta.headers.get('content-type') ?? '';
  const dados = tipo.includes('json') ? await resposta.json().catch(() => null) : await resposta.text();
  if (!resposta.ok) {
    const e = (dados ?? {}) as Partial<ErroApi>;
    if (resposta.status === 401 && base === BASE && !caminho.startsWith('/auth/')) aoSessaoExpirar();
    throw new ErroApiCliente(
      resposta.status,
      e.erro ?? 'erro',
      e.mensagem ?? 'Não foi possível concluir. Tente de novo.',
      e.ref,
      { ate: e.ate, restantes: e.restantes, aguardarS: e.aguardarS, email: e.email },
    );
  }
  return dados as T;
}

export const api = {
  get: <T>(caminho: string) => pedir<T>('GET', caminho),
  post: <T>(caminho: string, corpo?: unknown) => pedir<T>('POST', caminho, corpo ?? {}),
  put: <T>(caminho: string, corpo?: unknown) => pedir<T>('PUT', caminho, corpo ?? {}),
  patch: <T>(caminho: string, corpo?: unknown) => pedir<T>('PATCH', caminho, corpo ?? {}),
  del: <T>(caminho: string) => pedir<T>('DELETE', caminho),
  upload: <T>(caminho: string, dados: FormData) => pedir<T>('POST', caminho, dados),
  /** URL absoluta de uma rota do console (para <a href> de download e <img src>). */
  url: (caminho: string) => BASE + caminho,
};

/** Rotas do site do produto (/api/publico): sem sessão, nunca levam à tela de entrada. */
export const apiPublica = {
  get: <T>(caminho: string) => pedir<T>('GET', caminho, undefined, '/api/publico'),
  post: <T>(caminho: string, corpo?: unknown) => pedir<T>('POST', caminho, corpo ?? {}, '/api/publico'),
};

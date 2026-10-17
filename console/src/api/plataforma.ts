// Cliente HTTP da Plataforma Starta. As rotas ficam em /api/plataforma e usam o cookie da equipe
// Starta (starta_sessao), separado do cookie do console das empresas. O formato dos erros é o
// mesmo do console, então as telas reaproveitam ErroApiCliente, EstadoErro e useAcao.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AcessoSuporteResumo, ContatoRecebido, ErroApi } from '@copiloto/shared';
import { ErroApiCliente } from './cliente.ts';
import type { EstadoApi } from './hooks.ts';

const BASE = '/api/plataforma';

/** Chamado quando uma rota de dados responde 401 (a moldura leva para /plataforma/entrar). */
let aoSessaoExpirar: () => void = () => {};
export function definirAoSessaoStartaExpirar(fn: () => void) {
  aoSessaoExpirar = fn;
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(BASE + caminho, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo === undefined ? {} : { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApiCliente(0, 'offline', 'Sem conexão. Confira a internet e tente de novo.');
  }
  if (resposta.status === 204) return undefined as T;
  const tipo = resposta.headers.get('content-type') ?? '';
  const dados = tipo.includes('json') ? await resposta.json().catch(() => null) : await resposta.text();
  if (!resposta.ok) {
    const e = (dados ?? {}) as Partial<ErroApi>;
    if (resposta.status === 401 && !caminho.startsWith('/auth/')) aoSessaoExpirar();
    throw new ErroApiCliente(resposta.status, e.erro ?? 'erro', e.mensagem ?? 'Não foi possível concluir. Tente de novo.', e.ref, {
      ate: e.ate,
      restantes: e.restantes,
    });
  }
  return dados as T;
}

export const apiPlataforma = {
  get: <T>(caminho: string) => pedir<T>('GET', caminho),
  post: <T>(caminho: string, corpo?: unknown) => pedir<T>('POST', caminho, corpo ?? {}),
  put: <T>(caminho: string, corpo?: unknown) => pedir<T>('PUT', caminho, corpo ?? {}),
};

/** GET da Plataforma com carregando/erro, como o useApi do console. `caminho` null não chama nada. */
export function useApiPlataforma<T>(caminho: string | null): EstadoApi<T> {
  const [dados, setDados] = useState<T | undefined>(undefined);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [carregando, setCarregando] = useState(caminho !== null);
  const atual = useRef(caminho);
  atual.current = caminho;

  const carregar = useCallback(async () => {
    if (caminho === null) return;
    try {
      const d = await apiPlataforma.get<T>(caminho);
      if (atual.current === caminho) {
        setDados(d);
        setErro(null);
      }
    } catch (e) {
      if (atual.current === caminho) setErro(e as ErroApiCliente);
    } finally {
      if (atual.current === caminho) setCarregando(false);
    }
  }, [caminho]);

  useEffect(() => {
    setCarregando(caminho !== null);
    void carregar();
  }, [carregar, caminho]);

  return { dados, erro, carregando, recarregar: carregar, definir: (fn) => setDados((d) => fn(d)) };
}

// ---------- Respostas sem tipo próprio no shared ----------

/** GET /suporte */
export interface SuportePlataforma {
  acessos: AcessoSuporteResumo[];
  contatos: ContatoRecebido[];
  desde: string;
}

/** Resposta de "Sugerir regravação à empresa". */
export interface RegravacaoSugerida {
  enviadosPara: number;
  envio: 'smtp' | 'caixa_local';
}

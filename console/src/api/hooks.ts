// Hooks de dados do console.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ErroApiCliente } from './cliente.ts';

export interface EstadoApi<T> {
  dados: T | undefined;
  erro: ErroApiCliente | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  /** Troca os dados localmente (ex.: depois de salvar), sem nova chamada. */
  definir: (fn: (atual: T | undefined) => T | undefined) => void;
}

/** GET com estado de carregando/erro. `caminho` null não chama nada. */
export function useApi<T>(caminho: string | null, opcoes: { intervaloMs?: number } = {}): EstadoApi<T> {
  const [dados, setDados] = useState<T | undefined>(undefined);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [carregando, setCarregando] = useState(caminho !== null);
  const atual = useRef(caminho);
  atual.current = caminho;

  const carregar = useCallback(async () => {
    if (caminho === null) return;
    try {
      const d = await api.get<T>(caminho);
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
    if (!opcoes.intervaloMs) return;
    const id = setInterval(() => void carregar(), opcoes.intervaloMs);
    return () => clearInterval(id);
  }, [carregar, caminho, opcoes.intervaloMs]);

  return { dados, erro, carregando, recarregar: carregar, definir: (fn) => setDados((d) => fn(d)) };
}

/** Executa uma ação (POST/PUT...) guardando "enviando" e o erro para mostrar ao lado do botão. */
export function useAcao<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const executar = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setEnviando(true);
      setErro(null);
      try {
        return await fn(...args);
      } catch (e) {
        setErro(e as ErroApiCliente);
        return undefined;
      } finally {
        setEnviando(false);
      }
    },
    [fn],
  );
  return { executar, enviando, erro, limparErro: () => setErro(null) };
}

/** Eventos ao vivo do console (SSE). */
export function useEventosConsole(aoEvento: (e: { tipo: string; [k: string]: unknown }) => void) {
  const ref = useRef(aoEvento);
  ref.current = aoEvento;
  useEffect(() => {
    const fonte = new EventSource('/api/console/eventos');
    fonte.onmessage = (m) => {
      try {
        ref.current(JSON.parse(m.data));
      } catch {
        /* evento malformado: ignora */
      }
    };
    return () => fonte.close();
  }, []);
}

// Estado da página que a moldura (layout) mostra: trilha "Tarefas > Cadastrar cliente" e o título
// da aba do navegador. Também a conexão com a internet.
//
//   useMigalhas([{ rotulo: 'Tarefas', para: '/tarefas' }, { rotulo: def.nome }]);
//   const online = useOnline();   // false: mostre "sem internet" e desative "Publicar"
//
// Páginas que não chamam useMigalhas ganham a trilha padrão da rota (ex.: "Copiloto > Painel").
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export interface Migalha {
  rotulo: string;
  para?: string;
}

interface CtxMigalhas {
  definir: (m: Migalha[] | null) => void;
}

const Contexto = createContext<CtxMigalhas | null>(null);

export function ProvedorMigalhas({ definir, children }: { definir: (m: Migalha[] | null) => void; children: ReactNode }) {
  return <Contexto.Provider value={{ definir }}>{children}</Contexto.Provider>;
}

/** Troca a trilha do topo enquanto a página estiver aberta. */
export function useMigalhas(migalhas: Migalha[] | null) {
  const ctx = useContext(Contexto);
  const chave = JSON.stringify(migalhas);
  useEffect(() => {
    if (!ctx) return;
    ctx.definir(migalhas);
    return () => ctx.definir(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
}

function assinarConexao(fn: () => void) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

/** true enquanto o navegador estiver com internet. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    assinarConexao,
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    () => true,
  );
}

/** Valor que só muda depois de `ms` sem mudanças (busca enquanto digita). */
export function useAtrasado<T>(valor: T, ms = 250): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Lê e grava no localStorage sem quebrar quando ele não existe (modo privado, testes). */
export const guardado = {
  ler<T>(chave: string): T | null {
    try {
      const v = localStorage.getItem(chave);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  gravar(chave: string, valor: unknown) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* sem armazenamento: ignora */
    }
  },
  apagar(chave: string) {
    try {
      localStorage.removeItem(chave);
    } catch {
      /* ignora */
    }
  },
};

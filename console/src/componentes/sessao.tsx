// Sessão do console: quem está logado, contadores do menu e permissões.
import { createContext, useContext, type ReactNode } from 'react';
import { pode, type Permissao, type ResumoConsole } from '@copiloto/shared';

export interface Sessao {
  resumo: ResumoConsole;
  recarregarResumo: () => Promise<void>;
  sair: () => Promise<void>;
}

const ContextoSessao = createContext<Sessao | null>(null);

export function ProvedorSessao({ valor, children }: { valor: Sessao; children: ReactNode }) {
  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>;
}

export function useSessao(): Sessao {
  const s = useContext(ContextoSessao);
  if (!s) throw new Error('useSessao fora do ProvedorSessao');
  return s;
}

/** Sessão quando existir (componentes que também aparecem fora da área logada). */
export function useSessaoOpcional(): Sessao | null {
  return useContext(ContextoSessao);
}

/** true se o perfil logado tem a permissão. Use para esconder ou desabilitar botões. */
export function usePode(permissao: Permissao): boolean {
  return pode(useSessao().resumo.eu.perfil, permissao);
}

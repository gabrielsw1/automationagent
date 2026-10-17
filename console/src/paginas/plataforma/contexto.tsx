// Sessão da Plataforma Starta: quem entrou e os dados que a moldura e as páginas dividem (a lista
// de empresas, que dá o contador de Implantações, e a saúde dos fluxos, que dá o de quebrados).
import { createContext, useContext, type ReactNode } from 'react';
import type { EuStarta, PainelEmpresas, SaudeFluxo } from '@copiloto/shared';
import type { EstadoApi } from '../../api/hooks.ts';

export interface SessaoStarta {
  eu: EuStarta;
  definirEu: (eu: EuStarta) => void;
  painel: EstadoApi<PainelEmpresas>;
  saude: EstadoApi<SaudeFluxo[]>;
  /** Busca de novo a lista de empresas e a saúde (depois de mudar algo). */
  atualizar: () => void;
  sair: () => Promise<void>;
  /** Abre "Meus códigos de recuperação". */
  abrirCodigos: () => void;
}

const Contexto = createContext<SessaoStarta | null>(null);

export function ProvedorSessaoStarta({ valor, children }: { valor: SessaoStarta; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessaoStarta(): SessaoStarta {
  const s = useContext(Contexto);
  if (!s) throw new Error('useSessaoStarta fora do ProvedorSessaoStarta');
  return s;
}

/** Empresas de demonstração, por id (para o selo nas tabelas que só trazem o nome). */
export function useEmpresasDemo(): Set<string> {
  const { painel } = useSessaoStarta();
  return new Set((painel.dados?.empresas ?? []).filter((e) => e.demo).map((e) => e.id));
}

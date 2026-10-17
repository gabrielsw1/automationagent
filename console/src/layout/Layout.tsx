// Moldura provisória do console (menu lateral + topo). Substituída pela versão do design (C1).
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSessao } from '../componentes/sessao.tsx';

export default function Layout({ children }: { children: ReactNode }) {
  const { resumo, sair } = useSessao();
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 240, padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <strong>Copiloto</strong>
        <NavLink to="/painel">Painel</NavLink>
        <NavLink to="/execucoes">Execuções</NavLink>
        <NavLink to="/tarefas">Tarefas</NavLink>
        <NavLink to="/aprender">Aprender fluxo</NavLink>
        <NavLink to="/conhecimento">Conhecimento</NavLink>
        <NavLink to="/canais">Canais e widget</NavLink>
        <NavLink to="/equipe">Equipe e limites</NavLink>
        <NavLink to="/guia">Guia de início</NavLink>
        <button className="btn btn-ghost" onClick={() => void sair()}>
          Sair ({resumo.eu.nome})
        </button>
      </nav>
      <main style={{ flex: 1, padding: 24 }}>{children}</main>
    </div>
  );
}

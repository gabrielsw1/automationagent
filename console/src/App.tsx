// Rotas do console. Cada página vive em src/paginas/<area>/ (ver docs/arquitetura.md).
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ResumoConsole } from '@copiloto/shared';
import { api, definirAoSessaoExpirar, ErroApiCliente } from './api/cliente.ts';
import { Carregando, EstadoErro } from './componentes/estados.tsx';
import { ProvedorSessao } from './componentes/sessao.tsx';
import { ProvedorToast } from './componentes/Toast.tsx';
import Layout from './layout/Layout.tsx';

const Entrar = lazy(() => import('./paginas/entrar/Entrar.tsx'));
const Convite = lazy(() => import('./paginas/entrar/Convite.tsx'));
const Guia = lazy(() => import('./paginas/guia/Guia.tsx'));
const Painel = lazy(() => import('./paginas/painel/Painel.tsx'));
const ListaTarefas = lazy(() => import('./paginas/tarefas/ListaTarefas.tsx'));
const FichaTarefa = lazy(() => import('./paginas/tarefas/FichaTarefa.tsx'));
const Aprender = lazy(() => import('./paginas/aprender/Aprender.tsx'));
const ListaExecucoes = lazy(() => import('./paginas/execucoes/ListaExecucoes.tsx'));
const DetalheExecucao = lazy(() => import('./paginas/execucoes/DetalheExecucao.tsx'));
const Conhecimento = lazy(() => import('./paginas/conhecimento/Conhecimento.tsx'));
const Canais = lazy(() => import('./paginas/canais/Canais.tsx'));
const Equipe = lazy(() => import('./paginas/equipe/Equipe.tsx'));

function AreaLogada() {
  const navegar = useNavigate();
  const [resumo, setResumo] = useState<ResumoConsole | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);

  // Depois de entrar, volta para onde a pessoa ia (ex.: /aprender?gravar=..., aberto pela extensão).
  const irParaEntrar = useCallback(() => {
    const aqui = `${window.location.pathname}${window.location.search}`;
    navegar(aqui === '/' ? '/entrar' : `/entrar?voltar=${encodeURIComponent(aqui)}`, { replace: true });
  }, [navegar]);

  const carregar = useCallback(async () => {
    try {
      setResumo(await api.get<ResumoConsole>('/resumo'));
      setErro(null);
    } catch (e) {
      const ex = e as ErroApiCliente;
      if (ex.status === 401) irParaEntrar();
      else setErro(ex);
    }
  }, [irParaEntrar]);

  useEffect(() => {
    definirAoSessaoExpirar(irParaEntrar);
    void carregar();
  }, [carregar, irParaEntrar]);

  if (erro && !resumo) {
    return (
      <div className="ca-tela-cheia">
        <EstadoErro erro={erro} aoTentar={() => void carregar()} titulo="Não conseguimos abrir o console" />
      </div>
    );
  }
  if (!resumo) return <Carregando texto="Abrindo o console…" />;

  const sair = async () => {
    await api.post('/auth/sair').catch(() => {});
    navegar('/entrar', { replace: true });
  };

  return (
    <ProvedorSessao valor={{ resumo, recarregarResumo: carregar, sair }}>
      <Layout>
        <Suspense fallback={<Carregando />}>
          <Routes>
            <Route path="/" element={<Navigate to={resumo.guia.feitos < resumo.guia.total ? '/guia' : '/painel'} replace />} />
            <Route path="/guia" element={<Guia />} />
            <Route path="/painel" element={<Painel />} />
            <Route path="/tarefas" element={<ListaTarefas />} />
            <Route path="/tarefas/:id" element={<FichaTarefa />} />
            <Route path="/aprender" element={<Aprender />} />
            <Route path="/aprender/:fluxoId" element={<Aprender />} />
            <Route path="/execucoes" element={<ListaExecucoes />} />
            <Route path="/execucoes/:id" element={<DetalheExecucao />} />
            <Route path="/conhecimento" element={<Conhecimento />} />
            <Route path="/canais" element={<Canais />} />
            <Route path="/equipe" element={<Equipe />} />
            <Route path="*" element={<Navigate to="/painel" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </ProvedorSessao>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ProvedorToast>
        <Suspense fallback={<Carregando />}>
          <Routes>
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/convite/:token" element={<Convite />} />
            <Route path="/*" element={<AreaLogada />} />
          </Routes>
        </Suspense>
      </ProvedorToast>
    </BrowserRouter>
  );
}

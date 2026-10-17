// Rotas do console. Cada página vive em src/paginas/<area>/ (ver docs/arquitetura.md).
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ResumoConsole } from '@copiloto/shared';
import { api, definirAoSessaoExpirar, ErroApiCliente } from './api/cliente.ts';
import { esquecerUsuariosDoSistema } from './componentes/ChatDeTeste.tsx';
import { Carregando, EstadoErro } from './componentes/estados.tsx';
import { ProvedorSessao } from './componentes/sessao.tsx';
import { ProvedorToast } from './componentes/Toast.tsx';
import Layout from './layout/Layout.tsx';

const Entrar = lazy(() => import('./paginas/entrar/Entrar.tsx'));
const EscolherEmpresa = lazy(() => import('./paginas/entrar/EscolherEmpresa.tsx'));
const EsqueciSenha = lazy(() => import('./paginas/entrar/EsqueciSenha.tsx'));
const SenhaNova = lazy(() => import('./paginas/entrar/SenhaNova.tsx'));
const Convite = lazy(() => import('./paginas/entrar/Convite.tsx'));
const Cadastro = lazy(() => import('./paginas/cadastro/Cadastro.tsx'));
const Site = lazy(() => import('./paginas/site/Site.tsx'));
const PaginaLegal = lazy(() => import('./paginas/site/PaginaLegal.tsx'));
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
const Plano = lazy(() => import('./paginas/plano/Plano.tsx'));
const Sistema = lazy(() => import('./paginas/sistema/Sistema.tsx'));
// Plataforma Starta: moldura e sessão próprias (a equipe Starta), fora do console das empresas.
const AreaPlataforma = lazy(() => import('./paginas/plataforma/AreaPlataforma.tsx'));
const EntrarPlataforma = lazy(() => import('./paginas/plataforma/EntrarPlataforma.tsx'));
const AtivarPlataforma = lazy(() => import('./paginas/plataforma/AtivarPlataforma.tsx'));

function AreaLogada() {
  const navegar = useNavigate();
  const [resumo, setResumo] = useState<ResumoConsole | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  // Sem sessão no endereço principal: quem chega vê o site do produto (S1), não a tela de entrada.
  const [visitante, setVisitante] = useState(false);

  // Depois de entrar, volta para onde a pessoa ia (ex.: /aprender?gravar=..., aberto pela extensão).
  const irParaEntrar = useCallback(() => {
    // Vários 401 chegam juntos (e o StrictMode carrega duas vezes): só o primeiro leva à entrada.
    if (window.location.pathname === '/entrar') return;
    if (window.location.pathname === '/') {
      setVisitante(true);
      return;
    }
    const aqui = `${window.location.pathname}${window.location.search}`;
    navegar(`/entrar?voltar=${encodeURIComponent(aqui)}`, { replace: true });
  }, [navegar]);

  const carregar = useCallback(async () => {
    try {
      setResumo(await api.get<ResumoConsole>('/resumo'));
      setErro(null);
    } catch (e) {
      const ex = e as ErroApiCliente;
      if (ex.status === 401) irParaEntrar();
      // Conta nova que ainda não confirmou o e-mail: o cadastro mostra o código (A5) no lugar do console.
      else if (ex.erro === 'email_nao_confirmado') navegar('/criar-conta', { replace: true });
      else setErro(ex);
    }
  }, [irParaEntrar, navegar]);

  useEffect(() => {
    definirAoSessaoExpirar(irParaEntrar);
    // A área logada abre de novo depois de entrar, aceitar convite ou criar empresa: pode ser outra
    // sessão ou outra empresa, então nada do cache anterior vale.
    esquecerUsuariosDoSistema();
    void carregar();
  }, [carregar, irParaEntrar]);

  if (visitante) return <Site />;
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
            <Route path="/sistema" element={<Sistema />} />
            <Route path="/equipe" element={<Equipe />} />
            <Route path="/plano" element={<Plano />} />
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
            <Route path="/plataforma/entrar" element={<EntrarPlataforma />} />
            <Route path="/plataforma/ativar/:token" element={<AtivarPlataforma />} />
            <Route path="/plataforma/*" element={<AreaPlataforma />} />
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/entrar/empresa" element={<EscolherEmpresa />} />
            <Route path="/senha" element={<EsqueciSenha />} />
            <Route path="/senha-nova/:token" element={<SenhaNova />} />
            <Route path="/convite/:token" element={<Convite />} />
            <Route path="/criar-conta/:etapa?" element={<Cadastro />} />
            <Route path="/site" element={<Site />} />
            <Route path="/termos" element={<PaginaLegal documento="termos" />} />
            <Route path="/privacidade" element={<PaginaLegal documento="privacidade" />} />
            <Route path="/contrato-lgpd" element={<PaginaLegal documento="contrato-lgpd" />} />
            <Route path="/*" element={<AreaLogada />} />
          </Routes>
        </Suspense>
      </ProvedorToast>
    </BrowserRouter>
  );
}

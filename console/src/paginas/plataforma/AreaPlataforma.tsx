// Moldura da Plataforma Starta (S7): menu lateral próprio (Empresas, Implantações, Uso e custos,
// Saúde dos fluxos, Suporte, Configurações e quem entrou), topo com a trilha, "Buscar empresa",
// "Plataforma Starta" e o menu da pessoa. Separada do console das empresas: a sessão é a da equipe
// Starta (GET /api/plataforma/auth/eu); sem ela, vai para a entrada (A7, /plataforma/entrar).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { EuStarta, PainelEmpresas, SaudeFluxo } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { apiPlataforma, definirAoSessaoStartaExpirar, useApiPlataforma } from '../../api/plataforma.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Icone, type NomeIcone } from '../../componentes/icones.tsx';
import { ItemMenu, Menu } from '../../componentes/Menu.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { FaixaSemInternet } from '../../layout/Faixas.tsx';
import { BuscaEmpresa } from './Busca.tsx';
import { ModalCodigos } from './Codigos.tsx';
import Configuracoes from './Configuracoes.tsx';
import { ProvedorSessaoStarta, useSessaoStarta, type SessaoStarta } from './contexto.tsx';
import Empresas from './Empresas.tsx';
import Implantacoes from './Implantacoes.tsx';
import type { EstadoEntrou } from './MolduraAcesso.tsx';
import SaudeFluxos from './SaudeFluxos.tsx';
import Suporte from './Suporte.tsx';
import UsoCustos from './UsoCustos.tsx';
import './plataforma.css';

interface ItemNav {
  para: string;
  rotulo: string;
  titulo: string;
  icone: NomeIcone;
  contador?: 'implantacoes' | 'quebrados';
}

export const NAV_PLATAFORMA: ItemNav[] = [
  { para: '/plataforma', rotulo: 'Empresas', titulo: 'Empresas clientes', icone: 'equipe' },
  { para: '/plataforma/implantacoes', rotulo: 'Implantações', titulo: 'Implantações', icone: 'guia', contador: 'implantacoes' },
  { para: '/plataforma/uso', rotulo: 'Uso e custos', titulo: 'Uso e custos', icone: 'cartao' },
  { para: '/plataforma/saude', rotulo: 'Saúde dos fluxos', titulo: 'Saúde dos fluxos', icone: 'execucoes', contador: 'quebrados' },
  { para: '/plataforma/suporte', rotulo: 'Suporte', titulo: 'Suporte', icone: 'chat' },
  { para: '/plataforma/configuracoes', rotulo: 'Configurações', titulo: 'Configurações', icone: 'engrenagem' },
];

const ENTRAR = '/plataforma/entrar';

function Contador({ tipo }: { tipo: NonNullable<ItemNav['contador']> }) {
  const { painel, saude } = useSessaoStarta();
  const n =
    tipo === 'implantacoes'
      ? painel.dados?.empresas.filter((e) => !e.demo && (e.situacao === 'implantacao' || e.situacao === 'piloto')).length
      : saude.dados?.filter((f) => f.quebrado).length;
  if (!n) return null;
  return (
    <span
      className={`badge ${tipo === 'quebrados' ? 'badge-danger' : 'badge-info'} count`}
      title={tipo === 'quebrados' ? `${n} ${n === 1 ? 'fluxo quebrado' : 'fluxos quebrados'}` : `${n} em implantação ou piloto`}
    >
      <span className="sr-only">{tipo === 'quebrados' ? 'Fluxos quebrados: ' : 'Em implantação ou piloto: '}</span>
      {n}
    </span>
  );
}

function Navegacao() {
  const { eu } = useSessaoStarta();
  return (
    <nav className="sidebar cp-sidebar" aria-label="Menu da plataforma">
      <Link to="/plataforma" className="brandmark cp-marca" aria-label="Copiloto · Plataforma, ir para Empresas">
        <span className="logo-ph" aria-hidden="true">
          S
        </span>
        <span>Copiloto · Plataforma</span>
      </Link>
      {NAV_PLATAFORMA.map((item) => (
        <NavLink key={item.para} to={item.para} end={item.para === '/plataforma'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Icone nome={item.icone} />
          <span>{item.rotulo}</span>
          {item.contador ? <Contador tipo={item.contador} /> : null}
        </NavLink>
      ))}
      <div className="sidebar-foot">
        <div className="row cp-pessoa">
          <span className="avatar" aria-hidden="true">
            {eu.iniciais}
          </span>
          <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
            <span className="small strong cp-reticencias">{eu.nome}</span>
            <span className="tiny muted">Admin da plataforma</span>
          </span>
        </div>
      </div>
    </nav>
  );
}

function MenuPessoa() {
  const { eu, sair, abrirCodigos } = useSessaoStarta();
  return (
    <Menu
      largura={280}
      botao={(p) => (
        <button type="button" className="ca-avatar-botao" aria-label={`${eu.nome}, Admin da plataforma. Abrir menu da conta`} title={`${eu.nome}, Admin da plataforma`} {...p}>
          <span className="avatar">{eu.iniciais}</span>
        </button>
      )}
    >
      {(fechar) => (
        <>
          <div className="ca-menu-cabeca">
            <span className="strong">{eu.nome}</span>
            <span className="tiny muted">{eu.email}</span>
            <span className="badge badge-outline" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              Admin da plataforma
            </span>
          </div>
          <ItemMenu
            titulo="Meus códigos de recuperação"
            icone="cadeado"
            aoClicar={() => {
              fechar();
              abrirCodigos();
            }}
          />
          <ItemMenu titulo="Equipe Starta" icone="equipe" para="/plataforma/configuracoes" aoClicar={fechar} />
          <ItemMenu
            titulo="Sair"
            icone="sair"
            aoClicar={() => {
              fechar();
              void sair();
            }}
          />
        </>
      )}
    </Menu>
  );
}

function Moldura() {
  const { pathname } = useLocation();
  const atual = [...NAV_PLATAFORMA].reverse().find((i) => pathname === i.para || pathname.startsWith(`${i.para}/`)) ?? NAV_PLATAFORMA[0];
  useEffect(() => {
    document.title = `${atual.titulo} · Plataforma Starta`;
  }, [atual.titulo]);

  return (
    <>
      <a className="ca-pular" href="#conteudo">
        Pular para o conteúdo
      </a>
      <FaixaSemInternet />
      <div className="app cp-app">
        <Navegacao />
        <div className="content">
          <header className="topbar cp-topbar">
            <nav className="crumbs" aria-label="Você está em">
              <Link to="/plataforma">Plataforma</Link>
              <Icone nome="seta-direita" tamanho="sm" />
              <span className="ca-trilha-atual" aria-current="page">
                {atual.titulo}
              </span>
            </nav>
            <div className="grow" />
            <BuscaEmpresa id="busca-plataforma" classe="hide-sm cp-busca-topo" />
            <span className="badge badge-outline">Plataforma Starta</span>
            <MenuPessoa />
          </header>
          <main className="page" id="conteudo" tabIndex={-1}>
            <Routes>
              <Route index element={<Empresas />} />
              <Route path="implantacoes" element={<Implantacoes />} />
              <Route path="uso" element={<UsoCustos />} />
              <Route path="saude" element={<SaudeFluxos />} />
              <Route path="suporte" element={<Suporte />} />
              <Route path="configuracoes" element={<Configuracoes />} />
              <Route path="*" element={<Navigate to="/plataforma" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </>
  );
}

/**
 * Logo depois de entrar (A7), com 2 códigos de recuperação ou menos: avisa uma vez e oferece gerar
 * códigos novos. O aviso também fica no cartão de Configurações.
 */
function AvisoCodigos() {
  const { eu, abrirCodigos } = useSessaoStarta();
  const toast = useToast();
  const navegar = useNavigate();
  const local = useLocation();
  const entrou = (local.state as Partial<EstadoEntrou> | null)?.entrou === true;
  // Uma vez por entrada, mesmo com o efeito rodando duas vezes (StrictMode em desenvolvimento).
  const avisou = useRef(false);
  useEffect(() => {
    if (!entrou || avisou.current) return;
    avisou.current = true;
    // Tira a marca do histórico: voltar ou recarregar não repete o aviso.
    navegar(`${local.pathname}${local.search}`, { replace: true, state: null });
    if (eu.codigosRecuperacao > 2) return;
    toast.mostrar({
      tipo: 'info',
      duracaoMs: 20_000,
      texto:
        eu.codigosRecuperacao === 0
          ? 'Você não tem mais códigos de recuperação. Gere códigos novos para conseguir entrar se perder o celular.'
          : `${eu.codigosRecuperacao === 1 ? 'Resta 1 código' : `Restam ${eu.codigosRecuperacao} códigos`} de recuperação. Gere códigos novos para não ficar sem acesso se perder o celular.`,
      acao: { rotulo: 'Gerar códigos novos', aoClicar: abrirCodigos },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrou]);
  return null;
}

export default function AreaPlataforma() {
  const navegar = useNavigate();
  const local = useLocation();
  const onde = useRef(local);
  onde.current = local;
  const [eu, setEu] = useState<EuStarta | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [codigosAbertos, setCodigosAbertos] = useState(false);

  // `navigate` muda a cada navegação: pela ref, a sessão carrega uma vez só, não a cada página.
  const navegarRef = useRef(navegar);
  navegarRef.current = navegar;
  const irParaEntrar = useCallback(() => {
    const { pathname, search } = onde.current;
    if (pathname.startsWith(ENTRAR)) return;
    const aqui = `${pathname}${search}`;
    setEu(null);
    navegarRef.current(aqui === '/plataforma' ? ENTRAR : `${ENTRAR}?voltar=${encodeURIComponent(aqui)}`, { replace: true });
  }, []);

  const carregar = useCallback(async () => {
    try {
      setEu(await apiPlataforma.get<EuStarta>('/auth/eu'));
      setErro(null);
    } catch (e) {
      const ex = e as ErroApiCliente;
      if (ex.status === 401) irParaEntrar();
      else setErro(ex);
    }
  }, [irParaEntrar]);

  useEffect(() => {
    definirAoSessaoStartaExpirar(irParaEntrar);
    void carregar();
  }, [carregar, irParaEntrar]);

  const logado = eu !== null;
  const painel = useApiPlataforma<PainelEmpresas>(logado ? '/empresas' : null);
  const saude = useApiPlataforma<SaudeFluxo[]>(logado ? '/saude' : null);
  const { recarregar: recarregarPainel } = painel;
  const { recarregar: recarregarSaude } = saude;
  const atualizar = useCallback(() => {
    void recarregarPainel();
    void recarregarSaude();
  }, [recarregarPainel, recarregarSaude]);

  // Os contadores do menu acompanham a navegação entre as páginas.
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    if (logado) atualizar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.pathname]);

  const sair = useCallback(async () => {
    await apiPlataforma.post('/auth/sair').catch(() => {});
    setEu(null);
    navegarRef.current(ENTRAR, { replace: true });
  }, []);

  const valor = useMemo<SessaoStarta | null>(
    () =>
      eu
        ? { eu, definirEu: setEu, painel, saude, atualizar, sair, abrirCodigos: () => setCodigosAbertos(true) }
        : null,
    [eu, painel, saude, atualizar, sair],
  );

  if (erro && !eu) {
    return (
      <div className="ca-tela-cheia">
        <EstadoErro erro={erro} aoTentar={() => void carregar()} titulo="Não conseguimos abrir a Plataforma" />
      </div>
    );
  }
  if (!valor) return <Carregando texto="Abrindo a Plataforma…" />;

  return (
    <ProvedorSessaoStarta valor={valor}>
      <Moldura />
      <AvisoCodigos />
      <ModalCodigos aberto={codigosAbertos} aoFechar={() => setCodigosAbertos(false)} />
    </ProvedorSessaoStarta>
  );
}

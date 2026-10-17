// Moldura do console (C0–C9): menu lateral com o seletor de empresa e contadores, topo com trilha,
// busca, "<empresa> · Produção", "Testar copiloto" e menu da pessoa, faixas globais e o conteúdo.
// No celular (até 760 px) o menu vira uma gaveta aberta pelo botão do topo.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { fmt, ROTULO_PERFIL, type EmpresaResumo, type Eu } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../api/cliente.ts';
import { useEventosConsole } from '../api/hooks.ts';
import { ChatDeTeste } from '../componentes/ChatDeTeste.tsx';
import { Gaveta } from '../componentes/Gaveta.tsx';
import { Icone } from '../componentes/icones.tsx';
import { ItemMenu, Menu } from '../componentes/Menu.tsx';
import { ProvedorMigalhas, type Migalha } from '../componentes/pagina.tsx';
import { recarregar, useSessao } from '../componentes/sessao.tsx';
import { useToast } from '../componentes/Toast.tsx';
import BuscaGlobal from './BuscaGlobal.tsx';
import { FaixaModoSuporte } from './FaixaModoSuporte.tsx';
import { FaixasDoResumo, FaixaSemInternet } from './Faixas.tsx';
import { GRUPOS_NAV, migalhasPadrao } from './navegacao.ts';

function Navegacao({ aoNavegar }: { aoNavegar?: () => void }) {
  const { resumo } = useSessao();
  const { guia } = resumo;
  const guiaCompleto = guia.feitos >= guia.total;
  const verAdmin = resumo.eu.perfil === 'admin' || !!resumo.eu.modoSuporte;
  const grupos = GRUPOS_NAV.filter((g) => !g.soAdminPlataforma || resumo.eu.adminPlataforma).map((g) => ({
    ...g,
    itens: g.itens.filter((i) => !i.soAdmin || verAdmin),
  }));
  return (
    <>
      {grupos.map((g) => (
        <div key={g.rotulo} className="ca-nav-grupo" role="group" aria-label={g.rotulo}>
          {g.rotuloOculto ? null : <div className="nav-label">{g.rotulo}</div>}
          {g.itens.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={aoNavegar}
            >
              <Icone nome={item.icone} />
              <span>{item.rotulo}</span>
              {item.contador === 'execucoes' ? (
                <span className="count row" style={{ gap: 4 }}>
                  {resumo.aprovacoesPendentes > 0 ? (
                    <span
                      className="badge badge-warning"
                      title={`${resumo.aprovacoesPendentes} ${resumo.aprovacoesPendentes === 1 ? 'aprovação pendente' : 'aprovações pendentes'}`}
                    >
                      <span className="sr-only">Aprovações pendentes: </span>
                      {resumo.aprovacoesPendentes}
                    </span>
                  ) : null}
                  {resumo.execucoesAtencao > 0 ? (
                    <span
                      className="badge badge-danger"
                      title={`${resumo.execucoesAtencao} ${resumo.execucoesAtencao === 1 ? 'execução precisa' : 'execuções precisam'} de atenção`}
                    >
                      <span className="sr-only">Precisam de atenção: </span>
                      {resumo.execucoesAtencao}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        <NavLink to="/guia" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={aoNavegar}>
          <Icone nome="guia" />
          <span>Guia de início</span>
          <span className={`badge ${guiaCompleto ? 'badge-success' : 'badge-info'} count`}>
            <span className="sr-only">Passos feitos: </span>
            {guia.feitos}/{guia.total}
          </span>
        </NavLink>
      </div>
    </>
  );
}

function Marca() {
  return (
    <Link to="/" className="brandmark ca-marca" aria-label="Copiloto, ir para o início">
      <span className="logo-ph" aria-hidden="true">
        S
      </span>
      <span>Copiloto</span>
    </Link>
  );
}

function Trilha({ migalhas }: { migalhas: Migalha[] }) {
  return (
    <nav className="crumbs ca-trilha" aria-label="Você está em">
      {migalhas.map((m, i) => {
        const ultimo = i === migalhas.length - 1;
        return (
          <span key={i} className="row" style={{ gap: 'var(--s-2)', minWidth: 0 }}>
            {i > 0 ? <Icone nome="seta-direita" tamanho="sm" /> : null}
            {ultimo ? (
              <span className="strong ca-trilha-atual" aria-current="page">
                {m.rotulo}
              </span>
            ) : m.para ? (
              <Link to={m.para}>{m.rotulo}</Link>
            ) : (
              <span>{m.rotulo}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function SeloDemonstracao() {
  return <span className="badge badge-accent ca-selo-demo">Demonstração</span>;
}

/** Troca a empresa aberta. Tudo na tela é dela: depois de trocar, o console abre de novo do zero. */
function useTrocarEmpresa() {
  const toast = useToast();
  return async (e: EmpresaResumo) => {
    toast.mostrar({ texto: `Abrindo ${e.nome}…`, tipo: 'info' });
    try {
      await api.post<Eu>('/auth/empresa', { empresaId: e.id });
      recarregar.console('/');
    } catch (ex) {
      toast.erro(`Não consegui abrir ${e.nome}. ${(ex as ErroApiCliente).message}`);
    }
  };
}

/** Itens das outras empresas da conta, com o selo "Demonstração". */
function ItensOutrasEmpresas({ outras, fechar, idRotulo }: { outras: EmpresaResumo[]; fechar: () => void; idRotulo: string }) {
  const trocar = useTrocarEmpresa();
  if (!outras.length) return null;
  return (
    <div className="ca-menu-grupo" role="group" aria-labelledby={idRotulo}>
      <span className="tiny muted ca-menu-rotulo" id={idRotulo}>
        Trocar de empresa
      </span>
      {outras.map((e) => (
        <ItemMenu
          key={e.id}
          titulo={
            <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
              {e.nome}
              {e.demo ? <SeloDemonstracao /> : null}
            </span>
          }
          icone="empresa"
          aoClicar={() => {
            fechar();
            void trocar(e);
          }}
        />
      ))}
    </div>
  );
}

/** Seletor de empresa no topo do menu lateral (abaixo da marca, acima de "Painel"). */
function SeletorEmpresa({ aoNavegar, idRotulo }: { aoNavegar?: () => void; idRotulo: string }) {
  const { resumo } = useSessao();
  const { eu } = resumo;
  const outras = eu.empresas.filter((e) => e.id !== eu.empresa.id);
  return (
    <div className="ca-seletor-empresa">
      <Menu
        largura={264}
        alinhar="esquerda"
        botao={(p) => (
          <button
            type="button"
            className="btn btn-secondary btn-sm ca-seletor-botao"
            aria-label={`Trocar de empresa. Empresa atual: ${eu.empresa.nome}`}
            {...p}
          >
            <span className="row ca-seletor-nome">
              <span className="avatar avatar-sm" aria-hidden="true">
                {fmt.iniciaisEmpresa(eu.empresa.nome)}
              </span>
              <span className="ca-seletor-texto">{eu.empresa.nome}</span>
            </span>
            <Icone nome="seta-baixo" tamanho="sm" />
          </button>
        )}
      >
        {(fechar) => (
          <>
            <div className="ca-menu-empresa">
              <span className="tiny muted">Empresa aberta</span>
              <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                <span className="strong">{eu.empresa.nome}</span>
                {eu.empresa.demo ? <SeloDemonstracao /> : null}
              </span>
            </div>
            <ItensOutrasEmpresas outras={outras} fechar={fechar} idRotulo={idRotulo} />
            <ItemMenu
              titulo="Criar outra empresa"
              icone="mais"
              para="/criar-conta"
              aoClicar={() => {
                fechar();
                aoNavegar?.();
              }}
            />
            {eu.adminPlataforma ? (
              <ItemMenu
                titulo="Empresas clientes"
                icone="empresa"
                para="/plataforma"
                aoClicar={() => {
                  fechar();
                  aoNavegar?.();
                }}
              />
            ) : null}
          </>
        )}
      </Menu>
    </div>
  );
}

function MenuPessoa() {
  const { resumo, sair } = useSessao();
  const { eu } = resumo;
  const outras = eu.empresas.filter((e) => e.id !== eu.empresa.id);

  return (
    <Menu
      largura={280}
      botao={(p) => (
        <button
          type="button"
          className="ca-avatar-botao"
          aria-label={`${eu.nome}, ${ROTULO_PERFIL[eu.perfil]}. Abrir menu da conta`}
          title={eu.empresa.nome}
          {...p}
        >
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
              {ROTULO_PERFIL[eu.perfil]}
            </span>
          </div>
          <div className="ca-menu-empresa">
            <span className="tiny muted">Empresa aberta</span>
            <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <span className="strong">{eu.empresa.nome}</span>
              {eu.empresa.demo ? <SeloDemonstracao /> : null}
            </span>
          </div>
          {/* A escolha da empresa (A2), com o papel e o último acesso em cada uma. */}
          {outras.length ? <ItemMenu titulo="Trocar de empresa" icone="empresa" para="/entrar/empresa" aoClicar={fechar} /> : null}
          <ItemMenu titulo="Criar outra empresa" icone="mais" para="/criar-conta" aoClicar={fechar} />
          {eu.adminPlataforma ? <ItemMenu titulo="Empresas clientes" icone="empresa" para="/plataforma" aoClicar={fechar} /> : null}
          <ItemMenu titulo="Equipe e limites" icone="equipe" para="/equipe" aoClicar={fechar} />
          <ItemMenu titulo="Guia de início" icone="guia" para="/guia" aoClicar={fechar} />
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

export default function Layout({ children }: { children: ReactNode }) {
  const { resumo, recarregarResumo } = useSessao();
  const { pathname } = useLocation();
  const [migalhas, setMigalhas] = useState<Migalha[] | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [testando, setTestando] = useState(false);
  const conteudo = useRef<HTMLElement>(null);

  // Contadores do menu: atualiza ao trocar de página e quando chegam eventos ao vivo.
  const atraso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atualizar = useCallback(() => {
    if (atraso.current) clearTimeout(atraso.current);
    atraso.current = setTimeout(() => void recarregarResumo().catch(() => {}), 1200);
  }, [recarregarResumo]);
  useEffect(() => () => void (atraso.current && clearTimeout(atraso.current)), []);
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    atualizar();
    setMenuAberto(false);
  }, [pathname, atualizar]);
  useEventosConsole((e) => {
    if (e.tipo === 'execucao' || e.tipo === 'aprovacao' || e.tipo === 'conversa') atualizar();
  });

  const trilha = migalhas ?? migalhasPadrao(pathname);
  useEffect(() => {
    document.title = `${trilha[trilha.length - 1]?.rotulo ?? 'Console'} · Copiloto`;
  }, [trilha]);

  return (
    <ProvedorMigalhas definir={setMigalhas}>
      <a className="ca-pular" href="#conteudo">
        Pular para o conteúdo
      </a>
      <FaixaModoSuporte />
      <FaixaSemInternet />
      <div className="app ca-app">
        <nav className="sidebar ca-sidebar" aria-label="Menu principal">
          <Marca />
          <SeletorEmpresa idRotulo="ca-seletor-trocar" />
          <Navegacao />
        </nav>

        <div className="content">
          <header className="topbar ca-topbar">
            <button
              type="button"
              className="btn btn-ghost btn-icon ca-so-celular"
              aria-label="Abrir menu"
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto(true)}
            >
              <Icone nome="menu" />
            </button>
            <div className="ca-so-celular">
              <Marca />
            </div>
            <Trilha migalhas={trilha} />
            <div className="grow" />
            <div className="hide-sm ca-busca-topo">
              <BuscaGlobal />
            </div>
            <span
              className="badge badge-outline hide-sm"
              title={
                resumo.eu.empresa.demo
                  ? `Empresa de demonstração, com dados de exemplo do ${resumo.nomeSistema}`
                  : `Conectado ao ${resumo.nomeSistema} de produção`
              }
            >
              {resumo.eu.empresa.nome} · {resumo.eu.empresa.demo ? 'Demonstração' : 'Produção'}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Testar copiloto" onClick={() => setTestando(true)}>
              <Icone nome="chat" tamanho="sm" />
              <span className="ca-texto-botao">Testar copiloto</span>
            </button>
            <MenuPessoa />
          </header>

          <FaixasDoResumo resumo={resumo} />

          <main className="page" id="conteudo" ref={conteudo} tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <Gaveta aberta={menuAberto} titulo="Menu" aoFechar={() => setMenuAberto(false)} lado="esquerda" largura={300}>
        <div className="ca-gaveta-nav">
          <div className="ca-gaveta-busca">
            <BuscaGlobal atalho={false} aoEscolher={() => setMenuAberto(false)} />
          </div>
          <SeletorEmpresa idRotulo="ca-gaveta-trocar" aoNavegar={() => setMenuAberto(false)} />
          <Navegacao aoNavegar={() => setMenuAberto(false)} />
        </div>
      </Gaveta>

      <Gaveta
        aberta={testando}
        titulo="Testar copiloto"
        aoFechar={() => setTestando(false)}
        largura={460}
        rodape={<p className="tiny muted">No modo de teste nada é gravado no {resumo.nomeSistema}. As tarefas usam o rascunho, quando houver.</p>}
      >
        <ChatDeTeste altura="calc(100vh - 260px)" />
      </Gaveta>
    </ProvedorMigalhas>
  );
}

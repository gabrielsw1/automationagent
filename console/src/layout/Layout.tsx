// Moldura do console (C0–C9): menu lateral com contadores, topo com trilha, busca, "Produção",
// "Testar copiloto" e menu da pessoa, faixas globais e o conteúdo da página.
// No celular (até 760 px) o menu vira uma gaveta aberta pelo botão do topo.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ROTULO_PERFIL } from '@copiloto/shared';
import { useEventosConsole } from '../api/hooks.ts';
import { ChatDeTeste } from '../componentes/ChatDeTeste.tsx';
import { Gaveta } from '../componentes/Gaveta.tsx';
import { Icone } from '../componentes/icones.tsx';
import { ItemMenu, Menu } from '../componentes/Menu.tsx';
import { ProvedorMigalhas, type Migalha } from '../componentes/pagina.tsx';
import { useSessao } from '../componentes/sessao.tsx';
import BuscaGlobal from './BuscaGlobal.tsx';
import { FaixasDoResumo, FaixaSemInternet } from './Faixas.tsx';
import { GRUPOS_NAV, migalhasPadrao } from './navegacao.ts';

function Navegacao({ aoNavegar }: { aoNavegar?: () => void }) {
  const { resumo } = useSessao();
  const { guia } = resumo;
  const guiaCompleto = guia.feitos >= guia.total;
  return (
    <>
      {GRUPOS_NAV.map((g) => (
        <div key={g.rotulo} className="ca-nav-grupo" role="group" aria-label={g.rotulo}>
          <div className="nav-label">{g.rotulo}</div>
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

function MenuPessoa() {
  const { resumo, sair } = useSessao();
  const { eu } = resumo;
  return (
    <Menu
      largura={260}
      botao={(p) => (
        <button type="button" className="ca-avatar-botao" aria-label={`${eu.nome}, ${ROTULO_PERFIL[eu.perfil]}. Abrir menu da conta`} {...p}>
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
      <FaixaSemInternet />
      <div className="app ca-app">
        <nav className="sidebar ca-sidebar" aria-label="Menu principal">
          <Marca />
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
            <span className="badge badge-outline hide-sm" title={`Conectado ao ${resumo.nomeSistema} de produção`}>
              Produção
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

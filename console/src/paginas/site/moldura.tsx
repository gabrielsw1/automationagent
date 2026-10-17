// Topo e rodapé do site do produto, também usados nas páginas dos textos jurídicos. No site, os
// links das seções rolam a própria página; nas outras páginas, levam ao site na seção certa.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Endereço do site do produto. */
export const ENDERECO_SITE = '/site';

function LinkSecao({ secao, noSite, children }: { secao: string; noSite: boolean; children: ReactNode }) {
  return noSite ? <a href={`#${secao}`}>{children}</a> : <Link to={`${ENDERECO_SITE}#${secao}`}>{children}</Link>;
}

function Marca() {
  return (
    <>
      <span className="logo-ph" aria-hidden="true">
        S
      </span>
      <span className="st-marca-nome">Copiloto Starta</span>
    </>
  );
}

export function Topo({ noSite = false, aoAgendar }: { noSite?: boolean; aoAgendar: () => void }) {
  return (
    <header className="st-topo">
      <div className="st-dentro st-topo-dentro row between">
        <Link className="brandmark" to={ENDERECO_SITE}>
          <Marca />
        </Link>
        <nav className="row hide-sm st-nav" aria-label="Seções do site">
          <LinkSecao secao="como-funciona" noSite={noSite}>
            Como funciona
          </LinkSecao>
          <LinkSecao secao="seguranca" noSite={noSite}>
            Segurança
          </LinkSecao>
          <LinkSecao secao="planos" noSite={noSite}>
            Planos
          </LinkSecao>
        </nav>
        <div className="row st-acoes">
          <Link className="btn btn-ghost" to="/entrar">
            Entrar
          </Link>
          <button type="button" className="btn btn-primary" onClick={aoAgendar}>
            Agendar demonstração
          </button>
        </div>
      </div>
    </header>
  );
}

export function Rodape({ noSite = false }: { noSite?: boolean }) {
  return (
    <footer className="st-rodape">
      <div className="st-dentro st-rodape-dentro row wrap between">
        <div className="stack-sm" style={{ gap: 4 }}>
          <div className="brandmark">
            <Marca />
          </div>
          <span className="tiny muted">© 2026 Starta. Copiloto Starta é um nome de trabalho.</span>
        </div>
        <nav className="row wrap small" aria-label="Rodapé">
          <LinkSecao secao="seguranca" noSite={noSite}>
            Segurança
          </LinkSecao>
          <LinkSecao secao="planos" noSite={noSite}>
            Planos
          </LinkSecao>
          <Link to="/termos">Termos de uso</Link>
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/contrato-lgpd">Contrato de tratamento de dados (LGPD)</Link>
        </nav>
      </div>
    </footer>
  );
}

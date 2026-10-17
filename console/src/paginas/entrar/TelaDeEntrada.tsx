// Moldura das telas de acesso (A1–A6): topo com a marca "Copiloto Starta" e o link da tela, um
// cartão de 440 px no centro e, embaixo dele, as notas da tela. O topo também serve ao cadastro.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FaixaSemInternet } from '../../layout/Faixas.tsx';
import './entrar.css';

/** Topo das telas fora da área logada: a marca leva ao início; `direita` é o link da tela ("Entrar"). */
export function TopoDeAcesso({ direita }: { direita?: ReactNode }) {
  return (
    <header className="ce-topo">
      <div className="ce-topo-dentro">
        <Link className="brandmark" to="/" aria-label="Copiloto Starta, ir para o início">
          <span className="logo-ph" aria-hidden="true">
            S
          </span>
          <span>Copiloto Starta</span>
        </Link>
        {direita}
      </div>
    </header>
  );
}

export default function TelaDeEntrada({ direita, rodape, children }: { direita?: ReactNode; rodape?: ReactNode; children: ReactNode }) {
  return (
    <>
      <FaixaSemInternet />
      <div className="ce-tela">
        <TopoDeAcesso direita={direita} />
        <main className="stack-lg ce-main">
          <div className="card ce-cartao">{children}</div>
          {rodape ? <div className="stack-sm ce-rodape">{rodape}</div> : null}
        </main>
      </div>
    </>
  );
}

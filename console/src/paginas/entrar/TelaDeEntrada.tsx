// Moldura das telas fora da área logada (entrar, convite): marca no topo e um cartão central.
import type { ReactNode } from 'react';
import { FaixaSemInternet } from '../../layout/Faixas.tsx';
import './entrar.css';

export default function TelaDeEntrada({ children }: { children: ReactNode }) {
  return (
    <>
      <FaixaSemInternet />
      <main className="ce-tela">
        <div className="ce-coluna">
          <div className="brandmark ce-marca">
            <span className="logo-ph" aria-hidden="true">
              S
            </span>
            <span>Copiloto</span>
          </div>
          <div className="card ce-cartao">{children}</div>
          <p className="tiny muted ce-rodape">
            O copiloto executa tarefas no seu sistema só depois do “confirmo” de quem pediu, com as permissões dessa pessoa.
          </p>
        </div>
      </main>
    </>
  );
}

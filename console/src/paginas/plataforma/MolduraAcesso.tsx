// Moldura das telas de acesso da Plataforma Starta (A7 e a ativação): topo escuro com "Plataforma
// Starta · acesso restrito à equipe", a etapa acima do cartão de 440 px e, embaixo, a nota
// "Todo acesso à plataforma fica registrado." Usa as mesmas medidas das telas A1–A6.
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icone } from '../../componentes/icones.tsx';
import { FaixaSemInternet } from '../../layout/Faixas.tsx';
import '../entrar/entrar.css';
import './acesso.css';

/** ?voltar=<caminho da Plataforma>: só caminhos da própria Plataforma, nunca as telas de acesso nem outro site. */
export function destinoNaPlataforma(voltar: string | null): string {
  const v = voltar ?? '';
  const caminho = v.split(/[?#]/)[0];
  if (!/^\/plataforma(\/|$)/.test(caminho) || /^\/plataforma\/(entrar|ativar)(\/|$)/.test(caminho)) return '/plataforma';
  return v;
}

/** Estado da navegação depois de entrar: a área avisa quando os códigos de recuperação estão acabando. */
export interface EstadoEntrou {
  entrou: true;
}

export function MolduraAcessoStarta({ titulo, etapa, children }: { titulo: string; etapa?: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${titulo} · Starta`;
  }, [titulo]);
  return (
    <>
      <FaixaSemInternet />
      <div className="ce-tela">
        <header className="ce-topo cp-topo-escuro">
          <div className="ce-topo-dentro">
            <Link className="brandmark" to="/" aria-label="Copiloto Starta, ir para o início">
              <span className="logo-ph" aria-hidden="true">
                S
              </span>
              <span>Copiloto Starta</span>
            </Link>
            <p className="small strong row cp-restrito">
              <Icone nome="cadeado" tamanho="sm" />
              Plataforma Starta · acesso restrito à equipe
            </p>
          </div>
        </header>
        <main className="stack-lg ce-main">
          <div className="stack-sm cp-acesso">
            {etapa ? <span className="eyebrow">{etapa}</span> : null}
            <div className="card ce-cartao">{children}</div>
          </div>
          <p className="small muted row cp-registrado">
            <Icone nome="info" tamanho="sm" />
            Todo acesso à plataforma fica registrado.
          </p>
        </main>
      </div>
    </>
  );
}

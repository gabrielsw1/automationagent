// Plataforma › Implantações: cada empresa em implantação ou piloto, com as etapas e o progresso.
import { Link } from 'react-router-dom';
import { fmt, type DetalheEmpresaStarta } from '@copiloto/shared';
import { useApiPlataforma } from '../../api/plataforma.ts';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { CabecalhoPagina, Progresso } from '../../componentes/formulario.tsx';
import { Etapas, SeloSituacao } from './pecas.tsx';

function Cartao({ e }: { e: DetalheEmpresaStarta }) {
  const feitas = e.implantacao.filter((x) => x.feita).length;
  const total = e.implantacao.length;
  return (
    <article className="card cp-implantacao" aria-labelledby={`impl-${e.id}`}>
      <div className="card-head cp-painel-cabeca">
        <div className="row-top" style={{ gap: 'var(--s-3)', minWidth: 0 }}>
          <span className="avatar" aria-hidden="true">
            {e.iniciais}
          </span>
          <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <h2 id={`impl-${e.id}`} className="h4">
                {e.nome}
              </h2>
              <SeloSituacao situacao={e.situacao} />
            </div>
            <span className="tiny muted">
              {e.responsavel ? `Responsável: ${e.responsavel.nome}` : 'Sem responsável na Starta'}
              {e.plano ? ` · Plano ${e.plano.nome}` : ''}
              {e.faseDesde ? ` · desde ${fmt.data(e.faseDesde)}` : ''}
            </span>
          </div>
        </div>
        <Link className="btn btn-ghost btn-sm" to={`/plataforma?empresa=${encodeURIComponent(e.id)}`} aria-label={`Abrir ${e.nome}`}>
          Abrir
        </Link>
      </div>
      <div className="card-body stack">
        <div className="stack-sm">
          <div className="row between">
            <span className="small strong">Progresso</span>
            <span className="small muted num">
              {feitas} de {total}
            </span>
          </div>
          <Progresso valor={total ? feitas / total : 0} rotulo={`Implantação da ${e.nome}`} />
        </div>
        <Etapas etapas={e.implantacao} />
      </div>
    </article>
  );
}

export default function Implantacoes() {
  const lista = useApiPlataforma<DetalheEmpresaStarta[]>('/implantacoes');
  return (
    <>
      <CabecalhoPagina titulo="Implantações" subtitulo="Empresas em implantação ou piloto e o que falta em cada etapa até o uso de verdade." />
      {lista.dados ? (
        lista.dados.length ? (
          <div className="cp-grade-cartoes">
            {lista.dados.map((e) => (
              <Cartao key={e.id} e={e} />
            ))}
          </div>
        ) : (
          <EstadoVazio
            emCartao
            icone="guia"
            titulo="Nenhuma empresa em implantação ou piloto"
            texto="Quando uma empresa nova começar, as etapas dela aparecem aqui."
          />
        )
      ) : lista.erro ? (
        <EstadoErro erro={lista.erro} aoTentar={() => void lista.recarregar()} titulo="Não conseguimos carregar as implantações" />
      ) : (
        <Carregando forma="tabela" texto="Carregando as implantações…" />
      )}
    </>
  );
}

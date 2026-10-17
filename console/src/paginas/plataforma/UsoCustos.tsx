// Plataforma › Uso e custos: por empresa, execuções, créditos (roteiro e conserto), custo de IA e
// do navegador, a receita dos créditos quando o plano tem preço e a margem. Período escolhido.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CREDITOS_COM_CONSERTO, CREDITOS_POR_ROTEIRO, fmt, type UsoPlataforma } from '@copiloto/shared';
import { useApiPlataforma } from '../../api/plataforma.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { CabecalhoPagina, Segmentado } from '../../componentes/formulario.tsx';
import { reais, SeloDemo } from './pecas.tsx';

type Dias = '7' | '30' | '90';

type Valores = UsoPlataforma['total'];

const margem = (u: Valores): number | null => (u.receitaCreditos === null ? null : Math.round((u.receitaCreditos - u.custoIa - u.custoNavegador) * 100) / 100);

function Dinheiro({ valor, semValor }: { valor: number | null; semValor?: string }) {
  if (valor === null) {
    return (
      <span className="muted" title={semValor}>
        —
      </span>
    );
  }
  return <span className={valor < 0 ? 'text-danger strong' : undefined}>{fmt.moeda(valor)}</span>;
}

function Celulas({ u }: { u: Valores }) {
  return (
    <>
      <td className="t-right num">{fmt.numero(u.execucoes)}</td>
      <td className="t-right num">{fmt.numero(u.creditos)}</td>
      <td className="t-right num muted">{fmt.numero(u.creditosRoteiro)}</td>
      <td className="t-right num muted">{fmt.numero(u.creditosConserto)}</td>
      <td className="t-right num">{fmt.moeda(u.custoIa)}</td>
      <td className="t-right num">{fmt.moeda(u.custoNavegador)}</td>
      <td className="t-right num">
        <Dinheiro valor={u.receitaCreditos} semValor="Sem plano com preço do crédito" />
      </td>
      <td className="t-right num">
        <Dinheiro valor={margem(u)} semValor="Sem plano com preço do crédito" />
      </td>
    </>
  );
}

function Resumo({ uso }: { uso: UsoPlataforma }) {
  const t = uso.total;
  const custo = Math.round((t.custoIa + t.custoNavegador) * 100) / 100;
  const m = margem(t);
  return (
    <section className="grid-kpi" aria-label="Resumo do período">
      <div className="card kpi">
        <span className="kpi-label">Execuções</span>
        <span className="kpi-value">{fmt.numero(t.execucoes)}</span>
        <span className="kpi-delta muted cp-peso-normal">Sem contar os testes</span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Créditos usados</span>
        <span className="kpi-value">{fmt.numero(t.creditos)}</span>
        <span className="kpi-delta muted cp-peso-normal">
          {fmt.numero(t.creditosRoteiro)} pelo roteiro · {fmt.numero(t.creditosConserto)} com conserto
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Custo de IA e navegador</span>
        <span className="kpi-value">{fmt.moeda(custo)}</span>
        <span className="kpi-delta muted cp-peso-normal">
          IA {fmt.moeda(t.custoIa)} · navegador {fmt.moeda(t.custoNavegador)}
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Margem dos créditos</span>
        <span className={`kpi-value${m !== null && m < 0 ? ' text-danger' : ''}`}>{reais(m)}</span>
        <span className="kpi-delta muted cp-peso-normal">
          {t.receitaCreditos === null
            ? 'Aparece quando todas as empresas tiverem um plano com preço do crédito.'
            : `Receita de ${fmt.moeda(t.receitaCreditos)} menos IA e navegador`}
        </span>
      </div>
    </section>
  );
}

export default function UsoCustos() {
  const [dias, setDias] = useState<Dias>('30');
  const uso = useApiPlataforma<UsoPlataforma>(`/uso?dias=${dias}`);
  const dados = uso.dados;

  return (
    <>
      <CabecalhoPagina
        titulo="Uso e custos"
        subtitulo="Quanto cada empresa usou, quanto custou em IA e navegador e quanto os créditos renderam."
        acoes={
          <Segmentado<Dias>
            rotulo="Período"
            valor={dias}
            aoTrocar={setDias}
            opcoes={[
              { valor: '7', rotulo: '7 dias' },
              { valor: '30', rotulo: '30 dias' },
              { valor: '90', rotulo: '90 dias' },
            ]}
          />
        }
      />
      {dados ? (
        <>
          <Resumo uso={dados} />
          <section className="stack-sm" aria-labelledby="t-uso">
            <h2 id="t-uso" className="h3">
              Por empresa
            </h2>
            <div className="table-wrap">
              <table className="table" aria-label="Uso e custos por empresa">
                <thead>
                  <tr>
                    <th scope="col">Empresa</th>
                    <th scope="col" className="t-right">
                      Execuções
                    </th>
                    <th scope="col" className="t-right">
                      Créditos
                    </th>
                    <th scope="col" className="t-right">
                      Roteiro
                    </th>
                    <th scope="col" className="t-right">
                      Conserto
                    </th>
                    <th scope="col" className="t-right">
                      Custo de IA
                    </th>
                    <th scope="col" className="t-right">
                      Navegador
                    </th>
                    <th scope="col" className="t-right">
                      Receita
                    </th>
                    <th scope="col" className="t-right">
                      Margem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dados.empresas.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted small ca-tabela-vazia">
                        Nenhuma empresa ainda.
                      </td>
                    </tr>
                  ) : null}
                  {dados.empresas.map((u) => (
                    <tr key={u.empresaId}>
                      <td>
                        <span className="row wrap cp-empresa-nome" style={{ gap: 'var(--s-2)' }}>
                          <Link to={`/plataforma?empresa=${encodeURIComponent(u.empresaId)}`} className="strong">
                            {u.nome}
                          </Link>
                          {u.demo ? <SeloDemo /> : null}
                        </span>
                      </td>
                      <Celulas u={u} />
                    </tr>
                  ))}
                </tbody>
                {dados.empresas.length > 1 ? (
                  <tfoot>
                    <tr className="cp-total">
                      <th scope="row">Total</th>
                      <Celulas u={dados.total} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            <p className="tiny muted">
              De {fmt.data(dados.desde)} a {fmt.data(dados.ate)}. Cada execução pelo roteiro gasta {fmt.numero(CREDITOS_POR_ROTEIRO)}{' '}
              {CREDITOS_POR_ROTEIRO === 1 ? 'crédito' : 'créditos'}; com conserto visual, {fmt.numero(CREDITOS_COM_CONSERTO)}. Testes não contam. O custo de IA vem
              dos tokens usados; a receita é o total de créditos vezes o preço do crédito do plano de cada empresa (sem plano com preço, fica “—”).
            </p>
          </section>
        </>
      ) : uso.erro ? (
        <EstadoErro erro={uso.erro} aoTentar={() => void uso.recarregar()} titulo="Não conseguimos carregar o uso" />
      ) : (
        <Carregando forma="painel" texto="Carregando o uso e os custos…" />
      )}
    </>
  );
}

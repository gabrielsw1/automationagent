// Painel (C1): números do período, execuções por dia, o que precisa de atenção, tarefas mais
// usadas, gasto do mês e pedidos por canal.
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, type ItemAtencao, type Painel as DadosPainel, type Periodo } from '@copiloto/shared';
import { useApi, useEventosConsole } from '../../api/hooks.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { CabecalhoPagina, Progresso, Segmentado } from '../../componentes/formulario.tsx';
import { Icone, type NomeIcone } from '../../componentes/icones.tsx';
import { guardado } from '../../componentes/pagina.tsx';
import { SeloCaminho, SeloExemplo } from '../../componentes/Selos.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import GraficoDias from './GraficoDias.tsx';
import './painel.css';

const ROTULO_PERIODO: Record<Periodo, string> = { '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', mes: 'Mês atual' };
const COMPARACAO: Record<Periodo, string> = { '7d': 'vs. 7 dias anteriores', '30d': 'vs. 30 dias anteriores', mes: 'vs. mesmo período do mês anterior' };

const ICONE_ATENCAO: Record<ItemAtencao['tipo'], { icone: NomeIcone; classe: string }> = {
  falhas: { icone: 'alerta', classe: 'badge-danger' },
  sem_tarefa: { icone: 'chat', classe: 'badge-accent' },
  aprovacao: { icone: 'cadeado', classe: 'badge-info' },
  transferidas: { icone: 'pessoa', classe: 'badge-warning' },
  fonte_erro: { icone: 'conhecimento', classe: 'badge-warning' },
};

const CHAVE_PERIODO = 'copiloto:painel:periodo';

function segundos(s: number | null): string {
  if (s === null) return '—';
  return s < 10 ? `${s.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : fmt.duracao(s * 1000);
}

function fimDoMes(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
}

function Indicadores({ p }: { p: DadosPainel }) {
  const variacao =
    p.variacao === null ? (
      <span className="kpi-delta muted ca-peso-normal">Sem período anterior para comparar</span>
    ) : (
      <span className={`kpi-delta ${p.variacao > 0 ? 'text-success' : p.variacao < 0 ? 'text-danger' : 'muted'}`}>
        {p.variacao > 0 ? '+' : ''}
        {fmt.percentual(p.variacao, 0)} {COMPARACAO[p.periodo]}
      </span>
    );
  const usoGasto = p.limiteMes > 0 ? p.gastoMes / p.limiteMes : 0;
  const previsaoAlta = p.limiteMes > 0 && p.previsaoMes > p.limiteMes * 0.9;
  return (
    <section className="grid-kpi" aria-label="Indicadores principais">
      <div className="card kpi">
        <span className="kpi-label">Tarefas executadas</span>
        <span className="kpi-value">{fmt.numero(p.executadas)}</span>
        {variacao}
      </div>
      <div className="card kpi">
        <span className="kpi-label">Taxa de sucesso</span>
        <span className="kpi-value">{p.taxaSucesso === null ? '—' : fmt.percentual(p.taxaSucesso)}</span>
        <span className="kpi-delta muted ca-peso-normal">
          {p.executadas === 0
            ? 'Nenhuma execução no período'
            : `${fmt.numero(p.falhas)} ${p.falhas === 1 ? 'falha' : 'falhas'} em ${fmt.numero(p.executadas)} ${p.executadas === 1 ? 'execução' : 'execuções'}`}
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Tempo médio</span>
        <div className="row" style={{ gap: 'var(--s-2)', alignItems: 'baseline' }}>
          <span className="kpi-value">{segundos(p.tempoMedioApiS)}</span>
          <span className="small muted">pela API</span>
        </div>
        <span className="kpi-delta muted ca-peso-normal">
          <span className="strong ca-tinta">{segundos(p.tempoMedioNavegadorS)}</span> pelo navegador
        </span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Gasto do mês</span>
        <div className="row wrap" style={{ gap: 'var(--s-2)', alignItems: 'baseline' }}>
          <span className="kpi-value">{fmt.moeda(p.gastoMes)}</span>
          <span className="small muted">de {fmt.moeda(p.limiteMes)}</span>
        </div>
        <Progresso valor={usoGasto} rotulo="Gasto do mês em relação ao limite" cor={usoGasto >= 0.8 ? 'var(--warning-500)' : undefined} />
        <span className={`kpi-delta ${previsaoAlta ? 'text-warning' : 'muted ca-peso-normal'}`}>
          Previsão até {fmt.diaMes(fimDoMes())}: {fmt.moeda(p.previsaoMes)}
        </span>
      </div>
    </section>
  );
}

function Atencao({ itens }: { itens: ItemAtencao[] }) {
  return (
    <section className="card side-col" aria-labelledby="atencao-titulo">
      <div className="card-head">
        <h2 className="h4" id="atencao-titulo">
          Precisa da sua atenção
        </h2>
        {itens.length > 0 ? <span className="badge badge-danger">{itens.length}</span> : null}
      </div>
      {itens.length === 0 ? (
        <div className="empty cp-atencao-vazia">
          <div className="empty-icon ca-icone-ok" aria-hidden="true">
            <Icone nome="check" tamanho="lg" />
          </div>
          <p className="strong cp-tinta">Nada pendente</p>
          <p className="small">Nenhuma falha hoje, nenhuma aprovação esperando e nenhum pedido sem tarefa.</p>
        </div>
      ) : (
        <ul className="stack cp-atencao">
          {itens.map((item, i) => (
            <li key={`${item.tipo}-${i}`} className="stack">
              {i > 0 ? <div className="divider" aria-hidden="true" /> : null}
              <div className="row-top">
                <span className={`badge ${ICONE_ATENCAO[item.tipo].classe} cp-atencao-icone`} aria-hidden="true">
                  <Icone nome={ICONE_ATENCAO[item.tipo].icone} tamanho="sm" />
                </span>
                <div className="grow stack-sm" style={{ gap: 'var(--s-1)' }}>
                  <p className="strong">{item.titulo}</p>
                  <p className="small muted">{item.detalhe}</p>
                  <div>
                    <Link className="btn btn-secondary btn-sm" to={item.acao.destino}>
                      {item.acao.rotulo}
                    </Link>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MaisUsadas({ p }: { p: DadosPainel }) {
  return (
    <section className="main-col stack-sm" aria-labelledby="tarefas-titulo">
      <div className="row between">
        <h2 className="h4" id="tarefas-titulo">
          Tarefas mais usadas
        </h2>
        <Link className="small strong" to="/tarefas">
          Ver todas as tarefas
        </Link>
      </div>
      <Tabela
        rotulo="Tarefas mais usadas no período"
        linhas={p.maisUsadas}
        chave={(t) => t.tarefaId}
        vazio="Nenhuma tarefa foi executada neste período."
        colunas={[
          {
            titulo: 'Tarefa',
            celula: (t) => (
              <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                <Link className="strong" to={`/tarefas/${t.tarefaId}`}>
                  {t.nome}
                </Link>
                {t.status === 'teste' ? <span className="badge badge-warning">Em teste</span> : null}
                {t.status === 'inativa' ? <span className="badge badge-outline">Inativa</span> : null}
              </span>
            ),
          },
          { titulo: 'Caminho', celula: (t) => <SeloCaminho caminho={t.caminho} /> },
          { titulo: 'Execuções', alinhar: 'direita', classe: 'num', celula: (t) => fmt.numero(t.execucoes) },
          {
            titulo: 'Sucesso',
            alinhar: 'direita',
            classe: (t) => `num${t.sucesso !== null && t.sucesso < 0.9 ? ' text-warning strong' : ''}`,
            celula: (t) => (t.sucesso === null ? '—' : fmt.percentual(t.sucesso)),
          },
          {
            titulo: 'Custo médio',
            alinhar: 'direita',
            classe: 'num',
            celula: (t) => (t.custoMedio === null ? '—' : fmt.moeda(t.custoMedio)),
          },
        ]}
      />
      <p className="tiny muted">
        Pela API, cada tarefa leva segundos e custa centavos. Pelo navegador, leva cerca de 1 minuto e custa mais, porque o copiloto opera a tela.
      </p>
    </section>
  );
}

function PorCanal({ p, nomeSistema }: { p: DadosPainel; nomeSistema: string }) {
  const total = p.porCanal.reduce((s, c) => s + c.total, 0);
  return (
    <section className="card card-pad side-col stack" aria-labelledby="canal-titulo">
      <div className="row between">
        <h2 className="h4" id="canal-titulo">
          Por canal
        </h2>
        <span className="small muted num">
          {fmt.numero(total)} {total === 1 ? 'pedido' : 'pedidos'}
        </span>
      </div>
      {p.porCanal.map((c) => {
        const fracao = total > 0 ? c.total / total : 0;
        return (
          <div key={c.canal} className="stack-sm">
            <div className="row between">
              <span className="row strong" style={{ gap: 'var(--s-2)' }}>
                <Icone nome={c.canal === 'teste' ? 'play' : 'canais'} />
                {c.rotulo}
              </span>
              <span className="num">
                <span className="strong">{fmt.percentual(fracao, 0)}</span> <span className="muted small">· {fmt.numero(c.total)}</span>
              </span>
            </div>
            <Progresso valor={fracao} rotulo={`${c.rotulo}: ${fmt.percentual(fracao, 0)} dos pedidos`} altura={10} />
          </div>
        );
      })}
      <div className="divider" />
      <p className="small muted">
        No widget, as pessoas pedem de dentro do {nomeSistema}, logadas com o próprio usuário. Os testes feitos aqui no console não gravam nada no sistema.
      </p>
      <Link className="small strong" to="/canais">
        Configurar canais
      </Link>
    </section>
  );
}

export default function Painel() {
  const { resumo } = useSessao();
  const [periodo, setPeriodoEstado] = useState<Periodo>(() => guardado.ler<Periodo>(CHAVE_PERIODO) ?? '30d');
  const { dados: p, erro, carregando, recarregar } = useApi<DadosPainel>(`/painel?periodo=${periodo}`);
  const setPeriodo = (v: Periodo) => {
    setPeriodoEstado(v);
    guardado.gravar(CHAVE_PERIODO, v);
  };

  // Execuções novas chegam ao vivo: recarrega no máximo a cada 5 s.
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aoEvento = useCallback(
    (e: { tipo: string }) => {
      if (e.tipo !== 'execucao' && e.tipo !== 'aprovacao') return;
      if (espera.current) return;
      espera.current = setTimeout(() => {
        espera.current = null;
        void recarregar();
      }, 5000);
    },
    [recarregar],
  );
  useEventosConsole(aoEvento);

  const seletor = (
    <Segmentado<Periodo>
      rotulo="Período"
      valor={periodo}
      aoTrocar={setPeriodo}
      opcoes={[
        { valor: '7d', rotulo: '7 dias' },
        { valor: '30d', rotulo: '30 dias' },
        { valor: 'mes', rotulo: 'Mês atual' },
      ]}
    />
  );

  if (erro && !p) {
    return (
      <>
        <CabecalhoPagina titulo="Painel" acoes={seletor} />
        <EstadoErro erro={erro} aoTentar={() => void recarregar()} titulo="Não conseguimos carregar o painel" />
      </>
    );
  }
  if (!p) {
    return (
      <>
        <CabecalhoPagina titulo="Painel" subtitulo={ROTULO_PERIODO[periodo]} acoes={seletor} />
        <Carregando forma="painel" texto="Carregando o painel" />
      </>
    );
  }

  const totalFalhas = p.porDia.reduce((s, d) => s + d.falhas, 0);
  const legenda = `Execuções por dia de ${fmt.diaMes(p.inicio)} a ${fmt.data(p.fim)}. Total de ${fmt.numero(p.executadas)}, sendo ${fmt.numero(totalFalhas)} com falha.`;
  return (
    <div className={`stack-lg${carregando ? ' cp-atualizando' : ''}`} aria-busy={carregando || undefined}>
      <CabecalhoPagina
        titulo="Painel"
        selos={p.temDadosDeExemplo ? <SeloExemplo /> : null}
        subtitulo={`${ROTULO_PERIODO[p.periodo]} · ${fmt.diaMes(p.inicio)} a ${fmt.data(p.fim)} · atualizado às ${fmt.hora(p.atualizadoEm)}`}
        acoes={seletor}
      />

      <Indicadores p={p} />

      <div className="split">
        <section className="card main-col" aria-labelledby="grafico-titulo">
          <div className="card-head wrap">
            <div className="stack-sm" style={{ gap: 2 }}>
              <h2 className="h4" id="grafico-titulo">
                Execuções por dia
              </h2>
              <span className="small muted">Passe o mouse sobre uma barra para ver o dia</span>
            </div>
            <div className="row wrap small" style={{ gap: 'var(--s-4)' }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="cp-legenda cp-legenda-ok" />
                Concluídas
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className="cp-legenda cp-legenda-falha" />
                Com falha
              </span>
            </div>
          </div>
          <div className="card-body">
            <figure className="stack-sm" style={{ margin: 0 }}>
              <figcaption className="sr-only">{legenda}</figcaption>
              {p.executadas === 0 ? (
                <div className="cp-grafico-vazio">
                  <p className="strong">Nenhuma execução neste período</p>
                  <p className="small muted">
                    Quando as pessoas pedirem tarefas ao copiloto, cada dia aparece aqui. Use “Testar copiloto” no topo para fazer um pedido de teste.
                  </p>
                </div>
              ) : (
                <GraficoDias dias={p.porDia} legenda={legenda} />
              )}
            </figure>
          </div>
        </section>
        <Atencao itens={p.atencao} />
      </div>

      <div className="split">
        <MaisUsadas p={p} />
        <PorCanal p={p} nomeSistema={resumo.nomeSistema} />
      </div>
    </div>
  );
}

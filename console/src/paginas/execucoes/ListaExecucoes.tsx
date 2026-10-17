// C5 · Execuções: tudo o que o copiloto fez, com quem pediu e o que aconteceu.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, type ExecucaoLinha, type ListaExecucoes as Lista, type StatusExecucao } from '@copiloto/shared';
import { api } from '../../api/cliente.ts';
import { useApi, useEventosConsole } from '../../api/hooks.ts';
import {
  AvisoErro,
  EsqueletoTabela,
  FaixaOffline,
  Icone,
  ROTULO_STATUS,
  rotuloCanal,
  SeloCaminho,
  SeloStatus,
  useAgora,
} from './pecas.tsx';

type Aba = 'todas' | 'atencao' | 'aprovacao';

const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'atencao', rotulo: 'Precisam de atenção' },
  { chave: 'aprovacao', rotulo: 'Aguardando aprovação' },
];

const STATUS_FILTRO: StatusExecucao[] = [
  'concluida',
  'falhou',
  'aguardando_confirmacao',
  'aguardando_aprovacao',
  'em_andamento',
  'desfeita',
  'cancelada',
];

const PERIODOS: { valor: string; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7d', rotulo: 'Últimos 7 dias' },
  { valor: '30d', rotulo: 'Últimos 30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
];

const FILTROS = ['status', 'canal', 'tarefa', 'periodo', 'busca'] as const;

/** Duração mostrada na tabela; ao vivo para o que está em andamento. */
export function textoDuracao(l: ExecucaoLinha, decorridoMs: number): { texto: string; muted: boolean } {
  if (l.status === 'em_andamento') {
    return { texto: `${fmt.duracao((l.duracaoMs ?? 0) + decorridoMs)} até agora`, muted: true };
  }
  if (l.duracaoMs === null) return { texto: '—', muted: true };
  return { texto: fmt.duracao(l.duracaoMs), muted: false };
}

export default function ListaExecucoes() {
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const aba = (['todas', 'atencao', 'aprovacao'].includes(params.get('aba') ?? '') ? params.get('aba') : 'todas') as Aba;
  const pagina = Math.max(1, Number(params.get('pagina')) || 1);

  const mudar = useCallback(
    (novos: Partial<Record<(typeof FILTROS)[number] | 'aba' | 'pagina', string>>, substituir = false) => {
      const p = new URLSearchParams(params);
      for (const [chave, v] of Object.entries(novos)) {
        if (v) p.set(chave, v);
        else p.delete(chave);
      }
      if (!('pagina' in novos)) p.delete('pagina');
      if (p.get('aba') === 'todas') p.delete('aba');
      setParams(p, { replace: substituir });
    },
    [params, setParams],
  );

  // Busca digitada: espera a pessoa parar de digitar antes de buscar.
  const buscaParam = params.get('busca') ?? '';
  const [busca, setBusca] = useState(buscaParam);
  useEffect(() => setBusca(buscaParam), [buscaParam]);
  useEffect(() => {
    if (busca.trim() === buscaParam) return;
    const id = setTimeout(() => mudar({ busca: busca.trim() }, true), 300);
    return () => clearTimeout(id);
  }, [busca, buscaParam, mudar]);

  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (aba !== 'todas') q.set('aba', aba);
    for (const f of FILTROS) {
      const v = params.get(f);
      if (v) q.set(f, v);
    }
    return q;
  }, [params, aba]);

  const caminho = `/execucoes?${new URLSearchParams([...consulta, ['pagina', String(pagina)]]).toString()}`;
  const { dados, erro, carregando, recarregar } = useApi<Lista>(caminho);
  const tarefas = useApi<{ tarefas: { id: string; nome: string }[] }>('/execucoes/filtros');

  // Atualização ao vivo: novas execuções e mudanças de status chegam pelo SSE.
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recarregarLogo = useCallback(() => {
    if (espera.current) return;
    espera.current = setTimeout(() => {
      espera.current = null;
      void recarregar();
    }, 600);
  }, [recarregar]);
  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current);
  }, []);
  useEventosConsole((e) => {
    if (e.tipo === 'execucao' || e.tipo === 'aprovacao') recarregarLogo();
  });

  // Duração ao vivo das execuções em andamento.
  const [recebidoEm, setRecebidoEm] = useState(() => Date.now());
  useEffect(() => setRecebidoEm(Date.now()), [dados]);
  const temAndamento = !!dados?.linhas.some((l) => l.status === 'em_andamento');
  const agora = useAgora(1000, temAndamento);
  const decorrido = Math.max(0, agora - recebidoEm);

  const limparFiltros = () => {
    setBusca('');
    const p = new URLSearchParams();
    if (aba !== 'todas') p.set('aba', aba);
    setParams(p);
  };

  const ativos = FILTROS.filter((f) => params.get(f));
  const nomeTarefa = (id: string) => tarefas.dados?.tarefas.find((t) => t.id === id)?.nome ?? 'escolhida';
  const chipsFiltro = ativos.map((f) => {
    const v = params.get(f)!;
    if (f === 'status') return `Status: ${ROTULO_STATUS[v as StatusExecucao] ?? v}`;
    if (f === 'canal') return `Canal: ${rotuloCanal(v)}`;
    if (f === 'tarefa') return `Tarefa: ${nomeTarefa(v)}`;
    if (f === 'periodo') return PERIODOS.find((p) => p.valor === v)?.rotulo ?? v;
    return `Busca: “${v}”`;
  });

  const csv = api.url(`/execucoes/exportar.csv${consulta.toString() ? `?${consulta}` : ''}`);
  const linhas = dados?.linhas ?? [];
  const exemplo = linhas.some((l) => l.exemplo);
  const primeiro = dados && dados.total > 0 ? (dados.pagina - 1) * 10 + 1 : 0;
  const ultimo = dados ? Math.min(dados.total, dados.pagina * 10) : 0;

  return (
    <div className="cb-pagina">
      <FaixaOffline />
      <div className="page-head">
        <div className="stack-sm">
          <h1 className="h1">Execuções</h1>
          <p className="muted body-lg">Tudo o que o copiloto fez, com quem pediu e o que aconteceu.</p>
        </div>
        <a className="btn btn-secondary" href={csv} download>
          <Icone nome="baixar" />
          Exportar CSV
        </a>
      </div>

      <div className="tabs" role="tablist" aria-label="Filtrar execuções por situação">
        {ABAS.map((a) => (
          <button
            key={a.chave}
            className={`tab${aba === a.chave ? ' active' : ''}`}
            type="button"
            role="tab"
            aria-selected={aba === a.chave}
            onClick={() => mudar({ aba: a.chave })}
          >
            {a.rotulo}
            {a.chave === 'atencao' && dados && dados.contagem.atencao > 0 ? (
              <span className="badge badge-danger">{fmt.numero(dados.contagem.atencao)}</span>
            ) : null}
            {a.chave === 'aprovacao' && dados && dados.contagem.aprovacao > 0 ? (
              <span className="badge badge-warning">{fmt.numero(dados.contagem.aprovacao)}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="row wrap cb-filtros">
        <div className="search cb-f-busca">
          <Icone nome="busca" />
          <label className="sr-only" htmlFor="f-busca">
            Buscar por ID, pedido ou usuário
          </label>
          <input
            id="f-busca"
            className="input"
            type="search"
            placeholder="Buscar por ID, pedido ou usuário"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="cb-f-status">
          <label className="sr-only" htmlFor="f-status">
            Status
          </label>
          <select id="f-status" className="select" value={params.get('status') ?? ''} onChange={(e) => mudar({ status: e.target.value })}>
            <option value="">Status: todos</option>
            {STATUS_FILTRO.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="cb-f-canal">
          <label className="sr-only" htmlFor="f-canal">
            Canal
          </label>
          <select id="f-canal" className="select" value={params.get('canal') ?? ''} onChange={(e) => mudar({ canal: e.target.value })}>
            <option value="">Canal: todos</option>
            <option value="widget">Widget</option>
            <option value="teste">Teste</option>
          </select>
        </div>
        <div className="cb-f-tarefa">
          <label className="sr-only" htmlFor="f-tarefa">
            Tarefa
          </label>
          <select id="f-tarefa" className="select" value={params.get('tarefa') ?? ''} onChange={(e) => mudar({ tarefa: e.target.value })}>
            <option value="">Tarefa: todas</option>
            {(tarefas.dados?.tarefas ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
            {params.get('tarefa') && !tarefas.dados?.tarefas.some((t) => t.id === params.get('tarefa')) ? (
              <option value={params.get('tarefa')!}>Tarefa escolhida</option>
            ) : null}
          </select>
        </div>
        <div className="cb-f-periodo">
          <label className="sr-only" htmlFor="f-periodo">
            Período
          </label>
          <select id="f-periodo" className="select" value={params.get('periodo') ?? ''} onChange={(e) => mudar({ periodo: e.target.value })}>
            <option value="">Período: todos</option>
            {PERIODOS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erro && dados ? <AvisoErro erro={erro} titulo="Não conseguimos atualizar as execuções" aoTentar={() => void recarregar()} /> : null}

      {!dados && erro ? (
        <AvisoErro erro={erro} titulo="Não conseguimos carregar as execuções" aoTentar={() => void recarregar()} />
      ) : !dados ? (
        <EsqueletoTabela />
      ) : dados.total === 0 ? (
        <SemResultado
          totalGeral={dados.totalGeral}
          chips={chipsFiltro}
          aba={aba}
          aoLimpar={ativos.length > 0 ? limparFiltros : undefined}
          aoVerTodas={aba !== 'todas' ? () => mudar({ aba: 'todas' }) : undefined}
        />
      ) : (
        <div className={carregando ? 'cb-carregando-leve stack' : 'stack'} aria-busy={carregando}>
          <div className="table-wrap cb-tabela-execucoes">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Pedido</th>
                  <th scope="col">Usuário</th>
                  <th scope="col">Tarefa</th>
                  <th scope="col">Caminho</th>
                  <th scope="col">Status</th>
                  <th scope="col">Canal</th>
                  <th scope="col" className="t-right">
                    Duração
                  </th>
                  <th scope="col" className="t-right">
                    Custo
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const d = textoDuracao(l, decorrido);
                  return (
                    <tr
                      key={l.id}
                      className="cb-linha-clicavel"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, button')) return;
                        navegar(`/execucoes/${encodeURIComponent(l.id)}`);
                      }}
                    >
                      <td>
                        <div className="mono strong cb-nowrap">
                          <Link className="cb-link-id" to={`/execucoes/${encodeURIComponent(l.id)}`}>
                            {l.id}
                          </Link>
                        </div>
                        <div className="tiny muted num cb-nowrap" title={fmt.dataHora(l.inicio)}>
                          {fmt.data(l.inicio) === fmt.data(new Date()) ? fmt.hora(l.inicio) : fmt.quando(l.inicio)}
                        </div>
                      </td>
                      <td>
                        <span className="small cb-pedido" title={l.pedido}>
                          “{l.pedido}”
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 'var(--s-2)' }}>
                          <span className="avatar avatar-sm" aria-hidden="true">
                            {l.usuario.iniciais}
                          </span>
                          <span className="small cb-nowrap">{l.usuario.nome}</span>
                        </div>
                      </td>
                      <td className="small">{l.tarefa.nome}</td>
                      <td>
                        <SeloCaminho caminho={l.caminho} />
                      </td>
                      <td>
                        <SeloStatus status={l.status} />
                        {l.transferidaPara ? <div className="tiny muted">Com {l.transferidaPara}</div> : null}
                      </td>
                      <td className="small">{rotuloCanal(l.canal)}</td>
                      <td className={`t-right num small${l.status === 'em_andamento' ? ' cb-duracao-viva' : ' cb-nowrap'}${d.muted ? ' muted' : ''}`}>
                        {d.texto}
                      </td>
                      <td className={`t-right num small cb-nowrap${l.custo === null ? ' muted' : ''}`}>
                        {l.custo === null ? '—' : fmt.moeda(l.custo)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="cb-cartoes" aria-label="Execuções">
            {linhas.map((l) => {
              const d = textoDuracao(l, decorrido);
              return (
                <li key={l.id}>
                  <Link className="card cb-cartao" to={`/execucoes/${encodeURIComponent(l.id)}`}>
                    <div className="row between wrap" style={{ gap: 'var(--s-2)' }}>
                      <span className="row" style={{ gap: 'var(--s-2)' }}>
                        <span className="mono strong">{l.id}</span>
                        <span className="tiny muted num">{fmt.quando(l.inicio)}</span>
                      </span>
                      <SeloStatus status={l.status} />
                    </div>
                    <p className="small cb-cartao-pedido">“{l.pedido}”</p>
                    <div className="row wrap small" style={{ gap: 'var(--s-2)' }}>
                      <span className="avatar avatar-sm" aria-hidden="true">
                        {l.usuario.iniciais}
                      </span>
                      <span>{l.usuario.nome}</span>
                      <span className="muted">· {l.tarefa.nome}</span>
                    </div>
                    <div className="row wrap tiny muted" style={{ gap: 'var(--s-2)' }}>
                      <SeloCaminho caminho={l.caminho} />
                      <span>{rotuloCanal(l.canal)}</span>
                      <span>· {d.texto}</span>
                      <span>· {l.custo === null ? '—' : fmt.moeda(l.custo)}</span>
                      {l.transferidaPara ? <span>· Com {l.transferidaPara}</span> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="row wrap between">
            <p className="small muted num">
              {fmt.numero(primeiro)}–{fmt.numero(ultimo)} de {fmt.numero(dados.total)}{' '}
              {dados.total === 1 ? 'execução' : 'execuções'}
              {exemplo ? ' · dados de exemplo' : ''}
            </p>
            <nav className="row" aria-label="Paginação">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={dados.pagina <= 1}
                onClick={() => mudar({ pagina: String(dados.pagina - 1) })}
              >
                <Icone nome="anterior" tamanho="sm" />
                Anterior
              </button>
              <span className="small muted num">
                Página {fmt.numero(dados.pagina)} de {fmt.numero(dados.paginas)}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={dados.pagina >= dados.paginas}
                onClick={() => mudar({ pagina: String(dados.pagina + 1) })}
              >
                Próximo
                <Icone nome="proximo" tamanho="sm" />
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

function SemResultado({
  totalGeral,
  chips,
  aba,
  aoLimpar,
  aoVerTodas,
}: {
  totalGeral: number;
  chips: string[];
  aba: Aba;
  aoLimpar?: () => void;
  aoVerTodas?: () => void;
}) {
  if (totalGeral === 0) {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <Icone nome="chat" tamanho="lg" />
        </div>
        <h3 className="h3">Nenhuma execução ainda</h3>
        <p>
          Quando alguém pedir algo ao copiloto, o pedido aparece aqui com quem pediu, o caminho usado e o que aconteceu.
        </p>
      </div>
    );
  }
  if (!aoLimpar && aba !== 'todas') {
    return (
      <div className="card empty">
        <div className="empty-icon">
          <Icone nome="check" tamanho="lg" />
        </div>
        <h3 className="h3">{aba === 'atencao' ? 'Nada precisa da sua atenção' : 'Nenhum pedido aguardando aprovação'}</h3>
        <p>
          {aba === 'atencao'
            ? 'Nenhuma falha hoje e nenhum caso transferido em aberto.'
            : 'Quando alguém pedir uma tarefa que o perfil não permite, o pedido de aprovação aparece aqui.'}
        </p>
        {aoVerTodas ? (
          <button className="btn btn-secondary" type="button" onClick={aoVerTodas}>
            Ver todas as execuções
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="card card-pad stack">
      {chips.length ? (
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          {chips.map((c) => (
            <span key={c} className="badge badge-outline">
              {c}
            </span>
          ))}
        </div>
      ) : null}
      <div className="empty" style={{ padding: 'var(--s-6) 0' }}>
        <div className="empty-icon">
          <Icone nome="busca" tamanho="lg" />
        </div>
        <h3 className="h3">Nenhuma execução com estes filtros</h3>
        <p>
          Tente outro período ou tire um dos filtros. Há {fmt.numero(totalGeral)}{' '}
          {totalGeral === 1 ? 'execução' : 'execuções'} no total.
        </p>
        {aoLimpar ? (
          <button className="btn btn-secondary" type="button" onClick={aoLimpar}>
            <Icone nome="x" />
            Limpar filtros
          </button>
        ) : null}
      </div>
    </div>
  );
}

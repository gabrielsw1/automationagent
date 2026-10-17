// Etapa 5 · Publicar (F3): resumo da tarefa (o que pede, como executa, custo previsto, último
// teste), quem pode usar e onde aparece. Com o widget ligado, publicar também publica a tarefa
// (fica ativa); desligado, o fluxo só entra no rascunho dela.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  custoPrevisto,
  fmt,
  type Campo,
  type Canais,
  type Fluxo,
  type FluxoPublicado,
  type StatusTarefa,
  type TarefaDetalhe,
} from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando } from '../../componentes/estados.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { SeloCaminho, SeloStatusTarefa } from '../../componentes/Selos.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { registroPorExtenso } from './comum.tsx';

/** Um item de "Antes de publicar". */
export interface ItemPronto {
  chave: string;
  ok: boolean;
  titulo: string;
  detalhe: string;
  acao?: ReactNode;
}

function ListaPronto({ itens }: { itens: ItemPronto[] }) {
  return (
    <ol className="steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {itens.map((i) => (
        <li key={i.chave} className={`step ${i.ok ? 'done' : 'fail'}`}>
          <span className="step-dot" aria-hidden="true">
            {i.ok ? <Icone nome="check" tamanho="sm" /> : <Icone nome="fechar" tamanho="sm" />}
          </span>
          <div className="stack-sm" style={{ gap: 0 }}>
            <span className="small strong">
              {i.titulo}
              <span className="sr-only">{i.ok ? ' (pronto)' : ' (falta)'}</span>
            </span>
            <span className="tiny muted">{i.detalhe}</span>
            {i.acao}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "hoje às 10:45", "ontem às 16:40" ou "em 14/10/2026 às 09:12". */
export function diaEHora(iso: string, agora = new Date()): string {
  const q = fmt.quando(iso, agora);
  if (q.startsWith('Hoje')) return `hoje às ${fmt.hora(iso)}`;
  if (q.startsWith('Ontem')) return `ontem às ${fmt.hora(iso)}`;
  return `em ${fmt.data(iso)} às ${fmt.hora(iso)}`;
}

/** "Hoje, 10:42, como Ana Ribeiro, em 8 s". */
function textoDoTeste(t: NonNullable<Fluxo['ultimoTeste']>): string {
  return [fmt.quando(t.em), t.usuarioNome ? `como ${t.usuarioNome}` : null, t.duracaoMs ? `em ${fmt.duracao(t.duracaoMs)}` : null]
    .filter(Boolean)
    .join(', ');
}

/** O que o aviso diz depois de publicar. */
export function textoPublicado(nome: string, status: StatusTarefa, ativada: boolean, quemTestou?: string): string {
  if (!ativada) return `Fluxo publicado. Ele entrou no rascunho de “${nome}”: publique a tarefa na ficha para o widget usar esta versão.`;
  if (status === 'teste') return `${nome} está em teste. Só quem está liberado no teste pode pedir pelo widget.`;
  if (status !== 'ativa') return `${nome} foi publicada, mas está ${status === 'inativa' ? 'pausada' : 'em rascunho'}. Ative na ficha da tarefa.`;
  const primeiro = quemTestou ? fmt.primeiroNome(quemTestou) : null;
  return `${nome} está ativa. ${primeiro ? `${primeiro} já pode` : 'Quem tem permissão já pode'} pedir pelo widget.`;
}

export function EtapaPublicar({
  fluxo,
  tarefa,
  campos,
  nomeSistema,
  somenteLeitura,
  online,
  aoPublicado,
  aoTarefaMudou,
  aoIrPara,
}: {
  fluxo: Fluxo;
  /** A tarefa do fluxo: null quando o fluxo não tem tarefa (ou ela não abriu); undefined enquanto carrega. */
  tarefa: TarefaDetalhe | null | undefined;
  /** Dados que o copiloto pede (os da tarefa, ou os sugeridos pela gravação). */
  campos: Campo[];
  nomeSistema: string;
  somenteLeitura: boolean;
  online: boolean;
  aoPublicado: (f: Fluxo) => void;
  /** A tarefa mudou no servidor (publicada, perfis): recarregar. */
  aoTarefaMudou: () => void;
  aoIrPara: (etapa: 'mapear' | 'testar') => void;
}) {
  const toast = useToast();
  const navegar = useNavigate();
  const canais = useApi<Canais>('/canais');
  const def = tarefa ? (tarefa.rascunho ?? tarefa.publicada)?.definicao : undefined;
  const perfisSistema = tarefa?.perfisSistema ?? [];
  const [todos, setTodos] = useState(true);
  const [perfis, setPerfis] = useState<string[]>([]);
  const [widget, setWidget] = useState(true);
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [publicacao, setPublicacao] = useState<FluxoPublicado['tarefa']>(null);

  // Quem pode usar começa no que a ficha da tarefa diz (vazio: todos os perfis).
  const perfisDaFicha = def?.perfisPermitidos.join('\n');
  useEffect(() => {
    const lista = perfisDaFicha ? perfisDaFicha.split('\n') : [];
    setTodos(lista.length === 0);
    setPerfis(lista);
  }, [perfisDaFicha]);

  const publicado = fluxo.status === 'publicado';
  const pendencias = fluxo.passos.filter((p) => p.pendencia);
  const teste = fluxo.ultimoTeste;
  const testeOk = Boolean(teste?.ok);
  const semPerfil = Boolean(tarefa) && !todos && perfis.length === 0;
  const pronto = pendencias.length === 0 && testeOk && fluxo.passos.length > 0 && !semPerfil;
  const caminho = def?.caminho ?? 'navegador';
  const nome = def?.nome ?? fluxo.nome;
  const versao = tarefa
    ? publicado && tarefa.publicada
      ? tarefa.publicada.versao
      : (tarefa.rascunho?.versao ?? (tarefa.publicada ? tarefa.publicada.versao + 1 : 1))
    : fluxo.versao;
  const usados = new Set(fluxo.passos.flatMap((p) => (p.valor?.origem === 'campo' ? [p.valor.campo] : [])));
  const dados = campos.filter((c) => usados.has(c.chave));
  const obrigatorios = dados.filter((c) => c.obrigatorio).length;
  const pedidos = campos.filter((c) => c.perguntar !== false);
  const origemWidget = canais.dados?.instalacao?.origem ?? null;
  // "Ver no widget": abre o sistema onde o widget foi detectado; sem instalação, vai para Canais e widget.
  const origemRef = useRef(origemWidget);
  origemRef.current = origemWidget;
  const verNoWidget = () => {
    if (origemRef.current) window.open(origemRef.current, '_blank', 'noopener');
    else navegar('/canais#instalacao');
  };

  const publicar = async () => {
    setPublicando(true);
    setErro(null);
    try {
      const corpo = tarefa ? { ativar: widget, perfis: todos ? [] : perfis } : {};
      const r = await api.post<FluxoPublicado>(`/fluxos/${encodeURIComponent(fluxo.id)}/publicar`, corpo);
      setPublicacao(r.tarefa);
      aoPublicado(r.fluxo);
      aoTarefaMudou();
      if (r.tarefa) {
        const t = r.tarefa;
        toast.mostrar({
          texto: textoPublicado(t.nome, t.status, t.ativada, teste?.usuarioNome),
          duracaoMs: 12_000,
          acoes: [
            { rotulo: 'Abrir a ficha da tarefa', aoClicar: () => navegar(`/tarefas/${encodeURIComponent(t.id)}`) },
            ...(t.ativada && t.status === 'ativa' ? [{ rotulo: 'Ver no widget', aoClicar: verNoWidget }] : []),
          ],
        });
      } else toast.sucesso('Fluxo publicado. Para usar, escolha este fluxo na ficha da tarefa, aba Execução.');
    } catch (e) {
      setErro((e as ErroApiCliente).message);
    } finally {
      setPublicando(false);
    }
  };

  const resumo = (
    <section className="card" aria-labelledby="resumo-titulo">
      <div className="card-head">
        <h2 className="h4" id="resumo-titulo">
          Resumo da tarefa
        </h2>
        <span className="badge badge-outline">Versão {versao}</span>
      </div>
      <div className="card-body">
        <dl className="kv ap-resumo">
          <dt>Tarefa</dt>
          <dd>{tarefa ? nome : `${fluxo.nome} (fluxo ainda sem tarefa)`}</dd>
          <dt>O copiloto vai pedir</dt>
          <dd>
            {pedidos.length ? (
              <span className="row wrap" style={{ gap: 6 }}>
                {pedidos.map((c) => (
                  <span key={c.chave} className="badge badge-info">
                    {c.rotulo}
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted" style={{ fontWeight: 400 }}>
                Nada: o fluxo só clica, lê ou baixa.
              </span>
            )}
          </dd>
          <dt>Como executa</dt>
          <dd style={{ fontWeight: 400 }}>
            <span className="row-top" style={{ gap: 'var(--s-2)' }}>
              <span style={{ flex: 'none' }}>
                <SeloCaminho caminho={caminho} />
              </span>
              <span>
                {caminho === 'navegador'
                  ? 'Pela tela, com o roteiro gravado. Se a tela mudar, o conserto automático tenta e avisa você.'
                  : def?.usarFluxoSeApiFalhar
                    ? 'Pela API do sistema. Se a API falhar, pela tela com este roteiro gravado.'
                    : 'Pela API do sistema. Este roteiro fica pronto para usar como reserva.'}
              </span>
            </span>
          </dd>
          <dt>Custo previsto</dt>
          <dd>{custoPrevisto(caminho, caminho === 'api' && Boolean(def?.usarFluxoSeApiFalhar))}</dd>
          <dt>Último teste</dt>
          <dd>
            {teste ? (
              <span className="row wrap" style={{ gap: 6 }}>
                <span className={`badge ${teste.ok ? 'badge-success' : 'badge-danger'}`}>
                  <span className="dot" />
                  {teste.ok ? 'Deu certo' : 'Falhou'}
                </span>
                <span className="small muted" style={{ fontWeight: 400 }}>
                  {textoDoTeste(teste)}
                  {!teste.ok && teste.passoFalhou ? `, no passo ${teste.passoFalhou}` : ''}
                </span>
              </span>
            ) : (
              <span className="small muted" style={{ fontWeight: 400 }}>
                Ainda não testado.
              </span>
            )}
          </dd>
        </dl>
      </div>
    </section>
  );

  const seAlgoMudar = (
    <section className="card card-pad stack-sm" aria-labelledby="depois-titulo">
      <h2 className="h4" id="depois-titulo">
        Se algo mudar
      </h2>
      <p className="small">Você pode pausar a tarefa ou voltar para uma versão anterior na ficha da tarefa, sem gravar de novo.</p>
    </section>
  );

  if (tarefa === undefined) return <Carregando forma="ficha" texto="Abrindo a tarefa do fluxo…" />;

  if (publicado) {
    const pub = tarefa?.publicada;
    const usaEsteFluxo = pub?.definicao.fluxoId === fluxo.id;
    const status = publicacao?.status ?? tarefa?.status;
    const por = publicacao?.ativada ? publicacao.publicadoPor : usaEsteFluxo ? pub?.publicadoPor : null;
    const em = publicacao?.ativada ? publicacao.publicadoEm : usaEsteFluxo ? pub?.publicadoEm : null;
    return (
      <div className="split">
        <div className="main-col stack">
          <section className="stack-sm" aria-labelledby="estado-titulo">
            <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
              <h2 className="h3" id="estado-titulo">
                {nome}
              </h2>
              {tarefa && status ? <SeloStatusTarefa status={status} /> : <span className="badge badge-success">Fluxo publicado</span>}
              <span className="badge badge-outline">Versão {versao}</span>
              {por && em ? <span className="small muted">Publicada por {por} {diaEHora(em)}</span> : null}
            </div>
            {tarefa && !usaEsteFluxo ? (
              <Aviso tipo="info" titulo="O fluxo está no rascunho da tarefa">
                A versão publicada da tarefa ainda não usa este fluxo. Publique a tarefa na ficha para o widget usar esta versão.
              </Aviso>
            ) : null}
            {!tarefa ? (
              <p className="small">
                O fluxo está pronto, mas não está ligado a nenhuma tarefa. Para usar, escolha este fluxo na ficha da tarefa, aba Execução, em
                “Fluxo gravado”.
              </p>
            ) : null}
          </section>
          {resumo}
          {fluxo.tarefaId ? (
            <div className="row wrap">
              <Link className="btn btn-primary" to={`/tarefas/${encodeURIComponent(fluxo.tarefaId)}`}>
                Abrir a ficha da tarefa
                <Icone nome="seta-direita" tamanho="sm" />
              </Link>
              {usaEsteFluxo && status === 'ativa' ? (
                origemWidget ? (
                  <a className="btn btn-secondary" href={origemWidget} target="_blank" rel="noopener noreferrer">
                    Ver no widget
                    <Icone nome="externo" tamanho="sm" />
                  </a>
                ) : (
                  <Link className="btn btn-secondary" to="/canais#instalacao">
                    Ver no widget
                  </Link>
                )
              ) : null}
            </div>
          ) : null}
        </div>
        <aside className="side-col stack">{seAlgoMudar}</aside>
      </div>
    );
  }

  const itens: ItemPronto[] = [
    {
      chave: 'passos',
      ok: pendencias.length === 0,
      titulo: 'Passos revisados',
      detalhe: pendencias.length
        ? `${pendencias.length} ${pendencias.length === 1 ? 'passo com pendência' : 'passos com pendência'}`
        : `${fluxo.passos.length} ${fluxo.passos.length === 1 ? 'passo' : 'passos'} no ${nomeSistema}`,
      acao: pendencias.length ? (
        <Botao tamanho="sm" variante="fantasma" onClick={() => aoIrPara('mapear')}>
          Resolver no mapeamento
        </Botao>
      ) : undefined,
    },
    {
      chave: 'campos',
      ok: !fluxo.passos.some((p) => p.pendencia && p.valor?.origem !== 'fixo'),
      titulo: 'Campos mapeados',
      detalhe: dados.length
        ? `${dados.length} ${dados.length === 1 ? 'dado' : 'dados'}, ${
            obrigatorios === dados.length ? (dados.length === 1 ? 'obrigatório' : 'todos obrigatórios') : `${obrigatorios} obrigatórios`
          }`
        : 'Nenhum dado: o fluxo só clica, lê ou baixa',
    },
    {
      chave: 'teste',
      ok: testeOk,
      titulo: testeOk ? 'Teste deu certo' : 'Falta um teste que dê certo',
      detalhe:
        testeOk && teste
          ? [teste.registro ? registroPorExtenso(teste.registro) : fmt.quando(teste.em), teste.duracaoMs ? `em ${fmt.duracao(teste.duracaoMs)}` : null]
              .filter(Boolean)
              .join(', ')
          : teste
            ? `O último teste falhou${teste.passoFalhou ? ` no passo ${teste.passoFalhou}` : ''}. Teste de novo.`
            : 'Rode o fluxo uma vez no sistema antes de publicar.',
      acao: !testeOk ? (
        <Botao tamanho="sm" variante="fantasma" onClick={() => aoIrPara('testar')}>
          Ir para o teste
        </Botao>
      ) : undefined,
    },
  ];

  return (
    <div className="split">
      <div className="main-col stack">
        {resumo}

        {tarefa ? (
          <section className="card" aria-labelledby="quem-titulo">
            <div className="card-head">
              <h2 className="h4" id="quem-titulo">
                Quem pode usar
              </h2>
            </div>
            <fieldset className="card-body stack-sm ap-fieldset">
              <legend className="sr-only">Perfis que podem pedir esta tarefa</legend>
              <label className="check strong">
                <input
                  type="checkbox"
                  checked={todos}
                  disabled={somenteLeitura || perfisSistema.length === 0}
                  onChange={(e) => {
                    setTodos(e.target.checked);
                    if (!e.target.checked && perfis.length === 0) setPerfis(perfisSistema);
                  }}
                />
                Todos os perfis
              </label>
              {perfisSistema.length ? (
                <div className="stack-sm" style={{ gap: 0, paddingLeft: 'var(--s-6)' }}>
                  {perfisSistema.map((p) => (
                    <label key={p} className={`check${todos ? ' muted' : ''}`}>
                      <input
                        type="checkbox"
                        checked={todos || perfis.includes(p)}
                        disabled={somenteLeitura || todos}
                        onChange={(e) => setPerfis((atual) => (e.target.checked ? [...atual, p] : atual.filter((x) => x !== p)))}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              ) : null}
              {semPerfil ? <span className="error-text">Escolha pelo menos um perfil, ou marque “Todos os perfis”.</span> : null}
              <p className="help">
                O copiloto age com as permissões de quem pediu. Se a pessoa não pode fazer isso no {nomeSistema}, ele explica e oferece pedir a
                quem pode.
              </p>
            </fieldset>
          </section>
        ) : null}

        {tarefa ? (
          <section className="card" aria-labelledby="onde-titulo">
            <div className="card-head">
              <h2 className="h4" id="onde-titulo">
                Onde aparece
              </h2>
            </div>
            <div className="card-body stack">
              <div className="row between wrap">
                <div className="stack-sm" style={{ gap: 2 }}>
                  <span className="strong">Widget no {nomeSistema}</span>
                  <span className="small muted">
                    {widget ? 'O chat dentro do sistema.' : 'Desligado: o fluxo fica no rascunho da tarefa e o widget continua como está.'}
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={widget}
                    disabled={somenteLeitura}
                    aria-label="Mostrar no widget"
                    onChange={(e) => setWidget(e.target.checked)}
                  />
                  <span className="small strong">{widget ? 'Ligado' : 'Desligado'}</span>
                </label>
              </div>
              <div className="divider" />
              <div className="row between wrap">
                <div className="stack-sm" style={{ gap: 2 }}>
                  <span className="row strong" style={{ gap: 6 }}>
                    <Icone nome="cadeado" tamanho="sm" />
                    Pedir confirmação antes de executar
                  </span>
                  <span className="small muted">Tarefas que gravam dados sempre mostram o cartão de confirmação. Não dá para desligar.</span>
                </div>
                <label className="switch" style={{ cursor: 'not-allowed' }}>
                  <input type="checkbox" checked disabled readOnly aria-label="Pedir confirmação antes de executar, sempre ligado" />
                  <span className="small strong">Sempre</span>
                </label>
              </div>
            </div>
          </section>
        ) : (
          <Aviso titulo="Este fluxo ainda não tem tarefa">
            Dá para publicar assim e escolher o fluxo depois, na ficha da tarefa (aba Execução). Ou volte a Mapear campos e crie a tarefa a
            partir dele.
          </Aviso>
        )}

        {erro ? (
          <Aviso tipo="erro" titulo="Não deu para publicar" papel="alert">
            {erro}
          </Aviso>
        ) : null}

        {!somenteLeitura ? (
          <div className="row between wrap">
            <Botao onClick={() => aoIrPara('testar')}>Voltar para testar</Botao>
            <Botao variante="primario" tamanho="lg" icone="enviarArquivo" carregando={publicando} disabled={!online || !pronto} onClick={() => void publicar()}>
              Publicar versão {versao}
            </Botao>
          </div>
        ) : null}
      </div>

      <aside className="side-col stack">
        <section className="card card-pad stack" aria-labelledby="pronto-titulo">
          <h2 className="h4" id="pronto-titulo">
            Antes de publicar
          </h2>
          <ListaPronto itens={itens} />
        </section>
        {seAlgoMudar}
      </aside>
    </div>
  );
}

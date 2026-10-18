// Aba "Execução" (C3): caminho API (chamada, mapeamento, teste da chamada) ou navegador (fluxo
// gravado), e o fluxo reserva quando a API falha.
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, passoExecutavel, textoInstrucao, type ExecucaoApi, type Fluxo, type MetodoHttp, type TarefaDefinicao, type Transformacao } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo as CampoForm, Segmentado } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useOnline } from '../../componentes/pagina.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { quandoAs, ROTULO_TRANSFORMACAO } from './ficha.ts';
import type { PropsAba } from './AbaFicha.tsx';

/** Rota da API do sistema (GET /sistema/rotas). */
interface RotaApi {
  metodo: MetodoHttp;
  caminho: string;
  descricao: string;
  campos?: { nome: string; tipo: string; obrigatorio: boolean; descricao?: string }[];
  idRetorno?: string;
}

/** Resposta de POST /tarefas/:id/testar-chamada. */
interface ResultadoChamada {
  ok: boolean;
  status: number;
  duracaoMs: number;
  mensagem: string;
}

const METODOS: MetodoHttp[] = ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'];
const TRANSFORMACOES = Object.keys(ROTULO_TRANSFORMACAO) as Transformacao[];
const CONFIANCAS = [
  { valor: 0.7, rotulo: '70%: age mais sozinho' },
  { valor: 0.8, rotulo: '80%: equilíbrio (recomendado)' },
  { valor: 0.9, rotulo: '90%: pede ajuda mais cedo' },
  { valor: 0.95, rotulo: '95%: quase sempre pede ajuda' },
];

export interface PropsAbaExecucao extends PropsAba {
  tarefaId: string;
  /** Há mudanças locais ainda não salvas no rascunho. */
  sujo: boolean;
  recarregar: () => void;
}

function apiPadrao(def: TarefaDefinicao): ExecucaoApi {
  return { metodo: 'POST', caminho: '', mapeamento: def.campos.map((c) => ({ campo: c.chave, destino: c.chave })) };
}

function descricaoFluxo(f: Fluxo): string {
  const partes = [`Fluxo “${f.nome}”`];
  if (f.gravadoPor && f.gravadoEm) partes.push(`gravado por ${f.gravadoPor} em ${fmt.data(f.gravadoEm)}`);
  const feitos = f.passos.filter(passoExecutavel).length;
  partes.push(`com ${feitos} ${feitos === 1 ? 'passo' : 'passos'}`);
  return partes.join(', ');
}

/** Passos mantidos como instrução (feitos em outro site): o copiloto mostra à pessoa no pedido, não faz. */
function instrucoesDoFluxo(f: Fluxo): string[] {
  return f.passos.filter((p) => p.instrucao).map(textoInstrucao);
}

function EscolherFluxo({
  def,
  mudar,
  podeEditar,
  fluxos,
  erro,
  tarefaId,
}: PropsAba & { fluxos: Fluxo[] | undefined; erro: ErroApiCliente | null; tarefaId: string }) {
  const id = useId();
  const doFluxo = fluxos?.find((f) => f.id === def.fluxoId);
  const opcoes = (fluxos ?? []).filter((f) => f.status === 'publicado' || f.id === def.fluxoId || f.tarefaId === tarefaId);
  if (erro) {
    return (
      <p className="small text-danger" role="alert">
        Não consegui carregar os fluxos gravados: {erro.message}
      </p>
    );
  }
  return (
    <div className="stack-sm">
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="field grow" style={{ minWidth: 220 }}>
          <label htmlFor={`${id}-fluxo`}>Fluxo gravado</label>
          <select
            id={`${id}-fluxo`}
            className="select"
            value={def.fluxoId ?? ''}
            disabled={!podeEditar || !fluxos}
            onChange={(e) => mudar((d) => ({ ...d, fluxoId: e.target.value || null }))}
          >
            <option value="">{fluxos ? (opcoes.length ? 'Escolha um fluxo' : 'Nenhum fluxo gravado ainda') : 'Carregando fluxos…'}</option>
            {opcoes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.status !== 'publicado' ? ' (não publicado)' : ''}
              </option>
            ))}
          </select>
        </div>
        {doFluxo ? (
          <Link className="btn btn-ghost btn-sm" to={`/aprender/${doFluxo.id}`}>
            Abrir o fluxo
          </Link>
        ) : null}
        {podeEditar ? (
          <Link className="btn btn-secondary btn-sm" to={`/aprender?tarefa=${encodeURIComponent(tarefaId)}`}>
            <Icone nome="aprender" tamanho="sm" />
            {doFluxo ? 'Gravar de novo' : 'Gravar o fluxo na tela'}
          </Link>
        ) : null}
      </div>
      {doFluxo ? (
        <p className="help">
          {descricaoFluxo(doFluxo)}.
          {doFluxo.ultimoTeste
            ? doFluxo.ultimoTeste.ok
              ? ` Último teste passou ${quandoAs(doFluxo.ultimoTeste.em)}.`
              : ` Último teste falhou ${quandoAs(doFluxo.ultimoTeste.em)}${doFluxo.ultimoTeste.passoFalhou ? `, no passo ${doFluxo.ultimoTeste.passoFalhou}` : ''}.`
            : ' Ainda não testado.'}
          {doFluxo.status !== 'publicado' ? ' Publique o fluxo em Aprender fluxo para o copiloto poder usá-lo.' : ''}
        </p>
      ) : null}
      {doFluxo && instrucoesDoFluxo(doFluxo).length ? (
        <div className="stack-sm" style={{ gap: 'var(--s-1)' }}>
          <p className="small strong">O copiloto mostra estas instruções a quem pedir, porque são feitas em outro site:</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 'var(--s-5)' }}>
            {instrucoesDoFluxo(doFluxo).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Chamada({ def, mudar, podeEditar, tarefaId, sujo, recarregar, rotas }: PropsAbaExecucao & { rotas: RotaApi[] | undefined }) {
  const id = useId();
  const online = useOnline();
  const { resumo } = useSessao();
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoChamada | null>(null);
  const a = def.api ?? apiPadrao(def);
  const mudarApi = (p: Partial<ExecucaoApi>) => {
    setResultado(null);
    mudar((d) => {
      const atual = d.api ?? apiPadrao(d);
      const { testadaEm: _t, ...resto } = atual;
      // Mudou a chamada: a marca de "testada" deixa de valer.
      const mudouChamada = 'metodo' in p || 'caminho' in p || 'mapeamento' in p;
      return { ...d, api: { ...(mudouChamada ? resto : atual), ...p } };
    });
  };
  const rota = rotas?.find((r) => r.metodo === a.metodo && r.caminho === a.caminho);

  const usarRota = (r: RotaApi) => {
    const nomes = new Set((r.campos ?? []).map((c) => c.nome));
    mudarApi({
      metodo: r.metodo,
      caminho: r.caminho,
      ...(r.idRetorno ? { idRetorno: r.idRetorno } : {}),
      mapeamento: def.campos.map((c) => {
        const ja = a.mapeamento.find((m) => m.campo === c.chave);
        return ja && nomes.has(ja.destino) ? ja : { campo: c.chave, destino: nomes.has(c.chave) ? c.chave : (ja?.destino ?? c.chave) };
      }),
    });
  };

  const testar = async () => {
    setTestando(true);
    setResultado(null);
    try {
      const r = await api.post<ResultadoChamada>(`/tarefas/${tarefaId}/testar-chamada`, { definicao: def });
      setResultado(r);
      if (r.ok) {
        if (sujo) mudar((d) => (d.api ? { ...d, api: { ...d.api, testadaEm: new Date().toISOString() } } : d));
        else recarregar();
      }
    } catch (e) {
      setResultado({ ok: false, status: (e as ErroApiCliente).status ?? 0, duracaoMs: 0, mensagem: (e as Error).message });
    } finally {
      setTestando(false);
    }
  };

  return (
    <div className="stack-sm">
      <span className="label" id={`${id}-chamada`}>
        Chamada
      </span>
      {podeEditar ? (
        <div className="row wrap ct-chamada" role="group" aria-labelledby={`${id}-chamada`}>
          <label className="sr-only" htmlFor={`${id}-metodo`}>
            Método
          </label>
          <select id={`${id}-metodo`} className="select mono ct-metodo" value={a.metodo} onChange={(e) => mudarApi({ metodo: e.target.value as MetodoHttp })}>
            {METODOS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`${id}-caminho`}>
            Caminho na API
          </label>
          <input
            id={`${id}-caminho`}
            className="input mono grow"
            list={`${id}-rotas`}
            value={a.caminho}
            placeholder="/v1/clientes"
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value;
              const r = rotas?.find((x) => `${x.metodo} ${x.caminho}` === v || (x.caminho === v && x.metodo === a.metodo));
              if (r) usarRota(r);
              else mudarApi({ caminho: v });
            }}
          />
          <datalist id={`${id}-rotas`}>
            {(rotas ?? []).map((r) => (
              <option key={`${r.metodo} ${r.caminho}`} value={r.caminho}>
                {`${r.metodo} · ${r.descricao}`}
              </option>
            ))}
          </datalist>
        </div>
      ) : (
        <div className="card-flat row wrap" style={{ padding: 'var(--s-3) var(--s-4)', gap: 'var(--s-2)' }}>
          <span className="badge badge-info mono">{a.metodo}</span>
          <span className="mono strong">{a.caminho || '—'}</span>
        </div>
      )}
      <div className="row wrap between">
        <span className="small muted">
          {rota ? rota.descricao : a.caminho ? `Rota que não está na lista da API do ${resumo.nomeSistema}. Teste antes de publicar.` : 'Comece a digitar para ver as rotas disponíveis.'}
        </span>
        <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
          {a.testadaEm ? (
            <span className="row small text-success strong" style={{ gap: 6 }}>
              <Icone nome="check" tamanho="sm" />
              Testada {quandoAs(a.testadaEm)}
            </span>
          ) : (
            <span className="small muted">Ainda não testada</span>
          )}
          {podeEditar ? (
            <Botao
              tamanho="sm"
              icone="play"
              carregando={testando}
              disabled={!a.caminho.trim() || !online}
              title={!online ? 'Sem conexão com a internet.' : undefined}
              onClick={() => void testar()}
            >
              Testar a chamada
            </Botao>
          ) : null}
        </div>
      </div>
      <div aria-live="polite">
        {resultado ? (
          <Aviso tipo={resultado.ok ? 'sucesso' : 'erro'} titulo={resultado.ok ? 'A chamada funcionou' : 'A chamada não funcionou'}>
            <p className="small">
              {resultado.mensagem}
              {resultado.status ? ` (resposta ${resultado.status}${resultado.duracaoMs ? `, ${fmt.duracao(resultado.duracaoMs)}` : ''})` : ''}
            </p>
            <p className="tiny muted">Teste com dados de exemplo, em modo de simulação: nada foi gravado no {resumo.nomeSistema}.</p>
          </Aviso>
        ) : null}
      </div>
    </div>
  );
}

function Mapeamento({ def, mudar, podeEditar, rotas }: PropsAba & { rotas: RotaApi[] | undefined }) {
  const id = useId();
  const [editando, setEditando] = useState(false);
  const a = def.api ?? apiPadrao(def);
  const rota = rotas?.find((r) => r.metodo === a.metodo && r.caminho === a.caminho);
  const destinos = rota?.campos?.map((c) => c.nome) ?? [];
  const usaCorpo = a.metodo !== 'GET' && a.metodo !== 'DELETE';
  const naoEnviados = def.campos.filter((c) => !a.mapeamento.some((m) => m.campo === c.chave));
  const obrigatoriosDaRota = (rota?.campos ?? []).filter((c) => c.obrigatorio && !a.mapeamento.some((m) => m.destino === c.nome));

  const definir = (campo: string, p: { destino?: string; transformacao?: Transformacao }) =>
    mudar((d) => {
      const atual = d.api ?? apiPadrao(d);
      const existe = atual.mapeamento.find((m) => m.campo === campo);
      let mapeamento = existe
        ? atual.mapeamento.map((m) => (m.campo === campo ? { ...m, ...p } : m))
        : [...atual.mapeamento, { campo, destino: p.destino ?? campo, ...(p.transformacao ? { transformacao: p.transformacao } : {}) }];
      mapeamento = mapeamento
        .filter((m) => m.destino.trim() !== '')
        .map((m) => (m.transformacao === 'nenhuma' ? { campo: m.campo, destino: m.destino } : m));
      const { testadaEm: _t, ...resto } = atual;
      return { ...d, api: { ...resto, mapeamento } };
    });

  return (
    <div className="stack-sm">
      <div className="row between">
        <span className="label" id={`${id}-titulo`}>
          Mapeamento de campos
        </span>
        {podeEditar && def.campos.length > 0 ? (
          <Botao variante="fantasma" tamanho="sm" onClick={() => setEditando((x) => !x)} aria-expanded={editando}>
            {editando ? 'Pronto' : 'Editar mapeamento'}
          </Botao>
        ) : null}
      </div>
      {def.campos.length === 0 ? (
        <p className="small muted">Adicione campos na aba Ficha para mapear o que vai na chamada.</p>
      ) : editando ? (
        <div className="ct-rolagem">
          <table className="table ct-tabela-mapa" aria-labelledby={`${id}-titulo`}>
            <thead>
              <tr>
                <th scope="col">Campo da tarefa</th>
                <th scope="col">{usaCorpo ? 'Nome na chamada' : 'Nome no caminho'}</th>
                <th scope="col">Enviar como</th>
              </tr>
            </thead>
            <tbody>
              {def.campos.map((c) => {
                const m = a.mapeamento.find((x) => x.campo === c.chave);
                return (
                  <tr key={c.chave}>
                    <td className="strong small">{c.rotulo}</td>
                    <td>
                      <label className="sr-only" htmlFor={`${id}-${c.chave}-d`}>
                        Nome na chamada para {c.rotulo}
                      </label>
                      <input
                        id={`${id}-${c.chave}-d`}
                        className="input mono"
                        list={destinos.length ? `${id}-destinos` : undefined}
                        value={m?.destino ?? ''}
                        placeholder="Não enviar"
                        spellCheck={false}
                        onChange={(e) => definir(c.chave, { destino: e.target.value })}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${id}-${c.chave}-t`}>
                        Formato de {c.rotulo}
                      </label>
                      <select
                        id={`${id}-${c.chave}-t`}
                        className="select"
                        value={m?.transformacao ?? 'nenhuma'}
                        disabled={!m}
                        onChange={(e) => definir(c.chave, { transformacao: e.target.value as Transformacao })}
                      >
                        {TRANSFORMACOES.map((t) => (
                          <option key={t} value={t}>
                            {ROTULO_TRANSFORMACAO[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {destinos.length ? (
            <datalist id={`${id}-destinos`}>
              {rota?.campos?.map((c) => (
                <option key={c.nome} value={c.nome}>
                  {`${c.tipo}${c.obrigatorio ? ', obrigatório' : ''}${c.descricao ? ` · ${c.descricao}` : ''}`}
                </option>
              ))}
            </datalist>
          ) : null}
        </div>
      ) : (
        <dl className="kv ct-kv-mapa">
          {def.campos.map((c) => {
            const m = a.mapeamento.find((x) => x.campo === c.chave);
            return [
              <dt key={`${c.chave}-t`}>{c.rotulo}</dt>,
              <dd key={`${c.chave}-d`} className="mono ca-peso-medio">
                {m ? (
                  <>
                    {m.destino}
                    {m.transformacao && m.transformacao !== 'nenhuma' ? (
                      <span className="muted ct-sans"> ({ROTULO_TRANSFORMACAO[m.transformacao].toLowerCase()})</span>
                    ) : null}
                  </>
                ) : (
                  <span className="muted ct-sans">Não enviado</span>
                )}
              </dd>,
            ];
          })}
        </dl>
      )}
      {obrigatoriosDaRota.length > 0 ? (
        <p className="small text-danger">
          A rota pede {obrigatoriosDaRota.map((c) => c.nome).join(', ')}, que não {obrigatoriosDaRota.length === 1 ? 'está mapeado' : 'estão mapeados'}.
        </p>
      ) : naoEnviados.length > 0 && !editando ? (
        <p className="help">
          {naoEnviados.map((c) => c.rotulo).join(', ')} {naoEnviados.length === 1 ? 'não vai' : 'não vão'} na chamada.
        </p>
      ) : null}
      {podeEditar ? (
        <CampoForm
          rotulo="Campo do retorno com o código"
          ajuda="O copiloto usa este campo para montar o recibo, por exemplo “Cliente #4821 criado”, com o link para abrir o cadastro."
          style={{ maxWidth: 520 }}
        >
          {(p) => (
            <input
              {...p}
              className={`${p.className} mono ct-id-retorno`}
              value={a.idRetorno ?? ''}
              placeholder="id"
              spellCheck={false}
              onChange={(e) => mudar((d) => ({ ...d, api: { ...(d.api ?? apiPadrao(d)), idRetorno: e.target.value || undefined } }))}
            />
          )}
        </CampoForm>
      ) : (
        <p className="help">
          Do retorno, o copiloto usa <span className="mono">{a.idRetorno || 'id'}</span> para montar o recibo, por exemplo “Cliente #4821 criado”, com o link para
          abrir o cadastro.
        </p>
      )}
    </div>
  );
}

function MaisOpcoes({ def, mudar, podeEditar }: PropsAba) {
  const a = def.api ?? apiPadrao(def);
  const set = (p: Partial<ExecucaoApi>) => mudar((d) => ({ ...d, api: { ...(d.api ?? apiPadrao(d)), ...p } }));
  return (
    <details className="ct-detalhes">
      <summary className="small strong">Mais opções da chamada</summary>
      <fieldset className="stack ct-fieldset" disabled={!podeEditar} style={{ marginTop: 'var(--s-3)' }}>
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Nome da etapa que grava" ajuda="Aparece no progresso. Ex.: Criando o cadastro.">
            {(p) => <input {...p} value={a.rotuloExecucao ?? ''} onChange={(e) => set({ rotuloExecucao: e.target.value || undefined })} />}
          </CampoForm>
          <CampoForm rotulo="Tela do resultado" ajuda="Caminho para abrir no sistema. Aceita {id}. Ex.: /clientes/{id}.">
            {(p) => (
              <input {...p} className={`${p.className} mono`} value={a.linkResultado ?? ''} onChange={(e) => set({ linkResultado: e.target.value || undefined })} />
            )}
          </CampoForm>
        </div>
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Conferir antes de gravar (GET)" ajuda="Ex.: /v1/clientes?documento={cnpj}. Se achar algo, o copiloto avisa em vez de duplicar.">
            {(p) => (
              <input
                {...p}
                className={`${p.className} mono`}
                value={a.verificarAntes?.caminho ?? ''}
                onChange={(e) =>
                  set({
                    verificarAntes: e.target.value
                      ? { descricao: a.verificarAntes?.descricao || 'Verificando se já existe', ...a.verificarAntes, caminho: e.target.value }
                      : undefined,
                  })
                }
              />
            )}
          </CampoForm>
          <CampoForm rotulo="Texto da conferência" ajuda="Ex.: Verificando se o cliente já existe.">
            {(p) => (
              <input
                {...p}
                value={a.verificarAntes?.descricao ?? ''}
                disabled={!a.verificarAntes}
                onChange={(e) => a.verificarAntes && set({ verificarAntes: { ...a.verificarAntes, descricao: e.target.value } })}
              />
            )}
          </CampoForm>
        </div>
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Chamada para desfazer" classe="select" ajuda="Usada pelo botão Desfazer do recibo.">
            {(p) => (
              <select
                {...p}
                value={a.desfazer?.metodo ?? ''}
                onChange={(e) =>
                  set({ desfazer: e.target.value ? { metodo: e.target.value as MetodoHttp, caminho: a.desfazer?.caminho || `${a.caminho}/{id}` } : undefined })
                }
              >
                <option value="">Sem chamada para desfazer</option>
                {METODOS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
          </CampoForm>
          <CampoForm rotulo="Caminho para desfazer" ajuda="Aceita {id}. Ex.: /v1/clientes/{id}.">
            {(p) => (
              <input
                {...p}
                className={`${p.className} mono`}
                value={a.desfazer?.caminho ?? ''}
                disabled={!a.desfazer}
                onChange={(e) => a.desfazer && set({ desfazer: { ...a.desfazer, caminho: e.target.value } })}
              />
            )}
          </CampoForm>
        </div>
      </fieldset>
    </details>
  );
}

export default function AbaExecucao(props: PropsAbaExecucao) {
  const { def, mudar, podeEditar, tarefaId } = props;
  const rotas = useApi<RotaApi[]>(podeEditar ? '/sistema/rotas' : null);
  const fluxos = useApi<Fluxo[]>('/fluxos');
  const fluxoReserva = fluxos.dados?.find((f) => f.id === def.fluxoId);

  return (
    <section className="card" aria-labelledby="executar-titulo">
      <div className="card-head wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h4" id="executar-titulo">
            Como executar
          </h2>
          <span className="small muted">API é mais rápida e não quebra quando a tela muda.</span>
        </div>
        <Segmentado
          rotulo="Caminho de execução"
          valor={def.caminho}
          desativado={!podeEditar}
          opcoes={[
            { valor: 'api', rotulo: 'API', icone: 'api' },
            { valor: 'navegador', rotulo: 'Navegador', icone: 'navegador' },
          ]}
          aoTrocar={(c) => mudar((d) => ({ ...d, caminho: c, ...(c === 'api' && !d.api ? { api: apiPadrao(d) } : {}) }))}
        />
      </div>
      <div className="card-body stack">
        {def.caminho === 'api' ? (
          <>
            {rotas.erro ? (
              <p className="small muted">Não consegui listar as rotas da API agora ({rotas.erro.message}). Dá para digitar o caminho mesmo assim.</p>
            ) : null}
            <Chamada {...props} rotas={rotas.dados} />
            <Mapeamento def={def} mudar={mudar} podeEditar={podeEditar} rotas={rotas.dados} />
            <MaisOpcoes def={def} mudar={mudar} podeEditar={podeEditar} />
            <div className="divider" />
            <div className="stack-sm">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={def.usarFluxoSeApiFalhar}
                  disabled={!podeEditar}
                  aria-describedby="fallback-ajuda"
                  onChange={(e) => mudar((d) => ({ ...d, usarFluxoSeApiFalhar: e.target.checked }))}
                />
                <span className="strong">Se a API falhar, usar o fluxo gravado</span>
              </label>
              <p className="help" id="fallback-ajuda">
                {!def.usarFluxoSeApiFalhar && fluxoReserva ? `${descricaoFluxo(fluxoReserva)}. ` : ''}É mais lento, mas evita que o pedido fique parado. A
                pessoa vê que o caminho mudou.
              </p>
              {def.usarFluxoSeApiFalhar ? (
                <EscolherFluxo {...props} fluxos={fluxos.dados} erro={fluxos.erro} tarefaId={tarefaId} />
              ) : null}
              {def.usarFluxoSeApiFalhar && !def.fluxoId && fluxos.dados ? (
                <p className="small text-danger">Escolha o fluxo reserva ou desligue esta opção.</p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Aviso tipo="info">
              No caminho navegador, o copiloto repete na tela do sistema os passos que você gravou, com o login de quem pediu. É mais lento que a API e
              depende da tela não mudar muito.
            </Aviso>
            <EscolherFluxo {...props} fluxos={fluxos.dados} erro={fluxos.erro} tarefaId={tarefaId} />
            {!def.fluxoId && fluxos.dados ? <p className="small text-danger">Escolha o fluxo gravado que esta tarefa usa.</p> : null}
            <div className="divider" />
            <CampoForm
              rotulo="Confiança mínima para agir sozinho"
              classe="select"
              ajuda="Quando a tela muda, o copiloto procura o botão ou campo pelo texto e pela posição. Abaixo desta confiança ele para e pede ajuda a uma pessoa da equipe."
              style={{ maxWidth: 420 }}
            >
              {(p) => (
                <select
                  {...p}
                  value={String(def.confiancaMinima)}
                  disabled={!podeEditar}
                  onChange={(e) => mudar((d) => ({ ...d, confiancaMinima: Number(e.target.value) }))}
                >
                  {CONFIANCAS.some((c) => c.valor === def.confiancaMinima) ? null : (
                    <option value={String(def.confiancaMinima)}>{fmt.percentual(def.confiancaMinima, 0)}</option>
                  )}
                  {CONFIANCAS.map((c) => (
                    <option key={c.valor} value={String(c.valor)}>
                      {c.rotulo}
                    </option>
                  ))}
                </select>
              )}
            </CampoForm>
          </>
        )}
      </div>
    </section>
  );
}

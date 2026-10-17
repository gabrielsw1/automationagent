// C6 · Detalhe da execução: por que deu certo ou errado, com linha do tempo, prints, conversa e auditoria,
// e as ações do suporte (reexecutar, concluir, avisar, atender, aprovar, desfazer).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmt, type EventoLinhaTempo, type ExecucaoDetalhe } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useAcao, useApi, useEventosConsole } from '../../api/hooks.ts';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import {
  AvisoErro,
  ErroAcao,
  EsqueletoTabela,
  Icone,
  Modal,
  rotuloCanal,
  SeloStatus,
  useAgora,
  useOnline,
  useToast,
  type NomeIcone,
} from './pecas.tsx';

type Dialogo =
  | null
  | 'reexecutar'
  | 'concluir'
  | 'avisar'
  | 'desfazer'
  | 'aprovar'
  | 'recusar'
  | 'encerrar'
  | { print: NonNullable<EventoLinhaTempo['print']>; candidato?: EventoLinhaTempo['candidato'] };

const FINAIS = ['concluida', 'cancelada', 'desfeita'];

function horaEvento(e: EventoLinhaTempo): string {
  const ini = fmt.horaSegundos(e.ts);
  if (!e.fim) return ini;
  const fim = Number.isNaN(Date.parse(e.fim)) ? e.fim : fmt.horaSegundos(e.fim);
  return `${ini} – ${fim}`;
}

function iconeDoEvento(e: EventoLinhaTempo): { classe: string; dot: string; icone: NomeIcone } {
  if (e.estado === 'ok') return { classe: 'done', dot: '', icone: 'check' };
  if (e.estado === 'falhou') return { classe: 'fail', dot: '', icone: 'x' };
  const porTipo: Partial<Record<EventoLinhaTempo['tipo'], NomeIcone>> = {
    recuperacao: 'reexecutar',
    transferencia: 'pessoa',
    aviso: 'enviar',
    desfeito: 'desfazer',
    pedido: 'chat',
    api: 'api',
    login: 'login',
    confirmacao: 'check',
    conclusao: 'check',
    falha: 'alerta',
  };
  if (e.estado === 'aviso') return { classe: '', dot: 'cb-dot-aviso', icone: porTipo[e.tipo] ?? 'alerta' };
  return { classe: '', dot: 'cb-dot-info', icone: porTipo[e.tipo] ?? 'ponto' };
}

function percentual(c: number): string {
  return fmt.percentual(c > 1 ? c / 100 : c, 0);
}

export default function DetalheExecucao() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const { recarregarResumo, resumo } = useSessao();
  const podeOperar = usePode('operar');
  const podeEditar = usePode('editar');
  const podeAdministrar = usePode('administrar');
  const online = useOnline();
  const { dados, erro, recarregar } = useApi<ExecucaoDetalhe>(`/execucoes/${encodeURIComponent(id)}`);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const toast = useToast();

  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recarregarLogo = useCallback(() => {
    if (espera.current) return;
    espera.current = setTimeout(() => {
      espera.current = null;
      void recarregar();
    }, 400);
  }, [recarregar]);
  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current);
  }, []);
  useEventosConsole((e) => {
    if (e.tipo === 'execucao' && e.execucaoId === id) recarregarLogo();
    else if (e.tipo === 'aprovacao' && dados?.aprovacao) recarregarLogo();
    else if ((e.tipo === 'conversa' || e.tipo === 'mensagem') && dados?.conversaId && e.conversaId === dados.conversaId) {
      recarregarLogo();
    }
  });

  const andamento = dados?.linha.status === 'em_andamento';
  const [recebidoEm, setRecebidoEm] = useState(() => Date.now());
  useEffect(() => setRecebidoEm(Date.now()), [dados]);
  const agora = useAgora(1000, !!andamento);

  const depois = async (texto: string) => {
    setDialogo(null);
    toast.mostrar(texto);
    await Promise.all([recarregar(), recarregarResumo()]);
  };

  if (!dados) {
    if (erro?.status === 404) {
      return (
        <div className="cb-pagina">
          <Link className="cb-voltar" to="/execucoes">
            <Icone nome="anterior" tamanho="sm" />
            Execuções
          </Link>
          <div className="card empty">
            <div className="empty-icon">
              <Icone nome="busca" tamanho="lg" />
            </div>
            <h3 className="h3">Execução não encontrada</h3>
            <p>
              Não existe execução com o código <span className="mono">{id}</span>. Confira o código ou volte para a lista.
            </p>
            <Link className="btn btn-secondary" to="/execucoes">
              Ver execuções
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="cb-pagina">
        <Link className="cb-voltar" to="/execucoes">
          <Icone nome="anterior" tamanho="sm" />
          Execuções
        </Link>
        {erro ? (
          <AvisoErro erro={erro} titulo="Não conseguimos carregar esta execução" aoTentar={() => void recarregar()} />
        ) : (
          <EsqueletoTabela linhas={6} texto="Carregando a execução" />
        )}
      </div>
    );
  }

  const { linha, acoes } = dados;
  const primeiro = fmt.primeiroNome(linha.usuario.nome);
  const transferidaAberta = !!linha.transferidaPara && !FINAIS.includes(linha.status);
  const duracao =
    linha.status === 'em_andamento'
      ? `${fmt.duracao((linha.duracaoMs ?? 0) + Math.max(0, agora - recebidoEm))} até agora`
      : linha.duracaoMs === null
        ? '—'
        : fmt.duracao(linha.duracaoMs);
  const aprovacaoAberta = dados.aprovacao?.estado === 'enviada' ? dados.aprovacao : null;
  const algumaAcao =
    acoes.reexecutar || acoes.concluir || acoes.avisar || acoes.desfazer || acoes.atualizarFluxo || !!aprovacaoAberta;
  const semPermissaoDeAgir =
    algumaAcao &&
    !((acoes.reexecutar || acoes.concluir || acoes.avisar || aprovacaoAberta) && podeOperar) &&
    !(acoes.desfazer && podeAdministrar) &&
    !(acoes.atualizarFluxo && podeEditar && dados.fluxoId);

  const custoTotal =
    dados.custoModelo === null && dados.custoNavegador === null
      ? null
      : (dados.custoModelo ?? 0) + (dados.custoNavegador ?? 0);

  return (
    <div className="cb-pagina">
      <Link className="cb-voltar" to="/execucoes">
        <Icone nome="anterior" tamanho="sm" />
        Execuções
      </Link>

      <div className="page-head">
        <div className="stack-sm">
          <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
            <h1 className="h1">{linha.tarefa.nome}</h1>
            <SeloStatus status={linha.status} />
            {linha.transferidaPara ? (
              <span className="badge badge-outline">
                <Icone nome="pessoa" tamanho="sm" />
                Transferida para {linha.transferidaPara}
              </span>
            ) : null}
            {linha.canal === 'teste' ? <span className="badge badge-outline">Teste no console</span> : null}
            {linha.exemplo ? <span className="badge">Dados de exemplo</span> : null}
          </div>
          <p className="muted">
            <span className="mono">{linha.id}</span> · {fmt.data(linha.inicio)} às {fmt.hora(linha.inicio)} · pedida por{' '}
            {linha.usuario.nome}
          </p>
        </div>
        <div className="row wrap cb-acoes-topo">
          {acoes.reexecutar && podeOperar ? (
            <button className="btn btn-secondary" type="button" disabled={!online} onClick={() => setDialogo('reexecutar')}>
              <Icone nome="reexecutar" />
              Reexecutar
            </button>
          ) : null}
          {acoes.concluir && podeOperar ? (
            <button className="btn btn-secondary" type="button" disabled={!online} onClick={() => setDialogo('concluir')}>
              <Icone nome="check" />
              Marcar como concluída
            </button>
          ) : null}
          {acoes.avisar && podeOperar ? (
            <button className="btn btn-ghost" type="button" disabled={!online} onClick={() => setDialogo('avisar')}>
              <Icone nome="enviar" />
              Avisar o usuário
            </button>
          ) : null}
          {acoes.desfazer && podeAdministrar ? (
            <button className="btn btn-ghost" type="button" disabled={!online} onClick={() => setDialogo('desfazer')}>
              <Icone nome="desfazer" />
              Desfazer
            </button>
          ) : null}
          {acoes.atualizarFluxo && podeEditar && dados.fluxoId ? (
            <Link className="btn btn-primary" to={`/aprender/${encodeURIComponent(dados.fluxoId)}`}>
              <Icone nome="alvo" />
              Atualizar o fluxo gravado
            </Link>
          ) : null}
        </div>
      </div>

      {semPermissaoDeAgir ? (
        <p className="small muted">Seu perfil só permite ver esta execução. Peça a alguém do Suporte ou a um Admin para agir.</p>
      ) : null}

      {dados.diagnostico ? <Diagnostico {...dados.diagnostico} /> : null}

      {aprovacaoAberta ? (
        <section className="card" aria-labelledby="t-aprovacao">
          <div className="card-body row-top wrap between" style={{ gap: 'var(--s-4)' }}>
            <div className="row-top" style={{ gap: 'var(--s-3)', flex: '1 1 320px' }}>
              <span className="badge badge-warning">
                <Icone nome="relogio" tamanho="sm" />
                Aguardando aprovação
              </span>
              <div className="stack-sm" style={{ gap: 2 }}>
                <h2 className="h4" id="t-aprovacao">
                  Pedido de aprovação
                </h2>
                <p className="small muted">
                  {linha.usuario.nome} pediu esta tarefa, mas o perfil de {primeiro} não permite. {aprovacaoAberta.aprovador ? `Aprovador: ${aprovacaoAberta.aprovador}.` : ''} Se aprovar, o copiloto executa
                  com os dados confirmados.
                </p>
              </div>
            </div>
            {podeOperar ? (
              <div className="row wrap">
                <button className="btn btn-secondary" type="button" disabled={!online} onClick={() => setDialogo('recusar')}>
                  Recusar
                </button>
                <button className="btn btn-primary" type="button" disabled={!online} onClick={() => setDialogo('aprovar')}>
                  Aprovar
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {acoes.responder ? (
        <Atendimento
          detalhe={dados}
          podeOperar={podeOperar}
          online={online}
          aoFeito={(t) => void depois(t)}
          aoEncerrar={() => setDialogo('encerrar')}
        />
      ) : null}

      <div className="split">
        <section className="main-col card" aria-labelledby="t-linha">
          <div className="card-head cb-card-head-wrap">
            <h2 className="h4" id="t-linha">
              Linha do tempo
            </h2>
            {linha.caminho === 'navegador' ? (
              <span className="badge badge-accent">
                <Icone nome="navegador" tamanho="sm" />
                Pelo navegador na nuvem
              </span>
            ) : linha.caminho === 'api' ? (
              <span className="badge badge-info">
                <Icone nome="api" tamanho="sm" />
                Pela API do sistema
              </span>
            ) : null}
          </div>
          <div className="card-body">
            {dados.linhaTempo.length === 0 ? (
              <p className="small muted">
                {linha.status === 'aguardando_confirmacao'
                  ? `Nada aconteceu ainda: o copiloto espera ${primeiro} confirmar os dados.`
                  : 'Esta execução ainda não tem passos registrados.'}
              </p>
            ) : (
              <ol className="steps cb-linha-tempo">
                {dados.linhaTempo.map((e) => (
                  <EventoTempo
                    key={e.id}
                    evento={e}
                    transferida={e.tipo === 'transferencia' && transferidaAberta ? linha.transferidaPara : null}
                    aoAbrirPrint={(print) => setDialogo({ print, candidato: e.candidato })}
                  />
                ))}
              </ol>
            )}
          </div>
        </section>

        <aside className="side-col stack" aria-label="Detalhes da execução">
          <section className="card" aria-labelledby="t-resumo">
            <div className="card-head">
              <h2 className="h4" id="t-resumo">
                Resumo
              </h2>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>Usuário</dt>
                <dd>{linha.usuario.nome}</dd>
                <dt>Canal</dt>
                <dd>{rotuloCanal(linha.canal)}</dd>
                <dt>Início</dt>
                <dd className="num">{fmt.horaSegundos(linha.inicio)}</dd>
                <dt>Duração</dt>
                <dd className="num">{duracao}</dd>
                <dt>Caminho</dt>
                <dd>{linha.caminho === 'api' ? 'API' : linha.caminho === 'navegador' ? 'Navegador' : '—'}</dd>
                <dt>Versão da tarefa</dt>
                <dd>{dados.tarefaVersao ?? '—'}</dd>
                {dados.aprovacao && dados.aprovacao.estado !== 'enviada' ? (
                  <>
                    <dt>Aprovação</dt>
                    <dd>
                      {{ aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada', enviada: 'Enviada' }[dados.aprovacao.estado]}
                      {dados.aprovacao.aprovador ? ` · ${dados.aprovacao.aprovador}` : ''}
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          </section>

          {dados.dados.length > 0 ? (
            <section className="card" aria-labelledby="t-dados">
              <div className="card-head">
                <h2 className="h4" id="t-dados">
                  Dados do pedido
                </h2>
              </div>
              <div className="card-body stack-sm">
                <p className="small muted cb-msg-texto">“{linha.pedido}”</p>
                <dl className="kv">
                  {dados.dados.map((d) => (
                    <Par key={d.rotulo} rotulo={d.rotulo} valor={d.valor} />
                  ))}
                </dl>
              </div>
            </section>
          ) : null}

          <section className="card" aria-labelledby="t-custo">
            <div className="card-head">
              <h2 className="h4" id="t-custo">
                Custo
              </h2>
              <span className="h3 num">{custoTotal === null ? '—' : fmt.moeda(custoTotal)}</span>
            </div>
            <div className="card-body stack-sm">
              {custoTotal === null ? (
                <p className="small muted">
                  {linha.status === 'em_andamento' ? 'O custo aparece quando a execução terminar.' : 'Sem custo registrado.'}
                </p>
              ) : (
                <>
                  <div className="row cb-barra-custo" aria-hidden="true">
                    {(dados.custoModelo ?? 0) > 0 ? <span className="cb-cor-modelo" style={{ flex: dados.custoModelo ?? 0 }} /> : null}
                    {(dados.custoNavegador ?? 0) > 0 ? (
                      <span className="cb-cor-navegador" style={{ flex: dados.custoNavegador ?? 0 }} />
                    ) : null}
                  </div>
                  <div className="row between small">
                    <span className="row" style={{ gap: 6 }}>
                      <span className="cb-legenda-ponto cb-cor-modelo" aria-hidden="true" />
                      Modelo
                    </span>
                    <span className="num strong">{fmt.moeda(dados.custoModelo ?? 0)}</span>
                  </div>
                  {dados.custoNavegador !== null || linha.caminho === 'navegador' ? (
                    <div className="row between small">
                      <span className="row" style={{ gap: 6 }}>
                        <span className="cb-legenda-ponto cb-cor-navegador" aria-hidden="true" />
                        Navegador
                      </span>
                      <span className="num strong">{fmt.moeda(dados.custoNavegador ?? 0)}</span>
                    </div>
                  ) : null}
                  <p className="tiny muted">
                    {dados.linhaTempo.some((e) => e.tipo === 'recuperacao')
                      ? 'As tentativas de recuperação visual estão incluídas no custo do modelo.'
                      : dados.custoNavegador !== null || linha.caminho === 'navegador'
                        ? 'Modelo: chamadas ao Claude. Navegador: minutos de navegador na nuvem.'
                        : 'Modelo: chamadas ao Claude. Pela API não há custo de navegador.'}
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="t-conversa">
            <div className="card-head">
              <h2 className="h4" id="t-conversa">
                Conversa
              </h2>
              <span className="tiny muted">
                {dados.conversa.length} {dados.conversa.length === 1 ? 'mensagem' : 'mensagens'}
              </span>
            </div>
            <div className="card-body stack">
              {dados.conversa.length === 0 ? (
                <p className="small muted">Sem mensagens ligadas a esta execução.</p>
              ) : (
                dados.conversa.map((m) => <Mensagem key={m.id} m={m} iniciais={linha.usuario.iniciais} />)
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="t-audit">
            <div className="card-head">
              <h2 className="h4" id="t-audit">
                Auditoria
              </h2>
              <span className="muted">
                <Icone nome="cadeado" />
              </span>
            </div>
            <div className="card-body stack">
              <dl className="kv">
                {dados.auditoria.map((a) => (
                  <Par key={a.rotulo} rotulo={a.rotulo} valor={a.valor} mono={a.rotulo === 'IP'} />
                ))}
              </dl>
              {resumo.eu.perfil === 'admin' ? (
                <Link className="small strong row" style={{ gap: 6 }} to="/equipe#auditoria">
                  Ver no registro de auditoria
                  <Icone nome="proximo" tamanho="sm" />
                </Link>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {dialogo === 'reexecutar' ? (
        <DialogoAcao
          titulo="Reexecutar com os mesmos dados?"
          texto={`O copiloto tenta de novo com os dados que ${primeiro} confirmou e com as permissões de ${primeiro}. Uma nova execução é criada; esta continua no histórico.`}
          rotulo="Reexecutar"
          aoFechar={() => setDialogo(null)}
          executar={() => api.post<{ id: string }>(`/execucoes/${encodeURIComponent(id)}/reexecutar`)}
          aoConcluir={async (r) => {
            setDialogo(null);
            await recarregarResumo();
            if (r?.id) {
              navegar(`/execucoes/${encodeURIComponent(r.id)}`);
              toast.mostrar(`Nova execução ${r.id} criada a partir de ${id}.`);
            }
          }}
        />
      ) : null}
      {dialogo === 'concluir' ? (
        <DialogoAcao
          titulo="Marcar como concluída?"
          texto="Use quando o pedido foi resolvido fora do copiloto. A execução passa a contar como concluída. Se quiser, deixe uma nota para a equipe."
          campo={{ rotulo: 'Nota (opcional)', placeholder: 'Ex.: Agendei por telefone com o cliente.', obrigatorio: false, limite: 1000 }}
          rotulo="Marcar como concluída"
          aoFechar={() => setDialogo(null)}
          executar={(nota) => api.post(`/execucoes/${encodeURIComponent(id)}/concluir`, nota ? { nota } : {})}
          aoConcluir={() => depois('Execução marcada como concluída.')}
        />
      ) : null}
      {dialogo === 'avisar' ? (
        <DialogoAcao
          titulo={`Avisar ${linha.usuario.nome}`}
          texto={`A mensagem aparece no widget de ${primeiro}, como uma mensagem do suporte.`}
          campo={{
            rotulo: 'Mensagem',
            inicial: `Oi, ${primeiro}! `,
            obrigatorio: true,
            limite: 2000,
          }}
          rotulo="Enviar aviso"
          aoFechar={() => setDialogo(null)}
          executar={(texto) => api.post(`/execucoes/${encodeURIComponent(id)}/avisar`, { texto })}
          aoConcluir={() => depois(`Aviso enviado para ${primeiro}.`)}
        />
      ) : null}
      {dialogo === 'desfazer' ? (
        <DialogoAcao
          titulo="Desfazer esta execução?"
          texto={`O copiloto reverte no ${resumo.nomeSistema} o que esta execução gravou (${linha.tarefa.nome}). Isso fica no registro de auditoria e não pode ser refeito automaticamente.`}
          rotulo="Desfazer"
          perigo
          aoFechar={() => setDialogo(null)}
          executar={() => api.post(`/execucoes/${encodeURIComponent(id)}/desfazer`)}
          aoConcluir={() => depois('Execução desfeita.')}
        />
      ) : null}
      {dialogo === 'aprovar' && aprovacaoAberta ? (
        <DialogoAcao
          titulo={`Aprovar o pedido de ${linha.usuario.nome}?`}
          texto={`O copiloto executa ${linha.tarefa.nome.toLowerCase()} em nome de ${primeiro}, com os dados do pedido. ${primeiro} é avisado no widget.`}
          rotulo="Aprovar e executar"
          aoFechar={() => setDialogo(null)}
          executar={() => api.post(`/execucoes/aprovacoes/${encodeURIComponent(aprovacaoAberta.id)}/decidir`, { aprovado: true })}
          aoConcluir={() => depois('Pedido aprovado. O copiloto vai executar.')}
        />
      ) : null}
      {dialogo === 'recusar' && aprovacaoAberta ? (
        <DialogoAcao
          titulo={`Recusar o pedido de ${linha.usuario.nome}?`}
          texto={`${primeiro} vê no widget que o pedido foi recusado. Nada é gravado.`}
          campo={{ rotulo: 'Motivo', placeholder: 'Ex.: Fora da política de descontos.', obrigatorio: false, limite: 500, ajuda: 'Recomendado: o motivo aparece para quem pediu.' }}
          rotulo="Recusar"
          perigo
          aoFechar={() => setDialogo(null)}
          executar={(motivo) =>
            api.post(`/execucoes/aprovacoes/${encodeURIComponent(aprovacaoAberta.id)}/decidir`, {
              aprovado: false,
              ...(motivo ? { motivo } : {}),
            })
          }
          aoConcluir={() => depois('Pedido recusado.')}
        />
      ) : null}
      {dialogo === 'encerrar' ? (
        <DialogoAcao
          titulo="Encerrar o atendimento?"
          texto={`A conversa volta para o copiloto. ${primeiro} vê que o atendimento terminou.`}
          rotulo="Encerrar atendimento"
          aoFechar={() => setDialogo(null)}
          executar={() => api.post(`/execucoes/${encodeURIComponent(id)}/encerrar-atendimento`)}
          aoConcluir={() => depois('Atendimento encerrado. A conversa voltou para o copiloto.')}
        />
      ) : null}
      {dialogo && typeof dialogo === 'object' ? (
        <Modal
          titulo={dialogo.print.legenda}
          largura={1100}
          aoFechar={() => setDialogo(null)}
          rodape={
            <>
              <a className="btn btn-ghost" href={dialogo.print.url} target="_blank" rel="noreferrer">
                <Icone nome="abrir" />
                Abrir em outra aba
              </a>
              <button className="btn btn-secondary" type="button" onClick={() => setDialogo(null)}>
                Fechar
              </button>
            </>
          }
        >
          <FiguraPrint print={dialogo.print} candidato={dialogo.candidato} grande />
        </Modal>
      ) : null}
      {toast.elemento}
    </div>
  );
}

function Par({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd className={mono ? 'mono' : undefined}>{valor}</dd>
    </>
  );
}

function Diagnostico({ titulo, detalhe, tom }: NonNullable<ExecucaoDetalhe['diagnostico']>) {
  const classe = { erro: 'alert-danger', aviso: 'alert-warning', sucesso: 'alert-success', info: '' }[tom];
  const icone: NomeIcone = tom === 'sucesso' ? 'check' : tom === 'info' ? 'info' : 'alerta';
  return (
    <div className={`alert ${classe}`} role={tom === 'erro' ? 'alert' : 'status'}>
      <Icone nome={icone} />
      <div className="stack-sm">
        <p className="strong">{titulo}</p>
        {detalhe ? <p className="small">{detalhe}</p> : null}
      </div>
    </div>
  );
}

function EventoTempo({
  evento: e,
  transferida,
  aoAbrirPrint,
}: {
  evento: EventoLinhaTempo;
  transferida: string | null;
  aoAbrirPrint: (p: NonNullable<EventoLinhaTempo['print']>) => void;
}) {
  const v = iconeDoEvento(e);
  return (
    <li className={`step ${v.classe}`}>
      <span className={`step-dot ${v.dot}`}>
        <Icone nome={v.icone} tamanho="sm" />
      </span>
      <div className="stack-sm grow">
        <div className="row between wrap">
          <span className="strong">{e.titulo}</span>
          <span className="mono tiny muted">{horaEvento(e)}</span>
        </div>
        {e.detalhe ? <p className={e.estado === 'falhou' ? 'small text-danger strong' : 'small muted'}>{e.detalhe}</p> : null}
        {e.dados?.length ? (
          <dl className="kv card-flat" style={{ padding: 'var(--s-3)' }}>
            {e.dados.map((d, i) => (
              <Par key={`${d.rotulo}-${i}`} rotulo={d.rotulo} valor={d.valor} />
            ))}
          </dl>
        ) : null}
        {e.print ? <FiguraPrint print={e.print} candidato={e.candidato} aoAbrir={() => aoAbrirPrint(e.print!)} /> : null}
        {e.candidato ? (
          <div className="card-flat stack-sm" style={{ padding: 'var(--s-3)' }}>
            <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <span className="small strong">Candidato encontrado:</span>
              <span className="small">
                “{e.candidato.texto || 'sem texto'}” · confiança {percentual(e.candidato.confianca)}
              </span>
            </div>
          </div>
        ) : null}
        {transferida ? (
          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <span className="avatar avatar-sm cb-avatar-pessoa" aria-hidden="true">
              {fmt.iniciais(transferida)}
            </span>
            <span className="small">
              Com {transferida} desde {fmt.hora(e.ts)} · ainda não concluída
            </span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Print da execução com o destaque desenhado por cima (coordenadas de 0 a 1 ou em pixels da imagem). */
export function FiguraPrint({
  print,
  candidato,
  aoAbrir,
  grande,
}: {
  print: NonNullable<EventoLinhaTempo['print']>;
  candidato?: EventoLinhaTempo['candidato'];
  aoAbrir?: () => void;
  grande?: boolean;
}) {
  const [tamanho, setTamanho] = useState<{ w: number; h: number } | null>(null);
  const [falhou, setFalhou] = useState(false);
  const d = print.destaque;
  let caixa: { left: string; top: string; width: string; height: string } | null = null;
  if (d) {
    const relativo = d.x <= 1 && d.y <= 1 && d.w <= 1 && d.h <= 1;
    const W = relativo ? 1 : (tamanho?.w ?? 0);
    const H = relativo ? 1 : (tamanho?.h ?? 0);
    if (W > 0 && H > 0) {
      caixa = {
        left: `${(d.x / W) * 100}%`,
        top: `${(d.y / H) * 100}%`,
        width: `${(d.w / W) * 100}%`,
        height: `${(d.h / H) * 100}%`,
      };
    }
  }
  const conteudo: ReactNode = falhou ? (
    <span className="cb-print-vazio">Print indisponível: apagado pela retenção ou ainda sendo gerado.</span>
  ) : (
    <>
      <img
        src={print.url}
        alt={print.legenda}
        loading="lazy"
        onLoad={(ev) => setTamanho({ w: ev.currentTarget.naturalWidth, h: ev.currentTarget.naturalHeight })}
        onError={() => setFalhou(true)}
      />
      {caixa ? (
        <span className="cb-destaque" style={caixa} data-testid="destaque">
          {candidato ? <span className="cb-destaque-rotulo">Candidato · confiança {percentual(candidato.confianca)}</span> : null}
        </span>
      ) : null}
    </>
  );
  return (
    <figure className={`cb-figura${grande ? ' cb-print-grande' : ''}`} style={grande ? undefined : { maxWidth: d ? 520 : 240 }}>
      {aoAbrir && !falhou ? (
        <button className="cb-print" type="button" onClick={aoAbrir} aria-label={`Ampliar ${print.legenda}`}>
          {conteudo}
        </button>
      ) : (
        <div className="cb-print">{conteudo}</div>
      )}
      <figcaption className="row tiny muted" style={{ gap: 4 }}>
        <Icone nome="imagem" tamanho="sm" />
        {print.legenda}
      </figcaption>
    </figure>
  );
}

function Mensagem({ m, iniciais }: { m: ExecucaoDetalhe['conversa'][number]; iniciais: string }) {
  if (m.autorTipo === 'sistema') {
    return (
      <p className="tiny muted cb-msg-sistema cb-msg-texto" title={fmt.dataHora(m.ts)}>
        {m.texto}
      </p>
    );
  }
  const avatar =
    m.autorTipo === 'copiloto' ? (
      <span className="avatar avatar-bot avatar-sm" aria-hidden="true">
        <Icone nome="brilho" tamanho="sm" />
      </span>
    ) : m.autorTipo === 'pessoa' ? (
      <span className="avatar avatar-sm cb-avatar-pessoa" aria-hidden="true">
        {fmt.iniciais(m.autor)}
      </span>
    ) : (
      <span className="avatar avatar-sm" aria-hidden="true">
        {iniciais}
      </span>
    );
  return (
    <div className="row-top" style={{ gap: 'var(--s-2)' }}>
      {avatar}
      <div className="stack-sm grow" style={{ gap: 2 }}>
        <div className="row between">
          <span className="tiny strong">
            {m.autor}
            {m.autorTipo === 'pessoa' ? <span className="muted"> · Suporte</span> : null}
          </span>
          <span className="mono tiny muted">{fmt.horaSegundos(m.ts)}</span>
        </div>
        <p className="small cb-msg-texto">{m.texto}</p>
      </div>
    </div>
  );
}

function Atendimento({
  detalhe,
  podeOperar,
  online,
  aoFeito,
  aoEncerrar,
}: {
  detalhe: ExecucaoDetalhe;
  podeOperar: boolean;
  online: boolean;
  aoFeito: (texto: string) => void;
  aoEncerrar: () => void;
}) {
  const id = detalhe.linha.id;
  const primeiro = fmt.primeiroNome(detalhe.linha.usuario.nome);
  const [texto, setTexto] = useState('');
  const assumir = useAcao(() => api.post(`/execucoes/${encodeURIComponent(id)}/assumir`));
  const responder = useAcao((t: string) => api.post(`/execucoes/${encodeURIComponent(id)}/responder`, { texto: t }));
  const aguardando = detalhe.estadoConversa === 'aguardando_pessoa';
  return (
    <section className="card" aria-labelledby="t-atendimento">
      <div className="card-head cb-card-head-wrap">
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <span className="avatar avatar-sm cb-avatar-pessoa" aria-hidden="true">
            <Icone nome="pessoa" tamanho="sm" />
          </span>
          <h2 className="h4" id="t-atendimento">
            {aguardando ? `${primeiro} quer falar com uma pessoa` : 'Conversa com uma pessoa do suporte'}
          </h2>
        </div>
        <span className={`badge ${aguardando ? 'badge-warning' : 'badge-info'}`}>
          {aguardando ? 'Aguardando alguém assumir' : 'Em atendimento'}
        </span>
      </div>
      <div className="card-body stack">
        {aguardando ? (
          <>
            <p className="small muted">
              O copiloto já enviou o resumo do caso. Ao assumir, {primeiro} vê no widget que você entrou na conversa e o copiloto
              para de responder.
            </p>
            {podeOperar ? (
              <div className="row wrap">
                <button
                  className={`btn btn-primary${assumir.enviando ? ' is-loading' : ''}`}
                  type="button"
                  disabled={!online || assumir.enviando}
                  onClick={async () => {
                    if ((await assumir.executar()) !== undefined) aoFeito('Você assumiu a conversa.');
                  }}
                >
                  Assumir conversa
                </button>
                <ErroAcao erro={assumir.erro} />
              </div>
            ) : (
              <p className="small muted">Seu perfil não permite atender conversas.</p>
            )}
          </>
        ) : podeOperar ? (
          <form
            className="cb-resposta"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const t = texto.trim();
              if (!t) return;
              if ((await responder.executar(t)) !== undefined) {
                setTexto('');
                aoFeito(`Resposta enviada para ${primeiro}.`);
              }
            }}
          >
            <label className="label" htmlFor="resposta">
              Responder a {primeiro}
            </label>
            <textarea
              id="resposta"
              className="textarea"
              value={texto}
              maxLength={2000}
              placeholder="Escreva como você falaria com a pessoa."
              onChange={(e) => setTexto(e.target.value)}
            />
            <div className="row wrap between">
              <ErroAcao erro={responder.erro} />
              <div className="row wrap" style={{ marginLeft: 'auto' }}>
                <button className="btn btn-ghost" type="button" disabled={!online} onClick={aoEncerrar}>
                  Encerrar atendimento
                </button>
                <button
                  className={`btn btn-primary${responder.enviando ? ' is-loading' : ''}`}
                  type="submit"
                  disabled={!online || !texto.trim() || responder.enviando}
                >
                  <Icone nome="enviar" />
                  Enviar resposta
                </button>
              </div>
            </div>
          </form>
        ) : (
          <p className="small muted">A conversa está com o suporte. Seu perfil só permite acompanhar.</p>
        )}
      </div>
    </section>
  );
}

function DialogoAcao<R>({
  titulo,
  texto,
  campo,
  rotulo,
  perigo,
  aoFechar,
  executar,
  aoConcluir,
}: {
  titulo: string;
  texto: string;
  campo?: { rotulo: string; placeholder?: string; inicial?: string; obrigatorio: boolean; limite: number; ajuda?: string };
  rotulo: string;
  perigo?: boolean;
  aoFechar: () => void;
  executar: (valor: string) => Promise<R>;
  aoConcluir: (r: R | undefined) => void | Promise<void>;
}) {
  const [valor, setValor] = useState(campo?.inicial ?? '');
  const acao = useAcao(executar);
  const online = useOnline();
  const vazio = !!campo?.obrigatorio && !valor.trim();
  const enviar = async () => {
    const r = await acao.executar(valor.trim());
    if (r !== undefined) await aoConcluir(r);
  };
  return (
    <Modal
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <button className="btn btn-secondary" type="button" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            className={`btn ${perigo ? 'btn-danger' : 'btn-primary'}${acao.enviando ? ' is-loading' : ''}`}
            type="button"
            aria-busy={acao.enviando}
            disabled={acao.enviando || vazio || !online}
            onClick={() => void enviar()}
          >
            {rotulo}
          </button>
        </>
      }
    >
      <p className="small muted">{texto}</p>
      {campo ? (
        <div className="field">
          <label htmlFor="dialogo-campo">{campo.rotulo}</label>
          <textarea
            id="dialogo-campo"
            className="textarea"
            value={valor}
            maxLength={campo.limite}
            placeholder={campo.placeholder}
            onChange={(e) => setValor(e.target.value)}
          />
          <span className="help">
            {campo.ajuda ? `${campo.ajuda} ` : ''}
            {valor.length} de {fmt.numero(campo.limite)} caracteres.
          </span>
        </div>
      ) : null}
      <ErroAcao erro={acao.erro as ErroApiCliente | null} />
    </Modal>
  );
}

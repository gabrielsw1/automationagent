// Plano e créditos (S5): o plano da empresa, os créditos do ciclo e para onde foram, as faturas e a
// forma de pagamento. Comprar pacote, recarga automática, mudar de plano e dados de cobrança abrem
// janelas. Só o Admin vê (a Starta no modo suporte vê sem mudar nada); na demonstração, os números
// são de exemplo e as compras ficam desligadas. Nada de valor inventado: preço que a Starta ainda
// não definiu aparece como "Sob consulta" e desliga o que depende dele.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  cnpjValido,
  fmt,
  nomeCompetencia,
  precoEmReais,
  resumoFatura,
  ROTULO_STATUS_FATURA,
  SOB_CONSULTA,
  type DadosCobranca,
  type DestaqueConserto,
  type Fatura,
  type MetodoPagamento,
  type PacoteComprado,
  type PedidoMudancaPlano,
  type Plano,
  type PlanoECreditos,
  type RecargaAutomatica,
  type StatusFatura,
  type UsoCiclo,
} from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useAcao, useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo, Segmentado } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { useOnline } from '../../componentes/pagina.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import './plano.css';

const n = (v: number) => fmt.numero(Math.round(v));
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FORMATO_MES = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
/** "2026-10" de uma data ISO, no fuso de São Paulo. */
const competenciaDe = (iso: string) => FORMATO_MES.format(new Date(iso));
/** Último dia de um ciclo cujo fim (exclusivo) é `fim`. */
const ultimoDia = (fim: string) => new Date(Date.parse(fim) - 1);
/** "outubro de 2026" → "outubro". */
const soMes = (competencia: string) => nomeCompetencia(competencia).split(' de ')[0];

/** "financeiro@empresa.com.br" → "fin•••••@empresa.com.br". */
export function mascararEmail(email: string): string {
  const [usuario, dominio] = email.split('@');
  if (!dominio) return email;
  return `${usuario.slice(0, 3)}•••••@${dominio}`;
}

const SITUACAO: Record<PlanoECreditos['situacao'], { rotulo: string; classe: string }> = {
  ativo: { rotulo: 'Ativo', classe: 'badge-success' },
  piloto: { rotulo: 'Em piloto', classe: 'badge-info' },
  implantacao: { rotulo: 'Em implantação', classe: 'badge-warning' },
  pausado: { rotulo: 'Pausado', classe: 'badge-danger' },
};

const SELO_STATUS: Record<StatusFatura, string> = {
  aberta: 'badge-outline',
  emitida: 'badge-info',
  paga: 'badge-success',
  vencida: 'badge-danger',
  cancelada: 'badge-outline',
};

function usuariosDoPlano(p: Plano): string {
  if (p.usuariosMax === null) return `Mais de ${n(p.usuariosMin - 1)}`;
  if (p.usuariosMin <= 1) return `Até ${n(p.usuariosMax)}`;
  return `De ${n(p.usuariosMin)} a ${n(p.usuariosMax)}`;
}

type Janela = null | 'pacote' | 'recarga' | 'mudar' | 'cobranca';

export default function PaginaPlano() {
  const estado = useApi<PlanoECreditos>('/plano');
  const [janela, setJanela] = useState<Janela>(null);
  const toast = useToast();
  const { recarregarResumo } = useSessao();

  if (estado.erro && !estado.dados) {
    return <EstadoErro erro={estado.erro} titulo="Não conseguimos carregar o plano e os créditos" aoTentar={() => void estado.recarregar()} />;
  }
  const p = estado.dados;
  if (!p) return <Carregando forma="painel" texto="Carregando o plano e os créditos" />;

  const fechar = () => setJanela(null);
  const depois = async (mensagem?: string) => {
    fechar();
    if (mensagem) toast.sucesso(mensagem);
    await estado.recarregar();
    // A faixa de gasto do topo depende dos créditos extras.
    void recarregarResumo();
  };

  return (
    <div className="cq-pagina">
      <div className="page-head">
        <div className="stack-sm">
          <h1 className="h1">Plano e créditos</h1>
          <p className="muted body-lg">O que você assina, quanto já usou e para onde foi cada crédito.</p>
        </div>
        {p.exemplo ? (
          <span className="badge badge-warning" title="Empresa de demonstração: números de exemplo, sem compras nem cobrança.">
            <Icone nome="info" tamanho="sm" />
            Dados de exemplo
          </span>
        ) : null}
      </div>

      {p.motivoSomenteLeitura && !p.exemplo ? (
        <Aviso tipo="info" papel="status">
          {p.motivoSomenteLeitura}
        </Aviso>
      ) : null}

      <div className="grid-2">
        <CartaoPlano p={p} aoMudar={() => setJanela('mudar')} />
        <CartaoCreditos p={p} aoComprar={() => setJanela('pacote')} aoRecarga={() => setJanela('recarga')} />
      </div>

      <OndeForam p={p} />

      <div className="split">
        <Faturas p={p} />
        <FormaPagamento p={p} aoAlterar={() => setJanela('cobranca')} aoMudou={(c) => estado.definir((d) => (d ? { ...d, cobranca: c } : d))} />
      </div>

      <JanelaPacote aberto={janela === 'pacote'} p={p} aoFechar={fechar} aoComprar={(r) => void depois(r.mensagem)} />
      <JanelaRecarga aberto={janela === 'recarga'} p={p} aoFechar={fechar} aoSalvar={(r) => void depois(r.ligada ? 'Recarga automática ligada.' : 'Recarga automática desligada.')} />
      <JanelaMudar aberto={janela === 'mudar'} p={p} aoFechar={fechar} aoEnviar={() => void depois('Pedido enviado. A Starta confirma a mudança com você.')} />
      <JanelaCobranca aberto={janela === 'cobranca'} p={p} aoFechar={fechar} aoSalvar={() => void depois('Dados de cobrança salvos.')} />
    </div>
  );
}

// ---------- Plano atual ----------

function CartaoPlano({ p, aoMudar }: { p: PlanoECreditos; aoMudar: () => void }) {
  const plano = p.plano;
  const situacao = SITUACAO[p.situacao];
  const pedido = p.pedidoMudanca && p.pedidoMudanca.planoId !== plano?.id ? p.pedidoMudanca : null;
  const preco = plano ? precoEmReais(plano.precoMensalCentavos) : null;
  return (
    <section className="card" aria-labelledby="t-plano">
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="eyebrow">Plano atual</span>
          <h2 id="t-plano" className="h2">
            {plano?.nome ?? 'Sem plano'}
          </h2>
        </div>
        <span className={`badge ${situacao.classe}`}>
          <span className="dot" />
          {situacao.rotulo}
        </span>
      </div>
      <div className="card-body stack">
        {plano ? (
          <>
            <p>
              {preco ? (
                <>
                  <span className="strong cq-preco num">{preco}</span>
                  <span className="muted">/mês</span>
                </>
              ) : (
                <>
                  <span className="strong cq-preco">{SOB_CONSULTA}</span>
                  <span className="small muted cq-preco-nota">A Starta ainda não definiu a mensalidade deste plano.</span>
                </>
              )}
            </p>
            <dl className="kv cq-kv">
              <dt>Usuários</dt>
              <dd>
                {usuariosDoPlano(plano)}{' '}
                <span className="muted cq-peso-normal">
                  · {n(p.usuariosMes)} {p.usuariosMes === 1 ? 'usou' : 'usaram'} o assistente este mês
                </span>
              </dd>
              <dt>Créditos incluídos</dt>
              <dd className="num">{plano.creditosIncluidos === null ? 'Sob medida, sem teto por mês' : `${n(plano.creditosIncluidos)} por mês`}</dd>
              <dt>Crédito extra</dt>
              <dd>{precoEmReais(plano.precoCreditoExtraCentavos) ? `${precoEmReais(plano.precoCreditoExtraCentavos)} por crédito` : SOB_CONSULTA}</dd>
              <dt>Renova em</dt>
              <dd className="num">{fmt.data(p.renovaEm)}</dd>
            </dl>
            {plano.usuariosMax !== null ? (
              <p className="small muted">
                Se passar de {n(plano.usuariosMax)} usuários, avisamos e sugerimos o plano seguinte. Nada muda sem a sua confirmação.
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted">A Starta define o plano com vocês ao fim da implantação. Até lá, as tarefas não têm teto de créditos.</p>
        )}
        {pedido ? (
          <p className="small cq-pedido" role="status">
            <Icone nome="relogio" tamanho="sm" />
            <span>
              Pedido enviado em {fmt.diaMes(pedido.em)}
              {pedido.planoNome ? ` (plano ${pedido.planoNome})` : ''}; a Starta confirma com você.
            </span>
          </p>
        ) : null}
      </div>
      <div className="card-foot cq-foot-entre">
        <Link className="small" to="/site#planos">
          Comparar planos
        </Link>
        <Botao onClick={aoMudar}>Mudar de plano</Botao>
      </div>
    </section>
  );
}

// ---------- Créditos do ciclo ----------

function CartaoCreditos({ p, aoComprar, aoRecarga }: { p: PlanoECreditos; aoComprar: () => void; aoRecarga: () => void }) {
  const c = p.ciclo;
  const total = c.incluidos === null ? null : c.incluidos + c.pacotes;
  const preco = precoEmReais(p.plano?.precoCreditoExtraCentavos ?? null);
  const pctRoteiro = total ? Math.min(100, (c.creditosRoteiro / total) * 100) : 0;
  const pctConserto = total ? Math.min(100 - pctRoteiro, (c.creditosConserto / total) * 100) : 0;
  const pct = total ? Math.round((c.usados / total) * 100) : 0;
  const pendente = p.pacote.pendente;
  const acabou = c.restantes !== null && c.restantes <= 0;
  const valorExtras = c.valorExtrasCentavos === null ? null : precoEmReais(c.valorExtrasCentavos);

  return (
    <section className="card" aria-labelledby="t-cred">
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="eyebrow">Créditos do ciclo</span>
          <h2 id="t-cred" className="h2 num">
            {n(c.usados)} <span className="h4 muted">{total === null ? 'usados' : `de ${n(total)} usados`}</span>
          </h2>
        </div>
        <span className="small muted num">
          {fmt.diaMes(c.inicio)} a {fmt.diaMes(ultimoDia(c.fim))}
        </span>
      </div>
      <div className="card-body stack">
        <div className="stack-sm">
          {total !== null ? (
            <div
              className="progress cq-barra"
              role="progressbar"
              aria-label="Créditos usados no ciclo"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={Math.min(c.usados, total)}
              aria-valuetext={`${n(c.usados)} de ${n(total)} créditos, ${pct}%`}
            >
              <span style={{ width: `${pctRoteiro}%` }} />
              <span className="cq-barra-conserto" style={{ width: `${pctConserto}%` }} />
            </div>
          ) : null}
          <div className="row wrap between tiny">
            <span className="row wrap" style={{ gap: 'var(--s-4)' }}>
              <span className="row" style={{ gap: 6 }}>
                <span aria-hidden="true" className="cq-legenda" />
                <span className="num">Pelo roteiro: {n(c.creditosRoteiro)}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span aria-hidden="true" className="cq-legenda cq-legenda-conserto" />
                <span className="num">Com conserto visual: {n(c.creditosConserto)}</span>
              </span>
            </span>
            <span className="muted num">
              {c.restantes === null
                ? `Sem teto · renova em ${fmt.diaMes(c.fim)}`
                : c.restantes > 0
                  ? `Restam ${n(c.restantes)} · renova em ${fmt.diaMes(c.fim)}`
                  : `${n(c.extras)} extras · renova em ${fmt.diaMes(c.fim)}`}
            </span>
          </div>
          {c.pacotes > 0 ? (
            <span className="tiny muted">
              {n(c.incluidos ?? 0)} do plano + {n(c.pacotes)} de pacotes pagos neste ciclo.
            </span>
          ) : null}
        </div>

        {acabou ? (
          <div className="alert alert-warning" role="status">
            <Icone nome="alerta" />
            <div className="stack-sm" style={{ gap: 2 }}>
              <span className="strong">Os créditos do mês acabaram</span>
              <span className="small">
                {preco
                  ? `As tarefas seguem como crédito extra a ${preco}${valorExtras ? ` (${valorExtras} até agora)` : ''}, até o limite mensal de ${fmt.moeda(p.limiteMensal)} definido em `
                  : 'As tarefas estão pausadas até chegarem mais créditos: a Starta ainda não definiu o preço do crédito do seu plano. Veja o limite em '}
                <Link to="/equipe">Equipe e limites</Link>.
              </span>
            </div>
          </div>
        ) : c.acabaEm && c.porDia ? (
          <div className="alert alert-warning" role="status">
            <Icone nome="alerta" />
            <div className="stack-sm" style={{ gap: 2 }}>
              <span className="strong">No ritmo atual, os créditos acabam em {fmt.diaMes(c.acabaEm)}</span>
              <span className="small">
                Vocês usam cerca de {n(c.porDia)} {Math.round(c.porDia) === 1 ? 'crédito' : 'créditos'} por dia.{' '}
                {preco ? (
                  <>
                    Depois disso, cada tarefa vira crédito extra a {preco}, até o limite mensal definido em <Link to="/equipe">Equipe e limites</Link>.
                  </>
                ) : (
                  'Depois disso, as tarefas param até chegarem mais créditos: a Starta ainda não definiu o preço do crédito do seu plano.'
                )}
              </span>
            </div>
          </div>
        ) : null}

        {pendente ? (
          <Aviso
            tipo="info"
            papel="status"
            titulo={`Pacote de ${n(pendente.creditos ?? 0)} créditos aguardando pagamento`}
            acoes={
              pendente.urlPagamento ? (
                <a className="btn btn-secondary btn-sm" href={pendente.urlPagamento} target="_blank" rel="noopener noreferrer">
                  <Icone nome="externo" tamanho="sm" />
                  Pagar agora
                </a>
              ) : null
            }
          >
            {precoEmReais(pendente.totalCentavos)}
            {pendente.gateway === 'manual' ? '. A equipe Starta envia a cobrança por e-mail.' : '.'} Os créditos entram assim que o pagamento for confirmado.
          </Aviso>
        ) : null}

        <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
          <Botao variante="primario" icone="mais" onClick={aoComprar}>
            Comprar pacote
          </Botao>
          <Botao icone="atualizar" onClick={aoRecarga}>
            {p.recarga.ligada ? 'Recarga automática ligada' : 'Ativar recarga automática'}
          </Botao>
        </div>
        {p.recarga.ligada && p.recarga.limite ? (
          <span className="tiny muted">
            Compra um pacote de {n(p.pacote.creditos)} créditos quando restarem menos de {n(p.recarga.limite)}.
          </span>
        ) : null}
      </div>
    </section>
  );
}

// ---------- Para onde foram os créditos ----------

function OndeForam({ p }: { p: PlanoECreditos }) {
  const [periodo, setPeriodo] = useState<'atual' | 'anterior'>('atual');
  const uso: UsoCiclo = periodo === 'atual' ? p.uso.atual : p.uso.anterior;
  const mes = soMes(uso.competencia);
  const descricao =
    periodo === 'atual'
      ? `Ciclo de ${mes} até hoje, ${fmt.data(new Date())}.`
      : `Ciclo de ${mes}, de ${fmt.diaMes(uso.inicio)} a ${fmt.diaMes(ultimoDia(uso.ate))}.`;
  return (
    <section className="stack" aria-labelledby="t-onde">
      <div className="row between wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 id="t-onde" className="h3">
            Para onde foram os créditos
          </h2>
          <p className="small muted">{descricao} Conversas e dúvidas não aparecem porque não gastam crédito.</p>
        </div>
        <Segmentado
          rotulo="Período"
          valor={periodo}
          aoTrocar={setPeriodo}
          opcoes={[
            { valor: 'atual', rotulo: 'Este ciclo' },
            { valor: 'anterior', rotulo: 'Ciclo anterior' },
          ]}
        />
      </div>
      {uso.tarefas.length === 0 ? (
        <div className="card cq-vazio">
          <p className="small muted">
            {periodo === 'atual' ? 'Nenhuma tarefa gastou crédito neste ciclo ainda.' : 'Nenhuma tarefa gastou crédito no ciclo anterior.'} Cada execução
            concluída gasta 1 crédito pelo roteiro gravado, ou 5 quando o conserto visual precisa ajustar um passo.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table cq-tabela">
            <thead>
              <tr>
                <th scope="col">Tarefa</th>
                <th scope="col" className="t-right">
                  Execuções
                </th>
                <th scope="col" className="t-right">
                  Pelo roteiro <span className="cq-th-nota">(1 crédito)</span>
                </th>
                <th scope="col" className="t-right">
                  Com conserto visual <span className="cq-th-nota">(5 créditos)</span>
                </th>
                <th scope="col" className="t-right">
                  Total de créditos
                </th>
              </tr>
            </thead>
            <tbody>
              {uso.tarefas.map((t) => (
                <tr key={t.tarefaId ?? t.nome} className={t.consertoFrequente ? 'cq-linha-aviso' : undefined}>
                  <td className="cq-col-tarefa">
                    {t.consertoFrequente ? (
                      <div className="row wrap" style={{ gap: 8 }}>
                        <span className="strong">{t.nome}</span>
                        <span className="badge badge-warning">
                          <Icone nome="alerta" tamanho="sm" />
                          Conserto frequente
                        </span>
                      </div>
                    ) : (
                      <span className="strong">{t.nome}</span>
                    )}
                  </td>
                  <td className="t-right num">{n(t.execucoes)}</td>
                  <td className="t-right num">{n(t.roteiro)}</td>
                  <td className={`t-right num${t.consertoFrequente ? ' strong text-warning' : ''}`}>{n(t.conserto)}</td>
                  <td className="t-right num strong">{n(t.creditos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="t-right num strong">{n(uso.total.execucoes)}</td>
                <td className="t-right num strong">{n(uso.total.roteiro)}</td>
                <td className="t-right num strong">{n(uso.total.conserto)}</td>
                <td className="t-right num strong">{n(uso.total.creditos)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {uso.destaque ? <Destaque d={uso.destaque} /> : null}
    </section>
  );
}

function Destaque({ d }: { d: DestaqueConserto }) {
  const pct = Math.round(d.fracaoCiclo * 100);
  return (
    <div className="card row-top wrap cq-destaque">
      <span aria-hidden="true" className="cq-destaque-icone">
        <Icone nome="copiloto" />
      </span>
      <div className="stack-sm grow cq-destaque-texto">
        <span className="h4">“{d.nome}” gastou mais por conserto visual</span>
        <span className="small cq-tinta-suave">
          A tela usada por essa tarefa mudou em {fmt.diaMes(d.primeiroConserto)} e, desde então, {n(d.consertos)} das {n(d.execucoes)} execuções precisaram do
          conserto visual. Foram {n(d.creditosConserto)} créditos com conserto, {pct}% de tudo o que vocês usaram no ciclo. Com o roteiro atualizado, essas
          execuções teriam custado {n(d.creditosPeloRoteiro)} {d.creditosPeloRoteiro === 1 ? 'crédito' : 'créditos'}.
        </span>
        <Link className="small strong row" style={{ gap: 4 }} to={`/execucoes/${encodeURIComponent(d.execucaoId)}`}>
          Ver a execução <span className="mono">{d.execucaoId}</span>
          <Icone nome="seta-direita" tamanho="sm" />
        </Link>
      </div>
      <div className="stack-sm cq-destaque-acao">
        <Link className="btn btn-primary" to={d.fluxoId ? `/aprender/${encodeURIComponent(d.fluxoId)}` : `/tarefas/${encodeURIComponent(d.tarefaId)}`}>
          <Icone nome="aprender" tamanho="sm" />
          Regravar o fluxo
        </Link>
        <span className="tiny muted">Regravar o fluxo reduz o gasto: volta a 1 crédito por execução.</span>
      </div>
    </div>
  );
}

// ---------- Faturas ----------

function Faturas({ p }: { p: PlanoECreditos }) {
  const aberta = p.faturaAberta;
  const nada = !aberta && p.faturas.length === 0;
  const cnpj = p.cobranca.cnpj ?? p.empresa.cnpj;
  return (
    <section className="main-col stack" aria-labelledby="t-fat">
      <h2 id="t-fat" className="h3">
        Faturas
      </h2>
      {nada ? (
        <div className="card cq-vazio">
          <p className="small muted">Nenhuma fatura ainda. A primeira fecha no fim do mês em que o plano começar.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table cq-tabela">
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col">Itens</th>
                <th scope="col" className="t-right">
                  Valor
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="t-right">
                  Arquivo
                </th>
              </tr>
            </thead>
            <tbody>
              {aberta ? (
                <tr>
                  <td className="strong cq-sem-quebra">{maiuscula(nomeCompetencia(aberta.competencia))}</td>
                  <td className="small muted">
                    {resumoFatura({ tipo: 'mensal', itens: aberta.itens, creditos: null })} · fecha em {fmt.diaMes(aberta.fechaEm)}
                  </td>
                  <td className="t-right num cq-sem-quebra">{precoEmReais(aberta.totalCentavos) ?? SOB_CONSULTA}</td>
                  <td>
                    <span className="badge badge-outline">Aberta</span>
                  </td>
                  <td className="t-right">
                    <span className="small muted cq-sem-quebra">Disponível em {fmt.diaMes(aberta.disponivelEm)}</span>
                  </td>
                </tr>
              ) : null}
              {p.faturas.map((f) => (
                <LinhaFatura key={f.id} f={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.pagamentos.notaFiscal ? (
        <p className="tiny muted">
          Nota fiscal emitida para {p.cobranca.razaoSocial ?? p.empresa.nome}
          {cnpj ? `, CNPJ ${cnpj}` : ''}, junto com cada fatura paga.
        </p>
      ) : null}
    </section>
  );
}

function LinhaFatura({ f }: { f: Fatura }) {
  const mes = f.competencia ? nomeCompetencia(f.competencia) : nomeCompetencia(competenciaDe(f.criadoEm));
  const itens =
    f.tipo === 'pacote'
      ? `${resumoFatura(f)} · comprado em ${fmt.diaMes(f.criadoEm)}${f.automatica ? ' pela recarga automática' : ''}`
      : resumoFatura(f);
  const aPagar = f.status === 'emitida' || f.status === 'vencida';
  return (
    <tr>
      <td className="strong cq-sem-quebra">{maiuscula(mes)}</td>
      <td className="small muted">{itens}</td>
      <td className="t-right num cq-sem-quebra">{precoEmReais(f.totalCentavos) ?? SOB_CONSULTA}</td>
      <td>
        <span className={`badge ${SELO_STATUS[f.status]}${f.status === 'cancelada' ? ' muted' : ''}`}>
          {f.status === 'paga' ? <span className="dot" /> : null}
          {ROTULO_STATUS_FATURA[f.status]}
        </span>
        {aPagar && f.vencimento ? (
          <span className="tiny muted cq-vence">
            {f.status === 'vencida' ? 'venceu' : 'vence'} em {fmt.diaMes(`${f.vencimento}T12:00:00Z`)}
          </span>
        ) : null}
      </td>
      <td className="t-right">
        <div className="row cq-arquivos">
          <a className="btn btn-ghost btn-sm" href={`/api/console/plano/faturas/${encodeURIComponent(f.id)}/pdf`} target="_blank" rel="noopener" aria-label={`Baixar PDF da fatura de ${mes}`}>
            <Icone nome="baixar" tamanho="sm" />
            PDF
          </a>
          {aPagar && f.urlPagamento ? (
            <a className="btn btn-ghost btn-sm" href={f.urlPagamento} target="_blank" rel="noopener noreferrer" aria-label={`Pagar a fatura de ${mes}`}>
              <Icone nome="externo" tamanho="sm" />
              Pagar
            </a>
          ) : null}
          {aPagar && f.urlBoleto ? (
            <a className="btn btn-ghost btn-sm" href={f.urlBoleto} target="_blank" rel="noopener noreferrer" aria-label={`Boleto da fatura de ${mes}`}>
              Boleto
            </a>
          ) : null}
          {f.urlNotaFiscal ? (
            <a className="btn btn-ghost btn-sm" href={f.urlNotaFiscal} target="_blank" rel="noopener noreferrer" aria-label={`Nota fiscal da fatura de ${mes}`}>
              Nota fiscal
            </a>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// ---------- Forma de pagamento ----------

function FormaPagamento({ p, aoAlterar, aoMudou }: { p: PlanoECreditos; aoAlterar: () => void; aoMudou: (c: DadosCobranca) => void }) {
  const toast = useToast();
  const online = useOnline();
  const c = p.cobranca;
  const salvar = useAcao((metodo: MetodoPagamento) => api.put<DadosCobranca>('/plano/metodo', { metodo }));
  const manual = p.pagamentos.modo === 'manual';
  const trocar = async (metodo: MetodoPagamento) => {
    if (metodo === c.metodo) return;
    const r = await salvar.executar(metodo);
    if (r) {
      aoMudou(r);
      toast.sucesso(metodo === 'cartao' ? 'As próximas cobranças vão para o cartão de crédito.' : 'As próximas cobranças vão por boleto.');
    }
  };
  const desativado = !p.podeAlterar || !online || salvar.enviando;
  const cartaoTexto = c.cartao
    ? `•••• •••• •••• ${c.cartao.final}${c.cartao.validade ? ` · validade ${c.cartao.validade}` : c.cartao.bandeira ? ` · ${c.cartao.bandeira}` : ''}`
    : manual
      ? 'A equipe Starta combina o pagamento por cartão com vocês.'
      : 'Nenhum cartão salvo. Na próxima cobrança, vocês pagam na página segura do Asaas e o cartão fica guardado.';
  return (
    <section className="side-col card" aria-labelledby="t-pag">
      <div className="card-head">
        <h2 id="t-pag" className="h4">
          Forma de pagamento
        </h2>
      </div>
      <fieldset className="card-body stack-sm cq-fieldset" disabled={desativado} title={p.motivoSomenteLeitura ?? undefined}>
        <legend className="sr-only">Forma de pagamento</legend>
        <label className={`row-top cq-opcao${c.metodo === 'boleto' ? ' on' : ''}`} htmlFor="pag-boleto">
          <input id="pag-boleto" type="radio" name="pagamento" checked={c.metodo === 'boleto'} onChange={() => void trocar('boleto')} />
          <span className="stack-sm" style={{ gap: 0 }}>
            <span className="strong">Boleto bancário</span>
            <span className="small muted">
              {c.emailCobranca
                ? `Enviado para ${mascararEmail(c.emailCobranca)} 10 dias antes do vencimento`
                : 'Falta o e-mail de cobrança: preencha em Alterar dados de cobrança.'}
            </span>
          </span>
        </label>
        <label className={`row-top cq-opcao${c.metodo === 'cartao' ? ' on' : ''}`} htmlFor="pag-cartao">
          <input id="pag-cartao" type="radio" name="pagamento" checked={c.metodo === 'cartao'} onChange={() => void trocar('cartao')} />
          <span className="stack-sm" style={{ gap: 0 }}>
            <span className="strong">Cartão de crédito</span>
            <span className={`small muted${c.cartao ? ' mono' : ''}`}>{cartaoTexto}</span>
          </span>
        </label>
        {salvar.erro ? <p className="small text-danger">{salvar.erro.message}</p> : null}
        {manual ? (
          <p className="tiny muted cq-nota-manual">
            Por enquanto, a equipe Starta envia cada cobrança por e-mail e confirma o pagamento por aqui.
          </p>
        ) : null}
      </fieldset>
      <div className="card-foot">
        <Botao tamanho="sm" onClick={aoAlterar}>
          Alterar dados de cobrança
        </Botao>
      </div>
    </section>
  );
}

// ---------- Janelas ----------

function MotivoSomenteLeitura({ p }: { p: PlanoECreditos }) {
  return p.motivoSomenteLeitura ? (
    <Aviso tipo="info" papel="status">
      {p.motivoSomenteLeitura}
    </Aviso>
  ) : null;
}

function ErroDaAcao({ erro }: { erro: ErroApiCliente | null }) {
  return erro ? (
    <Aviso tipo="erro" papel="alert">
      {erro.message}
    </Aviso>
  ) : null;
}

function JanelaPacote({ aberto, p, aoFechar, aoComprar }: { aberto: boolean; p: PlanoECreditos; aoFechar: () => void; aoComprar: (r: PacoteComprado) => void }) {
  const online = useOnline();
  const comprar = useAcao(() => api.post<PacoteComprado>('/plano/pacotes'));
  const { creditos, precoCentavos, pendente } = p.pacote;
  const precoCredito = precoEmReais(p.plano?.precoCreditoExtraCentavos ?? null);
  const c = p.cobranca;
  const impedimento = !p.plano
    ? 'A empresa ainda não tem plano. A Starta define o plano junto com vocês.'
    : precoCentavos === null
      ? 'A Starta ainda não definiu o preço do crédito do seu plano. Fale com a Starta para comprar créditos.'
      : pendente
        ? `Já há um pacote de ${n(pendente.creditos ?? 0)} créditos aguardando pagamento. Os créditos entram quando ele for pago.`
        : null;
  const como =
    p.pagamentos.modo === 'manual'
      ? `A equipe Starta envia a cobrança${c.emailCobranca ? ` para ${c.emailCobranca}` : ' por e-mail'}.`
      : c.metodo === 'cartao' && c.cartao && p.pagamentos.cartaoGuardado
        ? `Cobramos no cartão final ${c.cartao.final}.`
        : c.metodo === 'cartao'
          ? 'Você paga com cartão na página segura do Asaas.'
          : `Geramos um boleto${c.emailCobranca ? `, enviado também para ${c.emailCobranca}` : ''}.`;
  const fechar = () => {
    comprar.limparErro();
    aoFechar();
  };
  return (
    <Modal
      aberto={aberto}
      titulo="Comprar pacote de créditos"
      descricao="Créditos a mais para este ciclo, somados aos incluídos no plano."
      aoFechar={fechar}
      travado={comprar.enviando}
      rodape={
        <>
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao
            variante="primario"
            carregando={comprar.enviando}
            disabled={!!impedimento || !p.podeAlterar || !online}
            onClick={async () => {
              const r = await comprar.executar();
              if (r) aoComprar(r);
            }}
          >
            {precoCentavos === null ? 'Comprar pacote' : `Comprar por ${precoEmReais(precoCentavos)}`}
          </Botao>
        </>
      }
    >
      <div className="stack">
        <MotivoSomenteLeitura p={p} />
        {p.plano ? (
          <dl className="kv cq-kv">
            <dt>Pacote</dt>
            <dd className="num">{n(creditos)} créditos</dd>
            <dt>Preço</dt>
            <dd>{precoCentavos === null ? SOB_CONSULTA : `${precoEmReais(precoCentavos)} (${precoCredito} por crédito)`}</dd>
            <dt>Vale</dt>
            <dd>Neste ciclo, até {fmt.data(ultimoDia(p.ciclo.fim))}</dd>
          </dl>
        ) : null}
        {impedimento ? (
          <Aviso tipo="aviso">{impedimento}</Aviso>
        ) : (
          <p className="small muted">{como} Os créditos entram assim que o pagamento for confirmado.</p>
        )}
        <ErroDaAcao erro={comprar.erro} />
      </div>
    </Modal>
  );
}

function JanelaRecarga({ aberto, p, aoFechar, aoSalvar }: { aberto: boolean; p: PlanoECreditos; aoFechar: () => void; aoSalvar: (r: RecargaAutomatica) => void }) {
  const online = useOnline();
  const padrao = p.recarga.limite ?? Math.max(1, Math.round((p.plano?.creditosIncluidos ?? 1000) * 0.1));
  const [limite, setLimite] = useState(String(padrao));
  useEffect(() => {
    if (aberto) setLimite(String(padrao));
  }, [aberto, padrao]);
  const salvar = useAcao((corpo: RecargaAutomatica) => api.put<RecargaAutomatica>('/plano/recarga', corpo));
  const numero = Number(limite.replace(/\D/g, ''));
  const erroLimite = limite.trim() === '' || !Number.isInteger(numero) || numero < 1 ? 'Diga com quantos créditos restantes comprar um pacote.' : null;
  const cartao = p.pagamentos.cartaoGuardado ? p.cobranca.cartao : null;
  const precoPacote = precoEmReais(p.pacote.precoCentavos);
  const impedimento = !p.plano
    ? 'A empresa ainda não tem plano.'
    : p.pacote.precoCentavos === null
      ? 'A Starta ainda não definiu o preço do crédito do seu plano, então ainda não dá para comprar pacotes.'
      : p.plano.creditosIncluidos === null
        ? 'Seu plano não tem teto de créditos: a recarga não é necessária.'
        : p.pagamentos.modo === 'manual'
          ? 'A recarga automática precisa de cobrança por cartão, que a Starta ainda não ligou. Por enquanto, compre pacotes quando precisar.'
          : !cartao
            ? 'A recarga automática precisa de um cartão salvo. Escolha cartão de crédito em Forma de pagamento e pague uma fatura com ele: o cartão fica guardado no Asaas.'
            : null;
  const fechar = () => {
    salvar.limparErro();
    aoFechar();
  };
  const enviar = async (ligada: boolean) => {
    const r = await salvar.executar({ ligada, limite: ligada ? numero : (p.recarga.limite ?? null) });
    if (r) aoSalvar(r);
  };
  const podeLigar = !impedimento && p.podeAlterar && online && !erroLimite;
  return (
    <Modal
      aberto={aberto}
      titulo="Recarga automática"
      descricao="Compra um pacote sozinha quando os créditos estão acabando, para as tarefas não pararem."
      aoFechar={fechar}
      travado={salvar.enviando}
      rodape={
        <>
          <Botao onClick={fechar}>Cancelar</Botao>
          {p.recarga.ligada ? (
            <Botao variante="perigo" disabled={!p.podeAlterar || !online || salvar.enviando} onClick={() => void enviar(false)}>
              Desligar
            </Botao>
          ) : null}
          <Botao variante="primario" carregando={salvar.enviando} disabled={!podeLigar} onClick={() => void enviar(true)}>
            {p.recarga.ligada ? 'Salvar' : 'Ativar recarga'}
          </Botao>
        </>
      }
    >
      <div className="stack">
        <MotivoSomenteLeitura p={p} />
        {impedimento ? <Aviso tipo="aviso">{impedimento}</Aviso> : null}
        <Campo
          rotulo="Comprar quando restarem menos de"
          erro={!impedimento ? erroLimite : null}
          ajuda={
            cartao && precoPacote
              ? `Compra ${n(p.pacote.creditos)} créditos por ${precoPacote} no cartão final ${cartao.final}. No máximo um pacote fica aguardando pagamento por vez.`
              : `Cada recarga compra um pacote de ${n(p.pacote.creditos)} créditos.`
          }
        >
          {(props) => (
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <input
                {...props}
                className={`${props.className} num cq-input-curto`}
                type="text"
                inputMode="numeric"
                value={limite}
                disabled={!!impedimento || !p.podeAlterar}
                onChange={(e) => setLimite(e.target.value)}
              />
              <span className="small muted">créditos</span>
            </div>
          )}
        </Campo>
        <ErroDaAcao erro={salvar.erro} />
      </div>
    </Modal>
  );
}

function JanelaMudar({ aberto, p, aoFechar, aoEnviar }: { aberto: boolean; p: PlanoECreditos; aoFechar: () => void; aoEnviar: (r: PedidoMudancaPlano) => void }) {
  const online = useOnline();
  const outros = p.planos.filter((x) => x.id !== p.plano?.id);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState('');
  useEffect(() => {
    if (aberto) {
      setEscolhido(null);
      setMensagem('');
    }
  }, [aberto]);
  const enviar = useAcao((corpo: { planoId: string; mensagem?: string }) => api.post<PedidoMudancaPlano>('/plano/mudanca', corpo));
  const fechar = () => {
    enviar.limparErro();
    aoFechar();
  };
  return (
    <Modal
      aberto={aberto}
      titulo="Mudar de plano"
      descricao="Nada muda agora: a Starta recebe o pedido e confirma com você antes de trocar o plano."
      aoFechar={fechar}
      largura={640}
      travado={enviar.enviando}
      rodape={
        <>
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao
            variante="primario"
            carregando={enviar.enviando}
            disabled={!escolhido || !p.podeAlterar || !online}
            onClick={async () => {
              if (!escolhido) return;
              const r = await enviar.executar({ planoId: escolhido, mensagem: mensagem.trim() || undefined });
              if (r) aoEnviar(r);
            }}
          >
            Enviar pedido
          </Botao>
        </>
      }
    >
      <div className="stack">
        <MotivoSomenteLeitura p={p} />
        <fieldset className="stack-sm cq-fieldset">
          <legend className="small strong cq-legend">Para qual plano?</legend>
          {p.plano ? (
            <div className="cq-plano-opcao cq-plano-atual">
              <span className="stack-sm" style={{ gap: 0 }}>
                <span className="strong">
                  {p.plano.nome} <span className="badge badge-outline">Plano atual</span>
                </span>
                <span className="small muted">{resumoPlano(p.plano)}</span>
              </span>
            </div>
          ) : null}
          {outros.map((x) => (
            <label key={x.id} className={`row-top cq-opcao cq-plano-opcao${escolhido === x.id ? ' on' : ''}`} htmlFor={`plano-${x.id}`}>
              <input id={`plano-${x.id}`} type="radio" name="novo-plano" checked={escolhido === x.id} onChange={() => setEscolhido(x.id)} disabled={!p.podeAlterar} />
              <span className="stack-sm grow" style={{ gap: 0 }}>
                <span className="row between wrap" style={{ gap: 'var(--s-2)' }}>
                  <span className="strong">{x.nome}</span>
                  <span className="small strong num">{precoEmReais(x.precoMensalCentavos) ? `${precoEmReais(x.precoMensalCentavos)}/mês` : SOB_CONSULTA}</span>
                </span>
                <span className="small muted">{resumoPlano(x)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Campo rotulo="Mensagem para a Starta" classe="textarea" ajuda="Opcional. Ex.: quando quer mudar e quantas pessoas vão usar.">
          {(props) => (
            <textarea {...props} rows={3} maxLength={2000} value={mensagem} disabled={!p.podeAlterar} onChange={(e) => setMensagem(e.target.value)} />
          )}
        </Campo>
        <p className="small">
          <Link to="/site#planos">Comparar planos no site</Link>
        </p>
        <ErroDaAcao erro={enviar.erro} />
      </div>
    </Modal>
  );
}

function resumoPlano(x: Plano): string {
  const partes = [
    `${usuariosDoPlano(x)} usuários`,
    x.creditosIncluidos === null ? 'créditos sob medida' : `${n(x.creditosIncluidos)} créditos por mês`,
    precoEmReais(x.precoCreditoExtraCentavos) ? `crédito extra a ${precoEmReais(x.precoCreditoExtraCentavos)}` : `crédito extra ${SOB_CONSULTA.toLowerCase()}`,
  ];
  return partes.join(' · ');
}

function JanelaCobranca({ aberto, p, aoFechar, aoSalvar }: { aberto: boolean; p: PlanoECreditos; aoFechar: () => void; aoSalvar: (c: DadosCobranca) => void }) {
  const online = useOnline();
  const c = p.cobranca;
  const inicial = () => ({
    razaoSocial: c.razaoSocial ?? '',
    cnpj: c.cnpj ?? p.empresa.cnpj ?? '',
    emailCobranca: c.emailCobranca ?? '',
    cep: c.cep ?? '',
    numero: c.numero ?? '',
  });
  const [form, setForm] = useState(inicial);
  const [tentou, setTentou] = useState(false);
  useEffect(() => {
    if (aberto) {
      setForm(inicial());
      setTentou(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  const salvar = useAcao((corpo: object) => api.put<DadosCobranca>('/plano/cobranca', corpo));
  const erros = {
    razaoSocial: form.razaoSocial.trim().length < 2 ? 'Digite a razão social.' : null,
    cnpj: !cnpjValido(form.cnpj) ? 'Esse CNPJ não é válido. Confira os números.' : null,
    emailCobranca: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.emailCobranca.trim()) ? 'Digite um e-mail válido, por exemplo financeiro@empresa.com.br.' : null,
    cep: form.cep.trim() && form.cep.replace(/\D/g, '').length !== 8 ? 'O CEP tem 8 números.' : null,
  };
  const valido = !Object.values(erros).some(Boolean);
  const mostrar = (k: keyof typeof erros) => (tentou ? erros[k] : null);
  const fechar = () => {
    salvar.limparErro();
    aoFechar();
  };
  const bloqueado = !p.podeAlterar;
  return (
    <Modal
      aberto={aberto}
      titulo="Dados de cobrança"
      descricao={
        p.pagamentos.modo === 'asaas'
          ? 'Vão para as faturas, o boleto e a nota fiscal. O cartão nunca é digitado aqui: ele fica guardado no Asaas quando vocês pagam com ele.'
          : 'Vão para as faturas que a equipe Starta envia por e-mail.'
      }
      aoFechar={fechar}
      travado={salvar.enviando}
      rodape={
        <>
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao
            variante="primario"
            carregando={salvar.enviando}
            disabled={bloqueado || !online}
            onClick={async () => {
              setTentou(true);
              if (!valido) return;
              const r = await salvar.executar({
                razaoSocial: form.razaoSocial.trim(),
                cnpj: form.cnpj.trim(),
                emailCobranca: form.emailCobranca.trim(),
                cep: form.cep.trim() || undefined,
                numero: form.numero.trim() || undefined,
                metodo: c.metodo,
              });
              if (r) aoSalvar(r);
            }}
          >
            Salvar dados
          </Botao>
        </>
      }
    >
      <fieldset className="stack cq-fieldset" disabled={bloqueado}>
        <legend className="sr-only">Dados de cobrança</legend>
        <MotivoSomenteLeitura p={p} />
        <Campo rotulo="Razão social" obrigatorio erro={mostrar('razaoSocial')}>
          {(props) => <input {...props} value={form.razaoSocial} maxLength={200} autoComplete="organization" onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} />}
        </Campo>
        <Campo rotulo="CNPJ" obrigatorio erro={mostrar('cnpj')}>
          {(props) => <input {...props} value={form.cnpj} inputMode="numeric" placeholder="00.000.000/0000-00" onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />}
        </Campo>
        <Campo rotulo="E-mail de cobrança" obrigatorio erro={mostrar('emailCobranca')} ajuda="Recebe o boleto, os avisos de pagamento e a nota fiscal.">
          {(props) => <input {...props} type="email" value={form.emailCobranca} autoComplete="email" onChange={(e) => setForm({ ...form, emailCobranca: e.target.value })} />}
        </Campo>
        <div className="cq-dupla">
          <Campo rotulo="CEP" erro={mostrar('cep')}>
            {(props) => <input {...props} value={form.cep} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" onChange={(e) => setForm({ ...form, cep: e.target.value })} />}
          </Campo>
          <Campo rotulo="Número do endereço">
            {(props) => <input {...props} value={form.numero} maxLength={20} onChange={(e) => setForm({ ...form, numero: e.target.value })} />}
          </Campo>
        </div>
        <ErroDaAcao erro={salvar.erro} />
      </fieldset>
    </Modal>
  );
}

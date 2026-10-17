// Plataforma › Empresas clientes (S7): resumo, lista com métricas dos últimos 30 dias (nunca o
// conteúdo) e o painel da empresa aberta. A empresa aberta e a busca ficam no endereço
// (?empresa=, ?busca=), para Saúde dos fluxos e Implantações abrirem direto nela.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CONSERTOS_PARA_QUEBRADO, fmt, type LinhaEmpresaStarta, type ResumoPlataforma } from '@copiloto/shared';
import { Abas } from '../../componentes/Abas.tsx';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { BuscaEmpresa } from './Busca.tsx';
import { useSessaoStarta } from './contexto.tsx';
import { ModalNovaEmpresa } from './ModaisEmpresa.tsx';
import { PainelEmpresa } from './PainelEmpresa.tsx';
import { listaE, Numero, plural, SeloDemo, SeloSituacao } from './pecas.tsx';

type Filtro = 'todas' | 'ativas' | 'implantacao' | 'pausadas';

const FILTROS: Record<Filtro, (e: LinhaEmpresaStarta) => boolean> = {
  todas: () => true,
  ativas: (e) => e.situacao === 'ativo' || e.situacao === 'piloto',
  implantacao: (e) => e.situacao === 'implantacao',
  pausadas: (e) => e.situacao === 'pausado',
};

const VAZIO: Record<Filtro, string> = {
  todas: 'Nenhuma empresa ainda. Use “Nova empresa” para criar a primeira.',
  ativas: 'Nenhuma empresa ativa ou em piloto.',
  implantacao: 'Nenhuma empresa em implantação.',
  pausadas: 'Nenhuma empresa pausada.',
};

/** Abaixo disso, a taxa de sucesso aparece em amarelo (como no design). */
const SUCESSO_BAIXO = 0.95;

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Busca por nome, responsável, plano ou CNPJ (com ou sem pontuação; a partir de 3 dígitos). */
function achou(e: LinhaEmpresaStarta, busca: string): boolean {
  if ([e.nome, e.responsavel?.nome ?? '', e.plano?.nome ?? ''].some((t) => semAcento(t).includes(busca))) return true;
  const digitos = busca.replace(/\D/g, '');
  return digitos.length >= 3 && /^[\d./\s-]+$/.test(busca) && !!e.cnpj?.includes(digitos);
}

function Resumo({ resumo }: { resumo: ResumoPlataforma }) {
  const alem = [
    resumo.emImplantacao ? `${fmt.numero(resumo.emImplantacao)} em implantação` : null,
    resumo.pausadas ? `${fmt.numero(resumo.pausadas)} ${resumo.pausadas === 1 ? 'pausada' : 'pausadas'}` : null,
  ].filter((x): x is string => !!x);
  const margem = resumo.margemPorCredito;
  return (
    <section className="grid-kpi" aria-label="Resumo das empresas">
      <div className="card kpi">
        <span className="kpi-label">Empresas ativas</span>
        <span className="kpi-value">{fmt.numero(resumo.ativas)}</span>
        <span className="kpi-delta muted cp-peso-normal">{alem.length ? `Mais ${listaE(alem)}` : 'Nenhuma em implantação ou pausada'}</span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Em piloto</span>
        <span className="kpi-value">{fmt.numero(resumo.emPiloto.total)}</span>
        <span className="kpi-delta muted cp-peso-normal">{resumo.emPiloto.total ? listaE(resumo.emPiloto.nomes) : 'Nenhuma empresa em piloto agora'}</span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Execuções em 30 dias</span>
        <span className="kpi-value">{fmt.numero(resumo.execucoes30d)}</span>
        <span className="kpi-delta muted cp-peso-normal">Soma das empresas ativas</span>
      </div>
      <div className="card kpi">
        <span className="kpi-label">Margem por crédito</span>
        <span className={`kpi-value${margem !== null && margem < 0 ? ' text-danger' : ''}`}>{margem === null ? '—' : fmt.moeda(margem)}</span>
        <span className="kpi-delta muted cp-peso-normal">
          {margem === null
            ? 'Preço do crédito menos navegador e IA. Aparece quando todas as empresas com uso tiverem um plano com preço do crédito.'
            : 'Preço do crédito menos navegador e IA'}
        </span>
      </div>
    </section>
  );
}

function Saude({ e }: { e: LinhaEmpresaStarta }) {
  if (e.situacao === 'pausado') {
    return <span className="small muted cp-sem-quebra cp-quebra-cheia">{e.suspensaEm ? `Pausado em ${fmt.diaMes(e.suspensaEm)}` : 'Pausado'}</span>;
  }
  if (e.fluxosQuebrados > 0) {
    return (
      <span className={`badge ${e.fluxosQuebrados > 1 ? 'badge-danger' : 'badge-warning'}`}>
        {e.fluxosQuebrados === 1 ? '1 quebrado' : `${fmt.numero(e.fluxosQuebrados)} quebrados`}
      </span>
    );
  }
  if (e.execucoes30d === 0) return <span className="small muted cp-sem-quebra">Sem produção</span>;
  return (
    <span className="badge badge-success">
      <span className="dot" />
      Tudo certo
    </span>
  );
}

function TarefasAtivas({ e }: { e: LinhaEmpresaStarta }) {
  const extra =
    e.tarefasAtivas > 0 ? null : e.tarefasEmTeste > 0 ? `(${fmt.numero(e.tarefasEmTeste)} em teste)` : e.tarefasPausadas > 0 ? `(${plural(e.tarefasPausadas, 'pausada', 'pausadas')})` : null;
  return (
    <span className={e.tarefasAtivas === 0 && e.situacao === 'pausado' ? 'muted' : undefined}>
      {fmt.numero(e.tarefasAtivas)}
      {extra ? <span className="tiny muted"> {extra}</span> : null}
    </span>
  );
}

function TabelaEmpresas({ linhas, aberta, aoAbrir, vazio }: { linhas: LinhaEmpresaStarta[]; aberta: string | null; aoAbrir: (id: string) => void; vazio: string }) {
  // Sem o painel aberto, a lista ocupa a largura toda: os títulos quebram em duas linhas para caber sem rolar.
  return (
    <div className={`table-wrap cp-tabela-empresas${aberta ? '' : ' cp-tabela-cheia'}`}>
      <table className="table" aria-label="Empresas clientes">
        <thead>
          <tr>
            <th scope="col">Empresa</th>
            <th scope="col">Status</th>
            <th scope="col">Plano</th>
            <th scope="col" className="t-right">
              Usuários
            </th>
            <th scope="col" className="t-right">
              Tarefas ativas
            </th>
            <th scope="col" className="t-right">
              Execuções 30&nbsp;d
            </th>
            <th scope="col" className="t-right">
              Sucesso
            </th>
            <th scope="col" className="t-right">
              Créditos usados
            </th>
            <th scope="col">Saúde</th>
            <th scope="col">Responsável Starta</th>
            <th scope="col" className="t-right">
              <span className="sr-only">Ação</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td colSpan={11} className="muted small ca-tabela-vazia">
                {vazio}
              </td>
            </tr>
          ) : null}
          {linhas.map((e) => {
            const eAberta = e.id === aberta;
            const parada = e.situacao === 'pausado' || e.situacao === 'implantacao';
            return (
              <tr key={e.id} aria-current={eAberta ? 'true' : undefined} className={`ca-linha-clicavel${eAberta ? ' cp-linha-aberta' : ''}`} onClick={(ev) => {
                if ((ev.target as HTMLElement).closest('a, button')) return;
                aoAbrir(e.id);
              }}>
                <td>
                  <div className="row cp-empresa-nome">
                    <span className={`avatar avatar-sm${e.situacao === 'pausado' ? ' cp-avatar-pausado' : ''}`} aria-hidden="true">
                      {e.iniciais}
                    </span>
                    {e.demo ? (
                      <span className="stack-sm" style={{ gap: 2 }}>
                        <span className="strong">{e.nome}</span>
                        <SeloDemo />
                      </span>
                    ) : (
                      <span className="strong">{e.nome}</span>
                    )}
                  </div>
                </td>
                <td>
                  <SeloSituacao situacao={e.situacao} />
                </td>
                <td className="small cp-sem-quebra">{e.plano?.nome ?? <span className="muted">Sem plano</span>}</td>
                <td className="t-right num">{e.usuarios === 0 && e.situacao === 'implantacao' ? <span className="muted">—</span> : <Numero valor={e.usuarios} />}</td>
                <td className="t-right num cp-sem-quebra">
                  <TarefasAtivas e={e} />
                </td>
                <td className="t-right num">{parada && e.execucoes30d === 0 ? <span className="muted">0</span> : fmt.numero(e.execucoes30d)}</td>
                <td className={`t-right num${e.sucesso30d !== null && e.sucesso30d < SUCESSO_BAIXO ? ' text-warning strong' : ''}`}>
                  {e.sucesso30d === null ? <span className="muted">—</span> : fmt.percentual(e.sucesso30d)}
                </td>
                <td className="t-right num">{parada && e.creditos30d === 0 ? <span className="muted">0</span> : fmt.numero(e.creditos30d)}</td>
                <td>
                  <Saude e={e} />
                </td>
                <td className="small cp-sem-quebra cp-quebra-cheia">{e.responsavel?.nome ?? <span className="muted">Sem responsável</span>}</td>
                <td className="t-right">
                  {eAberta ? (
                    <span className="small strong text-brand">Aberta</span>
                  ) : (
                    <Botao variante="fantasma" tamanho="sm" aria-label={`Abrir ${e.nome}`} onClick={() => aoAbrir(e.id)}>
                      Abrir
                    </Botao>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Empresas() {
  const { painel, atualizar } = useSessaoStarta();
  const [params, setParams] = useSearchParams();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [criando, setCriando] = useState(false);
  const aberta = params.get('empresa');
  const busca = semAcento((params.get('busca') ?? '').trim());

  const abrir = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('empresa', id);
        else n.delete('empresa');
        return n;
      },
      { replace: !id },
    );

  // No celular o painel fica embaixo da lista: leva até ele ao abrir.
  useEffect(() => {
    if (!aberta) return;
    const el = document.getElementById('painel-empresa');
    if (el && typeof el.scrollIntoView === 'function' && window.matchMedia?.('(max-width: 760px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [aberta]);

  const empresas = painel.dados?.empresas;
  const contagem = useMemo(() => {
    const c = { todas: 0, ativas: 0, implantacao: 0, pausadas: 0 } as Record<Filtro, number>;
    for (const e of empresas ?? []) for (const f of Object.keys(FILTROS) as Filtro[]) if (FILTROS[f](e)) c[f]++;
    return c;
  }, [empresas]);
  const linhas = useMemo(() => (empresas ?? []).filter((e) => FILTROS[filtro](e) && (!busca || achou(e, busca))), [empresas, filtro, busca]);
  const linhaAberta = empresas?.find((e) => e.id === aberta);

  return (
    <>
      <div className="page-head">
        <div className="stack-sm ca-cabecalho-texto">
          <h1 className="h1">Empresas clientes</h1>
          <p className="muted body-lg">Quem usa o Copiloto, como está a implantação e onde os fluxos estão dando trabalho.</p>
        </div>
        <div className="row wrap ca-cabecalho-acoes">
          <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
            Nova empresa
          </Botao>
        </div>
      </div>

      <div className="alert" role="note">
        <Icone nome="cadeado" />
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="strong">Aqui você vê métricas, não conteúdo</span>
          <span className="small">
            Conversas, prints e dados dos clientes de cada empresa ficam no espaço dela. Para ver uma execução, use “Entrar como suporte”: o acesso fica
            registrado na auditoria da empresa e ela é avisada.
          </span>
        </div>
      </div>

      {painel.dados ? (
        <>
          <Resumo resumo={painel.dados.resumo} />
          <div className="split">
            <section className="main-col stack" aria-labelledby="t-lista">
              <h2 id="t-lista" className="sr-only">
                Lista de empresas
              </h2>
              <BuscaEmpresa id="busca-plataforma-celular" classe="cp-so-celular" />
              <Abas<Filtro>
                rotulo="Filtrar por status"
                ativa={filtro}
                aoTrocar={setFiltro}
                abas={[
                  { chave: 'todas', rotulo: 'Todas', selo: <span className="badge cp-selo-aba">{contagem.todas}</span> },
                  { chave: 'ativas', rotulo: 'Ativas', selo: <span className="badge cp-selo-aba">{contagem.ativas}</span> },
                  { chave: 'implantacao', rotulo: 'Implantação', selo: <span className="badge cp-selo-aba">{contagem.implantacao}</span> },
                  { chave: 'pausadas', rotulo: 'Pausadas', selo: <span className="badge cp-selo-aba">{contagem.pausadas}</span> },
                ]}
              />
              <div id={`painel-${filtro}`} role="tabpanel" aria-labelledby={`aba-${filtro}`}>
                <TabelaEmpresas
                  linhas={linhas}
                  aberta={aberta}
                  aoAbrir={abrir}
                  vazio={busca ? `Nenhuma empresa encontrada para “${params.get('busca')?.trim()}”.` : VAZIO[filtro]}
                />
              </div>
              <p className="tiny muted">
                Execuções, sucesso e créditos dos últimos 30 dias, até {fmt.data(painel.dados.resumo.ate)}. “Quebrado” é um fluxo em que o roteiro falhou e o
                agente visual consertou mais de {fmt.numero(CONSERTOS_PARA_QUEBRADO)} vezes no período.
              </p>
            </section>
            {aberta ? (
              <PainelEmpresa
                key={aberta}
                id={aberta}
                linha={linhaAberta}
                aoFechar={() => abrir(null)}
                aoMudar={atualizar}
              />
            ) : null}
          </div>
        </>
      ) : painel.erro ? (
        <EstadoErro erro={painel.erro} aoTentar={() => void painel.recarregar()} titulo="Não conseguimos carregar as empresas" />
      ) : (
        <Carregando forma="painel" texto="Carregando as empresas clientes…" />
      )}

      <ModalNovaEmpresa
        aberto={criando}
        aoFechar={() => setCriando(false)}
        aoCriar={(id) => {
          atualizar();
          abrir(id);
        }}
      />
    </>
  );
}

// Catálogo de tarefas (C2): o que o copiloto sabe fazer, com status, números de 30 dias,
// pedidos que ficaram sem tarefa e o botão "Nova tarefa".
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, type ListaTarefas as Lista, type PedidoSemTarefa, type StatusTarefa, type TarefaResumo } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { CabecalhoPagina, Segmentado } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { ItemMenu, Menu } from '../../componentes/Menu.tsx';
import { SeloCaminho, SeloStatusTarefa } from '../../componentes/Selos.tsx';
import { usePode } from '../../componentes/sessao.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import ModalDescrever from './ModalDescrever.tsx';
import './tarefas.css';

type Filtro = 'todas' | StatusTarefa;

function semAcento(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Texto inicial do "Descrever a tarefa" a partir de um tema pedido. */
export function textoParaTema(p: PedidoSemTarefa | { tema: string; exemplos?: string[] }): string {
  const tema = p.tema.trim();
  const exemplos = (p.exemplos ?? []).slice(0, 3).map((e) => `“${e}”`);
  return `${tema.charAt(0).toUpperCase()}${tema.slice(1)}.${exemplos.length ? ` Pedidos que a equipe já fez: ${exemplos.join(', ')}.` : ''} `;
}

function NovaTarefa({ aoDescrever }: { aoDescrever: () => void }) {
  return (
    <Menu
      largura={340}
      botao={(p) => (
        <Botao variante="primario" icone="mais" iconeDepois="seta-baixo" {...p}>
          Nova tarefa
        </Botao>
      )}
    >
      {(fechar) => (
        <>
          <ItemMenu
            destaque
            icone="chat"
            titulo="Descrever a tarefa"
            descricao="Escreva em português o que ela faz. O copiloto monta a ficha e liga na API do seu sistema."
            aoClicar={() => {
              fechar();
              aoDescrever();
            }}
          />
          <ItemMenu
            icone="aprender"
            titulo="Gravar o fluxo na tela"
            descricao="Para telas sem API. Você faz a tarefa uma vez e o copiloto aprende os passos."
            para="/aprender"
            aoClicar={fechar}
          />
        </>
      )}
    </Menu>
  );
}

function SugestaoSemTarefa({
  pedidos,
  podeEditar,
  aoCriar,
  aoIgnorado,
}: {
  pedidos: PedidoSemTarefa[];
  podeEditar: boolean;
  aoCriar: (p: PedidoSemTarefa) => void;
  aoIgnorado: (tema: string) => void;
}) {
  const toast = useToast();
  const [verTodos, setVerTodos] = useState(false);
  const [ignorando, setIgnorando] = useState<string | null>(null);
  const lista = verTodos ? pedidos : pedidos.slice(0, 1);
  const ignorar = async (tema: string) => {
    setIgnorando(tema);
    try {
      await api.post('/tarefas/sem-tarefa/ignorar', { tema });
      aoIgnorado(tema);
      toast.sucesso(`Pedidos sobre “${tema}” ignorados. Eles não aparecem mais aqui nem no painel.`);
    } catch (e) {
      toast.erro((e as ErroApiCliente).message);
    } finally {
      setIgnorando(null);
    }
  };
  return (
    <section className="stack-sm" aria-label="Pedidos sem tarefa">
      {lista.map((p, i) => (
        <div key={p.tema} className="card card-pad ct-sugestao">
          <div className="row wrap" style={{ gap: 'var(--s-4)' }}>
            <span className="badge badge-accent ct-sugestao-icone" aria-hidden="true">
              <Icone nome="chat" />
            </span>
            <div className="grow stack-sm ct-sugestao-texto" style={{ gap: 2 }}>
              <p className="strong" id={`sugestao-${i}`}>
                {p.quantidade === 1
                  ? `1 pedido sobre “${p.tema}” nos últimos 30 dias, e não há tarefa para isso.`
                  : `${fmt.numero(p.quantidade)} pedidos sobre “${p.tema}” nos últimos 30 dias, e não há tarefa para isso.`}
              </p>
              <p className="small muted">
                {p.exemplos.length ? `Exemplos: ${p.exemplos.map((e) => `“${e}”`).join(', ')}. ` : ''}
                Hoje o copiloto explica que não faz isso e oferece falar com uma pessoa.
              </p>
            </div>
            {podeEditar ? (
              <div className="row">
                <Botao variante="fantasma" tamanho="sm" carregando={ignorando === p.tema} onClick={() => void ignorar(p.tema)} aria-describedby={`sugestao-${i}`}>
                  Ignorar
                </Botao>
                <Botao variante="secundario" tamanho="sm" icone="mais" onClick={() => aoCriar(p)} aria-describedby={`sugestao-${i}`}>
                  Criar tarefa
                </Botao>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {pedidos.length > 1 ? (
        <button type="button" className="btn btn-ghost btn-sm ct-ver-mais" onClick={() => setVerTodos((v) => !v)} aria-expanded={verTodos}>
          {verTodos ? 'Mostrar só o mais pedido' : `Ver mais ${pedidos.length - 1} ${pedidos.length - 1 === 1 ? 'tema pedido' : 'temas pedidos'} sem tarefa`}
        </button>
      ) : null}
    </section>
  );
}

export default function ListaTarefas() {
  const navegar = useNavigate();
  const podeEditar = usePode('editar');
  const [params, setParams] = useSearchParams();
  const { dados, erro, recarregar, definir } = useApi<Lista>('/tarefas');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [descrever, setDescrever] = useState<{ texto: string } | null>(null);

  // /tarefas?criar=<tema> (vem do painel): abre "Descrever a tarefa" já com o tema.
  const criar = params.get('criar');
  useEffect(() => {
    if (!criar || !dados || !podeEditar) return;
    const p = dados.semTarefa.find((x) => x.tema === criar);
    setDescrever({ texto: textoParaTema(p ?? { tema: criar }) });
    const novo = new URLSearchParams(params);
    novo.delete('criar');
    setParams(novo, { replace: true });
  }, [criar, dados, podeEditar, params, setParams]);

  const linhas = useMemo(() => {
    if (!dados) return [];
    const q = semAcento(busca.trim());
    return dados.tarefas.filter(
      (t) => (filtro === 'todas' || t.status === filtro) && (!q || semAcento(`${t.nome} ${t.descricao}`).includes(q)),
    );
  }, [dados, filtro, busca]);

  const cabecalho = (
    <CabecalhoPagina
      titulo="Tarefas"
      subtitulo="O copiloto só executa o que está nesta lista."
      acoes={podeEditar ? <NovaTarefa aoDescrever={() => setDescrever({ texto: '' })} /> : null}
    />
  );
  const modal = <ModalDescrever aberto={!!descrever} textoInicial={descrever?.texto ?? ''} aoFechar={() => setDescrever(null)} />;

  if (erro && !dados) {
    return (
      <>
        {cabecalho}
        <EstadoErro erro={erro} aoTentar={() => void recarregar()} titulo="Não conseguimos carregar as tarefas" />
      </>
    );
  }
  if (!dados) {
    return (
      <>
        {cabecalho}
        <Carregando forma="tabela" texto="Carregando as tarefas" />
      </>
    );
  }

  const { contagem } = dados;
  if (dados.tarefas.length === 0) {
    return (
      <>
        {cabecalho}
        {dados.semTarefa.length > 0 ? (
          <SugestaoSemTarefa
            pedidos={dados.semTarefa}
            podeEditar={podeEditar}
            aoCriar={(p) => setDescrever({ texto: textoParaTema(p) })}
            aoIgnorado={(tema) => definir((d) => d && { ...d, semTarefa: d.semTarefa.filter((x) => x.tema !== tema) })}
          />
        ) : null}
        <div className="card">
          <EstadoVazio
            icone="tarefas"
            titulo="Crie a primeira tarefa"
            texto="Tarefas são o que o copiloto sabe fazer no seu sistema. Enquanto não houver nenhuma, ele só responde dúvidas."
            acao={
              podeEditar ? (
                <div className="stack-sm ct-vazio-acoes">
                  <button type="button" className="btn btn-secondary btn-block ct-opcao" onClick={() => setDescrever({ texto: '' })}>
                    <Icone nome="api" />
                    <span className="stack-sm" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <span>Conectar pela API</span>
                      <span className="tiny muted ca-peso-medio">Mais rápido e estável, se o sistema tiver API</span>
                    </span>
                  </button>
                  <Link className="btn btn-secondary btn-block ct-opcao" to="/aprender">
                    <Icone nome="aprender" />
                    <span className="stack-sm" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <span>Gravar o fluxo na tela</span>
                      <span className="tiny muted ca-peso-medio">Você faz uma vez e o copiloto aprende</span>
                    </span>
                  </Link>
                </div>
              ) : (
                <p className="small muted">Peça a um Admin ou Editor de tarefas para criar a primeira.</p>
              )
            }
          />
        </div>
        {modal}
      </>
    );
  }

  const filtros: { valor: Filtro; rotulo: string; n: number }[] = [
    { valor: 'todas', rotulo: 'Todas', n: contagem.todas },
    { valor: 'ativa', rotulo: 'Ativas', n: contagem.ativa },
    { valor: 'teste', rotulo: 'Em teste', n: contagem.teste },
    { valor: 'rascunho', rotulo: 'Rascunho', n: contagem.rascunho },
    { valor: 'inativa', rotulo: 'Inativas', n: contagem.inativa },
  ];
  const visiveis = filtros.filter((f) => f.valor === 'todas' || f.n > 0 || f.valor === filtro);

  return (
    <>
      {cabecalho}
      {dados.semTarefa.length > 0 ? (
        <SugestaoSemTarefa
          pedidos={dados.semTarefa}
          podeEditar={podeEditar}
          aoCriar={(p) => setDescrever({ texto: textoParaTema(p) })}
          aoIgnorado={(tema) => definir((d) => d && { ...d, semTarefa: d.semTarefa.filter((x) => x.tema !== tema) })}
        />
      ) : null}

      <div className="stack">
        <div className="row between wrap">
          <div className="search ct-busca">
            <label className="sr-only" htmlFor="busca-tarefa">
              Buscar tarefa
            </label>
            <Icone nome="busca" />
            <input
              className="input"
              id="busca-tarefa"
              type="search"
              placeholder="Buscar por nome ou descrição"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Segmentado<Filtro>
            rotulo="Filtrar por status"
            valor={filtro}
            aoTrocar={setFiltro}
            opcoes={visiveis.map((f) => ({
              valor: f.valor,
              rotulo: (
                <>
                  {f.rotulo} <span className="num">{f.n}</span>
                </>
              ),
            }))}
          />
        </div>

        <Tabela<TarefaResumo>
          rotulo="Tarefas do copiloto"
          linhas={linhas}
          chave={(t) => t.id}
          aoClicarLinha={(t) => navegar(`/tarefas/${t.id}`)}
          vazio={
            <span className="stack-sm" style={{ alignItems: 'center' }}>
              <span>Nenhuma tarefa com {busca.trim() ? `“${busca.trim()}”` : 'este status'}.</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setBusca('');
                  setFiltro('todas');
                }}
              >
                <Icone nome="fechar" tamanho="sm" />
                Limpar filtros
              </button>
            </span>
          }
          colunas={[
            {
              titulo: 'Tarefa',
              celula: (t) => (
                <div className="stack-sm" style={{ gap: 2 }}>
                  <Link className="strong ct-nome" to={`/tarefas/${t.id}`}>
                    {t.nome}
                  </Link>
                  <span className="small muted">
                    {t.descricao}
                    {t.status === 'teste' && t.liberadaPara > 0
                      ? ` Liberada para ${t.liberadaPara} ${t.liberadaPara === 1 ? 'pessoa' : 'pessoas'}.`
                      : ''}
                  </span>
                </div>
              ),
            },
            { titulo: 'Caminho', celula: (t) => <SeloCaminho caminho={t.caminho} /> },
            {
              titulo: 'Status',
              celula: (t) => (
                <div className="stack-sm" style={{ gap: 4, alignItems: 'flex-start' }}>
                  <SeloStatusTarefa status={t.status} />
                  {t.temRascunho && t.versaoPublicada ? <span className="tiny muted">Rascunho em edição</span> : null}
                  {t.falhasHoje > 0 ? (
                    <span className="tiny text-danger strong">
                      {t.falhasHoje} {t.falhasHoje === 1 ? 'falha hoje' : 'falhas hoje'}
                    </span>
                  ) : null}
                </div>
              ),
            },
            {
              titulo: 'Confirmação',
              celula: () => (
                <span className="row small" style={{ gap: 6 }}>
                  <Icone nome="cadeado" tamanho="sm" className="muted" />
                  Sempre
                </span>
              ),
            },
            {
              titulo: 'Execuções 30 dias',
              alinhar: 'direita',
              classe: (t) => `num${t.execucoes30d === 0 ? ' muted' : ''}`,
              celula: (t) => fmt.numero(t.execucoes30d),
            },
            {
              titulo: 'Sucesso',
              alinhar: 'direita',
              classe: (t) => (t.sucesso30d === null ? 'muted' : `num${t.sucesso30d < 0.9 ? ' text-warning strong' : ''}`),
              celula: (t) => (t.sucesso30d === null ? '—' : fmt.percentual(t.sucesso30d)),
            },
            {
              titulo: 'Atualizada em',
              celula: (t) => (
                <div className="stack-sm" style={{ gap: 0 }}>
                  <span className="num">{fmt.data(t.atualizadoEm)}</span>
                  {t.atualizadoPor ? <span className="tiny muted">{t.atualizadoPor}</span> : null}
                </div>
              ),
            },
            {
              titulo: 'Ações',
              tituloOculto: true,
              alinhar: 'direita',
              celula: (t) => (
                <Link className="btn btn-ghost btn-sm" to={`/tarefas/${t.id}`} aria-label={`Abrir ${t.nome}`}>
                  Abrir
                  <Icone nome="seta-direita" tamanho="sm" />
                </Link>
              ),
            },
          ]}
        />
        <p className="small muted">
          {contagem.todas === 1 ? '1 tarefa' : `${fmt.numero(contagem.todas)} tarefas`}. Pedidos fora desta lista são recusados com educação, e o copiloto
          oferece falar com uma pessoa.
        </p>
      </div>
      {modal}
    </>
  );
}

// Ficha da tarefa (C3): abas Ficha, Execução, Permissões, Testes e Histórico; barra com
// Salvar rascunho, Testar e Publicar; coluna com o resumo dos testes e a pré-visualização do
// copiloto usando o rascunho.
//
// Mudanças não salvas ficam guardadas neste navegador (copiloto:ficha:<id>) e voltam se a
// pessoa sair da página, recarregar ou perder a conexão.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  fmt,
  ROTULO_PERFIL,
  type CasoDeTeste,
  type RodadaTestes,
  type StatusTarefa,
  type TarefaDefinicao,
  type TarefaDetalhe,
} from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Abas } from '../../componentes/Abas.tsx';
import { Botao } from '../../componentes/Botao.tsx';
import { ChatDeTeste } from '../../componentes/ChatDeTeste.tsx';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { Aviso, CabecalhoPagina } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { ItemMenu, Menu } from '../../componentes/Menu.tsx';
import { Confirmar, Modal } from '../../componentes/Modal.tsx';
import { guardado, useAtrasado, useMigalhas, useOnline } from '../../componentes/pagina.tsx';
import { SeloStatusTarefa } from '../../componentes/Selos.tsx';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import AbaExecucao from './AbaExecucao.tsx';
import AbaFicha from './AbaFicha.tsx';
import AbaHistorico from './AbaHistorico.tsx';
import AbaPermissoes from './AbaPermissoes.tsx';
import AbaTestes, { ResumoTestes, type EstadoRodada } from './AbaTestes.tsx';
import { iguais, minuscula, proximaVersao, quandoAs } from './ficha.ts';
import './tarefas.css';

type ChaveAba = 'ficha' | 'execucao' | 'permissoes' | 'testes' | 'historico';
const ABAS: ChaveAba[] = ['ficha', 'execucao', 'permissoes', 'testes', 'historico'];

interface Guardado {
  /** JSON da base (rascunho ou publicada) sobre a qual as mudanças foram feitas. */
  base: string;
  def: TarefaDefinicao;
}

const chaveLocal = (id: string) => `copiloto:ficha:${id}`;

function baseDe(d: TarefaDetalhe | undefined): TarefaDefinicao | null {
  return d?.rascunho?.definicao ?? d?.publicada?.definicao ?? null;
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

function subtitulo(d: TarefaDetalhe, sujo: boolean): string {
  const p = d.publicada;
  const r = d.rascunho;
  let t: string;
  if (p) {
    t = `Versão ${p.versao} publicada${p.publicadoPor ? ` por ${p.publicadoPor}` : ''}${p.publicadoEm ? ` em ${fmt.data(p.publicadoEm)}` : ''}.`;
    if (r) {
      t +=
        r.alteracoes > 0
          ? ` Você tem ${plural(r.alteracoes, 'alteração', 'alterações')} no rascunho da versão ${r.versao}.`
          : ` Há um rascunho da versão ${r.versao}, ainda igual ao publicado.`;
    }
  } else if (r) {
    t = `Ainda não publicada. Rascunho salvo ${quandoAs(r.salvoEm)}.`;
  } else t = 'Ainda não publicada.';
  return sujo ? `${t} Há mudanças não salvas.` : t;
}

// ---------- Publicar ----------

function ModalPublicar({
  aberto,
  versao,
  detalhe,
  sujo,
  aoFechar,
  aoPublicar,
}: {
  aberto: boolean;
  versao: number;
  detalhe: TarefaDetalhe;
  sujo: boolean;
  aoFechar: () => void;
  /** Rejeita com a mensagem de erro. */
  aoPublicar: (resumo: string) => Promise<void>;
}) {
  const online = useOnline();
  const [resumo, setResumo] = useState('');
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const demorando = useAtrasado(publicando, 15000) && publicando;

  useEffect(() => {
    if (aberto) {
      setResumo('');
      setErro(null);
      setPublicando(false);
    }
  }, [aberto]);

  const publicar = async () => {
    setPublicando(true);
    setErro(null);
    try {
      await aoPublicar(resumo.trim());
    } catch (e) {
      setErro((e as Error).message);
      setPublicando(false);
    }
  };

  const rodada = detalhe.ultimaRodada;
  const def = baseDe(detalhe);
  const statusDepois: StatusTarefa =
    detalhe.status === 'rascunho' || detalhe.status === 'inativa' ? (def?.liberadaPara?.length ? 'teste' : 'ativa') : detalhe.status;

  return (
    <Modal
      aberto={aberto}
      titulo={`Publicar a versão ${versao}?`}
      descricao="O copiloto passa a usar esta versão nos próximos pedidos. Pedidos em andamento terminam com a versão anterior."
      aoFechar={aoFechar}
      travado={publicando}
      largura={540}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={publicando}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            carregando={publicando}
            disabled={!online}
            title={!online ? 'Sem conexão. Publicar volta quando a internet voltar.' : undefined}
            onClick={() => void publicar()}
          >
            {publicando ? 'Publicando, aguarde' : `Publicar versão ${versao}`}
          </Botao>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="resumo-publicacao">O que mudou (opcional)</label>
          <textarea
            id="resumo-publicacao"
            className="textarea"
            rows={3}
            maxLength={500}
            value={resumo}
            disabled={publicando}
            data-autofoco
            placeholder="Ex.: Prazo de pagamento agora aceita 60 dias."
            onChange={(e) => setResumo(e.target.value)}
          />
          <span className="help">Aparece no histórico. Se deixar vazio, o copiloto resume as mudanças.</span>
        </div>
        <ul className="stack-sm small ct-lista-limpa">
          {sujo ? (
            <li className="row-top" style={{ gap: 'var(--s-2)' }}>
              <Icone nome="info" tamanho="sm" />
              As mudanças desta tela ainda não salvas entram na publicação.
            </li>
          ) : null}
          {statusDepois !== detalhe.status ? (
            <li className="row-top" style={{ gap: 'var(--s-2)' }}>
              <Icone nome="info" tamanho="sm" />
              {statusDepois === 'teste'
                ? `A tarefa fica em teste, só para ${plural(def?.liberadaPara?.length ?? 0, 'pessoa liberada', 'pessoas liberadas')}.`
                : 'A tarefa fica ativa para os perfis que podem executar.'}
            </li>
          ) : null}
          {rodada && rodada.aprovados < rodada.total ? (
            <li className="row-top text-warning" style={{ gap: 'var(--s-2)' }}>
              <Icone nome="alerta" tamanho="sm" />
              Na última rodada, {rodada.aprovados} de {rodada.total} testes passaram.
            </li>
          ) : !rodada && detalhe.testes.length > 0 ? (
            <li className="row-top text-warning" style={{ gap: 'var(--s-2)' }}>
              <Icone nome="alerta" tamanho="sm" />
              Os testes ainda não rodaram com esta versão.
            </li>
          ) : null}
        </ul>
        {demorando ? (
          <p className="small muted" role="status">
            Está demorando mais que o normal. O servidor ainda está publicando; não feche esta janela.
          </p>
        ) : null}
        {erro ? (
          <Aviso tipo="erro" papel="alert" titulo="Não deu para publicar">
            {erro}
          </Aviso>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------- Página ----------

type Pendente =
  | { tipo: 'status'; status: Exclude<StatusTarefa, 'rascunho'> }
  | { tipo: 'descartar' }
  | null;

export default function FichaTarefa() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const online = useOnline();
  const { resumo, recarregarResumo } = useSessao();
  const podeEditar = usePode('editar');
  const det = useApi<TarefaDetalhe>(`/tarefas/${encodeURIComponent(id)}`);
  const d = det.dados;

  const abaUrl = params.get('aba') as ChaveAba | null;
  const aba: ChaveAba = abaUrl && ABAS.includes(abaUrl) ? abaUrl : 'ficha';
  const setAba = useCallback(
    (a: ChaveAba) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (a === 'ficha') n.delete('aba');
          else n.set('aba', a);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );

  // ----- Ficha local x base salva -----
  const base = baseDe(d);
  const baseJson = JSON.stringify(base);
  const [def, setDef] = useState<TarefaDefinicao | null>(null);
  const [recuperado, setRecuperado] = useState<'mesma' | 'antiga' | null>(null);
  const [antigo, setAntigo] = useState<TarefaDefinicao | null>(null);
  const ultimaBase = useRef<{ json: string; def: TarefaDefinicao } | null>(null);

  useEffect(() => {
    if (!base) return;
    const anterior = ultimaBase.current;
    if (anterior?.json === baseJson) return;
    ultimaBase.current = { json: baseJson, def: base };
    if (!anterior) {
      const salvo = guardado.ler<Guardado>(chaveLocal(id));
      if (salvo?.def && !iguais(salvo.def, base)) {
        if (salvo.base === baseJson) {
          setDef(salvo.def);
          setRecuperado('mesma');
          return;
        }
        setAntigo(salvo.def);
        setRecuperado('antiga');
      }
      setDef(base);
      return;
    }
    // A base mudou por fora (recarga, outra aba): adota a nova se não havia mudanças locais.
    setDef((atual) => (atual && !iguais(atual, anterior.def) ? atual : base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseJson, id]);

  const sujo = !!def && !!base && !iguais(def, base);

  useEffect(() => {
    if (!def || !base || recuperado === 'antiga') return;
    if (sujo) guardado.gravar(chaveLocal(id), { base: baseJson, def } satisfies Guardado);
    else guardado.apagar(chaveLocal(id));
  }, [def, sujo, baseJson, id, base, recuperado]);

  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const nome = def?.nome || base?.nome || 'Tarefa';
  useMigalhas(d ? [{ rotulo: 'Tarefas', para: '/tarefas' }, { rotulo: nome }] : null);

  const mudar = useCallback((fn: (x: TarefaDefinicao) => TarefaDefinicao) => setDef((x) => (x ? fn(x) : x)), []);

  /** Aplica o detalhe devolvido pelo servidor; a ficha local vira a base nova se não mudou no meio do caminho. */
  const aplicar = useCallback(
    (novo: TarefaDetalhe, enviado?: TarefaDefinicao) => {
      const b = baseDe(novo);
      det.definir(() => novo);
      if (b) {
        ultimaBase.current = { json: JSON.stringify(b), def: b };
        setDef((atual) => (enviado && atual && !iguais(atual, enviado) ? atual : b));
      }
    },
    [det],
  );

  // ----- Ações -----
  const [salvando, setSalvando] = useState(false);
  const [publicarAberto, setPublicarAberto] = useState(false);
  const [pendente, setPendente] = useState<Pendente>(null);
  const [acaoCarregando, setAcaoCarregando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erroRodada, setErroRodada] = useState<string | null>(null);

  const salvar = useCallback(
    async (silencioso = false): Promise<boolean> => {
      if (!def) return false;
      if (!sujo) return true;
      setSalvando(true);
      try {
        const novo = await api.put<TarefaDetalhe>(`/tarefas/${id}/rascunho`, { definicao: def });
        aplicar(novo, def);
        setRecuperado(null);
        if (!silencioso) toast.sucesso('Rascunho salvo. A pré-visualização já usa as mudanças.');
        return true;
      } catch (e) {
        const ex = e as ErroApiCliente;
        toast.erro(ex.offline ? 'Sem conexão. As mudanças ficam guardadas neste navegador até a internet voltar.' : `Não salvei o rascunho: ${ex.message}`);
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [def, sujo, id, aplicar, toast],
  );

  useEffect(() => {
    if (!podeEditar) return;
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void salvar();
      }
    };
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, [salvar, podeEditar]);

  const rodarTestes = useCallback(async () => {
    if (!d) return;
    setErroRodada(null);
    if (d.testes.length === 0) {
      setAba('testes');
      return;
    }
    setRodando(true);
    try {
      if (sujo && !(await salvar(true))) return;
      const r = await api.post<RodadaTestes>(`/tarefas/${id}/testes/rodar`, { usarRascunho: true });
      det.definir((x) => (x ? { ...x, ultimaRodada: r } : x));
      if (r.aprovados === r.total) toast.sucesso(`Todos os ${plural(r.total, 'teste', 'testes')} passaram.`);
      else toast.mostrar({ texto: `${r.aprovados} de ${r.total} testes passaram. Veja o que falhou na aba Testes.`, tipo: 'info' });
    } catch (e) {
      setErroRodada((e as Error).message);
    } finally {
      setRodando(false);
    }
  }, [d, sujo, salvar, id, det, toast, setAba]);

  const testar = () => {
    setAba('testes');
    void rodarTestes();
  };

  const salvarTestes = async (casos: CasoDeTeste[]) => {
    const testes = await api.put<CasoDeTeste[]>(`/tarefas/${id}/testes`, { casos });
    det.definir((x) => (x ? { ...x, testes } : x));
  };

  const publicar = async (resumoMudancas: string) => {
    if (!d || !def) return;
    if (sujo) {
      const novo = await api.put<TarefaDetalhe>(`/tarefas/${id}/rascunho`, { definicao: def });
      aplicar(novo, def);
    }
    const anterior = d.publicada?.versao ?? null;
    const novo = await api.post<TarefaDetalhe>(`/tarefas/${id}/publicar`, { resumoMudancas: resumoMudancas || null });
    aplicar(novo);
    setRecuperado(null);
    setPublicarAberto(false);
    void recarregarResumo();
    const versao = novo.publicada?.versao ?? 0;
    toast.mostrar({
      tipo: 'sucesso',
      texto: `Tarefa publicada. Versão ${versao} já está valendo.`,
      acao: anterior
        ? {
            rotulo: 'Desfazer',
            aoClicar: () => {
              void (async () => {
                try {
                  await api.post(`/tarefas/${id}/restaurar`, { versao: anterior });
                  const volta = await api.post<TarefaDetalhe>(`/tarefas/${id}/publicar`, { resumoMudancas: `Voltou para a versão ${anterior}.` });
                  aplicar(volta);
                  toast.sucesso(`Pronto: o conteúdo da versão ${anterior} voltou a valer, como versão ${volta.publicada?.versao}.`);
                } catch (e) {
                  toast.erro(`Não consegui desfazer: ${(e as Error).message}`);
                }
              })();
            },
          }
        : undefined,
    });
  };

  const executarPendente = async () => {
    if (!pendente) return;
    setAcaoCarregando(true);
    setErroAcao(null);
    try {
      if (pendente.tipo === 'descartar') {
        const novo = await api.del<TarefaDetalhe>(`/tarefas/${id}/rascunho`);
        aplicar(novo);
        setDef(baseDe(novo));
        toast.sucesso('Rascunho descartado. A ficha voltou para a versão publicada.');
      } else {
        const novo = await api.post<TarefaDetalhe>(`/tarefas/${id}/status`, { status: pendente.status });
        aplicar(novo);
        void recarregarResumo();
        toast.sucesso(
          { ativa: 'Tarefa ativada. O copiloto já pode oferecer e executar.', teste: 'Tarefa em teste. Só quem está liberado consegue usar.', inativa: 'Tarefa desativada.' }[
            pendente.status
          ],
        );
      }
      setPendente(null);
    } catch (e) {
      setErroAcao((e as Error).message);
    } finally {
      setAcaoCarregando(false);
    }
  };

  const restaurar = async (versao: number) => {
    const novo = await api.post<TarefaDetalhe>(`/tarefas/${id}/restaurar`, { versao });
    aplicar(novo);
    setDef(baseDe(novo));
    setRecuperado(null);
    toast.sucesso(`A versão ${versao} virou o rascunho. Revise e publique quando quiser.`);
  };

  // ----- Estados -----
  if (det.carregando && !d) return <Carregando forma="ficha" texto="Abrindo a ficha da tarefa…" />;
  if (det.erro && !d) {
    if (det.erro.status === 404) {
      return (
        <EstadoVazio
          emCartao
          titulo="Não encontramos esta tarefa"
          texto="Ela pode ter sido removida, ou o endereço está incompleto."
          acao={
            <Link className="btn btn-secondary" to="/tarefas">
              Ver todas as tarefas
            </Link>
          }
        />
      );
    }
    return <EstadoErro erro={det.erro} aoTentar={() => void det.recarregar()} />;
  }
  if (!d || !def) return <Carregando forma="ficha" texto="Abrindo a ficha da tarefa…" />;

  const versaoNova = proximaVersao(d.rascunho, d.publicada);
  const temOQuePublicar = !!d.rascunho || sujo;
  const versaoRascunho = d.rascunho?.versao ?? null;
  const ocupado = salvando || rodando;
  const estadoRodada: EstadoRodada = { rodando, erro: erroRodada, rodar: () => void rodarTestes() };
  const rodada = d.ultimaRodada;

  const textoPendente =
    pendente?.tipo === 'descartar'
      ? {
          titulo: `Descartar o rascunho da versão ${versaoRascunho}?`,
          texto: `As alterações voltam para a versão ${d.publicada?.versao} publicada. Isso não pode ser desfeito.`,
          botao: 'Descartar rascunho',
          perigo: true,
        }
      : pendente?.status === 'inativa'
        ? {
            titulo: `Desativar a tarefa ${nome}?`,
            texto: `O copiloto vai parar de oferecer e de executar esta tarefa. Quem pedir para ${minuscula(nome)} vai ser orientado a falar com o suporte. As execuções antigas e o fluxo gravado continuam guardados, e você pode reativar quando quiser.`,
            botao: 'Desativar',
            perigo: true,
          }
        : pendente?.status === 'teste'
          ? {
              titulo: `Colocar ${nome} em teste?`,
              texto: def.liberadaPara?.length
                ? `Só ${plural(def.liberadaPara.length, 'pessoa liberada', 'pessoas liberadas')} em Permissões vão conseguir usar. As demais vão ser orientadas a falar com o suporte.`
                : 'Ninguém está liberado em Permissões, então todos os perfis permitidos continuam usando. Libere pessoas em Permissões para restringir.',
              botao: 'Colocar em teste',
              perigo: false,
            }
          : {
              titulo: `Ativar ${nome}?`,
              texto: `O copiloto passa a oferecer e executar a versão ${d.publicada?.versao ?? ''} para todos os perfis que podem executar.`,
              botao: 'Ativar',
              perigo: false,
            };

  const acoes = podeEditar ? (
    <>
      <Botao variante="fantasma" carregando={salvando} disabled={!sujo || rodando} onClick={() => void salvar()} title="Ctrl+S">
        Salvar rascunho
      </Botao>
      <Botao variante="secundario" icone="play" disabled={ocupado} onClick={testar}>
        Testar
      </Botao>
      <Botao
        variante="primario"
        disabled={!temOQuePublicar || ocupado || !online}
        title={!online ? 'Sem conexão. Publicar volta quando a internet voltar.' : !temOQuePublicar ? 'Não há alterações para publicar.' : undefined}
        onClick={() => setPublicarAberto(true)}
      >
        Publicar versão {versaoNova}
      </Botao>
      <Menu
        rotulo="Mais ações da tarefa"
        largura={300}
        botao={(p) => (
          <button {...p} type="button" className="btn btn-ghost btn-icon" aria-label="Mais ações">
            <Icone nome="pontos" />
          </button>
        )}
      >
        {(fechar) => (
          <>
            {d.publicada && d.status !== 'ativa' ? (
              <ItemMenu
                titulo="Ativar"
                descricao="Todos os perfis permitidos passam a usar."
                icone="check"
                aoClicar={() => (fechar(), setErroAcao(null), setPendente({ tipo: 'status', status: 'ativa' }))}
              />
            ) : null}
            {d.publicada && d.status !== 'teste' ? (
              <ItemMenu
                titulo="Colocar em teste"
                descricao="Só quem você liberar em Permissões usa."
                icone="relogio"
                aoClicar={() => (fechar(), setErroAcao(null), setPendente({ tipo: 'status', status: 'teste' }))}
              />
            ) : null}
            {sujo ? (
              <ItemMenu
                titulo="Desfazer mudanças não salvas"
                descricao="Volta a ficha para o último rascunho salvo."
                icone="desfazer"
                aoClicar={() => (fechar(), setDef(base), setRecuperado(null))}
              />
            ) : null}
            {d.rascunho && d.publicada ? (
              <ItemMenu
                titulo="Descartar rascunho"
                descricao={`Volta para a versão ${d.publicada.versao} publicada.`}
                icone="lixeira"
                perigo
                aoClicar={() => (fechar(), setErroAcao(null), setPendente({ tipo: 'descartar' }))}
              />
            ) : null}
            {d.status !== 'inativa' && d.publicada ? (
              <ItemMenu
                titulo="Desativar tarefa"
                descricao="O copiloto para de oferecer e executar."
                icone="fechar"
                perigo
                aoClicar={() => (fechar(), setErroAcao(null), setPendente({ tipo: 'status', status: 'inativa' }))}
              />
            ) : null}
            {!d.publicada && !sujo ? <p className="small muted ct-menu-vazio">Publique a tarefa para poder ativar, testar ou desativar.</p> : null}
          </>
        )}
      </Menu>
    </>
  ) : null;

  return (
    <div className="stack-lg ct-ficha">
      <div className="stack-lg" style={{ gap: 'var(--s-4)' }}>
        <CabecalhoPagina
          titulo={nome}
          selos={
            <>
              <SeloStatusTarefa status={d.status} />
              {d.publicada ? <span className="badge badge-outline">Versão {d.publicada.versao}</span> : null}
            </>
          }
          subtitulo={subtitulo(d, sujo)}
          acoes={acoes}
        />
        {!podeEditar ? (
          <Aviso tipo="info">
            Você pode ver a ficha, mas não editar. Seu perfil é {ROTULO_PERFIL[resumo.eu.perfil]}; quem edita tarefas é Admin ou Editor de tarefas.
          </Aviso>
        ) : null}
        {recuperado === 'mesma' && sujo ? (
          <Aviso
            tipo="aviso"
            titulo="Recuperamos mudanças que não foram salvas"
            acoes={
              <>
                <Botao tamanho="sm" variante="primario" carregando={salvando} onClick={() => void salvar()}>
                  Salvar rascunho
                </Botao>
                <Botao tamanho="sm" variante="fantasma" onClick={() => (setDef(base), setRecuperado(null))}>
                  Descartar
                </Botao>
              </>
            }
          >
            Elas ficaram guardadas neste navegador. Salve o rascunho para não perder.
          </Aviso>
        ) : null}
        {recuperado === 'antiga' && antigo ? (
          <Aviso
            tipo="aviso"
            titulo="Há mudanças não salvas feitas sobre uma versão anterior da ficha"
            acoes={
              <>
                <Botao
                  tamanho="sm"
                  variante="secundario"
                  onClick={() => {
                    setDef(antigo);
                    setRecuperado('mesma');
                    setAntigo(null);
                  }}
                >
                  Usar minhas mudanças
                </Botao>
                <Botao
                  tamanho="sm"
                  variante="fantasma"
                  onClick={() => {
                    guardado.apagar(chaveLocal(id));
                    setRecuperado(null);
                    setAntigo(null);
                  }}
                >
                  Descartar
                </Botao>
              </>
            }
          >
            Alguém salvou esta tarefa depois. Se usar suas mudanças, elas substituem o que foi salvo quando você salvar o rascunho.
          </Aviso>
        ) : null}
        <Abas
          rotulo="Seções da tarefa"
          ativa={aba}
          aoTrocar={setAba}
          abas={[
            { chave: 'ficha', rotulo: 'Ficha' },
            { chave: 'execucao', rotulo: 'Execução' },
            { chave: 'permissoes', rotulo: 'Permissões' },
            {
              chave: 'testes',
              rotulo: 'Testes',
              selo: rodada ? (
                <span className={`badge ${rodada.aprovados === rodada.total ? 'badge-success' : 'badge-warning'}`}>
                  {rodada.aprovados}/{rodada.total}
                </span>
              ) : d.testes.length ? (
                <span className="badge">{d.testes.length}</span>
              ) : undefined,
            },
            { chave: 'historico', rotulo: 'Histórico' },
          ]}
        />
      </div>

      <div className="split">
        <div className="main-col" role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
          {aba === 'ficha' ? <AbaFicha def={def} mudar={mudar} podeEditar={podeEditar} /> : null}
          {aba === 'execucao' ? (
            <AbaExecucao def={def} mudar={mudar} podeEditar={podeEditar} tarefaId={id} sujo={sujo} recarregar={() => void det.recarregar()} />
          ) : null}
          {aba === 'permissoes' ? <AbaPermissoes def={def} mudar={mudar} podeEditar={podeEditar} perfisSistema={d.perfisSistema} status={d.status} /> : null}
          {aba === 'testes' ? (
            <AbaTestes
              testes={d.testes}
              rodada={rodada}
              def={def}
              versaoRascunho={versaoRascunho}
              podeEditar={podeEditar}
              estado={estadoRodada}
              salvarTestes={salvarTestes}
            />
          ) : null}
          {aba === 'historico' ? (
            <AbaHistorico historico={d.historico} podeEditar={podeEditar} versaoRascunho={versaoRascunho} sujo={sujo} restaurar={restaurar} />
          ) : null}
        </div>

        <aside className="side-col stack-lg ct-lateral" aria-label="Testes e pré-visualização">
          {aba !== 'testes' ? (
            <ResumoTestes
              testes={d.testes}
              rodada={rodada}
              def={def}
              versaoRascunho={versaoRascunho}
              podeEditar={podeEditar}
              estado={estadoRodada}
              verTodos={() => setAba('testes')}
            />
          ) : null}
          <section className="card ct-previa" aria-labelledby="previa-titulo">
            <div className="card-body stack-sm">
              <ChatDeTeste
                seletor="pilula"
                altura={520}
                reinicio={d.rascunho?.salvoEm ?? d.publicada?.versao ?? ''}
                titulo={
                  <h2 className="h4" id="previa-titulo">
                    Pré-visualizar
                  </h2>
                }
              />
              {sujo ? (
                <p className="small text-warning row-top" style={{ gap: 6 }}>
                  <Icone nome="alerta" tamanho="sm" />
                  Salve o rascunho para a pré-visualização usar as mudanças.
                </p>
              ) : (
                <p className="tiny muted">Simulação com o rascunho. Nada é gravado.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <ModalPublicar
        aberto={publicarAberto}
        versao={versaoNova}
        detalhe={d}
        sujo={sujo}
        aoFechar={() => setPublicarAberto(false)}
        aoPublicar={publicar}
      />
      <Confirmar
        aberto={pendente !== null}
        titulo={textoPendente.titulo}
        texto={textoPendente.texto}
        rotuloConfirmar={textoPendente.botao}
        perigo={textoPendente.perigo}
        carregando={acaoCarregando}
        erro={erroAcao}
        aoConfirmar={() => void executarPendente()}
        aoFechar={() => setPendente(null)}
      />
    </div>
  );
}

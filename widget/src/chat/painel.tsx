// Painel do chat: cabeçalho, faixas de estado, boas-vindas (W1) ou conversa, e a caixa de mensagem.
// Usado pelo widget embutido (Shadow DOM) e pelo ChatCopiloto do console.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { ItemRecente, PaginaContexto, StatusExecucao, Sugestao, WidgetInicio } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { ContextoAcoes, type AcoesChat, type PropsLink } from './acoes.tsx';
import { Composer, type ControleComposer } from './composer.tsx';
import type { ControladorChat, EstadoChat } from './controlador.ts';
import { AvatarCopiloto, AvatarPessoa, Icone } from './icones.tsx';
import { ListaMensagens } from './mensagens.tsx';
import { minusculaInicial, nomeComArtigo } from './util.ts';

export function useChat(controlador: ControladorChat): EstadoChat {
  return useSyncExternalStore(controlador.assinar, controlador.obter, controlador.obter);
}

// ---------- cabeçalho ----------

export function Cabecalho({
  nome,
  estado,
  aoNovaConversa,
  aoMinimizar,
  aoFechar,
}: {
  nome: string;
  estado?: EstadoChat['estadoConversa'];
  aoNovaConversa?: () => void;
  aoMinimizar?: () => void;
  aoFechar?: () => void;
}) {
  const pessoa = estado?.modo === 'pessoa' ? estado.atendente : null;
  const esperando = estado?.modo === 'aguardando_pessoa';
  const alvo = pessoa ? 'conversa' : 'copiloto';
  return (
    <div className="widget-head">
      {pessoa ? <AvatarPessoa iniciais={pessoa.iniciais} /> : <AvatarCopiloto />}
      <div className="grow cp-min0">
        {pessoa ? (
          <div className="row cp-gap-8">
            <span className="title cp-truncar">{pessoa.nome}</span>
            <span className="badge badge-accent cp-selo">Pessoa</span>
          </div>
        ) : (
          <div className="title cp-truncar">{nome}</div>
        )}
        <div className={`status${esperando ? ' cp-status-espera' : ''}`}>
          {pessoa ? `${pessoa.papel} · Online` : esperando ? 'Chamando uma pessoa do suporte' : 'Online'}
        </div>
      </div>
      {aoNovaConversa && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Nova conversa" title="Nova conversa" onClick={aoNovaConversa}>
          <Icone nome="mais" />
        </button>
      )}
      {aoMinimizar && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Minimizar ${alvo}`} title="Minimizar" onClick={aoMinimizar}>
          <Icone nome="menos" />
        </button>
      )}
      {aoFechar && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Fechar ${alvo}`} title="Fechar" onClick={aoFechar}>
          <Icone nome="fechar" />
        </button>
      )}
    </div>
  );
}

// ---------- faixas (teste, simulado, pausa, conexão, avisos) ----------

export function Faixas({
  inicio,
  estado,
  naFila,
  aoPedirHumano,
  aoFecharAviso,
}: {
  inicio: Pick<WidgetInicio, 'modoTeste' | 'modoSimulado' | 'pausa'>;
  estado?: EstadoChat;
  naFila?: number;
  aoPedirHumano?: () => void;
  aoFecharAviso?: () => void;
}) {
  const temFila = (naFila ?? 0) > 0 || Boolean(estado?.mensagens.some((m) => m.local?.situacao === 'na_fila'));
  const instavel = Boolean(estado) && (!estado!.online || estado!.conexao === 'instavel' || temFila);
  const reconectando = estado && !instavel && estado.online && estado.conexao === 'reconectando';
  const itens: ReactNode[] = [];
  if (inicio.modoTeste)
    itens.push(
      <div key="teste" className="cp-faixa cp-faixa-teste">
        <Icone nome="frasco" tamanho="sm" />
        <span>
          <span className="strong">Modo de teste:</span> nada é gravado
        </span>
      </div>,
    );
  if (inicio.modoSimulado)
    itens.push(
      <div key="simulado" className="cp-faixa cp-faixa-simulado">
        <Icone nome="info" tamanho="sm" />
        <span>Modo simulado: respostas de exemplo, sem a IA conectada</span>
      </div>,
    );
  if (inicio.pausa)
    itens.push(
      <div key="pausa" className="alert alert-warning cp-alerta" role="status">
        <Icone nome="pausa" />
        <div className="small grow">
          {inicio.pausa.mensagem}
          {aoPedirHumano && (
            <>
              {' '}
              <button type="button" className="cp-link" onClick={aoPedirHumano}>
                Falar com uma pessoa
              </button>
            </>
          )}
        </div>
      </div>,
    );
  if (instavel)
    itens.push(
      <div key="conexao" className="alert alert-warning cp-alerta" role="status">
        <Icone nome="semRede" />
        <div className="small">
          <span className="strong">Conexão instável.</span> Suas mensagens serão enviadas assim que a internet voltar.
        </div>
      </div>,
    );
  else if (reconectando)
    itens.push(
      <div key="reconectando" className="cp-faixa cp-faixa-reconectando" role="status">
        <span className="spinner cp-spinner-sm" aria-hidden="true" />
        <span>Reconectando…</span>
      </div>,
    );
  if (estado?.aviso)
    itens.push(
      <div key="aviso" className="alert alert-danger cp-alerta" role="alert">
        <Icone nome="aviso" />
        <div className="small grow">{estado.aviso}</div>
        {aoFecharAviso && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm cp-alerta-fechar" aria-label="Fechar aviso" onClick={aoFecharAviso}>
            <Icone nome="fechar" tamanho="sm" />
          </button>
        )}
      </div>,
    );
  if (!itens.length) return null;
  return <div className="cp-faixas">{itens}</div>;
}

// ---------- boas-vindas (W1) ----------

const STATUS_RECENTE: Record<StatusExecucao, { classe: string; texto: string }> = {
  concluida: { classe: 'badge-success', texto: 'Concluído' },
  em_andamento: { classe: 'badge-info', texto: 'Em andamento' },
  aguardando_confirmacao: { classe: 'badge-warning', texto: 'Aguardando você' },
  aguardando_aprovacao: { classe: 'badge-warning', texto: 'Aguardando aprovação' },
  falhou: { classe: 'badge-danger', texto: 'Não concluído' },
  desfeita: { classe: '', texto: 'Desfeito' },
  cancelada: { classe: '', texto: 'Cancelado' },
};

export function BoasVindas({
  primeiroNome,
  boasVindas,
  secao,
  sugestoes,
  recentes,
  aoSugestao,
  aoVoltar,
}: {
  primeiroNome: string;
  boasVindas: string;
  secao?: string;
  sugestoes: Sugestao[];
  recentes: ItemRecente[];
  aoSugestao?: (s: Sugestao) => void;
  aoVoltar?: () => void;
}) {
  const idSug = useId();
  const idRec = useId();
  return (
    <div className="stack cp-boas-vindas">
      <section className="stack-sm cp-ola">
        <AvatarCopiloto tamanho="lg" />
        <h1 className="h3">
          {fmt.saudacao()}, {primeiroNome}.
        </h1>
        <p className="muted">{boasVindas}</p>
        {secao && (
          <div className="row">
            <span className="context-pill">
              <Icone nome="janela" tamanho="sm" />
              Você está em {secao}
            </span>
          </div>
        )}
        {aoVoltar && (
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm cp-voltar" onClick={aoVoltar}>
              <Icone nome="desfazer" tamanho="sm" />
              Voltar à conversa anterior
            </button>
          </div>
        )}
      </section>
      {sugestoes.length > 0 && (
        <section className="stack-sm" aria-labelledby={idSug}>
          <h2 className="eyebrow cp-h" id={idSug}>
            Posso fazer agora
          </h2>
          <div className="chips">
            {sugestoes.map((s, i) => (
              <button key={`${s.rotulo}-${i}`} type="button" className="chip" onClick={() => aoSugestao?.(s)}>
                {s.rotulo}
              </button>
            ))}
          </div>
        </section>
      )}
      {recentes.length > 0 && (
        <section className="stack-sm" aria-labelledby={idRec}>
          <h2 className="eyebrow cp-h" id={idRec}>
            Pedidos recentes
          </h2>
          <ul className="card cp-recentes">
            {recentes.slice(0, 4).map((r) => {
              const s = STATUS_RECENTE[r.status] ?? { classe: '', texto: r.status };
              return (
                <li key={r.execucaoId} className="row between cp-recente">
                  <div className="stack-sm grow cp-gap-2 cp-min0">
                    <span className="small strong">{r.titulo}</span>
                    <span className="tiny muted">
                      {fmt.quando(r.quando)} · <span className="mono">{r.execucaoId}</span>
                    </span>
                  </div>
                  <span className={`badge ${s.classe}`}>
                    <span className="dot" />
                    {s.texto}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export function placeholderBoasVindas(sugestoes: Sugestao[]): string {
  const primeira = sugestoes[0]?.rotulo;
  return primeira ? `Peça algo, por exemplo: ${minusculaInicial(primeira)}` : 'Peça algo ou tire uma dúvida';
}

export function DicaComposer({ estado, horario }: { estado?: EstadoChat['estadoConversa']; horario: string }) {
  if (estado && estado.modo !== 'copiloto') {
    return (
      <p className="composer-hint row cp-centro cp-gap-6">
        <Icone nome="relogio" tamanho="sm" />
        Atendimento por pessoas: {horario}
      </p>
    );
  }
  return <p className="composer-hint">O copiloto pede sua confirmação antes de alterar qualquer dado</p>;
}

// ---------- painel completo ----------

export interface PropsPainel {
  controlador: ControladorChat;
  /** embutido: links da mesma origem abrem na mesma aba; console: sempre em outra aba. */
  modo: 'embutido' | 'console';
  contextoPagina?: PaginaContexto;
  aoFechar?: () => void;
  aoMinimizar?: () => void;
  /** Quando passa a true, rola até o fim e põe o foco na caixa de mensagem. */
  visivel?: boolean;
  altura?: number | string;
  className?: string;
  estilo?: CSSProperties;
}

export function Painel({ controlador, modo, contextoPagina, aoFechar, aoMinimizar, visivel = true, altura, className, estilo }: PropsPainel) {
  const estado = useChat(controlador);
  const inicio = controlador.inicio;
  const composer = useRef<ControleComposer>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const ultimoFoco = useRef<HTMLElement | null>(null);
  const pertoDoFim = useRef(true);

  const acoes = useMemo<AcoesChat>(() => {
    const link = (url: string): PropsLink => {
      const href = controlador.api.resolverLink(url);
      let mesma = false;
      try {
        mesma = modo === 'embutido' && new URL(href).origin === location.origin;
      } catch {
        mesma = false;
      }
      return mesma ? { href } : { href, target: '_blank', rel: 'noopener noreferrer' };
    };
    return {
      enviar: (t) => controlador.enviar(t),
      confirmar: (id) => controlador.confirmar(id),
      corrigir: (id) => controlador.corrigir(id),
      cancelarExecucao: (id) => controlador.cancelarExecucao(id),
      desfazer: (id) => controlador.desfazer(id),
      enviarAprovacao: (id) => controlador.enviarAprovacao(id),
      cancelarAprovacao: (id) => controlador.cancelarAprovacao(id),
      pedirHumano: (motivo) => controlador.pedirHumano(motivo),
      feedback: (id, v) => controlador.feedback(id, v),
      executarAcao: (a, execucaoId) =>
        controlador.executarAcao(a, execucaoId, (url) => {
          const l = link(url);
          if (l.target) window.open(l.href, l.target, 'noopener');
          else window.location.assign(l.href);
        }),
      reenviar: (id) => controlador.reenviar(id),
      descartar: (id) => controlador.descartar(id),
      novaConversa: () => controlador.novaConversa(),
      link,
      preencherComposer: (t) => composer.current?.preencher(t),
      focarComposer: () => composer.current?.focar(),
    };
  }, [controlador, modo]);

  // Rola até o fim quando chega coisa nova (se a pessoa já estava perto do fim ou acabou de enviar).
  const ultima = estado.mensagens[estado.mensagens.length - 1];
  useLayoutEffect(() => {
    const el = corpo.current;
    if (!el) return;
    if (pertoDoFim.current || (ultima && ultima.autor === 'usuario')) el.scrollTop = el.scrollHeight;
  }, [estado.mensagens, estado.digitando, estado.estadoConversa, estado.tela, ultima]);

  useEffect(() => {
    if (!visivel) return;
    const el = corpo.current;
    if (el && estado.tela === 'conversa') el.scrollTop = el.scrollHeight;
    const t = setTimeout(() => composer.current?.focar(), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel]);

  // Se o botão com foco sumiu (ex.: "Confirmar" vira "Você confirmou às…"), o foco volta para o campo de mensagem,
  // em vez de cair no corpo da página (onde Esc e Tab deixariam de funcionar no painel).
  useEffect(() => {
    const perdido = ultimoFoco.current;
    if (!visivel || !perdido || perdido.isConnected) return;
    ultimoFoco.current = null;
    const cont = raizRef.current;
    const atual = (cont?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement ?? null;
    if (cont && atual && atual !== document.body && cont.contains(atual)) return;
    composer.current?.focar();
  });

  const pessoa = estado.estadoConversa.modo === 'pessoa' ? estado.estadoConversa.atendente : null;
  const confirmacaoPendente = estado.mensagens.some((m) =>
    m.blocos.some((b) => b.tipo === 'confirmacao' && b.estado === 'pendente'),
  );
  const placeholder = pessoa
    ? `Responda para ${fmt.primeiroNome(pessoa.nome)}`
    : estado.tela === 'boas_vindas'
      ? placeholderBoasVindas(inicio.sugestoes)
      : confirmacaoPendente
        ? 'Ou escreva o que quer corrigir'
        : 'Escreva sua mensagem';
  const rotulo = pessoa ? `Mensagem para ${pessoa.nome}` : `Mensagem para ${nomeComArtigo(inicio.config.nome)}`;

  let conteudo: ReactNode;
  if (estado.tela === 'boas_vindas') {
    conteudo = (
      <BoasVindas
        primeiroNome={inicio.usuario.primeiroNome || fmt.primeiroNome(inicio.usuario.nome)}
        boasVindas={inicio.config.boasVindas}
        secao={contextoPagina?.secao}
        sugestoes={inicio.sugestoes}
        recentes={estado.recentes}
        aoSugestao={(s) => controlador.enviar(s.mensagem)}
        aoVoltar={estado.conversaAnteriorId ? () => controlador.voltarConversaAnterior() : undefined}
      />
    );
  } else if (estado.carregando && !estado.mensagens.length) {
    conteudo = (
      <div className="stack-sm cp-carregando" aria-busy="true" aria-label="Carregando a conversa">
        <span className="skel cp-skel-60" />
        <span className="skel cp-skel-90" />
        <span className="skel cp-skel-75" />
      </div>
    );
  } else if (estado.erroCarregar && !estado.mensagens.length) {
    conteudo = (
      <div className="empty cp-vazio" role="alert">
        <span className="empty-icon">
          <Icone nome="aviso" tamanho="lg" />
        </span>
        <p>{estado.erroCarregar}</p>
        <div className="row wrap cp-centro">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => controlador.recarregar()}>
            Tentar de novo
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => controlador.novaConversa()}>
            Nova conversa
          </button>
        </div>
      </div>
    );
  } else {
    conteudo = <ListaMensagens estado={estado} inicio={inicio} contextoPagina={contextoPagina} />;
  }

  const temConversa = estado.tela === 'conversa' && (estado.conversaId || estado.mensagens.length > 0);

  return (
    <ContextoAcoes.Provider value={acoes}>
      <div
        className={`widget cp-chat${className ? ` ${className}` : ''}`}
        ref={raizRef}
        style={{ ...(altura !== undefined ? { height: altura } : {}), ...estilo }}
        onFocus={(e) => {
          ultimoFoco.current = e.target instanceof HTMLElement ? e.target : null;
        }}
        onBlur={(e) => {
          const el = e.target;
          // Saiu de propósito (o elemento continua na página): esquece. Se foi removido, o efeito acima devolve o foco.
          queueMicrotask(() => {
            if (ultimoFoco.current === el && el.isConnected) ultimoFoco.current = null;
          });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && aoFechar) {
            e.stopPropagation();
            aoFechar();
          }
        }}
      >
        <Cabecalho
          nome={inicio.config.nome}
          estado={estado.estadoConversa}
          aoNovaConversa={temConversa ? () => controlador.novaConversa() : undefined}
          aoMinimizar={aoMinimizar}
          aoFechar={aoFechar}
        />
        <Faixas
          inicio={inicio}
          estado={estado}
          naFila={controlador.naFila}
          aoPedirHumano={() => void controlador.pedirHumano('Limite de uso atingido').catch((e) => controlador.mostrarAviso(String(e?.message ?? e)))}
          aoFecharAviso={() => controlador.fecharAviso()}
        />
        <div
          ref={corpo}
          className={`widget-body cp-corpo${estado.tela === 'boas_vindas' ? ' cp-corpo-ola' : ''}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            pertoDoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {conteudo}
        </div>
        <div className="widget-foot">
          <Composer
            ref={composer}
            rotulo={rotulo}
            placeholder={placeholder}
            linhas={estado.tela === 'boas_vindas' ? 2 : 1}
            voz={!pessoa}
            aoEnviar={(t, anexos) => {
              pertoDoFim.current = true;
              controlador.enviar(t, anexos);
            }}
            aoAnexar={(f) => controlador.anexar(f)}
          />
          <DicaComposer estado={estado.estadoConversa} horario={inicio.config.atendimentoHumano.horario} />
        </div>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {estado.anuncio?.texto ?? ''}
        </div>
      </div>
    </ContextoAcoes.Provider>
  );
}

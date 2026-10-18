// Cartões das mensagens (tipos de Bloco em shared/src/widget.ts). Layout e textos dos designs W2–W8.
import { Fragment, useEffect, useId, useState } from 'react';
import type { AcaoBloco, Bloco, Caminho, CampoExibido, MensagemWidget } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { useAcaoAssincrona, useAcoesChat, useAgora } from './acoes.tsx';
import { Icone, type NomeIcone } from './icones.tsx';
import { MarkdownLinha } from './markdown.tsx';
import { minusculaInicial } from './util.ts';

type BlocoDe<T extends Bloco['tipo']> = Extract<Bloco, { tipo: T }>;

const CODIGOS = /(#\d{2,}|\bEX-\d+\b)/g;

/** Destaca códigos (#4821, EX-20431) em fonte mono, como no design. */
export function ComCodigos({ texto }: { texto: string }) {
  const partes = texto.split(CODIGOS);
  return (
    <>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function classeBotao(base: string, carregando: boolean): string {
  return carregando ? `${base} is-loading` : base;
}

function ErroAcao({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <p className="cp-erro-acao" role="alert">
      <Icone nome="aviso" tamanho="sm" />
      {erro}
    </p>
  );
}

export function SeloCaminho({ caminho, tempo }: { caminho: Caminho; tempo?: string }) {
  const api = caminho === 'api';
  return (
    <span className={`badge ${api ? 'badge-info' : 'badge-accent'}`}>
      <Icone nome={api ? 'codigo' : 'janela'} tamanho="sm" />
      {api ? 'Via API' : 'Via navegador'}
      {tempo ? ` · ${tempo}` : ''}
    </span>
  );
}

export function ListaCampos({
  campos,
  className,
  aoTrocar,
}: {
  campos: CampoExibido[];
  className?: string;
  aoTrocar?: (campo: CampoExibido) => void;
}) {
  return (
    <dl className={`kv cp-kv${className ? ` ${className}` : ''}`}>
      {campos.map((c, i) => (
        <Fragment key={`${c.rotulo}-${i}`}>
          <dt>{c.rotulo}</dt>
          <dd>
            {c.selo === 'valido' ? (
              <span className="row wrap cp-gap-6">
                <span className="num">
                  <ComCodigos texto={c.valor} />
                </span>
                <span className="badge badge-success cp-selo">
                  <Icone nome="check" tamanho="sm" />
                  válido
                </span>
              </span>
            ) : (
              <ComCodigos texto={c.valor} />
            )}
            {c.editavel && aoTrocar && (
              <button
                type="button"
                className="cp-trocar"
                onClick={() => aoTrocar(c)}
                aria-label={`Trocar ${minusculaInicial(c.rotulo)}`}
              >
                Trocar
              </button>
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

// ---------- W2: coleta ----------

export function ListaColeta({ bloco }: { bloco: BlocoDe<'coleta'> }) {
  return (
    <>
      <ul className="cp-coleta">
        {bloco.itens.map((it, i) => (
          <li key={`${it.rotulo}-${i}`}>
            {it.ok ? (
              <>
                <Icone nome="check" tamanho="sm" className="text-success" />
                <span>
                  <span className="muted">{it.rotulo}:</span> {it.valor}
                </span>
              </>
            ) : (
              <>
                <Icone nome="aviso" tamanho="sm" className="text-warning" />
                <span>
                  <span className="muted">Falta:</span> <span className="strong">{minusculaInicial(it.rotulo)}</span>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {bloco.pergunta && (
        <p>
          <MarkdownLinha texto={bloco.pergunta} />
        </p>
      )}
    </>
  );
}

// ---------- W3: confirmação ----------

function EstadoConfirmacao({ bloco }: { bloco: BlocoDe<'confirmacao'> }) {
  switch (bloco.estado) {
    case 'confirmado':
      return (
        <span className="row small text-success cp-gap-6">
          <Icone nome="check" tamanho="sm" />
          {bloco.confirmadoEm ? `Você confirmou às ${fmt.hora(bloco.confirmadoEm)}` : 'Você confirmou'}
        </span>
      );
    case 'corrigir':
      return (
        <span className="row small muted cp-gap-6">
          <Icone nome="formulario" tamanho="sm" />
          Você pediu para corrigir. Escreva o que quer mudar.
        </span>
      );
    case 'cancelado':
      return (
        <span className="row small muted cp-gap-6">
          <Icone nome="xis" tamanho="sm" />
          Pedido cancelado. Nada foi gravado.
        </span>
      );
    case 'substituido':
      return (
        <span className="row small muted cp-gap-6">
          <Icone nome="info" tamanho="sm" />
          Substituído por um cartão mais novo, logo abaixo.
        </span>
      );
    default:
      return null;
  }
}

export function CartaoConfirmacao({ bloco }: { bloco: BlocoDe<'confirmacao'> }) {
  const acoes = useAcoesChat();
  const { carregando, erro, executar } = useAcaoAssincrona();
  const id = useId();
  const pendente = bloco.estado === 'pendente';
  const inativo = bloco.estado === 'cancelado' || bloco.estado === 'substituido';
  const minutos = bloco.desfazerMinutos;
  return (
    <section className={`action-card cp-cartao${inativo ? ' cp-inativo' : ''}`} aria-labelledby={id}>
      <div className="ac-head">
        <Icone nome="formulario" tamanho="sm" />
        <h2 id={id} className="grow cp-ac-titulo">
          {bloco.titulo}
        </h2>
        <span className="tiny muted cp-ac-tarefa">{bloco.tarefa}</span>
      </div>
      <div className="ac-body cp-gap-12">
        <ListaCampos
          campos={bloco.campos}
          aoTrocar={
            pendente ? (c) => acoes.preencherComposer(`Trocar ${minusculaInicial(c.rotulo)} para `) : undefined
          }
        />
        <div className="divider" />
        <div className="row wrap cp-gap-8">
          <SeloCaminho caminho={bloco.caminho} tempo={bloco.tempoEstimado} />
          {minutos > 0 ? (
            <span className="row tiny muted cp-gap-4">
              <Icone nome="desfazer" tamanho="sm" />
              Você pode desfazer por {minutos} {minutos === 1 ? 'minuto' : 'minutos'}
            </span>
          ) : (
            <span className="row tiny muted cp-gap-4">
              <Icone nome="info" tamanho="sm" />
              Depois de gravar, não dá para desfazer por aqui
            </span>
          )}
        </div>
      </div>
      {pendente ? (
        <div className="ac-foot">
          <button
            type="button"
            className={classeBotao('btn btn-primary grow', carregando === 'confirmar')}
            aria-busy={carregando === 'confirmar'}
            onClick={() => void executar('confirmar', () => acoes.confirmar(bloco.execucaoId))}
          >
            Confirmar e executar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-busy={carregando === 'corrigir'}
            onClick={() =>
              void executar('corrigir', async () => {
                await acoes.corrigir(bloco.execucaoId);
                acoes.focarComposer();
              })
            }
          >
            {carregando === 'corrigir' && <span className="spinner cp-spinner-sm" aria-hidden="true" />}
            Corrigir
          </button>
        </div>
      ) : (
        <div className="ac-foot cp-ac-estado">
          <EstadoConfirmacao bloco={bloco} />
        </div>
      )}
      <ErroAcao erro={erro} />
    </section>
  );
}

// ---------- W4: progresso ----------

const ROTULO_STATUS: Partial<Record<BlocoDe<'progresso'>['status'], { texto: string; icone: NomeIcone; classe: string }>> = {
  concluida: { texto: 'Concluído', icone: 'check', classe: 'text-success' },
  falhou: { texto: 'Não deu certo', icone: 'aviso', classe: 'text-danger' },
  cancelada: { texto: 'Cancelado', icone: 'xis', classe: 'muted' },
  desfeita: { texto: 'Desfeito', icone: 'desfazer', classe: 'muted' },
};

export function CartaoProgresso({ bloco }: { bloco: BlocoDe<'progresso'> }) {
  const acoes = useAcoesChat();
  const { carregando, erro, executar } = useAcaoAssincrona();
  const emAndamento = bloco.status === 'em_andamento' || bloco.status === 'aguardando_confirmacao';
  const total = bloco.etapas.length;
  const ativa = bloco.etapas.findIndex((e) => e.estado === 'ativa');
  const falhou = bloco.etapas.findIndex((e) => e.estado === 'falhou');
  const feitas = bloco.etapas.filter((e) => e.estado === 'feita').length;
  const atual = ativa >= 0 ? ativa + 1 : falhou >= 0 ? falhou + 1 : Math.max(1, Math.min(feitas, total));
  const pct = Math.max(0, Math.min(100, Math.round(bloco.percentual)));
  const fim = ROTULO_STATUS[bloco.status];
  return (
    <>
      <div className={`card cp-progresso${bloco.status === 'falhou' ? ' cp-progresso-falhou' : ''}`}>
        <div className="row between cp-gap-8">
          <div className="row cp-gap-8 cp-min0">
            {emAndamento ? (
              <span className="spinner" aria-hidden="true" />
            ) : fim ? (
              <Icone nome={fim.icone} tamanho="sm" className={fim.classe} />
            ) : null}
            <span className="strong small">{bloco.titulo}</span>
          </div>
          <SeloCaminho caminho={bloco.caminho} />
        </div>
        <div className="stack-sm cp-gap-6">
          <div
            className="progress"
            role="progressbar"
            aria-label={`Andamento: ${bloco.titulo}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="row between tiny muted">
            <span>{emAndamento ? `Etapa ${atual} de ${total}` : fim?.texto ?? `Etapa ${atual} de ${total}`}</span>
            {emAndamento && bloco.restante && <span>{bloco.restante}</span>}
          </div>
        </div>
        {total > 0 && (
          <ol className="steps cp-etapas">
            {bloco.etapas.map((e, i) => {
              const classe =
                e.estado === 'feita' ? 'step done' : e.estado === 'ativa' ? 'step active' : e.estado === 'falhou' ? 'step fail' : 'step';
              return (
                <li key={`${e.titulo}-${i}`} className={classe}>
                  <span className="step-dot">
                    {e.estado === 'feita' ? (
                      <Icone nome="check" tamanho="sm" />
                    ) : e.estado === 'falhou' ? (
                      <Icone nome="xis" tamanho="sm" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="stack-sm cp-gap-0">
                    <span className={`row small strong cp-gap-8${e.estado === 'pendente' ? ' muted' : ''}`}>
                      {e.titulo}
                      {e.estado === 'ativa' && emAndamento && <span className="spinner cp-spinner-sm" aria-hidden="true" />}
                      <span className="sr-only">
                        {e.estado === 'feita' ? ' (feita)' : e.estado === 'ativa' ? ' (em andamento)' : e.estado === 'falhou' ? ' (falhou)' : ' (a fazer)'}
                      </span>
                    </span>
                    {e.detalhe && <span className="tiny muted">{e.detalhe}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <span className="tiny muted">
          Execução <span className="mono">{bloco.execucaoId}</span>
        </span>
      </div>
      {emAndamento && (
        <>
          <div className="row between cp-gap-12 cp-recuo-4">
            <p className="small muted grow">Pode fechar esta janela. Eu aviso quando terminar.</p>
            {bloco.podeCancelar && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-busy={carregando === 'cancelar'}
                onClick={() => void executar('cancelar', () => acoes.cancelarExecucao(bloco.execucaoId))}
              >
                {carregando === 'cancelar' && <span className="spinner cp-spinner-sm" aria-hidden="true" />}
                Cancelar
              </button>
            )}
          </div>
          {bloco.podeCancelar && (
            <p className="tiny muted cp-recuo-4">
              Cancelar só funciona antes de gravar. Se já tiver sido gravado, use Desfazer no recibo.
            </p>
          )}
          <ErroAcao erro={erro} />
        </>
      )}
    </>
  );
}

// ---------- W5: recibo ----------

function partesTempo(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return { min: Math.floor(total / 60), seg: total % 60 };
}

export function CartaoRecibo({ bloco }: { bloco: BlocoDe<'recibo'> }) {
  const acoes = useAcoesChat();
  const { carregando, erro, executar } = useAcaoAssincrona();
  const id = useId();
  const limite = bloco.desfazerAte ? Date.parse(bloco.desfazerAte) : NaN;
  const temJanela = Number.isFinite(limite) && !bloco.desfeito;
  const agora = useAgora(temJanela && limite > Date.now());
  const restante = temJanela ? limite - agora : 0;
  const { min, seg } = partesTempo(restante);
  const link = bloco.link ? acoes.link(bloco.link.url) : null;
  const comSessao = /sua sessão/i.test(bloco.resumo);
  const viaNavegador = /navegador|pela tela/i.test(bloco.resumo);
  // O código da execução vem logo depois do resumo; se o resumo já termina com ele, não repete.
  const sufixo = ` · ${bloco.execucaoId}`;
  const resumo = bloco.resumo.endsWith(sufixo) ? bloco.resumo.slice(0, -sufixo.length) : bloco.resumo;
  return (
    <section className={`action-card cp-cartao cp-recibo${bloco.desfeito ? ' cp-recibo-desfeito' : ''}`} aria-labelledby={id}>
      <div className="ac-head cp-ac-sucesso">
        <Icone nome={bloco.desfeito ? 'desfazer' : 'check'} tamanho="sm" />
        <h2 id={id} className="grow cp-ac-titulo">
          <ComCodigos texto={bloco.titulo} />
        </h2>
        {bloco.desfeito && <span className="badge cp-selo">Desfeito</span>}
      </div>
      <div className="ac-body cp-gap-10">
        {bloco.registro && (
          // Número do registro criado, lido da tela: "Chamado #1287 · Padaria Estrela · Prioridade alta".
          <p className="strong cp-recibo-registro">
            {bloco.registro.nome} <span className="mono">{bloco.registro.numero}</span>
            {bloco.registro.detalhes.map((d) => ` · ${d}`).join('')}
          </p>
        )}
        {bloco.campos.length > 0 && <ListaCampos campos={bloco.campos} />}
        <p className="row tiny muted cp-gap-6">
          <Icone nome={comSessao ? 'cadeado' : viaNavegador ? 'janela' : 'codigo'} tamanho="sm" />
          <span>
            {resumo} · <span className="mono">{bloco.execucaoId}</span>
          </span>
        </p>
      </div>
      {(link || temJanela || bloco.desfeito) && (
        <div className="ac-foot">
          {link && bloco.link && (
            <a className="btn btn-secondary btn-sm grow" {...link}>
              {bloco.link.rotulo}
              <Icone nome="externo" tamanho="sm" />
            </a>
          )}
          {bloco.desfeito ? (
            <span className="row tiny muted cp-gap-6">
              <Icone nome="desfazer" tamanho="sm" />
              Você desfez. Nada ficou gravado.
            </span>
          ) : temJanela && restante > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-busy={carregando === 'desfazer'}
              aria-label={`Desfazer. Disponível por mais ${min} ${min === 1 ? 'minuto' : 'minutos'} e ${seg} ${seg === 1 ? 'segundo' : 'segundos'}`}
              onClick={() => void executar('desfazer', () => acoes.desfazer(bloco.execucaoId))}
            >
              {carregando === 'desfazer' ? (
                <span className="spinner cp-spinner-sm" aria-hidden="true" />
              ) : (
                <Icone nome="desfazer" tamanho="sm" />
              )}
              Desfazer
              <span className="mono num muted">
                {min}:{String(seg).padStart(2, '0')}
              </span>
            </button>
          ) : temJanela ? (
            <span className="tiny muted">O prazo para desfazer terminou.</span>
          ) : null}
        </div>
      )}
      <ErroAcao erro={erro} />
    </section>
  );
}

// ---------- botões de ação (conflito, erro) ----------

const ESTILO_PADRAO: Record<AcaoBloco['acao'], NonNullable<AcaoBloco['estilo']>> = {
  abrir: 'secundario',
  atualizar: 'primario',
  tentar: 'primario',
  humano: 'fantasma',
  mensagem: 'secundario',
};

const CLASSE_ESTILO: Record<NonNullable<AcaoBloco['estilo']>, string> = {
  primario: 'btn-primary',
  secundario: 'btn-secondary',
  fantasma: 'btn-ghost',
};

export function BotoesAcao({ acoes: lista, execucaoId }: { acoes: AcaoBloco[]; execucaoId?: string }) {
  const acoes = useAcoesChat();
  const { carregando, erro, executar } = useAcaoAssincrona();
  const [feitas, setFeitas] = useState<ReadonlySet<number>>(() => new Set());
  if (!lista.length) return null;
  return (
    <div className="stack-sm cp-acoes">
      {lista.map((a, i) => {
        const estilo = CLASSE_ESTILO[a.estilo ?? ESTILO_PADRAO[a.acao]];
        if (a.acao === 'abrir' && a.url) {
          return (
            <a key={i} className={`btn ${estilo} btn-block cp-btn-entre`} {...acoes.link(a.url)}>
              {a.rotulo}
              <Icone nome="externo" tamanho="sm" />
            </a>
          );
        }
        const icone: NomeIcone | null = a.acao === 'humano' ? 'pessoa' : a.acao === 'tentar' ? 'repetir' : null;
        const ocupado = carregando === String(i);
        // Depois de pedir, o botão fica marcado (evita pedir duas vezes); os outros continuam valendo.
        const feita = feitas.has(i);
        return (
          <button
            key={i}
            type="button"
            className={`btn ${estilo} btn-block cp-btn-inicio${feita ? ' cp-btn-apagado' : ''}`}
            aria-busy={ocupado}
            aria-disabled={feita || undefined}
            onClick={async () => {
              if (feita) return;
              const ok = await executar(String(i), () => acoes.executarAcao(a, execucaoId));
              if (ok && a.acao !== 'mensagem') setFeitas((f) => new Set(f).add(i));
            }}
          >
            {ocupado ? (
              <span className="spinner cp-spinner-sm" aria-hidden="true" />
            ) : feita ? (
              <Icone nome="check" tamanho="sm" />
            ) : icone ? (
              <Icone nome={icone} tamanho="sm" />
            ) : null}
            {a.rotulo}
          </button>
        );
      })}
      <ErroAcao erro={erro} />
    </div>
  );
}

// ---------- W6: conflito ----------

export function CartaoConflito({ bloco }: { bloco: BlocoDe<'conflito'> }) {
  const acoes = useAcoesChat();
  const id = useId();
  const { existente } = bloco;
  const temAbrir = bloco.acoes.some((a) => a.acao === 'abrir');
  const podeAtualizar = bloco.acoes.some((a) => a.acao === 'atualizar');
  return (
    <>
      <section className="card cp-conflito" aria-labelledby={id}>
        <div className="row between cp-gap-8">
          <h2 id={id} className="small strong cp-h">
            {existente.titulo} {existente.codigo && <span className="mono muted">{existente.codigo}</span>}
          </h2>
          <span className="badge badge-outline">Já cadastrado</span>
        </div>
        {existente.campos.length > 0 && <ListaCampos campos={existente.campos} className="cp-kv-104" />}
        {existente.url && !temAbrir && (
          <a className="small strong cp-link-externo" {...acoes.link(existente.url)}>
            Abrir cadastro existente
            <Icone nome="externo" tamanho="sm" />
          </a>
        )}
      </section>
      <p className="small cp-recuo-4">
        {podeAtualizar
          ? 'Como prefere seguir? Se escolher atualizar, mostro o que muda e peço sua confirmação antes.'
          : 'Como prefere seguir?'}
      </p>
      <BotoesAcao acoes={bloco.acoes} execucaoId={bloco.execucaoId} />
    </>
  );
}

// ---------- erro ----------

export function CartaoErro({ bloco }: { bloco: BlocoDe<'erro'> }) {
  const id = useId();
  return (
    <section className="action-card cp-cartao cp-erro" aria-labelledby={id}>
      <div className="ac-head cp-ac-erro">
        <Icone nome="aviso" tamanho="sm" />
        <h2 id={id} className="grow cp-ac-titulo">
          <ComCodigos texto={bloco.titulo} />
        </h2>
      </div>
      {(bloco.detalhe || bloco.codigo) && (
        <div className="ac-body">
          {bloco.detalhe && (
            <p className="small">
              <MarkdownLinha texto={bloco.detalhe} />
            </p>
          )}
          {(bloco.codigo || bloco.execucaoId) && (
            <p className="tiny muted">
              {bloco.codigo && (
                <>
                  Código para o suporte: <span className="mono">{bloco.codigo}</span>
                </>
              )}
              {bloco.codigo && bloco.execucaoId && ' · '}
              {bloco.execucaoId && <span className="mono">{bloco.execucaoId}</span>}
            </p>
          )}
        </div>
      )}
      {bloco.acoes.length > 0 && (
        <div className="ac-foot cp-ac-coluna">
          <BotoesAcao acoes={bloco.acoes} execucaoId={bloco.execucaoId} />
        </div>
      )}
    </section>
  );
}

// ---------- W7: aprovação ----------

export function CartaoAprovacao({ bloco }: { bloco: BlocoDe<'aprovacao'> }) {
  const acoes = useAcoesChat();
  const { carregando, erro, executar } = useAcaoAssincrona();
  const id = useId();
  const nome = bloco.aprovador?.nome;
  const campos =
    nome && !bloco.campos.some((c) => /aprova/i.test(c.rotulo))
      ? [...bloco.campos, { rotulo: 'Quem aprova', valor: nome }]
      : bloco.campos;
  return (
    <section className={`action-card cp-cartao${bloco.estado === 'cancelada' ? ' cp-inativo' : ''}`} aria-labelledby={id}>
      <div className="ac-head">
        <Icone nome="cadeado" tamanho="sm" />
        <h2 id={id} className="grow cp-ac-titulo">
          Precisa de aprovação
        </h2>
      </div>
      <div className="ac-body">
        <ListaCampos campos={campos} />
      </div>
      {bloco.estado === 'rascunho' ? (
        <div className="ac-foot cp-ac-coluna">
          <button
            type="button"
            className={classeBotao('btn btn-primary btn-sm btn-block', carregando === 'enviar')}
            aria-busy={carregando === 'enviar'}
            onClick={() => void executar('enviar', () => acoes.enviarAprovacao(bloco.aprovacaoId))}
          >
            <Icone nome="enviar" tamanho="sm" />
            {nome ? `Pedir aprovação a ${nome}` : 'Pedir aprovação'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-block"
            aria-busy={carregando === 'cancelar'}
            onClick={() => void executar('cancelar', () => acoes.cancelarAprovacao(bloco.aprovacaoId))}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div className="ac-foot cp-ac-estado cp-ac-coluna-esq">
          {/* O aviso "Pedido de aprovação enviado a …" vem logo abaixo, na mensagem seguinte (W7). */}
          {bloco.estado === 'enviada' && (
            <span className="badge badge-warning">
              <Icone nome="relogio" tamanho="sm" />
              Aguardando aprovação
            </span>
          )}
          {bloco.estado === 'aprovada' && (
            <>
              <span className="badge badge-success">
                <Icone nome="check" tamanho="sm" />
                Aprovado
              </span>
              <span className="small">{nome ? `${nome} aprovou o pedido.` : 'O pedido foi aprovado.'}</span>
            </>
          )}
          {bloco.estado === 'recusada' && (
            <>
              <span className="badge badge-danger">
                <Icone nome="xis" tamanho="sm" />
                Recusado
              </span>
              <span className="small">
                {nome ? `${nome} recusou o pedido.` : 'O pedido foi recusado.'}
                {bloco.motivoRecusa ? ` Motivo: ${bloco.motivoRecusa}` : ''}
              </span>
            </>
          )}
          {bloco.estado === 'cancelada' && <span className="small muted">Pedido de aprovação cancelado. Nada mudou.</span>}
        </div>
      )}
      <ErroAcao erro={erro} />
    </section>
  );
}

// ---------- sugestões, fontes, resumo para a pessoa, avaliação ----------

export function ChipsSugestoes({ bloco }: { bloco: BlocoDe<'sugestoes'> }) {
  const acoes = useAcoesChat();
  if (!bloco.itens.length) return null;
  return (
    <div className="stack-sm cp-recuo cp-gap-6">
      {bloco.titulo && <p className="tiny muted">{bloco.titulo}</p>}
      <div className="chips">
        {bloco.itens.map((s, i) => (
          <button key={`${s.rotulo}-${i}`} type="button" className="chip" onClick={() => acoes.enviar(s.mensagem)}>
            {s.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

const CONFIANCA = {
  alta: { classe: 'badge-success', texto: 'Confiança alta' },
  media: { classe: 'badge-warning', texto: 'Confiança média' },
  baixa: { classe: 'badge-danger', texto: 'Confiança baixa' },
} as const;

export function ListaFontes({ bloco }: { bloco: BlocoDe<'fontes'> }) {
  const acoes = useAcoesChat();
  const id = useId();
  const c = CONFIANCA[bloco.confianca] ?? CONFIANCA.media;
  return (
    <section className="card cp-fontes" aria-labelledby={id}>
      <div className="row between cp-gap-8">
        <h2 id={id} className="row tiny strong muted cp-h cp-gap-6">
          <Icone nome="documento" tamanho="sm" />
          Fontes
        </h2>
        <span className={`badge ${c.classe}`}>{c.texto}</span>
      </div>
      <ol className="cp-fontes-lista">
        {bloco.itens.map((f) => (
          <li key={f.n}>
            <span className="cp-fonte-n" aria-hidden="true">
              {f.n}
            </span>
            <span className="grow small">
              <span className="sr-only">Fonte {f.n}: </span>
              {f.url ? <a {...acoes.link(f.url)}>{f.titulo}</a> : f.titulo}
              {f.local && <span className="muted"> · {f.local}</span>}
            </span>
          </li>
        ))}
      </ol>
      {bloco.confianca === 'baixa' && <p className="tiny muted">Não tenho certeza desta resposta. Confira na fonte antes de seguir.</p>}
    </section>
  );
}

export function CartaoResumoHumano({ bloco }: { bloco: BlocoDe<'resumo_humano'> }) {
  const id = useId();
  return (
    <section className="card cp-resumo" aria-labelledby={id}>
      <h2 id={id} className="row tiny strong muted cp-h cp-gap-6">
        <Icone nome="enviar" tamanho="sm" />
        Resumo enviado para {bloco.para}
      </h2>
      <ListaCampos campos={bloco.itens} className="cp-kv-84" />
    </section>
  );
}

export function Avaliacao({ mensagem }: { mensagem: MensagemWidget }) {
  const acoes = useAcoesChat();
  const { erro, executar } = useAcaoAssincrona();
  const valor = mensagem.feedback ?? null;
  const [agradecer, setAgradecer] = useState(false);
  useEffect(() => {
    if (!agradecer) return;
    const t = setTimeout(() => setAgradecer(false), 4000);
    return () => clearTimeout(t);
  }, [agradecer]);
  const votar = (v: 'util' | 'nao_util') =>
    void executar(v, async () => {
      await acoes.feedback(mensagem.id, v);
      setAgradecer(true);
    });
  return (
    <div className="cp-recuo stack-sm cp-gap-4">
      <div className="row cp-avaliacao cp-gap-4" role="group" aria-label="Avaliação da resposta">
        <span className="tiny muted cp-avaliacao-texto">{agradecer ? 'Obrigado pela avaliação.' : 'Esta resposta ajudou?'}</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Resposta útil"
          aria-pressed={valor === 'util'}
          onClick={() => votar('util')}
        >
          <Icone nome="polegar" tamanho="sm" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label="Resposta não útil"
          aria-pressed={valor === 'nao_util'}
          onClick={() => votar('nao_util')}
        >
          <Icone nome="polegarBaixo" tamanho="sm" />
        </button>
      </div>
      <ErroAcao erro={erro} />
    </div>
  );
}

/** Cartões que ficam dentro da coluna da mensagem (os chips e a avaliação ficam fora, recuados). */
export function CartaoBloco({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case 'confirmacao':
      return <CartaoConfirmacao bloco={bloco} />;
    case 'progresso':
      return <CartaoProgresso bloco={bloco} />;
    case 'recibo':
      return <CartaoRecibo bloco={bloco} />;
    case 'conflito':
      return <CartaoConflito bloco={bloco} />;
    case 'erro':
      return <CartaoErro bloco={bloco} />;
    case 'aprovacao':
      return <CartaoAprovacao bloco={bloco} />;
    case 'fontes':
      return <ListaFontes bloco={bloco} />;
    case 'resumo_humano':
      return <CartaoResumoHumano bloco={bloco} />;
    default:
      return null;
  }
}

// Lista de mensagens da conversa (W2–W8): bolhas, cartões, etiquetas do sistema e indicador de digitando.
import { Fragment, type ReactNode } from 'react';
import type { EstadoConversa, MensagemWidget, PaginaContexto, WidgetInicio } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { useAcoesChat } from './acoes.tsx';
import { Avaliacao, CartaoBloco, ChipsSugestoes, ListaColeta } from './blocos.tsx';
import type { EstadoChat, MensagemLocal } from './controlador.ts';
import { AvatarCopiloto, AvatarPessoa, Icone, type NomeIcone } from './icones.tsx';
import { Markdown, MarkdownLinha } from './markdown.tsx';
import { maiusculaInicial, nomeComArtigo } from './util.ts';

const ICONE_SISTEMA: Record<NonNullable<MensagemWidget['icone']>, NomeIcone> = {
  check: 'check',
  info: 'info',
  pessoa: 'pessoa',
  relogio: 'relogio',
  aviso: 'aviso',
};

const BLOCOS_FORA = new Set(['coleta', 'sugestoes', 'avaliacao']);
/** Blocos de uma mensagem de continuação depois do recibo ("Quer seguir com a ACME?"). */
const BLOCOS_CONTINUACAO = new Set(['sugestoes', 'avaliacao']);
/** No conflito (W6) a pergunta fica embaixo do cartão, como no design; o servidor também a manda no texto. */
const PERGUNTA_CONFLITO = /\s*Como prefere seguir\?[^\n]*$/;

export function rotuloDia(iso: string, agora = new Date()): string {
  const dia = fmt.data(iso);
  if (dia === fmt.data(agora)) return 'Hoje';
  if (dia === fmt.data(new Date(agora.getTime() - 86400000))) return 'Ontem';
  return dia;
}

function hora(iso: string): string {
  try {
    return fmt.hora(iso);
  } catch {
    return '';
  }
}

function EtiquetaCentral({ icone, children }: { icone?: NomeIcone; children: ReactNode }) {
  return (
    <div className="row cp-centro">
      <span className="context-pill cp-etiqueta">
        {icone && <Icone nome={icone} tamanho="sm" />}
        <span>{children}</span>
      </span>
    </div>
  );
}

function MensagemUsuario({ m }: { m: MensagemLocal }) {
  const acoes = useAcoesChat();
  const local = m.local;
  return (
    <div className={`msg msg-user${local ? ` cp-msg-${local.situacao}` : ''}`}>
      <div className="stack-sm cp-gap-4 cp-fim">
        {m.texto && <div className="bubble cp-texto-usuario">{m.texto}</div>}
        {m.anexos && m.anexos.length > 0 && (
          <ul className="cp-anexos cp-anexos-msg" aria-label="Anexos">
            {m.anexos.map((a) => (
              <li key={a.id} className="cp-anexo">
                <Icone nome="clipe" tamanho="sm" />
                <span className="cp-anexo-nome">{a.nome}</span>
              </li>
            ))}
          </ul>
        )}
        {!local && <div className="msg-meta">{hora(m.criadoEm)}</div>}
        {local?.situacao === 'enviando' && <div className="msg-meta">Enviando…</div>}
        {local?.situacao === 'na_fila' && (
          <div className="msg-meta row cp-gap-4">
            <Icone nome="relogio" tamanho="sm" />
            Na fila. Envio assim que a conexão voltar.
          </div>
        )}
        {local?.situacao === 'falhou' && (
          <div className="msg-meta cp-meta-falhou" role="alert">
            <span className="row cp-gap-4 text-danger">
              <Icone nome="aviso" tamanho="sm" />
              Não foi enviada.{local.erro ? ` ${local.erro}` : ''}
            </span>
            <span className="row cp-gap-4">
              <button type="button" className="cp-link" onClick={() => acoes.reenviar(local.idCliente)}>
                Tentar de novo
              </button>
              <button type="button" className="cp-link cp-link-neutro" onClick={() => acoes.descartar(local.idCliente)}>
                Descartar
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MensagemBot({
  m,
  inicio,
  estadoConversa,
  mostrarRotulo,
}: {
  m: MensagemLocal;
  inicio: WidgetInicio;
  estadoConversa: EstadoConversa;
  mostrarRotulo: boolean;
}) {
  const acoes = useAcoesChat();
  const pessoa = m.autor === 'pessoa';
  const coleta = m.blocos.find((b) => b.tipo === 'coleta');
  const cartoes = m.blocos.filter((b) => !BLOCOS_FORA.has(b.tipo));
  const sugestoes = m.blocos.filter((b) => b.tipo === 'sugestoes');
  const avaliar = m.blocos.some((b) => b.tipo === 'avaliacao');
  const larga = cartoes.length > 0;
  const comFontes = m.blocos.some((b) => b.tipo === 'fontes');
  const esperandoTexto = m.emAndamento && !m.texto && !coleta;
  const execucaoConflito = m.blocos.find((b) => b.tipo === 'conflito')?.execucaoId;
  const textoBolha = execucaoConflito && m.texto ? m.texto.replace(PERGUNTA_CONFLITO, '') : m.texto;
  // A nota não repete o código da execução, o "Pode fechar esta janela" que o cartão de progresso já mostra,
  // nem o horário do atendimento humano enquanto ele aparece embaixo da caixa de mensagem (W8).
  const horarioNoRodape =
    estadoConversa.modo !== 'copiloto' && m.nota === `Atendimento por pessoas: ${inicio.config.atendimentoHumano.horario}`;
  const nota =
    m.nota && m.nota !== execucaoConflito && !horarioNoRodape && !m.blocos.some((b) => b.tipo === 'progresso') ? m.nota : null;
  const papel = estadoConversa.modo === 'pessoa' ? estadoConversa.atendente.papel : 'Suporte';
  const nomePessoa = m.autorNome ?? (estadoConversa.modo === 'pessoa' ? estadoConversa.atendente.nome : 'Suporte');
  const iniciais =
    m.autorIniciais ?? (estadoConversa.modo === 'pessoa' && !m.autorNome ? estadoConversa.atendente.iniciais : fmt.iniciais(nomePessoa));
  const temBolha = Boolean(textoBolha) || Boolean(coleta) || esperandoTexto;
  const abrir = (url: string) => {
    const l = acoes.link(url);
    window.open(l.href, l.target ?? '_self', 'noopener');
  };

  return (
    <>
      <div className={`msg msg-bot${larga ? ' cp-msg-larga' : ''}`}>
        {pessoa ? <AvatarPessoa iniciais={iniciais} pequeno /> : <AvatarCopiloto tamanho="sm" />}
        <div className={`stack-sm ${larga ? 'grow cp-gap-8' : 'cp-gap-4'} cp-min0`}>
          {mostrarRotulo && (
            <span className="tiny strong cp-recuo-4">
              {pessoa ? nomePessoa : inicio.config.nome}{' '}
              <span className="muted cp-peso-normal">· {pessoa ? papel : 'assistente virtual'}</span>
            </span>
          )}
          {temBolha && (
            <div className={`bubble${pessoa ? ' cp-bolha-pessoa' : ''}${coleta ? ' cp-bolha-coleta' : ''}${esperandoTexto ? ' cp-bolha-digitando' : ''}`}>
              {textoBolha ? <Markdown texto={textoBolha} citacoes={comFontes} abrir={abrir} /> : null}
              {esperandoTexto && (
                <>
                  <div className="typing" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="sr-only">{pessoa ? `${nomePessoa} está escrevendo` : 'O copiloto está escrevendo'}</span>
                </>
              )}
              {coleta && coleta.tipo === 'coleta' && <ListaColeta bloco={coleta} />}
            </div>
          )}
          {cartoes.map((b, i) => (
            <CartaoBloco key={`${b.tipo}-${i}`} bloco={b} />
          ))}
          {!m.emAndamento && (
            <div className="msg-meta">
              {hora(m.criadoEm)}
              {execucaoConflito && (
                <>
                  {' · '}
                  <span className="mono">{execucaoConflito}</span>
                </>
              )}
              {nota && ` · ${nota}`}
            </div>
          )}
        </div>
      </div>
      {sugestoes.map((b, i) => b.tipo === 'sugestoes' && <ChipsSugestoes key={`s-${i}`} bloco={b} />)}
      {avaliar && !m.emAndamento && <Avaliacao mensagem={m} />}
    </>
  );
}

function Digitando({ estado, inicio }: { estado: EstadoChat; inicio: WidgetInicio }) {
  if (!estado.digitando) return null;
  const pessoa = estado.digitando.autor === 'pessoa';
  const atendente = estado.estadoConversa.modo === 'pessoa' ? estado.estadoConversa.atendente : null;
  // Já existe uma mensagem chegando por streaming: os três pontinhos ficam dentro dela.
  if (!pessoa && estado.mensagens.some((m) => m.emAndamento && m.autor === 'copiloto')) return null;
  const nome = atendente?.nome ?? 'Suporte';
  return (
    <div className="msg msg-bot cp-digitando">
      {pessoa ? <AvatarPessoa iniciais={atendente?.iniciais ?? fmt.iniciais(nome)} pequeno /> : <AvatarCopiloto tamanho="sm" />}
      <div className="stack-sm cp-gap-4">
        {pessoa && <span className="tiny muted cp-recuo-4">{nome} está escrevendo…</span>}
        <div className={`bubble cp-bolha-digitando${pessoa ? ' cp-bolha-pessoa' : ''}`}>
          <div className="typing" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="sr-only">{pessoa ? `${nome} está escrevendo` : `${maiusculaInicial(nomeComArtigo(inicio.config.nome))} está escrevendo`}</span>
        </div>
      </div>
    </div>
  );
}

export function ListaMensagens({
  estado,
  inicio,
  contextoPagina,
}: {
  estado: EstadoChat;
  inicio: WidgetInicio;
  contextoPagina?: PaginaContexto;
}) {
  const acoes = useAcoesChat();
  const { mensagens, estadoConversa } = estado;
  const houvePessoa = estadoConversa.modo !== 'copiloto' || mensagens.some((m) => m.autor === 'pessoa');
  const secao = estado.contexto?.secao ?? contextoPagina?.secao;
  const itens: ReactNode[] = [];
  let diaAnterior: string | null = null;

  mensagens.forEach((m, i) => {
    const dia = (() => {
      try {
        return fmt.data(m.criadoEm);
      } catch {
        return diaAnterior ?? '';
      }
    })();
    if (dia !== diaAnterior) {
      const rotulo = rotuloDia(m.criadoEm);
      itens.push(
        <EtiquetaCentral key={`dia-${dia}-${i}`}>{diaAnterior === null && secao ? `${rotulo} · Você está em ${secao}` : rotulo}</EtiquetaCentral>,
      );
      diaAnterior = dia;
    }
    if (m.autor === 'sistema') {
      itens.push(
        <div key={m.id} role="status">
          <EtiquetaCentral icone={m.icone ? ICONE_SISTEMA[m.icone] : undefined}>
            <MarkdownLinha texto={m.texto ?? ''} />
          </EtiquetaCentral>
        </div>,
      );
      return;
    }
    if (m.autor === 'usuario') {
      itens.push(<MensagemUsuario key={m.id} m={m} />);
      return;
    }
    const anterior = mensagens[i - 1];
    const primeiraDoAutor = !anterior || anterior.autor !== m.autor || anterior.autorNome !== m.autorNome;
    itens.push(
      <Fragment key={m.id}>
        <MensagemBot
          m={m}
          inicio={inicio}
          estadoConversa={estadoConversa}
          mostrarRotulo={primeiraDoAutor && (m.autor === 'pessoa' || houvePessoa)}
        />
      </Fragment>,
    );
  });

  // "Novo pedido" (W5): a conversa terminou num recibo, seguido no máximo da continuação com sugestões e avaliação.
  let iRecibo = mensagens.length - 1;
  while (iRecibo >= 0 && !mensagens[iRecibo].blocos.some((b) => b.tipo === 'recibo')) iRecibo--;
  const terminouComRecibo =
    iRecibo >= 0 &&
    !estado.digitando &&
    mensagens
      .slice(iRecibo)
      .every(
        (m, i) =>
          !m.emAndamento && (i === 0 || (m.autor === 'copiloto' && m.blocos.every((b) => BLOCOS_CONTINUACAO.has(b.tipo)))),
      );

  return (
    <>
      {itens}
      {estadoConversa.modo === 'aguardando_pessoa' && (
        <div role="status" className="stack-sm cp-gap-4">
          <EtiquetaCentral icone="relogio">Chamei uma pessoa do suporte. Assim que alguém entrar, aviso aqui.</EtiquetaCentral>
          <p className="tiny muted cp-texto-centro">Atendimento por pessoas: {inicio.config.atendimentoHumano.horario}</p>
        </div>
      )}
      {estado.devolvidoPor && estadoConversa.modo === 'copiloto' && (
        <div role="status">
          <EtiquetaCentral icone="brilho">
            {estado.devolvidoPor} encerrou o atendimento. {maiusculaInicial(nomeComArtigo(inicio.config.nome))} voltou a responder.
          </EtiquetaCentral>
        </div>
      )}
      <Digitando estado={estado} inicio={inicio} />
      {terminouComRecibo && (
        <div className="row cp-centro cp-novo-pedido">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => acoes.novaConversa()}>
            <Icone nome="mais" tamanho="sm" />
            Novo pedido
          </button>
        </div>
      )}
    </>
  );
}

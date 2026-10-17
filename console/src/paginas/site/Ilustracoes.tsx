// Ilustrações do site, em HTML e CSS (sem imagens): o assistente aberto dentro do sistema de um
// cliente, confirmando um chamado, e as miniaturas de "Como funciona" (gravar, configurar, executar).
// São figuras: os botões delas não fazem nada e ficam fora da navegação pelo teclado.
import type { CSSProperties } from 'react';
import { Icone } from '../../componentes/icones.tsx';

/** Bloco cinza do sistema fictício (linhas de texto, cartões, menu). */
function Bloco({ w, h, redondo, grow }: { w?: CSSProperties['width']; h: number; redondo?: number | string; grow?: boolean }) {
  return <span className={`host-block${grow ? ' grow' : ''}`} style={{ width: w, height: h, borderRadius: redondo }} />;
}

const LINHAS_HOST: CSSProperties['width'][] = ['100%', '100%', '92%', '100%', '84%', '96%'];

export function AssistenteNoSistema() {
  return (
    <div className="host st-host" role="group" aria-label="Exemplo: o assistente aberto dentro do sistema de um cliente">
      <div className="row st-host-topo" aria-hidden="true">
        <Bloco w={28} h={28} redondo={8} />
        <Bloco w={120} h={12} />
        <span className="grow" />
        <Bloco w={28} h={28} redondo="50%" />
      </div>
      <div className="row-top st-host-corpo" aria-hidden="true">
        <div className="stack-sm hide-sm st-host-menu">
          {[90, 100, 80, 96, 70].map((w, i) => (
            <Bloco key={i} w={w} h={12} />
          ))}
        </div>
        <div className="stack grow">
          <Bloco w={180} h={18} />
          <div className="row" style={{ gap: 12 }}>
            <Bloco h={64} grow />
            <Bloco h={64} grow />
            <Bloco h={64} grow />
          </div>
          {LINHAS_HOST.map((w, i) => (
            <Bloco key={i} w={w} h={14} />
          ))}
        </div>
      </div>

      <div className="toast hide-sm st-host-toast">
        <Icone nome="check" />
        <span>
          Abrir chamado: feito · <span className="mono">Chamado #1287</span>
        </span>
      </div>

      <div className="widget st-host-widget">
        <div className="widget-head">
          <span className="avatar avatar-bot" aria-hidden="true">
            HG
          </span>
          <div className="grow">
            <div className="title">Assistente Horizonte</div>
            <div className="status">Online</div>
          </div>
          <span className="btn btn-ghost btn-icon btn-sm" aria-hidden="true">
            <Icone nome="menos" />
          </span>
        </div>
        <div className="widget-body">
          <div className="msg msg-user">
            <div>
              <div className="bubble">Abre um chamado para a Padaria Estrela sobre impressora sem tinta, prioridade alta</div>
              <div className="msg-meta" style={{ textAlign: 'right' }}>
                Ana · 10:42
              </div>
            </div>
          </div>
          <div className="action-card">
            <div className="ac-head">
              <Icone nome="tarefas" tamanho="sm" />
              Confirme: Abrir chamado
            </div>
            <div className="ac-body">
              <dl className="kv">
                <dt>Cliente</dt>
                <dd>Padaria Estrela</dd>
                <dt>Assunto</dt>
                <dd>Impressora sem tinta</dd>
                <dt>Prioridade</dt>
                <dd>Alta</dd>
                <dt>Descrição</dt>
                <dd>A impressora do caixa parou de imprimir.</dd>
              </dl>
            </div>
            <div className="ac-foot" aria-hidden="true">
              <span className="btn btn-secondary btn-sm">Corrigir</span>
              <span className="btn btn-primary btn-sm grow">Confirmar e executar</span>
            </div>
          </div>
        </div>
        <div className="widget-foot" aria-hidden="true">
          <div className="composer">
            <span className="st-host-dica">Peça algo ao assistente</span>
            <span className="btn btn-primary btn-icon btn-sm">
              <Icone nome="enviar" tamanho="sm" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 1 · Grave: a barra da extensão gravando. */
export function MiniGravando() {
  return (
    <div className="card-flat stack-sm st-ilustra">
      <div className="row between">
        <span className="row small strong" style={{ gap: 8 }}>
          <span aria-hidden="true" className="st-gravando" />
          Gravando · Abrir chamado
        </span>
        <span className="badge badge-outline num">6 passos</span>
      </div>
      <p className="tiny muted">O que você digita não é gravado, só o formato.</p>
      <div className="row" style={{ gap: 8 }}>
        <span className="btn btn-primary btn-sm" aria-hidden="true">
          Concluir
        </span>
        <span className="btn btn-ghost btn-sm" aria-hidden="true">
          Cancelar
        </span>
      </div>
    </div>
  );
}

/** 2 · Configure: as tarefas publicadas e em teste. */
export function MiniTarefas() {
  const tarefas: [string, boolean][] = [
    ['Abrir chamado', true],
    ['Cadastrar cliente', true],
    ['Segunda via de boleto', false],
  ];
  return (
    <div className="card-flat st-ilustra-lista">
      {tarefas.map(([nome, publicada]) => (
        <div key={nome} className="row between">
          <span className="small strong">{nome}</span>
          <span className={`badge ${publicada ? 'badge-success' : 'badge-warning'}`}>
            <span className="dot" />
            {publicada ? 'Publicada' : 'Em teste'}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 3 · Execute: o recibo com o número do registro. */
export function MiniRecibo() {
  return (
    <div className="card-flat stack-sm st-ilustra">
      <div className="row" style={{ gap: 8 }}>
        <span className="avatar avatar-sm st-feito" aria-hidden="true">
          <Icone nome="check" tamanho="sm" />
        </span>
        <span className="small strong">Abrir chamado: feito</span>
      </div>
      <p className="small">
        <span className="mono">Chamado #1287</span> · Padaria Estrela · prioridade alta
      </p>
      <p className="tiny muted">Feito pela tela em 6 s, com a sessão de Ana Ribeiro.</p>
    </div>
  );
}

// Peças de formulário e de página: campo com rótulo/ajuda/erro, controle segmentado,
// cabeçalho de página, aviso e barra de progresso.
//
//   <Campo rotulo="E-mail de cobrança" obrigatorio erro={erroEmail} ajuda="Para onde vai a fatura.">
//     {(p) => <input className="input" type="email" value={email} onChange={...} {...p} />}
//   </Campo>
//   (p traz id, aria-invalid, aria-describedby e a classe de erro: espalhe no input)
//
//   <Segmentado rotulo="Período" valor={periodo} aoTrocar={setPeriodo}
//               opcoes={[{ valor: '7d', rotulo: '7 dias' }, { valor: '30d', rotulo: '30 dias' }]} />
//
//   <CabecalhoPagina titulo="Tarefas" subtitulo="O copiloto só executa o que está nesta lista."
//                    selos={<SeloExemplo />} acoes={<Botao variante="primario">Nova tarefa</Botao>} />
//
//   <Aviso tipo="aviso" titulo="Você usou 80% do limite" acoes={<Botao tamanho="sm">Ajustar</Botao>}>texto</Aviso>
//
//   <Progresso valor={0.54} rotulo="Gasto do mês" />
//
//   {envio === 'caixa_local' ? <NotaCaixaDeSaida /> : null}
import { useId, type ReactNode } from 'react';
import type { EnvioEmail } from '@copiloto/shared';
import { Icone, type NomeIcone } from './icones.tsx';

export interface PropsControle {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  'aria-required'?: true;
  className?: string;
}

export function Campo({
  rotulo,
  ajuda,
  erro,
  ok,
  obrigatorio,
  children,
  classe,
  rotuloOculto,
  style,
}: {
  rotulo: ReactNode;
  ajuda?: ReactNode;
  erro?: string | null;
  /** Mensagem de sucesso (ex.: "CNPJ válido"). */
  ok?: string | null;
  obrigatorio?: boolean;
  /** Recebe as props do controle (id, aria-*) e devolve o input/select/textarea. */
  children: (p: PropsControle) => ReactNode;
  /** Classe base do controle: 'input' (padrão), 'select' ou 'textarea'. */
  classe?: 'input' | 'select' | 'textarea';
  rotuloOculto?: boolean;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const descritores = [erro ? `${id}-erro` : '', !erro && ok ? `${id}-ok` : '', ajuda ? `${id}-ajuda` : ''].filter(Boolean).join(' ');
  const p: PropsControle = {
    id,
    className: `${classe ?? 'input'}${erro ? ' is-error' : ''}`,
    ...(erro ? { 'aria-invalid': true as const } : {}),
    ...(descritores ? { 'aria-describedby': descritores } : {}),
    ...(obrigatorio ? { 'aria-required': true as const } : {}),
  };
  return (
    <div className="field" style={style}>
      <label htmlFor={id} className={rotuloOculto ? 'sr-only' : undefined}>
        {rotulo}
        {obrigatorio ? (
          <>
            {' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </>
        ) : null}
      </label>
      {children(p)}
      {erro ? (
        <span className="error-text" id={`${id}-erro`}>
          <Icone nome="alerta" tamanho="sm" />
          {erro}
        </span>
      ) : ok ? (
        <span className="help text-success" id={`${id}-ok`}>
          {ok}
        </span>
      ) : null}
      {ajuda ? (
        <span className="help" id={`${id}-ajuda`}>
          {ajuda}
        </span>
      ) : null}
    </div>
  );
}

export interface OpcaoSegmentado<V extends string> {
  valor: V;
  rotulo: ReactNode;
  icone?: NomeIcone;
}

export function Segmentado<V extends string>({
  opcoes,
  valor,
  aoTrocar,
  rotulo,
  desativado,
}: {
  opcoes: OpcaoSegmentado<V>[];
  valor: V;
  aoTrocar: (v: V) => void;
  rotulo: string;
  desativado?: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          className={o.valor === valor ? 'on' : undefined}
          aria-pressed={o.valor === valor}
          disabled={desativado}
          onClick={() => aoTrocar(o.valor)}
        >
          {o.icone ? (
            <span className="row" style={{ gap: 6 }}>
              <Icone nome={o.icone} tamanho="sm" />
              {o.rotulo}
            </span>
          ) : (
            o.rotulo
          )}
        </button>
      ))}
    </div>
  );
}

export function CabecalhoPagina({
  titulo,
  subtitulo,
  eyebrow,
  selos,
  acoes,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  eyebrow?: ReactNode;
  selos?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="stack-sm ca-cabecalho-texto">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="row wrap">
          <h1 className="h1">{titulo}</h1>
          {selos}
        </div>
        {subtitulo ? <p className="muted">{subtitulo}</p> : null}
      </div>
      {acoes ? <div className="row wrap ca-cabecalho-acoes">{acoes}</div> : null}
    </div>
  );
}

const ICONE_AVISO: Record<'info' | 'sucesso' | 'aviso' | 'erro', NomeIcone> = {
  info: 'info',
  sucesso: 'check',
  aviso: 'alerta',
  erro: 'alerta',
};
const CLASSE_AVISO = { info: '', sucesso: 'alert-success', aviso: 'alert-warning', erro: 'alert-danger' };

export function Aviso({
  tipo = 'info',
  titulo,
  children,
  acoes,
  papel,
}: {
  tipo?: 'info' | 'sucesso' | 'aviso' | 'erro';
  titulo?: ReactNode;
  children?: ReactNode;
  acoes?: ReactNode;
  /** 'alert' para erros que precisam ser lidos na hora; 'status' para o resto. */
  papel?: 'alert' | 'status';
}) {
  return (
    <div className={`alert ${CLASSE_AVISO[tipo]}`} role={papel ?? (tipo === 'erro' ? 'alert' : undefined)}>
      <Icone nome={ICONE_AVISO[tipo]} />
      <div className="stack-sm grow" style={{ gap: 'var(--s-1)' }}>
        {titulo ? <p className="strong">{titulo}</p> : null}
        {children ? <div className="small">{children}</div> : null}
        {acoes ? (
          <div className="row wrap" style={{ gap: 'var(--s-3)', marginTop: 'var(--s-1)' }}>
            {acoes}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Progresso({ valor, rotulo, cor, altura }: { valor: number; rotulo: string; cor?: string; altura?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(valor * 100)));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={rotulo}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={altura ? { height: altura } : undefined}
    >
      <span style={{ width: `${pct}%`, background: cor }} />
    </div>
  );
}

/**
 * O servidor não tem SMTP_URL: o e-mail (código, link de senha nova, convite) não saiu e ficou em
 * DATA_DIR/caixa-de-saida. Aparece nas telas que avisam "enviamos um e-mail".
 */
export function NotaCaixaDeSaida({ envio = 'caixa_local' }: { envio?: EnvioEmail }) {
  if (envio !== 'caixa_local') return null;
  return (
    <div className="card-flat ca-nota" role="note">
      <Icone nome="info" tamanho="sm" />
      <p className="small">
        O envio de e-mail ainda não está configurado neste servidor (<span className="mono">SMTP_URL</span>). A mensagem ficou na pasta{' '}
        <span className="mono">caixa-de-saida</span> dos dados do servidor.
      </p>
    </div>
  );
}

// Janela modal (diálogo) e confirmação destrutiva.
//
//   <Modal aberto={aberto} titulo="Descrever a tarefa" aoFechar={() => setAberto(false)}
//          rodape={<><Botao onClick={fechar}>Cancelar</Botao><Botao variante="primario">Montar a ficha</Botao></>}>
//     ...conteúdo...
//   </Modal>
//
//   <Confirmar aberto={aberto} titulo="Desativar a tarefa X?" texto="O copiloto vai parar..."
//              rotuloConfirmar="Desativar" perigo aoConfirmar={desativar} aoFechar={fechar} />
//
// Fecha com Esc e com clique fora (a não ser que `travado`), prende o foco dentro e devolve o foco
// para quem abriu ao fechar.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Botao } from './Botao.tsx';
import { Icone } from './icones.tsx';

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Prende o Tab dentro do elemento e devolve o foco ao fechar. Usado por Modal e Gaveta. */
export function usePrenderFoco(aberto: boolean, ref: React.RefObject<HTMLElement | null>, aoFechar?: () => void) {
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const primeiro = el?.querySelector<HTMLElement>('[data-autofoco]') ?? el?.querySelector<HTMLElement>(FOCAVEIS);
    (primeiro ?? el)?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fechar.current) {
        e.stopPropagation();
        fechar.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const itens = [...el.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (itens.length === 0) return;
      const ini = itens[0];
      const fim = itens[itens.length - 1];
      if (e.shiftKey && document.activeElement === ini) {
        e.preventDefault();
        fim.focus();
      } else if (!e.shiftKey && document.activeElement === fim) {
        e.preventDefault();
        ini.focus();
      }
    };
    document.addEventListener('keydown', tecla, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla, true);
      document.body.style.overflow = overflow;
      anterior?.focus?.();
    };
  }, [aberto, ref]);
}

export interface PropsModal {
  aberto: boolean;
  titulo: ReactNode;
  /** Texto curto abaixo do título. */
  descricao?: ReactNode;
  aoFechar: () => void;
  children?: ReactNode;
  /** Botões do rodapé (o primário por último). */
  rodape?: ReactNode;
  largura?: number;
  /** Impede fechar por Esc ou clique fora (ex.: enquanto salva). */
  travado?: boolean;
}

export function Modal({ aberto, titulo, descricao, aoFechar, children, rodape, largura = 560, travado = false }: PropsModal) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  usePrenderFoco(aberto, ref, travado ? undefined : aoFechar);
  if (!aberto) return null;
  return createPortal(
    <div
      className="ca-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !travado) aoFechar();
      }}
    >
      <div
        ref={ref}
        className="card ca-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={descricao ? `${id}-d` : undefined}
        style={{ maxWidth: largura }}
        tabIndex={-1}
      >
        <div className="ca-modal-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h4" id={`${id}-t`}>
              {titulo}
            </h2>
            {descricao ? (
              <p className="small muted" id={`${id}-d`}>
                {descricao}
              </p>
            ) : null}
          </div>
          {!travado ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar" onClick={aoFechar}>
              <Icone nome="fechar" tamanho="sm" />
            </button>
          ) : null}
        </div>
        {children ? <div className="ca-modal-corpo stack">{children}</div> : null}
        {rodape ? <div className="card-foot">{rodape}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface PropsConfirmar {
  aberto: boolean;
  titulo: ReactNode;
  texto: ReactNode;
  rotuloConfirmar: string;
  rotuloCancelar?: string;
  perigo?: boolean;
  carregando?: boolean;
  /** Erro da ação, mostrado acima dos botões. */
  erro?: string | null;
  aoConfirmar: () => void;
  aoFechar: () => void;
}

/** Confirmação de ação que muda algo importante (desativar, descartar, restaurar). */
export function Confirmar({
  aberto,
  titulo,
  texto,
  rotuloConfirmar,
  rotuloCancelar = 'Cancelar',
  perigo = false,
  carregando = false,
  erro,
  aoConfirmar,
  aoFechar,
}: PropsConfirmar) {
  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      aoFechar={aoFechar}
      travado={carregando}
      largura={480}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={carregando} data-autofoco>
            {rotuloCancelar}
          </Botao>
          <Botao variante={perigo ? 'perigo' : 'primario'} carregando={carregando} onClick={aoConfirmar}>
            {rotuloConfirmar}
          </Botao>
        </>
      }
    >
      <p className="small muted">{texto}</p>
      {erro ? (
        <p className="error-text" role="alert">
          <Icone nome="alerta" tamanho="sm" />
          {erro}
        </p>
      ) : null}
    </Modal>
  );
}

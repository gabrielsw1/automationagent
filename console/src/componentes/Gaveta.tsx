// Gaveta lateral (painel que desliza da borda), usada no "Testar copiloto" e no menu do celular.
//
//   <Gaveta aberta={aberta} titulo="Testar copiloto" aoFechar={() => setAberta(false)} largura={440}>
//     ...conteúdo...
//   </Gaveta>
//
// `lado="esquerda"` abre pela esquerda (menu do celular). Esc e clique fora fecham.
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from './icones.tsx';
import { usePrenderFoco } from './Modal.tsx';

export interface PropsGaveta {
  aberta: boolean;
  titulo: ReactNode;
  aoFechar: () => void;
  children?: ReactNode;
  /** Conteúdo fixo embaixo (ex.: aviso). */
  rodape?: ReactNode;
  lado?: 'direita' | 'esquerda';
  largura?: number;
  /** Esconde o título visualmente (continua para leitores de tela). */
  semCabecalho?: boolean;
}

export function Gaveta({ aberta, titulo, aoFechar, children, rodape, lado = 'direita', largura = 440, semCabecalho }: PropsGaveta) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  usePrenderFoco(aberta, ref, aoFechar);
  if (!aberta) return null;
  return createPortal(
    <div
      className="ca-fundo ca-fundo-gaveta"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <aside
        ref={ref}
        className={`ca-gaveta ca-gaveta-${lado}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        style={{ width: `min(${largura}px, 100vw)` }}
        tabIndex={-1}
      >
        <div className={semCabecalho ? 'sr-only' : 'ca-gaveta-head'}>
          <h2 className="h4" id={`${id}-t`}>
            {titulo}
          </h2>
          {!semCabecalho ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar" onClick={aoFechar}>
              <Icone nome="fechar" tamanho="sm" />
            </button>
          ) : null}
        </div>
        <div className="ca-gaveta-corpo">{children}</div>
        {rodape ? <div className="ca-gaveta-rodape">{rodape}</div> : null}
      </aside>
    </div>,
    document.body,
  );
}

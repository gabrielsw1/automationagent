// Menu suspenso preso a um botão (menu do avatar, "Nova tarefa", "Mais ações").
//
//   <Menu rotulo="Nova tarefa" botao={(p) => <Botao variante="primario" icone="mais" iconeDepois="seta-baixo" {...p}>Nova tarefa</Botao>}>
//     {(fechar) => (
//       <>
//         <ItemMenu titulo="Descrever a tarefa" descricao="Escreva em português..." icone="chat" aoClicar={() => { fechar(); abrir(); }} />
//         <ItemMenu titulo="Gravar o fluxo na tela" para="/aprender" icone="aprender" />
//       </>
//     )}
//   </Menu>
//
// Fecha com Esc, com clique fora e ao escolher um item. Setas para cima/baixo andam entre os itens.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icone, type NomeIcone } from './icones.tsx';

export interface PropsBotaoMenu {
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick: () => void;
}

export function Menu({
  botao,
  children,
  largura = 320,
  alinhar = 'direita',
}: {
  botao: (p: PropsBotaoMenu) => ReactNode;
  children: (fechar: () => void) => ReactNode;
  largura?: number;
  alinhar?: 'direita' | 'esquerda';
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const fechar = () => setAberto(false);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      }
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const setas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const itens = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const prox = itens[(i + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length];
    prox?.focus();
  };

  return (
    <div className="ca-menu" ref={ref}>
      {botao({ 'aria-haspopup': 'menu', 'aria-expanded': aberto, 'aria-controls': id, onClick: () => setAberto((a) => !a) })}
      {aberto ? (
        <div
          id={id}
          className={`card ca-menu-lista ca-menu-${alinhar}`}
          role="menu"
          style={{ width: `min(${largura}px, calc(100vw - 32px))` }}
          onKeyDown={setas}
        >
          {children(fechar)}
        </div>
      ) : null}
    </div>
  );
}

export function ItemMenu({
  titulo,
  descricao,
  icone,
  aoClicar,
  para,
  perigo,
  destaque,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  icone?: NomeIcone;
  aoClicar?: () => void;
  /** Rota do console: vira um link. */
  para?: string;
  perigo?: boolean;
  /** Fundo cinza (a opção recomendada). */
  destaque?: boolean;
}) {
  const conteudo = (
    <>
      {icone ? (
        descricao ? (
          <span className="avatar ca-menu-icone" aria-hidden="true">
            <Icone nome={icone} tamanho="sm" />
          </span>
        ) : (
          <Icone nome={icone} tamanho="sm" />
        )
      ) : null}
      <span className="stack-sm" style={{ gap: 2 }}>
        <span className={descricao ? 'strong ca-menu-titulo' : undefined}>{titulo}</span>
        {descricao ? <span className="small muted ca-menu-desc">{descricao}</span> : null}
      </span>
    </>
  );
  const cls = `ca-menu-item${descricao ? ' ca-menu-item-grande' : ''}${perigo ? ' text-danger' : ''}${destaque ? ' ca-menu-item-destaque' : ''}`;
  if (para) {
    return (
      <Link role="menuitem" className={cls} to={para} onClick={aoClicar}>
        {conteudo}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={aoClicar}>
      {conteudo}
    </button>
  );
}

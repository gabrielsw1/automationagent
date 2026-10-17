// Abas de uma página (ex.: Ficha · Execução · Permissões · Testes · Histórico).
//
//   <Abas rotulo="Seções da tarefa" ativa={aba} aoTrocar={setAba}
//         abas={[{ chave: 'ficha', rotulo: 'Ficha' }, { chave: 'testes', rotulo: 'Testes', selo: <span className="badge">18/20</span> }]} />
//
// Setas esquerda/direita trocam de aba pelo teclado. O conteúdo da aba fica com o chamador
// (use id={`painel-${chave}`} e aria-labelledby={`aba-${chave}`} se quiser ligar os dois).
import type { KeyboardEvent, ReactNode } from 'react';

export interface Aba<C extends string = string> {
  chave: C;
  rotulo: ReactNode;
  /** Selo depois do rótulo (contagem, aprovados...). */
  selo?: ReactNode;
}

export function Abas<C extends string>({
  abas,
  ativa,
  aoTrocar,
  rotulo,
}: {
  abas: Aba<C>[];
  ativa: C;
  aoTrocar: (chave: C) => void;
  rotulo: string;
}) {
  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = abas.findIndex((a) => a.chave === ativa);
    const prox = abas[(i + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    aoTrocar(prox.chave);
    const alvo = e.currentTarget.querySelector<HTMLButtonElement>(`[data-aba="${prox.chave}"]`);
    alvo?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={rotulo} onKeyDown={teclado}>
      {abas.map((a) => (
        <button
          key={a.chave}
          type="button"
          role="tab"
          id={`aba-${a.chave}`}
          data-aba={a.chave}
          aria-selected={a.chave === ativa}
          aria-controls={`painel-${a.chave}`}
          tabIndex={a.chave === ativa ? 0 : -1}
          className={`tab${a.chave === ativa ? ' active' : ''}`}
          onClick={() => aoTrocar(a.chave)}
        >
          {a.rotulo}
          {a.selo}
        </button>
      ))}
    </div>
  );
}

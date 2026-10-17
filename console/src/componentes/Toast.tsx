// Avisos rápidos no canto da tela ("Tarefa publicada. A versão 5 já está valendo.").
//
//   const toast = useToast();
//   toast.sucesso('Rascunho salvo.');
//   toast.erro('Não consegui salvar. Tente de novo.');
//   toast.mostrar({ texto: 'Tarefa publicada.', acao: { rotulo: 'Desfazer', aoClicar: desfazer } });
//
// Some em 8 s, mas não enquanto o mouse ou o foco estiverem sobre ele. O <ProvedorToast> fica no App.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icone } from './icones.tsx';

export interface OpcoesToast {
  texto: string;
  tipo?: 'sucesso' | 'erro' | 'info';
  acao?: { rotulo: string; aoClicar: () => void };
  duracaoMs?: number;
}

interface ItemToast extends OpcoesToast {
  id: number;
}

export interface ApiToast {
  mostrar: (o: OpcoesToast) => void;
  sucesso: (texto: string) => void;
  erro: (texto: string) => void;
}

const Contexto = createContext<ApiToast | null>(null);
const SEM_PROVEDOR: ApiToast = { mostrar: () => {}, sucesso: () => {}, erro: () => {} };

export function useToast(): ApiToast {
  return useContext(Contexto) ?? SEM_PROVEDOR;
}

function UmToast({ item, aoSumir }: { item: ItemToast; aoSumir: (id: number) => void }) {
  const [parado, setParado] = useState(false);
  const restante = useRef(item.duracaoMs ?? 8000);
  useEffect(() => {
    if (parado) return;
    const inicio = Date.now();
    const t = setTimeout(() => aoSumir(item.id), restante.current);
    return () => {
      clearTimeout(t);
      restante.current = Math.max(1500, restante.current - (Date.now() - inicio));
    };
  }, [parado, item.id, aoSumir]);
  const icone = item.tipo === 'erro' ? 'alerta' : item.tipo === 'info' ? 'info' : 'check';
  return (
    <div
      className={`toast ca-toast ca-toast-${item.tipo ?? 'sucesso'}`}
      role={item.tipo === 'erro' ? 'alert' : 'status'}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      onFocus={() => setParado(true)}
      onBlur={() => setParado(false)}
    >
      <Icone nome={icone} className="ca-toast-icone" />
      <span className="grow small">{item.texto}</span>
      {item.acao ? (
        <button
          type="button"
          className="btn btn-sm ca-toast-acao"
          onClick={() => {
            item.acao!.aoClicar();
            aoSumir(item.id);
          }}
        >
          {item.acao.rotulo}
        </button>
      ) : null}
      <button type="button" className="btn btn-sm btn-icon ca-toast-fechar" aria-label="Fechar aviso" onClick={() => aoSumir(item.id)}>
        <Icone nome="fechar" tamanho="sm" />
      </button>
    </div>
  );
}

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemToast[]>([]);
  const seq = useRef(0);
  const sumir = useCallback((id: number) => setItens((l) => l.filter((x) => x.id !== id)), []);
  const api = useMemo<ApiToast>(() => {
    const mostrar = (o: OpcoesToast) => setItens((l) => [...l.slice(-2), { ...o, id: ++seq.current }]);
    return {
      mostrar,
      sucesso: (texto) => mostrar({ texto, tipo: 'sucesso' }),
      erro: (texto) => mostrar({ texto, tipo: 'erro' }),
    };
  }, []);
  return (
    <Contexto.Provider value={api}>
      {children}
      <div className="ca-toasts" aria-live="polite">
        {itens.map((i) => (
          <UmToast key={i.id} item={i} aoSumir={sumir} />
        ))}
      </div>
    </Contexto.Provider>
  );
}

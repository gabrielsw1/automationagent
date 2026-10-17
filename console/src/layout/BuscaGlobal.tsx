// "Buscar no console": tarefas, execuções, pessoas, fontes, fluxos e páginas (GET /busca?q=).
// Ctrl+K (ou ⌘K) leva o foco para cá. Setas escolhem, Enter abre, Esc fecha.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/cliente.ts';
import { Icone, type NomeIcone } from '../componentes/icones.tsx';
import { useAtrasado } from '../componentes/pagina.tsx';

export interface ResultadoBusca {
  tipo: 'tarefa' | 'execucao' | 'pessoa' | 'conhecimento' | 'fluxo' | 'pagina';
  titulo: string;
  detalhe: string;
  destino: string;
}

const GRUPO: Record<ResultadoBusca['tipo'], { rotulo: string; icone: NomeIcone }> = {
  tarefa: { rotulo: 'Tarefas', icone: 'tarefas' },
  execucao: { rotulo: 'Execuções', icone: 'execucoes' },
  pessoa: { rotulo: 'Pessoas', icone: 'pessoa' },
  conhecimento: { rotulo: 'Conhecimento', icone: 'conhecimento' },
  fluxo: { rotulo: 'Fluxos gravados', icone: 'aprender' },
  pagina: { rotulo: 'Páginas do console', icone: 'seta-direita' },
};

export default function BuscaGlobal({ aoEscolher, atalho = true }: { aoEscolher?: () => void; atalho?: boolean }) {
  const navegar = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState('');
  const [aberta, setAberta] = useState(false);
  const [itens, setItens] = useState<ResultadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);
  const consulta = useAtrasado(texto.trim(), 220);

  useEffect(() => {
    if (!atalho) return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [atalho]);

  useEffect(() => {
    if (consulta.length < 2) {
      setItens([]);
      setErro(null);
      return;
    }
    let vivo = true;
    setBuscando(true);
    api
      .get<{ itens: ResultadoBusca[] }>(`/busca?q=${encodeURIComponent(consulta)}`)
      .then((r) => {
        if (!vivo) return;
        setItens(r.itens);
        setErro(null);
        setAtivo(0);
      })
      .catch((e: Error) => vivo && setErro(e.message))
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
  }, [consulta]);

  useEffect(() => {
    if (!aberta) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberta(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberta]);

  const grupos = useMemo(() => {
    const g = new Map<ResultadoBusca['tipo'], { item: ResultadoBusca; i: number }[]>();
    itens.forEach((item, i) => g.set(item.tipo, [...(g.get(item.tipo) ?? []), { item, i }]));
    return [...g.entries()];
  }, [itens]);

  const abrir = (r: ResultadoBusca) => {
    setAberta(false);
    setTexto('');
    input.current?.blur();
    aoEscolher?.();
    navegar(r.destino);
  };

  const mostrar = aberta && texto.trim().length >= 2;
  return (
    <div className="search ca-busca" ref={caixa}>
      <label className="sr-only" htmlFor={`${id}-q`}>
        Buscar no console
      </label>
      <Icone nome="busca" />
      <input
        ref={input}
        id={`${id}-q`}
        className="input"
        type="search"
        placeholder="Buscar tarefas, execuções, pessoas"
        autoComplete="off"
        role="combobox"
        aria-expanded={mostrar}
        aria-controls={`${id}-lista`}
        aria-activedescendant={mostrar && itens[ativo] ? `${id}-r${ativo}` : undefined}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setAberta(false);
            return;
          }
          if (!mostrar || itens.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAtivo((a) => (a + 1) % itens.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAtivo((a) => (a + itens.length - 1) % itens.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            abrir(itens[ativo]);
          }
        }}
      />
      {atalho ? (
        <span className="ca-busca-atalho hide-sm" aria-hidden="true">
          <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </span>
      ) : null}
      {mostrar ? (
        <div className="card ca-busca-resultados" id={`${id}-lista`} role="listbox" aria-label="Resultados da busca">
          {buscando && itens.length === 0 ? (
            <div className="row small muted ca-busca-msg">
              <span className="spinner" aria-hidden="true" />
              Buscando…
            </div>
          ) : erro ? (
            <p className="small text-danger ca-busca-msg">{erro}</p>
          ) : itens.length === 0 && consulta === texto.trim() ? (
            <p className="small muted ca-busca-msg">Nada encontrado para “{texto.trim()}”. Tente o nome da tarefa, o código da execução (EX-…) ou o nome da pessoa.</p>
          ) : (
            grupos.map(([tipo, lista]) => (
              <div key={tipo} role="group" aria-label={GRUPO[tipo].rotulo}>
                <div className="eyebrow ca-busca-grupo">{GRUPO[tipo].rotulo}</div>
                {lista.map(({ item, i }) => (
                  <div
                    key={`${item.destino}-${i}`}
                    id={`${id}-r${i}`}
                    role="option"
                    aria-selected={i === ativo}
                    className={`ca-busca-item${i === ativo ? ' ativo' : ''}`}
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => abrir(item)}
                  >
                    <Icone nome={GRUPO[tipo].icone} tamanho="sm" />
                    <span className="stack-sm grow" style={{ gap: 0 }}>
                      <span className="strong ca-busca-titulo">{item.titulo}</span>
                      <span className="tiny muted ca-busca-detalhe">{item.detalhe}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

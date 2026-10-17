// Peças visuais usadas pelas telas de execuções, canais e equipe (ícones, selos, modal, toast,
// estados de erro e de conexão). Cores só por var(--token).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Caminho, StatusExecucao } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { EstadoOffline, SemPermissao } from '../../componentes/estados.tsx';
import './pecas.css';

// ---------- Ícones (traço do design) ----------

const CAMINHOS: Record<string, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  api: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />,
  navegador: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M6.5 6.5h.01M9 6.5h.01" />
    </>
  ),
  desfazer: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>
  ),
  baixar: (
    <>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  busca: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  anterior: <path d="M15 6l-6 6 6 6" />,
  proximo: <path d="M9 6l6 6-6 6" />,
  pessoa: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  reexecutar: (
    <>
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  enviar: <path d="M4 12l16-8-6 16-3-7z" />,
  alvo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  alerta: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </>
  ),
  imagem: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 17l-5-5-9 8" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  brilho: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  chat: <path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" />,
  mais: <path d="M12 5v14M5 12h14" />,
  copiar: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </>
  ),
  semConexao: (
    <>
      <path d="M2 8.5a16 16 0 0120 0M5 12a11 11 0 0114 0M8.5 15.5a6 6 0 017 0M12 19.5v.01" />
      <path d="M3 3l18 18" />
    </>
  ),
  lista: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  voz: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  ),
  abrir: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" />
    </>
  ),
  ampliar: (
    <>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </>
  ),
  login: (
    <>
      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </>
  ),
  ponto: <circle cx="12" cy="12" r="3" />,
};

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({ nome, tamanho, className }: { nome: NomeIcone; tamanho?: 'sm' | 'lg'; className?: string }) {
  return (
    <svg
      className={['i', tamanho ? `i-${tamanho}` : '', className ?? ''].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {CAMINHOS[nome]}
    </svg>
  );
}

// ---------- Selos ----------

export const ROTULO_STATUS: Record<StatusExecucao, string> = {
  aguardando_confirmacao: 'Aguardando confirmação',
  aguardando_aprovacao: 'Aguardando aprovação',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  falhou: 'Falhou',
  desfeita: 'Desfeita',
  cancelada: 'Cancelada',
};

export function SeloStatus({ status }: { status: StatusExecucao }) {
  const rotulo = ROTULO_STATUS[status] ?? status;
  switch (status) {
    case 'concluida':
      return (
        <span className="badge badge-success">
          <span className="dot" />
          {rotulo}
        </span>
      );
    case 'em_andamento':
      return (
        <span className="badge badge-info">
          <span className="spinner cb-spinner-sm" aria-hidden="true" />
          {rotulo}
        </span>
      );
    case 'aguardando_confirmacao':
    case 'aguardando_aprovacao':
      return (
        <span className="badge badge-warning">
          <Icone nome="relogio" tamanho="sm" />
          {rotulo}
        </span>
      );
    case 'falhou':
      return (
        <span className="badge badge-danger">
          <Icone nome="x" tamanho="sm" />
          {rotulo}
        </span>
      );
    case 'desfeita':
      return (
        <span className="badge">
          <Icone nome="desfazer" tamanho="sm" />
          {rotulo}
        </span>
      );
    default:
      return (
        <span className="badge">
          <span className="dot" />
          {rotulo}
        </span>
      );
  }
}

export function SeloCaminho({ caminho }: { caminho: Caminho | null }) {
  if (caminho === 'api') {
    return (
      <span className="badge badge-info">
        <Icone nome="api" tamanho="sm" />
        API
      </span>
    );
  }
  if (caminho === 'navegador') {
    return (
      <span className="badge badge-accent">
        <Icone nome="navegador" tamanho="sm" />
        Navegador
      </span>
    );
  }
  return <span className="small muted">—</span>;
}

export function rotuloCanal(canal: string): string {
  return canal === 'teste' ? 'Teste' : canal === 'widget' ? 'Widget' : canal;
}

// ---------- Hooks ----------

/** Relógio que avança sozinho (para durações ao vivo e "há 3 min"). */
export function useAgora(intervaloMs = 1000, ativo = true): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs, ativo]);
  return agora;
}

/** true enquanto o navegador tem conexão. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** true depois de `ms` (para "Ainda carregando…"). */
export function useDemorou(ativo: boolean, ms = 10_000): boolean {
  const [demorou, setDemorou] = useState(false);
  useEffect(() => {
    setDemorou(false);
    if (!ativo) return;
    const id = setTimeout(() => setDemorou(true), ms);
    return () => clearTimeout(id);
  }, [ativo, ms]);
  return demorou;
}

// ---------- Estados ----------

// A faixa "Você está sem internet" é global (layout/Faixas.tsx); as telas só desativam o que grava.

/** Erro ao carregar uma lista ou tela (Estados-Console "Erro ao carregar"). */
export function AvisoErro({
  erro,
  titulo,
  aoTentar,
}: {
  erro: ErroApiCliente | null;
  titulo: string;
  aoTentar?: () => void;
}) {
  if (erro?.offline) return <EstadoOffline aoTentar={aoTentar} />;
  if (erro?.status === 403) return <SemPermissao mensagem={erro.message} />;
  const servidor = !erro || erro.status >= 500;
  return (
    <div className="alert alert-danger" role="alert">
      <Icone nome="alerta" />
      <div className="stack-sm">
        <p className="strong">{titulo}</p>
        <p className="small">
          {servidor
            ? 'O servidor demorou para responder. Nada foi perdido e o copiloto continua atendendo os usuários.'
            : erro.message}
        </p>
        <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
          {aoTentar ? (
            <button className="btn btn-secondary btn-sm" type="button" onClick={aoTentar}>
              <Icone nome="reexecutar" tamanho="sm" />
              Tentar de novo
            </button>
          ) : null}
          {erro ? (
            <span className="mono tiny muted">
              Erro {erro.status}
              {erro.ref ? ` · ref ${erro.ref}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Erro curto ao lado de um botão de ação. */
export function ErroAcao({ erro }: { erro: ErroApiCliente | null }) {
  if (!erro) return null;
  return (
    <span className="error-text" role="alert">
      <Icone nome="alerta" tamanho="sm" />
      {erro.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : erro.message}
      {erro.ref ? ` (ref ${erro.ref})` : ''}
    </span>
  );
}

/** Esqueleto de tabela (Estados-Console "Carregando"). */
export function EsqueletoTabela({ linhas = 5, texto = 'Carregando execuções' }: { linhas?: number; texto?: string }) {
  const demorou = useDemorou(true);
  const larguras = ['40%', '52%', '34%', '46%', '58%', '38%'];
  return (
    <div className="stack" aria-busy="true">
      <span className="sr-only">{texto}</span>
      <div className="card cb-esqueleto">
        <div className="row cb-esqueleto-cab">
          <div className="skel" style={{ width: '18%', height: 10 }} />
          <div className="skel" style={{ width: '30%', height: 10 }} />
          <div className="skel" style={{ width: '16%', height: 10, marginLeft: 'auto' }} />
        </div>
        {Array.from({ length: linhas }, (_, i) => (
          <div className="row cb-esqueleto-linha" key={i}>
            <div className="skel" style={{ width: 24, height: 24, borderRadius: '50%' }} />
            <div className="skel" style={{ width: larguras[i % larguras.length], height: 12 }} />
            <div className="skel" style={{ width: 64, height: 20, borderRadius: 999, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
      {demorou ? <p className="small muted">Ainda carregando…</p> : null}
    </div>
  );
}

// ---------- Modal ----------

export function Modal({
  titulo,
  children,
  aoFechar,
  rodape,
  largura = 520,
}: {
  titulo: string;
  children: ReactNode;
  aoFechar: () => void;
  rodape?: ReactNode;
  largura?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  const idTitulo = useRef(`m-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const alvo = ref.current?.querySelector<HTMLElement>(
      'textarea, input, select, button.btn-primary, button.btn-danger, button',
    );
    alvo?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar.current();
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, []);
  return (
    <div className="cb-modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <section
        ref={ref}
        className="card cb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        style={{ maxWidth: largura }}
      >
        <div className="card-body stack">
          <h3 className="h4" id={idTitulo}>
            {titulo}
          </h3>
          {children}
        </div>
        {rodape ? <div className="card-foot">{rodape}</div> : null}
      </section>
    </div>
  );
}

// ---------- Toast ----------

export interface DadosToast {
  texto: string;
  tom?: 'sucesso' | 'erro' | 'info';
  acao?: { rotulo: string; fazer: () => void };
}

/** Toast de sucesso: some em 8 s, mas não enquanto o mouse estiver sobre ele. */
export function useToast() {
  const [toast, setToast] = useState<(DadosToast & { id: number }) | null>(null);
  const mostrar = useCallback((t: DadosToast | string) => {
    setToast({ ...(typeof t === 'string' ? { texto: t } : t), id: Date.now() });
  }, []);
  const fechar = useCallback(() => setToast(null), []);
  const elemento = toast ? <Toast key={toast.id} {...toast} aoFechar={fechar} /> : null;
  return { mostrar, fechar, elemento };
}

function Toast({ texto, tom = 'sucesso', acao, aoFechar }: DadosToast & { aoFechar: () => void }) {
  const [sobre, setSobre] = useState(false);
  useEffect(() => {
    if (sobre) return;
    const id = setTimeout(aoFechar, 8000);
    return () => clearTimeout(id);
  }, [sobre, aoFechar]);
  return (
    <div className="cb-toast-area">
      <div
        className="toast"
        role="status"
        onMouseEnter={() => setSobre(true)}
        onMouseLeave={() => setSobre(false)}
      >
        <Icone nome={tom === 'erro' ? 'alerta' : tom === 'info' ? 'info' : 'check'} className={`cb-toast-icone-${tom}`} />
        <span className="grow small">{texto}</span>
        {acao ? (
          <button
            className="btn btn-sm cb-toast-acao"
            type="button"
            onClick={() => {
              acao.fazer();
              aoFechar();
            }}
          >
            {acao.rotulo}
          </button>
        ) : null}
        <button className="btn btn-sm btn-icon cb-toast-acao" type="button" aria-label="Fechar aviso" onClick={aoFechar}>
          <Icone nome="x" tamanho="sm" />
        </button>
      </div>
    </div>
  );
}

// ---------- Copiar ----------

export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no método antigo */
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function BotaoCopiar({
  texto,
  rotulo = 'Copiar',
  className = 'btn btn-secondary btn-sm',
  style,
}: {
  texto: string;
  rotulo?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [estado, setEstado] = useState<'pronto' | 'copiado' | 'falhou'>('pronto');
  useEffect(() => {
    if (estado === 'pronto') return;
    const id = setTimeout(() => setEstado('pronto'), 2500);
    return () => clearTimeout(id);
  }, [estado]);
  return (
    <button
      className={className}
      type="button"
      style={style}
      onClick={async () => setEstado((await copiarTexto(texto)) ? 'copiado' : 'falhou')}
    >
      <Icone nome={estado === 'copiado' ? 'check' : 'copiar'} tamanho="sm" />
      {estado === 'copiado' ? 'Copiado' : estado === 'falhou' ? 'Selecione e copie' : rotulo}
      <span className="sr-only" aria-live="polite">
        {estado === 'copiado' ? 'Copiado para a área de transferência' : ''}
      </span>
    </button>
  );
}

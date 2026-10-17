// Ícones de traço do design (viewBox 24, stroke = currentColor). Classes .i / .i-sm / .i-lg vêm do base.css.
import type { ReactNode } from 'react';

const CAMINHOS = {
  brilho: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  menos: <path d="M5 12h14" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  mais: <path d="M12 5v14M5 12h14" />,
  janela: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M6.5 6.5h.01M9 6.5h.01" />
    </>
  ),
  clipe: <path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7" />,
  microfone: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  ),
  enviar: <path d="M4 12l16-8-6 16-3-7z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  aviso: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </>
  ),
  formulario: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  codigo: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />,
  desfazer: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>
  ),
  externo: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v6H4V6h6" />
    </>
  ),
  semRede: (
    <>
      <path d="M2 8.5a16 16 0 0120 0M5 12a11 11 0 0114 0M8.5 15.5a6 6 0 017 0M12 19.5v.01" />
      <path d="M3 3l18 18" />
    </>
  ),
  pessoa: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  polegar: (
    <>
      <path d="M7 11v9H4v-9z" />
      <path d="M7 11l4-7a2 2 0 013 2l-1 4h5a2 2 0 012 2.3l-1.2 6A2 2 0 0116.8 20H7" />
    </>
  ),
  polegarBaixo: (
    <g transform="rotate(180 12 12)">
      <path d="M7 11v9H4v-9z" />
      <path d="M7 11l4-7a2 2 0 013 2l-1 4h5a2 2 0 012 2.3l-1.2 6A2 2 0 0116.8 20H7" />
    </g>
  ),
  repetir: (
    <>
      <path d="M20 12a8 8 0 11-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </>
  ),
  pausa: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  documento: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  xis: <path d="M8 8l8 8M16 8l-8 8" />,
  frasco: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({
  nome,
  tamanho = 'md',
  className,
}: {
  nome: NomeIcone;
  tamanho?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const classes = ['i', tamanho === 'sm' ? 'i-sm' : tamanho === 'lg' ? 'i-lg' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <svg className={classes} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {CAMINHOS[nome]}
    </svg>
  );
}

/** Avatar do copiloto (bolinha de marca com o brilho). */
export function AvatarCopiloto({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' | 'lg' }) {
  const classe = tamanho === 'sm' ? 'avatar avatar-bot avatar-sm' : tamanho === 'lg' ? 'avatar avatar-bot cp-avatar-lg' : 'avatar avatar-bot';
  return (
    <span className={classe} aria-hidden="true">
      <Icone nome="brilho" tamanho={tamanho === 'sm' ? 'sm' : 'md'} />
    </span>
  );
}

/** Avatar de uma pessoa do suporte, com as iniciais. */
export function AvatarPessoa({ iniciais, pequeno = false }: { iniciais: string; pequeno?: boolean }) {
  return (
    <span className={`avatar cp-avatar-pessoa${pequeno ? ' avatar-sm' : ''}`} aria-hidden="true">
      {iniciais}
    </span>
  );
}

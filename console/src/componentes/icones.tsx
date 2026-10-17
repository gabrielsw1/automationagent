// Ícones do console (traço de 1,75 px, 24×24, cor do texto), copiados do design.
// Uso: <Icone nome="busca" />, <Icone nome="check" tamanho="sm" />. Sempre decorativo (aria-hidden):
// o texto ao lado ou o aria-label do botão diz o que é.
import type { CSSProperties, ReactNode } from 'react';

const P = {
  painel: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  execucoes: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  tarefas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  aprender: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  conhecimento: (
    <>
      <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" />
      <path d="M4 19V5" />
    </>
  ),
  canais: <path d="M4 5h16v11H8l-4 4z" />,
  equipe: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <path d="M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" />
    </>
  ),
  guia: <path d="M5 21V4h11l-2 4 2 4H5" />,
  'seta-direita': <path d="M9 6l6 6-6 6" />,
  'seta-esquerda': <path d="M15 6l-6 6 6 6" />,
  'seta-baixo': <path d="M6 9l6 6 6-6" />,
  busca: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  enviar: <path d="M4 12l16-8-6 16-3-7z" />,
  copiloto: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alerta: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
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
  mais: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  play: <path d="M7 5l12 7-12 7z" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  atualizar: (
    <>
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  externo: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v6H4V6h6" />
    </>
  ),
  baixar: (
    <>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  desfazer: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>
  ),
  pessoa: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  copiar: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </>
  ),
  'sem-conexao': (
    <>
      <path d="M2 8.5a16 16 0 0120 0M5 12a11 11 0 0114 0M8.5 15.5a6 6 0 017 0M12 19.5v.01" />
      <path d="M3 3l18 18" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sair: (
    <>
      <path d="M15 4h4v16h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  lixeira: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  editar: <path d="M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4" />,
  subir: <path d="M6 15l6-6 6 6" />,
  pontos: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  /** Item ainda não cumprido (regras da senha). */
  circulo: <circle cx="12" cy="12" r="9" />,
  empresa: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" />
    </>
  ),
  erro: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16v.01" />
    </>
  ),
  /** Plataforma › Uso e custos. */
  cartao: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18M16 15h2" />
    </>
  ),
  /** Plataforma › Configurações. */
  engrenagem: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type NomeIcone = keyof typeof P;

export function Icone({
  nome,
  tamanho,
  className,
  style,
  rotulo,
}: {
  nome: NomeIcone;
  tamanho?: 'sm' | 'lg';
  className?: string;
  style?: CSSProperties;
  /** Só quando o ícone está sozinho e precisa ser lido (ex.: "Aprovado"). */
  rotulo?: string;
}) {
  const cls = ['i', tamanho ? `i-${tamanho}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg
      className={cls}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden={rotulo ? undefined : true}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
    >
      {P[nome]}
    </svg>
  );
}

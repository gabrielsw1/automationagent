// Botão do console com as variantes do design e o estado "carregando".
//
//   <Botao variante="primario" carregando={publicando} onClick={publicar}>Publicar versão 5</Botao>
//   <Botao variante="secundario" tamanho="sm" icone="mais">Adicionar campo</Botao>
//
// Carregando: mantém a largura, mostra o giro e fica desativado (evita clique duplo).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icone, type NomeIcone } from './icones.tsx';

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo' | 'destaque';

const CLASSE: Record<VarianteBotao, string> = {
  primario: 'btn-primary',
  secundario: 'btn-secondary',
  fantasma: 'btn-ghost',
  perigo: 'btn-danger',
  destaque: 'btn-accent',
};

export interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: 'sm' | 'lg';
  carregando?: boolean;
  /** Ícone antes do texto. */
  icone?: NomeIcone;
  /** Ícone depois do texto (ex.: seta do menu). */
  iconeDepois?: NomeIcone;
  bloco?: boolean;
  children?: ReactNode;
}

export function Botao({
  variante = 'secundario',
  tamanho,
  carregando = false,
  icone,
  iconeDepois,
  bloco,
  className,
  disabled,
  children,
  type = 'button',
  ...resto
}: PropsBotao) {
  const cls = [
    'btn',
    CLASSE[variante],
    tamanho ? `btn-${tamanho}` : '',
    bloco ? 'btn-block' : '',
    carregando ? 'is-loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || carregando} aria-busy={carregando || undefined} {...resto}>
      {icone ? <Icone nome={icone} tamanho={tamanho === 'sm' ? 'sm' : undefined} /> : null}
      {children}
      {iconeDepois ? <Icone nome={iconeDepois} tamanho="sm" /> : null}
      {carregando ? <span className="sr-only">, aguarde</span> : null}
    </button>
  );
}

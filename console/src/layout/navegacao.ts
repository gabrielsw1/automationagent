// Itens do menu lateral e a trilha padrão de cada rota.
import type { NomeIcone } from '../componentes/icones.tsx';

export interface ItemNav {
  para: string;
  rotulo: string;
  icone: NomeIcone;
  contador?: 'execucoes';
}

export const GRUPOS_NAV: { rotulo: string; itens: ItemNav[] }[] = [
  {
    rotulo: 'Copiloto',
    itens: [
      { para: '/painel', rotulo: 'Painel', icone: 'painel' },
      { para: '/execucoes', rotulo: 'Execuções', icone: 'execucoes', contador: 'execucoes' },
    ],
  },
  {
    rotulo: 'Configurar',
    itens: [
      { para: '/tarefas', rotulo: 'Tarefas', icone: 'tarefas' },
      { para: '/aprender', rotulo: 'Aprender fluxo', icone: 'aprender' },
      { para: '/conhecimento', rotulo: 'Conhecimento', icone: 'conhecimento' },
      { para: '/canais', rotulo: 'Canais e widget', icone: 'canais' },
    ],
  },
  {
    rotulo: 'Conta',
    itens: [{ para: '/equipe', rotulo: 'Equipe e limites', icone: 'equipe' }],
  },
];

const TITULOS: Record<string, string> = {
  guia: 'Guia de início',
  painel: 'Painel',
  execucoes: 'Execuções',
  tarefas: 'Tarefas',
  aprender: 'Aprender fluxo',
  conhecimento: 'Conhecimento',
  canais: 'Canais e widget',
  equipe: 'Equipe e limites',
};

/** Trilha padrão: "Copiloto > Painel"; em subpáginas, "Execuções > EX-20417". */
export function migalhasPadrao(caminho: string): { rotulo: string; para?: string }[] {
  const [secao, detalhe] = caminho.split('/').filter(Boolean);
  const titulo = TITULOS[secao ?? ''] ?? 'Console';
  if (detalhe) return [{ rotulo: titulo, para: `/${secao}` }, { rotulo: decodeURIComponent(detalhe) }];
  return [{ rotulo: 'Copiloto' }, { rotulo: titulo }];
}

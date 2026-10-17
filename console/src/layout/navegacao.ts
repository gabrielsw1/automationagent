// Itens do menu lateral e a trilha padrão de cada rota.
import type { NomeIcone } from '../componentes/icones.tsx';

export interface ItemNav {
  para: string;
  rotulo: string;
  icone: NomeIcone;
  contador?: 'execucoes';
}

export const GRUPOS_NAV: {
  rotulo: string;
  itens: ItemNav[];
  /** O rótulo fica só para leitores de tela (o primeiro grupo, como no design). */
  rotuloOculto?: boolean;
  soAdminPlataforma?: boolean;
}[] = [
  {
    rotulo: 'Copiloto',
    rotuloOculto: true,
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
      // Fora do design, mas necessário: editar o endereço e o acesso depois do cadastro.
      { para: '/sistema', rotulo: 'Sistema', icone: 'navegador' },
    ],
  },
  {
    rotulo: 'Conta',
    itens: [{ para: '/equipe', rotulo: 'Equipe e limites', icone: 'equipe' }],
  },
  {
    // Só para quem administra a plataforma (COPILOTO_ADMINS): todas as empresas clientes.
    rotulo: 'Plataforma',
    soAdminPlataforma: true,
    itens: [{ para: '/plataforma', rotulo: 'Empresas clientes', icone: 'empresa' }],
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
  sistema: 'Sistema',
  equipe: 'Equipe e limites',
  plataforma: 'Empresas clientes',
};

/** Nome e ícone de uma seção do console ("execucoes" → Execuções), ou undefined se não for uma. */
export function secaoDoConsole(secao: string): { rotulo: string; icone: NomeIcone } | undefined {
  const rotulo = TITULOS[secao];
  if (!rotulo) return undefined;
  const item = GRUPOS_NAV.flatMap((g) => g.itens).find((i) => i.para === `/${secao}`);
  return { rotulo, icone: item?.icone ?? 'guia' };
}

/** Trilha padrão: "Copiloto > Painel"; em subpáginas, "Execuções > EX-20417". */
export function migalhasPadrao(caminho: string): { rotulo: string; para?: string }[] {
  const [secao, detalhe] = caminho.split('/').filter(Boolean);
  const titulo = TITULOS[secao ?? ''] ?? 'Console';
  if (detalhe) return [{ rotulo: titulo, para: `/${secao}` }, { rotulo: decodeURIComponent(detalhe) }];
  return [{ rotulo: 'Copiloto' }, { rotulo: titulo }];
}

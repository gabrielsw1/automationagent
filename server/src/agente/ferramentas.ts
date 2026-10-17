// Ferramentas que o Claude usa no widget: uma por tarefa do catálogo, a busca na base de
// conhecimento e a passagem para uma pessoa. Os nomes e esquemas ficam estáveis (cache de prompt).
import type { Campo, TarefaDefinicao } from '@copiloto/shared';
import type { FerramentaLlm } from '../llm/tipos.ts';
import type { TarefaEmUso } from '../servicos/catalogo.ts';

export const PREFIXO_TAREFA = 'tarefa_';
export const FERRAMENTA_CONHECIMENTO = 'consultar_conhecimento';
export const FERRAMENTA_PESSOA = 'chamar_pessoa';

export function nomeFerramenta(slug: string): string {
  return `${PREFIXO_TAREFA}${slug}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

const DICA_TIPO: Record<Campo['tipo'], string> = {
  texto: 'texto',
  documento: 'CPF ou CNPJ, como a pessoa escreveu',
  email: 'e-mail',
  telefone: 'telefone com DDD',
  lista: 'uma das opções',
  data: 'data no formato AAAA-MM-DD (converta "amanhã", "sexta" etc. pela data de hoje)',
  hora: 'horário HH:MM',
  numero: 'número',
  moeda: 'valor em reais',
  pessoa: 'nome de um usuário do sistema',
};

function descricaoCampo(c: Campo): string {
  const partes = [`${c.rotulo} (${DICA_TIPO[c.tipo]})`];
  if (c.opcoes?.length) partes.push(`Opções: ${c.opcoes.join(', ')}.`);
  if (c.obrigatorio) partes.push('Obrigatório.');
  if (c.padrao === 'solicitante') partes.push('Se a pessoa não disser, fica quem pediu; não pergunte.');
  else if (c.perguntar === false) partes.push('Não pergunte; use só se a pessoa disser.');
  if (c.ajuda) partes.push(c.ajuda);
  return partes.join(' ');
}

function descricaoTarefa(def: TarefaDefinicao): string {
  const linhas = [
    `${def.nome}: ${def.descricao}`,
    `Quando usar: ${def.quandoUsar}`,
    def.exemplos.length ? `Exemplos de pedidos: ${def.exemplos.map((e) => `"${e}"`).join('; ')}` : '',
    'Chame com todos os dados que a pessoa já deu, mesmo que falte algum; o copiloto valida, pergunta o que falta e mostra o cartão de confirmação. Nada é gravado sem a confirmação dela.',
  ];
  return linhas.filter(Boolean).join('\n');
}

export function ferramentaDaTarefa(t: Pick<TarefaEmUso, 'slug' | 'definicao'>): FerramentaLlm {
  const props: Record<string, { type: 'string'; description: string; enum?: string[] }> = {};
  for (const c of t.definicao.campos) {
    props[c.chave] = { type: 'string', description: descricaoCampo(c) };
  }
  return {
    name: nomeFerramenta(t.slug),
    description: descricaoTarefa(t.definicao),
    input_schema: { type: 'object', properties: props, additionalProperties: false },
  };
}

export const FERRAMENTAS_FIXAS: FerramentaLlm[] = [
  {
    name: FERRAMENTA_CONHECIMENTO,
    description:
      'Busca na base de conhecimento do sistema (central de ajuda, manuais, vídeos de treinamento e respostas da equipe). ' +
      'Use para dúvidas sobre como usar o sistema, regras, prazos, planos e preços. Responda só com o que vier nos resultados e cite-os.',
    input_schema: {
      type: 'object',
      properties: { pergunta: { type: 'string', description: 'A dúvida da pessoa, reescrita de forma completa.' } },
      required: ['pergunta'],
      additionalProperties: false,
    },
  },
  {
    name: FERRAMENTA_PESSOA,
    description:
      'Passa a conversa para uma pessoa da equipe de suporte, com um resumo do que já aconteceu. Use quando a pessoa pedir ' +
      'para falar com alguém, ou quando ela precisar de ajuda que você não pode dar e aceitar ser atendida por uma pessoa.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Uma frase com o motivo, para o suporte.' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

export function ferramentasDe(tarefas: Pick<TarefaEmUso, 'slug' | 'definicao'>[]): FerramentaLlm[] {
  return [...tarefas.map(ferramentaDaTarefa), ...FERRAMENTAS_FIXAS];
}

/** Resultado que as ferramentas de tarefa devolvem ao modelo (JSON no tool_result). */
export type ResultadoTarefa =
  | {
      situacao: 'faltam_dados';
      tarefa: string;
      ja_tenho: Record<string, string>;
      faltam: { campo: string; rotulo: string; pergunta: string }[];
      instrucao: string;
      resposta_sugerida: string;
    }
  | {
      situacao: 'dados_invalidos';
      tarefa: string;
      ja_tenho: Record<string, string>;
      erros: { campo: string; rotulo: string; erro: string }[];
      instrucao: string;
      resposta_sugerida: string;
    }
  | { situacao: 'cartao_mostrado'; tarefa: string; execucao: string; instrucao: string; resposta_sugerida: string }
  | {
      situacao: 'precisa_aprovacao' | 'sem_permissao';
      tarefa: string;
      perfil_necessario: string;
      aprovador?: string;
      instrucao: string;
      resposta_sugerida: string;
    }
  | { situacao: 'pausado' | 'indisponivel'; tarefa: string; instrucao: string; resposta_sugerida: string };

export type ResultadoFerramenta =
  | ResultadoTarefa
  | { situacao: 'sem_resultado'; instrucao: string; resposta_sugerida: string }
  | { situacao: 'pessoa_chamada'; instrucao: string; resposta_sugerida: string }
  | { situacao: 'erro'; instrucao: string; resposta_sugerida: string };

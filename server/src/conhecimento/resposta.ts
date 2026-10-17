// "Testar uma pergunta" (e respostas completas da base): busca os trechos, pede ao Claude uma resposta
// só com base neles (blocos search_result com citações) e avalia a confiança.
import type { RespostaTeste } from '@copiloto/shared';
import { sim } from '../llm/simulado.ts';
import type { BlocoResposta, FerramentaLlm, Llm, PedidoTurno } from '../llm/tipos.ts';
import { montarRespostaCitada, paraSearchResults, paragrafosDoTrecho, trechosCitados } from './citacoes.ts';
import { cobertura, frases, termosDaPergunta, type GrupoTermo } from './texto.ts';
import type { Trecho } from './tipos.ts';

export const FERRAMENTA_SEM_RESPOSTA = 'sem_resposta_nas_fontes';

export const SISTEMA_RESPOSTA = `Você é o copiloto de um sistema de gestão e responde dúvidas de quem usa o sistema.

Regras:
- Responda só com o que está nos resultados de busca enviados junto da pergunta. Não use conhecimento próprio sobre o sistema e não invente menus, botões, prazos, valores, perfis ou passos.
- Use o conteúdo dos resultados de forma que cada afirmação fique ligada à fonte de onde veio (as citações são feitas automaticamente).
- Escreva em português do Brasil, em até 4 frases curtas, com tom simples e direto, falando com a pessoa ("você"). Use passos numerados só quando houver mais de dois passos.
- Se os resultados não respondem à pergunta, ou respondem só em parte, diga com franqueza que não encontrou isso nas fontes (e o que encontrou, se ajudar) e chame a ferramenta ${FERRAMENTA_SEM_RESPOSTA}. Nunca complete com suposições.
- Não fale em "resultados de busca", "trechos" ou "documentos": se precisar, cite a fonte pelo nome (por exemplo, "a central de ajuda").`;

export const FERRAMENTAS_RESPOSTA: FerramentaLlm[] = [
  {
    name: FERRAMENTA_SEM_RESPOSTA,
    description:
      'Avisa a equipe que as fontes cadastradas não respondem a esta pergunta (ou respondem só em parte), para que alguém escreva uma resposta. Chame depois de dizer à pessoa que não encontrou.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'O que faltou nas fontes, em poucas palavras.' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

/** Mensagem enviada ao Claude: os trechos como search_result e a pergunta. */
export function mensagemDaPergunta(pergunta: string, trechos: Trecho[]): PedidoTurno['mensagens'] {
  return [
    {
      role: 'user',
      content: [...paraSearchResults(trechos), { type: 'text', text: `Pergunta da pessoa: ${pergunta}` }],
    },
  ];
}

/** Citação no formato da API apontando um parágrafo (bloco de texto) de um search_result. */
function citacao(trechos: Trecho[], indice: number, bloco: number) {
  const t = trechos[indice];
  const paragrafos = paragrafosDoTrecho(t);
  const blocos = paraSearchResults([t])[0];
  return {
    type: 'search_result_location' as const,
    search_result_index: indice,
    source: blocos.source,
    title: blocos.title,
    cited_text: paragrafos[bloco] ?? t.texto,
    start_block_index: bloco,
    end_block_index: bloco + 1,
  };
}

/** Linha curta sem pontuação final (título de seção, rótulo de menu). */
function pareceTitulo(linha: string): boolean {
  return linha.length <= 70 && !/[.!:;…)]$/.test(linha) && !linha.includes(' | ');
}

/** Melhores frases de um trecho para a pergunta (até `max`), na ordem do texto, com o parágrafo de cada uma. */
function melhoresFrases(grupos: GrupoTermo[], t: Trecho, max: number): { frase: string; bloco: number }[] {
  const candidatas: { frase: string; bloco: number; pos: number; nota: number }[] = [];
  let pos = 0;
  const titulo = t.titulo.trim().toLowerCase();
  paragrafosDoTrecho(t).forEach((p, bloco) => {
    const linha = p.replace(/^•\s*/, '').trim();
    // Títulos de seção e perguntas não servem de resposta.
    if (pareceTitulo(linha) || linha.toLowerCase() === titulo) return;
    for (const f of frases(linha)) {
      // Perguntas e remissões ("Veja Como emitir...") não respondem nada.
      if (f.length < 12 || f.endsWith('?') || /^(veja|leia|saiba mais|confira o artigo)\b/i.test(f)) continue;
      candidatas.push({ frase: f, bloco, pos: pos++, nota: cobertura(grupos, f) });
    }
  });
  if (!candidatas.length) return [];
  const ordenadas = [...candidatas].sort((a, b) => b.nota - a.nota || a.pos - b.pos);
  // Só entram frases quase tão boas quanto a melhor (evita "O plano Básico..." numa pergunta sobre o Premium).
  const corte = Math.max(0.01, ordenadas[0].nota * 0.75);
  const escolhidas = ordenadas.filter((c) => c.nota >= corte).slice(0, max);
  const lista = escolhidas.length ? escolhidas : ordenadas.slice(0, 1);
  // A frase seguinte à melhor costuma completar o passo ("Depois, clique em...").
  if (lista.length < max) {
    const seguinte = candidatas.find((c) => c.pos === lista[0].pos + 1 && c.bloco === lista[0].bloco);
    if (seguinte && !lista.includes(seguinte)) lista.push(seguinte);
  }
  return lista.sort((a, b) => a.pos - b.pos).map(({ frase, bloco }) => ({ frase, bloco }));
}

/** Cobertura mínima do melhor trecho para o modelo simulado considerar que a pergunta tem resposta. */
export const COBERTURA_MINIMA = 0.6;

/**
 * Regra do modelo simulado: resposta extrativa com as frases do melhor trecho (e do segundo, se
 * também for relevante), citando-os. Sem trecho relevante, diz que não encontrou e chama a ferramenta.
 */
export function simularResposta(pergunta: string, trechos: Trecho[]): BlocoResposta[] {
  const grupos = termosDaPergunta(pergunta);
  const notas = trechos.map((t) => cobertura(grupos, `${t.titulo} ${t.local ?? ''} ${t.texto}`));
  const ordem = notas.map((_, i) => i).sort((a, b) => notas[b] - notas[a] || a - b);
  const principal = ordem[0];
  if (principal === undefined || notas[principal] < COBERTURA_MINIMA) {
    return [
      sim.texto('Não encontrei isso nas fontes cadastradas. Vou avisar a equipe para incluir essa resposta.'),
      sim.ferramenta(FERRAMENTA_SEM_RESPOSTA, { motivo: 'As fontes não falam disso.' }),
    ];
  }
  const blocos: BlocoResposta[] = [];
  for (const f of melhoresFrases(grupos, trechos[principal], 2)) {
    blocos.push({ type: 'text', text: f.frase + ' ', citations: [citacao(trechos, principal, f.bloco)] } as BlocoResposta);
  }
  const segundo = ordem.find((i) => i !== principal && notas[i] >= 0.6 && trechos[i].titulo !== trechos[principal].titulo);
  if (segundo !== undefined) {
    const [f] = melhoresFrases(grupos, trechos[segundo], 1);
    const jaDito = blocos.some((b) => b.type === 'text' && f && b.text.includes(f.frase));
    if (f && !jaDito) {
      blocos.push(sim.texto('Veja também: '));
      blocos.push({ type: 'text', text: f.frase, citations: [citacao(trechos, segundo, f.bloco)] } as BlocoResposta);
    }
  }
  return blocos;
}

const NAO_SABE = /n[aã]o (encontrei|achei|sei|tenho essa informa)|n[aã]o (est[aá]|aparece) nas fontes/i;

/** Confiança da resposta: alta quando quase tudo está citado e os trechos cobrem bem a pergunta. */
export function avaliarConfianca(
  pergunta: string,
  conteudo: BlocoResposta[],
  trechos: Trecho[],
): { confianca: RespostaTeste['confianca']; semResposta: boolean } {
  const chamouSemResposta = conteudo.some((b) => b.type === 'tool_use' && b.name === FERRAMENTA_SEM_RESPOSTA);
  const citados = trechosCitados(conteudo, trechos);
  const textos = conteudo.filter((b): b is Extract<BlocoResposta, { type: 'text' }> => b.type === 'text' && b.text.trim().length > 15);
  const textoTodo = textos.map((b) => b.text).join(' ');
  if (chamouSemResposta || citados.length === 0 || NAO_SABE.test(textoTodo)) {
    return { confianca: 'baixa', semResposta: true };
  }
  const comCitacao = textos.filter((b) => b.citations?.length).length;
  const fracao = textos.length ? comCitacao / textos.length : 0;
  const grupos = termosDaPergunta(pergunta);
  const melhor = Math.max(...citados.map((i) => cobertura(grupos, `${trechos[i].titulo} ${trechos[i].texto}`)));
  if (fracao >= 0.6 && melhor >= 0.75) return { confianca: 'alta', semResposta: false };
  if (fracao >= 0.3 || melhor >= 0.5) return { confianca: 'media', semResposta: false };
  return { confianca: 'baixa', semResposta: false };
}

/** Pede a resposta ao modelo e monta o RespostaTeste (sem registrar nada). */
export async function gerarResposta(
  llm: Llm,
  pergunta: string,
  trechos: Trecho[],
): Promise<{ resposta: Omit<RespostaTeste, 'duracaoMs'>; semResposta: boolean; motivo?: string }> {
  const r = await llm.turno({
    finalidade: 'conhecimento',
    sistema: SISTEMA_RESPOSTA,
    ferramentas: FERRAMENTAS_RESPOSTA,
    mensagens: mensagemDaPergunta(pergunta, trechos),
    esforco: 'low',
    maxTokens: 8000,
    simulacao: () => simularResposta(pergunta, trechos),
  });
  const { texto, citacoes } = montarRespostaCitada(r.conteudo, trechos);
  const { confianca, semResposta } = avaliarConfianca(pergunta, r.conteudo, trechos);
  const ferramenta = r.conteudo.find((b) => b.type === 'tool_use' && b.name === FERRAMENTA_SEM_RESPOSTA);
  const motivo =
    ferramenta && ferramenta.type === 'tool_use' && typeof (ferramenta.input as { motivo?: unknown })?.motivo === 'string'
      ? String((ferramenta.input as { motivo: string }).motivo)
      : undefined;
  return {
    resposta: {
      texto: texto || 'Não encontrei isso nas fontes cadastradas.',
      citacoes,
      confianca,
    },
    semResposta,
    motivo,
  };
}

// Agente simulado (sem ANTHROPIC_API_KEY e nos testes): decide por regras o que um modelo faria
// no turno, lendo a transcrição no mesmo formato da API. Com o Claude de verdade, nada daqui roda.
import type Anthropic from '@anthropic-ai/sdk';
import type { BlocoResposta, MensagemLlm, PedidoTurno } from '../llm/tipos.ts';
import { sim } from '../llm/simulado.ts';
import type { TarefaEmUso } from '../servicos/catalogo.ts';
import {
  agradecimento,
  extrairCampos,
  normalizar,
  pareceDuvida,
  pedePessoa,
  pontuarTarefa,
  respostaDireta,
  saudacao,
  temaDoPedido,
} from './extracao.ts';
import { FERRAMENTA_CONHECIMENTO, FERRAMENTA_PESSOA, PREFIXO_TAREFA, nomeFerramenta, type ResultadoFerramenta } from './ferramentas.ts';

export interface EstadoSimulacao {
  primeiroNome: string;
  sistema: string;
  tarefas: Pick<TarefaEmUso, 'slug' | 'definicao'>[];
  pessoas: string[];
  agora?: Date;
}

type BlocoEntrada = Anthropic.Beta.BetaContentBlockParam;

function blocos(m: MensagemLlm | undefined): BlocoEntrada[] {
  if (!m) return [];
  return typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as BlocoEntrada[]);
}

/** Texto que a pessoa escreveu (sem as linhas de contexto entre colchetes). */
export function textoDaPessoa(m: MensagemLlm | undefined): string {
  return blocos(m)
    .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .split('\n')
    .filter((l) => !/^\[.*\]$/.test(l.trim()))
    .join('\n')
    .trim();
}

function notas(m: MensagemLlm | undefined): string {
  return blocos(m)
    .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Última chamada de tarefa na transcrição e o resultado dela. */
export function ultimaTarefa(mensagens: MensagemLlm[]): { nome: string; entrada: Record<string, string>; resultado: ResultadoFerramenta | null } | null {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    if (m.role !== 'assistant') continue;
    const uso = blocos(m)
      .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use')
      .find((b) => b.name.startsWith(PREFIXO_TAREFA));
    if (!uso) continue;
    const prox = mensagens[i + 1];
    const res = blocos(prox).find(
      (b): b is Anthropic.Beta.BetaToolResultBlockParam => b.type === 'tool_result' && b.tool_use_id === uso.id,
    );
    let resultado: ResultadoFerramenta | null = null;
    if (res && typeof res.content === 'string') {
      try {
        resultado = JSON.parse(res.content) as ResultadoFerramenta;
      } catch {
        resultado = null;
      }
    }
    return { nome: uso.name, entrada: (uso.input ?? {}) as Record<string, string>, resultado };
  }
  return null;
}

/** Há uma coleta em andamento (o copiloto perguntou um dado e espera a resposta)? */
export function coletaAtiva(mensagens: MensagemLlm[]): boolean {
  const u = ultimaTarefa(mensagens.slice(0, -1));
  return !!u?.resultado && ['faltam_dados', 'dados_invalidos'].includes(u.resultado.situacao);
}

/** Quantos blocos search_result há antes da mensagem `ate` (índice global das citações). */
function contarResultadosBusca(mensagens: MensagemLlm[], ate: number): number {
  let n = 0;
  for (let i = 0; i < ate; i++) {
    for (const b of blocos(mensagens[i])) {
      if (b.type === 'search_result') n++;
      if (b.type === 'tool_result' && Array.isArray(b.content)) n += b.content.filter((c) => c.type === 'search_result').length;
    }
  }
  return n;
}

function frasesRelevantes(texto: string, pergunta: string): string {
  const frases = texto.split(/(?<=[.!?])\s+/).filter((f) => f.trim().length > 20);
  const palavras = new Set(
    normalizar(pergunta)
      .split(/\W+/)
      .filter((p) => p.length > 3),
  );
  const pontuadas = frases.map((f, i) => ({
    f,
    i,
    p: normalizar(f)
      .split(/\W+/)
      .filter((w) => palavras.has(w)).length,
  }));
  const melhores = pontuadas.sort((a, b) => b.p - a.p || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  const r = melhores.map((x) => x.f.trim()).join(' ');
  return r || texto.slice(0, 300);
}

function responderResultados(est: EstadoSimulacao, mensagens: MensagemLlm[]): BlocoResposta[] {
  const ultima = mensagens[mensagens.length - 1];
  const saida: BlocoResposta[] = [];
  const pergunta = (() => {
    const anterior = mensagens[mensagens.length - 2];
    const uso = blocos(anterior).find(
      (b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use' && b.name === FERRAMENTA_CONHECIMENTO,
    );
    return String((uso?.input as { pergunta?: string } | undefined)?.pergunta ?? '');
  })();
  for (const b of blocos(ultima)) {
    if (b.type !== 'tool_result') continue;
    if (typeof b.content === 'string') {
      try {
        const r = JSON.parse(b.content) as ResultadoFerramenta;
        if (r.situacao === 'pessoa_chamada') continue;
        if (r.resposta_sugerida) saida.push(sim.texto(r.resposta_sugerida));
      } catch {
        saida.push(sim.texto(b.content));
      }
      continue;
    }
    const resultados = (b.content ?? []).filter(
      (c): c is Anthropic.Beta.BetaSearchResultBlockParam => c.type === 'search_result',
    );
    if (!resultados.length) continue;
    const base = contarResultadosBusca(mensagens, mensagens.length - 1);
    const primeiro = resultados[0];
    const texto = primeiro.content.map((c) => c.text).join(' ');
    const trecho = frasesRelevantes(texto, pergunta);
    saida.push(sim.texto('Encontrei isto na base de conhecimento: '));
    saida.push({
      type: 'text',
      text: trecho,
      citations: [
        {
          type: 'search_result_location',
          search_result_index: base,
          source: primeiro.source,
          title: primeiro.title,
          cited_text: texto,
          start_block_index: 0,
          end_block_index: primeiro.content.length,
        },
      ],
    } as BlocoResposta);
  }
  return saida.length ? saida : [sim.texto('Pronto.')];
}

function melhorTarefa(est: EstadoSimulacao, texto: string): { slug: string; pontos: number } | null {
  let melhor: { slug: string; pontos: number } | null = null;
  for (const t of est.tarefas) {
    const pontos = pontuarTarefa(t.definicao, texto);
    if (!melhor || pontos > melhor.pontos) melhor = { slug: t.slug, pontos };
  }
  return melhor && melhor.pontos > 0 ? melhor : null;
}

function chamarTarefa(est: EstadoSimulacao, slug: string, texto: string, base: Record<string, string> = {}): BlocoResposta[] {
  const t = est.tarefas.find((x) => x.slug === slug)!;
  const extraidos = extrairCampos(t.definicao.campos, texto, { agora: est.agora, pessoas: est.pessoas });
  return [sim.ferramenta(nomeFerramenta(slug), { ...base, ...extraidos })];
}

function exemplosDoQueSei(est: EstadoSimulacao): string {
  const nomes = est.tarefas.slice(0, 3).map((t) => t.definicao.nome.toLowerCase());
  if (!nomes.length) return `tirar dúvidas sobre o ${est.sistema}`;
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} ou ${nomes[nomes.length - 1]}` : nomes[0];
}

/** Regra de simulação para um turno do agente. */
export function simularAgente(est: EstadoSimulacao): (pedido: PedidoTurno) => BlocoResposta[] {
  return (pedido) => {
    const mensagens = pedido.mensagens;
    const ultima = mensagens[mensagens.length - 1];
    if (blocos(ultima).some((b) => b.type === 'tool_result')) return responderResultados(est, mensagens);

    const texto = textoDaPessoa(ultima);
    const contexto = notas(ultima);
    if (!texto) return [sim.texto('Pode repetir? Não recebi o texto da mensagem.')];

    if (pedePessoa(texto)) return [sim.ferramenta(FERRAMENTA_PESSOA, { motivo: 'A pessoa pediu para falar com alguém.' })];

    // Correção pedida pelo cartão: retoma os dados do cartão e aplica o que mudou.
    const correcao = contexto.match(/tocou em “Corrigir” no cartão \S+ \(([^)]+)\).*?Dados do cartão: (\{.*?\})\./s);
    if (correcao) {
      const t = est.tarefas.find((x) => x.definicao.nome === correcao[1]);
      if (t) {
        let base: Record<string, string> = {};
        try {
          base = JSON.parse(correcao[2]) as Record<string, string>;
        } catch {
          base = {};
        }
        return chamarTarefa(est, t.slug, texto, base);
      }
    }

    const duvida = pareceDuvida(texto);
    const melhor = melhorTarefa(est, texto);

    // Resposta a uma pergunta do copiloto sobre um dado.
    const anterior = ultimaTarefa(mensagens.slice(0, -1));
    if (anterior?.resultado && (anterior.resultado.situacao === 'faltam_dados' || anterior.resultado.situacao === 'dados_invalidos')) {
      const t = est.tarefas.find((x) => nomeFerramenta(x.slug) === anterior.nome);
      const outra = melhor && melhor.slug !== t?.slug && melhor.pontos >= 3;
      if (t && !outra && !duvida.forte) {
        const pendente =
          anterior.resultado.situacao === 'faltam_dados' ? anterior.resultado.faltam[0]?.campo : anterior.resultado.erros[0]?.campo;
        const campo = t.definicao.campos.find((c) => c.chave === pendente);
        const extraidos = extrairCampos(t.definicao.campos, texto, { agora: est.agora, pessoas: est.pessoas });
        const entrada = { ...anterior.entrada, ...extraidos };
        if (campo && !extraidos[campo.chave]) entrada[campo.chave] = respostaDireta(campo, texto, est.agora);
        return [sim.ferramenta(nomeFerramenta(t.slug), entrada)];
      }
    }

    if (melhor && melhor.pontos >= 3 && !duvida.forte) return chamarTarefa(est, melhor.slug, texto);
    if (duvida.fraca) return [sim.ferramenta(FERRAMENTA_CONHECIMENTO, { pergunta: texto })];
    if (melhor && melhor.pontos >= 2) return chamarTarefa(est, melhor.slug, texto);
    if (saudacao(texto)) {
      return [sim.texto(`Oi, ${est.primeiroNome}! Posso ${exemplosDoQueSei(est)}. É só dizer do seu jeito.`)];
    }
    if (agradecimento(texto)) return [sim.texto('Por nada! Se precisar de mais alguma coisa, é só chamar.')];
    if (temaDoPedido(texto)) {
      return [
        sim.texto(
          `Ainda não consigo fazer isso pelo copiloto. Anotei o pedido para a equipe que configura o ${est.sistema}. Se for urgente, posso chamar uma pessoa.`,
        ),
      ];
    }
    return [
      sim.texto(`Não entendi bem o que você precisa. Pode dizer de outro jeito? Por exemplo, posso ${exemplosDoQueSei(est)}.`),
    ];
  };
}

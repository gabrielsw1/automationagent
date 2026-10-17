// Base de conhecimento. (Implementação inicial mínima: busca FTS5. A ingestão de fontes,
// o "Testar uma pergunta" e as rotas do console ficam em arquivos desta pasta.)
import type { RespostaTeste } from '@copiloto/shared';
import { agoraIso, type Banco } from '../db/banco.ts';
import type { Llm } from '../llm/tipos.ts';
import { novoId } from '../util/ids.ts';
import type { BaseConhecimento, Trecho } from './tipos.ts';

export * from './tipos.ts';

/** Transforma uma pergunta livre numa consulta FTS5 segura (termos com OR, sem operadores). */
export function consultaFts(pergunta: string): string | null {
  const termos = pergunta
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g);
  if (!termos) return null;
  const unicos = [...new Set(termos)].filter((t) => !PARADAS.has(t));
  if (unicos.length === 0) return null;
  return unicos.map((t) => `"${t}"*`).join(' OR ');
}

const PARADAS = new Set([
  'como', 'que', 'para', 'por', 'com', 'uma', 'umas', 'uns', 'dos', 'das', 'nos', 'nas', 'qual', 'quais',
  'onde', 'quando', 'ser', 'esta', 'este', 'isso', 'isto', 'tem', 'ter', 'sao', 'nao', 'sim', 'mais', 'pelo',
  'pela', 'meu', 'minha', 'seu', 'sua', 'voce', 'posso', 'pode', 'fazer', 'faco', 'preciso', 'quero',
]);

export function normalizarChave(pergunta: string): string {
  return (consultaFts(pergunta) ?? pergunta.toLowerCase()).replace(/[^a-z0-9 ]/g, '').split(' ').sort().join(' ');
}

export class Conhecimento implements BaseConhecimento {
  constructor(
    private readonly banco: Banco,
    private readonly _llm: Llm,
  ) {}

  buscar(pergunta: string, limite = 5): Trecho[] {
    const q = consultaFts(pergunta);
    if (!q) return [];
    const linhas = this.banco.todos<{
      fonte_id: string;
      titulo: string;
      local: string | null;
      url: string | null;
      texto: string;
      rank: number;
    }>(
      `SELECT t.fonte_id, t.titulo, t.local, t.url, t.texto, bm25(conhecimento_trechos) AS rank
       FROM conhecimento_trechos t JOIN conhecimento_fontes f ON f.id = t.fonte_id
       WHERE conhecimento_trechos MATCH ? AND f.status = 'indexado'
       ORDER BY rank LIMIT ?`,
      q,
      limite,
    );
    return linhas.map((l) => ({
      fonteId: l.fonte_id,
      titulo: l.titulo,
      local: l.local ?? undefined,
      url: l.url ?? undefined,
      texto: l.texto,
      pontuacao: -l.rank,
    }));
  }

  registrarSemResposta(pergunta: string, causa: string) {
    const chave = normalizarChave(pergunta);
    const agora = agoraIso();
    this.banco.executar(
      `INSERT INTO perguntas_sem_resposta (id, pergunta, chave, causa, vezes, ultima_em) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(chave) DO UPDATE SET vezes = vezes + 1, ultima_em = excluded.ultima_em, causa = excluded.causa,
       resolvida = 0`,
      novoId('psr'),
      pergunta,
      chave,
      causa,
      agora,
    );
  }

  async responder(pergunta: string): Promise<RespostaTeste> {
    const inicio = Date.now();
    const trechos = this.buscar(pergunta, 3);
    if (trechos.length === 0) {
      return { texto: 'Não encontrei isso nas fontes.', citacoes: [], confianca: 'baixa', duracaoMs: Date.now() - inicio };
    }
    return {
      texto: trechos[0].texto.slice(0, 400),
      citacoes: trechos.map((t, i) => ({ n: i + 1, titulo: t.titulo, local: t.local, url: t.url })),
      confianca: 'media',
      duracaoMs: Date.now() - inicio,
    };
  }

  retomar() {}
}

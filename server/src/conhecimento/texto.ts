// Tratamento de texto em português para a busca: sem acento, sem caixa, radical simples
// (boleto/boletos, emito/emitir), sinônimos curtos e consulta FTS5 segura.

/** Tira acentos (ã → a, ç → c). */
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Palavras do texto, minúsculas e sem acento. */
export function palavras(s: string): string[] {
  return semAcento(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export const PARADAS = new Set([
  'como', 'que', 'para', 'por', 'com', 'uma', 'umas', 'uns', 'dos', 'das', 'nos', 'nas', 'num', 'numa', 'qual',
  'quais', 'onde', 'quando', 'quanto', 'quantos', 'ser', 'esta', 'este', 'estes', 'estas', 'essa', 'esse', 'isso',
  'isto', 'aquele', 'aquela', 'tem', 'ter', 'tenho', 'sao', 'nao', 'sim', 'mais', 'menos', 'pelo', 'pela', 'pelos',
  'pelas', 'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'voce', 'voces', 'posso', 'pode', 'podem',
  'podemos', 'fazer', 'faco', 'faz', 'feito', 'preciso', 'precisa', 'quero', 'queria', 'gostaria', 'saber', 'sei',
  'existe', 'algum', 'alguma', 'sobre', 'entre', 'depois', 'antes', 'ate', 'tambem', 'muito', 'cada', 'todo', 'toda',
  'todos', 'todas', 'mesmo', 'aqui', 'ali', 'consigo', 'devo', 'deve', 'vou', 'vai', 'foi', 'era', 'sistema', 'ola',
  'obrigado', 'obrigada', 'favor', 'ajuda', 'ajudar', 'duvida', 'oque', 'porque', 'entao', 'ainda', 'agora', 'aos',
  'ele', 'ela', 'eles', 'elas', 'lhe', 'nosso', 'nossa', 'the', 'and', 'usar', 'uso', 'utilizar', 'ver', 'vejo',
  'acho', 'achar', 'encontro', 'encontrar', 'fica', 'ficar', 'aparece', 'consegue', 'conseguir', 'temos', 'dar',
  'alguem', 'coisa', 'jeito', 'forma', 'certo', 'certa',
]);

const SUFIXOS = [
  'amentos', 'imentos', 'amento', 'imento', 'mentos', 'mento', 'acoes', 'icoes', 'coes', 'cao', 'sao', 'oes',
  'idades', 'idade', 'mente', 'ando', 'endo', 'indo', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada', 'ido', 'ida',
  'ar', 'er', 'ir', 'os', 'as', 'es', 'is', 'il', 'o', 'a', 'e', 's',
];

/** Radical simples: tira um sufixo comum, deixando pelo menos 4 letras. "boletos" → "bolet". */
export function radical(p: string): string {
  if (/^\d+$/.test(p)) return p;
  for (const s of SUFIXOS) {
    if (p.endsWith(s) && p.length - s.length >= 4) return p.slice(0, -s.length);
  }
  return p;
}

/** Sinônimos curtos (palavra da pergunta → palavras que costumam aparecer nas fontes). */
const SINONIMOS: Record<string, string[]> = {
  fatura: ['boleto'],
  faturas: ['boleto'],
  cobranca: ['boleto'],
  ticket: ['chamado'],
  tickets: ['chamado'],
  incluir: ['cadastrar'],
  registrar: ['cadastrar'],
  mudar: ['alterar'],
  trocar: ['alterar'],
  permissao: ['perfil'],
  permissoes: ['perfil'],
  funcionario: ['usuario'],
  colaborador: ['usuario'],
  login: ['acesso', 'entrar'],
  senha: ['acesso'],
  marcar: ['agendar'],
};

/**
 * Verbos de radical curto (abrir, pagar), em que o corte de sufixo não junta as formas:
 * cada forma da pergunta aceita todas as outras.
 */
const FORMAS: string[][] = [
  ['abrir', 'abro', 'abre', 'abra', 'abrem', 'abriu', 'abrindo', 'aberto', 'aberta', 'abertura'],
  ['pagar', 'pago', 'paga', 'pagam', 'pague', 'pagou', 'pagando', 'pagamento', 'pagamentos'],
  ['ler', 'leio', 'leia', 'lido', 'leitura'],
];
const FORMA_DE = new Map(FORMAS.flatMap((g) => g.map((p) => [p, g] as const)));

/** Tira da lista os radicais que já são cobertos por outro mais curto (prefixo). */
function semRedundancia(radicais: string[]): string[] {
  const unicos = [...new Set(radicais)].sort((a, b) => a.length - b.length);
  return unicos.filter((r, i) => !unicos.slice(0, i).some((outro) => r.startsWith(outro)));
}

export interface GrupoTermo {
  /** Palavra como a pessoa escreveu (sem acento). */
  palavra: string;
  /** Radicais aceitos: o da palavra e os dos sinônimos. */
  radicais: string[];
}

/** Termos significativos da pergunta, cada um com seus radicais. */
export function termosDaPergunta(pergunta: string): GrupoTermo[] {
  const texto = semAcento(pergunta)
    .toLowerCase()
    .replace(/\b2\s*(?:a|ª|o)?\.?\s*via\b/g, 'segunda via');
  const vistos = new Set<string>();
  const grupos: GrupoTermo[] = [];
  for (const p of palavras(texto)) {
    if (p.length < 3 && !/^\d{2,}$/.test(p)) continue;
    if (PARADAS.has(p)) continue;
    const formas = FORMA_DE.get(p);
    // O primeiro radical é a chave do termo (usada para agrupar perguntas).
    const r = formas ? radical(formas[0]) : radical(p);
    if (vistos.has(r)) continue;
    vistos.add(r);
    const extras = [...(formas ?? []).map((f) => radical(f)), ...(SINONIMOS[p] ?? []).map((s) => radical(s))];
    grupos.push({ palavra: p, radicais: [r, ...semRedundancia(extras).filter((x) => x !== r && !x.startsWith(r))] });
  }
  return grupos;
}

/** Transforma uma pergunta livre numa consulta FTS5 segura (prefixos com OR, sem operadores). */
export function consultaFts(pergunta: string): string | null {
  const grupos = termosDaPergunta(pergunta);
  if (grupos.length === 0) return null;
  const termos = [...new Set(grupos.flatMap((g) => g.radicais))];
  return termos.map((t) => `"${t}"*`).join(' OR ');
}

/** Fração dos termos da pergunta que aparecem no texto (0 a 1), com a mesma regra de prefixo do FTS. */
export function cobertura(grupos: GrupoTermo[], texto: string): number {
  if (grupos.length === 0) return 0;
  const ps = new Set(palavras(texto));
  const lista = [...ps];
  let achados = 0;
  for (const g of grupos) {
    if (g.radicais.some((r) => ps.has(r) || lista.some((p) => p.startsWith(r)))) achados += 1;
  }
  return achados / grupos.length;
}

/** Chave estável de uma pergunta (radicais em ordem), usada para agrupar perguntas iguais. */
export function normalizarChave(pergunta: string): string {
  const r = termosDaPergunta(pergunta).map((g) => g.radicais[0]);
  if (r.length === 0) return semAcento(pergunta).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  return [...new Set(r)].sort().join(' ');
}

/** Semelhança entre duas perguntas (radicais em comum), de 0 a 1. */
export function semelhanca(a: string, b: string): number {
  return semelhancaDeChaves(normalizarChave(a), normalizarChave(b));
}

/** Divide um texto em frases (mantém a pontuação). */
export function frases(texto: string): string[] {
  // Corta depois de . ! ? … seguidos de espaço ("R$ 1.290" e "2ª via." ficam inteiros).
  return texto
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+(?=[^\s])/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Semelhança entre duas chaves de `normalizarChave` (Jaccard), de 0 a 1. */
export function semelhancaDeChaves(a: string, b: string): number {
  const ra = new Set(a.split(' ').filter(Boolean));
  const rb = new Set(b.split(' ').filter(Boolean));
  if (ra.size === 0 || rb.size === 0) return 0;
  let comum = 0;
  for (const x of ra) if (rb.has(x)) comum += 1;
  const j = comum / (ra.size + rb.size - comum);
  // Uma contém a outra (ex.: "cancelar assinatura" e "cancelar assinatura do cliente").
  const contida = comum === Math.min(ra.size, rb.size) && comum >= 2;
  return contida ? Math.max(j, 0.75) : j;
}

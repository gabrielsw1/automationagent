// Utilidades de texto do caminho navegador: normalização, similaridade entre rótulos,
// nomes de campo e títulos em linguagem simples.

const PALAVRAS_VAZIAS = new Set([
  'a', 'o', 'as', 'os', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'para', 'por', 'com', 'ao', 'aos', 'pra', 'pelo', 'pela', 'the', 'of',
]);

/** Minúsculas, sem acento, só letras e números separados por espaço. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/[^a-z0-9ªº ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Radicais curtos das palavras com significado ("agendar" e "agendamento" viram "agend"). */
export function radicais(s: string | null | undefined): Set<string> {
  const r = new Set<string>();
  for (const p of normalizar(s).split(' ')) {
    if (!p || PALAVRAS_VAZIAS.has(p)) continue;
    r.add(p.length > 5 ? p.slice(0, 5) : p);
  }
  return r;
}

/**
 * Similaridade entre dois textos curtos (0 a 1): metade pela sobreposição dos radicais (Dice),
 * metade por quanto o texto menor está contido no maior. Iguais = 1.
 */
export function similaridade(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ra = radicais(na);
  const rb = radicais(nb);
  if (ra.size === 0 || rb.size === 0) return 0;
  let comuns = 0;
  for (const x of ra) if (rb.has(x)) comuns++;
  const dice = (2 * comuns) / (ra.size + rb.size);
  const contido = comuns / Math.min(ra.size, rb.size);
  return 0.5 * dice + 0.5 * contido;
}

/** Maior similaridade entre quaisquer dois textos das listas. */
export function melhorSimilaridade(as: (string | null | undefined)[], bs: (string | null | undefined)[]): number {
  let melhor = 0;
  for (const a of as) for (const b of bs) melhor = Math.max(melhor, similaridade(a, b));
  return melhor;
}

/** "doc_pagador" → "doc pagador"; "dataVisita" → "data visita". */
export function humanizar(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chave técnica em snake_case, sem acento e sem palavras vazias. Ex.: "CPF/CNPJ do pagador" → "cpf_cnpj_pagador". */
export function chaveDe(s: string): string {
  const partes = normalizar(humanizar(s))
    .split(' ')
    .filter((p) => p && !PALAVRAS_VAZIAS.has(p));
  const chave = partes.join('_').slice(0, 40).replace(/_+$/g, '');
  return chave || 'campo';
}

/** Minúscula na primeira letra, a menos que seja sigla ("CPF/CNPJ" fica igual). */
export function minusculaInicial(s: string): string {
  if (s.length < 2) return s.toLowerCase();
  const segunda = s[1];
  if (segunda === segunda.toUpperCase() && segunda !== segunda.toLowerCase()) return s;
  return s[0].toLowerCase() + s.slice(1);
}

export function maiusculaInicial(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Artigo provável pelo gênero da primeira palavra ("Data" → "a", "Horário" → "o"). */
export function artigo(rotulo: string): 'a' | 'o' {
  const primeira = normalizar(rotulo).split(' ')[0] ?? '';
  if (/(cao|sao|razao|dade|gem|ncia|a)$/.test(primeira) && !/(dia|mapa|sistema|problema|tema|plano)$/.test(primeira)) return 'a';
  return 'o';
}

/** Pergunta que o agente faz quando falta o dado. Ex.: "Qual é a data da visita?" */
export function perguntaPara(rotulo: string): string {
  const r = minusculaInicial(rotulo.trim());
  return `Qual é ${artigo(rotulo)} ${r}?`;
}

const PASSADO_ESPECIAL: Record<string, string> = {
  ir: 'Foi',
  ver: 'Viu',
  pôr: 'Pôs',
  por: 'Pôs',
  fazer: 'Fez',
  dar: 'Deu',
  trazer: 'Trouxe',
  pedir: 'Pediu',
};

function verboNoPassado(verbo: string): string | null {
  const v = verbo.toLowerCase();
  const especial = PASSADO_ESPECIAL[v];
  if (especial) return especial;
  if (v.length < 3) return null;
  if (/ar$/.test(v)) return verbo.slice(0, -2) + 'ou';
  if (/er$/.test(v)) return verbo.slice(0, -2) + 'eu';
  if (/ir$/.test(v)) return verbo.slice(0, -2) + 'iu';
  return null;
}

/**
 * Passa o verbo do título do passo para o passado: "Preencher CPF/CNPJ" → "Preencheu CPF/CNPJ";
 * "Gerar a 2ª via e baixar o PDF" → "Gerou a 2ª via e baixou o PDF".
 */
export function noPassado(titulo: string): string {
  const primeiro = noPassadoPrimeiro(titulo);
  return primeiro.replace(/(\se\s)(\p{L}+)(?=\s|$)/gu, (m, e: string, verbo: string) => {
    const p = /(ar|er|ir)$/i.test(verbo) ? verboNoPassado(verbo) : null;
    return p ? e + p.toLowerCase() : m;
  });
}

function noPassadoPrimeiro(titulo: string): string {
  const m = titulo.match(/^(\S+)(.*)$/s);
  if (!m) return titulo;
  const verbo = m[1];
  const resto = m[2];
  const v = verbo.toLowerCase();
  let passado: string | null = PASSADO_ESPECIAL[v] ?? null;
  if (!passado) {
    if (/ar$/.test(v)) passado = verbo.slice(0, -2) + 'ou';
    else if (/er$/.test(v)) passado = verbo.slice(0, -2) + 'eu';
    else if (/ir$/.test(v)) passado = verbo.slice(0, -2) + 'iu';
  }
  if (!passado) return titulo;
  return maiusculaInicial(passado) + resto;
}

/** Corta texto longo com reticências. */
export function encurtar(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Caminho relativo (com busca) de uma URL, sem o parâmetro do gravador. */
export function caminhoDe(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    u.searchParams.delete('copiloto_gravacao');
    const busca = u.searchParams.toString();
    return u.pathname + (busca ? `?${busca}` : '');
  } catch {
    return url;
  }
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "outubro de 2026" → "10/2026"; "out/26" → "10/2026". Devolve null quando não reconhece mês por extenso. */
export function mesPorExtenso(s: string): string | null {
  const n = normalizar(s);
  const i = MESES.findIndex((m) => n.startsWith(m) || n.startsWith(m.slice(0, 3) + ' ') || n === m.slice(0, 3));
  if (i < 0) return null;
  const ano = n.match(/(\d{4}|\d{2})\s*$/)?.[1];
  const anoCompleto = ano ? (ano.length === 2 ? `20${ano}` : ano) : String(new Date().getFullYear());
  return `${String(i + 1).padStart(2, '0')}/${anoCompleto}`;
}

// Divisão de documentos em trechos de ~800 a 1.200 caracteres, respeitando títulos e parágrafos,
// cada um com um "local" legível ("página 12", "seção Boletos", "02:14").
import { frases } from './texto.ts';

export const TAMANHO_MIN = 800;
export const TAMANHO_MAX = 1200;
/** Pedaço máximo de um parágrafo longo (cortado por frases). */
const PEDACO_MAX = 700;
/** Numa troca de seção, fecha o trecho atual se ele já tem pelo menos isto. */
const FECHAR_NA_SECAO = 400;

export interface Paragrafo {
  texto: string;
  /** Local próprio do parágrafo (ex.: tempo "02:14" numa transcrição). */
  local?: string;
}

export interface Secao {
  /** Título da seção (entra no texto do trecho). */
  cabecalho?: string;
  /** Ex.: "seção Boletos". */
  local?: string;
  /** Página do PDF (trechos que juntam páginas viram "páginas 3–4"). */
  pagina?: number;
  paragrafos: (string | Paragrafo)[];
}

export interface TrechoNovo {
  titulo: string;
  local?: string;
  url?: string;
  texto: string;
}

/** Espaços normalizados, sem linhas em branco repetidas. */
export function limparTexto(t: string): string {
  return t
    .replace(/ /g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Corta um parágrafo longo em pedaços de até PEDACO_MAX, por frases (e por palavras, se preciso). */
export function cortarParagrafo(texto: string, max = PEDACO_MAX): string[] {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t ? [t] : [];
  const saida: string[] = [];
  let atual = '';
  const empurrar = (p: string) => {
    if (!atual) atual = p;
    else if (atual.length + 1 + p.length <= max) atual += ' ' + p;
    else {
      saida.push(atual);
      atual = p;
    }
  };
  for (const f of frases(t)) {
    if (f.length <= max) {
      empurrar(f);
      continue;
    }
    // Frase gigante (tabela colada, lista sem pontuação): corta por palavras.
    let pedaco = '';
    for (const palavra of f.split(' ')) {
      if (pedaco && pedaco.length + 1 + palavra.length > max) {
        empurrar(pedaco);
        pedaco = palavra;
      } else pedaco = pedaco ? `${pedaco} ${palavra}` : palavra;
    }
    if (pedaco) empurrar(pedaco);
  }
  if (atual) saida.push(atual);
  return saida;
}

interface Pedaco {
  texto: string;
  local?: string;
  pagina?: number;
  /** Índice da seção de origem. */
  secao: number;
}

function localDoTrecho(pedacos: Pedaco[]): string | undefined {
  const paginas = pedacos.map((p) => p.pagina).filter((p): p is number => typeof p === 'number');
  if (paginas.length) {
    const a = Math.min(...paginas);
    const b = Math.max(...paginas);
    return a === b ? `página ${a}` : `páginas ${a}–${b}`;
  }
  const locais = [...new Set(pedacos.map((p) => p.local).filter((l): l is string => !!l))];
  const secoes = locais.filter((l) => l.startsWith('seção '));
  if (secoes.length >= 2 && secoes.length === locais.length) {
    const nomes = secoes.map((l) => l.slice('seção '.length));
    if (nomes.length > 3) return `seção ${nomes[0]} e seguintes`;
    return `seções ${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  }
  return locais[0];
}

/**
 * Junta as seções em trechos: fecha um trecho ao passar de TAMANHO_MAX e, numa troca de seção,
 * quando o atual já tem tamanho razoável. Seções pequenas seguidas ficam juntas.
 */
export function dividirEmTrechos(
  secoes: Secao[],
  base: { titulo: string; url?: string },
  opcoes: { fecharNaSecao?: number } = {},
): TrechoNovo[] {
  const fecharNaSecao = opcoes.fecharNaSecao ?? FECHAR_NA_SECAO;
  const trechos: { pedacos: Pedaco[]; tamanho: number }[] = [];
  let atual: { pedacos: Pedaco[]; tamanho: number } = { pedacos: [], tamanho: 0 };
  const fechar = () => {
    if (atual.tamanho > 0) trechos.push(atual);
    atual = { pedacos: [], tamanho: 0 };
  };
  const somar = (p: Pedaco) => {
    if (atual.tamanho > 0 && atual.tamanho + 1 + p.texto.length > TAMANHO_MAX) fechar();
    atual.pedacos.push(p);
    atual.tamanho += (atual.tamanho ? 1 : 0) + p.texto.length;
  };

  secoes.forEach((secao, indice) => {
    const paragrafos = secao.paragrafos
      .map((p) => (typeof p === 'string' ? { texto: p } : p))
      .map((p) => ({ ...p, texto: limparTexto(p.texto) }))
      .filter((p) => p.texto.length > 0);
    if (paragrafos.length === 0) return;
    const tamanhoSecao = paragrafos.reduce((s, p) => s + p.texto.length + 1, 0);
    // Troca de seção: fecha o trecho atual se ele já tem corpo, ou se a nova seção é grande
    // (assim ela começa no próprio trecho e o local fica certo).
    if (atual.tamanho >= fecharNaSecao || (atual.tamanho >= 150 && tamanhoSecao >= TAMANHO_MIN)) fechar();
    const cab = secao.cabecalho ? limparTexto(secao.cabecalho) : '';
    let primeiro = true;
    for (const p of paragrafos) {
      for (const parte of cortarParagrafo(p.texto)) {
        const local = p.local ?? secao.local;
        if (primeiro && cab) {
          // O título vai junto do primeiro pedaço da seção (nunca sozinho no fim de um trecho).
          const comTitulo = `${cab}\n${parte}`;
          if (atual.tamanho > 0 && atual.tamanho + 1 + comTitulo.length > TAMANHO_MAX) fechar();
          somar({ texto: comTitulo, local, pagina: secao.pagina, secao: indice });
        } else {
          somar({ texto: parte, local, pagina: secao.pagina, secao: indice });
        }
        primeiro = false;
      }
    }
  });
  fechar();

  // Um último trecho muito curto, continuação da mesma seção, vai para o anterior.
  if (trechos.length >= 2) {
    const ultimo = trechos[trechos.length - 1];
    const anterior = trechos[trechos.length - 2];
    const mesmaSecao = ultimo.pedacos[0].secao === anterior.pedacos[anterior.pedacos.length - 1].secao;
    if (mesmaSecao && ultimo.tamanho < 200 && anterior.tamanho + 1 + ultimo.tamanho <= TAMANHO_MAX * 1.25) {
      anterior.pedacos.push(...ultimo.pedacos);
      anterior.tamanho += 1 + ultimo.tamanho;
      trechos.pop();
    }
  }

  return trechos.map((t) => ({
    titulo: base.titulo,
    url: base.url,
    local: localDoTrecho(t.pedacos),
    texto: t.pedacos.map((p) => p.texto).join('\n'),
  }));
}

/** Tempo em segundos → "02:14" (ou "1:02:14" a partir de uma hora). */
export function formatarTempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dois(m)}:${dois(ss)}` : `${dois(m)}:${dois(ss)}`;
}

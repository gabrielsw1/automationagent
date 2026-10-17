// Leitura de cada formato de fonte para seções de texto: páginas HTML, PDF (por página), DOCX,
// Markdown/TXT, transcrições (.vtt/.srt ou texto colado) e respostas prontas.
import mammoth from 'mammoth';
import { parse, NodeType, type HTMLElement, type Node } from 'node-html-parser';
import { errosFonte, ErroFonte } from './erros.ts';
import { formatarTempo, limparTexto, type Paragrafo, type Secao } from './trechos.ts';

// ---------- HTML (páginas de site e DOCX convertido) ----------

const RUIDO = [
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas', 'nav', 'aside', 'form', 'button', 'select',
  'input', 'textarea', 'dialog', '[role=navigation]', '[role=banner]', '[role=contentinfo]', '[role=search]',
  '[role=complementary]', '[aria-hidden=true]', '[hidden]', '.menu', '.nav', '.navbar', '.sidebar', '.breadcrumb',
  '.breadcrumbs', '.cookie', '.cookies', '.cookie-banner', '.skip-link', '.sr-only', '.visually-hidden', '.toc',
  '[class*=breadcrumb]', '.trilha', '.pular', '.meta', '.post-meta', '.entry-meta', '.article-meta',
];

const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL',
  'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'LABEL', 'FONT', 'INS', 'DEL', 'IMG', 'WBR',
]);
const FOLHAS = new Set(['P', 'PRE', 'BLOCKQUOTE', 'DT', 'DD', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'ADDRESS']);

type Bloco = { tipo: 'titulo'; nivel: number; texto: string } | { tipo: 'paragrafo'; texto: string };

function textoDe(no: Node): string {
  return (no.text ?? '').replace(/\s+/g, ' ').trim();
}

function ehElemento(no: Node): no is HTMLElement {
  return no.nodeType === NodeType.ELEMENT_NODE;
}

/** Texto de um item com blocos dentro (link + descrição): os blocos ficam separados por " — ". */
function textoEmPartes(no: HTMLElement): string {
  const partes: string[] = [];
  let atual = '';
  const soltar = () => {
    const t = atual.replace(/\s+/g, ' ').trim();
    if (t) partes.push(t);
    atual = '';
  };
  const caminhar = (n: HTMLElement) => {
    for (const filho of n.childNodes) {
      if (filho.nodeType === NodeType.TEXT_NODE) atual += filho.text;
      else if (ehElemento(filho)) {
        if (filho.tagName === 'BR') atual += ' ';
        else if (INLINE.has(filho.tagName)) atual += filho.text;
        else {
          soltar();
          caminhar(filho);
          soltar();
        }
      }
    }
  };
  caminhar(no);
  soltar();
  return partes.join(' — ');
}

/** Item de lista que é só um link (menu, "Veja também"): não é conteúdo. */
function soLink(li: HTMLElement): boolean {
  const links = li.querySelectorAll('a');
  return links.length === 1 && textoDe(links[0]) === textoDe(li);
}

/** Percorre o HTML em ordem e devolve títulos e parágrafos. */
function blocosDoHtml(raiz: HTMLElement): Bloco[] {
  const blocos: Bloco[] = [];
  let solto = '';
  const soltar = () => {
    const t = solto.replace(/\s+/g, ' ').trim();
    if (t) blocos.push({ tipo: 'paragrafo', texto: t });
    solto = '';
  };
  const caminhar = (no: HTMLElement) => {
    for (const filho of no.childNodes) {
      if (filho.nodeType === NodeType.TEXT_NODE) {
        solto += ' ' + filho.text;
        continue;
      }
      if (!ehElemento(filho)) continue;
      const tag = filho.tagName;
      if (tag === 'BR') {
        solto += '\n';
        continue;
      }
      if (INLINE.has(tag)) {
        solto += ' ' + filho.text;
        continue;
      }
      soltar();
      const h = /^H([1-6])$/.exec(tag);
      if (h) {
        const t = textoDe(filho);
        if (t) blocos.push({ tipo: 'titulo', nivel: Number(h[1]), texto: t });
      } else if (tag === 'LI') {
        const sublistas = filho.querySelectorAll('ul, ol');
        if (sublistas.length) {
          const copia = parse(filho.toString());
          copia.querySelectorAll('ul, ol').forEach((l) => l.remove());
          const t = textoEmPartes(copia);
          if (t) blocos.push({ tipo: 'paragrafo', texto: `• ${t}` });
          for (const l of sublistas) if (l.parentNode === filho) caminhar(l);
        } else if (!soLink(filho)) {
          const t = textoEmPartes(filho);
          if (t) blocos.push({ tipo: 'paragrafo', texto: `• ${t}` });
        }
      } else if (tag === 'TR') {
        const celulas = filho.querySelectorAll('th, td').map(textoDe).filter(Boolean);
        if (celulas.length) blocos.push({ tipo: 'paragrafo', texto: celulas.join(' | ') });
      } else if (FOLHAS.has(tag)) {
        const t = tag === 'PRE' ? filho.text.trim() : textoDe(filho);
        if (t) blocos.push({ tipo: 'paragrafo', texto: t });
      } else {
        caminhar(filho);
        soltar();
      }
    }
  };
  caminhar(raiz);
  soltar();
  return blocos;
}

/** Agrupa blocos em seções a partir dos títulos (h2/h3...; o h1 é o título do documento). */
function secoesDosBlocos(blocos: Bloco[], tituloDoc: string, nivelSecao: number): Secao[] {
  const secoes: Secao[] = [{ paragrafos: [] }];
  for (const b of blocos) {
    if (b.tipo === 'titulo') {
      if (b.nivel < nivelSecao && b.texto === tituloDoc) continue;
      if (b.nivel <= nivelSecao + 1) {
        secoes.push({ cabecalho: b.texto, local: `seção ${b.texto}`, paragrafos: [] });
      } else {
        secoes[secoes.length - 1].paragrafos.push(b.texto);
      }
    } else {
      secoes[secoes.length - 1].paragrafos.push(b.texto);
    }
  }
  return secoes.filter((s) => s.paragrafos.length > 0);
}

export interface PaginaHtml {
  titulo: string;
  secoes: Secao[];
  links: string[];
  /** Tem formulário de senha (página de login). */
  pedeLogin: boolean;
  /** Pede para robôs não indexarem (meta robots noindex). */
  naoIndexar: boolean;
  /** Tamanho do texto útil. */
  caracteres: number;
}

/** Lê uma página de site: título, seções do conteúdo principal (sem menus e rodapés) e links. */
export function lerPaginaHtml(html: string): PaginaHtml {
  const doc = parse(html, { comment: false });
  const links = doc
    .querySelectorAll('a[href]')
    .filter((a) => !/\bnofollow\b/i.test(a.getAttribute('rel') ?? ''))
    .map((a) => a.getAttribute('href') ?? '')
    .filter(Boolean);
  const pedeLogin = doc.querySelectorAll('input[type=password]').length > 0;
  const robots = doc.querySelector('meta[name=robots]')?.getAttribute('content') ?? '';
  const naoIndexar = /noindex/i.test(robots);

  const principal =
    doc.querySelector('main') ?? doc.querySelector('[role=main]') ?? doc.querySelector('article') ?? doc.querySelector('body') ?? doc;
  const h1 = principal.querySelector('h1') ?? doc.querySelector('h1');
  const tituloPagina = (doc.querySelector('title')?.text ?? '').replace(/\s+/g, ' ').trim();
  const titulo = (h1 ? textoDe(h1) : '') || tituloPagina.split(/\s[|·–—-]\s/)[0] || tituloPagina || 'Página sem título';

  for (const sel of RUIDO) principal.querySelectorAll(sel).forEach((e) => e.remove());
  // Cabeçalhos e rodapés do site (os de dentro de um artigo ficam).
  for (const e of principal.querySelectorAll('header, footer')) {
    let p = e.parentNode;
    let dentroDeArtigo = false;
    while (p) {
      if (p.tagName === 'ARTICLE' || p.tagName === 'MAIN') dentroDeArtigo = true;
      p = p.parentNode;
    }
    if (!dentroDeArtigo || e.tagName === 'FOOTER') e.remove();
  }

  const blocos = blocosDoHtml(principal);
  const secoes = secoesDosBlocos(blocos, titulo, 2);
  const caracteres = secoes.reduce((s, x) => s + x.paragrafos.reduce((a, p) => a + (typeof p === 'string' ? p.length : p.texto.length), 0), 0);
  return { titulo, secoes, links, pedeLogin, naoIndexar, caracteres };
}

// ---------- PDF ----------

export interface PdfLido {
  paginas: number;
  /** Uma seção por página com texto. */
  secoes: Secao[];
}

/** Lê o PDF página a página. `aoPagina` recebe o progresso e pode interromper lançando um erro. */
export async function lerPdf(dados: Uint8Array, aoPagina?: (feitas: number, total: number) => void | Promise<void>): Promise<PdfLido> {
  const { getDocumentProxy } = await import('unpdf');
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(new Uint8Array(dados));
  } catch (e) {
    const nome = (e as { name?: string }).name ?? '';
    if (nome === 'PasswordException' || /password/i.test(String((e as Error).message))) throw errosFonte.pdfSenha();
    throw errosFonte.pdfInvalido();
  }
  const secoes: Secao[] = [];
  let caracteres = 0;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pagina = await doc.getPage(i);
      const conteudo = await pagina.getTextContent();
      let texto = '';
      for (const item of conteudo.items) {
        if (!('str' in item)) continue;
        texto += item.str + (item.hasEOL ? '\n' : '');
      }
      texto = texto.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2');
      const paragrafos = paragrafosDoTexto(texto, true);
      caracteres += paragrafos.reduce((s, p) => s + p.length, 0);
      if (paragrafos.length) secoes.push({ pagina: i, paragrafos });
      await aoPagina?.(i, doc.numPages);
    }
  } finally {
    await doc.cleanup().catch(() => {});
  }
  // Menos de 20 letras por página em média: é uma digitalização sem texto.
  if (caracteres < Math.max(20, doc.numPages * 20)) throw errosFonte.pdfEscaneado();
  return { paginas: doc.numPages, secoes };
}

/**
 * Parágrafos de um texto corrido. Linhas em branco separam parágrafos; em PDFs (`juntarLinhas`),
 * linhas que continuam a frase anterior são unidas.
 */
export function paragrafosDoTexto(texto: string, juntarLinhas = false): string[] {
  const blocos = texto.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const saida: string[] = [];
  for (const bloco of blocos) {
    const linhas = bloco.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!linhas.length) continue;
    if (!juntarLinhas) {
      saida.push(linhas.join('\n'));
      continue;
    }
    let atual = '';
    for (const linha of linhas) {
      const novoItem = /^([•\-–*]|\d+[.)])\s/.test(linha);
      const fimDeFrase = /[.!?:;]$/.test(atual);
      if (atual && (novoItem || (fimDeFrase && /^\p{Lu}/u.test(linha)))) {
        saida.push(atual);
        atual = linha;
      } else atual = atual ? `${atual} ${linha}` : linha;
    }
    if (atual) saida.push(atual);
  }
  return saida.map((p) => p.trim()).filter(Boolean);
}

// ---------- DOCX ----------

/** Lê um DOCX pelos títulos (Título 1/2 do Word viram seções). */
export async function lerDocx(dados: Buffer): Promise<{ titulo?: string; secoes: Secao[] }> {
  // Arquivo do Office protegido por senha ou .doc antigo: contêiner OLE (D0 CF 11 E0).
  if (dados.length >= 4 && dados.readUInt32BE(0) === 0xd0cf11e0) {
    const texto = dados.toString('latin1');
    if (/EncryptedPackage|EncryptionInfo/.test(texto)) throw errosFonte.docxSenha();
    throw errosFonte.docAntigo();
  }
  if (dados.length < 4 || dados.readUInt32LE(0) !== 0x04034b50) throw errosFonte.docxInvalido();
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: dados })).value;
  } catch {
    throw errosFonte.docxInvalido();
  }
  const doc = parse(`<body>${html}</body>`);
  const blocos = blocosDoHtml(doc.querySelector('body') ?? doc);
  const niveis = blocos.filter((b) => b.tipo === 'titulo').map((b) => (b as { nivel: number }).nivel);
  const menor = niveis.length ? Math.min(...niveis) : 1;
  // Se houver um único título do nível mais alto logo no começo, ele é o título do documento.
  const primeiro = blocos[0];
  const unicoNoTopo = primeiro?.tipo === 'titulo' && niveis.filter((n) => n === menor).length === 1;
  const titulo = unicoNoTopo ? primeiro.texto : undefined;
  const secoes = secoesDosBlocos(unicoNoTopo ? blocos.slice(1) : blocos, titulo ?? '', unicoNoTopo ? menor + 1 : menor);
  if (!secoes.length) throw errosFonte.arquivoVazio();
  return { titulo, secoes };
}

// ---------- Markdown e TXT ----------

/** Markdown: "#", "##"... viram seções; listas e parágrafos viram parágrafos. */
export function lerMarkdown(texto: string): { titulo?: string; secoes: Secao[] } {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const titulos = linhas.map((l) => /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)).filter(Boolean) as RegExpExecArray[];
  const menor = titulos.length ? Math.min(...titulos.map((m) => m[1].length)) : 1;
  const unicoNoTopo = titulos.filter((m) => m[1].length === menor).length === 1 && /^#{1,6}\s/.test(linhas.find((l) => l.trim()) ?? '');
  let titulo: string | undefined;
  const secoes: Secao[] = [{ paragrafos: [] }];
  let buffer: string[] = [];
  let emCodigo = false;
  const soltar = () => {
    const bloco = buffer.join('\n').trim();
    buffer = [];
    if (!bloco) return;
    secoes[secoes.length - 1].paragrafos.push(...paragrafosDoTexto(limparMarkdown(bloco)));
  };
  for (const linha of linhas) {
    if (/^\s*```/.test(linha)) {
      emCodigo = !emCodigo;
      continue;
    }
    const m = emCodigo ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(linha);
    if (m) {
      soltar();
      const nivel = m[1].length;
      const t = limparMarkdown(m[2]);
      if (unicoNoTopo && nivel === menor && !titulo) {
        titulo = t;
        continue;
      }
      const nivelSecao = unicoNoTopo ? menor + 1 : menor;
      if (nivel <= nivelSecao + 1) secoes.push({ cabecalho: t, local: `seção ${t}`, paragrafos: [] });
      else buffer.push(t, '');
      continue;
    }
    if (!linha.trim()) {
      soltar();
      continue;
    }
    // Itens de lista viram parágrafos próprios.
    if (/^\s*([-*+]|\d+[.)])\s+/.test(linha)) {
      soltar();
      buffer.push('• ' + linha.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      soltar();
      continue;
    }
    buffer.push(linha);
  }
  soltar();
  return { titulo, secoes: secoes.filter((s) => s.paragrafos.length) };
}

function limparMarkdown(t: string): string {
  return t
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^\|?\s*:?-{3,}.*$/gm, '')
    .trim();
}

/** Texto puro: parágrafos separados por linha em branco. Linhas curtas em maiúsculas viram seções. */
export function lerTxt(texto: string): { secoes: Secao[] } {
  const secoes: Secao[] = [{ paragrafos: [] }];
  for (const p of paragrafosDoTexto(texto)) {
    const linhas = p.split('\n');
    const primeira = linhas[0];
    const ehTitulo = primeira.length <= 60 && (/^[\p{Lu}\d\s:–-]+$/u.test(primeira) || /:$/.test(primeira)) && /\p{L}/u.test(primeira);
    if (ehTitulo) {
      const t = primeira.replace(/:$/, '').trim();
      const tituloBonito = /^[\p{Lu}\d\s:–-]+$/u.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
      secoes.push({ cabecalho: tituloBonito, local: `seção ${tituloBonito}`, paragrafos: linhas.slice(1).length ? [linhas.slice(1).join(' ')] : [] });
    } else {
      secoes[secoes.length - 1].paragrafos.push(linhas.join(' '));
    }
  }
  return { secoes: secoes.filter((s) => s.paragrafos.length) };
}

// ---------- Transcrições de vídeo ----------

/** "00:02:14.500", "02:14,500", "2:14" → segundos. */
export function tempoEmSegundos(t: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export interface TranscricaoLida {
  secoes: Secao[];
  /** Duração aproximada (último tempo), em segundos. */
  duracao: number | null;
  /** Falas encontradas. */
  falas: number;
  comTempo: boolean;
}

/**
 * Lê .vtt, .srt ou texto colado. Falas com tempo viram parágrafos com local "mm:ss"; sem tempo,
 * o texto é dividido por parágrafos.
 */
export function lerTranscricao(texto: string): TranscricaoLida {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const falas: { inicio: number; texto: string }[] = [];
  const RE_CUE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;
  const RE_TEMPO_LINHA = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–—]?\s*(.*)$/;
  const linhas = limpo.split('\n');
  let ultimoFim = 0;

  if (linhas.some((l) => RE_CUE.test(l))) {
    // WEBVTT ou SRT: bloco = [número] tempo --> tempo, texto...
    let atual: { inicio: number; partes: string[] } | null = null;
    const soltar = () => {
      if (atual && atual.partes.length) falas.push({ inicio: atual.inicio, texto: atual.partes.join(' ') });
      atual = null;
    };
    for (const linha of linhas) {
      const m = RE_CUE.exec(linha);
      if (m) {
        soltar();
        atual = { inicio: tempoEmSegundos(m[1]) ?? 0, partes: [] };
        ultimoFim = Math.max(ultimoFim, tempoEmSegundos(m[2]) ?? 0);
        continue;
      }
      if (!linha.trim()) {
        soltar();
        continue;
      }
      if (!atual) continue; // cabeçalho WEBVTT, NOTE, número do bloco SRT
      const t = linha
        .replace(/<v\s+([^>]+)>/g, '$1: ')
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]+\}/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      if (t) atual.partes.push(t);
    }
    soltar();
  } else if (linhas.filter((l) => RE_TEMPO_LINHA.exec(l)?.[2]).length >= 2) {
    // Texto colado com tempos no começo da linha ("02:14 Agora clique em...").
    let atual: { inicio: number; partes: string[] } | null = null;
    for (const linha of linhas) {
      const m = RE_TEMPO_LINHA.exec(linha);
      const seg = m ? tempoEmSegundos(m[1]) : null;
      if (m && seg !== null) {
        if (atual?.partes.length) falas.push({ inicio: atual.inicio, texto: atual.partes.join(' ') });
        atual = { inicio: seg, partes: m[2] ? [m[2].trim()] : [] };
        ultimoFim = Math.max(ultimoFim, seg);
      } else if (linha.trim() && atual) {
        atual.partes.push(linha.trim());
      }
    }
    if (atual?.partes.length) falas.push({ inicio: atual.inicio, texto: atual.partes.join(' ') });
  }

  if (falas.length) {
    // Legendas automáticas repetem a linha anterior: tira repetições seguidas.
    const unicas: typeof falas = [];
    for (const f of falas) {
      const anterior = unicas[unicas.length - 1];
      if (anterior && (anterior.texto === f.texto || anterior.texto.endsWith(f.texto))) continue;
      if (anterior && f.texto.startsWith(anterior.texto)) {
        anterior.texto = f.texto;
        continue;
      }
      unicas.push(f);
    }
    const paragrafos: Paragrafo[] = unicas.map((f) => ({ texto: f.texto, local: formatarTempo(f.inicio) }));
    return { secoes: [{ paragrafos }], duracao: ultimoFim || null, falas: unicas.length, comTempo: true };
  }

  const paragrafos = paragrafosDoTexto(limparTexto(limpo)).map((p) => p.replace(/\n/g, ' '));
  return { secoes: paragrafos.length ? [{ paragrafos }] : [], duracao: null, falas: paragrafos.length, comTempo: false };
}

/** Garante que o erro seja um ErroFonte (erros inesperados viram uma mensagem genérica). */
export function comoErroFonte(e: unknown): ErroFonte {
  return e instanceof ErroFonte ? e : errosFonte.inesperado();
}

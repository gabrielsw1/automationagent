// Gerador de PDF mínimo, sem biblioteca: páginas A4 com texto (Helvetica, WinAnsi), linhas e retângulos.
// Coordenadas em pontos, com y medido a partir do topo da página (mais natural para montar layouts).

export type Cor = readonly [number, number, number];

export const PRETO: Cor = [0, 0, 0];
export const CINZA: Cor = [0.38, 0.42, 0.47];
export const CINZA_CLARO: Cor = [0.9, 0.92, 0.94];

// Larguras da Helvetica (AFM padrão, em milésimos de em) para os caracteres 32 a 126.
const LARGURAS_HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const LARGURAS_HELVETICA_NEGRITO = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Caracteres fora do Latin-1 que existem na WinAnsiEncoding.
const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
};

function codigoWinAnsi(ch: string): number {
  const extra = WIN_ANSI_EXTRA[ch];
  if (extra !== undefined) return extra;
  const c = ch.codePointAt(0) ?? 63;
  if (c === 0x2009 || c === 0x202f) return 32;
  if (c >= 32 && c <= 126) return c;
  if (c >= 0xa0 && c <= 0xff) return c;
  return 63; // "?"
}

/** Texto como string literal de PDF, só com ASCII (bytes acima de 126 viram escape octal). */
function literal(texto: string): string {
  let s = '(';
  for (const ch of texto) {
    const c = codigoWinAnsi(ch);
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

/** Desfaz acentos para medir a largura com a tabela ASCII. */
function base(ch: string): string {
  return ch.normalize('NFD')[0] ?? ch;
}

export function larguraTexto(texto: string, tamanho: number, negrito = false): number {
  const tabela = negrito ? LARGURAS_HELVETICA_NEGRITO : LARGURAS_HELVETICA;
  let total = 0;
  for (const ch of texto) {
    const c = base(ch).charCodeAt(0);
    total += c >= 32 && c <= 126 ? tabela[c - 32] : 556;
  }
  return (total * tamanho) / 1000;
}

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

export interface OpcoesTexto {
  tamanho?: number;
  negrito?: boolean;
  cor?: Cor;
  alinhar?: 'esquerda' | 'direita' | 'centro';
}

export class PaginaPdf {
  readonly ops: string[] = [];

  constructor(
    readonly largura: number,
    readonly altura: number,
  ) {}

  texto(x: number, y: number, texto: string, o: OpcoesTexto = {}): this {
    const tamanho = o.tamanho ?? 10;
    const negrito = o.negrito ?? false;
    const cor = o.cor ?? PRETO;
    let px = x;
    if (o.alinhar === 'direita') px = x - larguraTexto(texto, tamanho, negrito);
    if (o.alinhar === 'centro') px = x - larguraTexto(texto, tamanho, negrito) / 2;
    this.ops.push(
      `BT ${n(cor[0])} ${n(cor[1])} ${n(cor[2])} rg /${negrito ? 'F2' : 'F1'} ${n(tamanho)} Tf ${n(px)} ${n(this.altura - y)} Td ${literal(texto)} Tj ET`,
    );
    return this;
  }

  /** Quebra o texto em linhas que cabem na largura e devolve o y depois da última linha. */
  paragrafo(x: number, y: number, texto: string, largura: number, o: OpcoesTexto & { entrelinha?: number } = {}): number {
    const tamanho = o.tamanho ?? 10;
    const entrelinha = o.entrelinha ?? tamanho * 1.35;
    const palavras = texto.split(/\s+/).filter(Boolean);
    let linha = '';
    let yy = y;
    for (const p of palavras) {
      const tentativa = linha ? `${linha} ${p}` : p;
      if (linha && larguraTexto(tentativa, tamanho, o.negrito) > largura) {
        this.texto(x, yy, linha, o);
        yy += entrelinha;
        linha = p;
      } else {
        linha = tentativa;
      }
    }
    if (linha) {
      this.texto(x, yy, linha, o);
      yy += entrelinha;
    }
    return yy;
  }

  linha(x1: number, y1: number, x2: number, y2: number, espessura = 0.5, cor: Cor = PRETO): this {
    this.ops.push(
      `${n(cor[0])} ${n(cor[1])} ${n(cor[2])} RG ${n(espessura)} w ${n(x1)} ${n(this.altura - y1)} m ${n(x2)} ${n(this.altura - y2)} l S`,
    );
    return this;
  }

  /** Retângulo com canto superior esquerdo em (x, y). */
  retangulo(x: number, y: number, l: number, a: number, o: { preencher?: Cor; contorno?: Cor; espessura?: number } = {}): this {
    const ry = this.altura - y - a;
    const partes: string[] = [];
    if (o.preencher) partes.push(`${n(o.preencher[0])} ${n(o.preencher[1])} ${n(o.preencher[2])} rg`);
    if (o.contorno) partes.push(`${n(o.contorno[0])} ${n(o.contorno[1])} ${n(o.contorno[2])} RG ${n(o.espessura ?? 0.5)} w`);
    const op = o.preencher && o.contorno ? 'B' : o.preencher ? 'f' : 'S';
    partes.push(`${n(x)} ${n(ry)} ${n(l)} ${n(a)} re ${op}`);
    this.ops.push(partes.join(' '));
    return this;
  }
}

export interface InfoPdf {
  titulo: string;
  autor?: string;
  assunto?: string;
  criadoEm?: Date;
}

/** Documento A4 retrato. */
export class DocumentoPdf {
  readonly paginas: PaginaPdf[] = [];

  constructor(
    readonly largura = 595.28,
    readonly altura = 841.89,
  ) {}

  novaPagina(): PaginaPdf {
    const p = new PaginaPdf(this.largura, this.altura);
    this.paginas.push(p);
    return p;
  }

  gerar(info: InfoPdf): Buffer {
    if (this.paginas.length === 0) this.novaPagina();
    const objetos: string[] = [];
    // 1 catálogo, 2 páginas, 3 fonte normal, 4 fonte negrito, 5 info; depois, página + conteúdo para cada página.
    const idsPaginas = this.paginas.map((_, i) => 6 + i * 2);
    objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objetos[2] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.paginas.length} >>`;
    objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    const d = info.criadoEm ?? new Date();
    const dataPdf = `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
    objetos[5] =
      `<< /Title ${literal(info.titulo)} /Author ${literal(info.autor ?? 'Horizonte')} ` +
      `/Subject ${literal(info.assunto ?? info.titulo)} /Producer (Horizonte) /CreationDate (${dataPdf}) >>`;
    this.paginas.forEach((p, i) => {
      const idPagina = idsPaginas[i];
      const conteudo = p.ops.join('\n');
      objetos[idPagina] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.largura)} ${n(this.altura)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idPagina + 1} 0 R >>`;
      objetos[idPagina + 1] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
    });

    let saida = '%PDF-1.4\n%âãÏÓ\n';
    const deslocamentos: number[] = [];
    for (let id = 1; id < objetos.length; id++) {
      deslocamentos[id] = saida.length;
      saida += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
    }
    const inicioXref = saida.length;
    saida += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objetos.length; id++) {
      saida += `${String(deslocamentos[id]).padStart(10, '0')} 00000 n \n`;
    }
    saida += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    // Tudo é ASCII, menos o comentário binário da segunda linha: latin1 mantém 1 caractere = 1 byte.
    return Buffer.from(saida, 'latin1');
  }
}

// Demonstrativo da fatura em PDF (o "PDF" da coluna Arquivo em Plano e créditos). Gerado na hora,
// com as fontes padrão do PDF (Helvetica, codificação WinAnsi): o texto passa por `paraWinAnsi`.
// Não é a nota fiscal: quando a nota existe, o link dela vai junto.
import { formatarCnpj, nomeCompetencia, precoEmReais, ROTULO_STATUS_FATURA, fmt, type DadosCobranca, type Fatura } from '@copiloto/shared';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/** Caracteres do CP1252 acima de 0x7F que não estão no Latin-1 (aspas curvas, travessão, reticências...). */
const EXTRAS_CP1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Troca o que a fonte padrão do PDF não desenha (espaços finos, emojis) por equivalentes simples. */
export function paraWinAnsi(texto: string): string {
  return [...texto.replace(/[   ]/g, ' ').replace(/−/g, '-')]
    .map((c) => {
      const n = c.codePointAt(0)!;
      if (c === '\n') return ' ';
      if (n < 0x20) return '';
      if (n <= 0x7e || (n >= 0xa0 && n <= 0xff) || EXTRAS_CP1252.has(c)) return c;
      return '?';
    })
    .join('');
}

// As cores dos tokens da marca (shared/styles/tokens.css): --ink-900, --ink-500, --line, --brand-700, --warning-700 e --surface.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const TINTA = hex('#181C20');
const SUAVE = hex('#565757');
const LINHA = hex('#E6E7E7');
const MARCA = hex('#CD1F57');
const AVISO = hex('#8A5300');
const FUNDO = hex('#F8F8F8');

export interface DadosDemonstrativo {
  fatura: Fatura;
  empresa: { nome: string; cnpj: string | null };
  cobranca: DadosCobranca;
}

export async function demonstrativoPdf(d: DadosDemonstrativo): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = d.fatura;
  const titulo = f.tipo === 'mensal' && f.competencia ? `Fatura de ${nomeCompetencia(f.competencia)}` : `Pacote de ${fmt.numero(f.creditos ?? 0)} créditos`;
  doc.setTitle(paraWinAnsi(`${titulo} · ${d.empresa.nome}`));
  doc.setAuthor('Starta');
  doc.setCreator('Copiloto Starta');
  const pagina = doc.addPage([595.28, 841.89]);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const margem = 48;
  const largura = pagina.getWidth() - margem * 2;
  let y = pagina.getHeight() - margem;

  const escrever = (texto: string, x: number, o: { fonte?: PDFFont; tamanho?: number; cor?: ReturnType<typeof rgb>; direita?: boolean } = {}) => {
    const fonte = o.fonte ?? normal;
    const tamanho = o.tamanho ?? 10;
    const t = paraWinAnsi(texto);
    const px = o.direita ? x - fonte.widthOfTextAtSize(t, tamanho) : x;
    pagina.drawText(t, { x: px, y, size: tamanho, font: fonte, color: o.cor ?? TINTA });
  };
  const quebrar = (texto: string, fonte: PDFFont, tamanho: number, max: number): string[] => {
    const linhas: string[] = [];
    let atual = '';
    for (const palavra of paraWinAnsi(texto).split(' ')) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) > max && atual) {
        linhas.push(atual);
        atual = palavra;
      } else atual = tentativa;
    }
    if (atual) linhas.push(atual);
    return linhas;
  };
  const traco = (p: PDFPage, yy: number) => p.drawLine({ start: { x: margem, y: yy }, end: { x: margem + largura, y: yy }, thickness: 0.8, color: LINHA });

  // Cabeçalho: quem emite e o que é.
  escrever('Starta', margem, { fonte: negrito, tamanho: 18, cor: MARCA });
  escrever('Demonstrativo de fatura', margem + largura, { fonte: negrito, tamanho: 14, direita: true });
  y -= 16;
  escrever('Copiloto Starta', margem, { tamanho: 10, cor: SUAVE });
  escrever(f.id, margem + largura, { tamanho: 9, cor: SUAVE, direita: true });
  y -= 14;
  if (f.exemplo) {
    escrever('Dados de exemplo (empresa de demonstração): não é uma cobrança.', margem, { fonte: negrito, tamanho: 9, cor: AVISO });
    y -= 12;
  }
  y -= 10;
  traco(pagina, y);
  y -= 24;

  // Cliente e datas, em duas colunas.
  const col2 = margem + largura / 2 + 12;
  const topo = y;
  escrever('CLIENTE', margem, { fonte: negrito, tamanho: 8, cor: SUAVE });
  y -= 14;
  escrever(d.cobranca.razaoSocial ?? d.empresa.nome, margem, { fonte: negrito, tamanho: 11 });
  y -= 14;
  const cnpj = d.cobranca.cnpj ?? (d.empresa.cnpj ? formatarCnpj(d.empresa.cnpj) : null);
  escrever(cnpj ? `CNPJ ${cnpj}` : 'CNPJ não informado', margem, { tamanho: 10 });
  y -= 13;
  if (d.cobranca.emailCobranca) {
    escrever(d.cobranca.emailCobranca, margem, { tamanho: 10, cor: SUAVE });
    y -= 13;
  }
  const fimCliente = y;
  y = topo;
  const dados: [string, string][] = [
    [f.tipo === 'mensal' ? 'Competência' : 'Tipo', f.tipo === 'mensal' && f.competencia ? nomeCompetencia(f.competencia) : 'Pacote de créditos'],
    ['Emitida em', fmt.data(f.criadoEm)],
    ['Vencimento', f.vencimento ? fmt.data(`${f.vencimento}T12:00:00Z`) : 'A combinar'],
    ['Situação', f.status === 'paga' && f.pagoEm ? `Paga em ${fmt.data(f.pagoEm)}` : ROTULO_STATUS_FATURA[f.status]],
  ];
  for (const [k, v] of dados) {
    escrever(k, col2, { tamanho: 9, cor: SUAVE });
    escrever(v, margem + largura, { fonte: negrito, tamanho: 10, direita: true });
    y -= 15;
  }
  y = Math.min(y, fimCliente) - 18;

  // Itens.
  const xQtd = margem + largura * 0.58;
  const xUnit = margem + largura * 0.78;
  const xTotal = margem + largura;
  pagina.drawRectangle({ x: margem, y: y - 6, width: largura, height: 20, color: FUNDO });
  escrever('DESCRIÇÃO', margem + 8, { fonte: negrito, tamanho: 8, cor: SUAVE });
  escrever('QUANTIDADE', xQtd, { fonte: negrito, tamanho: 8, cor: SUAVE, direita: true });
  escrever('UNITÁRIO', xUnit, { fonte: negrito, tamanho: 8, cor: SUAVE, direita: true });
  escrever('TOTAL', xTotal - 8, { fonte: negrito, tamanho: 8, cor: SUAVE, direita: true });
  y -= 26;
  for (const i of f.itens) {
    const linhas = quebrar(i.descricao, normal, 10, xQtd - margem - 80);
    escrever(linhas[0] ?? '', margem + 8, { tamanho: 10 });
    escrever(fmt.numero(i.quantidade), xQtd, { tamanho: 10, direita: true });
    escrever(precoEmReais(i.unitarioCentavos) ?? 'Sob consulta', xUnit, { tamanho: 10, direita: true });
    escrever(precoEmReais(i.totalCentavos) ?? 'Sob consulta', xTotal - 8, { tamanho: 10, direita: true });
    for (const resto of linhas.slice(1)) {
      y -= 13;
      escrever(resto, margem + 8, { tamanho: 10 });
    }
    y -= 10;
    traco(pagina, y);
    y -= 16;
  }
  escrever('Total', xUnit, { fonte: negrito, tamanho: 12, direita: true });
  escrever(precoEmReais(f.totalCentavos) ?? 'Sob consulta', xTotal - 8, { fonte: negrito, tamanho: 12, direita: true });
  y -= 30;

  // Onde pagar e a nota fiscal, quando houver.
  const links: [string, string | null][] = [
    ['Pagamento', f.urlPagamento],
    ['Boleto', f.urlBoleto],
    ['Nota fiscal (NFS-e)', f.urlNotaFiscal],
  ];
  for (const [rotulo, url] of links) {
    if (!url) continue;
    escrever(`${rotulo}:`, margem, { fonte: negrito, tamanho: 9 });
    escrever(url, margem + 100, { tamanho: 9, cor: MARCA });
    y -= 14;
  }
  if (f.tipo === 'pacote' && f.creditos) {
    y -= 4;
    for (const l of quebrar(`Os ${fmt.numero(f.creditos)} créditos do pacote valem no ciclo em que o pagamento é confirmado.`, normal, 9, largura)) {
      escrever(l, margem, { tamanho: 9, cor: SUAVE });
      y -= 12;
    }
  }

  // Rodapé.
  y = margem + 24;
  traco(pagina, y + 14);
  for (const l of quebrar(
    'Emitido por Starta (Copiloto Starta). Este demonstrativo resume a fatura e não substitui a nota fiscal de serviço.',
    normal,
    8,
    largura,
  )) {
    escrever(l, margem, { tamanho: 8, cor: SUAVE });
    y -= 11;
  }
  return doc.save();
}

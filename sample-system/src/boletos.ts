// Boleto de cobrança: código de barras (padrão FEBRABAN, 44 dígitos), linha digitável (47 dígitos)
// e o PDF da segunda via. O banco 999 não existe: os boletos são só de demonstração.
import type { Boleto } from './dados/tipos.ts';
import { diferencaDias, fmtData, fmtDataHora, fmtMoeda } from './util/datas.ts';
import { CINZA, DocumentoPdf, PRETO, larguraTexto, type PaginaPdf } from './util/pdf.ts';

export const BANCO = '999';
export const NOME_BANCO = 'Banco de Demonstração';
const AGENCIA = '0001';
const CARTEIRA = '109';
const CONTA = '0048213';

export const BENEFICIARIO = {
  nome: 'Horizonte Serviços Técnicos Ltda',
  cnpj: '23.456.789/0001-95',
  endereco: 'Av. Ipiranga, 1200, sala 804 · Porto Alegre/RS · CEP 90160-091',
};

function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function modulo11Barras(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Fator de vencimento FEBRABAN (dias desde 07/10/1997; recomeça em 1000 a partir de 22/02/2025). */
export function fatorVencimento(vencimento: string): string {
  const dias = diferencaDias('1997-10-07', vencimento);
  const fator = dias <= 9999 ? dias : ((dias - 10000) % 9000) + 1000;
  return String(fator).padStart(4, '0');
}

export interface DadosCobranca {
  nossoNumero: string;
  vencimento: string;
  valor: number;
}

/** Código de barras com 44 dígitos. */
export function codigoBarras(d: DadosCobranca): string {
  const campoLivre = `${AGENCIA}${CARTEIRA}${d.nossoNumero.padStart(11, '0').slice(-11)}${CONTA}`;
  const valor = String(Math.round(d.valor * 100)).padStart(10, '0');
  const semDv = `${BANCO}9${fatorVencimento(d.vencimento)}${valor}${campoLivre}`;
  const dv = modulo11Barras(semDv);
  return `${semDv.slice(0, 4)}${dv}${semDv.slice(4)}`;
}

/** Linha digitável formatada: "99990.00110 90000.701018 ..." */
export function linhaDigitavel(d: DadosCobranca): string {
  const cb = codigoBarras(d);
  const campoLivre = cb.slice(19);
  const c1 = `${cb.slice(0, 4)}${campoLivre.slice(0, 5)}`;
  const c2 = campoLivre.slice(5, 15);
  const c3 = campoLivre.slice(15, 25);
  const campo1 = `${c1}${modulo10(c1)}`;
  const campo2 = `${c2}${modulo10(c2)}`;
  const campo3 = `${c3}${modulo10(c3)}`;
  return [
    `${campo1.slice(0, 5)}.${campo1.slice(5)}`,
    `${campo2.slice(0, 5)}.${campo2.slice(5)}`,
    `${campo3.slice(0, 5)}.${campo3.slice(5)}`,
    cb[4],
    cb.slice(5, 19),
  ].join(' ');
}

export type Situacao = 'Pago' | 'Em aberto' | 'Vencido';

export function situacaoBoleto(b: Boleto, hoje: string): Situacao {
  if (b.pago_em) return 'Pago';
  return b.vencimento >= hoje ? 'Em aberto' : 'Vencido';
}

export interface ViaCalculada {
  situacao: Situacao;
  vencimento: string;
  valor: number;
  valor_original: number;
  multa: number;
  juros: number;
  linha_digitavel: string;
  codigo_barras: string;
}

// Intercalado 2 de 5: n = estreito, w = largo.
const PADROES_I25 = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

function desenharCodigoBarras(p: PaginaPdf, x: number, y: number, codigo: string, altura = 40): void {
  const estreito = 0.72;
  const largo = estreito * 3;
  let cx = x;
  const barra = (largura: number) => {
    p.retangulo(cx, y, largura, altura, { preencher: PRETO });
    cx += largura;
  };
  const espaco = (largura: number) => {
    cx += largura;
  };
  // início: barra, espaço, barra, espaço (estreitos)
  barra(estreito);
  espaco(estreito);
  barra(estreito);
  espaco(estreito);
  for (let i = 0; i < codigo.length; i += 2) {
    const barras = PADROES_I25[Number(codigo[i])];
    const espacos = PADROES_I25[Number(codigo[i + 1])];
    for (let j = 0; j < 5; j++) {
      barra(barras[j] === 'w' ? largo : estreito);
      espaco(espacos[j] === 'w' ? largo : estreito);
    }
  }
  // fim: barra larga, espaço, barra
  barra(largo);
  espaco(estreito);
  barra(estreito);
}

export interface DadosPdfBoleto {
  boleto: Boleto;
  via: ViaCalculada;
  geradoEm: Date;
  geradoPor: string;
}

const M = 40;

function campo(p: PaginaPdf, x: number, y: number, l: number, rotulo: string, valor: string, o: { negrito?: boolean; direita?: boolean } = {}): void {
  p.retangulo(x, y, l, 30, { contorno: [0.55, 0.58, 0.62], espessura: 0.5 });
  p.texto(x + 4, y + 9, rotulo, { tamanho: 6.5, cor: CINZA });
  p.texto(o.direita ? x + l - 5 : x + 4, y + 23, valor, { tamanho: 9.5, negrito: o.negrito, alinhar: o.direita ? 'direita' : 'esquerda' });
}

export function pdfSegundaVia(d: DadosPdfBoleto): Buffer {
  const { boleto: b, via } = d;
  const doc = new DocumentoPdf();
  const p = doc.novaPagina();
  const L = doc.largura - 2 * M;

  // Cabeçalho
  p.texto(M, 46, 'Horizonte', { tamanho: 17, negrito: true, cor: [0.11, 0.19, 0.27] });
  p.texto(M, 61, `${BENEFICIARIO.nome} · CNPJ ${BENEFICIARIO.cnpj}`, { tamanho: 8.5, cor: CINZA });
  p.texto(M, 73, BENEFICIARIO.endereco, { tamanho: 8.5, cor: CINZA });
  p.texto(doc.largura - M, 46, 'Segunda via de boleto', { tamanho: 12, negrito: true, alinhar: 'direita' });
  p.texto(doc.largura - M, 61, `Boleto nº ${b.numero}`, { tamanho: 9, alinhar: 'direita' });
  p.texto(doc.largura - M, 73, `Competência ${b.competencia}`, { tamanho: 9, alinhar: 'direita' });

  // Recibo do pagador
  let y = 96;
  p.texto(M, y, 'Recibo do pagador', { tamanho: 10, negrito: true });
  y += 8;
  campo(p, M, y, L * 0.62, 'Pagador', b.pagador_nome, { negrito: true });
  campo(p, M + L * 0.62, y, L * 0.38, b.pagador_doc.length > 14 ? 'CNPJ' : 'CPF', b.pagador_doc);
  y += 30;
  campo(p, M, y, L * 0.62, 'Descrição', b.descricao);
  campo(p, M + L * 0.62, y, L * 0.38, 'Nosso número', `${CARTEIRA}/${b.nosso_numero}`);
  y += 30;
  campo(p, M, y, L * 0.25, 'Vencimento', fmtData(via.vencimento), { negrito: true });
  campo(p, M + L * 0.25, y, L * 0.25, 'Valor do documento', fmtMoeda(via.valor_original), { direita: true });
  campo(p, M + L * 0.5, y, L * 0.25, 'Multa e juros', fmtMoeda(via.multa + via.juros), { direita: true });
  campo(p, M + L * 0.75, y, L * 0.25, 'Valor cobrado', fmtMoeda(via.valor), { negrito: true, direita: true });
  y += 30;
  campo(p, M, y, L, 'Linha digitável', via.linha_digitavel, { negrito: true });
  y += 44;

  let aviso = '';
  if (via.situacao === 'Vencido') {
    aviso = `Boleto original vencido em ${fmtData(b.vencimento)}. Esta segunda via tem novo vencimento e inclui multa de 2% e juros de 1% ao mês, proporcionais aos dias de atraso.`;
  } else if (via.situacao === 'Pago') {
    aviso = `Este boleto já foi pago em ${fmtData(b.pago_em!)}. Esta via serve só para conferência: não pague de novo.`;
  } else {
    aviso = 'Boleto em aberto. A segunda via mantém o vencimento e o valor originais.';
  }
  y = p.paragrafo(M, y, aviso, L, { tamanho: 9 });
  y += 10;

  // Linha de corte
  for (let x = M; x < doc.largura - M; x += 8) p.linha(x, y, x + 4, y, 0.5, CINZA);
  p.texto(doc.largura - M, y - 4, 'Corte na linha pontilhada', { tamanho: 6.5, cor: CINZA, alinhar: 'direita' });
  y += 26;

  // Ficha de compensação
  p.texto(M, y, NOME_BANCO, { tamanho: 11, negrito: true });
  const xBanco = M + larguraTexto(NOME_BANCO, 11, true) + 8;
  p.linha(xBanco, y - 14, xBanco, y + 4, 1);
  p.texto(xBanco + 8, y, `${BANCO}-9`, { tamanho: 13, negrito: true });
  const xFim = xBanco + 16 + larguraTexto(`${BANCO}-9`, 13, true);
  p.linha(xFim, y - 14, xFim, y + 4, 1);
  p.texto(doc.largura - M, y, via.linha_digitavel, { tamanho: 11, negrito: true, alinhar: 'direita' });
  y += 8;
  const col = L * 0.72;
  campo(p, M, y, col, 'Local de pagamento', 'Pagável em qualquer banco até o vencimento');
  campo(p, M + col, y, L - col, 'Vencimento', fmtData(via.vencimento), { negrito: true, direita: true });
  y += 30;
  campo(p, M, y, col, 'Beneficiário', `${BENEFICIARIO.nome} · CNPJ ${BENEFICIARIO.cnpj}`);
  campo(p, M + col, y, L - col, 'Agência / Código do beneficiário', `${AGENCIA} / ${CONTA}`, { direita: true });
  y += 30;
  campo(p, M, y, col * 0.3, 'Data do documento', fmtData(b.emissao));
  campo(p, M + col * 0.3, y, col * 0.4, 'Número do documento', b.numero);
  campo(p, M + col * 0.7, y, col * 0.3, 'Espécie', 'DM');
  campo(p, M + col, y, L - col, 'Nosso número', `${CARTEIRA}/${b.nosso_numero}`, { direita: true });
  y += 30;
  p.retangulo(M, y, col, 60, { contorno: [0.55, 0.58, 0.62] });
  p.texto(M + 4, y + 9, 'Instruções (texto de responsabilidade do beneficiário)', { tamanho: 6.5, cor: CINZA });
  p.texto(M + 4, y + 23, 'Após o vencimento, cobrar multa de 2% e juros de 1% ao mês.', { tamanho: 8.5 });
  p.texto(M + 4, y + 35, `Referente a: ${b.descricao}.`, { tamanho: 8.5 });
  p.texto(M + 4, y + 47, 'Documento de demonstração, sem valor de cobrança.', { tamanho: 8.5, negrito: true });
  campo(p, M + col, y, L - col, '(=) Valor do documento', fmtMoeda(via.valor_original), { direita: true });
  campo(p, M + col, y + 30, L - col, '(=) Valor cobrado', fmtMoeda(via.valor), { negrito: true, direita: true });
  y += 60;
  p.retangulo(M, y, L, 40, { contorno: [0.55, 0.58, 0.62] });
  p.texto(M + 4, y + 9, 'Pagador', { tamanho: 6.5, cor: CINZA });
  p.texto(M + 4, y + 23, `${b.pagador_nome} · ${b.pagador_doc.length > 14 ? 'CNPJ' : 'CPF'} ${b.pagador_doc}`, { tamanho: 9.5, negrito: true });
  y += 54;
  desenharCodigoBarras(p, M, y, via.codigo_barras, 42);
  p.texto(doc.largura - M, y + 12, 'Autenticação mecânica', { tamanho: 6.5, cor: CINZA, alinhar: 'direita' });
  p.texto(doc.largura - M, y + 24, 'Ficha de compensação', { tamanho: 8, negrito: true, alinhar: 'direita' });
  y += 64;

  p.texto(
    M,
    doc.altura - 40,
    `Segunda via gerada em ${fmtDataHora(d.geradoEm.toISOString())} por ${d.geradoPor}. Ambiente de demonstração do Horizonte: este boleto não tem valor de cobrança.`,
    { tamanho: 7.5, cor: CINZA },
  );
  return doc.gerar({ titulo: `Boleto ${b.numero} · ${b.pagador_nome} · ${b.competencia}`, assunto: 'Segunda via de boleto' });
}

// Relatório de vendas: agrega as vendas do período e gera o arquivo (PDF ou planilha CSV).
import { vendasEntre } from './dados/vendas.ts';
import type { AgruparPor, Relatorio } from './dados/tipos.ts';
import { centavos, fmtData, fmtDataHora, fmtMoeda, fmtPercentual } from './util/datas.ts';
import { CINZA, CINZA_CLARO, DocumentoPdf, type PaginaPdf } from './util/pdf.ts';

export const ROTULO_AGRUPAMENTO: Record<AgruparPor, string> = {
  vendedor: 'Vendedor',
  regiao: 'Região',
  produto: 'Produto',
};

export const ROTULO_AGRUPAMENTO_PLURAL: Record<AgruparPor, string> = {
  vendedor: 'vendedor',
  regiao: 'região',
  produto: 'produto',
};

export interface LinhaRelatorio {
  grupo: string;
  quantidade: number;
  total: number;
  ticket_medio: number;
  participacao: number;
}

export interface ResultadoRelatorio {
  linhas: LinhaRelatorio[];
  quantidade: number;
  total: number;
}

export function calcularRelatorio(inicio: string, fim: string, agrupar: AgruparPor, hoje: string): ResultadoRelatorio {
  const vendas = vendasEntre(inicio, fim, hoje);
  const grupos = new Map<string, { quantidade: number; total: number }>();
  let total = 0;
  for (const v of vendas) {
    const chave = v[agrupar];
    const g = grupos.get(chave) ?? { quantidade: 0, total: 0 };
    g.quantidade += 1;
    g.total += v.valor;
    grupos.set(chave, g);
    total += v.valor;
  }
  const linhas = [...grupos.entries()]
    .map(([grupo, g]) => ({
      grupo,
      quantidade: g.quantidade,
      total: centavos(g.total),
      ticket_medio: centavos(g.total / g.quantidade),
      participacao: total ? Math.round((g.total / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total || a.grupo.localeCompare(b.grupo));
  return { linhas, quantidade: vendas.length, total: centavos(total) };
}

export function nomeArquivoRelatorio(r: Pick<Relatorio, 'agrupar_por' | 'periodo_inicio' | 'periodo_fim' | 'formato'>): string {
  const agrup = r.agrupar_por === 'regiao' ? 'regiao' : r.agrupar_por;
  return `relatorio-vendas-por-${agrup}-${r.periodo_inicio}-a-${r.periodo_fim}.${r.formato === 'pdf' ? 'pdf' : 'csv'}`;
}

export function tituloRelatorio(r: Pick<Relatorio, 'agrupar_por'>): string {
  return `Relatório de vendas por ${ROTULO_AGRUPAMENTO_PLURAL[r.agrupar_por]}`;
}

/** Planilha CSV com ";" e vírgula decimal (abre direto no Excel em português), UTF-8 com BOM. */
export function csvRelatorio(r: Relatorio, res: ResultadoRelatorio): Buffer {
  const numero = (v: number) => v.toFixed(2).replace('.', ',');
  const texto = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = [
    [ROTULO_AGRUPAMENTO[r.agrupar_por], 'Quantidade de vendas', 'Total vendido (R$)', 'Ticket médio (R$)', 'Participação (%)'].join(';'),
    ...res.linhas.map((l) =>
      [texto(l.grupo), String(l.quantidade), numero(l.total), numero(l.ticket_medio), l.participacao.toFixed(1).replace('.', ',')].join(';'),
    ),
    ['Total', String(res.quantidade), numero(res.total), numero(res.quantidade ? res.total / res.quantidade : 0), res.total ? '100,0' : '0,0'].join(';'),
  ];
  return Buffer.from('﻿' + linhas.join('\r\n') + '\r\n', 'utf8');
}

const MARGEM = 48;

function cabecalho(p: PaginaPdf, r: Relatorio, autor: string, pagina: number): number {
  p.retangulo(0, 0, p.largura, 6, { preencher: [0.11, 0.19, 0.27] });
  p.texto(MARGEM, 44, 'Horizonte', { tamanho: 16, negrito: true, cor: [0.11, 0.19, 0.27] });
  p.texto(MARGEM, 58, 'Horizonte Serviços Técnicos Ltda · Gestão de clientes e serviços', { tamanho: 8.5, cor: CINZA });
  p.texto(p.largura - MARGEM, 44, `Relatório nº ${r.numero}`, { tamanho: 9, cor: CINZA, alinhar: 'direita' });
  p.texto(p.largura - MARGEM, 58, `Página ${pagina}`, { tamanho: 8.5, cor: CINZA, alinhar: 'direita' });
  p.linha(MARGEM, 70, p.largura - MARGEM, 70, 0.6, CINZA_CLARO);
  if (pagina > 1) return 96;
  p.texto(MARGEM, 102, tituloRelatorio(r), { tamanho: 15, negrito: true });
  p.texto(MARGEM, 122, `Período: ${fmtData(r.periodo_inicio)} a ${fmtData(r.periodo_fim)}`, { tamanho: 10 });
  p.texto(MARGEM, 137, `Gerado em ${fmtDataHora(r.criado_em)} por ${autor}`, { tamanho: 9, cor: CINZA });
  return 168;
}

export function pdfRelatorio(r: Relatorio, res: ResultadoRelatorio, autor: string): Buffer {
  const doc = new DocumentoPdf();
  const colunas = [
    { titulo: ROTULO_AGRUPAMENTO[r.agrupar_por], x: MARGEM + 8, alinhar: 'esquerda' as const },
    { titulo: 'Vendas', x: 310, alinhar: 'direita' as const },
    { titulo: 'Total vendido', x: 410, alinhar: 'direita' as const },
    { titulo: 'Ticket médio', x: 487, alinhar: 'direita' as const },
    { titulo: 'Part.', x: doc.largura - MARGEM - 8, alinhar: 'direita' as const },
  ];
  let pagina = 1;
  let p = doc.novaPagina();
  let y = cabecalho(p, r, autor, pagina);

  // Resumo
  const caixa = (x: number, rotulo: string, valor: string) => {
    p.retangulo(x, y, 156, 46, { preencher: [0.95, 0.96, 0.97] });
    p.texto(x + 10, y + 17, rotulo, { tamanho: 8, cor: CINZA });
    p.texto(x + 10, y + 35, valor, { tamanho: 13, negrito: true });
  };
  caixa(MARGEM, 'Total vendido', fmtMoeda(res.total));
  caixa(MARGEM + 166, 'Quantidade de vendas', String(res.quantidade));
  caixa(MARGEM + 332, 'Ticket médio', fmtMoeda(res.quantidade ? res.total / res.quantidade : 0));
  y += 74;

  const cabecalhoTabela = () => {
    p.retangulo(MARGEM, y - 13, doc.largura - 2 * MARGEM, 20, { preencher: [0.11, 0.19, 0.27] });
    for (const c of colunas) p.texto(c.x, y, c.titulo, { tamanho: 9, negrito: true, cor: [1, 1, 1], alinhar: c.alinhar });
    y += 22;
  };
  cabecalhoTabela();

  if (res.linhas.length === 0) {
    p.texto(MARGEM + 8, y, 'Nenhuma venda registrada neste período.', { tamanho: 10, cor: CINZA });
    y += 20;
  }
  res.linhas.forEach((l, i) => {
    if (y > doc.altura - 90) {
      pagina += 1;
      p = doc.novaPagina();
      y = cabecalho(p, r, autor, pagina);
      cabecalhoTabela();
    }
    if (i % 2 === 1) p.retangulo(MARGEM, y - 13, doc.largura - 2 * MARGEM, 19, { preencher: [0.965, 0.97, 0.98] });
    const valores = [l.grupo, String(l.quantidade), fmtMoeda(l.total), fmtMoeda(l.ticket_medio), `${fmtPercentual(l.participacao)}%`];
    colunas.forEach((c, j) => p.texto(c.x, y, valores[j], { tamanho: 9.5, alinhar: c.alinhar }));
    y += 19;
  });
  p.linha(MARGEM, y - 10, doc.largura - MARGEM, y - 10, 0.8);
  const totais = ['Total', String(res.quantidade), fmtMoeda(res.total), fmtMoeda(res.quantidade ? res.total / res.quantidade : 0), res.total ? '100,0%' : '0,0%'];
  colunas.forEach((c, j) => p.texto(c.x, y + 4, totais[j], { tamanho: 9.5, negrito: true, alinhar: c.alinhar }));

  for (const pg of doc.paginas) {
    pg.texto(MARGEM, doc.altura - 36, 'Valores em reais (R$). Fonte: vendas registradas no Horizonte. Ambiente de demonstração.', {
      tamanho: 7.5,
      cor: CINZA,
    });
  }
  return doc.gerar({ titulo: `${tituloRelatorio(r)} · ${fmtData(r.periodo_inicio)} a ${fmtData(r.periodo_fim)}`, autor });
}


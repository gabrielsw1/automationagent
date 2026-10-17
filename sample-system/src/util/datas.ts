// Datas no fuso de São Paulo. Datas de calendário trafegam como "AAAA-MM-DD"; instantes, em ISO (UTC).

const FUSO = 'America/Sao_Paulo';

const formatoData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatoHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data de calendário em São Paulo ("2026-10-17"). */
export function dataSP(d: Date): string {
  const partes = Object.fromEntries(formatoData.formatToParts(d).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Hora em São Paulo ("14:05"). */
export function horaSP(d: Date): string {
  return formatoHora.format(d);
}

/** "2026-10-17" → "17/10/2026". */
export function fmtData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Instante ISO → "17/10/2026 às 14:05" (São Paulo). */
export function fmtDataHora(instante: string): string {
  const d = new Date(instante);
  return `${fmtData(dataSP(d))} às ${horaSP(d)}`;
}

function paraUtc(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function deUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function somarDias(iso: string, dias: number): string {
  const d = paraUtc(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return deUtc(d);
}

/** Diferença em dias (b - a). */
export function diferencaDias(a: string, b: string): number {
  return Math.round((paraUtc(b).getTime() - paraUtc(a).getTime()) / 86_400_000);
}

/** 0 = domingo, 6 = sábado. */
export function diaDaSemana(iso: string): number {
  return paraUtc(iso).getUTCDay();
}

export function fimDeSemana(iso: string): boolean {
  const d = diaDaSemana(iso);
  return d === 0 || d === 6;
}

/** Primeiro dia útil (segunda a sexta) a partir da data. */
export function proximoDiaUtil(iso: string): string {
  let d = iso;
  while (fimDeSemana(d)) d = somarDias(d, 1);
  return d;
}

export function dataValida(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return deUtc(d);
}

/** Aceita "2026-10-22", "22/10/2026" e "22/10/26". */
export function interpretarData(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (m) return dataValida(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    let ano = +m[3];
    if (ano < 100) ano += 2000;
    return dataValida(ano, +m[2], +m[1]);
  }
  return null;
}

/** "10/2026" a partir de "2026-10-17". */
export function competenciaDe(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Primeiro dia da competência "10/2026" → "2026-10-01". */
export function inicioCompetencia(competencia: string): string {
  const [m, a] = competencia.split('/');
  return `${a}-${m}-01`;
}

/** Últimas n competências, da mais recente para a mais antiga ("10/2026", "09/2026", ...). */
export function ultimasCompetencias(hoje: string, n = 12): string[] {
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7));
  const lista: string[] = [];
  for (let i = 0; i < n; i++) {
    lista.push(`${String(mes).padStart(2, '0')}/${ano}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return lista;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "10/2026" → "outubro de 2026". */
export function competenciaPorExtenso(competencia: string): string {
  const [m, a] = competencia.split('/');
  return `${MESES[Number(m) - 1]} de ${a}`;
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "R$ 1.234,56" (com espaço comum, não o espaço fixo do Intl). */
export function fmtMoeda(valor: number): string {
  return moeda.format(valor).replace(/ /g, ' ');
}

/** "1.234,56". */
export function fmtNumero(valor: number): string {
  return numero2.format(valor);
}

/** "12,5". */
export function fmtPercentual(valor: number): string {
  return numero1.format(valor);
}

/** Arredonda para centavos. */
export function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

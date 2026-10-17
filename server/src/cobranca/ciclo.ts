// O ciclo de créditos e de cobrança é o mês do calendário no fuso de São Paulo (o mesmo do limite de
// gasto em servicos/gastos.ts). A competência de uma fatura é o mês, como "2026-09".
import { inicioDoMes } from '../servicos/gastos.ts';

const FORMATO_MES = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "2026-10" do instante, no fuso de São Paulo. */
export function competenciaDe(d: Date): string {
  return FORMATO_MES.format(d);
}

/** "2026-10-17" do instante, no fuso de São Paulo. */
export function diaDe(d: Date): string {
  return FORMATO_DIA.format(d);
}

/** "2026-10-17" + n dias. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Competência vizinha: -1 é o mês anterior, +1 o seguinte. */
export function deslocarCompetencia(competencia: string, meses: number): string {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Primeiro instante do mês e o primeiro do seguinte. */
export function cicloDe(competencia: string): { inicio: Date; fim: Date } {
  const [a, m] = competencia.split('-').map(Number);
  // Meio do mês em UTC cai sempre dentro do mesmo mês em São Paulo.
  return { inicio: inicioDoMes(new Date(Date.UTC(a, m - 1, 15, 12))), fim: inicioDoMes(new Date(Date.UTC(a, m, 15, 12))) };
}

/** "2026-09" → "setembro de 2026". */
export { nomeCompetencia } from '@copiloto/shared';

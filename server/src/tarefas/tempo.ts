// Datas no fuso de São Paulo para as agregações do console (painel, contagens por dia).
import type { Periodo } from '@copiloto/shared';
import { inicioDoDia, inicioDoMes } from '../servicos/gastos.ts';

const DIA_MS = 86_400_000;
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-10-17" no fuso de São Paulo. */
export function diaSp(data: string | Date): string {
  return formatoDia.format(typeof data === 'string' ? new Date(data) : data);
}

export function diasAtras(agora: Date, n: number): Date {
  return new Date(inicioDoDia(agora).getTime() - n * DIA_MS);
}

export interface JanelaPeriodo {
  inicio: Date;
  fim: Date;
  /** Janela de mesmo tamanho logo antes, para a variação. */
  anteriorInicio: Date;
  anteriorFim: Date;
  /** Dias (AAAA-MM-DD, fuso de São Paulo) do período, em ordem. */
  dias: string[];
}

export function janela(periodo: Periodo, agora = new Date()): JanelaPeriodo {
  let inicio: Date;
  let anteriorInicio: Date;
  let anteriorFim: Date;
  if (periodo === 'mes') {
    inicio = inicioDoMes(agora);
    anteriorInicio = inicioDoMes(new Date(inicio.getTime() - DIA_MS));
    anteriorFim = new Date(anteriorInicio.getTime() + (agora.getTime() - inicio.getTime()));
    if (anteriorFim > inicio) anteriorFim = inicio;
  } else {
    const n = periodo === '7d' ? 7 : 30;
    inicio = diasAtras(agora, n - 1);
    anteriorInicio = new Date(inicio.getTime() - n * DIA_MS);
    anteriorFim = inicio;
  }
  const dias: string[] = [];
  for (let t = inicio.getTime(); t <= agora.getTime(); t += DIA_MS) {
    const d = diaSp(new Date(t + 3_600_000));
    if (dias[dias.length - 1] !== d) dias.push(d);
  }
  const hoje = diaSp(agora);
  if (dias[dias.length - 1] !== hoje) dias.push(hoje);
  return { inicio, fim: agora, anteriorInicio, anteriorFim, dias };
}

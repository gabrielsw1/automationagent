// Formatação no padrão brasileiro, usada pelo console, pelo widget e pelas mensagens do servidor.
import type { Campo } from './tarefas.ts';

const moedaFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numeroFmt = new Intl.NumberFormat('pt-BR');
const fuso = 'America/Sao_Paulo';

export function moeda(valor: number): string {
  return moedaFmt.format(valor).replace(/ /g, ' ');
}

export function numero(valor: number): string {
  return numeroFmt.format(valor);
}

export function percentual(fracao: number, casas = 1): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

function partes(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(f.map((x) => [x.type, x.value]));
  return p as Record<'day' | 'month' | 'year' | 'hour' | 'minute' | 'second', string>;
}

/** 17/10/2026 */
export function data(iso: string | Date): string {
  const p = partes(iso);
  return `${p.day}/${p.month}/${p.year}`;
}

/** 17/10 */
export function diaMes(iso: string | Date): string {
  const p = partes(iso);
  return `${p.day}/${p.month}`;
}

/** 14:07 */
export function hora(iso: string | Date): string {
  const p = partes(iso);
  return `${p.hour}:${p.minute}`;
}

/** 14:07:32 */
export function horaSegundos(iso: string | Date): string {
  const p = partes(iso);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 17/10/2026, 14:07 */
export function dataHora(iso: string | Date): string {
  return `${data(iso)}, ${hora(iso)}`;
}

/** "Hoje, 10:12", "Ontem, 16:40" ou "14/10/2026". */
export function quando(iso: string, agora = new Date()): string {
  const dia = data(iso);
  if (dia === data(agora)) return `Hoje, ${hora(iso)}`;
  const ontem = new Date(agora.getTime() - 86400000);
  if (dia === data(ontem)) return `Ontem, ${hora(iso)}`;
  return dia;
}

/** "4 s", "52 s", "1 min 12 s". */
export function duracao(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return resto ? `${min} min ${resto} s` : `${min} min`;
}

/** "há 3 min", "há 2 h", "há 5 dias". */
export function haQuanto(iso: string, agora = new Date()): string {
  const s = Math.max(0, Math.round((agora.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const dias = Math.floor(s / 86400);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

/** "Bom dia", "Boa tarde" ou "Boa noite" no horário de Brasília. */
export function saudacao(agora = new Date()): string {
  const h = Number(partes(agora).hour);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  const primeira = p[0][0] ?? '';
  const ultima = p.length > 1 ? p[p.length - 1][0] ?? '' : '';
  return (primeira + ultima).toUpperCase();
}

/** Iniciais de empresa, como no design: as duas primeiras palavras ("Clínica Mais Agenda" → CM, "RotaCerta Logística" → RC). */
export function iniciaisEmpresa(nome: string): string {
  const p = nome.trim().replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[1][0]).toUpperCase();
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Valor de um campo para exibição (data ISO vira 22/10/2026, moeda vira R$). */
export function valorCampo(campo: Pick<Campo, 'tipo'>, valor: string): string {
  if (!valor) return '';
  if (campo.tipo === 'data') {
    const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (campo.tipo === 'moeda') {
    const n = Number(valor);
    if (Number.isFinite(n)) return moeda(n);
  }
  return valor;
}

/** Troca {chave} pelos valores. Chaves sem valor ficam vazias. */
export function preencherModelo(modelo: string, valores: Record<string, string | number | undefined | null>): string {
  return modelo.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = valores[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

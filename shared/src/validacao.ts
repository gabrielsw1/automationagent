// Validação determinística dos campos de uma tarefa. Roda no servidor antes de montar
// o cartão de confirmação e no console para validar ao sair do campo.
import type { Campo } from './tarefas.ts';

export interface ResultadoValidacao {
  ok: boolean;
  /** Valor normalizado (ex.: CNPJ formatado, data ISO). */
  valor?: string;
  /** Mensagem que diz como corrigir. */
  erro?: string;
}

export function somenteDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

function digitoVerificador(numeros: number[], pesos: number[]): number {
  const soma = numeros.reduce((acc, n, i) => acc + n * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(cnpj: string): boolean {
  const d = somenteDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return digitoVerificador(n.slice(0, 12), p1) === n[12] && digitoVerificador(n.slice(0, 13), p2) === n[13];
}

export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv = (len: number) => {
    const soma = n.slice(0, len).reduce((acc, x, i) => acc + x * (len + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === n[9] && dv(10) === n[10];
}

export function formatarCnpj(cnpj: string): string {
  const d = somenteDigitos(cnpj);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function formatarCpf(cpf: string): string {
  const d = somenteDigitos(cpf);
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Converte "22/10/2026", "22/10" ou "2026-10-22" em ISO (AAAA-MM-DD). */
export function interpretarData(s: string, hoje = new Date()): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dataIsoValida(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    let ano = m[3] ? +m[3] : hoje.getFullYear();
    if (ano < 100) ano += 2000;
    return dataIsoValida(ano, +m[2], +m[1]);
  }
  return null;
}

function dataIsoValida(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Converte "14h", "14:00", "9h30" em HH:MM. */
export function interpretarHora(s: string): string | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  if (!m) return null;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Converte "R$ 1.500,00", "1500", "1.500,5" em número. */
export function interpretarMoeda(s: string): number | null {
  const limpo = s.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Acha a opção da lista que corresponde ao valor ("30", "30 dias", "trinta dias" não). */
export function casarOpcao(valor: string, opcoes: string[]): string | null {
  const v = normalizarTexto(valor);
  const exata = opcoes.find((o) => normalizarTexto(o) === v);
  if (exata) return exata;
  const digitos = somenteDigitos(valor);
  if (digitos) {
    const porNumero = opcoes.filter((o) => somenteDigitos(o) === digitos);
    if (porNumero.length === 1) return porNumero[0];
  }
  const contem = opcoes.filter((o) => normalizarTexto(o).includes(v) || v.includes(normalizarTexto(o)));
  return contem.length === 1 ? contem[0] : null;
}

export function validarCampo(campo: Campo, bruto: string | null | undefined): ResultadoValidacao {
  const valor = (bruto ?? '').toString().trim();
  if (!valor) {
    return campo.obrigatorio ? { ok: false, erro: `Informe ${campo.rotulo.toLowerCase()}.` } : { ok: true, valor: '' };
  }
  switch (campo.tipo) {
    case 'texto': {
      const min = campo.minimo ?? 1;
      const letras = valor.replace(/[^\p{L}\p{N}]/gu, '').length;
      if (letras < min) return { ok: false, erro: `${campo.rotulo} precisa ter pelo menos ${min} letras.` };
      if (campo.maximo && valor.length > campo.maximo)
        return { ok: false, erro: `${campo.rotulo} pode ter no máximo ${campo.maximo} caracteres.` };
      return { ok: true, valor };
    }
    case 'documento': {
      const d = somenteDigitos(valor);
      if (d.length === 14) {
        return cnpjValido(d)
          ? { ok: true, valor: formatarCnpj(d) }
          : { ok: false, erro: 'Esse CNPJ não é válido. Confira os números, por exemplo 12.345.678/0001-95.' };
      }
      if (d.length === 11) {
        return cpfValido(d)
          ? { ok: true, valor: formatarCpf(d) }
          : { ok: false, erro: 'Esse CPF não é válido. Confira os 11 números.' };
      }
      return { ok: false, erro: 'Digite um CPF (11 números) ou CNPJ (14 números).' };
    }
    case 'email':
      return EMAIL.test(valor)
        ? { ok: true, valor: valor.toLowerCase() }
        : { ok: false, erro: 'Digite um e-mail completo, por exemplo nome@empresa.com.br' };
    case 'telefone': {
      const d = somenteDigitos(valor);
      if (d.length < 10 || d.length > 13) return { ok: false, erro: 'Digite o telefone com DDD, por exemplo (51) 99999-0000.' };
      return { ok: true, valor: d };
    }
    case 'lista': {
      const opcoes = campo.opcoes ?? [];
      const achada = casarOpcao(valor, opcoes);
      return achada
        ? { ok: true, valor: achada }
        : { ok: false, erro: `Escolha uma destas opções: ${opcoes.join(', ')}.` };
    }
    case 'data': {
      const iso = interpretarData(valor);
      return iso ? { ok: true, valor: iso } : { ok: false, erro: 'Digite a data como dia/mês/ano, por exemplo 22/10/2026.' };
    }
    case 'hora': {
      const h = interpretarHora(valor);
      return h ? { ok: true, valor: h } : { ok: false, erro: 'Digite o horário como 14:00.' };
    }
    case 'numero':
    case 'moeda': {
      const n = campo.tipo === 'moeda' ? interpretarMoeda(valor) : Number(valor.replace(',', '.'));
      if (n === null || !Number.isFinite(n)) return { ok: false, erro: `${campo.rotulo} precisa ser um número.` };
      if (campo.minimo !== undefined && n < campo.minimo)
        return { ok: false, erro: `${campo.rotulo} precisa ser pelo menos ${campo.minimo}.` };
      if (campo.maximo !== undefined && n > campo.maximo)
        return { ok: false, erro: `${campo.rotulo} pode ser no máximo ${campo.maximo}.` };
      return { ok: true, valor: String(n) };
    }
    case 'pessoa':
      return { ok: true, valor };
    default:
      return { ok: true, valor };
  }
}

export interface ResultadoValidacaoTarefa {
  /** Valores normalizados dos campos válidos. */
  valores: Record<string, string>;
  /** Campos obrigatórios sem valor, na ordem da ficha (só os que o agente pergunta). */
  faltando: Campo[];
  /** Campos com valor inválido e como corrigir. */
  invalidos: { campo: Campo; erro: string }[];
  completo: boolean;
}

/**
 * Valida todos os campos de uma tarefa. Campos com `padrao = "solicitante"` recebem o nome de quem pediu
 * quando vazios.
 */
export function validarTarefa(
  campos: Campo[],
  entrada: Record<string, unknown>,
  solicitante?: { id: string; nome: string },
): ResultadoValidacaoTarefa {
  const valores: Record<string, string> = {};
  const faltando: Campo[] = [];
  const invalidos: { campo: Campo; erro: string }[] = [];
  for (const campo of campos) {
    let bruto = entrada[campo.chave];
    if ((bruto === undefined || bruto === null || bruto === '') && campo.padrao) {
      bruto = campo.padrao === 'solicitante' ? solicitante?.nome ?? '' : campo.padrao;
    }
    const texto = bruto === undefined || bruto === null ? '' : String(bruto);
    if (!texto.trim()) {
      if (campo.obrigatorio) faltando.push(campo);
      continue;
    }
    const r = validarCampo(campo, texto);
    if (r.ok) valores[campo.chave] = r.valor ?? texto;
    else invalidos.push({ campo, erro: r.erro ?? 'Valor inválido.' });
  }
  return { valores, faltando, invalidos, completo: faltando.length === 0 && invalidos.length === 0 };
}

/** Formato do valor sem o conteúdo: dígitos viram 9, letras viram a. Usado pelo gravador. */
export function formatoDoValor(valor: string): string {
  return valor.replace(/\d/g, '9').replace(/\p{L}/gu, 'a');
}

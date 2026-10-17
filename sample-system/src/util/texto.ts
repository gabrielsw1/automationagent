// Utilidades de texto: normalização para busca (sem acento e sem caixa) e documentos (CPF/CNPJ).

export function somenteDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

/** Minúsculas, sem acento, sem pontuação e com espaços simples. Usado em buscas e comparações. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

function digitoCnpj(numeros: number[]): number {
  const pesos = numeros.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = numeros.reduce((acc, n, i) => acc + n * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function digitoCpf(numeros: number[]): number {
  const len = numeros.length;
  const soma = numeros.reduce((acc, n, i) => acc + n * (len + 1 - i), 0);
  const r = (soma * 10) % 11;
  return r === 10 ? 0 : r;
}

export function cnpjValido(cnpj: string): boolean {
  const d = somenteDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  return digitoCnpj(n.slice(0, 12)) === n[12] && digitoCnpj(n.slice(0, 13)) === n[13];
}

export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  return digitoCpf(n.slice(0, 9)) === n[9] && digitoCpf(n.slice(0, 10)) === n[10];
}

/** Completa os 12 primeiros dígitos de um CNPJ com os dígitos verificadores. */
export function completarCnpj(base12: string): string {
  const n = somenteDigitos(base12).split('').map(Number);
  if (n.length !== 12) throw new Error(`Base de CNPJ precisa de 12 dígitos: ${base12}`);
  const d1 = digitoCnpj(n);
  const d2 = digitoCnpj([...n, d1]);
  return formatarCnpj(n.join('') + d1 + d2);
}

/** Completa os 9 primeiros dígitos de um CPF com os dígitos verificadores. */
export function completarCpf(base9: string): string {
  const n = somenteDigitos(base9).split('').map(Number);
  if (n.length !== 9) throw new Error(`Base de CPF precisa de 9 dígitos: ${base9}`);
  const d1 = digitoCpf(n);
  const d2 = digitoCpf([...n, d1]);
  return formatarCpf(n.join('') + d1 + d2);
}

export function formatarCnpj(cnpj: string): string {
  return somenteDigitos(cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function formatarCpf(cpf: string): string {
  return somenteDigitos(cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/** CPF ou CNPJ formatado, conforme a quantidade de dígitos. */
export function formatarDocumento(doc: string): string {
  const d = somenteDigitos(doc);
  return d.length === 14 ? formatarCnpj(d) : d.length === 11 ? formatarCpf(d) : doc;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValido(email: string): boolean {
  return EMAIL.test(email.trim());
}

/** Junta itens como "A, B e C". */
export function listaHumana(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** Junta itens como "A, B ou C". */
export function listaOu(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} ou ${itens[itens.length - 1]}`;
}

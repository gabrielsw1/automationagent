import { describe, expect, it } from 'vitest';
import { codigoBarras, fatorVencimento, linhaDigitavel } from '../src/boletos.ts';
import { estadoInicial } from '../src/dados/semente.ts';
import { cnpjValido, cpfValido, somenteDigitos } from '../src/util/texto.ts';
import { larguraTexto } from '../src/util/pdf.ts';
import { AGORA } from './apoio.ts';

function modulo10(n: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = n.length - 1; i >= 0; i--) {
    let p = Number(n[i]) * peso;
    if (p > 9) p -= 9;
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

describe('boleto', () => {
  it('calcula o fator de vencimento com a regra nova de 2025', () => {
    expect(fatorVencimento('2000-07-03')).toBe('1000');
    expect(fatorVencimento('2025-02-21')).toBe('9999');
    expect(fatorVencimento('2025-02-22')).toBe('1000');
  });

  it('monta código de barras e linha digitável consistentes', () => {
    const dados = { nossoNumero: '00000700272', vencimento: '2026-10-20', valor: 400.17 };
    const cb = codigoBarras(dados);
    expect(cb).toMatch(/^\d{44}$/);
    expect(cb.slice(0, 4)).toBe('9999');
    expect(cb.slice(9, 19)).toBe('0000040017');
    const linha = linhaDigitavel(dados);
    const d = somenteDigitos(linha);
    expect(d).toHaveLength(47);
    expect(modulo10(d.slice(0, 9))).toBe(Number(d[9]));
    expect(modulo10(d.slice(10, 20))).toBe(Number(d[20]));
    expect(modulo10(d.slice(21, 31))).toBe(Number(d[31]));
    expect(d[32]).toBe(cb[4]);
    expect(d.slice(33)).toBe(cb.slice(5, 19));
  });
});

describe('dados iniciais', () => {
  const estado = estadoInicial(AGORA);

  it('tem ao menos 15 clientes com CNPJ válido e únicos, e o próximo código é 4821', () => {
    expect(estado.clientes.length).toBeGreaterThanOrEqual(15);
    const cnpjs = estado.clientes.map((c) => c.cnpj);
    expect(new Set(cnpjs).size).toBe(cnpjs.length);
    for (const c of estado.clientes) expect(cnpjValido(c.cnpj), c.razao_social).toBe(true);
    expect(estado.sequencias.cliente).toBe(4821);
    expect(estado.clientes.every((c) => Number(c.id) < 4821)).toBe(true);
  });

  it('tem boletos de CPF e CNPJ, incluindo Transportes Vale e Clínica Bem Viver nos últimos meses', () => {
    for (const b of estado.boletos) {
      const d = somenteDigitos(b.pagador_doc);
      expect(d.length === 14 ? cnpjValido(d) : cpfValido(d), b.pagador_nome).toBe(true);
    }
    expect(estado.boletos.some((b) => somenteDigitos(b.pagador_doc).length === 11)).toBe(true);
    for (const nome of ['Transportes Vale Ltda', 'Clínica Bem Viver Ltda']) {
      const competencias = estado.boletos.filter((b) => b.pagador_nome === nome).map((b) => b.competencia);
      expect(competencias).toEqual(expect.arrayContaining(['10/2026', '09/2026', '08/2026', '07/2026']));
    }
    // Um boleto por pagador e competência (o fluxo gravado clica no único "Gerar 2ª via").
    const chaves = estado.boletos.map((b) => `${b.pagador_doc} ${b.competencia}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('é determinístico', () => {
    expect(estadoInicial(AGORA)).toEqual(estado);
  });

  it('mede texto para alinhar números no PDF', () => {
    expect(larguraTexto('0000', 10)).toBeCloseTo(22.24, 2);
    expect(larguraTexto('Ação', 10)).toBeGreaterThan(0);
  });
});

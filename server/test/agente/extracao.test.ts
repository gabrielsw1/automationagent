// Nome da empresa no modo simulado: as frases do README têm que chegar ao cartão sem perguntar o nome.
import { describe, expect, it } from 'vitest';
import { nomeMencionado } from '../../src/agente/extracao.ts';

describe('nomeMencionado', () => {
  it('acha o nome nas frases de exemplo do README', () => {
    expect(nomeMencionado('cadastra o cliente Pólen Café, CNPJ 11.222.333/0001-81, prazo 30 dias')).toBe('Pólen Café');
    expect(nomeMencionado('cadastra a ACME, CNPJ 12.345.678/0001-95, prazo 30 dias, cobrança financeiro@acme.com.br')).toBe('ACME');
    expect(nomeMencionado('muda o plano da ACME para Premium', ['Premium'])).toBe('ACME');
    expect(nomeMencionado('agenda visita técnica na Padaria Estrela segunda às 10h')).toBe('Padaria Estrela');
  });

  it('prefere "cliente X" ao nome logo depois do verbo', () => {
    expect(nomeMencionado('cadastra o cliente Metalúrgica Sul')).toBe('Metalúrgica Sul');
  });

  it('não inventa nome quando não há', () => {
    expect(nomeMencionado('quero cadastrar um cliente novo')).toBeNull();
  });
});

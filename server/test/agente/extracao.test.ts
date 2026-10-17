// Nome da empresa no modo simulado: as frases do README têm que chegar ao cartão sem perguntar o nome.
import { describe, expect, it } from 'vitest';
import { extrairCampos, nomeMencionado, respostaDireta } from '../../src/agente/extracao.ts';

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

describe('pedido de um fluxo gravado (Abrir chamado)', () => {
  const campos = [
    { chave: 'assunto', rotulo: 'Assunto', tipo: 'texto' as const, obrigatorio: true, pergunta: 'Qual é o assunto?' },
    { chave: 'prioridade', rotulo: 'Prioridade', tipo: 'lista' as const, obrigatorio: true, pergunta: 'Qual é a prioridade?', opcoes: ['Baixa', 'Média', 'Alta', 'Urgente'] },
    { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto' as const, obrigatorio: true, pergunta: 'Qual é o cliente?' },
    { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto' as const, obrigatorio: true, pergunta: 'Qual é a descrição?' },
  ];

  it('tira assunto, prioridade e cliente da frase do README', () => {
    expect(extrairCampos(campos, 'Abre um chamado para a Padaria Estrela sobre impressora sem tinta, prioridade alta')).toEqual({
      assunto: 'impressora sem tinta',
      prioridade: 'Alta',
      cliente: 'Padaria Estrela',
    });
  });

  it('resposta à pergunta: frase longa fica inteira; resposta curta perde o "é"', () => {
    expect(respostaDireta(campos[3], 'A impressora do caixa parou de imprimir os cupons.')).toBe('A impressora do caixa parou de imprimir os cupons');
    expect(respostaDireta(campos[0], 'é troca de toner')).toBe('troca de toner');
  });
});

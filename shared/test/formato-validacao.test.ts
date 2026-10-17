// Formatação e validação brasileiras usadas pelo console, pelo widget e pelo servidor.
import { describe, expect, it } from 'vitest';
import * as fmt from '../src/formato.ts';
import { casarOpcao, cnpjValido, cpfValido, formatarCnpj, formatoDoValor, interpretarData, interpretarHora, interpretarMoeda, validarCampo } from '../src/validacao.ts';

describe('formato', () => {
  it('moeda, número e percentual no padrão brasileiro', () => {
    expect(fmt.moeda(812.4)).toBe('R$ 812,40');
    expect(fmt.numero(1284)).toBe('1.284');
    expect(fmt.percentual(0.962)).toBe('96,2%');
  });

  it('datas e horas no fuso de São Paulo', () => {
    expect(fmt.data('2026-10-17T13:41:47Z')).toBe('17/10/2026');
    expect(fmt.hora('2026-10-17T13:41:47Z')).toBe('10:41');
    expect(fmt.quando('2026-10-17T13:41:47Z', new Date('2026-10-17T20:00:00Z'))).toBe('Hoje, 10:41');
    expect(fmt.quando('2026-10-16T13:41:47Z', new Date('2026-10-17T20:00:00Z'))).toBe('Ontem, 10:41');
  });

  it('duração nunca mostra 0 s', () => {
    expect(fmt.duracao(200)).toBe('1 s');
    expect(fmt.duracao(52_000)).toBe('52 s');
    expect(fmt.duracao(72_000)).toBe('1 min 12 s');
    expect(fmt.duracao(120_000)).toBe('2 min');
  });

  it('preenche modelos de recibo com os dados da execução', () => {
    expect(fmt.preencherModelo('Cliente {nome_empresa} criado (#{id})', { nome_empresa: 'Pólen Café', id: 4821 })).toBe(
      'Cliente Pólen Café criado (#4821)',
    );
  });

  it('iniciais e primeiro nome', () => {
    expect(fmt.iniciais('Ana Ribeiro')).toBe('AR');
    expect(fmt.iniciais('Júlia Martins Souza')).toBe('JS');
    // Empresas: as duas primeiras palavras, como no design.
    expect(fmt.iniciaisEmpresa('Clínica Mais Agenda')).toBe('CM');
    expect(fmt.iniciaisEmpresa('RotaCerta Logística')).toBe('RC');
    expect(fmt.iniciaisEmpresa('Pólen ERP')).toBe('PE');
    expect(fmt.iniciaisEmpresa('Horizonte')).toBe('HO');
    expect(fmt.primeiroNome('Camila Souza')).toBe('Camila');
  });
});

describe('validação', () => {
  it('CNPJ e CPF pelos dígitos verificadores', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('11.111.111/1111-11')).toBe(false);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('interpreta datas, horas e valores como as pessoas escrevem', () => {
    expect(interpretarData('22/10/2026')).toBe('2026-10-22');
    expect(interpretarData('31/02/2026')).toBeNull();
    expect(interpretarHora('14h')).toBe('14:00');
    expect(interpretarHora('9h30')).toBe('09:30');
    expect(interpretarHora('25h')).toBeNull();
    expect(interpretarMoeda('R$ 1.500,00')).toBe(1500);
  });

  it('casa a opção da lista pelo número ou pelo texto', () => {
    const prazos = ['15 dias', '30 dias', '45 dias'];
    expect(casarOpcao('30', prazos)).toBe('30 dias');
    expect(casarOpcao('30 DIAS', prazos)).toBe('30 dias');
    expect(casarOpcao('90', prazos)).toBeNull();
  });

  it('explica em português o que falta', () => {
    const campo = { chave: 'email', rotulo: 'E-mail de cobrança', tipo: 'email', obrigatorio: true, pergunta: 'Qual e-mail?' } as const;
    expect(validarCampo(campo as never, '')).toEqual({ ok: false, erro: 'Informe e-mail de cobrança.' });
    expect(validarCampo(campo as never, 'financeiro@acme.com.br').ok).toBe(true);
  });

  it('o gravador guarda só o formato do valor, nunca o conteúdo', () => {
    expect(formatoDoValor('11.222.333/0001-81')).toBe('99.999.999/9999-99');
    expect(formatoDoValor('Pólen Café')).toBe('aaaaa aaaa');
  });
});

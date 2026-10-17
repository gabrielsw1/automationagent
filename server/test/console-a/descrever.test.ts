import { describe, expect, it } from 'vitest';
import type { RotaApi } from '../../src/adaptadores/tipos.ts';
import { lerDefinicao, pendenciasParaPublicar, resumirAlteracoes } from '../../src/tarefas/definicao.ts';
import { escolherRota, fichaPorHeuristica, gerundioDe, nomeDe, opcoesDe, propostaParaDefinicao, rotuloDe } from '../../src/tarefas/descrever.ts';
import { FICHA_CLIENTE } from './dados.ts';

const ROTAS: RotaApi[] = [
  {
    metodo: 'POST',
    caminho: '/v1/clientes',
    descricao: 'Cria um cliente',
    idRetorno: 'id',
    campos: [
      { nome: 'razao_social', tipo: 'string', obrigatorio: true },
      { nome: 'cnpj', tipo: 'string', obrigatorio: true, descricao: 'CNPJ (14 dígitos)' },
      { nome: 'email_cobranca', tipo: 'string', obrigatorio: true },
      { nome: 'prazo_pagamento_dias', tipo: 'integer', obrigatorio: true, descricao: 'Prazo: 15, 30 ou 45' },
      { nome: 'responsavel_id', tipo: 'string', obrigatorio: false },
    ],
  },
  { metodo: 'GET', caminho: '/v1/clientes', descricao: 'Lista clientes' },
  { metodo: 'DELETE', caminho: '/v1/clientes/{id}', descricao: 'Remove um cliente' },
  { metodo: 'POST', caminho: '/v1/visitas', descricao: 'Agenda visita técnica', campos: [{ nome: 'data', tipo: 'date', obrigatorio: true }] },
];
const PERFIS = ['Comercial', 'Financeiro', 'Atendimento', 'Gestor financeiro', 'Administradores'];
const entrada = (descricao: string) => ({ descricao, rotas: ROTAS, perfis: PERFIS, nomeSistema: 'Horizonte', tarefasExistentes: [] });

describe('heurística da ficha (modo simulado)', () => {
  it('nomes, rótulos e gerúndio', () => {
    expect(nomeDe('Quero que o copiloto abra chamados de suporte com assunto e prioridade', null)).toBe('Abrir chamados de suporte');
    expect(nomeDe('Agendar uma visita técnica para um cliente numa data', null)).toBe('Agendar visita técnica');
    expect(rotuloDe('email_cobranca')).toBe('E-mail de cobrança');
    expect(rotuloDe('razao_social')).toBe('Razão social');
    expect(gerundioDe('Emitir segunda via')).toBe('Emitindo segunda via');
    expect(opcoesDe('Prioridade: Baixa, Média ou Alta')).toEqual(['Baixa', 'Média', 'Alta']);
  });

  it('escolhe a rota pelo recurso, não pelos campos', () => {
    expect(escolherRota('cadastrar cliente novo', ROTAS)?.caminho).toBe('/v1/clientes');
    expect(escolherRota('agendar visita técnica', ROTAS)?.caminho).toBe('/v1/visitas');
    expect(escolherRota('emitir segunda via de boleto pelo CNPJ', ROTAS)).toBeNull();
  });

  it('monta ficha completa a partir da rota: mapeamento, desfazer, verificação e perfis', () => {
    const def = propostaParaDefinicao(
      fichaPorHeuristica(entrada('Cadastrar clientes novos. Comercial e Financeiro podem; o Gestor financeiro aprova os outros.')),
      { perfis: PERFIS },
    );
    expect(def.campos.map((c) => c.chave)).toEqual(['razao_social', 'cnpj', 'email_cobranca', 'prazo_pagamento_dias', 'responsavel']);
    const prazo = def.campos.find((c) => c.chave === 'prazo_pagamento_dias')!;
    expect(prazo).toMatchObject({ rotulo: 'Prazo de pagamento', tipo: 'lista', opcoes: ['15 dias', '30 dias', '45 dias'] });
    expect(prazo.pergunta).toBe('Qual o prazo de pagamento: 15, 30 ou 45 dias?');
    expect(def.campos.find((c) => c.chave === 'responsavel')).toMatchObject({ tipo: 'pessoa', padrao: 'solicitante', perguntar: false });
    expect(def.api?.mapeamento.find((m) => m.campo === 'cnpj')?.transformacao).toBe('somente_digitos');
    expect(def.api?.desfazer).toEqual({ metodo: 'DELETE', caminho: '/v1/clientes/{id}' });
    expect(def.desfazerMinutos).toBe(5);
    expect(def.api?.verificarAntes?.caminho).toBe('/v1/clientes?documento={cnpj}');
    expect(def.perfilAprovador).toBe('Gestor financeiro');
    expect(def.perfisPermitidos).toEqual(expect.arrayContaining(['Comercial', 'Financeiro', 'Gestor financeiro']));
    expect(pendenciasParaPublicar(def)).toEqual([]);
  });

  it('sem rota na API, vai para o navegador com campos tirados do texto', () => {
    const def = propostaParaDefinicao(fichaPorHeuristica(entrada('Emitir segunda via de boleto pelo CPF ou CNPJ do pagador')), { perfis: PERFIS });
    expect(def.caminho).toBe('navegador');
    expect(def.nome).toBe('Emitir segunda via de boleto');
    expect(def.campos.map((c) => c.tipo)).toEqual(['documento', 'documento']);
    expect(pendenciasParaPublicar(def)).toContain('Escolha o fluxo gravado que o copiloto vai seguir na tela, ou grave um novo.');
  });
});

describe('definição da tarefa', () => {
  it('normaliza e resume alterações', () => {
    const r = lerDefinicao({ ...FICHA_CLIENTE, tituloConfirmacao: '', exemplos: ['a', 'a', 'b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definicao.tituloConfirmacao).toBe('Confirme os dados');
    expect(r.definicao.exemplos).toEqual(['a', 'b']);
    expect(resumirAlteracoes(FICHA_CLIENTE, { ...FICHA_CLIENTE, desfazerMinutos: 15 })).toMatch(/tempo para desfazer/i);
    expect(resumirAlteracoes(null, FICHA_CLIENTE)).toBeTruthy();
  });

  it('aponta pendências em português', () => {
    const p = pendenciasParaPublicar({
      ...FICHA_CLIENTE,
      quandoUsar: '',
      campos: [{ chave: 'plano', rotulo: 'Plano', tipo: 'lista', obrigatorio: true, pergunta: '' }],
      api: { metodo: 'POST', caminho: '/v1/clientes', mapeamento: [{ campo: 'cnpj', destino: 'cnpj' }] },
    });
    expect(p).toEqual(
      expect.arrayContaining([
        'Escreva a pergunta que o agente faz para o campo "Plano".',
        'O campo "Plano" é uma lista: informe as opções aceitas.',
        'O mapeamento usa o campo "cnpj", que não existe na ficha.',
      ]),
    );
  });
});

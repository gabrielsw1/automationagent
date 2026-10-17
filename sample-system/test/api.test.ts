import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { cnpjValido } from '../src/util/texto.ts';
import { api, json, novoApp, pdfValido, tela } from './apoio.ts';

let app: FastifyInstance;

beforeEach(() => {
  app = novoApp();
});

afterEach(async () => {
  await app.close();
});

const NOVO = {
  razao_social: 'ACME Logística',
  cnpj: '11.222.333/0001-81',
  email_cobranca: 'financeiro@acmelog.com.br',
  prazo_pagamento_dias: 30,
  responsavel_id: '101',
};

describe('autenticação e cadastros básicos', () => {
  it('exige a chave de serviço', async () => {
    expect((await api(app, 'GET', '/v1/saude', { semChave: true })).statusCode).toBe(401);
    const errada = await api(app, 'GET', '/v1/clientes', { semChave: true, cabecalhos: { authorization: 'Bearer outra' } });
    expect(errada.statusCode).toBe(401);
    expect(json(errada).erro).toBe('nao_autenticado');
    const r = await api(app, 'GET', '/v1/saude', { usuario: 'copiloto' });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ ok: true });
    expect(typeof json(r).versao).toBe('string');
  });

  it('lista usuários, perfis e planos', async () => {
    const usuarios = json<{ itens: { id: string; nome: string; perfis: string[] }[] }>(await api(app, 'GET', '/v1/usuarios', { usuario: 'copiloto' }));
    expect(usuarios.itens).toHaveLength(7);
    expect(usuarios.itens.find((u) => u.id === '105')).toMatchObject({ nome: 'Rafael Lima', perfis: ['Administradores', 'Gestor financeiro'] });
    expect(json(await api(app, 'GET', '/v1/usuarios/101', { usuario: '101' }))).toMatchObject({ email: 'ana.ribeiro@horizonte.com.br' });
    const naoExiste = await api(app, 'GET', '/v1/usuarios/999', { usuario: 'copiloto' });
    expect(naoExiste.statusCode).toBe(404);
    expect(json(await api(app, 'GET', '/v1/perfis')).itens).toEqual([
      'Comercial',
      'Financeiro',
      'Atendimento',
      'Técnico',
      'Gestor financeiro',
      'Administradores',
    ]);
    expect(json(await api(app, 'GET', '/v1/planos')).itens).toEqual(['Básico', 'Pro', 'Premium']);
  });

  it('descreve as rotas no formato RotaApi', async () => {
    const { itens } = json<{ itens: { metodo: string; caminho: string; descricao: string; campos?: { nome: string; obrigatorio: boolean }[]; idRetorno?: string }[] }>(
      await api(app, 'GET', '/v1/rotas', { usuario: 'copiloto' }),
    );
    const criar = itens.find((r) => r.metodo === 'POST' && r.caminho === '/v1/clientes');
    expect(criar?.idRetorno).toBe('id');
    expect(criar?.campos?.map((c) => c.nome)).toEqual(['razao_social', 'cnpj', 'email_cobranca', 'prazo_pagamento_dias', 'responsavel_id']);
    for (const [metodo, caminho] of [
      ['POST', '/v1/planos/alteracoes'],
      ['DELETE', '/v1/planos/alteracoes/{id}'],
      ['POST', '/v1/relatorios/vendas'],
      ['POST', '/v1/chamados'],
      ['DELETE', '/v1/clientes/{id}'],
      ['POST', '/v1/sessoes'],
    ]) {
      expect(itens.some((r) => r.metodo === metodo && r.caminho === caminho), `${metodo} ${caminho}`).toBe(true);
    }
    for (const r of itens) expect(r.descricao.length).toBeGreaterThan(10);
  });

  it('responde 404 em JSON para rota desconhecida', async () => {
    const r = await api(app, 'GET', '/v1/nao-existe', { usuario: '101' });
    expect(r.statusCode).toBe(404);
    expect(json(r).erro).toBe('nao_encontrado');
  });
});

describe('clientes', () => {
  it('tem os dados iniciais com CNPJs válidos', async () => {
    const { itens } = json<{ itens: { id: string; codigo: string; razao_social: string; cnpj: string }[] }>(await api(app, 'GET', '/v1/clientes', { usuario: '101' }));
    expect(itens.length).toBeGreaterThanOrEqual(15);
    for (const c of itens) expect(cnpjValido(c.cnpj), c.razao_social).toBe(true);
    for (const nome of ['Padaria Estrela', 'Transportes Vale', 'Clínica Bem Viver', 'Metalúrgica Sul', 'Loja Aurora', 'Pólen Café', 'Delta Transportes', 'Farmácia Central']) {
      expect(itens.some((c) => c.razao_social.startsWith(nome)), nome).toBe(true);
    }
    expect(itens.some((c) => /acme log[íi]stica/i.test(c.razao_social))).toBe(false);
    expect(itens.some((c) => c.cnpj === '11.222.333/0001-81')).toBe(false);
    const acme = json(await api(app, 'GET', '/v1/clientes/3190', { usuario: '101' }));
    expect(acme).toMatchObject({
      id: '3190',
      codigo: '#3190',
      razao_social: 'ACME Log Ltda',
      cnpj: '12.345.678/0001-95',
      email_cobranca: 'contato@acmelog.com.br',
      prazo_pagamento_dias: 15,
      plano: 'Básico',
    });
    expect(Object.keys(acme).sort()).toEqual(
      ['id', 'codigo', 'razao_social', 'cnpj', 'email_cobranca', 'prazo_pagamento_dias', 'plano', 'responsavel_id', 'criado_em'].sort(),
    );
  });

  it('busca por documento (só dígitos) e por nome sem acento e sem caixa', async () => {
    const porDoc = json<{ itens: { id: string }[] }>(await api(app, 'GET', '/v1/clientes?documento=12345678000195', { usuario: '101' }));
    expect(porDoc.itens.map((c) => c.id)).toEqual(['3190']);
    const formatado = json<{ itens: unknown[] }>(await api(app, 'GET', `/v1/clientes?documento=${encodeURIComponent('12.345.678/0001-95')}`, { usuario: '101' }));
    expect(formatado.itens).toHaveLength(1);
    expect(json<{ itens: unknown[] }>(await api(app, 'GET', '/v1/clientes?documento=11222333000181', { usuario: '101' })).itens).toHaveLength(0);
    const porNome = json<{ itens: { razao_social: string }[] }>(await api(app, 'GET', '/v1/clientes?busca=CLINICA%20bem', { usuario: '101' }));
    expect(porNome.itens.map((c) => c.razao_social)).toEqual(['Clínica Bem Viver Ltda']);
    expect((await api(app, 'GET', '/v1/clientes/1', { usuario: '101' })).statusCode).toBe(404);
  });

  it('cadastra, consulta e desfaz um cliente', async () => {
    const r = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO });
    expect(r.statusCode).toBe(201);
    const c = json(r);
    expect(c).toMatchObject({ id: '4821', codigo: '#4821', razao_social: 'ACME Logística', cnpj: '11.222.333/0001-81', plano: 'Básico', prazo_pagamento_dias: 30, responsavel_id: '101' });
    expect(r.headers.location).toBe('/v1/clientes/4821');
    expect(json(await api(app, 'GET', '/v1/clientes/4821', { usuario: '101' }))).toMatchObject({ razao_social: 'ACME Logística' });
    const apagar = await api(app, 'DELETE', '/v1/clientes/4821', { usuario: '101' });
    expect(apagar.statusCode).toBe(204);
    expect((await api(app, 'GET', '/v1/clientes/4821', { usuario: '101' })).statusCode).toBe(404);
    expect((await api(app, 'DELETE', '/v1/clientes/4821', { usuario: '101' })).statusCode).toBe(404);
  });

  it('aceita CNPJ só com dígitos, prazo em texto e responsável numérico', async () => {
    const r = await api(app, 'POST', '/v1/clientes', {
      usuario: '103',
      corpo: { ...NOVO, cnpj: '11222333000181', prazo_pagamento_dias: '45 dias', responsavel_id: 103 },
    });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ cnpj: '11.222.333/0001-81', prazo_pagamento_dias: 45, responsavel_id: '103' });
  });

  it('recusa quem não tem perfil (403 com perfil_necessario)', async () => {
    const r = await api(app, 'POST', '/v1/clientes', { usuario: '102', corpo: NOVO });
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ erro: 'sem_permissao', perfil_necessario: 'Comercial' });
    expect(String(json(r).mensagem)).toContain('Comercial');
    const desconhecido = await api(app, 'POST', '/v1/clientes', { usuario: '999', corpo: NOVO });
    expect(desconhecido.statusCode).toBe(403);
    const semUsuario = await api(app, 'POST', '/v1/clientes', { corpo: NOVO });
    expect(semUsuario.statusCode).toBe(400);
  });

  it('devolve 409 com o cliente existente quando o CNPJ já está cadastrado', async () => {
    const r = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: { ...NOVO, cnpj: '12.345.678/0001-95' } });
    expect(r.statusCode).toBe(409);
    const corpo = json<{ erro: string; mensagem: string; existente: { id: string; razao_social: string } }>(r);
    expect(corpo.erro).toBe('cnpj_duplicado');
    expect(corpo.existente).toMatchObject({ id: '3190', razao_social: 'ACME Log Ltda' });
    expect(corpo.mensagem).toContain('ACME Log Ltda');
  });

  it('devolve 422 com a mensagem de cada campo', async () => {
    const r = await api(app, 'POST', '/v1/clientes', {
      usuario: '101',
      corpo: { razao_social: '', cnpj: '12.345.678/0001-90', email_cobranca: 'financeiro@', prazo_pagamento_dias: 20, responsavel_id: '999' },
    });
    expect(r.statusCode).toBe(422);
    const corpo = json<{ erro: string; campos: Record<string, string> }>(r);
    expect(corpo.erro).toBe('validacao');
    expect(Object.keys(corpo.campos).sort()).toEqual(['cnpj', 'email_cobranca', 'prazo_pagamento_dias', 'razao_social', 'responsavel_id']);
    expect(corpo.campos.prazo_pagamento_dias).toContain('15, 30, 45 ou 60');
    const cpf = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: { ...NOVO, cnpj: '384.915.276-64' } });
    expect(json<{ campos: Record<string, string> }>(cpf).campos.cnpj).toContain('CPF');
  });

  it('simula sem gravar (x-simulacao: 1), validando permissões e duplicidade', async () => {
    const r = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO, cabecalhos: { 'x-simulacao': '1' } });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ simulado: true, id: '4821', razao_social: 'ACME Logística' });
    expect(json<{ itens: unknown[] }>(await api(app, 'GET', '/v1/clientes?documento=11222333000181', { usuario: '101' })).itens).toHaveLength(0);
    const negado = await api(app, 'POST', '/v1/clientes', { usuario: '102', corpo: NOVO, cabecalhos: { 'x-simulacao': '1' } });
    expect(negado.statusCode).toBe(403);
    const duplicado = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: { ...NOVO, cnpj: '12345678000195' }, cabecalhos: { 'x-simulacao': '1' } });
    expect(duplicado.statusCode).toBe(409);
    const apagar = await api(app, 'DELETE', '/v1/clientes/3190', { usuario: '101', cabecalhos: { 'x-simulacao': '1' } });
    expect(apagar.statusCode).toBe(200);
    expect(json(apagar)).toMatchObject({ simulado: true });
    expect((await api(app, 'GET', '/v1/clientes/3190', { usuario: '101' })).statusCode).toBe(200);
    // A simulação não consome o código: o cadastro real continua sendo o #4821.
    expect(json(await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO })).id).toBe('4821');
  });

  it('respeita idempotency-key: a mesma chave devolve a mesma resposta sem gravar de novo', async () => {
    const cab = { 'idempotency-key': 'exec-123' };
    const r1 = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO, cabecalhos: cab });
    const r2 = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO, cabecalhos: cab });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(json(r2)).toEqual(json(r1));
    expect(r2.headers['idempotent-replayed']).toBe('true');
    const lista = json<{ itens: unknown[] }>(await api(app, 'GET', '/v1/clientes?documento=11222333000181', { usuario: '101' }));
    expect(lista.itens).toHaveLength(1);
    // Outra chave grava de novo (e esbarra no CNPJ duplicado).
    const r3 = await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO, cabecalhos: { 'idempotency-key': 'exec-456' } });
    expect(r3.statusCode).toBe(409);
  });

  it('atualiza com PATCH e protege CNPJ e plano', async () => {
    const r = await api(app, 'PATCH', '/v1/clientes/3190', { usuario: '101', corpo: { email_cobranca: 'Financeiro@AcmeLog.com.br', prazo_pagamento_dias: 30 } });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ email_cobranca: 'financeiro@acmelog.com.br', prazo_pagamento_dias: 30, razao_social: 'ACME Log Ltda' });
    const outro = await api(app, 'PATCH', '/v1/clientes/3190', { usuario: '101', corpo: { cnpj: '18.473.629/0001-14' } });
    expect(outro.statusCode).toBe(409);
    expect(json<{ existente: { razao_social: string } }>(outro).existente.razao_social).toBe('Transportes Vale Ltda');
    const plano = await api(app, 'PATCH', '/v1/clientes/3190', { usuario: '101', corpo: { plano: 'Premium' } });
    expect(plano.statusCode).toBe(422);
    expect((await api(app, 'PATCH', '/v1/clientes/3190', { usuario: '102', corpo: { prazo_pagamento_dias: 45 } })).statusCode).toBe(403);
  });
});

describe('alteração de plano', () => {
  it('exige Gestor financeiro ou Administradores', async () => {
    const r = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '101', corpo: { cliente: 'ACME Log Ltda', plano: 'Premium' } });
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ erro: 'sem_permissao', perfil_necessario: 'Gestor financeiro' });
    const julia = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '106', corpo: { cliente: 'ACME Log Ltda', plano: 'Premium' } });
    expect(julia.statusCode).toBe(201);
  });

  it('aceita nome sem acento e sem caixa, ou CNPJ, e desfaz', async () => {
    const r = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'padaria estrela', plano: 'pro' } });
    expect(r.statusCode).toBe(201);
    const alt = json<{ id: string; cliente_id: string; cliente_nome: string; plano_anterior: string; plano: string; a_partir_de: string }>(r);
    expect(alt).toMatchObject({ cliente_id: '1024', cliente_nome: 'Padaria Estrela Ltda', plano_anterior: 'Básico', plano: 'Pro', a_partir_de: '2026-10-16' });
    expect(json(await api(app, 'GET', '/v1/clientes/1024', { usuario: '105' })).plano).toBe('Pro');

    const desfazer = await api(app, 'DELETE', `/v1/planos/alteracoes/${alt.id}`, { usuario: '105' });
    expect(desfazer.statusCode).toBe(204);
    expect(json(await api(app, 'GET', '/v1/clientes/1024', { usuario: '105' })).plano).toBe('Básico');
    expect((await api(app, 'DELETE', `/v1/planos/alteracoes/${alt.id}`, { usuario: '105' })).statusCode).toBe(409);

    const porCnpj = await api(app, 'POST', '/v1/planos/alteracoes', {
      usuario: '105',
      corpo: { cliente: '12.345.678/0001-95', plano: 'Premium', a_partir_de: '2026-11-01' },
    });
    expect(porCnpj.statusCode).toBe(201);
    expect(json(porCnpj)).toMatchObject({ cliente_nome: 'ACME Log Ltda', plano_anterior: 'Básico', plano: 'Premium', a_partir_de: '2026-11-01' });
    expect(json(await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'CLINICA BEM VIVER', plano: 'Pro' } }))).toMatchObject({
      cliente_id: '1342',
      plano_anterior: 'Premium',
    });
  });

  it('responde ambiguo, mesmo_plano, cliente_nao_encontrado e 422', async () => {
    const amb = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'Transportes', plano: 'Premium' } });
    expect(amb.statusCode).toBe(409);
    const corpoAmb = json<{ erro: string; opcoes: { razao_social: string }[] }>(amb);
    expect(corpoAmb.erro).toBe('ambiguo');
    expect(corpoAmb.opcoes.map((o) => o.razao_social).sort()).toEqual(['Delta Transportes Ltda', 'Transportes Vale Ltda']);

    const mesmo = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'Clínica Bem Viver', plano: 'Premium' } });
    expect(mesmo.statusCode).toBe(409);
    expect(json(mesmo).erro).toBe('mesmo_plano');

    const nada = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'ACME Logística', plano: 'Pro' } });
    expect(nada.statusCode).toBe(404);
    expect(json(nada).erro).toBe('cliente_nao_encontrado');

    const invalido = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'ACME', plano: 'Ouro', a_partir_de: '2020-01-01' } });
    expect(invalido.statusCode).toBe(422);
    expect(Object.keys(json<{ campos: object }>(invalido).campos).sort()).toEqual(['a_partir_de', 'plano']);
  });

  it('simula a alteração sem mudar o plano', async () => {
    const r = await api(app, 'POST', '/v1/planos/alteracoes', { usuario: '105', corpo: { cliente: 'ACME', plano: 'Premium' }, cabecalhos: { 'x-simulacao': '1' } });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ simulado: true, plano_anterior: 'Básico', plano: 'Premium' });
    expect(json(await api(app, 'GET', '/v1/clientes/3190', { usuario: '105' })).plano).toBe('Básico');
  });
});

describe('relatórios de vendas', () => {
  it('gera PDF e planilha servidos em /arquivos/relatorios', async () => {
    const r = await api(app, 'POST', '/v1/relatorios/vendas', {
      usuario: '103',
      corpo: { periodo_inicio: '2026-09-01', periodo_fim: '2026-09-30', agrupar_por: 'vendedor', formato: 'pdf' },
    });
    expect(r.statusCode).toBe(201);
    const rel = json<{ id: string; arquivo_url: string; linhas: number; total_vendas: number }>(r);
    expect(rel.linhas).toBe(6);
    expect(rel.total_vendas).toBeGreaterThan(100_000);
    expect(rel.arquivo_url).toMatch(new RegExp(`/arquivos/relatorios/${rel.id}\\.pdf$`));
    const pdf = await tela(app, new URL(rel.arquivo_url).pathname);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(String(pdf.headers['content-disposition'])).toContain('relatorio-vendas-por-vendedor-2026-09-01-a-2026-09-30.pdf');
    expect(pdfValido(pdf.rawPayload)).toBe(true);

    const p = await api(app, 'POST', '/v1/relatorios/vendas', {
      usuario: '102',
      corpo: { periodo_inicio: '01/01/2026', periodo_fim: '30/09/2026', agrupar_por: 'Região', formato: 'planilha' },
    });
    expect(p.statusCode).toBe(201);
    const planilha = json<{ arquivo_url: string; linhas: number; total_vendas: number }>(p);
    expect(planilha.linhas).toBe(5);
    expect(planilha.arquivo_url).toMatch(/\.csv$/);
    const csv = await tela(app, new URL(planilha.arquivo_url).pathname);
    expect(csv.headers['content-type']).toContain('text/csv');
    const texto = csv.rawPayload.toString('utf8');
    expect(texto.startsWith('﻿Região;Quantidade de vendas;Total vendido (R$)')).toBe(true);
    const total = texto.trim().split('\r\n').pop()!.split(';');
    expect(total[0]).toBe('Total');
    expect(Number(total[2].replace(',', '.'))).toBeCloseTo(planilha.total_vendas, 2);

    const iguais = await api(app, 'POST', '/v1/relatorios/vendas', {
      usuario: '103',
      corpo: { periodo_inicio: '2026-09-01', periodo_fim: '2026-09-30', agrupar_por: 'produto', formato: 'pdf' },
    });
    expect(json(iguais).total_vendas).toBe(rel.total_vendas);
  });

  it('valida campos e permissões', async () => {
    const r = await api(app, 'POST', '/v1/relatorios/vendas', {
      usuario: '103',
      corpo: { periodo_inicio: '2026-09-30', periodo_fim: '2026-09-01', agrupar_por: 'cliente', formato: 'docx' },
    });
    expect(r.statusCode).toBe(422);
    expect(Object.keys(json<{ campos: object }>(r).campos).sort()).toEqual(['agrupar_por', 'formato', 'periodo_fim']);
    const camila = await api(app, 'POST', '/v1/relatorios/vendas', {
      usuario: '107',
      corpo: { periodo_inicio: '2026-09-01', periodo_fim: '2026-09-30', agrupar_por: 'vendedor', formato: 'pdf' },
    });
    expect(camila.statusCode).toBe(403);
    expect(json(camila).perfil_necessario).toBe('Comercial');
    expect((await tela(app, '/arquivos/relatorios/naoexiste.pdf')).statusCode).toBe(404);
  });

  it('simula sem criar arquivo', async () => {
    const r = await api(app, 'POST', '/v1/relatorios/vendas', {
      usuario: '103',
      corpo: { periodo_inicio: '2026-09-01', periodo_fim: '2026-09-30', agrupar_por: 'vendedor', formato: 'pdf' },
      cabecalhos: { 'x-simulacao': '1' },
    });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ simulado: true, arquivo_url: null, linhas: 6 });
  });
});

describe('chamados', () => {
  it('abre e exclui um chamado', async () => {
    const r = await api(app, 'POST', '/v1/chamados', {
      usuario: '107',
      corpo: { assunto: 'Impressora sem conexão', cliente: 'Pólen Café', prioridade: 'media', descricao: 'A impressora da cozinha não aparece na rede desde ontem.' },
    });
    expect(r.statusCode).toBe(201);
    const ch = json<{ id: string; numero: string; prioridade: string; cliente_id: string }>(r);
    expect(ch).toMatchObject({ id: '153', numero: 'CH-2026-0153', prioridade: 'Média', cliente_id: '2045' });
    expect(json(await api(app, 'GET', '/v1/chamados/CH-2026-0153', { usuario: '107' })).assunto).toBe('Impressora sem conexão');
    expect((await api(app, 'DELETE', `/v1/chamados/${ch.id}`, { usuario: '107' })).statusCode).toBe(204);
    expect((await api(app, 'GET', `/v1/chamados/${ch.id}`, { usuario: '107' })).statusCode).toBe(404);
  });

  it('valida prioridade e descrição', async () => {
    const r = await api(app, 'POST', '/v1/chamados', { usuario: '101', corpo: { assunto: 'Teste', cliente: 'ACME', prioridade: 'Crítica', descricao: 'curta' } });
    expect(r.statusCode).toBe(422);
    expect(Object.keys(json<{ campos: object }>(r).campos).sort()).toEqual(['descricao', 'prioridade']);
  });
});

describe('sessões para o navegador e demo "API instável"', () => {
  it('abre sessão das telas para a pessoa', async () => {
    const r = await api(app, 'POST', '/v1/sessoes', { usuario: '102', corpo: { usuario_id: '102' } });
    expect(r.statusCode).toBe(201);
    const s = json<{ cookie: { name: string; value: string }; expira_em: string }>(r);
    expect(s.cookie.name).toBe('hz_sessao');
    expect(new Date(s.expira_em).getTime()).toBeGreaterThan(Date.parse('2026-10-16T13:00:00Z'));
    const pagina = await tela(app, '/financeiro/segunda-via', `hz_sessao=${s.cookie.value}`);
    expect(pagina.statusCode).toBe(200);
    expect(pagina.body).toContain('data-usuario="102"');
    expect((await api(app, 'POST', '/v1/sessoes', { usuario: '102', corpo: { usuario_id: '999' } })).statusCode).toBe(404);
    expect((await api(app, 'POST', '/v1/sessoes', { semChave: true, corpo: { usuario_id: '102' } })).statusCode).toBe(401);
    expect((await tela(app, '/clientes', 'hz_sessao=forjado.abc')).statusCode).toBe(302);
  });

  it('com a API instável, tudo em /v1 responde 503, menos /v1/sessoes', async () => {
    const liga = await app.inject({ method: 'POST', url: '/_demo/estado', payload: { api_instavel: true } });
    expect(json(liga)).toEqual({ api_instavel: true, tela_agendamento_v2: false });
    expect(json(await app.inject({ method: 'GET', url: '/_demo/estado' }))).toMatchObject({ api_instavel: true });
    expect((await api(app, 'GET', '/v1/saude', { usuario: 'copiloto' })).statusCode).toBe(503);
    expect((await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO })).statusCode).toBe(503);
    expect((await api(app, 'GET', '/v1/clientes', { usuario: '101' })).statusCode).toBe(503);
    expect((await api(app, 'POST', '/v1/sessoes', { usuario: '101', corpo: { usuario_id: '101' } })).statusCode).toBe(201);
    await app.inject({ method: 'POST', url: '/_demo/estado', payload: { api_instavel: false } });
    expect((await api(app, 'GET', '/v1/saude', { usuario: 'copiloto' })).statusCode).toBe(200);
  });

  it('restaura os dados iniciais', async () => {
    await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO });
    await app.inject({ method: 'POST', url: '/_demo/estado', payload: { tela_agendamento_v2: true } });
    const r = await app.inject({ method: 'POST', url: '/_demo/restaurar', headers: { accept: 'application/json' } });
    expect(json(r)).toMatchObject({ ok: true, api_instavel: false, tela_agendamento_v2: false });
    expect((await api(app, 'GET', '/v1/clientes/4821', { usuario: '101' })).statusCode).toBe(404);
    expect(json(await api(app, 'POST', '/v1/clientes', { usuario: '101', corpo: NOVO })).id).toBe('4821');
  });
});

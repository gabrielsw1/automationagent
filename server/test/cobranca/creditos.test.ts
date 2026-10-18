// Créditos do ciclo, o bloqueio quando acabam, o fechamento do mês e a migração da cobrança.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cicloDe, competenciaDe, deslocarCompetencia, somarDias } from '../../src/cobranca/ciclo.ts';
import { MENSAGEM_SEM_CREDITOS } from '../../src/cobranca/creditos.ts';
import { Banco } from '../../src/db/banco.ts';
import { MIGRACOES_PLATAFORMA } from '../../src/plataforma/esquema.ts';
import { criarAmbiente, type Ambiente } from '../ajuda.ts';
import { empresaCliente, gastar, SEM_ASAAS } from './ajuda-cobranca.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

/** 17/10/2026, meio-dia em São Paulo. */
const AGORA = new Date('2026-10-17T15:00:00.000Z');
const em = (dia: string, hora = '13:00') => new Date(`${dia}T${hora}:00.000Z`);

describe('ciclo', () => {
  it('é o mês do calendário em São Paulo', () => {
    expect(competenciaDe(new Date('2026-11-01T02:59:00Z'))).toBe('2026-10');
    expect(competenciaDe(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11');
    const { inicio, fim } = cicloDe('2026-10');
    expect(inicio.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(deslocarCompetencia('2026-01', -1)).toBe('2025-12');
    expect(somarDias('2026-10-25', 10)).toBe('2026-11-04');
  });
});

describe('créditos do ciclo', () => {
  it('soma usados, pacotes pagos, restantes, ritmo por dia e quando acabam', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { ctx, empresa } = empresaCliente(amb, { incluidos: 120, credito: 40 });
    // Setembro e o futuro não contam.
    gastar(ctx, em('2026-09-30'), { creditos: 1 });
    for (let i = 0; i < 30; i++) gastar(ctx, em('2026-10-05'), { usuario: i % 2 ? '1' : '2' });
    for (let i = 0; i < 12; i++) gastar(ctx, em(`2026-10-${String(9 + (i % 4)).padStart(2, '0')}`), { conserto: true, tarefaId: 'trf_visita', nome: 'Agendar visita técnica', usuario: '3' });
    gastar(ctx, em('2026-10-16'), { tarefaId: 'trf_visita', nome: 'Agendar visita técnica', usuario: '3' });
    // Teste do console não gasta crédito (creditos 0) nem conta como uso.
    gastar(ctx, em('2026-10-16'), { creditos: 0, canal: 'teste', usuario: '9' });
    ctx.banco.inserir('conversas', { id: 'cnv_1', usuario_id: '4', usuario_nome: 'Quem só perguntou', canal: 'widget', criado_em: em('2026-10-10').toISOString(), atualizado_em: em('2026-10-10').toISOString() });
    ctx.banco.inserir('conversas', { id: 'cnv_2', usuario_id: '5', usuario_nome: 'Teste', canal: 'teste', criado_em: em('2026-10-10').toISOString(), atualizado_em: em('2026-10-10').toISOString() });

    const c = ctx.creditos.ciclo(AGORA);
    expect(c).toMatchObject({ competencia: '2026-10', incluidos: 120, pacotes: 0, usados: 91, creditosRoteiro: 31, creditosConserto: 60, restantes: 29, extras: 0, valorExtrasCentavos: 0 });
    expect(c.porDia).toBeCloseTo(91 / 17, 5);
    // 29 restantes a ~5,35 por dia: acabam em pouco mais de 5 dias, antes do fim do ciclo.
    expect(Date.parse(c.acabaEm!) - AGORA.getTime()).toBeCloseTo((29 / (91 / 17)) * 86_400_000, -3);
    expect(ctx.creditos.usuariosMes(AGORA)).toBe(4);

    // Um pacote pago neste ciclo soma; um pago no ciclo anterior não.
    for (const [pago, creditos] of [['2026-10-10T12:00:00.000Z', 1000], ['2026-09-28T12:00:00.000Z', 500]] as const) {
      amb.plataforma.banco.inserir('faturas', {
        id: `fat_${creditos}`, empresa_id: empresa.id, tipo: 'pacote', itens: [], total_centavos: creditos * 40, status: 'paga',
        criado_em: pago, atualizado_em: pago, pago_em: pago, gateway: 'manual', creditos,
      });
    }
    expect(ctx.creditos.ciclo(AGORA)).toMatchObject({ pacotes: 1000, restantes: 1029, acabaEm: null });

    const uso = ctx.creditos.uso(AGORA);
    expect(uso.tarefas.map((t) => [t.nome, t.execucoes, t.roteiro, t.conserto, t.creditos, t.consertoFrequente])).toEqual([
      ['Agendar visita técnica', 13, 1, 12, 61, true],
      ['Abrir chamado', 30, 30, 0, 30, false],
    ]);
    expect(uso.total).toEqual({ execucoes: 43, roteiro: 31, conserto: 12, creditos: 91 });
    expect(uso.destaque).toMatchObject({
      nome: 'Agendar visita técnica',
      primeiroConserto: em('2026-10-09').toISOString(),
      consertos: 12,
      execucoes: 13,
      creditosConserto: 60,
      creditosPeloRoteiro: 12,
      fluxoId: null,
    });
    expect(uso.destaque!.fracaoCiclo).toBeCloseTo(60 / 91, 5);
    // O ciclo anterior tem a sua própria tabela.
    expect(ctx.creditos.uso(AGORA, '2026-09').total).toMatchObject({ execucoes: 1, creditos: 1 });
  });

  it('passa dos incluídos: créditos extras e o valor deles', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { ctx } = empresaCliente(amb, { incluidos: 40, credito: 40 });
    for (let i = 0; i < 10; i++) gastar(ctx, em('2026-10-03'), { conserto: true });
    expect(ctx.creditos.ciclo(AGORA)).toMatchObject({ usados: 50, restantes: -10, extras: 10, valorExtrasCentavos: 400, acabaEm: null });
  });
});

describe('quando os créditos acabam', () => {
  it('sem preço do crédito, recusa antes de rodar', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { ctx } = empresaCliente(amb, { incluidos: 10 });
    gastar(ctx, em('2026-10-02'), { creditos: 9 });
    expect(ctx.gastos.verificar('x', 'api', AGORA)).toEqual({ permitido: true });
    expect(ctx.gastos.pausaAtiva(AGORA)).toBeNull();
    gastar(ctx, em('2026-10-03'), { creditos: 1 });
    expect(ctx.gastos.verificar('x', 'api', AGORA)).toEqual({ permitido: false, motivo: 'creditos', mensagem: MENSAGEM_SEM_CREDITOS });
    expect(MENSAGEM_SEM_CREDITOS).toBe('Os créditos do mês acabaram. Um Admin pode comprar um pacote em Plano e créditos.');
    expect(ctx.gastos.pausaAtiva(AGORA)).toMatchObject({ tipo: 'tudo', mensagem: expect.stringContaining('créditos do mês acabaram') });
    // Sem preço, o uso do mês continua sendo o custo.
    expect(ctx.gastos.limites(AGORA).base).toBe('custo');
  });

  it('com preço, roda como crédito extra até o limite mensal de Equipe e limites', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { ctx } = empresaCliente(amb, { incluidos: 10, credito: 40 });
    gastar(ctx, em('2026-10-02'), { creditos: 60 });
    // 50 extras a R$ 0,40 = R$ 20,00, abaixo do limite padrão de R$ 1.500.
    expect(ctx.gastos.verificar('x', 'navegador', AGORA)).toEqual({ permitido: true });
    expect(ctx.creditos.verificar(AGORA)).toEqual({ permitido: true, extra: true });
    // O gasto do mês dessa empresa é o valor dos créditos extras.
    expect(ctx.gastos.limites(AGORA)).toMatchObject({ base: 'creditos', usoMes: 20 });
    const l = ctx.configuracoes.ler('limites');
    ctx.configuracoes.gravar('limites', { ...l, mensal: 20 }, 'Patrícia Nunes');
    expect(ctx.gastos.verificar('x', 'api', AGORA)).toMatchObject({ permitido: false, motivo: 'creditos', mensagem: MENSAGEM_SEM_CREDITOS });
    expect(ctx.gastos.pausaAtiva(AGORA)?.tipo).toBe('tudo');
  });

  it('a demonstração e o plano sem teto nunca bloqueiam', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    expect(amb.ctx.creditos.verificar(AGORA)).toEqual({ permitido: true, extra: false });
    const { ctx } = empresaCliente(amb, { incluidos: null, credito: 40 });
    gastar(ctx, em('2026-10-02'), { creditos: 5000 });
    expect(ctx.creditos.verificar(AGORA)).toEqual({ permitido: true, extra: false });
    expect(ctx.gastos.limites(AGORA).base).toBe('custo');
  });
});

describe('fechamento do mês', () => {
  it('fatura o mês anterior uma vez, pula sem preço, cobra a implantação só na primeira', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS, emailVendas: 'vendas@starta.com.br' } });
    const { ctx, empresa } = empresaCliente(amb, { incluidos: 40, cobrancaDesde: '2026-09-20T12:00:00.000Z' });
    // Empresa que só ganhou plano em outubro não paga setembro.
    const nova = amb.plataforma.criarEmpresa({ nome: 'Padaria Estrela', sistema: { ...ctx.empresa.sistema } });
    amb.plataforma.acompanhar(nova.id, { planoId: 'piloto' });
    amb.plataforma.banco.executar('UPDATE empresas SET cobranca_desde = ? WHERE id = ?', '2026-10-05T12:00:00.000Z', nova.id);
    for (let i = 0; i < 12; i++) gastar(ctx, em('2026-09-25'), { conserto: true });
    const outubro1 = new Date('2026-10-01T13:00:00.000Z');

    // Sem a mensalidade definida, não fatura e a Plataforma mostra a pendência.
    const pulou = await amb.plataforma.faturas.fecharMes(outubro1);
    expect(pulou.criadas).toEqual([]);
    expect(pulou.puladas).toEqual([{ empresaId: empresa.id, motivo: 'preço não definido: mensalidade do plano Piloto' }]);
    expect(amb.plataforma.faturas.pendencias(empresa.id, outubro1)).toEqual(['A fatura de setembro de 2026 não saiu: preço não definido (mensalidade do plano Piloto).']);

    // O plano cita a taxa de implantação: sem ela, também não fecha.
    amb.plataforma.atualizarPrecosPlano('piloto', { precoMensalCentavos: 99_000 });
    expect((await amb.plataforma.faturas.fecharMes(outubro1)).puladas[0].motivo).toBe('preço não definido: taxa de implantação do plano Piloto');
    // Créditos extras sem preço do crédito também não.
    amb.plataforma.atualizarPrecosPlano('piloto', { taxaImplantacaoCentavos: 150_000 });
    expect((await amb.plataforma.faturas.fecharMes(outubro1)).puladas[0].motivo).toBe('preço não definido: preço do crédito extra do plano Piloto');

    amb.plataforma.atualizarPrecosPlano('piloto', { precoCreditoExtraCentavos: 40 });
    const r = await amb.plataforma.faturas.fecharMes(outubro1);
    expect(r.criadas).toHaveLength(1);
    const f = r.criadas[0];
    expect(f).toMatchObject({ empresaId: empresa.id, competencia: '2026-09', tipo: 'mensal', status: 'emitida', gateway: 'manual', vencimento: '2026-10-11', totalCentavos: 150_000 + 99_000 + 20 * 40 });
    expect(f.itens).toEqual([
      { descricao: 'Taxa de implantação', quantidade: 1, unitarioCentavos: 150_000, totalCentavos: 150_000 },
      { descricao: 'Assinatura Piloto', quantidade: 1, unitarioCentavos: 99_000, totalCentavos: 99_000 },
      { descricao: 'Créditos extras', quantidade: 20, unitarioCentavos: 40, totalCentavos: 800 },
    ]);
    // Cobrança manual: a equipe Starta recebe a fatura para cobrar.
    const email = amb.correio.enviados.find((e) => e.para === 'vendas@starta.com.br')!;
    expect(email.assunto).toBe('Cobrar: Fatura de setembro de 2026 da Clínica Mais Agenda');
    expect(email.texto).toContain('marque a fatura como paga na Plataforma');
    expect(amb.plataforma.faturas.pendencias(empresa.id, outubro1)).toEqual([]);

    // Rodar de novo (o fechamento roda de hora em hora) não repete.
    expect((await amb.plataforma.faturas.fecharMes(outubro1)).criadas).toEqual([]);
    expect(amb.plataforma.faturas.listar(empresa.id)).toHaveLength(1);
    // Passou do vencimento (11/10) sem pagamento: a rodada seguinte marca como vencida.
    await amb.plataforma.faturas.fecharMes(new Date('2026-10-11T20:00:00.000Z'));
    expect(amb.plataforma.faturas.obter(f.id)!.status).toBe('emitida');
    await amb.plataforma.faturas.fecharMes(new Date('2026-10-12T13:00:00.000Z'));
    expect(amb.plataforma.faturas.obter(f.id)!.status).toBe('vencida');
    // A demonstração nunca é faturada.
    expect(amb.plataforma.faturas.listar(amb.ctx.empresa.id)).toEqual([]);

    // Novembro: a nova empresa paga outubro; a taxa de implantação da clínica não volta.
    const novembro = await amb.plataforma.faturas.fecharMes(new Date('2026-11-01T13:00:00.000Z'));
    const clinica = novembro.criadas.find((x) => x.empresaId === empresa.id)!;
    expect(clinica.itens.map((i) => i.descricao)).toEqual(['Assinatura Piloto']);
    expect(clinica.totalCentavos).toBe(99_000);
    expect(novembro.criadas.find((x) => x.empresaId === nova.id)!.itens.map((i) => i.descricao)).toEqual(['Taxa de implantação', 'Assinatura Piloto']);
  });
});

describe('migração da cobrança', () => {
  it('guarda os pedidos de contato e começa a cobrança de quem já tem plano', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'copiloto-cobranca-'));
    const arquivo = path.join(pasta, 'plataforma.db');
    try {
      const antes = new Banco(arquivo, MIGRACOES_PLATAFORMA.slice(0, MIGRACOES_PLATAFORMA.findIndex((m) => m.includes('CREATE TABLE faturas'))));
      const agora = new Date().toISOString();
      antes.inserir('contatos', { id: 'ctt_1', nome: 'Ana', email: 'ana@x.com.br', empresa: 'X', faixa: 'ate_200', origem: 'vendas', criado_em: agora });
      const base = { sistema: '{}', chave_publica: 'pk', segredo_widget: 's', dominios: '[]', criado_em: agora, fase: 'ativo' };
      antes.inserir('empresas', { ...base, id: 'emp_1', slug: 'a', nome: 'A', status: 'ativa', demo: 0, plano_id: 'piloto' });
      antes.inserir('empresas', { ...base, id: 'emp_2', slug: 'b', nome: 'B', status: 'ativa', demo: 0, chave_publica: 'pk2' });
      antes.fechar();

      const depois = new Banco(arquivo, MIGRACOES_PLATAFORMA);
      expect(depois.um('SELECT nome, faixa, origem, empresa_id FROM contatos')).toEqual({ nome: 'Ana', faixa: 'ate_200', origem: 'vendas', empresa_id: null });
      depois.inserir('contatos', { id: 'ctt_2', nome: 'Patrícia', email: 'p@x.com.br', empresa: 'A', origem: 'mudanca_plano', criado_em: agora, empresa_id: 'emp_1', plano_id: 'crescimento' });
      expect(depois.todos<{ id: string; cobranca: string | null }>('SELECT id, cobranca_desde AS cobranca FROM empresas ORDER BY id').map((l) => [l.id, !!l.cobranca])).toEqual([
        ['emp_1', true],
        ['emp_2', false],
      ]);
      expect(depois.todos<{ pacote_creditos: number }>('SELECT pacote_creditos FROM planos').every((l) => l.pacote_creditos === 1000)).toBe(true);
      expect(depois.um("SELECT metodo_pagamento AS m, recarga_automatica AS r FROM empresas WHERE id = 'emp_1'")).toEqual({ m: 'boleto', r: 0 });
      depois.fechar();
    } finally {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  });
});

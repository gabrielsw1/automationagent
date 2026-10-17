import { afterEach, describe, expect, it } from 'vitest';
import type { CasoDeTeste, ListaTarefas, RodadaTestes, TarefaDefinicao, TarefaDetalhe } from '@copiloto/shared';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';
import { auditorias, execucao, FICHA_CLIENTE, pedidoSemTarefa, pedir } from './dados.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

async function preparar() {
  amb = await criarAmbiente();
  const admin = entrarComo(amb.ctx, 'admin', 'Júlia Martins');
  return { a: amb, cookie: admin.cookie };
}

async function criarTarefa(a: Ambiente, cookie: string, def: TarefaDefinicao = FICHA_CLIENTE): Promise<TarefaDetalhe> {
  const r = await pedir(a, cookie, 'POST', '/tarefas', { definicao: def });
  expect(r.statusCode).toBe(201);
  return r.json<TarefaDetalhe>();
}

describe('catálogo de tarefas', () => {
  it('exige sessão; leitor vê mas não cria', async () => {
    const { a } = await preparar();
    expect((await a.app.inject({ method: 'GET', url: '/api/console/tarefas' })).statusCode).toBe(401);
    const leitor = entrarComo(a.ctx, 'leitor', 'Bruno Costa');
    const lista = await pedir(a, leitor.cookie, 'GET', '/tarefas');
    expect(lista.statusCode).toBe(200);
    const r = await pedir(a, leitor.cookie, 'POST', '/tarefas', { definicao: FICHA_CLIENTE });
    expect(r.statusCode).toBe(403);
    const suporte = entrarComo(a.ctx, 'suporte', 'Carla Dias');
    expect((await pedir(a, suporte.cookie, 'POST', '/tarefas/descrever', { descricao: 'Cadastrar clientes novos com CNPJ e e-mail' })).statusCode).toBe(403);
  });

  it('cria como rascunho, lista com contagem e números de 30 dias', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    expect(det.status).toBe('rascunho');
    expect(det.publicada).toBeNull();
    expect(det.rascunho?.versao).toBe(1);
    expect(det.rascunho?.definicao.tituloProgresso).toBe('Cadastrando {nome_empresa}');
    expect(det.perfisSistema).toContain('Comercial');

    execucao(a.ctx, { tarefa_id: det.id, status: 'concluida' });
    execucao(a.ctx, { tarefa_id: det.id, status: 'concluida' });
    execucao(a.ctx, { tarefa_id: det.id, status: 'falhou' });
    execucao(a.ctx, { tarefa_id: det.id, status: 'aguardando_confirmacao' });
    execucao(a.ctx, { tarefa_id: det.id, status: 'concluida', criado_em: new Date(Date.now() - 40 * 86400_000).toISOString() });

    const lista = (await pedir(a, cookie, 'GET', '/tarefas')).json<ListaTarefas>();
    expect(lista.contagem).toMatchObject({ todas: 1, rascunho: 1, ativa: 0 });
    expect(lista.tarefas[0]).toMatchObject({
      nome: 'Cadastrar cliente',
      status: 'rascunho',
      temRascunho: true,
      versaoPublicada: null,
      execucoes30d: 3,
      falhasHoje: 1,
    });
    expect(lista.tarefas[0].sucesso30d).toBeCloseTo(2 / 3);
    expect(auditorias(a.ctx).map((x) => x.acao)).toContain('criou a tarefa');
  });

  it('recusa ficha inválida com mensagem em português', async () => {
    const { a, cookie } = await preparar();
    const r = await pedir(a, cookie, 'POST', '/tarefas', {
      definicao: { ...FICHA_CLIENTE, campos: [FICHA_CLIENTE.campos[0], { ...FICHA_CLIENTE.campos[0] }] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensagem).toMatch(/nome_empresa/);
    const sem = await pedir(a, cookie, 'POST', '/tarefas', {});
    expect(sem.statusCode).toBe(400);
  });

  it('rascunho, publicação com pendências, publicação e nova versão', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie, { ...FICHA_CLIENTE, quandoUsar: 'curto' });

    const pend = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/publicar`, {});
    expect(pend.statusCode).toBe(422);
    expect(pend.json().mensagem).toMatch(/^Antes de publicar: .*Quando usar/);

    const salvo = await pedir(a, cookie, 'PUT', `/tarefas/${det.id}/rascunho`, { definicao: FICHA_CLIENTE });
    expect(salvo.statusCode).toBe(200);
    const pub = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/publicar`, {});
    expect(pub.statusCode).toBe(200);
    const v1 = pub.json<TarefaDetalhe>();
    expect(v1.publicada?.versao).toBe(1);
    expect(v1.publicada?.publicadoPor).toBe('Júlia Martins');
    expect(v1.rascunho).toBeNull();

    // Publicar ativa a tarefa; dá para colocar em teste e ativar de novo.
    expect(v1.status).toBe('ativa');
    const teste = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/status`, { status: 'teste' });
    expect(teste.json<TarefaDetalhe>().status).toBe('teste');
    const ativa = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/status`, { status: 'ativa' });
    expect(ativa.json<TarefaDetalhe>().status).toBe('ativa');

    // Nova alteração vira rascunho da versão 2, com contagem de alterações.
    const mudou: TarefaDefinicao = { ...FICHA_CLIENTE, desfazerMinutos: 15, exemplos: [...FICHA_CLIENTE.exemplos, 'abre cadastro pra Delta'] };
    const r2 = (await pedir(a, cookie, 'PUT', `/tarefas/${det.id}/rascunho`, { definicao: mudou })).json<TarefaDetalhe>();
    expect(r2.rascunho?.versao).toBe(2);
    expect(r2.rascunho?.alteracoes).toBe(2);
    const p2 = (await pedir(a, cookie, 'POST', `/tarefas/${det.id}/publicar`, {})).json<TarefaDetalhe>();
    expect(p2.publicada?.versao).toBe(2);
    expect(p2.historico.map((h) => [h.versao, h.status])).toEqual([
      [2, 'publicada'],
      [1, 'arquivada'],
    ]);
    expect(p2.historico[0].resumoMudancas).toMatch(/tempo para desfazer/i);

    // Restaurar a versão 1 cria um rascunho com o conteúdo dela.
    const rest = (await pedir(a, cookie, 'POST', `/tarefas/${det.id}/restaurar`, { versao: 1 })).json<TarefaDetalhe>();
    expect(rest.rascunho?.versao).toBe(3);
    expect(rest.rascunho?.definicao.desfazerMinutos).toBe(5);

    // Descartar o rascunho.
    const desc = (await pedir(a, cookie, 'DELETE', `/tarefas/${det.id}/rascunho`)).json<TarefaDetalhe>();
    expect(desc.rascunho).toBeNull();
    expect((await pedir(a, cookie, 'DELETE', `/tarefas/${det.id}/rascunho`)).statusCode).toBe(409);

    const acoes = auditorias(a.ctx).map((x) => x.acao);
    expect(acoes).toEqual(
      expect.arrayContaining([
        'salvou o rascunho da tarefa',
        'publicou a versão 1 da tarefa',
        'colocou em teste a tarefa',
        'ativou a tarefa',
        'publicou a versão 2 da tarefa',
        'restaurou a versão 1 como rascunho da tarefa',
        'descartou o rascunho da tarefa',
      ]),
    );
  });

  it('não ativa tarefa nunca publicada nem descarta o único rascunho', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    const r = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/status`, { status: 'ativa' });
    expect(r.statusCode).toBe(409);
    expect(r.json().mensagem).toMatch(/Publique a tarefa/);
    expect((await pedir(a, cookie, 'DELETE', `/tarefas/${det.id}/rascunho`)).statusCode).toBe(409);
    expect((await pedir(a, cookie, 'GET', '/tarefas/tar_nao_existe')).json().mensagem).toBe('Tarefa não encontrada.');
  });

  it('confirmação é sempre obrigatória, mesmo se o corpo pedir o contrário', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie, { ...FICHA_CLIENTE, confirmacao: false as unknown as true });
    expect(det.rascunho?.definicao.confirmacao).toBe(true);
  });
});

describe('pedidos sem tarefa', () => {
  it('lista agrupado por tema e permite ignorar', async () => {
    const { a, cookie } = await preparar();
    pedidoSemTarefa(a.ctx, 'cancelar pedido', 'cancela o pedido 3321');
    pedidoSemTarefa(a.ctx, 'cancelar pedido', 'quero cancelar um pedido');
    pedidoSemTarefa(a.ctx, 'nota fiscal', 'emite a nota do pedido 10');
    const lista = (await pedir(a, cookie, 'GET', '/tarefas')).json<ListaTarefas>();
    expect(lista.semTarefa[0]).toMatchObject({ tema: 'cancelar pedido', quantidade: 2 });
    expect(lista.semTarefa[0].exemplos).toHaveLength(2);

    const r = await pedir(a, cookie, 'POST', '/tarefas/sem-tarefa/ignorar', { tema: 'cancelar pedido' });
    expect(r.statusCode).toBe(200);
    const depois = (await pedir(a, cookie, 'GET', '/tarefas')).json<ListaTarefas>();
    expect(depois.semTarefa.map((p) => p.tema)).toEqual(['nota fiscal']);
    expect(auditorias(a.ctx).at(-1)).toMatchObject({ acao: 'ignorou os pedidos sem tarefa', alvo: 'cancelar pedido' });
  });
});

describe('descrever a tarefa (modelo simulado)', () => {
  it('monta uma ficha razoável a partir da descrição e da API do sistema', async () => {
    const { a, cookie } = await preparar();
    const r = await pedir(a, cookie, 'POST', '/tarefas/descrever', {
      descricao: 'Quero que o copiloto cadastre clientes novos com razão social, CNPJ e e-mail de cobrança. Só Comercial e Financeiro podem.',
    });
    expect(r.statusCode).toBe(200);
    const { definicao } = r.json<{ definicao: TarefaDefinicao }>();
    expect(definicao.nome).toBe('Cadastrar clientes novos');
    expect(definicao.caminho).toBe('api');
    expect(definicao.api).toMatchObject({ metodo: 'POST', caminho: '/v1/clientes' });
    expect(definicao.confirmacao).toBe(true);
    expect(definicao.perfisPermitidos).toEqual(['Comercial', 'Financeiro']);
    expect(definicao.tituloProgresso).toBe('Cadastrando clientes novos');
    expect(definicao.exemplos.length).toBeGreaterThan(0);
    expect(definicao.quandoUsar.length).toBeGreaterThan(20);
  });

  it('recusa descrição curta demais', async () => {
    const { a, cookie } = await preparar();
    const r = await pedir(a, cookie, 'POST', '/tarefas/descrever', { descricao: 'cliente' });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensagem).toMatch(/mais de detalhe/);
  });
});

describe('testes da tarefa', () => {
  const CASOS: Omit<CasoDeTeste, 'id'>[] = [
    { frase: 'cadastra o cliente ACME Logística, CNPJ 12.345.678/0001-90', esperado: { resultado: 'pergunta', campoPerguntado: 'email_cobranca' } },
    { frase: 'apaga o cliente 3190', esperado: { resultado: 'recusa' } },
  ];

  it('salva casos e roda com o agente (dublê), registrando na auditoria', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    expect((await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testes/rodar`, {})).statusCode).toBe(409);

    const salvos = await pedir(a, cookie, 'PUT', `/tarefas/${det.id}/testes`, { casos: CASOS });
    expect(salvos.statusCode).toBe(200);
    const casos = salvos.json<CasoDeTeste[]>();
    expect(casos).toHaveLength(2);
    expect(casos[0].id).toBeTruthy();

    const chamadas: { tarefaId: string; usarRascunho: boolean }[] = [];
    a.ctx.agente.rodarTestes = async (tarefaId, opcoes) => {
      chamadas.push({ tarefaId, usarRascunho: opcoes.usarRascunho });
      const rodada: RodadaTestes = {
        id: 'rod_1',
        tarefaId,
        versao: 1,
        aprovados: 1,
        total: 2,
        criadoEm: new Date().toISOString(),
        resultados: [
          { casoId: casos[0].id, frase: casos[0].frase, aprovado: true, obtido: 'Perguntou o e-mail de cobrança.' },
          { casoId: casos[1].id, frase: casos[1].frase, aprovado: false, obtido: 'Aceitou o pedido.', esperado: 'Deveria recusar.' },
        ],
      };
      a.ctx.banco.inserir('testes_rodadas', {
        id: rodada.id,
        tarefa_id: tarefaId,
        versao: 1,
        aprovados: 1,
        total: 2,
        resultados: rodada.resultados,
        criado_em: rodada.criadoEm,
      });
      return rodada;
    };
    const r = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testes/rodar`, { usarRascunho: true });
    expect(r.statusCode).toBe(200);
    expect(r.json<RodadaTestes>()).toMatchObject({ aprovados: 1, total: 2 });
    expect(chamadas).toEqual([{ tarefaId: det.id, usarRascunho: true }]);
    expect(auditorias(a.ctx).at(-1)).toMatchObject({ acao: 'rodou os testes da tarefa', detalhe: expect.stringMatching(/^1 de 2 aprovados, com o rascunho/) });

    const det2 = (await pedir(a, cookie, 'GET', `/tarefas/${det.id}`)).json<TarefaDetalhe>();
    expect(det2.ultimaRodada?.aprovados).toBe(1);
    expect(det2.testes).toHaveLength(2);
  });

  it('explica quando o agente ainda não roda testes ou falha', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    await pedir(a, cookie, 'PUT', `/tarefas/${det.id}/testes`, { casos: CASOS });

    a.ctx.agente.rodarTestes = async () => {
      throw new Error('não implementado');
    };
    const r = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testes/rodar`, {});
    expect(r.statusCode).toBe(503);
    expect(r.json().mensagem).toMatch(/pré-visualização/);

    a.ctx.agente.rodarTestes = async () => {
      throw new Error('boom');
    };
    const r2 = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testes/rodar`, {});
    expect(r2.statusCode).toBe(502);
    expect(r2.json().mensagem).toMatch(/Nada foi alterado/);
  });

  it('valida os casos', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    const r = await pedir(a, cookie, 'PUT', `/tarefas/${det.id}/testes`, { casos: [{ frase: 'x', esperado: { resultado: 'pergunta' } }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensagem).toMatch(/frase/);
  });
});

describe('testar a chamada da API', () => {
  it('chama o sistema em simulação com dados de exemplo e marca o rascunho como testado', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    const r = await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testar-chamada`, {});
    expect(r.statusCode).toBe(200);
    const res = r.json<{ ok: boolean; status: number; mensagem: string }>();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(res.mensagem).toMatch(/Nada foi gravado/);
    const chamada = a.adaptador.chamadas.at(-1)!;
    expect(chamada.simulacao).toBe(true);
    expect(chamada.metodo).toBe('POST');
    expect(chamada.corpo).toMatchObject({ prazo_pagamento_dias: 15, razao_social: expect.any(String) });
    expect(String((chamada.corpo as Record<string, unknown>).cnpj)).toMatch(/^\d{14}$/);
    expect(a.adaptador.clientes).toHaveLength(1);

    const det2 = (await pedir(a, cookie, 'GET', `/tarefas/${det.id}`)).json<TarefaDetalhe>();
    expect(det2.rascunho?.definicao.api?.testadaEm).toBeTruthy();
    expect(auditorias(a.ctx).at(-1)?.acao).toBe('testou a chamada da API da tarefa');
  });

  it('explica falhas em linguagem de negócio', async () => {
    const { a, cookie } = await preparar();
    const det = await criarTarefa(a, cookie);
    const rota404 = { ...FICHA_CLIENTE, api: { ...FICHA_CLIENTE.api!, caminho: '/v1/clientez' } };
    const r = (await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testar-chamada`, { definicao: rota404 })).json();
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(r.mensagem).toMatch(/Não achei esta rota no Horizonte/);

    a.adaptador.fora = true;
    const fora = (await pedir(a, cookie, 'POST', `/tarefas/${det.id}/testar-chamada`, {})).json();
    expect(fora.ok).toBe(false);
    expect(fora.mensagem).toMatch(/503|Horizonte/);

    const nav = await criarTarefa(a, cookie, { ...FICHA_CLIENTE, nome: 'Emitir boleto', caminho: 'navegador', api: undefined, fluxoId: 'flx_1' });
    expect((await pedir(a, cookie, 'POST', `/tarefas/${nav.id}/testar-chamada`, {})).statusCode).toBe(409);
  });
});

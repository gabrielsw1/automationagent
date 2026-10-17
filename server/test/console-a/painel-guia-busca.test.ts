import { afterEach, describe, expect, it } from 'vitest';
import type { Guia, Painel } from '@copiloto/shared';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';
import { janela } from '../../src/tarefas/tempo.ts';
import { auditorias, execucao, FICHA_CLIENTE, pedidoSemTarefa, pedir } from './dados.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

const DIA = 86400_000;

describe('painel', () => {
  it('soma o período, compara com o anterior e separa por canal', async () => {
    amb = await criarAmbiente();
    const a = amb;
    const { cookie } = entrarComo(a.ctx, 'leitor', 'Bruno Costa');
    const t = a.ctx.catalogo.criar(FICHA_CLIENTE, 'Júlia Martins');
    a.ctx.catalogo.publicar(t.id, 'Júlia Martins', null);
    a.ctx.catalogo.definirStatus(t.id, 'ativa', 'Júlia Martins');

    const agora = Date.now();
    execucao(a.ctx, { tarefa_id: t.id, status: 'concluida', duracao_ms: 4000, custo_modelo: 0.4 });
    execucao(a.ctx, { tarefa_id: t.id, status: 'concluida', duracao_ms: 6000, custo_modelo: 0.6, canal: 'teste' });
    execucao(a.ctx, { tarefa_id: t.id, status: 'falhou', diagnostico: { titulo: 'O botão Salvar mudou de lugar.', detalhe: 'Regrave o passo 4.' } });
    execucao(a.ctx, { tarefa_id: t.id, status: 'cancelada' });
    execucao(a.ctx, { tarefa_id: null, tarefa_nome: 'Emitir boleto', caminho: 'navegador', status: 'concluida', duracao_ms: 40000, criado_em: new Date(agora - 2 * DIA).toISOString() });
    // Período anterior (de 7 dias): duas execuções.
    execucao(a.ctx, { tarefa_id: t.id, status: 'concluida', criado_em: new Date(agora - 9 * DIA).toISOString() });
    execucao(a.ctx, { tarefa_id: t.id, status: 'concluida', criado_em: new Date(agora - 10 * DIA).toISOString() });

    const r = await pedir(a, cookie, 'GET', '/painel?periodo=7d');
    expect(r.statusCode).toBe(200);
    const p = r.json<Painel>();
    expect(p.periodo).toBe('7d');
    expect(p.executadas).toBe(4);
    expect(p.falhas).toBe(1);
    expect(p.taxaSucesso).toBeCloseTo(3 / 4);
    expect(p.variacao).toBeCloseTo(1);
    expect(p.tempoMedioApiS).toBe(5);
    expect(p.tempoMedioNavegadorS).toBe(40);
    expect(p.porDia).toHaveLength(7);
    expect(p.porDia.reduce((s, d) => s + d.concluidas, 0)).toBe(3);
    expect(p.porCanal).toEqual([
      { canal: 'widget', rotulo: 'Widget no sistema', total: 3 },
      { canal: 'teste', rotulo: 'Teste no console', total: 1 },
    ]);
    expect(p.maisUsadas[0]).toMatchObject({ tarefaId: t.id, nome: 'Cadastrar cliente', status: 'ativa', execucoes: 3, custoMedio: 0.47 });
    expect(p.temDadosDeExemplo).toBe(false);
    const falhas = p.atencao.find((i) => i.tipo === 'falhas');
    expect(falhas).toMatchObject({
      titulo: '1 execução falhou em “Cadastrar cliente”',
      detalhe: 'O botão Salvar mudou de lugar. Regrave o passo 4.',
      acao: { rotulo: 'Revisar' },
    });
    expect(falhas?.acao.destino).toContain(`tarefa=${t.id}`);
  });

  it('mostra pedidos sem tarefa, transferidas e dados de exemplo; valida o período', async () => {
    amb = await criarAmbiente();
    const a = amb;
    const { cookie } = entrarComo(a.ctx, 'admin');
    pedidoSemTarefa(a.ctx, 'cancelar pedido', 'cancela o pedido 3321');
    pedidoSemTarefa(a.ctx, 'cancelar pedido', 'cancela o pedido 3322');
    execucao(a.ctx, { status: 'em_andamento', transferida_para: 'Suporte', exemplo: 1 });
    const p = (await pedir(a, cookie, 'GET', '/painel')).json<Painel>();
    expect(p.periodo).toBe('30d');
    expect(p.porDia).toHaveLength(30);
    expect(p.temDadosDeExemplo).toBe(true);
    expect(p.atencao.map((i) => i.tipo)).toEqual(['sem_tarefa', 'transferidas']);
    expect(p.atencao[0]).toMatchObject({ titulo: '2 pedidos sobre “cancelar pedido” sem tarefa', acao: { rotulo: 'Criar tarefa', destino: '/tarefas?criar=cancelar%20pedido' } });
    expect((await pedir(a, cookie, 'GET', '/painel?periodo=ano')).statusCode).toBe(400);
  });

  it('janela do mês compara com o mesmo trecho do mês anterior', () => {
    const j = janela('mes', new Date('2026-10-17T15:00:00-03:00'));
    expect(j.dias[0]).toBe('2026-10-01');
    expect(j.dias.at(-1)).toBe('2026-10-17');
    expect(j.anteriorInicio.toISOString()).toBe(new Date('2026-09-01T00:00:00-03:00').toISOString());
  });
});

describe('guia de início', () => {
  it('calcula os passos e só confirma o widget depois de visto', async () => {
    amb = await criarAmbiente();
    const a = amb;
    const { cookie } = entrarComo(a.ctx, 'editor', 'Júlia Martins');
    const g = (await pedir(a, cookie, 'GET', '/guia')).json<Guia>();
    expect(g.total).toBe(5);
    expect(g.passos.map((p) => p.chave)).toEqual(['sistema', 'tarefa', 'testes', 'widget', 'equipe']);
    expect(g.passos[0].feito).toBe(true);

    const nao = await pedir(a, cookie, 'POST', '/guia/widget-verificado');
    expect(nao.statusCode).toBe(409);
    expect(nao.json().mensagem).toMatch(/Ainda não vimos o widget no Horizonte/);

    a.ctx.configuracoes.gravar('widget_instalacao', { origem: 'https://app.horizonte.com.br', vistoEm: new Date().toISOString() }, null);
    const sim = await pedir(a, cookie, 'POST', '/guia/widget-verificado');
    expect(sim.statusCode).toBe(200);
    expect(sim.json<Guia>().passos.find((p) => p.chave === 'widget')?.feito).toBe(true);
    expect(auditorias(a.ctx).at(-1)).toMatchObject({ acao: 'confirmou a instalação do widget', alvo: 'https://app.horizonte.com.br' });

    const leitor = entrarComo(a.ctx, 'leitor', 'Bruno Costa');
    expect((await pedir(a, leitor.cookie, 'POST', '/guia/widget-verificado')).statusCode).toBe(403);
  });
});

describe('busca no console', () => {
  it('acha tarefas, execuções, pessoas e páginas sem ligar para acentos', async () => {
    amb = await criarAmbiente();
    const a = amb;
    const { cookie } = entrarComo(a.ctx, 'leitor', 'Bruno Costa');
    const t = a.ctx.catalogo.criar(FICHA_CLIENTE, 'Júlia Martins');
    const ex = execucao(a.ctx, { tarefa_id: t.id, usuario_nome: 'Ana Ribeiro', pedido: 'cadastra a ACME Logística' });

    const itens = (await pedir(a, cookie, 'GET', '/busca?q=cadastrar')).json<{ itens: { tipo: string; destino: string }[] }>().itens;
    expect(itens.find((i) => i.tipo === 'tarefa')?.destino).toBe(`/tarefas/${t.id}`);

    const porCodigo = (await pedir(a, cookie, 'GET', `/busca?q=${ex}`)).json<{ itens: { tipo: string; destino: string }[] }>().itens;
    expect(porCodigo[0]).toMatchObject({ tipo: 'execucao', destino: `/execucoes/${ex}` });

    const logistica = (await pedir(a, cookie, 'GET', '/busca?q=logistica')).json<{ itens: { tipo: string }[] }>().itens;
    expect(logistica.some((i) => i.tipo === 'execucao')).toBe(true);

    execucao(a.ctx, { usuario_nome: 'Júlia Martins' });
    const julia = (await pedir(a, cookie, 'GET', '/busca?q=julia')).json<{ itens: { tipo: string; titulo: string }[] }>().itens;
    expect(julia.some((i) => i.tipo === 'pessoa' && i.titulo === 'Júlia Martins')).toBe(true);

    const pessoa = (await pedir(a, cookie, 'GET', '/busca?q=ana%20rib')).json<{ itens: { tipo: string; titulo: string }[] }>().itens;
    expect(pessoa.some((i) => i.tipo === 'pessoa' && i.titulo === 'Ana Ribeiro')).toBe(true);

    const pagina = (await pedir(a, cookie, 'GET', '/busca?q=limites')).json<{ itens: { tipo: string; destino: string }[] }>().itens;
    expect(pagina).toContainEqual(expect.objectContaining({ tipo: 'pagina', destino: '/equipe' }));

    expect((await pedir(a, cookie, 'GET', '/busca?q=a')).json().itens).toEqual([]);
  });
});

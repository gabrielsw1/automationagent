import { afterEach, describe, expect, it } from 'vitest';
import type { ExecucaoDetalhe, ListaExecucoes, TarefaDefinicao } from '@copiloto/shared';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';
import { criarAprovacao, criarEvento, criarExecucao, criarPrint } from './dados.ts';
import type { Ator } from '../../src/execucao/motor.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

const DEF: TarefaDefinicao = {
  nome: 'Agendar visita técnica',
  descricao: 'Agenda uma visita',
  quandoUsar: 'Quando pedirem uma visita',
  exemplos: [],
  campos: [
    { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, pergunta: 'Qual cliente?' },
    { chave: 'data_visita', rotulo: 'Data da visita', tipo: 'data', obrigatorio: true, pergunta: 'Que dia?' },
    { chave: 'responsavel', rotulo: 'Responsável', tipo: 'pessoa', obrigatorio: true, pergunta: 'Quem?' },
  ],
  caminho: 'navegador',
  fluxoId: 'flx_agendar',
  usarFluxoSeApiFalhar: false,
  confirmacao: true,
  desfazerMinutos: 0,
  perfisPermitidos: [],
  tituloRecibo: 'Visita agendada',
  tituloConfirmacao: 'Confirme a visita',
  proximosPassos: [],
  contextos: [],
  confiancaMinima: 0.85,
};

async function pedir(a: Ambiente, cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return a.app.inject({ method, url: `/api/console${url}`, headers: { cookie }, payload: payload as object });
}

describe('lista de execuções', () => {
  it('exige sessão e deixa o leitor ver', async () => {
    amb = await criarAmbiente();
    const sem = await amb.app.inject({ method: 'GET', url: '/api/console/execucoes' });
    expect(sem.statusCode).toBe(401);
    const { cookie } = entrarComo(amb.ctx, 'leitor', 'Bruno Costa');
    criarExecucao(amb.ctx);
    const r = await pedir(amb, cookie, 'GET', '/execucoes');
    expect(r.statusCode).toBe(200);
    const lista = r.json<ListaExecucoes>();
    expect(lista.linhas).toHaveLength(1);
    expect(lista.linhas[0]).toMatchObject({
      usuario: { nome: 'Ana Ribeiro', iniciais: 'AR' },
      tarefa: { nome: 'Cadastrar cliente' },
      caminho: 'api',
      status: 'concluida',
      canal: 'widget',
      duracaoMs: 4000,
      custo: 0.4,
      exemplo: false,
    });
  });

  it('pagina de 10 em 10, do mais novo para o mais antigo', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const base = Date.now() - 3600_000;
    for (let i = 0; i < 25; i++) {
      criarExecucao(amb.ctx, { id: `EX-${30000 + i}`, criado_em: new Date(base + i * 60_000).toISOString() });
    }
    const p1 = (await pedir(amb, cookie, 'GET', '/execucoes')).json<ListaExecucoes>();
    expect(p1).toMatchObject({ total: 25, pagina: 1, paginas: 3, totalGeral: 25 });
    expect(p1.linhas).toHaveLength(10);
    expect(p1.linhas[0].id).toBe('EX-30024');
    const p3 = (await pedir(amb, cookie, 'GET', '/execucoes?pagina=3')).json<ListaExecucoes>();
    expect(p3.linhas.map((l) => l.id)).toEqual(['EX-30004', 'EX-30003', 'EX-30002', 'EX-30001', 'EX-30000']);
    const alem = (await pedir(amb, cookie, 'GET', '/execucoes?pagina=99')).json<ListaExecucoes>();
    expect(alem.pagina).toBe(3);
  });

  it('filtra por status, canal, tarefa, período e busca sem acento', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'suporte', 'Camila Souza');
    const ontem = new Date(Date.now() - 3 * 86400_000).toISOString();
    criarExecucao(amb.ctx, { id: 'EX-1', status: 'falhou', pedido: 'agenda visita na Metalúrgica Sul', tarefa_id: 'tar_agendar', tarefa_nome: 'Agendar visita técnica' });
    criarExecucao(amb.ctx, { id: 'EX-2', canal: 'teste', usuario_nome: 'Paula Nunes', usuario_id: '103' });
    criarExecucao(amb.ctx, { id: 'EX-3', criado_em: ontem, pedido: 'relatório de vendas', tarefa_id: 'tar_rel', tarefa_nome: 'Emitir relatório de vendas' });

    const ids = async (q: string) =>
      (await pedir(amb!, cookie, 'GET', `/execucoes?${q}`)).json<ListaExecucoes>().linhas.map((l) => l.id).sort();

    expect(await ids('status=falhou')).toEqual(['EX-1']);
    expect(await ids('canal=teste')).toEqual(['EX-2']);
    expect(await ids('tarefa=tar_rel')).toEqual(['EX-3']);
    expect(await ids('periodo=hoje')).toEqual(['EX-1', 'EX-2']);
    expect(await ids('periodo=7d')).toEqual(['EX-1', 'EX-2', 'EX-3']);
    expect(await ids('busca=metalurgica')).toEqual(['EX-1']);
    expect(await ids('busca=PAULA')).toEqual(['EX-2']);
    expect(await ids('busca=ex-3')).toEqual(['EX-3']);
    expect(await ids('busca=100%25')).toEqual([]);
    expect(await ids('status=&canal=&periodo=')).toEqual(['EX-1', 'EX-2', 'EX-3']);

    const filtrada = (await pedir(amb, cookie, 'GET', '/execucoes?status=falhou')).json<ListaExecucoes>();
    expect(filtrada.total).toBe(1);
    expect(filtrada.totalGeral).toBe(3);

    const ruim = await pedir(amb, cookie, 'GET', '/execucoes?status=inventado');
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().mensagem).toContain('filtro');
  });

  it('abas de atenção e aprovação, com contagens', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const camila = entrarComo(amb.ctx, 'suporte', 'Camila Souza');
    const antigo = new Date(Date.now() - 5 * 86400_000).toISOString();
    criarExecucao(amb.ctx, { id: 'EX-10', status: 'falhou' });
    criarExecucao(amb.ctx, { id: 'EX-11', status: 'falhou', criado_em: antigo });
    criarExecucao(amb.ctx, { id: 'EX-12', status: 'falhou', criado_em: antigo, transferida_para: 'Camila Souza' });
    criarExecucao(amb.ctx, { id: 'EX-13', status: 'concluida', transferida_para: camila.membroId });
    const aguardando = criarExecucao(amb.ctx, { id: 'EX-14', status: 'aguardando_aprovacao' });
    criarAprovacao(amb.ctx, aguardando);
    criarAprovacao(amb.ctx, criarExecucao(amb.ctx, { id: 'EX-15' }), 'aprovada');

    const atencao = (await pedir(amb, cookie, 'GET', '/execucoes?aba=atencao')).json<ListaExecucoes>();
    expect(atencao.linhas.map((l) => l.id).sort()).toEqual(['EX-10', 'EX-12']);
    expect(atencao.linhas.find((l) => l.id === 'EX-12')!.transferidaPara).toBe('Camila Souza');
    expect(atencao.contagem).toEqual({ todas: 6, atencao: 2, aprovacao: 1 });

    const aprov = (await pedir(amb, cookie, 'GET', '/execucoes?aba=aprovacao')).json<ListaExecucoes>();
    expect(aprov.linhas.map((l) => l.id)).toEqual(['EX-14']);

    // A contagem da aba é a mesma do menu lateral.
    const resumo = (await pedir(amb, cookie, 'GET', '/resumo')).json();
    expect(resumo.execucoesAtencao).toBe(atencao.contagem.atencao);
    expect(resumo.aprovacoesPendentes).toBe(atencao.contagem.aprovacao);
  });

  it('mostra a duração ao vivo e soma o custo do modelo pelo uso registrado', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'admin');
    criarExecucao(amb.ctx, {
      id: 'EX-50',
      status: 'em_andamento',
      iniciado_em: new Date(Date.now() - 38_000).toISOString(),
      duracao_ms: null,
      custo_modelo: null,
      caminho: 'navegador',
    });
    amb.ctx.gastos.registrarUso(
      { modelo: 'claude-opus-5-5', entrada: 1, saida: 1, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0.5 },
      { finalidade: 'agente', execucaoId: 'EX-50' },
    );
    const l = (await pedir(amb, cookie, 'GET', '/execucoes')).json<ListaExecucoes>().linhas[0];
    expect(l.duracaoMs).toBeGreaterThanOrEqual(38_000);
    expect(l.duracaoMs).toBeLessThan(45_000);
    expect(l.custo).toBeCloseTo(0.5 * amb.config.cotacaoDolar, 2);
  });

  it('lista as tarefas do filtro', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'leitor');
    const t = amb.ctx.catalogo.criar(DEF, 'Rafael Lima');
    criarExecucao(amb.ctx, { tarefa_id: 'tar_x', tarefa_nome: 'Emitir relatório de vendas' });
    const r = (await pedir(amb, cookie, 'GET', '/execucoes/filtros')).json();
    expect(r.tarefas).toEqual([
      { id: t.id, nome: 'Agendar visita técnica' },
      { id: 'tar_x', nome: 'Emitir relatório de vendas' },
    ]);
  });
});

describe('exportar CSV', () => {
  it('usa ponto e vírgula, BOM e os mesmos filtros', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'leitor');
    criarExecucao(amb.ctx, { id: 'EX-1', pedido: 'cadastra a "ACME"; prazo 30', custo_modelo: 0.4, custo_navegador: 3.5, duracao_ms: 72_000, caminho: 'navegador' });
    criarExecucao(amb.ctx, { id: 'EX-2', status: 'falhou', exemplo: 1 });
    const r = await pedir(amb, cookie, 'GET', '/execucoes/exportar.csv');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="execucoes-\d{4}-\d{2}-\d{2}\.csv"/);
    const corpo = r.body;
    expect(corpo.charCodeAt(0)).toBe(0xfeff);
    const linhas = corpo.slice(1).trim().split('\r\n');
    expect(linhas[0]).toBe(
      'ID;Data;Hora;Pedido;Usuário;ID do usuário;Tarefa;Caminho;Status;Transferida para;Canal;Duração (s);Custo (R$);Dados de exemplo',
    );
    expect(linhas).toHaveLength(3);
    const ex1 = linhas.find((l) => l.startsWith('EX-1;'))!;
    expect(ex1).toContain('"cadastra a ""ACME""; prazo 30"');
    expect(ex1).toContain(';Navegador;Concluída;;Widget;72,0;3,90;Não');
    expect(linhas.find((l) => l.startsWith('EX-2;'))).toContain(';Falhou;');

    const so = await pedir(amb, cookie, 'GET', '/execucoes/exportar.csv?status=falhou');
    expect(so.body.trim().split('\r\n')).toHaveLength(2);
  });
});

describe('detalhe da execução', () => {
  it('404 para execução que não existe', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'leitor');
    const r = await pedir(amb, cookie, 'GET', '/execucoes/EX-404');
    expect(r.statusCode).toBe(404);
    expect(r.json().mensagem).toBe('Execução não encontrado.');
  });

  it('monta linha do tempo, prints, dados, conversa, auditoria e custos', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'leitor');
    const ctx = amb.ctx;
    const camila = entrarComo(ctx, 'suporte', 'Camila Souza');
    const tarefa = ctx.catalogo.criar(DEF, 'Rafael Lima');
    ctx.catalogo.publicar(tarefa.id, 'Rafael Lima', null);
    const conversa = ctx.conversas.criar({ usuarioId: '101', usuarioNome: 'Ana Ribeiro', canal: 'widget' });
    ctx.conversas.adicionar(conversa.id, { autor: 'usuario', texto: 'oi' });
    const pedido = 'agenda visita técnica para a ACME Logística na quinta';
    await new Promise((r) => setTimeout(r, 5));
    ctx.conversas.adicionar(conversa.id, { autor: 'usuario', texto: pedido });
    const id = criarExecucao(ctx, {
      id: 'EX-20417',
      conversa_id: conversa.id,
      tarefa_id: tarefa.id,
      tarefa_nome: 'Agendar visita técnica',
      tarefa_versao: 1,
      pedido,
      caminho: 'navegador',
      status: 'falhou',
      criado_em: new Date().toISOString(),
      dados: { cliente: 'ACME Logística', data_visita: '2026-10-22', responsavel: '105', extra_info: 'sim' },
      custo_modelo: 3.1,
      custo_navegador: 0.8,
      duracao_ms: 72_000,
      confirmado_por: '101',
      confirmado_em: '2026-10-17T13:41:52.000Z',
      ip: '189.6.12.34',
      transferida_para: camila.membroId,
      transferida_em: '2026-10-17T13:42:59.000Z',
      diagnostico: { titulo: 'A tela de agendamento mudou e nada foi gravado.', detalhe: 'O botão mudou de nome.', tom: 'erro' },
    });
    ctx.conversas.adicionar(conversa.id, {
      autor: 'copiloto',
      texto: 'Vou agendar uma visita. **Confere?**',
      blocos: [
        {
          tipo: 'confirmacao',
          execucaoId: id,
          tarefa: 'agendar_visita',
          titulo: 'Confirme a visita',
          campos: [],
          caminho: 'navegador',
          tempoEstimado: 'cerca de 1 min',
          desfazerMinutos: 0,
          estado: 'confirmado',
          confirmadoEm: new Date(Date.now() + 1000).toISOString(),
        },
      ],
    });
    criarPrint(ctx, id, { id: 'prt_1' });
    criarPrint(ctx, id, { id: 'prt_2', legenda: 'botão destacado pelo agente', destaque: { x: 0.7, y: 0.8, w: 0.1, h: 0.05 } });
    criarEvento(ctx, id, { ts: '2026-10-17T13:41:47.000Z', tipo: 'pedido', titulo: 'Pedido recebido', estado: 'ok' });
    criarEvento(ctx, id, {
      ts: '2026-10-17T13:41:52.000Z',
      tipo: 'confirmacao',
      titulo: 'Dados confirmados',
      estado: 'ok',
      dados: [{ rotulo: 'Cliente', valor: 'ACME Logística' }],
    });
    criarEvento(ctx, id, { ts: '2026-10-17T13:42:06.000Z', tipo: 'passo', titulo: 'Abrir Agenda', estado: 'ok', print_id: 'prt_1' });
    criarEvento(ctx, id, {
      ts: '2026-10-17T13:42:24.000Z',
      tipo: 'recuperacao',
      titulo: 'Recuperação visual tentou 2 vezes',
      estado: 'aviso',
      candidato: { texto: 'Salvar visita', confianca: 0.58 },
      print_id: 'prt_2',
      fim: '2026-10-17T13:42:51.000Z',
    });
    criarEvento(ctx, id, { ts: '2026-10-17T13:42:21.000Z', tipo: 'falha', titulo: 'Clicar em “Confirmar agendamento”', estado: 'falhou', detalhe: 'Botão não encontrado' });
    ctx.gastos.registrarUso(
      { modelo: 'claude-opus-5-5', entrada: 1, saida: 1, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 99 },
      { finalidade: 'agente', execucaoId: id },
    );

    const r = await pedir(amb, cookie, 'GET', `/execucoes/${id}`);
    expect(r.statusCode).toBe(200);
    const d = r.json<ExecucaoDetalhe>();
    expect(d.diagnostico).toEqual({ titulo: 'A tela de agendamento mudou e nada foi gravado.', detalhe: 'O botão mudou de nome.', tom: 'erro' });
    expect(d.linha.transferidaPara).toBe('Camila Souza');
    expect(d.linhaTempo.map((e) => e.tipo)).toEqual(['pedido', 'confirmacao', 'passo', 'falha', 'recuperacao']);
    expect(d.linhaTempo[1].dados).toEqual([{ rotulo: 'Cliente', valor: 'ACME Logística' }]);
    expect(d.linhaTempo[2].print).toEqual({ id: 'prt_1', legenda: 'Print 1 de 2 · dados mascarados', url: '/api/console/prints/prt_1' });
    expect(d.linhaTempo[4].print).toMatchObject({
      legenda: 'Print 2 de 2 · botão destacado pelo agente',
      destaque: { x: 0.7, y: 0.8, w: 0.1, h: 0.05 },
    });
    expect(d.linhaTempo[4].candidato).toEqual({ texto: 'Salvar visita', confianca: 0.58 });
    expect(d.linhaTempo[4].fim).toBe('2026-10-17T13:42:51.000Z');
    expect(d.dados).toEqual([
      { rotulo: 'Cliente', valor: 'ACME Logística' },
      { rotulo: 'Data da visita', valor: '22/10/2026' },
      { rotulo: 'Responsável', valor: 'Rafael Lima' },
      { rotulo: 'Extra info', valor: 'sim' },
    ]);
    // Custo: usa as colunas em R$ (o uso_llm não é somado de novo).
    expect(d.custoModelo).toBe(3.1);
    expect(d.custoNavegador).toBe(0.8);
    expect(d.linha.custo).toBe(3.9);
    expect(d.tarefaVersao).toBe(1);
    expect(d.fluxoId).toBe('flx_agendar');
    expect(d.acoes).toEqual({
      reexecutar: true,
      concluir: true,
      avisar: true,
      atualizarFluxo: true,
      desfazer: false,
      responder: false,
    });
    // Conversa: começa no pedido (não traz o "oi" anterior) e inclui o toque em confirmar.
    expect(d.conversa.map((m) => m.autorTipo)).toEqual(['usuario', 'copiloto', 'usuario']);
    expect(d.conversa[0].texto).toBe(pedido);
    expect(d.conversa[1].texto).toBe('Vou agendar uma visita. Confere?\nCartão de confirmação exibido: Confirme a visita');
    expect(d.conversa[2].texto).toBe('Tocou em “Confirmar e executar”');
    expect(d.conversaId).toBe(conversa.id);
    expect(d.estadoConversa).toBe('copiloto');
    const aud = Object.fromEntries(d.auditoria.map((a) => [a.rotulo, a.valor]));
    expect(aud['Confirmado por']).toBe('Ana Ribeiro');
    expect(aud['Quando']).toBe('17/10/2026, 10:41:52');
    expect(aud['IP']).toBe('189.6.•••.•••');
    expect(aud['Permissões']).toBe('As de Ana (perfil Atendimento, Comercial)');
    expect(aud['Retenção']).toMatch(/^Prints apagados em \d{2}\/\d{2}\/\d{4}$/);
    expect(d.aprovacao).toBeNull();
  });

  it('monta a frase de diagnóstico pelo status quando não há uma gravada', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'leitor');
    const ok = criarExecucao(amb.ctx, { status: 'concluida', duracao_ms: 4000 });
    const andando = criarExecucao(amb.ctx, { status: 'em_andamento' });
    const aprov = criarExecucao(amb.ctx, { status: 'aguardando_aprovacao' });
    criarAprovacao(amb.ctx, aprov);
    const get = async (id: string) => (await pedir(amb!, cookie, 'GET', `/execucoes/${id}`)).json<ExecucaoDetalhe>();
    expect((await get(ok)).diagnostico).toMatchObject({ titulo: 'Concluída sem erros.', tom: 'sucesso' });
    expect((await get(ok)).diagnostico!.detalhe).toContain('Feito pela API em 4 s.');
    expect((await get(andando)).diagnostico).toMatchObject({ tom: 'info' });
    const dAprov = await get(aprov);
    expect(dAprov.diagnostico).toMatchObject({ titulo: 'Esperando a aprovação de Rafael Lima.', tom: 'aviso' });
    expect(dAprov.aprovacao).toMatchObject({ estado: 'enviada', aprovador: 'Rafael Lima' });
  });
});

describe('ações sobre a execução', () => {
  it('reexecutar: leitor não pode, suporte pode, e fica no registro', async () => {
    amb = await criarAmbiente();
    const ctx = amb.ctx;
    const id = criarExecucao(ctx, { status: 'falhou' });
    const chamadas: [string, Ator][] = [];
    ctx.motor.reexecutar = async (execId: string, por: Ator) => {
      chamadas.push([execId, por]);
      return 'EX-99999';
    };
    const leitor = entrarComo(ctx, 'leitor', 'Bruno Costa');
    expect((await pedir(amb, leitor.cookie, 'POST', `/execucoes/${id}/reexecutar`)).statusCode).toBe(403);
    const editor = entrarComo(ctx, 'editor', 'Júlia Martins');
    expect((await pedir(amb, editor.cookie, 'POST', `/execucoes/${id}/reexecutar`)).statusCode).toBe(403);
    const suporte = entrarComo(ctx, 'suporte', 'Camila Souza');
    const r = await pedir(amb, suporte.cookie, 'POST', `/execucoes/${id}/reexecutar`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: 'EX-99999' });
    expect(chamadas).toEqual([[id, { tipo: 'membro', id: suporte.membroId, nome: 'Camila Souza' }]]);
    expect(ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Camila Souza', acao: 'reexecutou', alvo: id, detalhe: 'Nova execução EX-99999' });
  });

  it('não reexecuta o que já deu certo', async () => {
    amb = await criarAmbiente();
    const id = criarExecucao(amb.ctx, { status: 'concluida' });
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const r = await pedir(amb, cookie, 'POST', `/execucoes/${id}/reexecutar`);
    expect(r.statusCode).toBe(409);
  });

  it('concluir manualmente com nota', async () => {
    amb = await criarAmbiente();
    const ctx = amb.ctx;
    const id = criarExecucao(ctx, { status: 'falhou' });
    let recebido: unknown[] = [];
    ctx.motor.concluirManual = async (...args: unknown[]) => {
      recebido = args;
    };
    const { cookie } = entrarComo(ctx, 'suporte', 'Camila Souza');
    const r = await pedir(amb, cookie, 'POST', `/execucoes/${id}/concluir`, { nota: 'Agendei por telefone' });
    expect(r.statusCode).toBe(200);
    expect(recebido[0]).toBe(id);
    expect(recebido[2]).toBe('Agendei por telefone');
    expect(ctx.auditoria.listar()[0]).toMatchObject({ acao: 'marcou como concluída', detalhe: 'Agendei por telefone' });
  });

  it('desfazer só para Admin', async () => {
    amb = await criarAmbiente();
    const ctx = amb.ctx;
    const id = criarExecucao(ctx, { status: 'concluida', desfazer_ate: new Date(Date.now() + 60_000).toISOString() });
    let desfeito = '';
    ctx.motor.desfazer = async (execId: string) => {
      desfeito = execId;
    };
    const suporte = entrarComo(ctx, 'suporte', 'Camila Souza');
    expect((await pedir(amb, suporte.cookie, 'POST', `/execucoes/${id}/desfazer`)).statusCode).toBe(403);
    const admin = entrarComo(ctx, 'admin', 'Rafael Lima');
    expect((await pedir(amb, admin.cookie, 'POST', `/execucoes/${id}/desfazer`)).statusCode).toBe(200);
    expect(desfeito).toBe(id);
    expect(ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Rafael Lima', acao: 'desfez', alvo: id });
  });

  it('avisar o usuário valida o texto e usa o atendimento', async () => {
    amb = await criarAmbiente();
    const ctx = amb.ctx;
    const conversa = ctx.conversas.criar({ usuarioId: '101', usuarioNome: 'Ana Ribeiro', canal: 'widget' });
    const id = criarExecucao(ctx, { status: 'falhou', conversa_id: conversa.id });
    const semConversa = criarExecucao(ctx, { status: 'falhou' });
    const avisos: string[] = [];
    ctx.atendimento.avisarUsuario = (_e, _m, texto) => {
      avisos.push(texto);
    };
    const { cookie } = entrarComo(ctx, 'suporte', 'Camila Souza');
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${id}/avisar`, { texto: '  ' })).statusCode).toBe(400);
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${semConversa}/avisar`, { texto: 'oi' })).statusCode).toBe(409);
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${id}/avisar`, { texto: 'Já resolvi!' })).statusCode).toBe(200);
    expect(avisos).toEqual(['Já resolvi!']);
  });

  it('assumir, responder e encerrar o atendimento da conversa', async () => {
    amb = await criarAmbiente();
    const ctx = amb.ctx;
    const conversa = ctx.conversas.criar({ usuarioId: '101', usuarioNome: 'Ana Ribeiro', canal: 'widget' });
    const id = criarExecucao(ctx, { status: 'falhou', conversa_id: conversa.id });
    const feito: string[] = [];
    ctx.atendimento.assumir = (c) => {
      feito.push(`assumir:${c}`);
      ctx.conversas.definirEstado(c, { modo: 'pessoa', atendente: { nome: 'Camila Souza', iniciais: 'CS', papel: 'Suporte' } });
    };
    ctx.atendimento.responder = (c, _m, t) => {
      feito.push(`responder:${c}:${t}`);
    };
    ctx.atendimento.encerrar = (c) => {
      feito.push(`encerrar:${c}`);
      ctx.conversas.definirEstado(c, { modo: 'copiloto' });
    };
    const { cookie } = entrarComo(ctx, 'suporte', 'Camila Souza');
    // Ninguém pediu uma pessoa ainda.
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${id}/assumir`)).statusCode).toBe(409);
    ctx.conversas.definirEstado(conversa.id, { modo: 'aguardando_pessoa', resumoEnviado: true });
    let d = (await pedir(amb, cookie, 'GET', `/execucoes/${id}`)).json<ExecucaoDetalhe>();
    expect(d.estadoConversa).toBe('aguardando_pessoa');
    expect(d.acoes.responder).toBe(true);
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${id}/assumir`)).statusCode).toBe(200);
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${id}/responder`, { texto: 'Oi, Ana!' })).statusCode).toBe(200);
    d = (await pedir(amb, cookie, 'GET', `/execucoes/${id}`)).json<ExecucaoDetalhe>();
    expect(d.estadoConversa).toBe('pessoa');
    expect((await pedir(amb, cookie, 'POST', `/execucoes/${id}/encerrar-atendimento`)).statusCode).toBe(200);
    expect(feito).toEqual([`assumir:${conversa.id}`, `responder:${conversa.id}:Oi, Ana!`, `encerrar:${conversa.id}`]);
    const acoes = ctx.auditoria.listar().map((a) => a.acao);
    expect(acoes).toEqual(expect.arrayContaining(['assumiu o atendimento', 'respondeu no atendimento', 'encerrou o atendimento']));
  });

  it('aprovar e recusar pedidos de aprovação', async () => {
    amb = await criarAmbiente();
    const ctx = amb.ctx;
    const exec = criarExecucao(ctx, { status: 'aguardando_aprovacao' });
    const aprovacao = criarAprovacao(ctx, exec);
    const decidida = criarAprovacao(ctx, criarExecucao(ctx), 'aprovada');
    const decisoes: unknown[][] = [];
    ctx.motor.decidirAprovacao = async (...args: unknown[]) => {
      decisoes.push(args);
    };
    const leitor = entrarComo(ctx, 'leitor', 'Bruno Costa');
    expect((await pedir(amb, leitor.cookie, 'POST', `/execucoes/aprovacoes/${aprovacao}/decidir`, { aprovado: true })).statusCode).toBe(403);
    const { cookie, membroId } = entrarComo(ctx, 'suporte', 'Camila Souza');
    expect((await pedir(amb, cookie, 'POST', '/execucoes/aprovacoes/apr_x/decidir', { aprovado: true })).statusCode).toBe(404);
    expect((await pedir(amb, cookie, 'POST', `/execucoes/aprovacoes/${decidida}/decidir`, { aprovado: true })).statusCode).toBe(409);
    expect((await pedir(amb, cookie, 'POST', `/execucoes/aprovacoes/${aprovacao}/decidir`, {})).statusCode).toBe(400);
    const r = await pedir(amb, cookie, 'POST', `/execucoes/aprovacoes/${aprovacao}/decidir`, { aprovado: false, motivo: 'Fora da política' });
    expect(r.statusCode).toBe(200);
    expect(decisoes).toEqual([[aprovacao, { tipo: 'membro', id: membroId, nome: 'Camila Souza' }, false, 'Fora da política']]);
    expect(ctx.auditoria.listar()[0]).toMatchObject({
      acao: 'recusou o pedido',
      alvo: exec,
      detalhe: 'Pedido de Ana Ribeiro. Motivo: Fora da política',
    });
  });
});

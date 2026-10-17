// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ExecucaoDetalhe, ExecucaoLinha, ListaExecucoes as Lista } from '@copiloto/shared';
import ListaExecucoes, { textoDuracao } from '../../src/paginas/execucoes/ListaExecucoes.tsx';
import DetalheExecucao from '../../src/paginas/execucoes/DetalheExecucao.tsx';
import { EventSourceFalso, instalarEventSource, instalarFetch, local, renderizar } from './ambiente.tsx';

function linha(parcial: Partial<ExecucaoLinha> = {}): ExecucaoLinha {
  return {
    id: 'EX-20431',
    inicio: new Date().toISOString(),
    pedido: 'Agendar visita para a Padaria Bom Pão amanhã às 10h',
    usuario: { id: 'u1', nome: 'Ana Ribeiro', iniciais: 'AR' },
    tarefa: { id: 't1', nome: 'Agendar visita' },
    caminho: 'navegador',
    status: 'falhou',
    transferidaPara: null,
    canal: 'widget',
    duracaoMs: 42_000,
    custo: 0.38,
    exemplo: true,
    ...parcial,
  };
}

function lista(parcial: Partial<Lista> = {}): Lista {
  const linhas = parcial.linhas ?? [linha(), linha({ id: 'EX-20430', status: 'concluida', caminho: 'api', pedido: 'Qual o prazo de entrega?' })];
  return {
    linhas,
    total: 1284,
    pagina: 1,
    paginas: 129,
    totalGeral: 1284,
    contagem: { todas: 1284, atencao: 3, aprovacao: 2 },
    ...parcial,
  };
}

function detalhe(parcial: Partial<ExecucaoDetalhe> = {}): ExecucaoDetalhe {
  return {
    linha: linha(),
    diagnostico: { titulo: 'A tela de agendamento mudou e nada foi gravado.', detalhe: 'O botão “Salvar visita” sumiu.', tom: 'erro' },
    linhaTempo: [
      { id: 'e1', ts: '2026-10-17T13:41:50.000Z', tipo: 'pedido', titulo: 'Pedido recebido', estado: 'ok' },
      {
        id: 'e2',
        ts: '2026-10-17T13:42:10.000Z',
        tipo: 'falha',
        titulo: 'Não achou o botão “Salvar visita”',
        estado: 'falhou',
        print: { id: 'p1', legenda: 'Print 1 de 1 · dados mascarados', url: '/api/console/prints/p1', destaque: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
        candidato: { texto: 'Gravar agendamento', confianca: 0.62 },
      },
    ],
    tarefaVersao: 4,
    custoModelo: 0.12,
    custoNavegador: 0.26,
    dados: [{ rotulo: 'Cliente', valor: 'Padaria Bom Pão' }],
    conversa: [{ id: 'm1', autor: 'Ana Ribeiro', autorTipo: 'usuario', texto: 'Agendar visita', ts: '2026-10-17T13:41:40.000Z' }],
    conversaId: 'c1',
    estadoConversa: 'copiloto',
    auditoria: [{ rotulo: 'Confirmado por', valor: 'Ana Ribeiro' }],
    acoes: { reexecutar: true, concluir: true, avisar: true, atualizarFluxo: true, desfazer: false, responder: false },
    fluxoId: 'f1',
    aprovacao: null,
    ...parcial,
  };
}

beforeEach(() => {
  instalarEventSource();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('textoDuracao', () => {
  it('mostra a duração final ou ao vivo', () => {
    expect(textoDuracao(linha({ duracaoMs: 42_000, status: 'concluida' }), 0).muted).toBe(false);
    expect(textoDuracao(linha({ duracaoMs: null, status: 'cancelada' }), 0)).toEqual({ texto: '—', muted: true });
    const vivo = textoDuracao(linha({ duracaoMs: 10_000, status: 'em_andamento' }), 5_000);
    expect(vivo.muted).toBe(true);
    expect(vivo.texto).toMatch(/até agora$/);
    expect(vivo.texto).toContain('15');
  });
});

describe('C5 · Lista de execuções', () => {
  it('mostra abas com contagem, linhas, paginação e exportação com os filtros', async () => {
    const { pedidos } = instalarFetch({
      'GET /execucoes': lista(),
      'GET /execucoes/filtros': { tarefas: [{ id: 't1', nome: 'Agendar visita' }] },
    });
    renderizar(<ListaExecucoes />, { caminho: '/execucoes?status=falhou' });
    expect(await screen.findByText('1–10 de 1.284 execuções · dados de exemplo')).toBeTruthy();
    const abas = screen.getAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual(['Todas', 'Precisam de atenção3', 'Aguardando aprovação2']);
    expect(screen.getAllByText('EX-20431').length).toBeGreaterThan(0);
    expect(screen.getAllByText('“Agendar visita para a Padaria Bom Pão amanhã às 10h”').length).toBe(2); // tabela + cartão
    expect(pedidos.some((p) => p.caminho === '/execucoes?status=falhou&pagina=1')).toBe(true);
    const csv = screen.getByText('Exportar CSV').closest('a')!;
    expect(csv.getAttribute('href')).toBe('/api/console/execucoes/exportar.csv?status=falhou');

    fireEvent.click(abas[1]);
    await waitFor(() => expect(pedidos.some((p) => p.caminho === '/execucoes?aba=atencao&status=falhou&pagina=1')).toBe(true));
    expect(local()).toBe('/execucoes?status=falhou&aba=atencao');

    fireEvent.click(screen.getByText('Próximo'));
    await waitFor(() => expect(local()).toContain('pagina=2'));
  });

  it('filtros sem resultado mostram os filtros ativos e limpam', async () => {
    instalarFetch({
      'GET /execucoes': lista({ linhas: [], total: 0, paginas: 1 }),
      'GET /execucoes/filtros': { tarefas: [{ id: 't1', nome: 'Agendar visita' }] },
    });
    renderizar(<ListaExecucoes />, { caminho: '/execucoes?canal=teste&tarefa=t1' });
    expect(await screen.findByText('Nenhuma execução com estes filtros')).toBeTruthy();
    expect(screen.getByText('Canal: Teste')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Tarefa: Agendar visita')).toBeTruthy());
    fireEvent.click(screen.getByText('Limpar filtros'));
    await waitFor(() => expect(local()).toBe('/execucoes'));
  });

  it('sem nenhuma execução mostra o vazio de primeira vez', async () => {
    instalarFetch({
      'GET /execucoes': lista({ linhas: [], total: 0, totalGeral: 0, paginas: 1, contagem: { todas: 0, atencao: 0, aprovacao: 0 } }),
      'GET /execucoes/filtros': { tarefas: [] },
    });
    renderizar(<ListaExecucoes />, { caminho: '/execucoes' });
    expect(await screen.findByText('Nenhuma execução ainda')).toBeTruthy();
  });

  it('erro do servidor mostra o aviso com tentar de novo', async () => {
    let falhar = true;
    instalarFetch({
      'GET /execucoes': () => (falhar ? { status: 503, corpo: { erro: 'indisponivel', mensagem: 'Servidor fora do ar.', ref: 'R-1' } } : lista()),
      'GET /execucoes/filtros': { tarefas: [] },
    });
    renderizar(<ListaExecucoes />, { caminho: '/execucoes' });
    expect(await screen.findByText('Não conseguimos carregar as execuções')).toBeTruthy();
    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByText('1–10 de 1.284 execuções · dados de exemplo')).toBeTruthy();
  });

  it('recarrega sozinha quando chega um evento de execução', async () => {
    let n = 0;
    instalarFetch({
      'GET /execucoes': () => {
        n++;
        return lista({ total: 1284 + (n > 1 ? 1 : 0), totalGeral: 1284 + (n > 1 ? 1 : 0) });
      },
      'GET /execucoes/filtros': { tarefas: [] },
    });
    renderizar(<ListaExecucoes />, { caminho: '/execucoes' });
    await screen.findByText('1–10 de 1.284 execuções · dados de exemplo');
    act(() => EventSourceFalso.emitir({ tipo: 'execucao', execucaoId: 'EX-1' }));
    expect(await screen.findByText('1–10 de 1.285 execuções · dados de exemplo', {}, { timeout: 2000 })).toBeTruthy();
  });
});

describe('C6 · Detalhe da execução', () => {
  it('mostra diagnóstico, linha do tempo com print destacado, custo e ações do Admin', async () => {
    instalarFetch({ 'GET /execucoes/EX-20431': detalhe() });
    renderizar(<DetalheExecucao />, { caminho: '/execucoes/EX-20431', rota: '/execucoes/:id' });
    expect(await screen.findByText('A tela de agendamento mudou e nada foi gravado.')).toBeTruthy();
    expect(screen.getByText('Não achou o botão “Salvar visita”')).toBeTruthy();
    expect(screen.getByAltText(/Print 1 de 1/).getAttribute('src')).toBe('/api/console/prints/p1');
    expect(document.querySelector('.cb-destaque')).toBeTruthy();
    expect(screen.getByText(/Gravar agendamento/)).toBeTruthy();
    expect(screen.getByText('R$ 0,38')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reexecutar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marcar como concluída/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Atualizar o fluxo gravado/ }).getAttribute('href')).toBe('/aprender/f1');
  });

  it('Leitor só vê: sem botões de ação e com aviso', async () => {
    instalarFetch({ 'GET /execucoes/EX-20431': detalhe() });
    renderizar(<DetalheExecucao />, { caminho: '/execucoes/EX-20431', rota: '/execucoes/:id', perfil: 'leitor' });
    await screen.findByText('A tela de agendamento mudou e nada foi gravado.');
    expect(screen.queryByRole('button', { name: /Reexecutar/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Atualizar o fluxo gravado/ })).toBeNull();
    expect(screen.getByText(/Seu perfil só permite ver esta execução/)).toBeTruthy();
  });

  it('Suporte reexecuta e vai para a nova execução', async () => {
    const { pedidos } = instalarFetch({
      'GET /execucoes/EX-20431': detalhe(),
      'POST /execucoes/EX-20431/reexecutar': { id: 'EX-20432' },
    });
    renderizar(<DetalheExecucao />, { caminho: '/execucoes/EX-20431', rota: '/execucoes/:id', perfil: 'suporte' });
    fireEvent.click(await screen.findByRole('button', { name: /Reexecutar/ }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: /Reexecutar/ }));
    await waitFor(() => expect(local()).toBe('/execucoes/EX-20432'));
    expect(pedidos.some((p) => p.metodo === 'POST' && p.caminho === '/execucoes/EX-20431/reexecutar')).toBe(true);
  });

  it('pedido de aprovação: Aprovar chama a decisão', async () => {
    const { pedidos } = instalarFetch({
      'GET /execucoes/EX-20431': detalhe({
        linha: linha({ status: 'aguardando_aprovacao' }),
        diagnostico: { titulo: 'Esperando a aprovação de Júlia Martins.', detalhe: '', tom: 'aviso' },
        aprovacao: { id: 'ap1', estado: 'enviada', aprovador: 'Júlia Martins' },
        acoes: { reexecutar: false, concluir: false, avisar: true, atualizarFluxo: false, desfazer: false, responder: false },
      }),
      'POST /execucoes/aprovacoes/ap1/decidir': { ok: true },
    });
    renderizar(<DetalheExecucao />, { caminho: '/execucoes/EX-20431', rota: '/execucoes/:id' });
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: /Aprovar/ }));
    await waitFor(() =>
      expect(pedidos.find((p) => p.caminho === '/execucoes/aprovacoes/ap1/decidir')?.corpo).toMatchObject({ aprovado: true }),
    );
  });

  it('código que não existe mostra "Execução não encontrada"', async () => {
    instalarFetch({});
    renderizar(<DetalheExecucao />, { caminho: '/execucoes/EX-1', rota: '/execucoes/:id' });
    expect(await screen.findByText('Execução não encontrada')).toBeTruthy();
  });
});

// Painel (C1): indicadores, gráfico, atenção, mais usadas, canais e período.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Painel as DadosPainel } from '@copiloto/shared';
import { descricaoDia, tetoEixo } from '../../src/paginas/painel/GraficoDias.tsx';
import Painel from '../../src/paginas/painel/Painel.tsx';
import { instalarEventSource, instalarFetch, renderizar } from './ambiente.tsx';

function painel(p: Partial<DadosPainel> = {}): DadosPainel {
  return {
    periodo: '30d',
    inicio: '2026-09-18T03:00:00.000Z',
    fim: '2026-10-17T15:00:00.000Z',
    atualizadoEm: '2026-10-17T13:42:00.000Z',
    temDadosDeExemplo: true,
    executadas: 1284,
    variacao: 0.12,
    taxaSucesso: 0.962,
    falhas: 49,
    tempoMedioApiS: 6,
    tempoMedioNavegadorS: 42,
    gastoMes: 1200,
    limiteMes: 1500,
    previsaoMes: 1450,
    porDia: [
      { dia: '2026-10-15', concluidas: 40, falhas: 2 },
      { dia: '2026-10-16', concluidas: 48, falhas: 1 },
      { dia: '2026-10-17', concluidas: 12, falhas: 0 },
    ],
    atencao: [
      {
        tipo: 'falhas',
        titulo: '3 falhas em Emitir 2ª via de boleto',
        detalhe: 'O botão “Gerar 2ª via” mudou de lugar.',
        acao: { rotulo: 'Ver execuções', destino: '/execucoes?status=falhou' },
        quantidade: 3,
      },
    ],
    maisUsadas: [
      { tarefaId: 'tar-1', nome: 'Cadastrar cliente', caminho: 'api', status: 'ativa', execucoes: 412, sucesso: 0.98, custoMedio: 0.47 },
      { tarefaId: 'tar-2', nome: 'Emitir 2ª via de boleto', caminho: 'navegador', status: 'ativa', execucoes: 120, sucesso: 0.87, custoMedio: 1.2 },
    ],
    porCanal: [
      { canal: 'widget', rotulo: 'Widget', total: 1200 },
      { canal: 'teste', rotulo: 'Teste', total: 84 },
    ],
    ...p,
  };
}

beforeEach(() => {
  instalarEventSource();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('C1 · Painel', () => {
  it('eixo e descrição acessível das barras', () => {
    expect(tetoEixo(75)).toBe(80);
    expect(tetoEixo(230)).toBe(250);
    expect(tetoEixo(3)).toBe(4);
    expect(descricaoDia({ dia: '2026-09-18', concluidas: 48, falhas: 1 })).toBe('18/09: 49 execuções, 48 concluídas, 1 com falha');
    expect(descricaoDia({ dia: '2026-09-19', concluidas: 0, falhas: 0 })).toBe('19/09: nenhuma execução');
  });

  it('mostra indicadores, atenção, mais usadas e canais', async () => {
    instalarFetch({ 'GET /painel': painel() });
    renderizar(<Painel />, { caminho: '/painel', rota: '/painel' });
    expect(await screen.findByText('1.284')).toBeTruthy();
    expect(screen.getByText('Dados de exemplo')).toBeTruthy();
    expect(screen.getByText(/\+12%/)).toBeTruthy();
    expect(screen.getByText('3 falhas em Emitir 2ª via de boleto')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver execuções/ }).getAttribute('href')).toBe('/execucoes?status=falhou');
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Cadastrar cliente')).toBeTruthy();
    expect(screen.getByText('Widget')).toBeTruthy();
    expect(screen.getByText('Teste')).toBeTruthy();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
    // Barras com descrição para leitor de tela.
    expect(screen.getByLabelText('16/10: 49 execuções, 48 concluídas, 1 com falha')).toBeTruthy();
  });

  it('mostra no máximo 4 itens de atenção, com "Ver todos"', async () => {
    const item = painel().atencao[0];
    const atencao = Array.from({ length: 6 }, (_, i) => ({ ...item, titulo: `Item ${i + 1}` }));
    instalarFetch({ 'GET /painel': painel({ atencao }) });
    renderizar(<Painel />, { caminho: '/painel', rota: '/painel' });
    await screen.findByText('Item 1');
    expect(screen.queryByText('Item 5')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ver todos \(6\)/ }));
    expect(screen.getByText('Item 6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Mostrar menos/ }));
    expect(screen.queryByText('Item 6')).toBeNull();
  });

  it('troca o período, lembra a escolha e mostra o vazio', async () => {
    const { pedidos } = instalarFetch({
      'GET /painel': () => painel({ executadas: 0, porDia: [], atencao: [], maisUsadas: [], porCanal: [], temDadosDeExemplo: false, periodo: '7d' }),
    });
    renderizar(<Painel />, { caminho: '/painel', rota: '/painel' });
    await screen.findByText('Nenhuma execução neste período');
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    await waitFor(() => expect(pedidos.some((p) => p.caminho === '/painel?periodo=7d')).toBe(true));
    expect(JSON.parse(localStorage.getItem('copiloto:painel:periodo') ?? 'null')).toBe('7d');
    expect(screen.getByText('Nada pendente')).toBeTruthy();
    expect(screen.queryByText('Dados de exemplo')).toBeNull();
  });
});

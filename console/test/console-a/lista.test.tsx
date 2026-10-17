// Lista de tarefas (C2): filtros, busca, pedidos sem tarefa e "Descrever a tarefa".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ListaTarefas as Lista, TarefaResumo } from '@copiloto/shared';
import ListaTarefas, { textoParaTema } from '../../src/paginas/tarefas/ListaTarefas.tsx';
import { definicao, detalhe, instalarEventSource, instalarFetch, local, renderizar } from './ambiente.tsx';

function tarefa(p: Partial<TarefaResumo>): TarefaResumo {
  return {
    id: 'tar-1',
    slug: 'cadastrar-cliente',
    nome: 'Cadastrar cliente',
    descricao: 'Cria um cliente novo.',
    caminho: 'api',
    status: 'ativa',
    versaoPublicada: 4,
    temRascunho: false,
    execucoes30d: 412,
    sucesso30d: 0.98,
    falhasHoje: 0,
    atualizadoEm: '2026-10-14T13:00:00.000Z',
    atualizadoPor: 'Júlia Martins',
    liberadaPara: 0,
    ...p,
  };
}

const LISTA: Lista = {
  tarefas: [
    tarefa({}),
    tarefa({ id: 'tar-2', nome: 'Emitir 2ª via de boleto', descricao: 'Gera a segunda via.', caminho: 'navegador', status: 'teste', liberadaPara: 3, falhasHoje: 2 }),
    tarefa({ id: 'tar-3', nome: 'Agendar visita técnica', descricao: 'Marca a visita.', status: 'rascunho', versaoPublicada: null, sucesso30d: null, execucoes30d: 0 }),
  ],
  contagem: { todas: 3, ativa: 1, teste: 1, rascunho: 1, inativa: 0 },
  semTarefa: [
    { tema: 'cancelar pedido', quantidade: 23, exemplos: ['cancela o pedido 4410'] },
    { tema: 'trocar senha', quantidade: 4, exemplos: [] },
  ],
};

beforeEach(() => instalarEventSource());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('C2 · Tarefas', () => {
  it('lista, filtra por status e busca sem acento', async () => {
    instalarFetch({ 'GET /tarefas': LISTA });
    renderizar(<ListaTarefas />, { caminho: '/tarefas', rota: '/tarefas' });
    const tabela = await screen.findByRole('table');
    expect(within(tabela).getAllByRole('row')).toHaveLength(4);
    expect(within(tabela).getByText('2 falhas hoje')).toBeTruthy();
    expect(within(tabela).getByText(/Liberada para 3 pessoas\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Inativas/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Em teste/ }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Todas/ }));

    fireEvent.change(screen.getByLabelText('Buscar tarefa'), { target: { value: 'tecnica' } });
    const linhas = within(screen.getByRole('table')).getAllByRole('row');
    expect(linhas).toHaveLength(2);
    expect(within(linhas[1]).getByText('Agendar visita técnica')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Buscar tarefa'), { target: { value: 'nada disso' } });
    expect(screen.getByText('Nenhuma tarefa com “nada disso”.')).toBeTruthy();
  });

  it('ignora pedidos sem tarefa e cria tarefa a partir do tema', async () => {
    const { pedidos } = instalarFetch({
      'GET /tarefas': LISTA,
      'POST /tarefas/sem-tarefa/ignorar': { ok: true },
      'POST /tarefas/descrever': { definicao: definicao({ nome: 'Cancelar pedido' }) },
      'POST /tarefas': detalhe({ id: 'tar-9' }),
    });
    renderizar(<ListaTarefas />, { caminho: '/tarefas', rota: '/tarefas' });
    expect(await screen.findByText('23 pedidos sobre “cancelar pedido” nos últimos 30 dias, e não há tarefa para isso.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais 1 tema pedido sem tarefa' }));
    expect(screen.getByText(/4 pedidos sobre “trocar senha”/)).toBeTruthy();

    const sugestao = screen.getByText(/4 pedidos sobre “trocar senha”/).closest('.card') as HTMLElement;
    fireEvent.click(within(sugestao).getByRole('button', { name: 'Ignorar' }));
    await waitFor(() => expect(screen.queryByText(/4 pedidos sobre “trocar senha”/)).toBeNull());
    expect(screen.getByText(/Pedidos sobre “trocar senha” ignorados/)).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/tarefas/sem-tarefa/ignorar')?.corpo).toEqual({ tema: 'trocar senha' });

    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    const modal = await screen.findByRole('dialog', { name: 'Descrever a tarefa' });
    const texto = within(modal).getByLabelText('O que a tarefa faz') as HTMLTextAreaElement;
    expect(texto.value).toBe(textoParaTema(LISTA.semTarefa[0]));
    fireEvent.click(within(modal).getByRole('button', { name: 'Montar a ficha' }));
    await waitFor(() => expect(local()).toBe('/tarefas/tar-9'));
    expect(pedidos.find((p) => p.caminho === '/tarefas' && p.metodo === 'POST')?.corpo).toEqual({ definicao: definicao({ nome: 'Cancelar pedido' }) });
  });

  it('descrição curta não envia', async () => {
    const { pedidos } = instalarFetch({ 'GET /tarefas': LISTA });
    renderizar(<ListaTarefas />, { caminho: '/tarefas', rota: '/tarefas' });
    fireEvent.click(await screen.findByRole('button', { name: /Nova tarefa/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Descrever a tarefa/ }));
    const modal = await screen.findByRole('dialog', { name: 'Descrever a tarefa' });
    fireEvent.change(within(modal).getByLabelText('O que a tarefa faz'), { target: { value: 'cadastro' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Montar a ficha' }));
    expect(within(modal).getByText(/Descreva com um pouco mais de detalhe/)).toBeTruthy();
    expect(pedidos.some((p) => p.caminho === '/tarefas/descrever')).toBe(false);
  });

  it('sem tarefas mostra o primeiro passo; Leitor não vê "Nova tarefa"', async () => {
    instalarFetch({ 'GET /tarefas': { tarefas: [], contagem: { todas: 0, ativa: 0, teste: 0, rascunho: 0, inativa: 0 }, semTarefa: [] } });
    renderizar(<ListaTarefas />, { caminho: '/tarefas', rota: '/tarefas' });
    expect(await screen.findByText('Crie a primeira tarefa')).toBeTruthy();
    cleanup();
    instalarFetch({ 'GET /tarefas': LISTA });
    renderizar(<ListaTarefas />, { caminho: '/tarefas', rota: '/tarefas', perfil: 'leitor' });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Nova tarefa/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ignorar' })).toBeNull();
  });

  it('erro de rede mostra o estado offline com "Tentar de novo"', async () => {
    let falhar = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (falhar) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(LISTA), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    renderizar(<ListaTarefas />, { caminho: '/tarefas', rota: '/tarefas' });
    const botao = await screen.findByRole('button', { name: /Tentar de novo/ });
    falhar = false;
    fireEvent.click(botao);
    expect(await screen.findByRole('table')).toBeTruthy();
  });
});

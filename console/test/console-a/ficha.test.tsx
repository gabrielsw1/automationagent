// Ficha da tarefa (C3): editar, salvar rascunho, publicar, testes, permissões e recuperação local.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TarefaDefinicao, TarefaDetalhe } from '@copiloto/shared';
import FichaTarefa from '../../src/paginas/tarefas/FichaTarefa.tsx';
import { definicao, detalhe, instalarEventSource, instalarFetch, renderizar, status, USUARIOS, type Pedido } from './ambiente.tsx';

vi.mock('@copiloto/widget/chat', () => ({
  ChatCopiloto: ({ token }: { token: string }) => <div data-testid="chat">chat {token}</div>,
}));

function rotasBase(d: TarefaDetalhe, extra: Record<string, unknown> = {}) {
  return {
    'GET /tarefas/tar-1': () => d,
    'GET /sistema/usuarios': USUARIOS,
    'POST /teste/token': { token: 'tok-1', usuario: USUARIOS[0] },
    'GET /sistema/rotas': [{ metodo: 'POST', caminho: '/v1/clientes', descricao: 'Cria um cliente' }],
    'GET /fluxos': [],
    ...extra,
  };
}

const abrir = (perfil: 'admin' | 'leitor' = 'admin', caminho = '/tarefas/tar-1') =>
  renderizar(<FichaTarefa />, { perfil, caminho, rota: '/tarefas/:id' });

beforeEach(() => {
  instalarEventSource();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('C3 · Ficha da tarefa', () => {
  it('mostra cabeçalho, abas e campos', async () => {
    instalarFetch(rotasBase(detalhe()));
    abrir();
    expect(await screen.findByRole('heading', { level: 1, name: 'Cadastrar cliente' })).toBeTruthy();
    expect(screen.getByText('Versão 4 publicada por Júlia Martins em 14/10/2026.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Ficha' }).getAttribute('aria-selected')).toBe('true');
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Nome da empresa')).toBeTruthy();
    expect(within(tabela).getByText('Valida os dígitos verificadores e se já existe cadastro')).toBeTruthy();
    expect(within(tabela).getByText('“Qual é o CNPJ da empresa?”')).toBeTruthy();
    // Sem rascunho nem mudanças: nada para publicar ou salvar.
    expect((screen.getByRole('button', { name: 'Publicar versão 5' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Salvar rascunho' }) as HTMLButtonElement).disabled).toBe(true);
    // Pré-visualização com o usuário do sistema.
    expect(await screen.findByTestId('chat')).toBeTruthy();
  });

  it('edita, guarda no navegador, salva o rascunho e publica', async () => {
    const d = detalhe();
    let atual = d;
    const { pedidos } = instalarFetch(
      rotasBase(d, {
        'GET /tarefas/tar-1': () => atual,
        'PUT /tarefas/tar-1/rascunho': (p: Pedido) => {
          const def = (p.corpo as { definicao: TarefaDefinicao }).definicao;
          atual = { ...d, rascunho: { versao: 5, definicao: def, alteracoes: 1, salvoEm: new Date().toISOString() } };
          return atual;
        },
        'POST /tarefas/tar-1/publicar': () => {
          atual = {
            ...d,
            publicada: { versao: 5, definicao: atual.rascunho!.definicao, publicadoPor: 'Rafael Lima', publicadoEm: new Date().toISOString() },
            rascunho: null,
          };
          return atual;
        },
      }),
    );
    abrir();
    const instrucao = (await screen.findByLabelText('Instrução para o agente')) as HTMLTextAreaElement;
    fireEvent.change(instrucao, { target: { value: 'Use para clientes novos. Nunca para alterar.' } });
    expect(screen.getByText(/Há mudanças não salvas\./)).toBeTruthy();
    const guardado = JSON.parse(localStorage.getItem('copiloto:ficha:tar-1') ?? 'null');
    expect(guardado.def.quandoUsar).toBe('Use para clientes novos. Nunca para alterar.');

    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await screen.findByText(/Você tem 1 alteração no rascunho da versão 5\./);
    const put = pedidos.find((p) => p.metodo === 'PUT')!;
    expect((put.corpo as { definicao: { quandoUsar: string } }).definicao.quandoUsar).toBe('Use para clientes novos. Nunca para alterar.');
    expect(localStorage.getItem('copiloto:ficha:tar-1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Publicar versão 5' }));
    const modal = await screen.findByRole('dialog', { name: 'Publicar a versão 5?' });
    fireEvent.change(within(modal).getByLabelText('O que mudou (opcional)'), { target: { value: 'Instrução mais clara.' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Publicar versão 5' }));
    await screen.findByText('Tarefa publicada. Versão 5 já está valendo.');
    const pub = pedidos.find((p) => p.caminho === '/tarefas/tar-1/publicar')!;
    expect(pub.corpo).toEqual({ resumoMudancas: 'Instrução mais clara.' });
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
  });

  it('mostra as pendências quando o servidor recusa a publicação', async () => {
    const d = detalhe({ rascunho: { versao: 5, definicao: definicao({ quandoUsar: '' }), alteracoes: 1, salvoEm: '2026-10-17T12:00:00.000Z' } });
    instalarFetch(
      rotasBase(d, {
        'POST /tarefas/tar-1/publicar': status(422, { erro: 'ficha_incompleta', mensagem: 'Antes de publicar: Escreva quando usar a tarefa.' }),
      }),
    );
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar versão 5' }));
    const modal = await screen.findByRole('dialog');
    fireEvent.click(within(modal).getByRole('button', { name: 'Publicar versão 5' }));
    expect(await within(modal).findByText('Antes de publicar: Escreva quando usar a tarefa.')).toBeTruthy();
  });

  it('perfil Leitor vê a ficha sem os botões de edição', async () => {
    instalarFetch(rotasBase(detalhe()));
    abrir('leitor');
    await screen.findByRole('heading', { level: 1, name: 'Cadastrar cliente' });
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Publicar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar campo' })).toBeNull();
    expect(screen.getByText(/Você pode ver a ficha, mas não editar\. Seu perfil é Leitor/)).toBeTruthy();
  });

  it('recupera mudanças guardadas neste navegador', async () => {
    const d = detalhe();
    const base = JSON.stringify(d.publicada!.definicao);
    localStorage.setItem('copiloto:ficha:tar-1', JSON.stringify({ base, def: { ...d.publicada!.definicao, nome: 'Cadastrar cliente novo' } }));
    instalarFetch(rotasBase(d));
    abrir();
    expect(await screen.findByText('Recuperamos mudanças que não foram salvas')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Cadastrar cliente novo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Cadastrar cliente' })).toBeTruthy();
    expect(localStorage.getItem('copiloto:ficha:tar-1')).toBeNull();
  });

  it('adiciona um campo com validação', async () => {
    instalarFetch(rotasBase(detalhe()));
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar campo' }));
    const modal = await screen.findByRole('dialog', { name: 'Adicionar campo' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Adicionar campo' }));
    expect(within(modal).getByText(/Dê um nome ao campo/)).toBeTruthy();
    fireEvent.change(within(modal).getByLabelText(/Nome do campo/), { target: { value: 'E-mail de cobrança' } });
    expect((within(modal).getByLabelText(/Chave técnica/) as HTMLInputElement).value).toBe('email_cobranca');
    fireEvent.change(within(modal).getByLabelText('Tipo'), { target: { value: 'email' } });
    fireEvent.change(within(modal).getByLabelText(/Pergunta que o agente faz/), { target: { value: 'Qual é o e-mail de cobrança?' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Adicionar campo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('E-mail de cobrança')).toBeTruthy();
    expect(within(tabela).getByText('Formato de e-mail')).toBeTruthy();
    expect(screen.getByText(/Há mudanças não salvas\./)).toBeTruthy();
  });

  it('roda os testes e mostra quando o servidor ainda não tem testes automáticos', async () => {
    let vez = 0;
    instalarFetch(
      rotasBase(detalhe(), {
        'POST /tarefas/tar-1/testes/rodar': () =>
          ++vez === 1
            ? {
                id: 'r1',
                tarefaId: 'tar-1',
                versao: 4,
                aprovados: 1,
                total: 2,
                criadoEm: new Date().toISOString(),
                resultados: [
                  { casoId: 'c1', frase: 'x', aprovado: true, obtido: 'Perguntou o CNPJ.' },
                  { casoId: 'c2', frase: 'y', aprovado: false, obtido: 'Aceitou 90 dias.', esperado: 'Deveria oferecer 15 ou 30.' },
                ],
              }
            : status(503, { erro: 'testes_indisponiveis', mensagem: 'Os testes automáticos ainda não estão disponíveis neste servidor.' }),
      }),
    );
    abrir('admin', '/tarefas/tar-1?aba=testes');
    const painel = await screen.findByRole('tabpanel');
    fireEvent.click(within(painel).getByRole('button', { name: 'Rodar testes' }));
    expect(await within(painel).findByText('Aceitou 90 dias. Deveria oferecer 15 ou 30.')).toBeTruthy();
    expect(within(painel).getAllByText('1 de 2 aprovados').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /Testes/ }).textContent).toContain('1/2');
    fireEvent.click(within(painel).getByRole('button', { name: 'Rodar testes' }));
    expect(await within(painel).findByText('Os testes automáticos ainda não estão disponíveis neste servidor.')).toBeTruthy();
  });

  it('desativa a tarefa com confirmação', async () => {
    const { pedidos } = instalarFetch(rotasBase(detalhe(), { 'POST /tarefas/tar-1/status': () => detalhe({ status: 'inativa' }) }));
    const { sessao } = abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Desativar tarefa/ }));
    const modal = await screen.findByRole('dialog', { name: 'Desativar a tarefa Cadastrar cliente?' });
    expect(within(modal).getByText(/O copiloto vai parar de oferecer e de executar esta tarefa/)).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Desativar' }));
    await screen.findByText('Tarefa desativada.');
    expect(pedidos.find((p) => p.caminho === '/tarefas/tar-1/status')?.corpo).toEqual({ status: 'inativa' });
    expect(sessao.recarregarResumo).toHaveBeenCalled();
  });

  it('mostra "não encontrada" para tarefa que não existe', async () => {
    instalarFetch({ 'GET /tarefas/tar-1': status(404, { erro: 'nao_encontrado', mensagem: 'Tarefa não encontrada.' }) });
    abrir();
    expect(await screen.findByText('Não encontramos esta tarefa')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver todas as tarefas' }).getAttribute('href')).toBe('/tarefas');
  });

  it('testa a chamada da API com a ficha atual', async () => {
    const { pedidos } = instalarFetch(
      rotasBase(detalhe(), {
        'POST /tarefas/tar-1/testar-chamada': { ok: false, status: 404, duracaoMs: 120, mensagem: 'Não achei esta rota no Horizonte.' },
      }),
    );
    abrir('admin', '/tarefas/tar-1?aba=execucao');
    fireEvent.click(await screen.findByRole('button', { name: 'Testar a chamada' }));
    expect(await screen.findByText('A chamada não funcionou')).toBeTruthy();
    expect(screen.getByText(/Não achei esta rota no Horizonte\./)).toBeTruthy();
    const corpo = pedidos.find((p) => p.caminho === '/tarefas/tar-1/testar-chamada')!.corpo as { definicao: { api: { caminho: string } } };
    expect(corpo.definicao.api.caminho).toBe('/v1/clientes');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Limites, MembroEquipe, RegistroAuditoria, Seguranca } from '@copiloto/shared';
import Equipe, { escreverMoeda, lerMoeda } from '../../src/paginas/equipe/Equipe.tsx';
import { instalarEventSource, instalarFetch, renderizar } from './ambiente.tsx';

const agora = new Date().toISOString();
const membros: MembroEquipe[] = [
  { id: 'mem-1', nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', perfil: 'admin', status: 'ativo', ultimoAcesso: agora },
  { id: 'mem-2', nome: 'Camila Souza', email: 'camila.souza@seusistema.com.br', perfil: 'editor', status: 'ativo', ultimoAcesso: null },
  {
    id: 'mem-3',
    nome: null,
    email: 'leticia.prado@seusistema.com.br',
    perfil: 'suporte',
    status: 'convidado',
    ultimoAcesso: null,
    conviteEnviadoEm: '2026-10-15T12:00:00.000Z',
    conviteExpiraEm: '2099-10-22T12:00:00.000Z',
  },
];

const limites: Limites = {
  mensal: 1500,
  porUsuarioDia: 50,
  alerta80: true,
  aoAtingir: 'pausar_navegador',
  usoMes: 812.4,
  previsaoMes: 1340,
  renovaEm: '2026-11-01T03:00:00.000Z',
  atualizadoPor: null,
  atualizadoEm: null,
};

const seguranca: Seguranca = {
  mascararPrints: true,
  retencaoPrintsDias: 90,
  retencaoConversasMeses: 12,
  atualizadoPor: 'Rafael Lima',
  atualizadoEm: '2026-10-09T12:00:00.000Z',
};

const auditoria: RegistroAuditoria[] = [
  { id: 'a1', ts: '2026-10-17T12:00:00.000Z', ator: 'Rafael Lima', acao: 'publicou', alvo: 'Agendar visita', detalhe: 'Versão 5' },
];

function rotasBase(extra: Record<string, unknown> = {}) {
  return {
    'GET /equipe': membros,
    'GET /limites': limites,
    'GET /seguranca': seguranca,
    'GET /auditoria': auditoria,
    ...extra,
  };
}

beforeEach(() => instalarEventSource());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('valores em reais', () => {
  it('lê e escreve como no Brasil', () => {
    expect(lerMoeda('1.500,00')).toBe(1500);
    expect(lerMoeda('R$ 2.000,5')).toBe(2000.5);
    expect(lerMoeda('1500')).toBe(1500);
    expect(lerMoeda('1.500')).toBe(1500);
    expect(lerMoeda('12.5')).toBe(12.5);
    expect(lerMoeda('abc')).toBeNull();
    expect(lerMoeda('')).toBeNull();
    expect(escreverMoeda(1500)).toBe('1.500,00');
  });
});

describe('C9 · Equipe e limites', () => {
  it('Admin vê a equipe, o único admin travado, o convite pendente, limites, segurança e auditoria', async () => {
    instalarFetch(rotasBase());
    renderizar(<Equipe />, { caminho: '/equipe' });
    expect(await screen.findByText('Camila Souza')).toBeTruthy();
    expect(screen.getByText('Você')).toBeTruthy();
    const perfilRafael = screen.getByLabelText('Perfil de Rafael Lima') as HTMLSelectElement;
    expect(perfilRafael.disabled).toBe(true);
    expect(screen.getByText('Único admin: não pode ser alterado')).toBeTruthy();
    expect((screen.getByLabelText('Perfil de Camila Souza') as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByText(/Convite pendente · Suporte/)).toBeTruthy();
    expect(screen.getByText(/Convite enviado em 15\/10\/2026 · expira em 22\/10/)).toBeTruthy();
    expect(screen.getByText('Agora')).toBeTruthy();

    expect(await screen.findByText('Uso em', { exact: false })).toBeTruthy();
    expect((screen.getByLabelText('Limite mensal') as HTMLInputElement).value).toBe('1.500,00');
    expect(screen.getByText(/No ritmo atual, fecha o mês perto de R\$\s1\.340,00/)).toBeTruthy();
    expect(screen.getByText('Sempre · travado')).toBeTruthy();
    expect(screen.getByText('Ligado · travado')).toBeTruthy();
    expect(screen.getByText('Última alteração por Rafael Lima em 09/10/2026')).toBeTruthy();
    expect(await screen.findByText('Agendar visita')).toBeTruthy();
  });

  it('convida e mostra o link para copiar', async () => {
    const novo: MembroEquipe = {
      id: 'mem-9',
      nome: null,
      email: 'bruno@seusistema.com.br',
      perfil: 'leitor',
      status: 'convidado',
      ultimoAcesso: null,
      conviteEnviadoEm: agora,
      conviteExpiraEm: '2026-10-24T12:00:00.000Z',
    };
    const { pedidos } = instalarFetch(
      rotasBase({ 'POST /equipe/convites': { membro: novo, linkConvite: 'http://localhost:5173/convite/tok123', envio: 'caixa_local' } }),
    );
    renderizar(<Equipe />, { caminho: '/equipe' });
    fireEvent.click(await screen.findByRole('button', { name: /Convidar pessoa/ }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar convite' }));
    expect(await within(dialogo).findByText(/Digite um e-mail válido/)).toBeTruthy();
    fireEvent.change(within(dialogo).getByLabelText(/E-mail/), { target: { value: 'bruno@seusistema.com.br' } });
    fireEvent.change(within(dialogo).getByLabelText('Perfil'), { target: { value: 'leitor' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar convite' }));
    const link = (await screen.findByLabelText('Link do convite')) as HTMLInputElement;
    expect(link.value).toBe('http://localhost:5173/convite/tok123');
    expect(screen.getByText(/Não enviamos e-mail/)).toBeTruthy();
    // Sem SMTP no servidor: o e-mail ficou na caixa-de-saida.
    expect(screen.getByRole('note').textContent).toBe(
      'O envio de e-mail ainda não está configurado neste servidor (SMTP_URL). A mensagem ficou na pasta caixa-de-saida dos dados do servidor.',
    );
    expect(pedidos.find((p) => p.caminho === '/equipe/convites')?.corpo).toEqual({ email: 'bruno@seusistema.com.br', perfil: 'leitor' });
    expect(within(screen.getAllByRole('table')[0]).getByText('bruno@seusistema.com.br')).toBeTruthy();
  });

  it('com SMTP no servidor, diz que o convite foi por e-mail e ainda mostra o link', async () => {
    const novo: MembroEquipe = {
      id: 'mem-9',
      nome: null,
      email: 'bruno@seusistema.com.br',
      perfil: 'leitor',
      status: 'convidado',
      ultimoAcesso: null,
      conviteEnviadoEm: agora,
      conviteExpiraEm: '2026-10-24T12:00:00.000Z',
    };
    instalarFetch(rotasBase({ 'POST /equipe/convites': { membro: novo, linkConvite: 'http://localhost:5173/convite/tok123', envio: 'smtp' } }));
    renderizar(<Equipe />, { caminho: '/equipe' });
    fireEvent.click(await screen.findByRole('button', { name: /Convidar pessoa/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('O convite vai por e-mail, com um link que vale por 7 dias. Depois de criar, você também pode copiar o link.')).toBeTruthy();
    fireEvent.change(within(dialogo).getByLabelText(/E-mail/), { target: { value: 'bruno@seusistema.com.br' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar convite' }));
    expect(((await screen.findByLabelText('Link do convite')) as HTMLInputElement).value).toBe('http://localhost:5173/convite/tok123');
    expect(screen.getByText(/Enviamos o convite por e-mail para/)).toBeTruthy();
    expect(screen.getByText(/Se preferir, copie o link e mande você mesmo\./)).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('troca o perfil e remove com confirmação', async () => {
    const { pedidos } = instalarFetch(
      rotasBase({
        'PUT /equipe/mem-2/perfil': { ...membros[1], perfil: 'suporte' },
        'DELETE /equipe/mem-2': { status: 204 },
      }),
    );
    renderizar(<Equipe />, { caminho: '/equipe' });
    const sel = (await screen.findByLabelText('Perfil de Camila Souza')) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'suporte' } });
    expect(await screen.findByText('Perfil de Camila Souza mudou para Suporte.')).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'PUT' && p.caminho === '/equipe/mem-2/perfil')?.corpo).toEqual({ perfil: 'suporte' });

    fireEvent.click(screen.getByRole('button', { name: 'Remover Camila Souza da equipe' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(screen.queryByText('Camila Souza')).toBeNull());
    expect(pedidos.some((p) => p.metodo === 'DELETE' && p.caminho === '/equipe/mem-2')).toBe(true);
  });

  it('mostra o erro do servidor na linha do perfil', async () => {
    instalarFetch(
      rotasBase({
        'PUT /equipe/mem-2/perfil': { status: 409, corpo: { erro: 'conflito', mensagem: 'Não deu para mudar agora.' } },
      }),
    );
    renderizar(<Equipe />, { caminho: '/equipe' });
    fireEvent.change(await screen.findByLabelText('Perfil de Camila Souza'), { target: { value: 'leitor' } });
    expect(await screen.findByText('Não deu para mudar agora.')).toBeTruthy();
  });

  it('salva limites em reais com o corpo certo', async () => {
    const { pedidos } = instalarFetch(
      rotasBase({
        'PUT /limites': ({ corpo }: { corpo: unknown }) => ({
          ...limites,
          ...(corpo as object),
          atualizadoPor: 'Rafael Lima',
          atualizadoEm: '2026-10-17T12:00:00.000Z',
        }),
      }),
    );
    renderizar(<Equipe />, { caminho: '/equipe' });
    const mensal = (await screen.findByLabelText('Limite mensal')) as HTMLInputElement;
    const salvar = screen.getByRole('button', { name: 'Salvar limites' }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    fireEvent.change(mensal, { target: { value: '2.000,50' } });
    fireEvent.click(screen.getByLabelText(/Pausar tudo/));
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);
    expect(await screen.findByText('Limites salvos. Já estão valendo.')).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'PUT' && p.caminho === '/limites')?.corpo).toEqual({
      mensal: 2000.5,
      porUsuarioDia: 50,
      alerta80: true,
      aoAtingir: 'pausar_tudo',
    });
    expect(screen.getByText('Última alteração por Rafael Lima em 17/10/2026')).toBeTruthy();
  });

  it('valor de limite inválido trava o salvar', async () => {
    instalarFetch(rotasBase());
    renderizar(<Equipe />, { caminho: '/equipe' });
    fireEvent.change(await screen.findByLabelText('Limite mensal'), { target: { value: 'muito' } });
    expect(screen.getByText('Digite um valor em reais, por exemplo 1.500,00.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar limites' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Editor vê a equipe sem poder mudar, e limites e auditoria pedem acesso a um Admin', async () => {
    const { pedidos } = instalarFetch(rotasBase());
    renderizar(<Equipe />, { caminho: '/equipe', perfil: 'editor' });
    expect(await screen.findByText('Camila Souza')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Convidar pessoa/ })).toBeNull();
    expect((screen.getByLabelText('Perfil de Camila Souza') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
    expect(screen.getByText('Você não tem acesso a Limites de gasto')).toBeTruthy();
    expect(screen.getByText('Você não tem acesso ao registro de auditoria')).toBeTruthy();
    expect(screen.getAllByText(/Seu perfil é Editor de tarefas/).length).toBe(2);
    const pedir = screen.getAllByRole('link', { name: 'Pedir acesso a Rafael Lima' });
    expect(pedir[0].getAttribute('href')).toMatch(/^mailto:rafael\.lima@seusistema\.com\.br/);
    expect(((await screen.findByLabelText('Mascarar dados sensíveis nos prints')) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(pedidos.some((p) => p.caminho.startsWith('/limites') || p.caminho.startsWith('/auditoria'))).toBe(false);
  });
});

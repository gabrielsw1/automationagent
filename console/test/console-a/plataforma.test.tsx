// Painel da plataforma: empresas clientes com métricas, filtros e suspender/reativar.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { EmpresaPlataforma } from '@copiloto/shared';
import Plataforma from '../../src/paginas/plataforma/Plataforma.tsx';
import { instalarFetch, renderizar } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const hoje = new Date();
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 86_400_000).toISOString();

function empresa(p: Partial<EmpresaPlataforma>): EmpresaPlataforma {
  return {
    id: 'emp-x',
    nome: 'X',
    demo: false,
    status: 'ativa',
    criadoEm: diasAtras(100),
    criadoPor: null,
    cnpj: null,
    faixaUsuarios: null,
    sistema: { nome: 'ERP', url: 'https://erp.x.com.br', conector: 'tela', acesso: 'sessao' },
    equipe: 1,
    usuarios: 0,
    tarefasAtivas: 0,
    execucoes30d: 0,
    sucesso30d: null,
    ultimaExecucao: null,
    ...p,
  };
}

const EMPRESAS = [
  empresa({
    id: 'emp-horizonte',
    nome: 'Horizonte',
    demo: true,
    sistema: { nome: 'Horizonte', url: 'https://api.horizonte.com.br', conector: 'api', acesso: 'nenhum' },
    equipe: 4,
    usuarios: 12,
    tarefasAtivas: 3,
    execucoes30d: 120,
    sucesso30d: 0.95,
  }),
  empresa({
    id: 'emp-acme',
    nome: 'Acme Logística',
    criadoEm: diasAtras(5),
    criadoPor: 'Ana Ribeiro',
    cnpj: '11222333000181',
    sistema: { nome: 'ERP Acme', url: 'https://erp.acme.com.br', conector: 'tela', acesso: 'conta' },
    execucoes30d: 30,
    sucesso30d: 0.8,
  }),
  empresa({ id: 'emp-beta', nome: 'Beta', status: 'suspensa', criadoEm: diasAtras(40) }),
];

describe('Empresas clientes', () => {
  it('mostra métricas, filtra e suspende com confirmação', async () => {
    const { pedidos } = instalarFetch({
      'GET /plataforma/empresas': EMPRESAS,
      'PUT /plataforma/empresas/emp-acme/status': ({ corpo }: { corpo: unknown }) => ({ ...EMPRESAS[1], ...(corpo as object) }),
    });
    renderizar(<Plataforma />, { caminho: '/plataforma', eu: { adminPlataforma: true } });
    expect(await screen.findByRole('heading', { name: 'Empresas clientes' })).toBeTruthy();
    expect(screen.getByText('Quem usa o Copiloto e como está o uso de cada uma.')).toBeTruthy();
    expect(
      screen.getByText('Aqui você vê métricas, não conteúdo: conversas, prints e dados dos clientes de cada empresa ficam no espaço dela.'),
    ).toBeTruthy();

    const kpis = await screen.findByRole('region', { name: 'Resumo das empresas' });
    const valor = (rotulo: string) => within(kpis).getByText(rotulo).parentElement?.querySelector('.kpi-value')?.textContent;
    expect(valor('Empresas ativas')).toBe('2');
    expect(valor('Execuções em 30 dias')).toBe('150');
    expect(valor('Empresas criadas nos últimos 30 dias')).toBe('1');

    const tabela = screen.getByRole('table', { name: 'Empresas clientes' });
    const linhaAcme = within(tabela).getByText('Acme Logística').closest('tr')!;
    expect(within(linhaAcme).getByText('Acme Logística').getAttribute('title')).toBe('CNPJ 11.222.333/0001-81');
    expect(within(linhaAcme).getByText(/erp\.acme\.com\.br · Conta de serviço/)).toBeTruthy();
    expect(within(linhaAcme).getByText('80%')).toBeTruthy();
    expect(within(linhaAcme).getByText('por Ana Ribeiro')).toBeTruthy();
    const linhaHorizonte = within(tabela).getByText('Horizonte', { selector: '.strong' }).closest('tr')!;
    expect(within(linhaHorizonte).getByText('Demonstração')).toBeTruthy();
    expect(within(linhaHorizonte).getByText(/Pela API/)).toBeTruthy();
    // A empresa aberta agora não pode ser suspensa daqui.
    expect(within(linhaHorizonte).getByText('Aberta agora')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Suspensas/ }));
    expect(within(tabela).queryByText('Acme Logística')).toBeNull();
    expect(within(tabela).getByRole('button', { name: 'Reativar Beta' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Todas/ }));

    fireEvent.click(within(tabela).getByRole('button', { name: 'Suspender Acme Logística' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Suspender Acme Logística?' });
    expect(within(dialogo).getByText(/Nada é apagado/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Suspender empresa' }));
    expect(await screen.findByText('Acme Logística foi suspensa.')).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'PUT')?.corpo).toEqual({ status: 'suspensa' });
    await waitFor(() => expect(within(tabela).getByRole('button', { name: 'Reativar Acme Logística' })).toBeTruthy());
    expect(valor('Empresas ativas')).toBe('1');
  });

  it('quem não administra a plataforma não vê nada', async () => {
    const { pedidos } = instalarFetch({});
    renderizar(<Plataforma />, { caminho: '/plataforma' });
    expect(await screen.findByText('Você não tem acesso a Empresas clientes')).toBeTruthy();
    expect(pedidos.length).toBe(0);
  });
});

// Tela Sistema: endereço, como o copiloto entra (sessão, conta de serviço ou sem login), perfis e
// "Testar acesso". Na demonstração (API do Horizonte), só mostra.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { SistemaEmpresa } from '@copiloto/shared';
import Sistema, { erroPerfil } from '../../src/paginas/sistema/Sistema.tsx';
import { instalarFetch, renderizar, USUARIOS } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACME = { id: 'emp-acme', nome: 'Acme Logística', demo: false };

function sistema(p: Partial<SistemaEmpresa> = {}): SistemaEmpresa {
  return {
    nome: 'ERP Acme',
    url: 'https://erp.acme.com.br',
    conector: 'tela',
    acesso: { modo: 'nenhum', urlSessao: '', urlLogin: '', usuario: '', temSenha: false },
    perfis: ['Comercial', 'Atendimento'],
    editavel: true,
    ...p,
  };
}

describe('Sistema', () => {
  it('Admin troca para conta de serviço, ajusta os perfis, salva e testa o acesso', async () => {
    const { pedidos } = instalarFetch({
      'GET /sistema/config': sistema(),
      'PUT /sistema/config': ({ corpo }: { corpo: unknown }) => {
        const c = corpo as { nome: string; url: string; acesso: { modo: 'conta'; urlLogin: string; usuario: string }; perfis: string[] };
        return sistema({ ...c, acesso: { modo: 'conta', urlSessao: '', urlLogin: c.acesso.urlLogin, usuario: c.acesso.usuario, temSenha: true } });
      },
      'POST /sistema/testar-acesso': { ok: true, detalhe: 'Entrou como copiloto@acme.com.br e abriu /inicio.' },
    });
    const { sessao } = renderizar(<Sistema />, { caminho: '/sistema', eu: { empresa: ACME, empresas: [ACME] } });
    expect(await screen.findByRole('heading', { name: 'Sistema' })).toBeTruthy();
    expect((screen.getByLabelText(/Sem login/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: /Testar acesso/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByLabelText(/Com uma conta de serviço/));
    expect((screen.getByRole('button', { name: /Testar acesso/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Salve as mudanças antes de testar: o teste usa o que está salvo.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar sistema' }));
    expect(await screen.findByText('Diga em que página o copiloto entra no sistema.')).toBeTruthy();
    expect(screen.getByText('Digite a senha da conta do copiloto.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'PUT')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Página de login/), { target: { value: '/login' } });
    fireEvent.change(screen.getByLabelText(/^Usuário/), { target: { value: 'copiloto@acme.com.br' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 's3gredo!' } });

    // Perfis: tira um, recusa vírgula e repetido, adiciona outro.
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o perfil Atendimento' }));
    const novo = screen.getByLabelText('Adicionar perfil');
    fireEvent.change(novo, { target: { value: 'Financeiro, Compras' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Um perfil por vez, sem vírgula.')).toBeTruthy();
    fireEvent.change(novo, { target: { value: 'comercial' } });
    fireEvent.keyDown(novo, { key: 'Enter' });
    expect(await screen.findByText('Esse perfil já está na lista.')).toBeTruthy();
    fireEvent.change(novo, { target: { value: 'Financeiro' } });
    fireEvent.keyDown(novo, { key: 'Enter' });
    expect(within(screen.getByRole('list', { name: 'Perfis cadastrados' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Comercial',
      'Financeiro',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar sistema' }));
    expect(await screen.findByText('Sistema salvo. O copiloto já usa a configuração nova.')).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'PUT')?.corpo).toEqual({
      nome: 'ERP Acme',
      url: 'https://erp.acme.com.br',
      acesso: { modo: 'conta', urlSessao: '', urlLogin: '/login', usuario: 'copiloto@acme.com.br', senha: 's3gredo!' },
      perfis: ['Comercial', 'Financeiro'],
    });
    expect(sessao.recarregarResumo).toHaveBeenCalled();
    // Depois de salvar, a senha fica guardada e não volta para a tela.
    expect((screen.getByLabelText(/^Senha/) as HTMLInputElement).value).toBe('');
    expect(screen.getByPlaceholderText('Guardada. Deixe em branco para manter.')).toBeTruthy();

    const testar = screen.getByRole('button', { name: /Testar acesso/ }) as HTMLButtonElement;
    await waitFor(() => expect(testar.disabled).toBe(false));
    fireEvent.click(testar);
    expect(await screen.findByText('O copiloto entrou no sistema')).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/sistema/testar-acesso')?.corpo).toEqual({});
  });

  it('com a sessão de quem pede, testa com a pessoa escolhida', async () => {
    const { pedidos } = instalarFetch({
      'GET /sistema/config': sistema({ acesso: { modo: 'sessao', urlSessao: 'https://erp.acme.com.br/copiloto/sessao', urlLogin: '', usuario: '', temSenha: false } }),
      'GET /sistema/usuarios': USUARIOS,
      'POST /sistema/testar-acesso': { ok: false, detalhe: 'O endereço de sessão respondeu 401: confira a assinatura.' },
    });
    renderizar(<Sistema />, { caminho: '/sistema', eu: { empresa: ACME, empresas: [ACME] } });
    const como = await screen.findByLabelText('Testar com a sessão de');
    await screen.findByRole('option', { name: /Bruno Costa/ });
    fireEvent.change(como, { target: { value: '102' } });
    fireEvent.click(screen.getByRole('button', { name: /Testar acesso/ }));
    expect(await screen.findByText('O copiloto não conseguiu entrar')).toBeTruthy();
    expect(screen.getByText('O endereço de sessão respondeu 401: confira a assinatura.')).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/sistema/testar-acesso')?.corpo).toEqual({ usuarioId: '102' });
  });

  it('verifica o endereço', async () => {
    const { pedidos } = instalarFetch({
      'GET /sistema/config': sistema(),
      'POST /sistema/verificar': { ok: false, detalhe: 'Não consegui abrir https://erp2.acme.com.br. O endereço está certo e o sistema está no ar?' },
    });
    renderizar(<Sistema />, { caminho: '/sistema' });
    const endereco = await screen.findByLabelText(/Endereço do sistema/);
    fireEvent.change(endereco, { target: { value: 'erp2.acme.com.br' } });
    fireEvent.blur(endereco);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar endereço' }));
    expect(await screen.findByText('Não conseguimos abrir erp2.acme.com.br')).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/sistema/verificar')?.corpo).toEqual({ url: 'https://erp2.acme.com.br' });
  });

  it('quem não é Admin só vê', async () => {
    instalarFetch({ 'GET /sistema/config': sistema() });
    renderizar(<Sistema />, { caminho: '/sistema', perfil: 'editor' });
    expect(await screen.findByText('Só quem tem perfil Admin muda o sistema')).toBeTruthy();
    expect((screen.getByLabelText(/Como a equipe chama o sistema/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Com uma conta de serviço/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Salvar sistema' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Testar acesso/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tirar o perfil/ })).toBeNull();
  });

  it('demonstração: o sistema é a API do Horizonte, só leitura', async () => {
    const { pedidos } = instalarFetch({
      'GET /sistema/config': sistema({ nome: 'Horizonte', url: 'https://api.horizonte.com.br', conector: 'api', editavel: false, perfis: [] }),
      'GET /sistema/perfis': ['Comercial', 'Financeiro', 'Administradores'],
    });
    renderizar(<Sistema />, { caminho: '/sistema' });
    expect(await screen.findByText('Na demonstração, o sistema é o Horizonte')).toBeTruthy();
    expect(screen.getByText('Pela API do sistema')).toBeTruthy();
    expect(screen.getByText('https://api.horizonte.com.br')).toBeTruthy();
    expect(await screen.findByText('Administradores')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'crie a conta da sua empresa' }).getAttribute('href')).toBe('/criar-conta');
    expect(screen.queryByRole('button', { name: 'Salvar sistema' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(pedidos.some((p) => p.metodo !== 'GET')).toBe(false);
  });

  it('regras dos perfis', () => {
    expect(erroPerfil('  ', [])).toBe('Digite o nome do perfil.');
    expect(erroPerfil('x'.repeat(51), [])).toBe('Cada perfil pode ter até 50 caracteres.');
    expect(erroPerfil('Novo', Array.from({ length: 50 }, (_, i) => `P${i}`))).toBe('Use no máximo 50 perfis.');
    expect(erroPerfil('Suporte', ['Comercial'])).toBeNull();
  });
});

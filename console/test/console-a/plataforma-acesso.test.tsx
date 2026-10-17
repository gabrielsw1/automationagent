// Acesso à Plataforma Starta: A7 (e-mail e senha, depois o código do aplicativo ou de recuperação),
// a ativação pelo link (QR code, senha, código e os códigos de recuperação uma vez só) e o aviso de
// códigos acabando logo depois de entrar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AtivacaoStarta, EuStarta, PainelEmpresas } from '@copiloto/shared';
import { ProvedorToast } from '../../src/componentes/Toast.tsx';
import AreaPlataforma from '../../src/paginas/plataforma/AreaPlataforma.tsx';
import AtivarPlataforma, { emBlocos } from '../../src/paginas/plataforma/AtivarPlataforma.tsx';
import EntrarPlataforma from '../../src/paginas/plataforma/EntrarPlataforma.tsx';
import { destinoNaPlataforma } from '../../src/paginas/plataforma/MolduraAcesso.tsx';
import { instalarFetch, status } from './ambiente.tsx';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EU: EuStarta = { id: 'stp_gm', nome: 'Gabriel Moreno', email: 'gabriel@starta.site', iniciais: 'GM', codigosRecuperacao: 10 };
const SEM_SESSAO = status(401, { erro: 'nao_autenticado', mensagem: 'Entre na plataforma para continuar.' });
const PAINEL: PainelEmpresas = {
  resumo: { ativas: 0, emImplantacao: 0, pausadas: 0, emPiloto: { total: 0, nomes: [] }, execucoes30d: 0, margemPorCredito: null, ate: '2026-10-17T15:00:00.000Z' },
  empresas: [],
};

let localAtual = '';
function Espiao() {
  const l = useLocation();
  localAtual = l.pathname + l.search;
  return null;
}

/** As telas de acesso e a área da Plataforma, como no App. */
function abrir(caminho: string) {
  return render(
    <ProvedorToast>
      <MemoryRouter initialEntries={[caminho]}>
        <Espiao />
        <Routes>
          <Route path="/plataforma/entrar" element={<EntrarPlataforma />} />
          <Route path="/plataforma/ativar/:token" element={<AtivarPlataforma />} />
          <Route path="/plataforma/*" element={<AreaPlataforma />} />
          <Route path="*" element={<div>outra página</div>} />
        </Routes>
      </MemoryRouter>
    </ProvedorToast>,
  );
}

/** Rotas da área (para quando a entrada leva até ela). */
const AREA = { 'GET /api/plataforma/empresas': PAINEL, 'GET /api/plataforma/saude': [] };

async function etapa1(email = 'gabriel@starta.site', senha = 'segredo-da-equipe') {
  await screen.findByRole('heading', { name: 'Entrar na plataforma' });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('A7 · Entrar na plataforma', () => {
  it('etapa 1 e etapa 2 com o código do aplicativo, voltando para onde a pessoa ia', async () => {
    let entrou = false;
    const { pedidos } = instalarFetch({
      ...AREA,
      'GET /api/plataforma/auth/eu': () => (entrou ? EU : SEM_SESSAO),
      'POST /api/plataforma/auth/entrar': { etapa: 'codigo', pessoa: { nome: 'Gabriel Moreno', iniciais: 'GM' } },
      'POST /api/plataforma/auth/codigo': () => ((entrou = true), EU),
    });
    abrir('/plataforma/entrar?voltar=%2Fplataforma%2Fsaude');
    expect(await screen.findByText('Etapa 1 de 2')).toBeTruthy();
    expect(screen.getByText('Plataforma Starta · acesso restrito à equipe')).toBeTruthy();
    expect(screen.getByText('Painel interno da Starta para cuidar das empresas clientes.')).toBeTruthy();
    expect(screen.getByText(/Peça a outro Admin da plataforma para redefinir o seu acesso/)).toBeTruthy();
    expect(screen.getByText('Todo acesso à plataforma fica registrado.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mostrar' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('alert').textContent).toContain('Digite o e-mail e a senha.');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    await etapa1();
    expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeTruthy();
    expect(screen.getByText('Etapa 2 de 2')).toBeTruthy();
    expect(screen.getByText('Gabriel Moreno')).toBeTruthy();
    expect(screen.getByText('GM')).toBeTruthy();
    expect(screen.getByText('Digite o código de 6 dígitos do seu aplicativo autenticador.')).toBeTruthy();
    expect(screen.getByText('O código muda a cada 30 segundos. Use o que estiver na tela agora.')).toBeTruthy();
    expect(pedidos.find((p) => p.caminho === '/api/plataforma/auth/entrar')?.corpo).toEqual({ email: 'gabriel@starta.site', senha: 'segredo-da-equipe' });

    const codigo = screen.getByLabelText('Código do autenticador') as HTMLInputElement;
    fireEvent.change(codigo, { target: { value: '12a34' } });
    expect(codigo.value).toBe('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    expect(screen.getByRole('alert').textContent).toContain('Digite os 6 dígitos');
    fireEvent.change(codigo, { target: { value: '318604' } });
    fireEvent.click(screen.getByLabelText('Confiar neste aparelho por 30 dias'));
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    await waitFor(() => expect(localAtual).toBe('/plataforma/saude'));
    expect(pedidos.find((p) => p.caminho === '/api/plataforma/auth/codigo')?.corpo).toEqual({ codigo: '318604', tipo: 'aplicativo', confiarAparelho: true });
    expect(await screen.findByRole('heading', { name: 'Saúde dos fluxos' })).toBeTruthy();
    // Com 10 códigos de recuperação, nada de aviso.
    expect(screen.queryByText(/códigos de recuperação\. Gere/)).toBeNull();
  });

  it('código incorreto diz quantas tentativas restam e o que conferir', async () => {
    instalarFetch({
      'GET /api/plataforma/auth/eu': SEM_SESSAO,
      'POST /api/plataforma/auth/entrar': { etapa: 'codigo', pessoa: { nome: 'Gabriel Moreno', iniciais: 'GM' } },
      'POST /api/plataforma/auth/codigo': status(400, { erro: 'codigo_incorreto', mensagem: 'Código incorreto. Restam 4 tentativas.', restantes: 4 }),
    });
    abrir('/plataforma/entrar');
    await etapa1();
    const codigo = await screen.findByLabelText('Código do autenticador');
    fireEvent.change(codigo, { target: { value: '318640' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Código incorreto. Restam 4 tentativas.');
    expect(screen.getByText('Confira se o relógio do celular está certo e use o código que aparece agora no aplicativo.')).toBeTruthy();
    expect(codigo.getAttribute('aria-invalid')).toBe('true');
    expect(localAtual).toBe('/plataforma/entrar');
  });

  it('entra com um código de recuperação e volta para o código do aplicativo', async () => {
    const { pedidos } = instalarFetch({
      ...AREA,
      'GET /api/plataforma/auth/eu': SEM_SESSAO,
      'POST /api/plataforma/auth/entrar': { etapa: 'codigo', pessoa: { nome: 'Gabriel Moreno', iniciais: 'GM' } },
      'POST /api/plataforma/auth/codigo': EU,
    });
    abrir('/plataforma/entrar');
    await etapa1();
    fireEvent.click(await screen.findByRole('button', { name: 'Usar um código de recuperação' }));
    expect(screen.getByRole('heading', { name: 'Usar um código de recuperação' })).toBeTruthy();
    expect(screen.getByText('Use um dos códigos que você guardou quando ativou a verificação em duas etapas.')).toBeTruthy();
    expect(screen.getByText('Cada código funciona uma vez só. Depois de entrar, gere códigos novos se estiverem acabando.')).toBeTruthy();
    expect(screen.queryByLabelText('Confiar neste aparelho por 30 dias')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para o código do aplicativo' }));
    expect(screen.getByRole('heading', { name: 'Verificação em duas etapas' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Usar um código de recuperação' }));

    const campo = screen.getByLabelText('Código de recuperação', { selector: 'input' }) as HTMLInputElement;
    expect(campo.placeholder).toBe('XXXX-XXXX');
    fireEvent.change(campo, { target: { value: 'k7qd-m2wp' } });
    expect(campo.value).toBe('K7QD-M2WP');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    await waitFor(() => expect(localAtual).toBe('/plataforma'));
    expect(pedidos.find((p) => p.caminho === '/api/plataforma/auth/codigo')?.corpo).toEqual({ codigo: 'K7QD-M2WP', tipo: 'recuperacao', confiarAparelho: false });
  });

  it('5 códigos errados: volta à etapa 1 com o aviso e o e-mail preenchido', async () => {
    instalarFetch({
      'GET /api/plataforma/auth/eu': SEM_SESSAO,
      'POST /api/plataforma/auth/entrar': { etapa: 'codigo', pessoa: { nome: 'Gabriel Moreno', iniciais: 'GM' } },
      'POST /api/plataforma/auth/codigo': status(401, { erro: 'recomecar', mensagem: 'Foram 5 códigos incorretos. Por segurança, digite o e-mail e a senha de novo.' }),
    });
    abrir('/plataforma/entrar');
    await etapa1();
    fireEvent.change(await screen.findByLabelText('Código do autenticador'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    expect(await screen.findByRole('heading', { name: 'Entrar na plataforma' })).toBeTruthy();
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Foram 5 códigos incorretos. Por segurança, digite o e-mail e a senha de novo.');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('gabriel@starta.site');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
  });

  it('senha errada e bloqueio depois de 5 tentativas', async () => {
    const ate = new Date(Date.now() + 15 * 60_000).toISOString();
    let tentativas = 0;
    instalarFetch({
      'GET /api/plataforma/auth/eu': SEM_SESSAO,
      'POST /api/plataforma/auth/entrar': () =>
        ++tentativas < 2
          ? status(401, { erro: 'credenciais', mensagem: 'E-mail ou senha incorretos. Confira e tente de novo.' })
          : status(423, { erro: 'bloqueado', mensagem: 'Por segurança, o acesso ficou bloqueado por 15 minutos.', ate }),
    });
    abrir('/plataforma/entrar');
    await etapa1('gabriel@starta.site', 'errada');
    expect((await screen.findByRole('alert')).textContent).toContain('E-mail ou senha incorretos.');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada de novo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    const alerta = await screen.findByText('Por segurança, o acesso ficou bloqueado por 15 minutos.');
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ate));
    expect(alerta.closest('[role="alert"]')?.textContent).toContain(`Tente de novo às ${hora}`);
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true);
    // Outro e-mail não está bloqueado.
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'outra@starta.site' } });
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('aparelho confiável pula a etapa 2', async () => {
    let entrou = false;
    const { pedidos } = instalarFetch({
      ...AREA,
      'GET /api/plataforma/auth/eu': () => (entrou ? EU : SEM_SESSAO),
      'POST /api/plataforma/auth/entrar': () => ((entrou = true), { etapa: 'completa', eu: EU }),
    });
    abrir('/plataforma/entrar');
    await etapa1();
    expect(await screen.findByRole('heading', { name: 'Empresas clientes' })).toBeTruthy();
    expect(localAtual).toBe('/plataforma');
    expect(pedidos.some((p) => p.caminho === '/api/plataforma/auth/codigo')).toBe(false);
  });

  it('quem já entrou vai direto para a Plataforma; ?voltar= só vale dentro dela', async () => {
    instalarFetch({ ...AREA, 'GET /api/plataforma/auth/eu': EU });
    abrir('/plataforma/entrar?voltar=%2F%2Fexemplo.com');
    expect(await screen.findByRole('heading', { name: 'Empresas clientes' })).toBeTruthy();
    expect(localAtual).toBe('/plataforma');
    expect(destinoNaPlataforma('/plataforma/uso?dias=7')).toBe('/plataforma/uso?dias=7');
    expect(destinoNaPlataforma('/painel')).toBe('/plataforma');
    expect(destinoNaPlataforma('/plataformaX')).toBe('/plataforma');
    expect(destinoNaPlataforma('/plataforma/entrar')).toBe('/plataforma');
    expect(destinoNaPlataforma('/plataforma/ativar/abc')).toBe('/plataforma');
    expect(destinoNaPlataforma(null)).toBe('/plataforma');
  });

  it('com 2 códigos de recuperação ou menos, avisa depois de entrar e oferece gerar novos', async () => {
    let entrou = false;
    const eu = { ...EU, codigosRecuperacao: 2 };
    instalarFetch({
      ...AREA,
      'GET /api/plataforma/auth/eu': () => (entrou ? eu : SEM_SESSAO),
      'POST /api/plataforma/auth/entrar': { etapa: 'codigo', pessoa: { nome: 'Gabriel Moreno', iniciais: 'GM' } },
      'POST /api/plataforma/auth/codigo': () => ((entrou = true), eu),
    });
    abrir('/plataforma/entrar');
    await etapa1();
    fireEvent.change(await screen.findByLabelText('Código do autenticador'), { target: { value: '318604' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    const aviso = await screen.findByText('Restam 2 códigos de recuperação. Gere códigos novos para não ficar sem acesso se perder o celular.');
    expect(screen.getAllByText(/Restam 2 códigos de recuperação/)).toHaveLength(1);
    fireEvent.click(within(aviso.closest('.toast') as HTMLElement).getByRole('button', { name: 'Gerar códigos novos' }));
    expect(await screen.findByRole('dialog', { name: 'Meus códigos de recuperação' })).toBeTruthy();
  });
});

const ATIVACAO: AtivacaoStarta = {
  nome: 'Milena Teodoro',
  email: 'milena@starta.site',
  segredo: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Copiloto%20Starta:milena%40starta.site?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  expiraEm: '2026-10-24T15:00:00.000Z',
};
const CODIGOS = ['K7QD-M2WP', 'A3C4-VRCE', 'NR78-K7VS', 'RMX2-L6A3', '77YQ-DEE3', 'RXMD-FYJ7', 'KF6N-UESD', 'RSF9-PTKN', 'PCPD-ZF5U', 'AF2S-2NA4'];

describe('Ativação do acesso à Plataforma', () => {
  it('link vencido ou já usado', async () => {
    instalarFetch({
      'GET /api/plataforma/auth/ativar/velho': status(410, { erro: 'link_expirado', mensagem: 'Este link expirou ou já foi usado. Peça a um Admin da plataforma para enviar outro.' }),
    });
    abrir('/plataforma/ativar/velho');
    expect(await screen.findByRole('heading', { name: 'Este link expirou ou já foi usado.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para a entrada da plataforma' }).getAttribute('href')).toBe('/plataforma/entrar');
    expect(screen.queryByLabelText(/Senha/)).toBeNull();
  });

  it('QR code como imagem, chave em blocos de 4, senha e código; os códigos aparecem uma vez só', async () => {
    let usado = false;
    let tentativas = 0;
    const { pedidos } = instalarFetch({
      ...AREA,
      'GET /api/plataforma/auth/eu': EU,
      'GET /api/plataforma/auth/ativar/tok': () => (usado ? status(410, { erro: 'link_expirado', mensagem: 'Este link expirou ou já foi usado.' }) : ATIVACAO),
      'POST /api/plataforma/auth/ativar/tok': () =>
        ++tentativas === 1
          ? status(400, {
              erro: 'codigo_incorreto',
              mensagem: 'Código incorreto. Confira se o relógio do celular está certo e use o código que aparece agora no aplicativo.',
            })
          : ((usado = true), { eu: { ...EU, nome: 'Milena Teodoro', email: 'milena@starta.site' }, codigosRecuperacao: CODIGOS }),
    });
    const { unmount } = abrir('/plataforma/ativar/tok');
    expect(await screen.findByRole('heading', { name: 'Ativar o seu acesso' })).toBeTruthy();
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('milena@starta.site');
    // O SVG do servidor entra como imagem (data:), nunca como HTML da página.
    const qr = screen.getByRole('img', { name: /QR code/ }) as HTMLImageElement;
    expect(qr.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(document.querySelector('svg[viewBox="0 0 10 10"]')).toBeNull();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(emBlocos('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');

    // Sem senha e sem código: nada vai para o servidor.
    fireEvent.click(screen.getByRole('button', { name: 'Ativar acesso' }));
    expect(screen.getByText('Pelo menos 8 caracteres').closest('li')?.className).toContain('text-danger');
    expect(screen.getByText('Digite os 6 dígitos que aparecem agora no aplicativo.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'segredo-da-milena' } });
    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: 'outra coisa' } });
    fireEvent.change(screen.getByLabelText('Código do autenticador'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar acesso' }));
    expect(screen.getByText('As senhas não são iguais. Digite a mesma senha nos dois campos.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: 'segredo-da-milena' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar acesso' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Código incorreto. Confira se o relógio do celular está certo');

    fireEvent.change(screen.getByLabelText('Código do autenticador'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar acesso' }));
    expect(await screen.findByRole('heading', { name: 'Guarde os seus códigos de recuperação' })).toBeTruthy();
    expect(pedidos.filter((p) => p.metodo === 'POST').at(-1)?.corpo).toEqual({ senha: 'segredo-da-milena', codigo: '654321' });
    const lista = screen.getByRole('list', { name: 'Códigos de recuperação' });
    expect(within(lista).getAllByRole('listitem').map((l) => l.textContent)).toEqual(CODIGOS);
    expect(screen.getByRole('button', { name: 'Copiar códigos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar .txt' })).toBeTruthy();
    const entrar = screen.getByRole('button', { name: 'Entrar na plataforma' }) as HTMLButtonElement;
    expect(entrar.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Guardei os códigos em lugar seguro'));
    expect(entrar.disabled).toBe(false);
    fireEvent.click(entrar);
    expect(await screen.findByRole('heading', { name: 'Empresas clientes' })).toBeTruthy();
    expect(screen.queryByText('K7QD-M2WP')).toBeNull();

    // Abrir o mesmo link de novo não mostra os códigos: o link já foi usado.
    unmount();
    abrir('/plataforma/ativar/tok');
    expect(await screen.findByRole('heading', { name: 'Este link expirou ou já foi usado.' })).toBeTruthy();
    expect(screen.queryByText('K7QD-M2WP')).toBeNull();
  });
});

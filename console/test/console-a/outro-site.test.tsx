// Passos gravados em outro site (fora do sistema): na revisão, cada um pede "Remover" ou "Manter como
// instrução"; até a escolha, o fluxo não testa nem publica, e o Antes de publicar mostra o item.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Fluxo, PassoFluxo } from '@copiloto/shared';
import { EtapaRevisar } from '../../src/paginas/aprender/EtapaRevisar.tsx';
import { EtapaPublicar, resumoOutrosSites } from '../../src/paginas/aprender/EtapaPublicar.tsx';
import { EtapaTestar } from '../../src/paginas/aprender/EtapaTestar.tsx';
import { instalarFetch, renderizar } from './ambiente.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sel = (s: string) => [{ seletor: s, estabilidade: 'estavel' as const, motivo: 'usa o nome do campo' }];

function passos(): PassoFluxo[] {
  return [
    { n: 1, tipo: 'navegar', titulo: 'Abrir Clientes', url: '/clientes', seletores: [], seletorEscolhido: 0 },
    {
      n: 2,
      tipo: 'preencher',
      titulo: 'Consultar o CNPJ',
      url: 'https://www.consultacnpj.com.br/',
      seletores: sel('input[name="cnpj"]'),
      seletorEscolhido: 0,
      formatoGravado: '99.999.999/9999-99',
      outroSite: 'www.consultacnpj.com.br',
    },
    { n: 3, tipo: 'clique', titulo: 'Clicar em Salvar', url: '/clientes/novo', seletores: sel('role=button[name="Salvar"]'), seletorEscolhido: 0 },
  ];
}

function fluxo(p: Partial<Fluxo> = {}): Fluxo {
  return {
    id: 'flu-1',
    nome: 'Cadastrar cliente',
    tarefaId: null,
    etapa: 'revisar',
    status: 'rascunho',
    versao: 1,
    passos: passos(),
    camposSugeridos: [],
    gravadoPor: 'Rafael Lima',
    gravadoEm: '2026-10-17T12:00:00.000Z',
    duracaoGravacaoMs: 60_000,
    urlInicial: '/clientes',
    ultimoTeste: null,
    salvoEm: '2026-10-17T12:01:00.000Z',
    ...p,
  };
}

function Revisao({ inicial }: { inicial: Fluxo }) {
  const [f, setF] = useState(inicial);
  const [sel, setSel] = useState(1);
  return (
    <EtapaRevisar
      fluxo={f}
      campos={[]}
      nomeSistema="Horizonte"
      somenteLeitura={false}
      online
      selecionado={sel}
      aoSelecionar={setSel}
      salvarPassos={async (lista) => {
        setF((x) => ({ ...x, passos: lista }));
        return true;
      }}
      aoAtualizar={setF}
      aoGravarDeNovo={() => {}}
      aoOrganizar={() => {}}
      aoContinuar={() => {}}
    />
  );
}

describe('Revisão · passo em outro site', () => {
  it('marca o passo e oferece Remover e Manter como instrução', async () => {
    const { pedidos } = instalarFetch({
      'POST /fluxos/flu-1/passos/2/outro-site': (p: { corpo: { decisao: string } }) =>
        p.corpo.decisao === 'instrucao'
          ? fluxo({ passos: passos().map((x) => (x.n === 2 ? { ...x, instrucao: true } : x)) })
          : fluxo({ passos: passos().map((x) => (x.n === 2 ? { ...x, instrucao: undefined } : x)) }),
    });
    renderizar(<Revisao inicial={fluxo()} />);

    // Selo na lista e o aviso acima do detalhe (o passo 1 está aberto).
    expect(screen.getAllByText('Outro site').length).toBeGreaterThan(0);
    expect(screen.getByText('Passo 2 foi feito em outro site: www.consultacnpj.com.br')).toBeTruthy();
    expect(screen.getByText(/O copiloto só repete os passos no Horizonte/)).toBeTruthy();
    expect(screen.getByText('Falta escolher o que fazer com o passo em outro site.')).toBeTruthy();

    const grupo = screen.getByRole('group', { name: /Passo 2 foi feito em outro site/ });
    fireEvent.click(within(grupo).getByRole('button', { name: 'Manter como instrução' }));
    await waitFor(() => expect(pedidos.at(-1)?.corpo).toEqual({ decisao: 'instrucao' }));
    expect(await screen.findByText('Passo 2 fica como instrução para a pessoa.')).toBeTruthy();
    expect(screen.queryByText('Falta escolher o que fazer com o passo em outro site.')).toBeNull();
    expect(screen.getAllByText('Instrução').length).toBeGreaterThan(0);

    // No detalhe do passo 2: pode escolher de novo.
    fireEvent.click(screen.getByRole('button', { name: /Consultar o CNPJ/ }));
    expect(await screen.findByText('Passo 2 fica como instrução')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Escolher de novo' }));
    await waitFor(() => expect(pedidos.at(-1)?.corpo).toEqual({ decisao: 'desfazer' }));
    expect(await screen.findByRole('group', { name: /Passo 2 foi feito em outro site/ })).toBeTruthy();
    // Passo em outro site não mostra o jeito de achar o elemento nem "Remover este passo".
    expect(screen.queryByRole('button', { name: 'Remover este passo' })).toBeNull();
  });

  it('Remover tira o passo e o toast oferece Desfazer', async () => {
    const semOutro = fluxo({
      passos: [passos()[0], { ...passos()[2], n: 2 }],
      outrosSitesRemovidos: [{ titulo: 'Consultar o CNPJ', site: 'www.consultacnpj.com.br' }],
    });
    const { pedidos } = instalarFetch({ 'POST /fluxos/flu-1/passos/2/outro-site': semOutro });
    renderizar(<Revisao inicial={fluxo()} />);
    const grupo = screen.getByRole('group', { name: /Passo 2 foi feito em outro site/ });
    fireEvent.click(within(grupo).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('Passo 2 removido: Consultar o CNPJ.')).toBeTruthy();
    expect(pedidos.at(-1)?.corpo).toEqual({ decisao: 'remover' });
    expect(screen.queryByRole('group', { name: /outro site/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
  });
});

describe('Antes de publicar · passo em outro site', () => {
  it('resumo: falta, removido e mantido como instrução', () => {
    expect(resumoOutrosSites(fluxo({ passos: passos().filter((p) => !p.outroSite) }))).toBeNull();
    expect(resumoOutrosSites(fluxo())).toMatchObject({ ok: false, titulo: 'Falta resolver o passo em outro site' });
    expect(resumoOutrosSites(fluxo({ passos: [passos()[0]], outrosSitesRemovidos: [{ titulo: 'Consultar o CNPJ', site: 'www.consultacnpj.com.br' }] }))).toEqual({
      ok: true,
      titulo: 'Passo em outro site resolvido',
      texto: 'Passo em www.consultacnpj.com.br removido',
    });
    expect(resumoOutrosSites(fluxo({ passos: passos().map((p) => (p.outroSite ? { ...p, instrucao: true } : p)) }))?.texto).toBe('1 mantido como instrução');
  });

  it('bloqueia publicar até resolver; depois mostra o item resolvido', () => {
    const testado = { ultimoTeste: { em: '2026-10-17T12:05:00.000Z', ok: true } };
    const aoIrPara = vi.fn();
    const props = { nomeSistema: 'Horizonte', nomeTarefa: null, somenteLeitura: false, online: true, aoPublicado: () => {}, aoIrPara };
    renderizar(<EtapaPublicar fluxo={fluxo(testado)} {...props} />);
    expect(screen.getByText('Falta resolver o passo em outro site')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Publicar/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Resolver na revisão' }));
    expect(aoIrPara).toHaveBeenCalledWith('revisar');

    const resolvido = fluxo({ ...testado, passos: passos().map((p) => (p.outroSite ? { ...p, instrucao: true } : p)) });
    cleanup();
    renderizar(<EtapaPublicar fluxo={resolvido} {...props} />);
    expect(screen.getByText('Passo em outro site resolvido')).toBeTruthy();
    expect(screen.getByText('2 passos no Horizonte, sem pendência')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Publicar/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Testar · passo em outro site', () => {
  it('não deixa testar com passo pendente e leva à revisão', async () => {
    instalarFetch({ 'GET /sistema/usuarios': [{ id: '101', nome: 'Rafael Lima', email: 'rafael.lima@seusistema.com.br', perfis: ['Comercial'] }] });
    const aoRevisarPasso = vi.fn();
    const tela = (f: Fluxo) => (
      <EtapaTestar
        fluxo={f}
        campos={[]}
        nomeSistema="Horizonte"
        podeTestar
        online
        aoTestado={() => {}}
        aoRevisarPasso={aoRevisarPasso}
        aoVoltar={() => {}}
        aoContinuar={() => {}}
      />
    );
    renderizar(tela(fluxo()));
    expect(screen.getByText('Resolva o passo feito em outro site antes de testar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resolver na revisão' }));
    expect(aoRevisarPasso).toHaveBeenCalledWith(2);
    const rodar = () => screen.getByRole('button', { name: 'Rodar teste' }) as HTMLButtonElement;
    // A pessoa do teste já vem escolhida; só o passo em outro site segura o botão.
    await waitFor(() => expect((screen.getByLabelText(/Rodar como/) as HTMLSelectElement).value).toBe('101'));
    expect(rodar().disabled).toBe(true);

    cleanup();
    renderizar(
      tela(fluxo({ passos: passos().map((p) => (p.outroSite ? { ...p, instrucao: true } : p)), ultimoTeste: { em: '2026-10-17T12:05:00.000Z', ok: true } })),
    );
    await waitFor(() => expect((screen.getByLabelText(/Rodar como/) as HTMLSelectElement).value).toBe('101'));
    expect(screen.queryByText('Resolva o passo feito em outro site antes de testar')).toBeNull();
    expect(rodar().disabled).toBe(false);
    expect(screen.getByText(/Instrução em www.consultacnpj.com.br/)).toBeTruthy();
  });
});

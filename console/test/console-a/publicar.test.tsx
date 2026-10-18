// Aprender fluxo · Publicar (F3): resumo com "Custo previsto" pelas constantes de créditos, quem pode
// usar, onde aparece, "Antes de publicar" e o estado depois de publicar (tarefa ativa).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { CREDITOS_COM_CONSERTO, CREDITOS_POR_ROTEIRO, fmt, type Campo, type Fluxo, type FluxoPublicado, type TarefaDetalhe } from '@copiloto/shared';
import Assistente from '../../src/paginas/aprender/Assistente.tsx';
import { EtapaPublicar } from '../../src/paginas/aprender/EtapaPublicar.tsx';
import { definicao, detalhe, instalarEventSource, instalarFetch, renderizar } from './ambiente.tsx';

beforeEach(() => instalarEventSource());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CAMPOS: Campo[] = [
  { chave: 'assunto', rotulo: 'Assunto', tipo: 'texto', obrigatorio: true, pergunta: 'Qual é o assunto?' },
  { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, pergunta: 'Para qual cliente?' },
  { chave: 'prioridade', rotulo: 'Prioridade', tipo: 'lista', obrigatorio: true, pergunta: 'Qual a prioridade?', opcoes: ['Baixa', 'Alta'] },
  { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, pergunta: 'Descreva o problema.' },
];

const TESTE_EM = new Date(Date.now() - 2 * 60_000).toISOString();

function fluxo(p: Partial<Fluxo> = {}): Fluxo {
  const preencher = (n: number, campo: string) => ({
    n,
    tipo: 'preencher' as const,
    titulo: `Preencher ${campo}`,
    seletores: [{ seletor: `[name="${campo}"]`, estabilidade: 'estavel' as const, motivo: 'nome interno' }],
    seletorEscolhido: 0,
    valor: { origem: 'campo' as const, campo },
  });
  return {
    id: 'flx-1',
    nome: 'Abrir chamado',
    tarefaId: 'tar-ch',
    etapa: 'publicar',
    status: 'rascunho',
    versao: 1,
    passos: [
      { n: 1, tipo: 'navegar', titulo: 'Abrir Chamados', url: '/chamados', seletores: [], seletorEscolhido: 0 },
      preencher(2, 'assunto'),
      preencher(3, 'cliente'),
      { ...preencher(4, 'prioridade'), tipo: 'selecionar' },
      preencher(5, 'descricao'),
      {
        n: 6,
        tipo: 'clique',
        titulo: 'Clicar em Abrir chamado',
        seletores: [{ seletor: 'role=button[name="Abrir chamado"]', estabilidade: 'estavel', motivo: 'texto do botão' }],
        seletorEscolhido: 0,
      },
    ],
    camposSugeridos: [],
    gravadoPor: 'Rafael Lima',
    gravadoEm: TESTE_EM,
    duracaoGravacaoMs: 40_000,
    urlInicial: '/chamados',
    resultado: null,
    ultimoTeste: {
      em: TESTE_EM,
      ok: true,
      duracaoMs: 8_000,
      usuarioNome: 'Ana Ribeiro',
      registro: { numero: 'CH-2026-0153', nome: 'Chamado', artigo: 'o', texto: 'Chamado CH-2026-0153 aberto.', origem: 'aviso' },
    },
    salvoEm: TESTE_EM,
    ...p,
  };
}

function tarefaChamado(p: Partial<TarefaDetalhe> = {}, caminho: 'api' | 'navegador' = 'navegador'): TarefaDetalhe {
  const def = definicao({
    nome: 'Abrir chamado',
    campos: CAMPOS,
    caminho,
    fluxoId: null,
    perfisPermitidos: [],
    usarFluxoSeApiFalhar: false,
  });
  return detalhe({
    id: 'tar-ch',
    slug: 'abrir-chamado',
    status: 'rascunho',
    publicada: null,
    rascunho: { versao: 1, definicao: def, alteracoes: 1, salvoEm: TESTE_EM },
    historico: [],
    perfisSistema: ['Gestão comercial', 'Atendimento', 'Financeiro', 'Administração'],
    ...p,
  });
}

const CANAIS = { instalacao: { origem: 'https://app.horizonte.com.br', vistoEm: TESTE_EM } };

describe('F3 · Publicar', () => {
  it('mostra o resumo do design com o custo previsto pelas constantes de créditos', async () => {
    instalarFetch({ 'GET /fluxos/flx-1': fluxo(), 'GET /tarefas/tar-ch': tarefaChamado(), 'GET /canais': CANAIS });
    renderizar(<Assistente fluxoId="flx-1" />, { caminho: '/aprender/flx-1' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Publicar · Abrir chamado' })).toBeTruthy();
    expect(screen.getByText('Confira o que a tarefa faz, quem pode pedir e onde ela aparece. Depois de publicar, você muda tudo isso na ficha da tarefa.')).toBeTruthy();
    expect(screen.getByText(`Rascunho salvo às ${fmt.hora(TESTE_EM)}`)).toBeTruthy();

    const resumo = await screen.findByRole('region', { name: 'Resumo da tarefa' });
    const valor = (rotulo: string) => within(resumo).getByText(rotulo).nextElementSibling?.textContent;
    expect(within(resumo).getByText('Versão 1')).toBeTruthy();
    expect(valor('Tarefa')).toBe('Abrir chamado');
    expect(valor('O copiloto vai pedir')).toBe('AssuntoClientePrioridadeDescrição');
    expect(valor('Como executa')).toContain('Pela tela, com o roteiro gravado. Se a tela mudar, o conserto automático tenta e avisa você.');
    // Pela tela: o número vem de CREDITOS_POR_ROTEIRO e CREDITOS_COM_CONSERTO.
    expect(valor('Custo previsto')).toBe(`${CREDITOS_POR_ROTEIRO} crédito por execução, até ${CREDITOS_COM_CONSERTO} se precisar de conserto`);
    expect(valor('Custo previsto')).toBe('1 crédito por execução, até 5 se precisar de conserto');
    expect(valor('Último teste')).toBe(`Deu certo${fmt.quando(TESTE_EM)}, como Ana Ribeiro, em 8 s`);

    // Antes de publicar, com o número que o teste leu da tela.
    const pronto = screen.getByRole('region', { name: 'Antes de publicar' });
    expect(within(pronto).getByText('6 passos no Horizonte')).toBeTruthy();
    expect(within(pronto).getByText('4 dados, todos obrigatórios')).toBeTruthy();
    expect(within(pronto).getByText('Chamado CH-2026-0153, em 8 s')).toBeTruthy();
    expect(screen.getByText('Você pode pausar a tarefa ou voltar para uma versão anterior na ficha da tarefa, sem gravar de novo.')).toBeTruthy();

    // Quem pode usar e onde aparece.
    expect((screen.getByLabelText('Todos os perfis') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Atendimento') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Mostrar no widget') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Widget no Horizonte')).toBeTruthy();
    expect((screen.getByLabelText('Pedir confirmação antes de executar, sempre ligado') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Publicar versão 1' })).toBeTruthy();
  });

  it('tarefa pela API: custo de 1 crédito por execução', async () => {
    instalarFetch({ 'GET /canais': CANAIS });
    renderizar(
      <EtapaPublicar
        fluxo={fluxo()}
        tarefa={tarefaChamado({}, 'api')}
        campos={CAMPOS}
        nomeSistema="Horizonte"
        somenteLeitura={false}
        online
        aoPublicado={() => {}}
        aoTarefaMudou={() => {}}
        aoIrPara={() => {}}
      />,
    );
    const resumo = screen.getByRole('region', { name: 'Resumo da tarefa' });
    expect(within(resumo).getByText('Custo previsto').nextElementSibling?.textContent).toBe('1 crédito por execução');
    expect(within(resumo).getByText('API')).toBeTruthy();
  });

  it('publica com o widget ligado e mostra a tarefa ativa', async () => {
    const def = tarefaChamado().rascunho!.definicao;
    const publicadoEm = new Date().toISOString();
    const depois = tarefaChamado({
      status: 'ativa',
      rascunho: null,
      publicada: { versao: 1, definicao: { ...def, fluxoId: 'flx-1' }, publicadoPor: 'Rafael Lima', publicadoEm },
    });
    let publicada = false;
    const resposta: FluxoPublicado = {
      fluxo: fluxo({ status: 'publicado' }),
      tarefa: { id: 'tar-ch', nome: 'Abrir chamado', status: 'ativa', versao: 1, ativada: true, publicadoPor: 'Rafael Lima', publicadoEm },
    };
    const { pedidos } = instalarFetch({
      'GET /fluxos/flx-1': () => (publicada ? resposta.fluxo : fluxo()),
      'GET /tarefas/tar-ch': () => (publicada ? depois : tarefaChamado()),
      'GET /canais': CANAIS,
      'POST /fluxos/flx-1/publicar': () => {
        publicada = true;
        return resposta;
      },
    });
    renderizar(<Assistente fluxoId="flx-1" />, { caminho: '/aprender/flx-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar versão 1' }));

    const aviso = await screen.findByText('Abrir chamado está ativa. Ana já pode pedir pelo widget.');
    const toast = aviso.closest('.toast') as HTMLElement;
    expect(within(toast).getByRole('button', { name: 'Abrir a ficha da tarefa' })).toBeTruthy();
    expect(within(toast).getByRole('button', { name: 'Ver no widget' })).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ ativar: true, perfis: [] });

    const estado = await screen.findByRole('region', { name: 'Abrir chamado' });
    await waitFor(() => expect(within(estado).getByText('Ativa')).toBeTruthy());
    expect(within(estado).getByText('Versão 1')).toBeTruthy();
    expect(within(estado).getByText(`Publicada por Rafael Lima hoje às ${fmt.hora(publicadoEm)}`)).toBeTruthy();
  });

  it('perfis escolhidos e widget desligado vão no pedido', async () => {
    const { pedidos } = instalarFetch({
      'GET /canais': CANAIS,
      'POST /fluxos/flx-1/publicar': {
        fluxo: fluxo({ status: 'publicado' }),
        tarefa: { id: 'tar-ch', nome: 'Abrir chamado', status: 'rascunho', versao: 1, ativada: false, publicadoPor: null, publicadoEm: null },
      },
    });
    renderizar(
      <EtapaPublicar
        fluxo={fluxo()}
        tarefa={tarefaChamado()}
        campos={CAMPOS}
        nomeSistema="Horizonte"
        somenteLeitura={false}
        online
        aoPublicado={() => {}}
        aoTarefaMudou={() => {}}
        aoIrPara={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Todos os perfis'));
    fireEvent.click(screen.getByLabelText('Financeiro'));
    fireEvent.click(screen.getByLabelText('Administração'));
    fireEvent.click(screen.getByLabelText('Mostrar no widget'));
    expect(screen.getByText('Desligado: o fluxo fica no rascunho da tarefa e o widget continua como está.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publicar versão 1' }));
    await waitFor(() => expect(pedidos.some((p) => p.metodo === 'POST')).toBe(true));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ ativar: false, perfis: ['Gestão comercial', 'Atendimento'] });
  });

  it('sem teste que deu certo, não publica', async () => {
    instalarFetch({ 'GET /canais': CANAIS });
    renderizar(
      <EtapaPublicar
        fluxo={fluxo({ ultimoTeste: { em: TESTE_EM, ok: false, passoFalhou: 6, erro: 'O botão não apareceu.' } })}
        tarefa={tarefaChamado()}
        campos={CAMPOS}
        nomeSistema="Horizonte"
        somenteLeitura={false}
        online
        aoPublicado={() => {}}
        aoTarefaMudou={() => {}}
        aoIrPara={() => {}}
      />,
    );
    expect(screen.getByText('Falta um teste que dê certo')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publicar versão 1' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// Plano e créditos (S5): o que a página mostra, o que fica desligado sem preço ou na demonstração,
// a compra de pacote, os dados de cobrança e o pedido de mudança de plano.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Fatura, PlanoECreditos, Plano as PlanoTipo } from '@copiloto/shared';
import Plano, { mascararEmail } from '../../src/paginas/plano/Plano.tsx';
import { instalarEventSource, instalarFetch, renderizar, status } from './ambiente.tsx';

beforeEach(() => instalarEventSource());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function plano(p: Partial<PlanoTipo> & Pick<PlanoTipo, 'id' | 'nome'>): PlanoTipo {
  return {
    ordem: 1,
    descricao: '',
    usuariosMin: 1,
    usuariosMax: 200,
    creditosIncluidos: 3000,
    pacoteCreditos: 1000,
    precoMensalCentavos: 99_000,
    taxaImplantacaoCentavos: 150_000,
    precoCreditoExtraCentavos: 40,
    notaPreco: '',
    destaques: [],
    botao: 'cadastro',
    atualizadoEm: '2026-10-01T12:00:00.000Z',
    ...p,
  };
}

const PILOTO = plano({ id: 'piloto', nome: 'Piloto' });
const CRESCIMENTO = plano({ id: 'crescimento', nome: 'Crescimento', ordem: 2, usuariosMin: 201, usuariosMax: 1000, creditosIncluidos: 15000, precoMensalCentavos: null });

const SETEMBRO: Fatura = {
  id: 'fat_set',
  empresaId: 'emp-clinica',
  competencia: '2026-09',
  tipo: 'mensal',
  itens: [
    { descricao: 'Assinatura Piloto', quantidade: 1, unitarioCentavos: 99_000, totalCentavos: 99_000 },
    { descricao: 'Créditos extras', quantidade: 180, unitarioCentavos: 40, totalCentavos: 7_200 },
  ],
  totalCentavos: 106_200,
  status: 'paga',
  vencimento: '2026-10-11',
  criadoEm: '2026-10-01T12:00:00.000Z',
  pagoEm: '2026-10-09T15:00:00.000Z',
  gateway: 'manual',
  urlPagamento: null,
  urlBoleto: null,
  urlNotaFiscal: null,
  creditos: null,
  automatica: false,
  exemplo: false,
};

function dados(p: Partial<PlanoECreditos> = {}): PlanoECreditos {
  return {
    empresa: { nome: 'Clínica Mais Agenda', cnpj: '11.222.333/0001-81', demo: false, faixaUsuarios: 'ate_200' },
    exemplo: false,
    plano: PILOTO,
    situacao: 'ativo',
    usuariosMes: 164,
    renovaEm: '2026-11-01T03:00:00.000Z',
    ciclo: {
      inicio: '2026-10-01T03:00:00.000Z',
      fim: '2026-11-01T03:00:00.000Z',
      competencia: '2026-10',
      incluidos: 3000,
      pacotes: 0,
      usados: 2140,
      creditosRoteiro: 1610,
      creditosConserto: 530,
      restantes: 860,
      extras: 0,
      valorExtrasCentavos: 0,
      porDia: 125.9,
      acabaEm: '2026-10-24T12:00:00.000Z',
    },
    uso: {
      atual: {
        inicio: '2026-10-01T03:00:00.000Z',
        ate: '2026-10-17T15:00:00.000Z',
        competencia: '2026-10',
        tarefas: [
          { tarefaId: 'trf_chamado', nome: 'Abrir chamado', execucoes: 640, roteiro: 632, conserto: 8, creditos: 672, consertoFrequente: false },
          { tarefaId: 'trf_visita', nome: 'Agendar visita técnica', execucoes: 236, roteiro: 150, conserto: 86, creditos: 580, consertoFrequente: true },
        ],
        total: { execucoes: 876, roteiro: 782, conserto: 94, creditos: 1252 },
        destaque: {
          tarefaId: 'trf_visita',
          nome: 'Agendar visita técnica',
          primeiroConserto: '2026-10-09T13:00:00.000Z',
          consertos: 86,
          execucoes: 236,
          creditosConserto: 430,
          fracaoCiclo: 0.2,
          creditosPeloRoteiro: 86,
          execucaoId: 'EX-20431',
          fluxoId: 'flx_visita',
        },
      },
      anterior: {
        inicio: '2026-09-01T03:00:00.000Z',
        ate: '2026-10-01T03:00:00.000Z',
        competencia: '2026-09',
        tarefas: [{ tarefaId: 'trf_boleto', nome: 'Segunda via de boleto', execucoes: 98, roteiro: 98, conserto: 0, creditos: 98, consertoFrequente: false }],
        total: { execucoes: 98, roteiro: 98, conserto: 0, creditos: 98 },
        destaque: null,
      },
    },
    faturaAberta: {
      competencia: '2026-10',
      itens: [{ descricao: 'Assinatura Piloto', quantidade: 1, unitarioCentavos: 99_000, totalCentavos: 99_000 }],
      totalCentavos: 99_000,
      fechaEm: '2026-11-01T02:59:59.999Z',
      disponivelEm: '2026-11-01T03:00:00.000Z',
    },
    faturas: [SETEMBRO],
    cobranca: { razaoSocial: 'Clínica Mais Agenda Ltda', cnpj: '11.222.333/0001-81', emailCobranca: 'financeiro@clinicamais.com.br', cep: null, numero: null, metodo: 'boleto', cartao: null },
    recarga: { ligada: false, limite: null },
    pacote: { creditos: 1000, precoCentavos: 40_000, pendente: null },
    pagamentos: { modo: 'manual', notaFiscal: false, cartaoGuardado: false },
    limiteMensal: 1500,
    pedidoMudanca: null,
    planos: [PILOTO, CRESCIMENTO],
    podeAlterar: true,
    motivoSomenteLeitura: null,
    ...p,
  };
}

describe('Plano e créditos', () => {
  it('mostra o plano, os créditos do ciclo, para onde foram e as faturas', async () => {
    instalarFetch({ 'GET /plano': dados() });
    renderizar(<Plano />, { caminho: '/plano' });
    expect(await screen.findByRole('heading', { name: 'Piloto' })).toBeTruthy();
    const plano = screen.getByRole('region', { name: 'Piloto' });
    expect(within(plano).getByText('R$ 990')).toBeTruthy();
    expect(within(plano).getByText('3.000 por mês')).toBeTruthy();
    expect(within(plano).getByText('R$ 0,40 por crédito')).toBeTruthy();
    expect(within(plano).getByText(/164 usaram o assistente este mês/)).toBeTruthy();
    expect(within(plano).getByText('01/11/2026')).toBeTruthy();
    expect(within(plano).getByRole('link', { name: 'Comparar planos' }).getAttribute('href')).toBe('/site#planos');

    const creditos = screen.getByRole('region', { name: /2\.140/ });
    expect(within(creditos).getByRole('progressbar').getAttribute('aria-valuetext')).toBe('2.140 de 3.000 créditos, 71%');
    expect(within(creditos).getByText('Pelo roteiro: 1.610')).toBeTruthy();
    expect(within(creditos).getByText('Com conserto visual: 530')).toBeTruthy();
    expect(within(creditos).getByText('Restam 860 · renova em 01/11')).toBeTruthy();
    expect(within(creditos).getByText('No ritmo atual, os créditos acabam em 24/10')).toBeTruthy();
    expect(within(creditos).getByText(/Vocês usam cerca de 126 créditos por dia\. Depois disso, cada tarefa vira crédito extra a R\$ 0,40/)).toBeTruthy();

    const onde = screen.getByRole('region', { name: 'Para onde foram os créditos' });
    const linhaVisita = within(onde).getByText('Agendar visita técnica', { selector: 'span.strong' }).closest('tr')!;
    expect(within(linhaVisita).getByText('Conserto frequente')).toBeTruthy();
    expect(within(onde).getByText('“Agendar visita técnica” gastou mais por conserto visual')).toBeTruthy();
    expect(within(onde).getByText(/mudou em 09\/10 e, desde então, 86 das 236 execuções/)).toBeTruthy();
    expect(within(onde).getByRole('link', { name: /Ver a execução EX-20431/ }).getAttribute('href')).toBe('/execucoes/EX-20431');
    expect(within(onde).getByRole('link', { name: 'Regravar o fluxo' }).getAttribute('href')).toBe('/aprender/flx_visita');
    // Ciclo anterior.
    fireEvent.click(within(onde).getByRole('button', { name: 'Ciclo anterior' }));
    expect(within(onde).getByText('Segunda via de boleto')).toBeTruthy();
    expect(within(onde).queryByText(/gastou mais por conserto visual/)).toBeNull();

    const faturas = screen.getByRole('region', { name: 'Faturas' });
    const linhas = within(faturas).getAllByRole('row').slice(1);
    expect(within(linhas[0]).getByText('Outubro de 2026')).toBeTruthy();
    expect(within(linhas[0]).getByText('Aberta')).toBeTruthy();
    expect(within(linhas[0]).getByText('Disponível em 01/11')).toBeTruthy();
    expect(within(linhas[1]).getByText('Assinatura Piloto + 180 créditos extras')).toBeTruthy();
    expect(within(linhas[1]).getByText('R$ 1.062')).toBeTruthy();
    expect(within(linhas[1]).getByText('Paga')).toBeTruthy();
    expect(within(linhas[1]).getByRole('link', { name: 'Baixar PDF da fatura de setembro de 2026' }).getAttribute('href')).toBe('/api/console/plano/faturas/fat_set/pdf');
    // Sem nota fiscal ligada, a linha da nota não aparece.
    expect(screen.queryByText(/Nota fiscal emitida para/)).toBeNull();

    const pagamento = screen.getByRole('region', { name: 'Forma de pagamento' });
    expect((within(pagamento).getByRole('radio', { name: /Boleto bancário/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(pagamento).getByText('Enviado para fin•••••@clinicamais.com.br 10 dias antes do vencimento')).toBeTruthy();
    expect(within(pagamento).getByText(/a equipe Starta envia cada cobrança por e-mail/)).toBeTruthy();
    expect(mascararEmail('ana@x.com.br')).toBe('ana•••••@x.com.br');
  });

  it('sem preço definido, mostra "Sob consulta" e desliga a compra com o motivo', async () => {
    const semPreco = plano({ id: 'piloto', nome: 'Piloto', precoMensalCentavos: null, precoCreditoExtraCentavos: null });
    instalarFetch({
      'GET /plano': dados({ plano: semPreco, planos: [semPreco], pacote: { creditos: 1000, precoCentavos: null, pendente: null }, faturaAberta: null, faturas: [] }),
    });
    renderizar(<Plano />, { caminho: '/plano' });
    const cartao = await screen.findByRole('region', { name: 'Piloto' });
    expect(within(cartao).getAllByText('Sob consulta').length).toBe(2);
    expect(within(cartao).getByText('A Starta ainda não definiu a mensalidade deste plano.')).toBeTruthy();
    expect(screen.getByText(/Depois disso, as tarefas param até chegarem mais créditos: a Starta ainda não definiu o preço do crédito do seu plano\./)).toBeTruthy();
    expect(screen.getByText('Nenhuma fatura ainda. A primeira fecha no fim do mês em que o plano começar.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Comprar pacote' }));
    const janela = screen.getByRole('dialog', { name: 'Comprar pacote de créditos' });
    expect(within(janela).getByText('A Starta ainda não definiu o preço do crédito do seu plano. Fale com a Starta para comprar créditos.')).toBeTruthy();
    expect((within(janela).getByRole('button', { name: 'Comprar pacote' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(janela).getByRole('button', { name: 'Cancelar' }));

    // Recarga automática: sem cobrança por cartão, explica e não liga.
    fireEvent.click(screen.getByRole('button', { name: 'Ativar recarga automática' }));
    const recarga = screen.getByRole('dialog', { name: 'Recarga automática' });
    expect(within(recarga).getByText(/ainda não dá para comprar pacotes/)).toBeTruthy();
    expect((within(recarga).getByRole('button', { name: 'Ativar recarga' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('compra um pacote e recarrega a página', async () => {
    let comprado = false;
    const pendente: Fatura = { ...SETEMBRO, id: 'fat_pac', competencia: null, tipo: 'pacote', status: 'emitida', creditos: 1000, totalCentavos: 40_000, itens: [], pagoEm: null, vencimento: '2026-10-20' };
    const { pedidos } = instalarFetch({
      'GET /plano': () => (comprado ? dados({ pacote: { creditos: 1000, precoCentavos: 40_000, pendente }, faturas: [pendente, SETEMBRO] }) : dados()),
      'POST /plano/pacotes': () => {
        comprado = true;
        return { fatura: pendente, mensagem: 'Pedido registrado. A equipe Starta envia a cobrança de R$ 400, e os 1.000 créditos entram assim que o pagamento for confirmado.' };
      },
    });
    renderizar(<Plano />, { caminho: '/plano' });
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar pacote' }));
    const janela = screen.getByRole('dialog', { name: 'Comprar pacote de créditos' });
    expect(within(janela).getByText('1.000 créditos')).toBeTruthy();
    expect(within(janela).getByText('R$ 400 (R$ 0,40 por crédito)')).toBeTruthy();
    expect(within(janela).getByText(/A equipe Starta envia a cobrança para financeiro@clinicamais\.com\.br\./)).toBeTruthy();
    fireEvent.click(within(janela).getByRole('button', { name: 'Comprar por R$ 400' }));
    expect(await screen.findByText(/Pedido registrado\. A equipe Starta envia a cobrança de R\$ 400/)).toBeTruthy();
    expect(pedidos.filter((p) => p.metodo === 'POST' && p.caminho === '/plano/pacotes')).toHaveLength(1);
    expect(await screen.findByText('Pacote de 1.000 créditos aguardando pagamento')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('altera os dados de cobrança, conferindo o CNPJ antes de enviar', async () => {
    const { pedidos } = instalarFetch({
      'GET /plano': dados({ cobranca: { razaoSocial: null, cnpj: null, emailCobranca: null, cep: null, numero: null, metodo: 'boleto', cartao: null } }),
      'PUT /plano/cobranca': (p: { corpo: unknown }) => ({ ...(p.corpo as object), cartao: null }),
    });
    renderizar(<Plano />, { caminho: '/plano' });
    expect(await screen.findByText('Falta o e-mail de cobrança: preencha em Alterar dados de cobrança.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alterar dados de cobrança' }));
    const janela = screen.getByRole('dialog', { name: 'Dados de cobrança' });
    fireEvent.change(within(janela).getByLabelText(/Razão social/), { target: { value: 'Clínica Mais Agenda Ltda' } });
    // O CNPJ vem do cadastro da empresa.
    expect((within(janela).getByLabelText(/CNPJ/) as HTMLInputElement).value).toBe('11.222.333/0001-81');
    fireEvent.change(within(janela).getByLabelText(/CNPJ/), { target: { value: '11.222.333/0001-00' } });
    fireEvent.change(within(janela).getByLabelText(/E-mail de cobrança/), { target: { value: 'financeiro@clinicamais.com.br' } });
    fireEvent.click(within(janela).getByRole('button', { name: 'Salvar dados' }));
    expect(within(janela).getByText('Esse CNPJ não é válido. Confira os números.')).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'PUT')).toBe(false);
    fireEvent.change(within(janela).getByLabelText(/CNPJ/), { target: { value: '11.222.333/0001-81' } });
    fireEvent.change(within(janela).getByLabelText('CEP'), { target: { value: '01310-100' } });
    fireEvent.click(within(janela).getByRole('button', { name: 'Salvar dados' }));
    await waitFor(() => expect(pedidos.some((p) => p.metodo === 'PUT' && p.caminho === '/plano/cobranca')).toBe(true));
    expect(pedidos.find((p) => p.metodo === 'PUT')!.corpo).toEqual({
      razaoSocial: 'Clínica Mais Agenda Ltda',
      cnpj: '11.222.333/0001-81',
      emailCobranca: 'financeiro@clinicamais.com.br',
      cep: '01310-100',
      metodo: 'boleto',
    });
    expect(await screen.findByText('Dados de cobrança salvos.')).toBeTruthy();
  });

  it('troca a forma de pagamento pelo rádio', async () => {
    const { pedidos } = instalarFetch({
      'GET /plano': dados(),
      'PUT /plano/metodo': { razaoSocial: 'Clínica Mais Agenda Ltda', cnpj: '11.222.333/0001-81', emailCobranca: 'financeiro@clinicamais.com.br', cep: null, numero: null, metodo: 'cartao', cartao: null },
    });
    renderizar(<Plano />, { caminho: '/plano' });
    fireEvent.click(await screen.findByRole('radio', { name: /Cartão de crédito/ }));
    await waitFor(() => expect((screen.getByRole('radio', { name: /Cartão de crédito/ }) as HTMLInputElement).checked).toBe(true));
    expect(pedidos.find((p) => p.metodo === 'PUT')).toMatchObject({ caminho: '/plano/metodo', corpo: { metodo: 'cartao' } });
  });

  it('pede a mudança de plano e mostra que a Starta vai confirmar', async () => {
    let pedido = false;
    const { pedidos } = instalarFetch({
      'GET /plano': () => dados(pedido ? { pedidoMudanca: { planoId: 'crescimento', planoNome: 'Crescimento', em: '2026-10-17T15:00:00.000Z' } } : {}),
      'POST /plano/mudanca': () => {
        pedido = true;
        return { planoId: 'crescimento', planoNome: 'Crescimento', em: '2026-10-17T15:00:00.000Z' };
      },
    });
    renderizar(<Plano />, { caminho: '/plano' });
    fireEvent.click(await screen.findByRole('button', { name: 'Mudar de plano' }));
    const janela = screen.getByRole('dialog', { name: 'Mudar de plano' });
    expect(within(janela).getByText('Plano atual')).toBeTruthy();
    const crescimento = within(janela).getByRole('radio', { name: /Crescimento/ });
    expect(crescimento.closest('label')!.textContent).toContain('Sob consulta');
    expect((within(janela).getByRole('button', { name: 'Enviar pedido' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(crescimento);
    fireEvent.change(within(janela).getByLabelText('Mensagem para a Starta'), { target: { value: 'Vamos abrir para toda a base.' } });
    fireEvent.click(within(janela).getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByText(/Pedido enviado em 17\/10 \(plano Crescimento\); a Starta confirma com você\./)).toBeTruthy();
    expect(pedidos.find((p) => p.metodo === 'POST')!.corpo).toEqual({ planoId: 'crescimento', mensagem: 'Vamos abrir para toda a base.' });
  });

  it('na demonstração, mostra "Dados de exemplo" e não deixa comprar', async () => {
    instalarFetch({
      'GET /plano': dados({ exemplo: true, podeAlterar: false, motivoSomenteLeitura: 'Demonstração: os números são de exemplo, e compras e cobrança ficam desligadas.' }),
    });
    renderizar(<Plano />, { caminho: '/plano' });
    expect(await screen.findByText('Dados de exemplo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Comprar pacote' }));
    const janela = screen.getByRole('dialog', { name: 'Comprar pacote de créditos' });
    expect(within(janela).getByText(/Demonstração: os números são de exemplo/)).toBeTruthy();
    expect((within(janela).getByRole('button', { name: 'Comprar por R$ 400' }) as HTMLButtonElement).disabled).toBe(true);
    // A forma de pagamento fica num fieldset desligado.
    expect(screen.getByRole('radio', { name: /Cartão de crédito/ }).closest('fieldset')!.disabled).toBe(true);
  });

  it('sem permissão, diz que só o Admin vê', async () => {
    instalarFetch({ 'GET /plano': status(403, { erro: 'sem_permissao', mensagem: 'Só um Admin vê o plano e os créditos.' }) });
    renderizar(<Plano />, { caminho: '/plano', perfil: 'editor' });
    expect(await screen.findByText('Seu perfil não tem acesso a esta área')).toBeTruthy();
    expect(screen.getByText(/Só um Admin vê o plano e os créditos\./)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Piloto' })).toBeNull();
  });
});

// Renderização de cada tipo de bloco (W2–W8) e as ações dos botões.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Bloco, MensagemWidget } from '@copiloto/shared';
import { ACOES_VAZIAS, ContextoAcoes, type AcoesChat } from '../src/chat/acoes.tsx';
import { ClienteApi } from '../src/chat/api.ts';
import { ControladorChat, type EstadoChat } from '../src/chat/controlador.ts';
import { ListaMensagens } from '../src/chat/mensagens.tsx';
import { Painel } from '../src/chat/painel.tsx';
import { CONFIRMACAO, EventSourceFalso, conversa, esperarPromessas, inicioFalso, msg, servidorFalso } from './apoio.ts';

function estadoCom(mensagens: MensagemWidget[], mudar: Partial<EstadoChat> = {}): EstadoChat {
  return {
    tela: 'conversa',
    conversaId: 'c1',
    estadoConversa: { modo: 'copiloto' },
    contexto: { secao: 'Clientes' },
    mensagens,
    digitando: null,
    conexao: 'aberta',
    online: true,
    carregando: false,
    erroCarregar: null,
    aviso: null,
    recentes: [],
    conversaAnteriorId: null,
    devolvidoPor: null,
    anuncio: null,
    ...mudar,
  };
}

function renderizar(mensagens: MensagemWidget[], acoes: Partial<AcoesChat> = {}, mudar: Partial<EstadoChat> = {}) {
  const valor: AcoesChat = { ...ACOES_VAZIAS, ...acoes };
  return render(
    <ContextoAcoes.Provider value={valor}>
      <div className="widget-body">
        <ListaMensagens estado={estadoCom(mensagens, mudar)} inicio={inicioFalso()} />
      </div>
    </ContextoAcoes.Provider>,
  );
}

function bot(blocos: Bloco[], texto?: string, extra: Partial<MensagemWidget> = {}) {
  return msg({ autor: 'copiloto', texto, blocos, ...extra });
}

describe('blocos', () => {
  it('coleta (W2): o que já tem, o que falta e a pergunta', () => {
    renderizar([
      bot(
        [
          {
            tipo: 'coleta',
            itens: [
              { rotulo: 'Nome', valor: 'ACME Logística', ok: true },
              { rotulo: 'CNPJ', valor: '12.345.678/0001-95', ok: true },
              { rotulo: 'E-mail de cobrança', ok: false },
            ],
            pergunta: 'Para qual e-mail devo mandar os boletos da ACME?',
          },
        ],
        'Certo, Ana. Já tenho estes dados:',
      ),
    ]);
    expect(screen.getByText('Certo, Ana. Já tenho estes dados:')).toBeTruthy();
    expect(screen.getByText('ACME Logística', { exact: false })).toBeTruthy();
    expect(screen.getByText('e-mail de cobrança')).toBeTruthy();
    expect(screen.getByText('CNPJ:')).toBeTruthy();
    expect(screen.getByText('Para qual e-mail devo mandar os boletos da ACME?')).toBeTruthy();
    expect(screen.getByText('Hoje · Você está em Clientes')).toBeTruthy();
  });

  it('confirmação (W3): campos, selo, caminho, desfazer e botões', () => {
    const confirmar = vi.fn(async () => {});
    const corrigir = vi.fn(async () => {});
    const preencherComposer = vi.fn();
    renderizar([bot([CONFIRMACAO], 'Tenho tudo. Confira antes de eu gravar: **nada foi salvo no Horizonte ainda.**', { nota: 'Só gravo depois que você confirmar.' })], {
      confirmar,
      corrigir,
      preencherComposer,
    });
    const cartao = screen.getByRole('region', { name: 'Confirme o cadastro' });
    expect(within(cartao).getByText('Cadastrar cliente')).toBeTruthy();
    expect(within(cartao).getByText('válido')).toBeTruthy();
    expect(within(cartao).getByText('Via API · cerca de 5 s')).toBeTruthy();
    expect(within(cartao).getByText('Você pode desfazer por 5 minutos')).toBeTruthy();
    expect(screen.getByText('nada foi salvo no Horizonte ainda.').tagName).toBe('STRONG');
    expect(screen.getByText(/Só gravo depois que você confirmar\./)).toBeTruthy();
    fireEvent.click(within(cartao).getByRole('button', { name: 'Confirmar e executar' }));
    expect(confirmar).toHaveBeenCalledWith('EX-20431');
    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar responsável' }));
    expect(preencherComposer).toHaveBeenCalledWith('Trocar responsável para ');
  });

  it('confirmação: estados confirmado, corrigir, cancelado e substituído', () => {
    renderizar([
      bot([{ ...CONFIRMACAO, execucaoId: 'EX-1', estado: 'confirmado', confirmadoEm: '2026-10-17T17:04:00.000Z' }]),
      bot([{ ...CONFIRMACAO, execucaoId: 'EX-2', estado: 'corrigir' }]),
      bot([{ ...CONFIRMACAO, execucaoId: 'EX-3', estado: 'cancelado' }]),
      bot([{ ...CONFIRMACAO, execucaoId: 'EX-4', estado: 'substituido' }]),
    ]);
    expect(screen.getByText('Você confirmou às 14:04')).toBeTruthy();
    expect(screen.getByText(/Você pediu para corrigir/)).toBeTruthy();
    expect(screen.getByText('Pedido cancelado. Nada foi gravado.')).toBeTruthy();
    expect(screen.getByText(/Substituído por um cartão mais novo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar e executar' })).toBeNull();
  });

  it('progresso (W4): etapas, percentual, tempo restante e cancelar', () => {
    const cancelarExecucao = vi.fn(async () => {});
    renderizar(
      [
        bot([
          {
            tipo: 'progresso',
            execucaoId: 'EX-20431',
            titulo: 'Cadastrando ACME Logística',
            caminho: 'api',
            etapas: [
              { titulo: 'Validando dados', detalhe: 'CNPJ e e-mail conferidos', estado: 'feita' },
              { titulo: 'Verificando se o cliente já existe', detalhe: 'Nenhum cliente com este CNPJ', estado: 'feita' },
              { titulo: 'Criando o cadastro', detalhe: 'Enviando para o Horizonte', estado: 'ativa' },
              { titulo: 'Conferindo o resultado', estado: 'pendente' },
            ],
            percentual: 62,
            restante: 'Faltam cerca de 2 s',
            podeCancelar: true,
            status: 'em_andamento',
          },
        ]),
      ],
      { cancelarExecucao },
    );
    expect(screen.getByText('Etapa 3 de 4')).toBeTruthy();
    expect(screen.getByText('Faltam cerca de 2 s')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
    expect(screen.getByText('Execução')).toBeTruthy();
    expect(screen.getByText('Pode fechar esta janela. Eu aviso quando terminar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelarExecucao).toHaveBeenCalledWith('EX-20431');
  });

  it('recibo (W5): link, resumo e desfazer com contagem regressiva', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-17T17:04:00.000Z'));
    const desfazer = vi.fn(async () => {});
    renderizar(
      [
        bot([
          {
            tipo: 'recibo',
            execucaoId: 'EX-20431',
            titulo: 'Cliente ACME Logística criado (#4821)',
            campos: [{ rotulo: 'CNPJ', valor: '12.345.678/0001-95' }],
            resumo: 'Feito via API em 4 s',
            link: { rotulo: 'Abrir cadastro', url: 'http://localhost:4000/clientes/4821' },
            desfazerAte: '2026-10-17T17:08:52.000Z',
          },
        ]),
      ],
      { desfazer },
    );
    expect(screen.getByText('#4821').className).toContain('mono');
    expect(screen.getByText('Feito via API em 4 s', { exact: false })).toBeTruthy();
    const link = screen.getByRole('link', { name: /Abrir cadastro/ });
    expect(link.getAttribute('href')).toBe('http://localhost:4000/clientes/4821');
    const botao = screen.getByRole('button', { name: /Desfazer\. Disponível por mais 4 minutos e 52 segundos/ });
    expect(within(botao).getByText('4:52')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('4:50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Desfazer/ }));
    expect(desfazer).toHaveBeenCalledWith('EX-20431');
  });

  it('recibo pela tela (F6): número do registro lido da tela, detalhes e "Abrir o chamado"', () => {
    renderizar([
      bot([
        {
          tipo: 'recibo',
          execucaoId: 'EX-20458',
          titulo: 'Abrir chamado: feito',
          registro: { nome: 'Chamado', numero: 'CH-2026-0154', detalhes: ['Padaria Estrela', 'Prioridade alta'] },
          campos: [
            { rotulo: 'Assunto', valor: 'Impressora sem tinta' },
            { rotulo: 'Descrição', valor: 'A impressora do caixa parou de imprimir os cupons fiscais.' },
          ],
          resumo: 'Feito pela tela em 9 s',
          link: { rotulo: 'Abrir o chamado', url: 'http://localhost:4000/chamados/154' },
        },
      ]),
    ]);
    const recibo = screen.getByRole('region', { name: 'Abrir chamado: feito' });
    const linha = within(recibo).getByText((_, el) => el?.tagName === 'P' && el.classList.contains('cp-recibo-registro'));
    expect(linha.textContent).toBe('Chamado CH-2026-0154 · Padaria Estrela · Prioridade alta');
    expect(within(linha).getByText('CH-2026-0154').className).toContain('mono');
    expect(within(recibo).getByText('Assunto')).toBeTruthy();
    expect(within(recibo).getByText('Impressora sem tinta')).toBeTruthy();
    expect(within(recibo).getByRole('link', { name: /Abrir o chamado/ }).getAttribute('href')).toBe('http://localhost:4000/chamados/154');
    expect(within(recibo).queryByRole('button', { name: /Desfazer/ })).toBeNull();
  });

  it('recibo sem número lido: nenhuma linha de registro (não chuta)', () => {
    renderizar([bot([{ tipo: 'recibo', execucaoId: 'EX-3', titulo: 'Abrir chamado: feito', campos: [], resumo: 'Feito pela tela em 9 s' }])]);
    expect(document.querySelector('.cp-recibo-registro')).toBeNull();
  });

  it('recibo: desfeito e prazo encerrado', () => {
    renderizar([
      bot([{ tipo: 'recibo', execucaoId: 'EX-1', titulo: 'A', campos: [], resumo: 'Feito via API em 4 s', desfazerAte: new Date(Date.now() + 60000).toISOString(), desfeito: true }]),
      bot([{ tipo: 'recibo', execucaoId: 'EX-2', titulo: 'B', campos: [], resumo: 'Feito via API em 4 s', desfazerAte: new Date(Date.now() - 1000).toISOString() }]),
    ]);
    expect(screen.getByText('Você desfez. Nada ficou gravado.')).toBeTruthy();
    expect(screen.getByText('O prazo para desfazer terminou.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Desfazer/ })).toBeNull();
  });

  it('conflito (W6): cadastro existente e as ações', async () => {
    const executarAcao = vi.fn(async () => {});
    renderizar(
      [
        bot(
          [
            {
              tipo: 'conflito',
              execucaoId: 'EX-20431',
              existente: {
                titulo: 'ACME Log Ltda',
                codigo: '#3190',
                campos: [
                  { rotulo: 'CNPJ', valor: '12.345.678/0001-95' },
                  { rotulo: 'E-mail de cobrança', valor: 'contato@acmelog.com.br' },
                ],
              },
              acoes: [
                { rotulo: 'Abrir cadastro existente', acao: 'abrir', url: 'http://localhost:4000/clientes/3190' },
                { rotulo: 'Atualizar o existente com os dados novos', acao: 'atualizar' },
                { rotulo: 'Falar com uma pessoa', acao: 'humano' },
              ],
            },
          ],
          'Não consegui criar o cadastro. O Horizonte recusou porque **já existe um cliente com o CNPJ 12.345.678/0001-95**. Nada novo foi gravado.',
        ),
      ],
      { executarAcao },
    );
    expect(screen.getByText('Já cadastrado')).toBeTruthy();
    expect(screen.getByText('#3190')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir cadastro existente/ }).getAttribute('href')).toBe('http://localhost:4000/clientes/3190');
    expect(screen.getByText(/Como prefere seguir\?/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar o existente com os dados novos' }));
    });
    expect(executarAcao).toHaveBeenCalledWith(expect.objectContaining({ acao: 'atualizar' }), 'EX-20431');
    expect(screen.getAllByText('EX-20431').length).toBeGreaterThan(0);
  });

  it('não repete a pergunta do conflito, o código da execução nem o resumo do recibo (W5, W6)', () => {
    const { container } = renderizar([
      bot(
        [
          {
            tipo: 'conflito',
            execucaoId: 'EX-20431',
            existente: { titulo: 'ACME Log Ltda', codigo: '#3190', campos: [] },
            acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano' }],
          },
        ],
        'Não consegui criar o cadastro. Nada novo foi gravado.\n\nComo prefere seguir?',
        { nota: 'EX-20431' },
      ),
      bot(
        [{ tipo: 'recibo', execucaoId: 'EX-20432', titulo: 'Cliente criado', campos: [], resumo: 'Feito via API em 4 s · EX-20432' }],
        undefined,
      ),
      bot([{ tipo: 'sugestoes', itens: [{ rotulo: 'Agendar visita', mensagem: 'agenda visita' }] }], 'Quer seguir com a ACME?'),
    ]);
    // Sem "atualizar" entre as ações, a pergunta fica curta, e aparece uma vez só (embaixo do cartão).
    expect(screen.getAllByText(/Como prefere seguir\?/)).toHaveLength(1);
    expect(screen.queryByText(/Se escolher atualizar/)).toBeNull();
    expect(container.textContent).not.toContain('EX-20431 · EX-20431');
    expect(container.textContent).toContain('Feito via API em 4 s · EX-20432');
    expect(container.textContent).not.toContain('EX-20432 · EX-20432');
    // O recibo seguido só da continuação ainda oferece "Novo pedido".
    expect(screen.getByRole('button', { name: /Novo pedido/ })).toBeTruthy();
  });

  it('erro: título, detalhe, código de referência e ações', async () => {
    const executarAcao = vi.fn(async () => {});
    renderizar(
      [
        bot([
          {
            tipo: 'erro',
            execucaoId: 'EX-20440',
            titulo: 'O Horizonte não respondeu',
            detalhe: 'Tentei 2 vezes. Nada foi gravado.',
            codigo: '7F3A-21',
            acoes: [
              { rotulo: 'Tentar de novo', acao: 'tentar' },
              { rotulo: 'Falar com uma pessoa', acao: 'humano' },
            ],
          },
        ]),
      ],
      { executarAcao },
    );
    expect(screen.getByRole('region', { name: 'O Horizonte não respondeu' })).toBeTruthy();
    expect(screen.getByText('Tentei 2 vezes. Nada foi gravado.')).toBeTruthy();
    expect(screen.getByText('7F3A-21')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    });
    expect(executarAcao).toHaveBeenCalledWith(expect.objectContaining({ acao: 'tentar' }), 'EX-20440');
  });

  it('aprovação (W7): rascunho, enviada, aprovada, recusada e cancelada', () => {
    const enviarAprovacao = vi.fn(async () => {});
    const base = {
      tipo: 'aprovacao' as const,
      execucaoId: 'EX-9',
      campos: [
        { rotulo: 'Pedido', valor: 'Alterar plano do cliente' },
        { rotulo: 'Mudança', valor: 'Básico para Premium' },
      ],
      aprovador: { id: '105', nome: 'Rafael Lima' },
    };
    renderizar(
      [
        bot([{ ...base, aprovacaoId: 'ap1', estado: 'rascunho' }], 'Seu acesso não permite essa mudança.'),
        bot([{ ...base, aprovacaoId: 'ap2', estado: 'enviada' }]),
        bot([{ ...base, aprovacaoId: 'ap3', estado: 'aprovada' }]),
        bot([{ ...base, aprovacaoId: 'ap4', estado: 'recusada', motivoRecusa: 'Cliente com pendência.' }]),
        bot([{ ...base, aprovacaoId: 'ap5', estado: 'cancelada' }]),
      ],
      { enviarAprovacao },
    );
    expect(screen.getAllByText('Precisa de aprovação').length).toBe(5);
    expect(screen.getAllByText('Rafael Lima').length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Pedir aprovação a Rafael Lima' }));
    expect(enviarAprovacao).toHaveBeenCalledWith('ap1');
    expect(screen.getByText('Aguardando aprovação')).toBeTruthy();
    expect(screen.getByText('Aprovado')).toBeTruthy();
    expect(screen.getByText(/Motivo: Cliente com pendência\./)).toBeTruthy();
    expect(screen.getByText(/Pedido de aprovação cancelado/)).toBeTruthy();
  });

  it('sugestões, fontes com confiança e avaliação', () => {
    const enviar = vi.fn();
    const feedback = vi.fn(async () => {});
    renderizar(
      [
        bot(
          [
            { tipo: 'fontes', itens: [{ n: 1, titulo: 'Como emitir segunda via', local: 'Central de ajuda', url: 'http://localhost:4000/ajuda/segunda-via' }], confianca: 'alta' },
            { tipo: 'sugestoes', titulo: 'Quer seguir?', itens: [{ rotulo: 'Emitir segunda via', mensagem: 'Quero a segunda via do boleto' }] },
            { tipo: 'avaliacao' },
          ],
          'Abra **Financeiro** e escolha a competência [1].\n\n- Informe o CPF ou CNPJ\n- Clique em Buscar boletos',
          { id: 'm-resp' },
        ),
      ],
      { enviar, feedback },
    );
    expect(screen.getByText('Confiança alta')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Como emitir segunda via' })).toBeTruthy();
    expect(screen.getByLabelText('fonte 1')).toBeTruthy();
    expect(screen.getAllByRole('listitem').some((li) => li.textContent === 'Informe o CPF ou CNPJ')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Emitir segunda via' }));
    expect(enviar).toHaveBeenCalledWith('Quero a segunda via do boleto');
    expect(screen.getByText('Esta resposta ajudou?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resposta útil' }));
    expect(feedback).toHaveBeenCalledWith('m-resp', 'util');
  });

  it('atendimento humano (W8): resumo, pessoa respondendo, aguardando e devolvido', () => {
    const atendente = { nome: 'Camila Souza', iniciais: 'CS', papel: 'Suporte' };
    const { rerender } = renderizar(
      [
        bot(
          [
            {
              tipo: 'resumo_humano',
              para: 'Camila',
              itens: [
                { rotulo: 'Pedido', valor: 'Cadastrar cliente ACME Logística' },
                { rotulo: 'Execução', valor: 'EX-20431' },
              ],
            },
          ],
          'Chamei uma pessoa do suporte e mandei um resumo, para você não precisar explicar tudo de novo.',
        ),
        msg({ autor: 'sistema', texto: 'Camila Souza, do suporte, entrou na conversa', icone: 'pessoa' }),
        msg({ autor: 'pessoa', autorNome: 'Camila Souza', autorIniciais: 'CS', texto: 'Oi, Ana, aqui é a Camila.' }),
      ],
      {},
      { estadoConversa: { modo: 'pessoa', atendente }, digitando: { autor: 'pessoa' } },
    );
    expect(screen.getByText('Resumo enviado para Camila')).toBeTruthy();
    expect(screen.getByText('Camila Souza, do suporte, entrou na conversa')).toBeTruthy();
    expect(screen.getByText('Copiloto')).toBeTruthy();
    expect(screen.getByText('· assistente virtual')).toBeTruthy();
    expect(screen.getAllByText('CS').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Camila Souza está escrevendo…')).toBeTruthy();

    rerender(
      <ContextoAcoes.Provider value={ACOES_VAZIAS}>
        <ListaMensagens estado={estadoCom([], { estadoConversa: { modo: 'aguardando_pessoa', resumoEnviado: true } })} inicio={inicioFalso()} />
      </ContextoAcoes.Provider>,
    );
    expect(screen.getByText(/Chamei uma pessoa do suporte\. Assim que alguém entrar/)).toBeTruthy();
    expect(screen.getByText('Atendimento por pessoas: segunda a sexta, das 8h às 18h')).toBeTruthy();

    rerender(
      <ContextoAcoes.Provider value={ACOES_VAZIAS}>
        <ListaMensagens estado={estadoCom([], { devolvidoPor: 'Camila Souza' })} inicio={inicioFalso()} />
      </ContextoAcoes.Provider>,
    );
    expect(screen.getByText('Camila Souza encerrou o atendimento. O copiloto voltou a responder.')).toBeTruthy();
  });
});

describe('ações dos botões chamam a API certa', () => {
  it('atualizar, tentar, humano, aprovação e feedback', async () => {
    EventSourceFalso.reiniciar();
    vi.stubGlobal('EventSource', EventSourceFalso);
    const conv = conversa([
      bot([
        {
          tipo: 'conflito',
          execucaoId: 'EX-1',
          existente: { titulo: 'ACME Log Ltda', campos: [] },
          acoes: [{ rotulo: 'Atualizar o existente com os dados novos', acao: 'atualizar' }],
        },
      ]),
      bot([{ tipo: 'erro', execucaoId: 'EX-2', titulo: 'Falhou', acoes: [{ rotulo: 'Tentar de novo', acao: 'tentar' }, { rotulo: 'Falar com uma pessoa', acao: 'humano' }] }]),
      bot([{ tipo: 'aprovacao', aprovacaoId: 'ap1', execucaoId: 'EX-3', campos: [], aprovador: { id: '105', nome: 'Rafael Lima' }, estado: 'rascunho' }]),
      bot([{ tipo: 'avaliacao' }], 'Resposta', { id: 'm-av' }),
    ]);
    const srv = servidorFalso({
      'GET /api/widget/conversas/c1': () => conv,
      'POST /api/widget/execucoes/EX-1/atualizar-existente': () => ({ ok: true }),
      'POST /api/widget/execucoes/EX-2/tentar': () => ({ ok: true }),
      'POST /api/widget/conversas/c1/humano': () => ({ ok: true }),
      'POST /api/widget/aprovacoes/ap1/enviar': () => ({ ok: true }),
      'POST /api/widget/mensagens/m-av/feedback': () => ({ ok: true }),
    });
    const inicio = inicioFalso({ conversaId: 'c1' });
    const controlador = new ControladorChat({ api: new ClienteApi('http://localhost:3000', inicio.token), inicio });
    render(<Painel controlador={controlador} modo="console" />);
    await act(() => controlador.iniciar());
    await screen.findByText('ACME Log Ltda');

    const clicar = async (nome: string) => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: nome }));
        await esperarPromessas();
      });
    };
    await clicar('Atualizar o existente com os dados novos');
    await clicar('Tentar de novo');
    await clicar('Falar com uma pessoa');
    await clicar('Pedir aprovação a Rafael Lima');
    await clicar('Resposta não útil');

    expect(srv.de('POST', '/api/widget/execucoes/EX-1/atualizar-existente')).toHaveLength(1);
    expect(srv.de('POST', '/api/widget/execucoes/EX-2/tentar')).toHaveLength(1);
    expect(srv.de('POST', '/api/widget/conversas/c1/humano')).toHaveLength(1);
    expect(srv.de('POST', '/api/widget/aprovacoes/ap1/enviar')).toHaveLength(1);
    expect(srv.de('POST', '/api/widget/mensagens/m-av/feedback')[0].corpo).toEqual({ valor: 'nao_util' });
    for (const c of srv.chamadas) expect(c.headers.authorization).toBe('Bearer tk-teste');
    await waitFor(() => expect(screen.getByText('Chamando uma pessoa do suporte')).toBeTruthy());
    expect(screen.getByText('Aguardando aprovação')).toBeTruthy();
    controlador.destruir();
  });
});

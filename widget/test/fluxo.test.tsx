// Fluxo completo no ChatCopiloto com servidor e SSE simulados:
// confirmar → progresso → recibo → desfazer, streaming por "delta", reconexão e boas-vindas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Bloco, MensagemWidget } from '@copiloto/shared';
import { ChatCopiloto, PreviaWidget } from '../src/chat/index.ts';
import { CONFIRMACAO, EventSourceFalso, conversa, esperarPromessas, inicioFalso, msg, servidorFalso } from './apoio.ts';

function progresso(mudar: Partial<Extract<Bloco, { tipo: 'progresso' }>> = {}): Extract<Bloco, { tipo: 'progresso' }> {
  return {
    tipo: 'progresso',
    execucaoId: 'EX-20431',
    titulo: 'Cadastrando ACME Logística',
    caminho: 'api',
    etapas: [
      { titulo: 'Validando dados', detalhe: 'CNPJ e e-mail conferidos', estado: 'feita' },
      { titulo: 'Verificando se o cliente já existe', estado: 'feita' },
      { titulo: 'Criando o cadastro', estado: 'ativa' },
      { titulo: 'Conferindo o resultado', estado: 'pendente' },
    ],
    percentual: 62,
    restante: 'Faltam cerca de 2 s',
    podeCancelar: true,
    status: 'em_andamento',
    ...mudar,
  };
}

beforeEach(() => {
  EventSourceFalso.reiniciar();
  vi.stubGlobal('EventSource', EventSourceFalso);
});

describe('ChatCopiloto: confirmar → progresso → recibo', () => {
  it('segue o pedido de ponta a ponta com eventos SSE', async () => {
    const usuario = msg({ autor: 'usuario', texto: 'financeiro@acmelog.com.br' });
    const cartao: MensagemWidget = msg({
      id: 'm-cartao',
      autor: 'copiloto',
      texto: 'Tenho tudo. Confira antes de eu gravar: **nada foi salvo no Horizonte ainda.**',
      blocos: [CONFIRMACAO],
      nota: 'Só gravo depois que você confirmar.',
    });
    const srv = servidorFalso({
      'GET /api/widget/sessao': () => inicioFalso({ conversaId: 'c1', modoTeste: true }),
      'GET /api/widget/conversas/c1': () => conversa([usuario, cartao]),
      'POST /api/widget/execucoes/EX-20431/confirmar': () => ({ ok: true }),
      'POST /api/widget/execucoes/EX-20431/desfazer': () => ({ ok: true }),
    });
    const aoFechar = vi.fn();
    render(<ChatCopiloto token="tk-console" apiBase="http://localhost:3000" aoFechar={aoFechar} altura={600} />);

    await screen.findByRole('region', { name: 'Confirme o cadastro' });
    expect(screen.getByText('nada é gravado', { exact: false })).toBeTruthy();
    expect(screen.getByPlaceholderText('Ou escreva o que quer corrigir')).toBeTruthy();
    expect(srv.de('GET', '/api/widget/sessao')[0].headers.authorization).toBe('Bearer tk-console');

    const es = EventSourceFalso.ultima();
    expect(es.url).toBe('http://localhost:3000/api/widget/eventos?token=tk-console&conversa=c1');
    act(() => es.abrir());

    // Confirmar e executar
    await act(async () => {
      const confirmar = screen.getByRole('button', { name: 'Confirmar e executar' });
      confirmar.focus();
      fireEvent.click(confirmar);
      await esperarPromessas();
    });
    expect(srv.de('POST', '/api/widget/execucoes/EX-20431/confirmar')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Confirmar e executar' })).toBeNull();
    expect(screen.getByText(/Você confirmou às/)).toBeTruthy();
    // O botão com foco sumiu: o foco volta para o campo de mensagem, não para o corpo da página.
    expect(document.activeElement?.tagName).toBe('TEXTAREA');

    // O servidor confirma o cartão e começa a execução
    act(() => {
      es.emitir({
        tipo: 'mensagem_atualizada',
        mensagem: { ...cartao, blocos: [{ ...CONFIRMACAO, estado: 'confirmado', confirmadoEm: '2026-10-17T17:04:00.000Z' }] },
      });
      es.emitir({
        tipo: 'mensagem',
        mensagem: msg({ autor: 'sistema', texto: 'Você confirmou o cadastro às 14:04', icone: 'check' }),
      });
      es.emitir({
        tipo: 'mensagem',
        mensagem: msg({
          id: 'm-prog',
          autor: 'copiloto',
          texto: 'Combinado. Estou cadastrando a ACME Logística pela API do Horizonte.',
          blocos: [progresso()],
        }),
      });
    });
    expect(screen.getByText('Você confirmou o cadastro às 14:04')).toBeTruthy();
    expect(screen.getByText('Etapa 3 de 4')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();

    // Etapa seguinte e fim da execução
    act(() => {
      es.emitir({
        tipo: 'mensagem_atualizada',
        mensagem: msg({
          id: 'm-prog',
          autor: 'copiloto',
          texto: 'Combinado. Estou cadastrando a ACME Logística pela API do Horizonte.',
          blocos: [
            progresso({
              etapas: progresso().etapas.map((e) => ({ ...e, estado: e.estado === 'pendente' ? 'ativa' : 'feita' })),
              percentual: 90,
              restante: 'Falta cerca de 1 s',
            }),
          ],
        }),
      });
    });
    expect(screen.getByText('Etapa 4 de 4')).toBeTruthy();
    act(() => {
      es.emitir({
        tipo: 'mensagem_atualizada',
        mensagem: msg({
          id: 'm-prog',
          autor: 'copiloto',
          texto: 'Combinado. Estou cadastrando a ACME Logística pela API do Horizonte.',
          blocos: [progresso({ etapas: progresso().etapas.map((e) => ({ ...e, estado: 'feita' })), percentual: 100, status: 'concluida', podeCancelar: false })],
        }),
      });
      es.emitir({
        tipo: 'mensagem',
        mensagem: msg({
          id: 'm-recibo',
          autor: 'copiloto',
          blocos: [
            {
              tipo: 'recibo',
              execucaoId: 'EX-20431',
              titulo: 'Cliente ACME Logística criado (#4821)',
              campos: [{ rotulo: 'Prazo', valor: '30 dias' }],
              resumo: 'Feito via API em 4 s',
              link: { rotulo: 'Abrir cadastro', url: 'http://localhost:4000/clientes/4821' },
              desfazerAte: new Date(Date.now() + 5 * 60000).toISOString(),
            },
          ],
        }),
      });
    });
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(screen.getByText('Concluído')).toBeTruthy();
    const recibo = screen.getByRole('region', { name: /Cliente ACME Logística criado/ });
    expect(within(recibo).getByRole('link', { name: /Abrir cadastro/ }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('button', { name: /Novo pedido/ })).toBeTruthy();
    // Anúncio para leitor de tela
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Cliente ACME Logística criado (#4821)');

    // Desfazer
    await act(async () => {
      fireEvent.click(within(recibo).getByRole('button', { name: /^Desfazer\. Disponível por mais \d minutos? e \d+ segundos?$/ }));
      await esperarPromessas();
    });
    expect(srv.de('POST', '/api/widget/execucoes/EX-20431/desfazer')).toHaveLength(1);
    expect(screen.getByText('Você desfez. Nada ficou gravado.')).toBeTruthy();

    // Esc fecha
    fireEvent.keyDown(screen.getByPlaceholderText('Escreva sua mensagem'), { key: 'Escape' });
    expect(aoFechar).toHaveBeenCalled();
  });

  it('mostra o texto chegando por delta e o indicador de digitando', async () => {
    servidorFalso({
      'GET /api/widget/sessao': () => inicioFalso({ conversaId: 'c1' }),
      'GET /api/widget/conversas/c1': () => conversa([msg({ autor: 'usuario', texto: 'como emito segunda via?' })]),
    });
    render(<ChatCopiloto token="tk" />);
    await screen.findByText('como emito segunda via?');
    const es = EventSourceFalso.ultima();
    expect(es.url).toBe('/api/widget/eventos?token=tk&conversa=c1');
    act(() => {
      es.abrir();
      es.emitir({ tipo: 'digitando', ativo: true, autor: 'copiloto' });
    });
    expect(screen.getByText('O copiloto está escrevendo')).toBeTruthy();

    act(() => {
      es.emitir({ tipo: 'mensagem', mensagem: msg({ id: 'm-st', autor: 'copiloto', texto: '', emAndamento: true }) });
      es.emitir({ tipo: 'delta', mensagemId: 'm-st', texto: 'Abra **Financeiro**' });
      es.emitir({ tipo: 'delta', mensagemId: 'm-st', texto: ' e escolha a competência.' });
    });
    expect(screen.getByText('Financeiro').tagName).toBe('STRONG');
    expect(screen.getByText(/e escolha a competência\./)).toBeTruthy();
    expect(screen.queryByText('O copiloto está escrevendo')).toBeNull();

    act(() => {
      es.emitir({
        tipo: 'mensagem_atualizada',
        mensagem: msg({
          id: 'm-st',
          autor: 'copiloto',
          texto: 'Abra **Financeiro** e escolha a competência.',
          blocos: [{ tipo: 'avaliacao' }],
        }),
      });
    });
    expect(screen.getByText('Esta resposta ajudou?')).toBeTruthy();
    expect(screen.getAllByText(/e escolha a competência\./).filter((el) => el.closest('.bubble'))).toHaveLength(1);
  });

  it('mostra "Reconectando…", depois "Conexão instável", e sincroniza ao voltar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let versao = 0;
    servidorFalso({
      'GET /api/widget/sessao': () => inicioFalso({ conversaId: 'c1' }),
      'GET /api/widget/conversas/c1': () => {
        versao += 1;
        return conversa(
          versao === 1
            ? [msg({ id: 'u1', autor: 'usuario', texto: 'oi' })]
            : [msg({ id: 'u1', autor: 'usuario', texto: 'oi' }), msg({ id: 'b-perdida', autor: 'copiloto', texto: 'Resposta que chegou com a conexão fora.' })],
        );
      },
    });
    render(<ChatCopiloto token="tk" />);
    await screen.findByText('oi');
    // O render veio de fora do act (resposta do fetch): garante que os efeitos (assinatura do estado) rodaram.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => EventSourceFalso.ultima().abrir());
    act(() => EventSourceFalso.ultima().falhar());
    expect(screen.getByText('Reconectando…')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    act(() => EventSourceFalso.ultima().falhar());
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    act(() => EventSourceFalso.ultima().falhar());
    expect(screen.getByText('Conexão instável.')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    await act(async () => {
      EventSourceFalso.ultima().abrir();
      await esperarPromessas();
    });
    await waitFor(() => expect(screen.getByText('Resposta que chegou com a conexão fora.')).toBeTruthy());
    expect(screen.queryByText('Conexão instável.')).toBeNull();
  });

  it('sem a chave do Claude, avisa que o assistente ainda não está ligado', async () => {
    servidorFalso({ 'GET /api/widget/sessao': () => inicioFalso({ semClaude: true }) });
    render(<ChatCopiloto token="tk" />);
    expect(await screen.findByText('O assistente ainda não está ligado.')).toBeTruthy();
    expect(screen.queryByText(/Modo simulado/)).toBeNull();
  });

  it('abre nas boas-vindas sem conversa, com sugestões e pedidos recentes', async () => {
    const srv = servidorFalso({
      'GET /api/widget/sessao': () =>
        inicioFalso({
          recentes: [
            { execucaoId: 'EX-20418', titulo: 'Relatório de vendas de setembro', status: 'concluida', quando: new Date().toISOString() },
            { execucaoId: 'EX-20397', titulo: 'Visita técnica na Transportes Vale Sul', status: 'em_andamento', quando: new Date(Date.now() - 86400000).toISOString() },
          ],
          modoSimulado: true,
          semClaude: false,
          pausa: { tipo: 'navegador', mensagem: 'Tarefas pela tela estão pausadas até amanhã.' },
        }),
      'POST /api/widget/conversas': () => conversa([], { id: 'c9' }),
      'POST /api/widget/conversas/c9/mensagens': (c) => ({
        mensagem: msg({ id: 'u-srv', conversaId: 'c9', autor: 'usuario', texto: (c.corpo as { texto: string }).texto }),
      }),
    });
    render(<ChatCopiloto token="tk" />);
    await screen.findByText(/, Ana\./);
    expect(screen.getByText('Posso fazer agora')).toBeTruthy();
    expect(screen.getByText('Relatório de vendas de setembro')).toBeTruthy();
    expect(screen.getByText('Concluído')).toBeTruthy();
    expect(screen.getByText('Em andamento')).toBeTruthy();
    expect(screen.getByText(/Modo simulado/)).toBeTruthy();
    expect(screen.getByText('Tarefas pela tela estão pausadas até amanhã.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Peça algo, por exemplo: cadastrar cliente')).toBeTruthy();
    expect(screen.getByText('O copiloto pede sua confirmação antes de alterar qualquer dado')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
      await esperarPromessas(10);
    });
    expect(srv.de('POST', '/api/widget/conversas')).toHaveLength(1);
    const envio = srv.de('POST', '/api/widget/conversas/c9/mensagens');
    expect(envio).toHaveLength(1);
    expect((envio[0].corpo as { texto: string; idCliente: string }).texto).toBe('Quero cadastrar um cliente');
    expect((envio[0].corpo as { idCliente: string }).idCliente).toBeTruthy();
    expect(screen.getByText('Quero cadastrar um cliente')).toBeTruthy();
    expect(EventSourceFalso.ultima().url).toContain('conversa=c9');
  });

  it('envia com Enter e quebra linha com Shift+Enter', async () => {
    const srv = servidorFalso({
      'GET /api/widget/sessao': () => inicioFalso({ conversaId: 'c1' }),
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/conversas/c1/mensagens': (c) => ({ mensagem: msg({ autor: 'usuario', texto: (c.corpo as { texto: string }).texto }) }),
    });
    render(<ChatCopiloto token="tk" />);
    const caixa = (await screen.findByPlaceholderText('Escreva sua mensagem')) as HTMLTextAreaElement;
    fireEvent.change(caixa, { target: { value: 'primeira linha' } });
    fireEvent.keyDown(caixa, { key: 'Enter', shiftKey: true });
    expect(srv.de('POST', '/api/widget/conversas/c1/mensagens')).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(caixa, { key: 'Enter' });
      await esperarPromessas();
    });
    expect(srv.de('POST', '/api/widget/conversas/c1/mensagens')).toHaveLength(1);
    expect(caixa.value).toBe('');
  });

  it('anexa arquivo por POST /anexos (multipart) e envia o id com a mensagem', async () => {
    const srv = servidorFalso({
      'GET /api/widget/sessao': () => inicioFalso({ conversaId: 'c1' }),
      'GET /api/widget/conversas/c1': () => conversa([]),
      'POST /api/widget/anexos': () => ({ id: 'ax1', nome: 'planilha.csv', tipo: 'text/csv', tamanho: 10 }),
      'POST /api/widget/conversas/c1/mensagens': (c) => ({ mensagem: msg({ autor: 'usuario', texto: (c.corpo as { texto: string }).texto }) }),
    });
    const { container } = render(<ChatCopiloto token="tk" />);
    await screen.findByPlaceholderText('Escreva sua mensagem');
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    const arquivo = new File(['a;b'], 'planilha.csv', { type: 'text/csv' });
    await act(async () => {
      fireEvent.change(entrada, { target: { files: [arquivo] } });
      await esperarPromessas();
    });
    const anexo = srv.de('POST', '/api/widget/anexos')[0];
    expect(anexo.corpo).toBeInstanceOf(FormData);
    expect((anexo.corpo as FormData).get('arquivo')).toBeTruthy();
    expect(screen.getByText('planilha.csv')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Escreva sua mensagem'), { target: { value: 'segue a lista' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await esperarPromessas();
    });
    expect((srv.de('POST', '/api/widget/conversas/c1/mensagens')[0].corpo as { anexos: string[] }).anexos).toEqual(['ax1']);
  });
});

describe('PreviaWidget', () => {
  it('reflete nome, boas-vindas, sugestões, cor e posição sem servidor', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const config = {
      ...inicioFalso().config,
      nome: 'Hora',
      boasVindas: 'Posso cadastrar clientes e tirar dúvidas.',
      sugestoes: ['Cadastrar cliente', 'Como emitir segunda via?'],
      cor: '#0E7C66',
      posicao: 'esquerda' as const,
    };
    const { container } = render(<PreviaWidget config={config} usuarioNome="Ana Ribeiro" pagina="Clientes" />);
    expect(screen.getByText('Hora')).toBeTruthy();
    expect(screen.getByText('Posso cadastrar clientes e tirar dúvidas.')).toBeTruthy();
    expect(screen.getByText('Como emitir segunda via?')).toBeTruthy();
    expect(screen.getByText(/, Ana\./)).toBeTruthy();
    expect(screen.getByText('Você está em Clientes')).toBeTruthy();
    const raiz = container.querySelector('.cp-previa') as HTMLElement;
    expect(raiz.className).toContain('cp-previa-esquerda');
    expect(raiz.style.getPropertyValue('--brand-600')).toBe('rgb(14 124 102)');
    expect(raiz.style.getPropertyValue('--brand-btn')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Logo da empresa no avatar do copiloto', () => {
  const LOGO = {
    arquivo: '3f9ac1d2e4b5a6978877665544332211.png',
    nome: 'logo-horizonte.png',
    tamanho: 12 * 1024,
    tipo: 'image/png' as const,
    enviadoEm: '2026-10-17T13:00:00.000Z',
    url: 'http://localhost:3000/api/widget/marca/pk_demo/3f9ac1d2e4b5a6978877665544332211.png',
  };

  it('a prévia usa o logo no topo e ao lado da resposta; sem logo, o ícone padrão', () => {
    vi.stubGlobal('fetch', vi.fn());
    const config = { ...inicioFalso().config, logo: LOGO };
    const { container, rerender } = render(<PreviaWidget config={config} usuarioNome="Ana Ribeiro" />);
    const imagens = Array.from(container.querySelectorAll('.cp-avatar-logo img'));
    expect(imagens.length).toBeGreaterThanOrEqual(2); // cabeçalho + mensagem de boas-vindas
    expect(imagens.every((i) => i.getAttribute('src') === LOGO.url)).toBe(true);
    expect(container.querySelector('.widget-head .cp-avatar-logo img')).toBeTruthy();

    rerender(<PreviaWidget config={{ ...config, logo: null }} usuarioNome="Ana Ribeiro" />);
    expect(container.querySelector('.cp-avatar-logo')).toBeNull();
    expect(container.querySelector('.widget-head .avatar-bot svg')).toBeTruthy();
  });

  it('se a imagem do logo não abrir, volta ao ícone padrão', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container } = render(<PreviaWidget config={{ ...inicioFalso().config, logo: LOGO }} usuarioNome="Ana Ribeiro" />);
    const topo = container.querySelector('.widget-head .cp-avatar-logo img') as HTMLImageElement;
    fireEvent.error(topo);
    expect(container.querySelector('.widget-head .cp-avatar-logo')).toBeNull();
    expect(container.querySelector('.widget-head .avatar-bot svg')).toBeTruthy();
  });

  it('o chat ligado ao servidor usa o logo da configuração publicada nas respostas', async () => {
    servidorFalso({
      'GET /api/widget/sessao': () => inicioFalso({ conversaId: 'c1', config: { ...inicioFalso().config, logo: LOGO } }),
      'GET /api/widget/conversas/c1': () =>
        conversa([msg({ autor: 'usuario', texto: 'abre um chamado' }), msg({ autor: 'copiloto', texto: 'Para qual cliente?' })]),
    });
    const { container } = render(<ChatCopiloto token="tk" />);
    await screen.findByText('Para qual cliente?');
    const resposta = screen.getByText('Para qual cliente?').closest('.msg') as HTMLElement;
    expect(resposta.querySelector('.cp-avatar-logo img')?.getAttribute('src')).toBe(LOGO.url);
    expect(container.querySelector('.widget-head .cp-avatar-logo img')?.getAttribute('src')).toBe(LOGO.url);
  });
});

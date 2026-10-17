// Busca (acentos, radicais, status das fontes), perguntas sem resposta, responder com o modelo
// simulado e conversão das citações da API.
import { describe, expect, it } from 'vitest';
import { Conhecimento } from '../../src/conhecimento/index.ts';
import { extrairCitacoes, montarRespostaCitada, paraSearchResults } from '../../src/conhecimento/citacoes.ts';
import { consultaFts, normalizarChave, radical, semelhanca, termosDaPergunta } from '../../src/conhecimento/texto.ts';
import { simularResposta, FERRAMENTA_SEM_RESPOSTA } from '../../src/conhecimento/resposta.ts';
import type { Trecho } from '../../src/conhecimento/tipos.ts';
import { agoraIso, Banco } from '../../src/db/banco.ts';
import { LlmSimulado } from '../../src/llm/simulado.ts';
import type { BlocoResposta, Llm, PedidoTurno } from '../../src/llm/tipos.ts';
import { semearConhecimento } from '../../src/seed/conhecimento.ts';

function base(llm: Llm = new LlmSimulado()) {
  const banco = new Banco(':memory:');
  return { banco, c: new Conhecimento(banco, llm) };
}

function fonte(banco: Banco, id: string, status: string, trechos: { titulo: string; texto: string; local?: string }[]) {
  banco.inserir('conhecimento_fontes', { id, tipo: 'arquivo', nome: id, origem: id, status, meta: {}, criado_em: agoraIso() });
  for (const t of trechos) {
    banco.executar(
      'INSERT INTO conhecimento_trechos (fonte_id, titulo, local, url, texto) VALUES (?, ?, ?, NULL, ?)',
      id,
      t.titulo,
      t.local ?? null,
      t.texto,
    );
  }
}

describe('texto e consulta', () => {
  it('radicais simples juntam singular, plural e verbos', () => {
    expect(radical('boletos')).toBe(radical('boleto'));
    expect(radical('emito')).toBe(radical('emitir'));
    expect(radical('cadastro')).toBe(radical('cadastrar'));
    expect(radical('clientes')).toBe(radical('cliente'));
  });

  it('consulta FTS segura: sem operadores nem aspas da pessoa', () => {
    const q = consultaFts('Como emito a 2ª via do "boleto" OR NOT vencido? (urgente)* fatura');
    expect(q).toBe('"emit"* OR "segund"* OR "via"* OR "bolet"* OR "not"* OR "venc"* OR "urgent"* OR "fatur"*');
    expect(q).toMatch(/^("[a-z0-9]+"\*)( OR "[a-z0-9]+"\*)*$/);
    expect(consultaFts('como? que? para')).toBeNull();
  });

  it('agrupa perguntas iguais pela chave e acha parecidas', () => {
    expect(normalizarChave('Como cancelo a assinatura de um cliente?')).toBe(normalizarChave('cancelar assinatura dos clientes'));
    expect(semelhanca('cancelar assinatura', 'como cancelo a assinatura do cliente?')).toBeGreaterThanOrEqual(0.6);
    expect(semelhanca('como cadastrar cliente', 'como cancelar cliente')).toBeLessThan(0.6);
    expect(termosDaPergunta('Qual o prazo?').map((t) => t.palavra)).toEqual(['prazo']);
  });
});

describe('buscar', () => {
  it('encontra com ou sem acento e prioriza o trecho que cobre mais termos', () => {
    const { banco, c } = base();
    fonte(banco, 'f1', 'indexado', [
      { titulo: 'Cobrança', texto: 'A emissão de cobrança acontece no dia 1º de cada mês.' },
      { titulo: 'Segunda via', texto: 'Para gerar a segunda via do boleto vencido, acesse Financeiro › Segunda via.', local: 'página 12' },
      { titulo: 'Visitas', texto: 'A visita técnica é agendada na Agenda.' },
    ]);
    const r1 = c.buscar('cobranca');
    expect(r1[0].titulo).toBe('Cobrança');
    const r2 = c.buscar('Como emito a 2a via de um boleto vencido?');
    expect(r2[0]).toMatchObject({ titulo: 'Segunda via', local: 'página 12', fonteId: 'f1' });
    expect(r2[0].pontuacao).toBeGreaterThan(0.5);
    expect(c.buscar('visitas tecnicas')[0].titulo).toBe('Visitas');
    expect(c.buscar('')).toEqual([]);
    expect(c.buscar('"; DROP TABLE x; --')).toEqual([]);
  });

  it('usa só fontes indexadas (ou indexando); ignora erro e pausadas', () => {
    const { banco, c } = base();
    fonte(banco, 'ok', 'indexado', [{ titulo: 'A', texto: 'Prazo de pagamento de 30 dias.' }]);
    fonte(banco, 'parcial', 'indexando', [{ titulo: 'B', texto: 'Prazo de pagamento de 45 dias.' }]);
    fonte(banco, 'pausada', 'pausado', [{ titulo: 'C', texto: 'Prazo de pagamento de 60 dias.' }]);
    fonte(banco, 'quebrada', 'erro', [{ titulo: 'D', texto: 'Prazo de pagamento de 90 dias.' }]);
    const fontes = c.buscar('prazo de pagamento', 10).map((t) => t.fonteId).sort();
    expect(fontes).toEqual(['ok', 'parcial']);
    // Erro numa nova sincronização: a versão anterior continua valendo.
    banco.executar(`UPDATE conhecimento_fontes SET meta = '{"usaVersaoAnterior":true}' WHERE id = 'quebrada'`);
    expect(c.buscar('prazo de pagamento', 10).map((t) => t.fonteId)).toContain('quebrada');
  });
});

describe('perguntas sem resposta', () => {
  it('agrupa repetidas e parecidas, e volta para a lista se perguntada de novo', () => {
    const { banco, c } = base();
    c.registrarSemResposta('Como cancelo a assinatura de um cliente?', 'Nenhuma fonte fala disso');
    c.registrarSemResposta('como cancelar a assinatura do cliente', '');
    c.registrarSemResposta('Cancelar assinatura', 'x');
    c.registrarSemResposta('Onde vejo as comissões por vendedor?', 'Nenhuma fonte fala disso');
    const lista = c.listarSemResposta();
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ pergunta: 'Como cancelo a assinatura de um cliente?', vezes: 3, causa: 'x' });

    c.ignorarSemResposta(lista[1].id);
    c.registrarSemResposta('Onde vejo as comissões por vendedor?', 'Nenhuma fonte fala disso');
    expect(c.listarSemResposta()).toHaveLength(1);

    c.responderSemResposta(lista[0].id, 'Abra um chamado para o Financeiro.', 'Rafael Lima');
    expect(c.listarSemResposta()).toHaveLength(0);
    expect(() => c.ignorarSemResposta(lista[0].id)).toThrow(/já foi respondida/);
    // A resposta virou uma resposta pronta e já aparece na busca.
    expect(c.buscar('cancelar assinatura cliente')[0]).toMatchObject({
      titulo: 'Como cancelo a assinatura de um cliente?',
      local: 'resposta pronta',
    });
    // Perguntada de novo sem resposta, volta para a lista.
    c.registrarSemResposta('Como cancelo a assinatura de um cliente?', 'y');
    expect(c.listarSemResposta()[0].vezes).toBe(4);
    expect(banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM perguntas_sem_resposta')!.n).toBe(2);
  });

  it('causa provável cita a fonte que ainda está indexando', () => {
    const { banco, c } = base();
    fonte(banco, 'Manual do comercial.pdf', 'indexando', []);
    c.registrarSemResposta('Onde vejo as comissões?', '');
    expect(c.listarSemResposta()[0].causa).toBe('Pode estar em “Manual do comercial.pdf”, que ainda está indexando');
  });
});

describe('responder (modelo simulado)', () => {
  it('responde com o melhor trecho, cita e dá confiança alta', async () => {
    const { banco, c } = base();
    semearConhecimento(banco);
    const r = await c.responder('Como emito a segunda via de um boleto vencido?');
    expect(r.confianca).toBe('alta');
    expect(r.citacoes[0]).toMatchObject({ n: 1, titulo: 'Como emitir a segunda via de um boleto' });
    expect(r.citacoes[0].url).toBe('http://localhost:4000/ajuda/segunda-via-de-boleto');
    expect(r.texto).toMatch(/\[1\]/);
    expect(r.texto).toMatch(/vencid|segunda via/i);
    expect(r.duracaoMs).toBeGreaterThanOrEqual(0);
  });

  it('sem resposta nas fontes: confiança baixa e registra a pergunta (agrupando com o seed)', async () => {
    const { banco, c } = base();
    semearConhecimento(banco);
    const antes = c.listarSemResposta().find((p) => p.pergunta.startsWith('Como cancelo'))!;
    expect(antes.vezes).toBe(14);
    const r = await c.responder('Como cancelo a assinatura de um cliente?');
    expect(r.confianca).toBe('baixa');
    expect(r.citacoes).toEqual([]);
    expect(r.texto).toMatch(/Não encontrei/);
    expect(c.listarSemResposta().find((p) => p.id === antes.id)!.vezes).toBe(15);
  });

  it('nada na base: não chama o modelo', async () => {
    let chamadas = 0;
    const llm: Llm = {
      simulado: true,
      semChave: false,
      modeloPrincipal: 'x',
      turno: async () => {
        chamadas += 1;
        throw new Error('não devia chamar');
      },
      estruturado: async () => {
        throw new Error('não devia chamar');
      },
    };
    const { c } = base(llm);
    const r = await c.responder('Qual o prazo de pagamento?');
    expect(r).toMatchObject({ confianca: 'baixa', citacoes: [] });
    expect(chamadas).toBe(0);
    expect(c.listarSemResposta()[0].causa).toBe('Nenhuma fonte fala disso');
  });

  it('manda os trechos como search_result com citações e lê a resposta do Claude', async () => {
    let pedido: PedidoTurno | undefined;
    const llm: Llm = {
      simulado: false,
      semChave: false,
      modeloPrincipal: 'claude-opus-5-5',
      turno: async (p) => {
        pedido = p;
        const conteudo: BlocoResposta[] = [
          { type: 'thinking', thinking: '', signature: 'x' } as BlocoResposta,
          {
            type: 'text',
            text: 'Os prazos aceitos são 15, 30, 45 ou 60 dias.',
            citations: [
              {
                type: 'search_result_location',
                search_result_index: 0,
                source: 'http://localhost:4000/ajuda/prazos-de-pagamento',
                title: 'Prazos de pagamento aceitos',
                cited_text: 'O Horizonte aceita quatro prazos de pagamento: 15, 30, 45 ou 60 dias.',
                start_block_index: 0,
                end_block_index: 1,
              },
            ],
          } as BlocoResposta,
        ];
        return { conteudo, parada: 'end_turn', uso: { modelo: 'x', entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 }, usouReserva: false };
      },
      estruturado: async () => {
        throw new Error('não usado');
      },
    };
    const { banco, c } = base(llm);
    semearConhecimento(banco);
    const r = await c.responder('Quais prazos de pagamento são aceitos?');
    const conteudo = pedido!.mensagens[0].content as { type: string }[];
    expect(conteudo.filter((b) => b.type === 'search_result').length).toBeGreaterThan(0);
    expect(conteudo.at(-1)).toMatchObject({ type: 'text' });
    expect(pedido!.ferramentas.map((f) => f.name)).toEqual([FERRAMENTA_SEM_RESPOSTA]);
    expect(pedido!.finalidade).toBe('conhecimento');
    expect(r.texto).toBe('Os prazos aceitos são 15, 30, 45 ou 60 dias.[1]');
    expect(r.citacoes).toHaveLength(1);
    expect(r.citacoes[0]).toMatchObject({ n: 1, titulo: 'Prazos de pagamento aceitos', url: 'http://localhost:4000/ajuda/prazos-de-pagamento' });
    expect(r.confianca).toBe('alta');
  });
});

describe('citações', () => {
  const trechos: Trecho[] = [
    { fonteId: 'f1', titulo: 'Manual do financeiro.pdf', local: 'página 12', texto: 'Multa de 2%.\nJuros de 1% ao mês.', pontuacao: 1 },
    { fonteId: 'f2', titulo: 'Segunda via', url: 'http://x/ajuda/segunda-via', texto: 'Acesse Financeiro › Segunda via.', pontuacao: 0.8 },
    { fonteId: 'f2', titulo: 'Segunda via', url: 'http://x/ajuda/segunda-via', texto: 'Clique em Gerar 2ª via.', pontuacao: 0.7 },
  ];

  it('paraSearchResults: um bloco de texto por parágrafo, citações ligadas', () => {
    const sr = paraSearchResults(trechos);
    expect(sr[0]).toEqual({
      type: 'search_result',
      source: 'fonte:f1',
      title: 'Manual do financeiro.pdf (página 12)',
      content: [
        { type: 'text', text: 'Multa de 2%.' },
        { type: 'text', text: 'Juros de 1% ao mês.' },
      ],
      citations: { enabled: true },
    });
    expect(sr[1].source).toBe('http://x/ajuda/segunda-via');
  });

  it('extrairCitacoes: numera na ordem em que aparecem, sem repetir a mesma fonte', () => {
    const cit = (i: number, t: Trecho) => ({
      type: 'search_result_location' as const,
      search_result_index: i,
      source: t.url ?? `fonte:${t.fonteId}`,
      title: t.local ? `${t.titulo} (${t.local})` : t.titulo,
      cited_text: t.texto,
      start_block_index: 0,
      end_block_index: 1,
    });
    const conteudo = [
      { type: 'text', text: 'Acesse Financeiro › Segunda via', citations: [cit(1, trechos[1])] },
      { type: 'text', text: ' e clique em Gerar 2ª via.', citations: [cit(2, trechos[2])] },
      { type: 'text', text: ' A multa é de 2%.', citations: [cit(0, trechos[0])] },
      { type: 'text', text: ' Fim.', citations: null },
    ] as BlocoResposta[];
    expect(extrairCitacoes(conteudo, trechos)).toEqual([
      { n: 1, titulo: 'Segunda via', local: undefined, url: 'http://x/ajuda/segunda-via' },
      { n: 2, titulo: 'Manual do financeiro.pdf', local: 'página 12', url: undefined },
    ]);
    expect(montarRespostaCitada(conteudo, trechos).texto).toBe(
      'Acesse Financeiro › Segunda via[1] e clique em Gerar 2ª via.[1] A multa é de 2%.[2] Fim.',
    );
    // Índice que não bate (o chamador passou só parte dos trechos): acha pela fonte e pelo título.
    const soUm = [trechos[0]];
    expect(extrairCitacoes([conteudo[2]], soUm)).toEqual([{ n: 1, titulo: 'Manual do financeiro.pdf', local: 'página 12', url: undefined }]);
    expect(extrairCitacoes([conteudo[0]], soUm)).toEqual([]);
  });

  it('simulação: sem trecho relevante chama a ferramenta de sem resposta', () => {
    const blocos = simularResposta('Como integro com o meu ERP?', trechos);
    expect(blocos.some((b) => b.type === 'tool_use' && b.name === FERRAMENTA_SEM_RESPOSTA)).toBe(true);
  });
});

describe('causas das perguntas sem resposta', () => {
  it('códigos do agente e do widget viram texto simples', () => {
    const { c } = base();
    c.registrarSemResposta('Como exporto as notas fiscais?', 'resposta_nao_ajudou');
    c.registrarSemResposta('Tem integração com o banco?', 'sem_citacao');
    c.registrarSemResposta('Posso pagar com pix?', 'sem_fonte');
    const causas = Object.fromEntries(c.listarSemResposta().map((p) => [p.pergunta, p.causa]));
    expect(causas['Como exporto as notas fiscais?']).toBe('A pessoa marcou que a resposta não ajudou');
    expect(causas['Tem integração com o banco?']).toBe('O copiloto respondeu sem citar nenhuma fonte');
    expect(causas['Posso pagar com pix?']).toBe('Nenhuma fonte fala disso');
  });
});

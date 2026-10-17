// Servidor sem ANTHROPIC_API_KEY: o copiloto não finge responder. O widget avisa que o assistente
// não está ligado, o console mostra a faixa e as rotas que dependem do Claude devolvem 503.
import { afterEach, describe, expect, it } from 'vitest';
import type { Bloco, ResumoConsole, WidgetInicio } from '@copiloto/shared';
import { assinarUsuario } from '../../src/auth/widget.ts';
import { lerConfig } from '../../src/config.ts';
import { criarLlm } from '../../src/llm/index.ts';
import { LlmSemChave } from '../../src/llm/sem-chave.ts';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

describe('sem a chave do Claude', () => {
  it('a configuração só simula com COPILOTO_LLM=simulado; sem chave, fica sem Claude', () => {
    const base = lerConfig();
    const semChave = criarLlm({ ...base, llmSimulado: false, temChaveClaude: false }, () => {});
    expect(semChave).toMatchObject({ semChave: true, simulado: false });
    expect(criarLlm({ ...base, llmSimulado: true, temChaveClaude: false }, () => {})).toMatchObject({ simulado: true, semChave: false });
    expect(criarLlm({ ...base, llmSimulado: false, temChaveClaude: true }, () => {})).toMatchObject({ simulado: false, semChave: false });

    const antes = { chave: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN, llm: process.env.COPILOTO_LLM };
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.COPILOTO_LLM;
      expect(lerConfig()).toMatchObject({ llmSimulado: false, temChaveClaude: false });
      process.env.COPILOTO_LLM = 'simulado';
      expect(lerConfig()).toMatchObject({ llmSimulado: true });
    } finally {
      for (const [nome, valor] of [
        ['ANTHROPIC_API_KEY', antes.chave],
        ['ANTHROPIC_AUTH_TOKEN', antes.token],
        ['COPILOTO_LLM', antes.llm],
      ] as const) {
        if (valor === undefined) delete process.env[nome];
        else process.env[nome] = valor;
      }
    }
  });

  it('o widget avisa que o assistente não está ligado e oferece uma pessoa', async () => {
    amb = await criarAmbiente({ llm: new LlmSemChave('claude-opus-5-5') });
    const r = await amb.app.inject({
      method: 'POST',
      url: '/api/widget/iniciar',
      payload: { chave: amb.ctx.configuracoes.ler('widget_chave_publica'), usuario: '101', assinatura: assinarUsuario('101', amb.config.segredoWidget) },
    });
    expect(r.statusCode).toBe(200);
    const inicio = r.json<WidgetInicio>();
    expect(inicio).toMatchObject({ semClaude: true, modoSimulado: false });
    const api = (url: string, payload?: object) =>
      amb!.app.inject({ method: 'POST', url: `/api/widget${url}`, headers: { authorization: `Bearer ${inicio.token}` }, payload });
    const conversa = (await api('/conversas', {})).json<{ id: string }>();
    expect((await api(`/conversas/${conversa.id}/mensagens`, { texto: 'cadastra o cliente Pólen Café', idCliente: 'c-1' })).statusCode).toBe(200);
    await amb.ctx.agente.ocioso();

    const respostas = amb.ctx.conversas.mensagens(conversa.id).filter((m) => m.autor === 'copiloto');
    const blocos = respostas.flatMap((m) => m.blocos) as Bloco[];
    expect(blocos).toContainEqual(
      expect.objectContaining({
        tipo: 'erro',
        titulo: 'O assistente ainda não está ligado',
        acoes: [expect.objectContaining({ acao: 'humano' })],
      }),
    );
    // Nenhum texto inventado: a única resposta é o aviso.
    expect(respostas.every((m) => !m.texto)).toBe(true);
    expect(amb.ctx.banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM execucoes')!.n).toBe(0);
  });

  it('o console mostra a faixa e as rotas que dependem do Claude dizem o que falta', async () => {
    amb = await criarAmbiente({ llm: new LlmSemChave('claude-opus-5-5') });
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const resumo = (await amb.app.inject({ method: 'GET', url: '/api/console/resumo', headers: { cookie } })).json<ResumoConsole>();
    expect(resumo).toMatchObject({ semClaude: true, modoSimulado: false });

    const r = await amb.app.inject({
      method: 'POST',
      url: '/api/console/tarefas/descrever',
      headers: { cookie },
      payload: { descricao: 'Abre um chamado de suporte para o cliente, com assunto e prioridade.' },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({
      erro: 'sem_claude',
      mensagem: 'O copiloto está sem a chave do Claude neste servidor. Quem administra o servidor precisa definir ANTHROPIC_API_KEY.',
    });
  });
});

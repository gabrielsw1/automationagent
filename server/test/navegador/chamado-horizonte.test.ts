// De ponta a ponta com o sistema de exemplo (Horizonte) de verdade e o Chromium de verdade:
// a gravação de "Abrir chamado" (os eventos que o gravador manda), a tarefa criada pelo fluxo, o
// teste como Ana (o número do chamado lido do aviso da tela), "Usar este lugar", publicar com o
// widget ligado e o pedido no widget até o recibo com o número real do chamado aberto no Horizonte.
// O copiloto (modo simulado) e o Horizonte sobem aqui mesmo, em portas livres de 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Bloco, EventoGravado, Fluxo, FluxoPublicado, MensagemWidget } from '@copiloto/shared';
import { criarServidor } from '@copiloto/sistema-exemplo/src/servidor.ts';
import { criarApp } from '../../src/app.ts';
import { assinarUsuario } from '../../src/auth/widget.ts';
import { lerConfig, type Config } from '../../src/config.ts';
import type { Contexto } from '../../src/contexto.ts';
import { LlmSimulado } from '../../src/llm/simulado.ts';
import { Plataforma, sistemaNovo } from '../../src/plataforma/index.ts';
import { entrarComo } from '../ajuda.ts';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'copiloto-chamado-'));
let horizonte: FastifyInstance;
let urlHorizonte: string;
let copiloto: FastifyInstance;
let plataforma: Plataforma;
let ctx: Contexto;
let config: Config;
let cookieConsole: string;

async function ouvir(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

function ok(r: LightMyRequestResponse) {
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
}

function consoleApi(metodo: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  return copiloto.inject({ method: metodo, url: `/api/console${url}`, headers: { cookie: cookieConsole }, payload });
}

/** O que o gravador manda ao abrir um chamado na tela do Horizonte (só o formato do que foi digitado). */
function eventosChamado(base: string): EventoGravado[] {
  const url = `${base}/chamados`;
  const t0 = Date.now() - 60_000;
  const campo = (tag: string, nome: string, rotulo: string, extra: Partial<NonNullable<EventoGravado['elemento']>> = {}) => ({
    tag,
    id: nome,
    name: nome,
    rotulo,
    css: `#${nome}`,
    ...extra,
  });
  const opcoes = '<option value="">Selecione</option><option value="Baixa">Baixa</option><option value="Média">Média</option><option value="Alta">Alta</option><option value="Urgente">Urgente</option>';
  return [
    { tipo: 'navegar', ts: t0, url, tituloPagina: 'Chamados · Horizonte' },
    { tipo: 'preencher', ts: t0 + 3_000, url, elemento: campo('input', 'assunto', 'Assunto', { type: 'text' }), formatoValor: 'aaaaaaaaaa aaa aaaaa' },
    { tipo: 'preencher', ts: t0 + 6_000, url, elemento: campo('input', 'cliente', 'Cliente', { type: 'text' }), formatoValor: 'aaaaaaa aaaaaaa' },
    {
      tipo: 'selecionar',
      ts: t0 + 8_000,
      url,
      elemento: campo('select', 'prioridade', 'Prioridade', { contexto: `<select id="prioridade" name="prioridade">${opcoes}</select>` }),
      opcaoTexto: 'Alta',
    },
    { tipo: 'preencher', ts: t0 + 14_000, url, elemento: campo('textarea', 'descricao', 'Descrição'), formatoValor: 'a aaaaaaaaa aa aaaaa aaaaa aa aaaaaaaa' },
    { tipo: 'clique', ts: t0 + 16_000, url, elemento: { tag: 'button', type: 'submit', texto: 'Abrir chamado', css: 'form.painel > button[type="submit"]' } },
    { tipo: 'navegar', ts: t0 + 16_400, url: `${base}/chamados?aberto=999`, tituloPagina: 'Chamados · Horizonte' },
  ];
}

beforeAll(async () => {
  horizonte = criarServidor({ arquivoDados: null, logger: false });
  urlHorizonte = await ouvir(horizonte);
  config = {
    ...lerConfig(),
    llmSimulado: true,
    dirDados: path.join(temp, 'dados'),
    navegadorVisivel: false,
    sistema: { nome: 'Horizonte', urlBase: urlHorizonte, urlApi: urlHorizonte, chaveServico: 'chave-servico-local' },
  };
  // A empresa de demonstração, ligada pela API ao Horizonte que subiu aqui; o navegador é o de verdade.
  plataforma = new Plataforma(config, { emMemoria: true, llm: () => new LlmSimulado() });
  const empresa = plataforma.criarEmpresa({ nome: 'Horizonte', demo: true, sistema: { ...sistemaNovo('Horizonte', urlHorizonte), conector: 'api' } });
  ctx = plataforma.contexto(empresa.id);
  copiloto = await criarApp(plataforma);
  cookieConsole = entrarComo(ctx, 'editor', 'Júlia Martins').cookie;
}, 60_000);

afterAll(async () => {
  await copiloto?.close();
  await ctx?.navegador.fechar().catch(() => undefined);
  await horizonte?.close();
  await plataforma?.fechar();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('Abrir chamado no Horizonte, do gravador ao recibo com o número real', { timeout: 180_000 }, () => {
  it('lê o número do chamado na tela no teste e no widget, com o link para abrir o chamado', async () => {
    // Gravação (o que a extensão manda) e conclusão.
    const { fluxo, token } = ok(await consoleApi('POST', '/fluxos', { nome: 'Abrir chamado', urlInicial: '/chamados' })) as { fluxo: Fluxo; token: string };
    ok(await copiloto.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventosChamado(urlHorizonte) } }));
    ok(await copiloto.inject({ method: 'POST', url: `/api/gravacao/${token}/concluir` }));
    const gravado = ok(await consoleApi('GET', `/fluxos/${fluxo.id}`)) as Fluxo;
    expect(gravado.passos.map((p) => p.titulo)).toEqual([
      'Abrir a tela de chamados',
      'Preencher assunto',
      'Preencher cliente',
      'Selecionar prioridade',
      'Preencher descrição',
      'Clicar em Abrir chamado',
    ]);

    // Mapear: a tarefa nasce dos campos sugeridos. Teste como Ana, sem lugar configurado.
    const { tarefaId } = ok(await consoleApi('POST', `/fluxos/${fluxo.id}/criar-tarefa`)) as { tarefaId: string };
    const valoresTeste = { assunto: 'Teste do fluxo gravado', cliente: 'Padaria Estrela', prioridade: 'Baixa', descricao: 'Teste do fluxo gravado pelo copiloto.' };
    const teste = ok(await consoleApi('POST', `/fluxos/${fluxo.id}/testar`, { usuarioId: '101', valores: valoresTeste }));
    expect(teste.resultado.ok, JSON.stringify(teste.resultado)).toBe(true);
    const chamadoDoTeste = horizonte.horizonte.chamados().find((c) => c.assunto === 'Teste do fluxo gravado')!;
    expect(chamadoDoTeste.numero).toMatch(/^CH-\d{4}-\d{4}$/);
    // O número veio do aviso de confirmação da tela, e o lugar sugerido é o elemento do número.
    expect(teste.resultado.registro).toMatchObject({
      numero: chamadoDoTeste.numero,
      nome: 'Chamado',
      artigo: 'o',
      url: `${urlHorizonte}/chamados/${chamadoDoTeste.id}`,
      texto: `Chamado ${chamadoDoTeste.numero} aberto.`,
      seletor: '[data-campo="numero_chamado"]',
      origem: 'aviso',
    });
    expect(teste.fluxo.ultimoTeste).toMatchObject({ ok: true, usuarioNome: 'Ana Ribeiro', registro: { numero: chamadoDoTeste.numero } });

    // "Usar este lugar": o número passa a ser lido daquele elemento, com o formato. Testa de novo.
    const lugar = { seletor: teste.resultado.registro.seletor as string, formato: 'CH-9999-9999', nome: 'Chamado' };
    ok(await consoleApi('PUT', `/fluxos/${fluxo.id}`, { resultado: lugar }));
    const teste2 = ok(await consoleApi('POST', `/fluxos/${fluxo.id}/testar`, { usuarioId: '101', valores: { ...valoresTeste, assunto: 'Segundo teste do fluxo' } }));
    const chamadoDoTeste2 = horizonte.horizonte.chamados().find((c) => c.assunto === 'Segundo teste do fluxo')!;
    expect(teste2.resultado.registro).toMatchObject({ numero: chamadoDoTeste2.numero, origem: 'configurado', seletor: lugar.seletor });
    expect(chamadoDoTeste2.numero).not.toBe(chamadoDoTeste.numero);

    // Publicar (F3) com o widget ligado: o fluxo e a tarefa de uma vez.
    const publicado = ok(await consoleApi('POST', `/fluxos/${fluxo.id}/publicar`, { ativar: true })) as FluxoPublicado;
    expect(publicado.tarefa).toMatchObject({ id: tarefaId, status: 'ativa', ativada: true });

    // Widget como Ana: pede do jeito dela, responde o que falta, confirma.
    const inicio = ok(
      await copiloto.inject({
        method: 'POST',
        url: '/api/widget/iniciar',
        payload: {
          chave: ctx.configuracoes.ler('widget_chave_publica'),
          usuario: '101',
          assinatura: assinarUsuario('101', config.segredoWidget),
          pagina: { secao: 'Chamados', titulo: 'Chamados · Horizonte' },
        },
      }),
    );
    const widget = (metodo: 'GET' | 'POST', url: string, payload?: object) =>
      copiloto.inject({ method: metodo, url: `/api/widget${url}`, headers: { authorization: `Bearer ${inicio.token}` }, payload });
    const conversaId = ok(await widget('POST', '/conversas', { contexto: { secao: 'Chamados' } })).id as string;
    const ultimo = <T extends Bloco['tipo']>(tipo: T) =>
      (ctx.conversas.mensagens(conversaId) as MensagemWidget[])
        .flatMap((m) => m.blocos)
        .filter((b): b is Extract<Bloco, { tipo: T }> => b.tipo === tipo)
        .at(-1);
    const dizer = async (texto: string) => {
      ok(await widget('POST', `/conversas/${conversaId}/mensagens`, { texto, idCliente: `e2e-${Date.now()}` }));
      await ctx.agente.ocioso();
      await ctx.motor.ocioso();
    };

    await dizer('Abre um chamado para a Padaria Estrela sobre impressora sem tinta, prioridade alta');
    expect(ultimo('coleta')?.pergunta).toBe('Qual é a descrição?');
    await dizer('A impressora do caixa parou de imprimir os cupons fiscais.');
    const cartao = ultimo('confirmacao')!;
    expect(cartao.campos.map((c) => c.rotulo)).toEqual(['Assunto', 'Cliente', 'Prioridade', 'Descrição']);
    ok(await widget('POST', `/execucoes/${cartao.execucaoId}/confirmar`));
    await expect.poll(() => ultimo('recibo')?.titulo, { timeout: 90_000, interval: 500 }).toBe('Abrir chamado: feito');

    // O chamado que o navegador do copiloto abriu no Horizonte, como Ana, e o número que ele recebeu.
    const chamado = horizonte.horizonte.chamados().find((c) => c.assunto === 'impressora sem tinta')!;
    expect(chamado).toMatchObject({ prioridade: 'Alta', cliente_nome: 'Padaria Estrela Ltda', criado_por: '101' });
    const recibo = ultimo('recibo')!;
    expect(recibo.registro).toEqual({ nome: 'Chamado', numero: chamado.numero, detalhes: ['Padaria Estrela', 'Prioridade alta'] });
    expect(recibo.link).toEqual({ rotulo: 'Abrir o chamado', url: `${urlHorizonte}/chamados/${chamado.id}` });
    // Cliente e prioridade foram para a linha do número; o resto fica na lista.
    expect(recibo.campos.map((c) => c.rotulo)).toEqual(['Assunto', 'Descrição']);
    // O Horizonte abre a sessão de Ana para o navegador: o recibo diz isso, como no design.
    expect(recibo.resumo).toBe('Feito com a sua sessão');
    // O registro da execução guarda o código do chamado.
    const execucao = ok(await consoleApi('GET', `/execucoes/${cartao.execucaoId}`));
    expect(JSON.stringify(execucao)).toContain(chamado.numero);
  });
});

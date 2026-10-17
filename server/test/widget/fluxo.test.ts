// Fluxo completo do widget com o modelo simulado e o adaptador falso: pedido, coleta, cartão,
// confirmação, recibo, desfazer, conflito, aprovação, base de conhecimento, pessoa e sistema fora.
import { afterEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import type { Bloco, MensagemWidget, TarefaDefinicao } from '@copiloto/shared';
import { assinarUsuario } from '../../src/auth/widget.ts';
import { lerExecucao } from '../../src/execucao/registro.ts';
import { semearConhecimento } from '../../src/seed/conhecimento.ts';
import { ALTERAR_PLANO, CADASTRAR_CLIENTE } from '../../src/seed/tarefas.ts';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

function publicar(a: Ambiente, def: TarefaDefinicao, slug: string) {
  const t = a.ctx.catalogo.criar(def, null, slug);
  a.ctx.catalogo.publicar(t.id, 'Teste', null);
  return t;
}

async function preparar(): Promise<Ambiente> {
  const a = await criarAmbiente();
  a.ctx.motor.esperasRetentativaMs = [0, 0];
  a.ctx.motor.atrasoSimuladoMs = 0;
  publicar(a, CADASTRAR_CLIENTE, 'cadastrar_cliente');
  publicar(a, ALTERAR_PLANO, 'alterar_plano');
  return a;
}

type Pedido = (method: 'GET' | 'POST', url: string, payload?: object) => Promise<LightMyRequestResponse>;

async function abrirWidget(a: Ambiente, usuario = '101') {
  const r = await a.app.inject({
    method: 'POST',
    url: '/api/widget/iniciar',
    payload: {
      chave: a.ctx.configuracoes.ler('widget_chave_publica'),
      usuario,
      assinatura: assinarUsuario(usuario, a.config.segredoWidget),
      pagina: { secao: 'Clientes', titulo: 'Clientes · Horizonte' },
    },
  });
  expect(r.statusCode).toBe(200);
  const inicio = r.json();
  const api: Pedido = (method, url, payload) =>
    a.app.inject({ method, url: `/api/widget${url}`, headers: { authorization: `Bearer ${inicio.token}` }, payload });
  const c = await api('POST', '/conversas', { contexto: { secao: 'Clientes' } });
  expect(c.statusCode).toBe(200);
  return { inicio, api, conversaId: c.json().id as string };
}

async function esperar(a: Ambiente) {
  await a.ctx.agente.ocioso();
  await a.ctx.motor.ocioso();
}

async function enviar(a: Ambiente, api: Pedido, conversaId: string, texto: string) {
  const r = await api('POST', `/conversas/${conversaId}/mensagens`, { texto, idCliente: `c-${Math.random()}` });
  expect(r.statusCode).toBe(200);
  await esperar(a);
}

function mensagens(a: Ambiente, conversaId: string): MensagemWidget[] {
  return a.ctx.conversas.mensagens(conversaId);
}

function ultimoBloco<T extends Bloco['tipo']>(a: Ambiente, conversaId: string, tipo: T): Extract<Bloco, { tipo: T }> {
  const lista = mensagens(a, conversaId).flatMap((m) => m.blocos).filter((b) => b.tipo === tipo);
  const b = lista[lista.length - 1];
  expect(b, `bloco ${tipo}`).toBeTruthy();
  return b as Extract<Bloco, { tipo: T }>;
}

describe('widget de ponta a ponta', () => {
  it('abre com saudação, sugestões da página e sem chave inválida', async () => {
    amb = await preparar();
    const ruim = await amb.app.inject({ method: 'POST', url: '/api/widget/iniciar', payload: { chave: 'x', usuario: '101' } });
    expect(ruim.statusCode).toBe(401);
    const semAssinatura = await amb.app.inject({
      method: 'POST',
      url: '/api/widget/iniciar',
      payload: { chave: amb.ctx.configuracoes.ler('widget_chave_publica'), usuario: '101', assinatura: 'errada' },
    });
    expect(semAssinatura.statusCode).toBe(401);
    const { inicio } = await abrirWidget(amb);
    expect(inicio.usuario.primeiroNome).toBe('Ana');
    expect(inicio.sugestoes[0].rotulo).toBe('Cadastrar cliente');
    expect(inicio.modoSimulado).toBe(true);
  });

  it('coleta o que falta, mostra o cartão, grava só depois do confirmo e desfaz pelo recibo', async () => {
    amb = await preparar();
    const { api, conversaId } = await abrirWidget(amb);
    await enviar(amb, api, conversaId, 'cadastra o cliente Pólen Café, CNPJ 11.222.333/0001-81, prazo 30 dias');

    const coleta = ultimoBloco(amb, conversaId, 'coleta');
    expect(coleta.pergunta).toMatch(/e-mail de cobrança/i);
    expect(coleta.itens.map((i) => i.rotulo)).toEqual(expect.arrayContaining(['Nome da empresa', 'CNPJ', 'Prazo de pagamento']));
    expect(amb.adaptador.chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);

    await enviar(amb, api, conversaId, 'financeiro@polencafe.com.br');
    const cartao = ultimoBloco(amb, conversaId, 'confirmacao');
    expect(cartao.estado).toBe('pendente');
    expect(cartao.campos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rotulo: 'E-mail de cobrança', valor: 'financeiro@polencafe.com.br' }),
        expect.objectContaining({ rotulo: 'Responsável', valor: 'Ana Ribeiro', editavel: true }),
      ]),
    );
    // Nada gravado antes de confirmar.
    expect(amb.adaptador.clientes).toHaveLength(1);

    const conf = await api('POST', `/execucoes/${cartao.execucaoId}/confirmar`);
    expect(conf.statusCode).toBe(200);
    await esperar(amb);

    const recibo = ultimoBloco(amb, conversaId, 'recibo');
    expect(recibo.titulo).toBe('Cliente Pólen Café criado (#4821)');
    expect(recibo.resumo).toMatch(/Feito via API em .* · EX-\d+/);
    expect(recibo.desfazerAte).toBeTruthy();
    expect(recibo.link?.url).toContain('/clientes/4821');
    expect(amb.adaptador.clientes.map((c) => c.razao_social)).toContain('Pólen Café');
    const exec = lerExecucao(amb.ctx.banco, cartao.execucaoId)!;
    expect(exec.status).toBe('concluida');
    expect(exec.confirmadoPor).toBe('Ana Ribeiro');
    // Próximos passos e avaliação depois do recibo.
    expect(ultimoBloco(amb, conversaId, 'sugestoes').itens[0].rotulo).toMatch(/Agendar visita técnica para Pólen Café/);

    // Confirmar de novo não grava duas vezes.
    await api('POST', `/execucoes/${cartao.execucaoId}/confirmar`);
    await esperar(amb);
    expect(amb.adaptador.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/v1/clientes')).toHaveLength(1);

    const desfazer = await api('POST', `/execucoes/${cartao.execucaoId}/desfazer`);
    expect(desfazer.statusCode).toBe(200);
    await esperar(amb);
    expect(lerExecucao(amb.ctx.banco, cartao.execucaoId)!.status).toBe('desfeita');
    expect(amb.adaptador.clientes.map((c) => c.razao_social)).not.toContain('Pólen Café');
  });

  it('avisa quando o CNPJ já existe, sem gravar, e oferece abrir ou atualizar', async () => {
    amb = await preparar();
    const { api, conversaId } = await abrirWidget(amb);
    await enviar(
      amb,
      api,
      conversaId,
      'cadastra o cliente ACME Logística, CNPJ 12.345.678/0001-95, prazo 30 dias, cobrança financeiro@acmelog.com.br',
    );
    const cartao = ultimoBloco(amb, conversaId, 'confirmacao');
    await api('POST', `/execucoes/${cartao.execucaoId}/confirmar`);
    await esperar(amb);
    const conflito = ultimoBloco(amb, conversaId, 'conflito');
    expect(conflito.acoes.map((x) => x.acao)).toEqual(expect.arrayContaining(['abrir', 'atualizar']));
    expect(amb.adaptador.clientes).toHaveLength(1);
    const exec = lerExecucao(amb.ctx.banco, cartao.execucaoId)!;
    expect(exec.status).toBe('falhou');
    expect(exec.erro).toBe('conflito');
  });

  it('pede aprovação quando a pessoa não tem o perfil, e executa como quem aprovou', async () => {
    amb = await preparar();
    const { api, conversaId } = await abrirWidget(amb);
    await enviar(amb, api, conversaId, 'muda o plano da ACME para Premium');
    const aprovacao = ultimoBloco(amb, conversaId, 'aprovacao');
    expect(aprovacao.estado).toBe('rascunho');
    expect(aprovacao.aprovador?.nome).toBe('Rafael Lima');

    expect((await api('POST', `/aprovacoes/${aprovacao.aprovacaoId}/enviar`)).statusCode).toBe(200);
    await esperar(amb);
    expect(ultimoBloco(amb, conversaId, 'aprovacao').estado).toBe('enviada');
    expect(lerExecucao(amb.ctx.banco, aprovacao.execucaoId)!.status).toBe('aguardando_aprovacao');

    const { cookie } = entrarComo(amb.ctx, 'admin');
    const decisao = await amb.app.inject({
      method: 'POST',
      url: `/api/console/execucoes/aprovacoes/${aprovacao.aprovacaoId}/decidir`,
      headers: { cookie },
      payload: { aprovado: true },
    });
    expect(decisao.statusCode).toBe(200);
    await esperar(amb);
    const exec = lerExecucao(amb.ctx.banco, aprovacao.execucaoId)!;
    expect(exec.status).toBe('concluida');
    const chamada = amb.adaptador.chamadas.find((c) => c.caminho === '/v1/planos/alteracoes');
    expect(chamada?.usuarioId).toBe('105');
    expect(amb.adaptador.clientes[0].plano).toBe('Premium');
    expect(ultimoBloco(amb, conversaId, 'recibo').titulo).toBe('Plano de ACME Log Ltda alterado para Premium');
  });

  it('responde dúvidas pela base de conhecimento, com fonte citada', async () => {
    amb = await preparar();
    semearConhecimento(amb.ctx.banco);
    const { api, conversaId } = await abrirWidget(amb);
    await enviar(amb, api, conversaId, 'como emitir a segunda via de um boleto vencido?');
    const ultima = mensagens(amb, conversaId).filter((m) => m.autor === 'copiloto').pop()!;
    expect(ultima.texto).toMatch(/\[1\]/);
    const fontes = ultima.blocos.find((b) => b.tipo === 'fontes');
    expect(fontes && fontes.tipo === 'fontes' && fontes.itens[0].titulo).toMatch(/segunda via/i);
  });

  it('passa para uma pessoa com resumo e o suporte responde na conversa', async () => {
    amb = await preparar();
    const { api, conversaId } = await abrirWidget(amb);
    await enviar(amb, api, conversaId, 'quero falar com uma pessoa');
    const resumo = ultimoBloco(amb, conversaId, 'resumo_humano');
    expect(resumo.itens.map((i) => i.rotulo)).toContain('Pedido');
    expect(amb.ctx.conversas.buscar(conversaId)!.estado.modo).toBe('aguardando_pessoa');
    // Enquanto espera a pessoa, o copiloto não responde.
    const antes = mensagens(amb, conversaId).length;
    await enviar(amb, api, conversaId, 'oi?');
    expect(mensagens(amb, conversaId).filter((m) => m.autor === 'copiloto').length).toBe(
      mensagens(amb, conversaId)
        .slice(0, antes)
        .filter((m) => m.autor === 'copiloto').length,
    );
  });

  it('com o sistema fora do ar, tenta de novo, avisa sem gravar e oferece tentar de novo', async () => {
    amb = await preparar();
    const { api, conversaId } = await abrirWidget(amb);
    await enviar(
      amb,
      api,
      conversaId,
      'cadastra o cliente Pólen Café, CNPJ 11.222.333/0001-81, prazo 30 dias, cobrança financeiro@polencafe.com.br',
    );
    const cartao = ultimoBloco(amb, conversaId, 'confirmacao');
    amb.adaptador.fora = true;
    await api('POST', `/execucoes/${cartao.execucaoId}/confirmar`);
    await esperar(amb);
    const erro = ultimoBloco(amb, conversaId, 'erro');
    expect(erro.acoes.map((x) => x.acao)).toContain('tentar');
    expect(lerExecucao(amb.ctx.banco, cartao.execucaoId)!.status).toBe('falhou');
    expect(amb.adaptador.clientes).toHaveLength(1);

    amb.adaptador.fora = false;
    const tentar = await api('POST', `/execucoes/${cartao.execucaoId}/tentar`);
    expect(tentar.statusCode).toBe(200);
    await esperar(amb);
    expect(amb.adaptador.clientes.map((c) => c.razao_social)).toContain('Pólen Café');
  });

  it('não deixa uma pessoa ver a conversa de outra', async () => {
    amb = await preparar();
    const ana = await abrirWidget(amb, '101');
    const marcos = await abrirWidget(amb, '102');
    const r = await marcos.api('GET', `/conversas/${ana.conversaId}`);
    expect(r.statusCode).toBe(404);
  });
});

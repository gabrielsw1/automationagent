// Plano e créditos (S5) pela API: o que o Admin vê, pacotes na cobrança manual e pelo Asaas (falso),
// o aviso de pagamento, a recarga automática, o PDF da fatura e o pedido de mudança de plano.
import { afterEach, describe, expect, it } from 'vitest';
import type { DadosCobranca, Fatura, FaturasEmpresaStarta, PacoteComprado, PedidoMudancaPlano, PlanoECreditos, RecargaAutomatica } from '@copiloto/shared';
import { criarAmbiente, entrarComo, entrarNaPlataforma, ultimoEmail, type Ambiente } from '../ajuda.ts';
import { asaasFalso, COM_ASAAS, empresaCliente, gastar, SEM_ASAAS } from './ajuda-cobranca.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

function api(a: Ambiente, metodo: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: object) {
  return a.app.inject({ method: metodo, url: `/api/console${url}`, payload, headers: { cookie } });
}

function plataforma(a: Ambiente, metodo: 'GET' | 'POST', url: string, cookie: string) {
  return a.app.inject({ method: metodo, url: `/api/plataforma${url}`, headers: { cookie } });
}

function aviso(a: Ambiente, corpo: object, token: string | null = COM_ASAAS.tokenWebhook) {
  return a.app.inject({ method: 'POST', url: '/api/pagamentos/asaas', payload: corpo, headers: token ? { 'asaas-access-token': token } : {} });
}

/** Um minuto atrás: dentro do ciclo corrente. */
const agorinha = () => new Date(Date.now() - 60_000);

describe('Plano e créditos: quem vê', () => {
  it('só o Admin vê; editor e leitor recebem 403', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { ctx, admin } = empresaCliente(amb, { incluidos: 3000, mensal: 99_000, taxa: 150_000, credito: 40 });
    gastar(ctx, agorinha(), { conserto: true, tarefaId: 'trf_visita', nome: 'Agendar visita técnica' });
    gastar(ctx, agorinha());
    const r = await api(amb, 'GET', '/plano', admin.cookie);
    expect(r.statusCode).toBe(200);
    const p = r.json<PlanoECreditos>();
    expect(p).toMatchObject({
      exemplo: false,
      plano: { id: 'piloto', nome: 'Piloto', creditosIncluidos: 3000, pacoteCreditos: 1000 },
      ciclo: { incluidos: 3000, usados: 6, creditosRoteiro: 1, creditosConserto: 5, restantes: 2994 },
      pacote: { creditos: 1000, precoCentavos: 40_000, pendente: null },
      pagamentos: { modo: 'manual', notaFiscal: false, cartaoGuardado: false },
      podeAlterar: true,
      motivoSomenteLeitura: null,
      limiteMensal: 1500,
      usuariosMes: 1,
    });
    // A fatura do mês, ao vivo: primeira fatura, então leva a taxa de implantação.
    expect(p.faturaAberta).toMatchObject({ totalCentavos: 249_000 });
    expect(p.faturaAberta!.itens.map((i) => i.descricao)).toEqual(['Taxa de implantação', 'Assinatura Piloto']);
    expect(p.uso.atual.tarefas.map((t) => t.nome)).toEqual(['Agendar visita técnica', 'Abrir chamado']);
    expect(p.planos.map((x) => x.id)).toEqual(['piloto', 'crescimento', 'escala']);

    for (const perfil of ['editor', 'leitor', 'suporte'] as const) {
      const outro = entrarComo(ctx, perfil, 'Outra pessoa', `${perfil}@clinicamais.com.br`);
      expect((await api(amb, 'GET', '/plano', outro.cookie)).statusCode).toBe(403);
      expect((await api(amb, 'POST', '/plano/pacotes', outro.cookie)).statusCode).toBe(403);
    }
  });

  it('a demonstração tem plano Piloto e faturas de exemplo, sem compras; a Starta no suporte só vê', async () => {
    amb = await criarAmbiente({ semear: true, config: { asaas: SEM_ASAAS } });
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael.teste@seusistema.com.br');
    const p = (await api(amb, 'GET', '/plano', rafael.cookie)).json<PlanoECreditos>();
    expect(p).toMatchObject({ exemplo: true, plano: { id: 'piloto' }, podeAlterar: false, cobranca: { razaoSocial: 'Horizonte Gestão Ltda', cartao: { final: '4417' } } });
    expect(p.motivoSomenteLeitura).toContain('Demonstração');
    expect(p.faturas).toHaveLength(2);
    expect(p.faturas.every((f) => f.exemplo && f.status === 'paga' && f.tipo === 'mensal')).toBe(true);
    // Sem preços definidos, as faturas de exemplo não inventam valores.
    expect(p.faturas.every((f) => f.totalCentavos === null)).toBe(true);
    expect(p.faturas[1].itens.map((i) => i.descricao)).toEqual(['Taxa de implantação', 'Assinatura Piloto']);
    const compra = await api(amb, 'POST', '/plano/pacotes', rafael.cookie);
    expect(compra.statusCode).toBe(403);
    expect(compra.json<{ mensagem: string }>().mensagem).toContain('Demonstração');

    // Modo suporte: vê a página e o PDF, mas não compra nem pede mudança.
    const g = await entrarNaPlataforma(amb);
    const r = await amb.app.inject({
      method: 'POST',
      url: `/api/plataforma/empresas/${amb.ctx.empresa.id}/suporte`,
      payload: { motivo: 'A empresa pediu ajuda com a fatura' },
      headers: { cookie: g.cookie },
    });
    const suporte = ([] as string[]).concat(r.headers['set-cookie'] as string[]).find((c) => c.startsWith('copiloto_sessao='))!.split(';')[0];
    const visto = await api(amb, 'GET', '/plano', suporte);
    expect(visto.statusCode).toBe(200);
    expect(visto.json<PlanoECreditos>().motivoSomenteLeitura).toContain('Modo suporte');
    expect((await api(amb, 'GET', `/plano/faturas/${p.faturas[0].id}/pdf`, suporte)).statusCode).toBe(200);
    expect((await api(amb, 'POST', '/plano/mudanca', suporte, { planoId: 'crescimento' })).statusCode).toBe(403);
    expect((await api(amb, 'POST', '/plano/pacotes', suporte)).statusCode).toBe(403);
  });
});

describe('pacote de créditos na cobrança manual', () => {
  it('cria a fatura; os créditos entram quando a Starta marca como paga', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS, emailVendas: 'vendas@starta.com.br' } });
    const { ctx, empresa, admin } = empresaCliente(amb, { incluidos: 10, credito: 40 });
    gastar(ctx, agorinha(), { creditos: 10 });
    await api(amb, 'PUT', '/plano/cobranca', admin.cookie, { razaoSocial: 'Clínica Mais Agenda Ltda', cnpj: '11.222.333/0001-81', emailCobranca: 'financeiro@clinicamais.com.br', metodo: 'boleto' });

    const r = await api(amb, 'POST', '/plano/pacotes', admin.cookie);
    expect(r.statusCode).toBe(200);
    const { fatura, mensagem } = r.json<PacoteComprado>();
    expect(fatura).toMatchObject({ tipo: 'pacote', status: 'emitida', gateway: 'manual', creditos: 1000, totalCentavos: 40_000, competencia: null });
    expect(mensagem).toBe('Pedido registrado. A equipe Starta envia a cobrança de R$ 400 para financeiro@clinicamais.com.br, e os 1.000 créditos entram assim que o pagamento for confirmado.');
    expect(ultimoEmail(amb, 'vendas@starta.com.br')!.assunto).toBe('Cobrar: Pacote de 1.000 créditos da Clínica Mais Agenda');
    expect(ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Patrícia Nunes', acao: 'comprou um pacote de créditos', alvo: '1.000 créditos' });

    // Ainda não pago: os créditos não contam e não dá para pedir outro.
    let p = (await api(amb, 'GET', '/plano', admin.cookie)).json<PlanoECreditos>();
    expect(p.ciclo).toMatchObject({ pacotes: 0, restantes: 0 });
    expect(p.pacote.pendente?.id).toBe(fatura.id);
    expect((await api(amb, 'POST', '/plano/pacotes', admin.cookie)).statusCode).toBe(409);
    // Sem cartão guardado, a recarga automática explica por que não liga.
    const recarga = await api(amb, 'PUT', '/plano/recarga', admin.cookie, { ligada: true, limite: 300 });
    expect(recarga.statusCode).toBe(400);
    expect(recarga.json<{ mensagem: string }>().mensagem).toContain('cobrança por cartão');

    // A Starta marca como paga na Plataforma (fica na auditoria da empresa).
    const g = await entrarNaPlataforma(amb);
    const lista = (await plataforma(amb, 'GET', `/empresas/${empresa.id}/faturas`, g.cookie)).json<FaturasEmpresaStarta>();
    expect(lista).toMatchObject({ pagamentos: { modo: 'manual' }, pendencias: [] });
    const paga = await plataforma(amb, 'POST', `/empresas/${empresa.id}/faturas/${fatura.id}/paga`, g.cookie);
    expect(paga.json<FaturasEmpresaStarta>().faturas[0]).toMatchObject({ id: fatura.id, status: 'paga' });
    expect(ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Gabriel Moreno (Starta)', acao: 'marcou a fatura como paga', alvo: 'Pacote de 1.000 créditos' });
    p = (await api(amb, 'GET', '/plano', admin.cookie)).json<PlanoECreditos>();
    expect(p.ciclo).toMatchObject({ pacotes: 1000, restantes: 1000 });
    expect(p.pacote.pendente).toBeNull();
    // Paga não cancela.
    expect((await plataforma(amb, 'POST', `/empresas/${empresa.id}/faturas/${fatura.id}/cancelar`, g.cookie)).statusCode).toBe(400);
  });

  it('sem preço do crédito, não compra e diz por quê', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { admin } = empresaCliente(amb, { incluidos: 3000 });
    const p = (await api(amb, 'GET', '/plano', admin.cookie)).json<PlanoECreditos>();
    expect(p.pacote).toEqual({ creditos: 1000, precoCentavos: null, pendente: null });
    const r = await api(amb, 'POST', '/plano/pacotes', admin.cookie);
    expect(r.statusCode).toBe(400);
    expect(r.json<{ mensagem: string }>().mensagem).toBe('A Starta ainda não definiu o preço do crédito do seu plano. Fale com a Starta para comprar créditos.');
  });
});

describe('Asaas', () => {
  it('cria o cliente e a cobrança; o aviso de pagamento libera os créditos uma vez só', async () => {
    const asaas = asaasFalso();
    amb = await criarAmbiente({ config: { asaas: COM_ASAAS }, fetch: asaas.busca });
    const { ctx, empresa, admin } = empresaCliente(amb, { incluidos: 10, credito: 40 });

    const cobranca = await api(amb, 'PUT', '/plano/cobranca', admin.cookie, {
      razaoSocial: 'Clínica Mais Agenda Ltda',
      cnpj: '11.222.333/0001-81',
      emailCobranca: 'Financeiro@ClinicaMais.com.br',
      cep: '01310-100',
      numero: '1000',
      metodo: 'boleto',
    });
    expect(cobranca.statusCode).toBe(200);
    expect(cobranca.json<DadosCobranca>()).toMatchObject({ razaoSocial: 'Clínica Mais Agenda Ltda', cnpj: '11.222.333/0001-81', emailCobranca: 'financeiro@clinicamais.com.br', cep: '01310100', metodo: 'boleto', cartao: null });
    expect(asaas.pedidos[0]).toMatchObject({
      url: 'https://api-sandbox.asaas.com/v3/customers',
      metodo: 'POST',
      corpo: { name: 'Clínica Mais Agenda Ltda', cpfCnpj: '11222333000181', email: 'financeiro@clinicamais.com.br', postalCode: '01310100', addressNumber: '1000', externalReference: empresa.id },
      cabecalhos: { access_token: COM_ASAAS.chave, 'Content-Type': 'application/json' },
    });
    expect(asaas.pedidos[0].cabecalhos['User-Agent']).toBeTruthy();

    const { fatura, mensagem } = (await api(amb, 'POST', '/plano/pacotes', admin.cookie)).json<PacoteComprado>();
    expect(fatura).toMatchObject({ gateway: 'asaas', status: 'emitida', urlBoleto: 'https://sandbox.asaas.com/b/pdf/pay_1', urlPagamento: 'https://sandbox.asaas.com/i/pay_1' });
    expect(mensagem).toContain('Boleto de R$ 400 gerado');
    expect(asaas.pedidos[1]).toMatchObject({
      url: 'https://api-sandbox.asaas.com/v3/payments',
      corpo: { customer: 'cus_000001', billingType: 'BOLETO', value: 400, externalReference: fatura.id, dueDate: fatura.vencimento },
    });
    // Fatura do Asaas não se marca como paga na mão.
    const g = await entrarNaPlataforma(amb);
    expect((await plataforma(amb, 'POST', `/empresas/${empresa.id}/faturas/${fatura.id}/paga`, g.cookie)).statusCode).toBe(400);

    // Aviso sem o token certo: 401.
    const recebido = { id: 'evt_0001', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', externalReference: fatura.id, billingType: 'BOLETO' } };
    expect((await aviso(amb, recebido, 'token-errado')).statusCode).toBe(401);
    expect((await aviso(amb, recebido, null)).statusCode).toBe(401);
    expect(ctx.creditos.ciclo().pacotes).toBe(0);
    // Com o token, a fatura fica paga e os créditos entram.
    const ok = await aviso(amb, recebido);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, resultado: 'tratado' });
    expect(amb.plataforma.faturas.obter(fatura.id)).toMatchObject({ status: 'paga' });
    expect(ctx.creditos.ciclo().pacotes).toBe(1000);
    // O Asaas reenvia o mesmo evento: nada muda.
    expect((await aviso(amb, recebido)).json()).toEqual({ ok: true, resultado: 'repetido' });
    expect(ctx.creditos.ciclo().pacotes).toBe(1000);
    // Evento de cobrança que não é do copiloto: ignorado, com 200 para o Asaas não insistir.
    expect((await aviso(amb, { id: 'evt_0002', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_outro', status: 'RECEIVED' } })).json()).toEqual({ ok: true, resultado: 'ignorado' });
    // Estorno: os créditos deixam de contar.
    await aviso(amb, { id: 'evt_0003', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1', status: 'REFUNDED' } });
    expect(amb.plataforma.faturas.obter(fatura.id)!.status).toBe('cancelada');
    expect(ctx.creditos.ciclo().pacotes).toBe(0);
  });

  it('guarda o cartão pago no Asaas e a recarga automática compra um pacote por vez', async () => {
    const asaas = asaasFalso();
    amb = await criarAmbiente({ config: { asaas: COM_ASAAS }, fetch: asaas.busca });
    const { ctx, empresa, admin } = empresaCliente(amb, { incluidos: 100, credito: 40 });
    await api(amb, 'PUT', '/plano/cobranca', admin.cookie, { razaoSocial: 'Clínica Mais Agenda Ltda', cnpj: '11222333000181', emailCobranca: 'financeiro@clinicamais.com.br', metodo: 'cartao' });

    // Cartão sem token guardado: a cobrança sai com a página de pagamento do Asaas.
    const { fatura } = (await api(amb, 'POST', '/plano/pacotes', admin.cookie)).json<PacoteComprado>();
    expect(asaas.pedidos.at(-1)!.corpo).toMatchObject({ billingType: 'CREDIT_CARD' });
    expect(asaas.pedidos.at(-1)!.corpo).not.toHaveProperty('creditCardToken');
    // A empresa pagou com cartão: o aviso traz os 4 últimos dígitos, a bandeira e o token.
    await aviso(amb, {
      id: 'evt_cartao',
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_1', status: 'CONFIRMED', externalReference: fatura.id, creditCard: { creditCardNumber: '4417', creditCardBrand: 'VISA', creditCardToken: 'tok_cartao_guardado' } },
    });
    const p = (await api(amb, 'GET', '/plano', admin.cookie)).json<PlanoECreditos>();
    expect(p.cobranca.cartao).toEqual({ final: '4417', bandeira: 'Visa', validade: null });
    expect(p.pagamentos.cartaoGuardado).toBe(true);
    // O token fica cifrado no banco.
    const guardado = amb.plataforma.banco.um<{ t: string }>('SELECT cartao_token AS t FROM empresas WHERE id = ?', empresa.id)!.t;
    expect(guardado).not.toContain('tok_cartao_guardado');
    expect(JSON.stringify(p)).not.toContain('tok_cartao_guardado');

    const r = (await api(amb, 'PUT', '/plano/recarga', admin.cookie, { ligada: true, limite: 300 })).json<RecargaAutomatica>();
    expect(r).toEqual({ ligada: true, limite: 300 });
    // 100 incluídos + 1.000 do pacote − 900 usados = 200 restantes, abaixo de 300: compra um pacote no cartão guardado.
    gastar(ctx, agorinha(), { creditos: 900 });
    await ctx.creditos.aposExecucao();
    const automatica = amb.plataforma.faturas.listar(empresa.id).find((f) => f.automatica)!;
    expect(automatica).toMatchObject({ tipo: 'pacote', status: 'paga', creditos: 1000 });
    expect(asaas.pedidos.at(-1)!.corpo).toMatchObject({ billingType: 'CREDIT_CARD', creditCardToken: 'tok_cartao_guardado', value: 400 });
    expect(asaas.pedidos.at(-1)!.corpo!.remoteIp).toBeTruthy();
    expect(ctx.creditos.ciclo()).toMatchObject({ pacotes: 2000, restantes: 1200 });
    expect(ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Recarga automática', acao: 'Comprou um pacote de créditos' });

    // Pagamento pendente no cartão: no máximo um pacote automático esperando.
    asaas.estado.cartao = 'pendente';
    gastar(ctx, agorinha(), { creditos: 1000 });
    await ctx.creditos.aposExecucao();
    await ctx.creditos.aposExecucao();
    const pendentes = amb.plataforma.faturas.listar(empresa.id).filter((f: Fatura) => f.automatica && f.status === 'emitida');
    expect(pendentes).toHaveLength(1);
  });

  it('com a nota fiscal ligada, agenda a NFS-e da fatura paga e guarda o link', async () => {
    const asaas = asaasFalso();
    const notaFiscal = { servicoId: '', servicoCodigo: '01.07', servicoNome: 'Suporte técnico em informática', impostos: { retainIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 } };
    amb = await criarAmbiente({ config: { asaas: { ...COM_ASAAS, notaFiscal } }, fetch: asaas.busca });
    const { admin } = empresaCliente(amb, { incluidos: 10, credito: 40 });
    await api(amb, 'PUT', '/plano/cobranca', admin.cookie, { razaoSocial: 'Clínica Mais Agenda Ltda', cnpj: '11222333000181', emailCobranca: 'financeiro@clinicamais.com.br', metodo: 'boleto' });
    expect((await api(amb, 'GET', '/plano', admin.cookie)).json<PlanoECreditos>().pagamentos.notaFiscal).toBe(true);
    const { fatura } = (await api(amb, 'POST', '/plano/pacotes', admin.cookie)).json<PacoteComprado>();
    await aviso(amb, { id: 'evt_pago', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', externalReference: fatura.id } });
    expect(asaas.pedidos.at(-1)).toMatchObject({
      url: 'https://api-sandbox.asaas.com/v3/invoices',
      corpo: { payment: 'pay_1', value: 400, deductions: 0, municipalServiceCode: '01.07', municipalServiceName: 'Suporte técnico em informática', taxes: { iss: 2 } },
    });
    await aviso(amb, { id: 'evt_nf', event: 'INVOICE_AUTHORIZED', invoice: { id: 'inv_000001', status: 'AUTHORIZED', payment: 'pay_1', pdfUrl: 'https://sandbox.asaas.com/nf/inv_000001.pdf' } });
    expect(amb.plataforma.faturas.obter(fatura.id)!.urlNotaFiscal).toBe('https://sandbox.asaas.com/nf/inv_000001.pdf');
  });

  it('o webhook responde 503 quando o Asaas não está ligado', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    expect((await aviso(amb, { id: 'evt', event: 'PAYMENT_RECEIVED' })).statusCode).toBe(503);
  });
});

describe('PDF da fatura', () => {
  it('gera o demonstrativo para o Admin; editor não baixa; fatura de outra empresa não existe', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS } });
    const { admin, ctx } = empresaCliente(amb, { incluidos: 10, credito: 40 });
    const { fatura } = (await api(amb, 'POST', '/plano/pacotes', admin.cookie)).json<PacoteComprado>();
    const r = await api(amb, 'GET', `/plano/faturas/${fatura.id}/pdf`, admin.cookie);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('.pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const editor = entrarComo(ctx, 'editor', 'Editora', 'editora@clinicamais.com.br');
    expect((await api(amb, 'GET', `/plano/faturas/${fatura.id}/pdf`, editor.cookie)).statusCode).toBe(403);
    const demo = entrarComo(amb.ctx, 'admin', 'Admin da demonstração', 'admin@seusistema.com.br');
    expect((await api(amb, 'GET', `/plano/faturas/${fatura.id}/pdf`, demo.cookie)).statusCode).toBe(404);
  });
});

describe('mudar de plano', () => {
  it('registra o pedido, avisa vendas e mostra na página', async () => {
    amb = await criarAmbiente({ config: { asaas: SEM_ASAAS, emailVendas: 'vendas@starta.com.br' } });
    const { admin, ctx, empresa } = empresaCliente(amb, { incluidos: 3000 });
    expect((await api(amb, 'POST', '/plano/mudanca', admin.cookie, { planoId: 'piloto' })).statusCode).toBe(400);
    expect((await api(amb, 'POST', '/plano/mudanca', admin.cookie, { planoId: 'nao-existe' })).statusCode).toBe(404);
    const r = await api(amb, 'POST', '/plano/mudanca', admin.cookie, { planoId: 'crescimento', mensagem: 'Vamos abrir para toda a base.' });
    expect(r.statusCode).toBe(200);
    expect(r.json<PedidoMudancaPlano>()).toMatchObject({ planoId: 'crescimento', planoNome: 'Crescimento' });
    const email = ultimoEmail(amb, 'vendas@starta.com.br')!;
    expect(email).toMatchObject({ assunto: 'Pedido de mudança de plano: Clínica Mais Agenda', responderPara: 'patricia@clinicamais.com.br' });
    expect(email.texto).toContain('Plano atual: Piloto');
    expect(email.texto).toContain('Plano pedido: Crescimento');
    expect(amb.plataforma.contatos()[0]).toMatchObject({ origem: 'mudanca_plano', empresaId: empresa.id, planoId: 'crescimento', faixa: 'ate_200', email: 'patricia@clinicamais.com.br' });
    expect(ctx.auditoria.listar()[0]).toMatchObject({ acao: 'pediu mudança de plano', detalhe: 'Piloto → Crescimento' });
    const p = (await api(amb, 'GET', '/plano', admin.cookie)).json<PlanoECreditos>();
    expect(p.pedidoMudanca).toMatchObject({ planoId: 'crescimento', planoNome: 'Crescimento' });
  });
});

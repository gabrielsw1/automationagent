// Rotas do gravador (/api/gravacao), de fluxos e de prints (/api/console).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Fluxo, GravacaoEstado, TarefaDefinicao } from '@copiloto/shared';
import type { Contexto } from '../../src/contexto.ts';
import type { EventoConsole } from '../../src/eventos.ts';
import { salvarPrint } from '../../src/navegador/prints.ts';
import { exemplosDoNome } from '../../src/rotas/console/fluxos.ts';
import type { Navegador, PedidoExecucaoNavegador, ResultadoNavegador } from '../../src/navegador/tipos.ts';
import { entrarComo } from '../ajuda.ts';
import { AdaptadorTelas, LINHA_DIGITAVEL, criarAmbienteNavegador, eventosBoleto, subirTelas } from './ajuda-navegador.ts';

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Navegador falso: um print e um evento por passo; pode falhar num passo. */
class NavegadorFalso implements Navegador {
  ctx!: Contexto;
  dirDados!: string;
  pedidos: PedidoExecucaoNavegador[] = [];
  falharNoPasso: number | null = null;
  async disponivel() {
    return { ok: true, detalhe: 'falso' };
  }
  async fechar() {}
  async executar(p: PedidoExecucaoNavegador): Promise<ResultadoNavegador> {
    this.pedidos.push(p);
    for (const passo of p.fluxo.passos) {
      const printId = salvarPrint(this.ctx.banco, this.dirDados, PNG_1X1, { execucaoId: p.execucaoId, legenda: `Passo ${passo.n}`, mascarado: p.mascararPrints });
      if (passo.n === this.falharNoPasso) {
        p.aoEvento({ tipo: 'passo_falhou', passo: passo.n, titulo: 'Não conseguiu', printId, candidato: { texto: 'Outro', confianca: 0.4 } });
        return { ok: false, motivo: 'elemento_nao_encontrado', passo: passo.n, mensagem: 'A tela mudou.', printId, candidato: { texto: 'Outro', confianca: 0.4 }, duracaoMs: 10 };
      }
      p.aoEvento({ tipo: 'passo_ok', passo: passo.n, titulo: `Passo ${passo.n}`, printId });
    }
    return { ok: true, gerados: { linha_digitavel: '123' }, arquivos: [], duracaoMs: 10, recuperacoes: 0 };
  }
}

let fechar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of fechar.reverse()) await f();
  fechar = [];
});

/** `navegador: 'real'` usa o executor de verdade (Chromium); sem nada, o navegador falso. */
async function ambiente(opcoes: { navegador?: Navegador | 'real'; adaptador?: AdaptadorTelas } = {}) {
  const falso = opcoes.navegador ? undefined : new NavegadorFalso();
  const navegador = opcoes.navegador === 'real' ? undefined : (opcoes.navegador ?? falso);
  const amb = await criarAmbienteNavegador({ navegador, adaptador: opcoes.adaptador as never });
  if (falso) {
    falso.ctx = amb.ctx;
    falso.dirDados = amb.dirDados;
  }
  fechar.push(async () => {
    await amb.app.close();
    await amb.ctx.navegador.fechar();
  });
  const editor = entrarComo(amb.ctx, 'editor', 'Júlia Martins');
  const leitor = entrarComo(amb.ctx, 'leitor', 'Bruno Costa');
  const consoleEventos: EventoConsole[] = [];
  amb.ctx.eventos.ouvirConsole((e) => consoleEventos.push(e));
  const pedir = (metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, cookie = editor.cookie) =>
    amb.app.inject({ method: metodo, url, payload: payload as never, headers: { cookie } });
  return { ...amb, falso, editor, leitor, pedir, consoleEventos };
}

async function gravarBoleto(a: Awaited<ReturnType<typeof ambiente>>, base?: string) {
  const r = await a.pedir('POST', '/api/console/fluxos', { nome: 'Segunda via de boleto', urlInicial: '/financeiro/segunda-via' });
  expect(r.statusCode).toBe(200);
  const { fluxo, token, urlGravacao } = r.json() as { fluxo: Fluxo; token: string; urlGravacao: string };
  const ev = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventosBoleto(base) } });
  expect(ev.statusCode).toBe(200);
  const fim = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/concluir` });
  expect(fim.json()).toEqual({ ok: true, fluxoId: fluxo.id });
  return { fluxo, token, urlGravacao };
}

describe('gravador de fluxos (/api/gravacao)', () => {
  it('cria o fluxo pelo console e recebe os eventos pelo token, sem valores digitados', async () => {
    const a = await ambiente();
    const sem = await a.pedir('POST', '/api/console/fluxos', { nome: 'X', urlInicial: '/a' }, a.leitor.cookie);
    expect(sem.statusCode).toBe(403);
    const invalido = await a.pedir('POST', '/api/console/fluxos', { nome: 'Fluxo', urlInicial: 'javascript:alert(1)' });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().mensagem).toMatch(/endereço do Horizonte/);

    const r = await a.pedir('POST', '/api/console/fluxos', { nome: 'Segunda via de boleto', urlInicial: 'http://horizonte.teste/financeiro/segunda-via' });
    expect(r.statusCode).toBe(200);
    const { fluxo, token, urlGravacao } = r.json() as { fluxo: Fluxo; token: string; urlGravacao: string };
    expect(fluxo).toMatchObject({ status: 'gravando', etapa: 'gravar', urlInicial: '/financeiro/segunda-via', gravadoPor: 'Júlia Martins' });
    // copiloto_api diz à extensão do navegador com qual servidor do copiloto falar.
    expect(urlGravacao).toBe(`http://horizonte.teste/financeiro/segunda-via?copiloto_gravacao=${token}&copiloto_api=${encodeURIComponent(a.config.urlPublica)}`);
    expect(JSON.stringify(fluxo)).not.toContain(token);

    const estado = await a.app.inject({ method: 'GET', url: `/api/gravacao/${token}` });
    expect(estado.json<GravacaoEstado>()).toEqual({ fluxoId: fluxo.id, nome: 'Segunda via de boleto', ativa: true, passos: 0 });

    const eventos = eventosBoleto();
    // um gravador com defeito mandando dígitos e o value do campo: o servidor apaga
    eventos[2] = { ...eventos[2], formatoValor: '12.345', elemento: { ...eventos[2].elemento!, contexto: '<input name="doc_pagador" value="12.345.678/0001-95">' } };
    const ev = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventos.slice(0, 5) } });
    expect(ev.json()).toEqual({ passos: 3 });
    const ev2 = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventos.slice(5) } });
    expect(ev2.json()).toEqual({ passos: 6 });
    expect(a.consoleEventos.filter((e) => e.tipo === 'fluxo' && e.etapa === 'gravar').map((e) => (e as { passos: number }).passos)).toEqual([0, 3, 6]);
    const bruto = a.ctx.banco.um<{ eventos_gravados: string }>('SELECT eventos_gravados FROM fluxos WHERE id = ?', fluxo.id)!.eventos_gravados;
    expect(bruto).not.toContain('12.345.678');
    expect(bruto).toContain('99.999');

    // ao vivo no console: os passos já aparecem durante a gravação
    const aoVivo = await a.pedir('GET', `/api/console/fluxos/${fluxo.id}`, undefined, a.leitor.cookie);
    expect(aoVivo.json<Fluxo>().passos).toHaveLength(6);

    const fim = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/concluir` });
    expect(fim.json()).toEqual({ ok: true, fluxoId: fluxo.id });
    const depois = await a.app.inject({ method: 'GET', url: `/api/gravacao/${token}` });
    expect(depois.json()).toMatchObject({ ativa: false, passos: 6 });
    const tarde = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: [] } });
    expect(tarde.statusCode).toBe(409);

    const f = (await a.pedir('GET', `/api/console/fluxos/${fluxo.id}`)).json<Fluxo>();
    expect(f).toMatchObject({ status: 'rascunho', etapa: 'revisar', duracaoGravacaoMs: 15_000 });
    expect(f.gravadoEm).toBeTruthy();
    expect(f.camposSugeridos.map((c) => c.chave)).toEqual(['cpf_cnpj_pagador', 'competencia']);
    expect(a.consoleEventos.some((e) => e.tipo === 'fluxo' && e.etapa === 'revisar')).toBe(true);
    const aud = a.ctx.auditoria.listar().map((x) => x.acao);
    expect(aud).toEqual(expect.arrayContaining(['começou a gravar o fluxo', 'concluiu a gravação do fluxo']));

    const nada = await a.app.inject({ method: 'GET', url: '/api/gravacao/token-que-nao-existe' });
    expect(nada.statusCode).toBe(404);
  });

  it('outro site (gravação pela extensão): guarda o endereço completo e tira os parâmetros do gravador dos passos', async () => {
    const a = await ambiente();
    a.config.urlPublica = 'https://copiloto.empresa.com.br/';
    const r = await a.pedir('POST', '/api/console/fluxos', {
      nome: 'Pedido no portal',
      urlInicial: 'https://portal.fornecedor.com.br/app/pedidos?aba=2&copiloto_gravacao=velho&copiloto_api=x#/novo',
    });
    expect(r.statusCode).toBe(200);
    const { fluxo, token, urlGravacao } = r.json() as { fluxo: Fluxo; token: string; urlGravacao: string };
    expect(fluxo.urlInicial).toBe('https://portal.fornecedor.com.br/app/pedidos?aba=2#/novo');
    expect(urlGravacao).toBe(
      `https://portal.fornecedor.com.br/app/pedidos?aba=2&copiloto_gravacao=${token}&copiloto_api=${encodeURIComponent('https://copiloto.empresa.com.br')}#/novo`,
    );
    const url = `https://portal.fornecedor.com.br/app/pedidos?aba=2&copiloto_gravacao=${token}&copiloto_api=x`;
    const ev = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: [{ tipo: 'navegar', ts: 1, url, tituloPagina: 'Pedidos' }] } });
    expect(ev.json()).toEqual({ passos: 1 });
    const f = (await a.pedir('GET', `/api/console/fluxos/${fluxo.id}`)).json<Fluxo>();
    expect(f.passos[0].url).toBe('/app/pedidos?aba=2');
  });

  it('cancelar a gravação descarta os eventos', async () => {
    const a = await ambiente();
    const { fluxo, token } = (await a.pedir('POST', '/api/console/fluxos', { nome: 'Fluxo F', urlInicial: '/x' })).json();
    await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventosBoleto().slice(0, 3) } });
    const c = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/cancelar` });
    expect(c.json()).toEqual({ ok: true });
    const f = (await a.pedir('GET', `/api/console/fluxos/${fluxo.id}`)).json<Fluxo>();
    expect(f).toMatchObject({ status: 'rascunho', etapa: 'gravar', passos: [] });
  });
});

describe('fluxos no console', () => {
  it('revisa, aprende de novo, testa, publica e liga ao rascunho da tarefa', async () => {
    const a = await ambiente();
    const { fluxo } = await gravarBoleto(a);
    const base = `/api/console/fluxos/${fluxo.id}`;

    const lista = await a.pedir('GET', '/api/console/fluxos', undefined, a.leitor.cookie);
    expect(lista.json<Fluxo[]>().map((f) => f.id)).toEqual([fluxo.id]);

    // revisar: renomeia, troca o seletor e remove o passo de clique
    const atual = (await a.pedir('GET', base)).json<Fluxo>();
    const passos = atual.passos.map((p) => ({ ...p }));
    passos[1].titulo = 'Preencher o documento';
    passos[1].seletorEscolhido = 1;
    const semClique = passos.filter((p) => p.tipo !== 'clique');
    const put = await a.pedir('PUT', base, { passos: semClique, etapa: 'mapear' });
    expect(put.statusCode).toBe(200);
    const revisado = put.json<Fluxo>();
    expect(revisado.passos.map((p) => p.n)).toEqual([1, 2, 3, 4, 5]);
    expect(revisado.passos[1]).toMatchObject({ titulo: 'Preencher o documento', seletorEscolhido: 1 });
    expect(revisado.etapa).toBe('mapear');
    expect((await a.pedir('PUT', base, { passos: semClique }, a.leitor.cookie)).statusCode).toBe(403);

    // aprender de novo (regra simulada) volta aos 6 passos da gravação
    const ap = await a.pedir('POST', `${base}/aprender`);
    expect(ap.statusCode).toBe(200);
    expect(ap.json<Fluxo>().passos).toHaveLength(6);

    // publicar sem teste: recusado
    const cedo = await a.pedir('POST', `${base}/publicar`);
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json().mensagem).toMatch(/Teste o fluxo/);

    // teste: valores validados pelos campos
    const faltando = await a.pedir('POST', `${base}/testar`, { valores: { competencia: '10/2026' }, usuarioId: '102' });
    expect(faltando.statusCode).toBe(400);
    expect(faltando.json().mensagem).toMatch(/CPF\/CNPJ do pagador/);
    const invalido = await a.pedir('POST', `${base}/testar`, { valores: { cpf_cnpj_pagador: '11.111.111/1111-11', competencia: '10/2026' }, usuarioId: '102' });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().mensagem).toMatch(/CNPJ não é válido/);

    a.falso!.falharNoPasso = 4;
    const falhou = await a.pedir('POST', `${base}/testar`, { valores: { cpf_cnpj_pagador: '12345678000195', competencia: '10/2026' }, usuarioId: '102' });
    expect(falhou.statusCode).toBe(200);
    expect(falhou.json().resultado).toMatchObject({ ok: false, passo: 4, candidato: { texto: 'Outro' } });
    expect(falhou.json().fluxo.ultimoTeste).toMatchObject({ ok: false, passoFalhou: 4 });
    expect(a.falso!.pedidos.at(-1)!.valores).toEqual({ cpf_cnpj_pagador: '12.345.678/0001-95', competencia: '10/2026' });
    expect(a.falso!.pedidos.at(-1)!.execucaoId).toMatch(/^teste_/);

    a.falso!.falharNoPasso = null;
    const ok = await a.pedir('POST', `${base}/testar`, { valores: { cpf_cnpj_pagador: '12.345.678/0001-95', competencia: '10/2026' }, usuarioId: '102' });
    const corpo = ok.json();
    expect(corpo.resultado).toMatchObject({ ok: true, gerados: { linha_digitavel: '123' } });
    expect(corpo.eventos).toHaveLength(6);
    const testado = corpo.fluxo as Fluxo;
    expect(testado.etapa).toBe('publicar');
    expect(testado.ultimoTeste).toMatchObject({ ok: true });
    expect(testado.passos.every((p) => p.printId)).toBe(true);
    // os prints do teste ficam ligados ao fluxo; os do teste anterior foram apagados
    const prints = a.ctx.banco.todos<{ id: string; fluxo_id: string; execucao_id: string | null }>('SELECT * FROM prints');
    expect(prints).toHaveLength(6);
    expect(prints.every((p) => p.fluxo_id === fluxo.id && p.execucao_id === null)).toBe(true);

    // prints: imagem e informações (leitor pode ver)
    const img = await a.pedir('GET', `/api/console/prints/${testado.passos[0].printId}`, undefined, a.leitor.cookie);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.equals(PNG_1X1)).toBe(true);
    const info = await a.pedir('GET', `/api/console/prints/${testado.passos[0].printId}/info`, undefined, a.leitor.cookie);
    expect(info.json()).toMatchObject({ largura: 1, altura: 1, mascarado: true, legenda: 'Passo 1' });
    expect((await a.pedir('GET', '/api/console/prints/prt_nao_existe')).statusCode).toBe(404);
    expect((await a.app.inject({ method: 'GET', url: `/api/console/prints/${testado.passos[0].printId}` })).statusCode).toBe(401);

    // liga a uma tarefa existente: os campos sugeridos não existem nela → pendências
    const def: TarefaDefinicao = {
      nome: 'Segunda via de boleto',
      descricao: 'Emite a segunda via',
      quandoUsar: 'Quando pedirem segunda via',
      exemplos: [],
      campos: [
        { chave: 'documento_pagador', rotulo: 'CPF/CNPJ do pagador', tipo: 'documento', obrigatorio: true, pergunta: 'Qual o documento?' },
        { chave: 'competencia', rotulo: 'Competência', tipo: 'texto', obrigatorio: true, pergunta: 'Qual a competência?' },
      ],
      caminho: 'navegador',
      fluxoId: null,
      usarFluxoSeApiFalhar: false,
      confirmacao: true,
      desfazerMinutos: 0,
      perfisPermitidos: [],
      tituloRecibo: 'Boleto',
      tituloConfirmacao: 'Confirme',
      proximosPassos: [],
      contextos: [],
      confiancaMinima: 0.9,
    };
    const tarefa = a.ctx.catalogo.criar(def, 'Rafael Lima');
    const ligado = (await a.pedir('PUT', base, { tarefaId: tarefa.id })).json<Fluxo>();
    expect(ligado.tarefaId).toBe(tarefa.id);
    expect(ligado.passos[1].pendencia).toMatch(/não existe na tarefa/);
    expect(ligado.ultimoTeste).toBeNull();
    const pend = await a.pedir('POST', `${base}/publicar`);
    expect(pend.statusCode).toBe(409);
    expect(pend.json().mensagem).toMatch(/pendências/);

    // mapeia para os campos da tarefa, testa de novo e publica
    const mapeados = ligado.passos.map((p) =>
      p.n === 2 ? { ...p, valor: { origem: 'campo' as const, campo: 'documento_pagador' } } : p.n === 3 ? { ...p, valor: { origem: 'campo' as const, campo: 'competencia' } } : p,
    );
    const m = (await a.pedir('PUT', base, { passos: mapeados })).json<Fluxo>();
    expect(m.passos.every((p) => !p.pendencia)).toBe(true);
    const t2 = await a.pedir('POST', `${base}/testar`, { valores: { documento_pagador: '12.345.678/0001-95', competencia: '10/2026' }, usuarioId: '105' });
    expect(t2.json().resultado.ok).toBe(true);
    expect(a.falso!.pedidos.at(-1)!.confiancaMinima).toBe(0.9);
    const pub = await a.pedir('POST', `${base}/publicar`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ fluxo: { status: 'publicado', etapa: 'publicar' }, tarefa: { id: tarefa.id, nome: 'Segunda via de boleto' } });
    expect(a.ctx.catalogo.rascunho(tarefa.id)!.definicao.fluxoId).toBe(fluxo.id);
    expect(a.ctx.auditoria.listar().map((x) => x.acao)).toEqual(expect.arrayContaining(['publicou o fluxo', 'testou o fluxo', 'editou o fluxo']));

    // publicado não muda; gravar de novo cria uma versão nova e mantém a publicada
    expect((await a.pedir('PUT', base, { passos: m.passos })).statusCode).toBe(409);
    const regravar = await a.pedir('POST', `${base}/gravar`);
    expect(regravar.statusCode).toBe(200);
    const nova = regravar.json() as { fluxo: Fluxo; token: string; urlGravacao: string };
    expect(nova.fluxo.id).not.toBe(fluxo.id);
    expect(nova.fluxo).toMatchObject({ versao: 2, status: 'gravando', tarefaId: tarefa.id });
    expect((await a.pedir('GET', base)).json<Fluxo>().status).toBe('publicado');

    // apagar: o publicado está em uso pela tarefa; a versão nova não
    const emUso = await a.pedir('DELETE', base);
    expect(emUso.statusCode).toBe(409);
    expect(emUso.json().mensagem).toMatch(/Segunda via de boleto/);
    const apaga = await a.pedir('DELETE', `/api/console/fluxos/${nova.fluxo.id}`);
    expect(apaga.json()).toEqual({ ok: true });
    expect((await a.pedir('GET', `/api/console/fluxos/${nova.fluxo.id}`)).statusCode).toBe(404);
  });

  it('cria a tarefa a partir dos campos sugeridos', async () => {
    const a = await ambiente();
    const { fluxo } = await gravarBoleto(a);
    const r = await a.pedir('POST', `/api/console/fluxos/${fluxo.id}/criar-tarefa`);
    expect(r.statusCode).toBe(200);
    const { tarefaId } = r.json() as { tarefaId: string };
    const def = a.ctx.catalogo.rascunho(tarefaId)!.definicao;
    expect(def).toMatchObject({ nome: 'Segunda via de boleto', caminho: 'navegador', fluxoId: fluxo.id, confirmacao: true });
    expect(def.campos.map((c) => c.chave)).toEqual(['cpf_cnpj_pagador', 'competencia']);
    // Pronta para o copiloto reconhecer o pedido: exemplos pelo nome e os dados que a tarefa pede.
    expect(def.exemplos).toEqual(['segunda via de boleto']);
    expect(exemplosDoNome('Abrir chamado')).toEqual(['abrir chamado', 'abre chamado', 'pode abrir chamado para mim?']);
    expect(exemplosDoNome('Cadastrar cliente')[1]).toBe('cadastra cliente');
    expect(def.descricao).toContain('Precisa de: CPF/CNPJ do pagador e competência.');
    expect(def.campos[1].pergunta).toBe('Qual é a competência: 10/2026 ou 09/2026?');
    expect(def.tituloRecibo).toBe('Segunda via de boleto: {linha_digitavel}');
    expect((await a.pedir('GET', `/api/console/fluxos/${fluxo.id}`)).json<Fluxo>().tarefaId).toBe(tarefaId);
    expect((await a.pedir('POST', `/api/console/fluxos/${fluxo.id}/criar-tarefa`)).statusCode).toBe(409);
  });

  it('conclui e cancela a gravação pelo console', async () => {
    const a = await ambiente();
    const { fluxo, token } = (await a.pedir('POST', '/api/console/fluxos', { nome: 'Fluxo F', urlInicial: '/financeiro/segunda-via' })).json();
    const g = await a.pedir('GET', `/api/console/fluxos/${fluxo.id}/gravacao`);
    expect(g.json()).toMatchObject({ token });
    await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventosBoleto() } });
    const c = await a.pedir('POST', `/api/console/fluxos/${fluxo.id}/concluir-gravacao`);
    expect(c.json<Fluxo>()).toMatchObject({ status: 'rascunho', etapa: 'revisar' });
    expect((await a.pedir('GET', `/api/console/fluxos/${fluxo.id}/gravacao`)).statusCode).toBe(409);
  });
});

describe('teste de fluxo de ponta a ponta (Chromium real)', { timeout: 90_000 }, () => {
  it('grava, conclui e testa contra telas locais, com prints por passo', async () => {
    const telas = await subirTelas();
    fechar.push(telas.fechar);
    const a = await ambiente({ adaptador: new AdaptadorTelas(telas.url), navegador: 'real' });
    // sem navegador falso: usa o executor real
    expect(a.falso).toBeUndefined();
    const { fluxo } = await gravarBoleto(a, telas.url);
    const r = await a.pedir('POST', `/api/console/fluxos/${fluxo.id}/testar`, {
      valores: { cpf_cnpj_pagador: '12.345.678/0001-95', competencia: '10/2026' },
      usuarioId: '102',
    });
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.resultado).toMatchObject({ ok: true, gerados: { linha_digitavel: LINHA_DIGITAVEL }, arquivos: [{ nome: 'boleto-123.pdf' }] });
    const f = corpo.fluxo as Fluxo;
    expect(f.passos.every((p) => p.printId)).toBe(true);
    const img = await a.pedir('GET', `/api/console/prints/${f.passos[1].printId}`);
    expect(img.statusCode).toBe(200);
    expect(img.rawPayload.subarray(1, 4).toString('ascii')).toBe('PNG');
    const arquivos = fs.readdirSync(path.join(a.dirDados, 'arquivos'));
    expect(arquivos.some((d) => d.startsWith(`teste_${fluxo.id}`))).toBe(true);
  });
});

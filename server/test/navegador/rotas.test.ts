// Rotas do gravador (/api/gravacao), de fluxos e de prints (/api/console).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventoGravado, Fluxo, FluxoPublicado, GravacaoEstado, RegistroLido, TarefaDefinicao } from '@copiloto/shared';
import { ferramentaDaTarefa } from '../../src/agente/ferramentas.ts';
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
  /** Número do registro que a "tela" mostrou no fim (undefined: não procurou). */
  registro: RegistroLido | null | undefined = undefined;
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
    return { ok: true, gerados: { linha_digitavel: '123' }, arquivos: [], duracaoMs: 10, recuperacoes: 0, registro: this.registro };
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
    expect(estado.json<GravacaoEstado>()).toEqual({
      fluxoId: fluxo.id,
      nome: 'Segunda via de boleto',
      ativa: true,
      passos: 0,
      empresa: 'Horizonte',
      pessoa: 'Júlia Martins',
      itens: [],
    });

    const eventos = eventosBoleto();
    // um gravador com defeito mandando dígitos e o value do campo: o servidor apaga
    eventos[2] = { ...eventos[2], formatoValor: '12.345', elemento: { ...eventos[2].elemento!, contexto: '<input name="doc_pagador" value="12.345.678/0001-95">' } };
    const ev = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventos.slice(0, 5) } });
    expect(ev.json()).toMatchObject({ passos: 3 });
    const ev2 = await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventos.slice(5) } });
    // O painel "Passos gravados" da extensão recebe os títulos: verbo e rótulo, nunca o valor.
    const aceitos = ev2.json<{ passos: number; itens: string[] }>();
    expect(aceitos.passos).toBe(6);
    expect(aceitos.itens).toHaveLength(6);
    expect(aceitos.itens[0]).toMatch(/^Abrir a tela de /);
    expect(JSON.stringify(aceitos.itens)).not.toMatch(/\d{3}/);
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
    expect(ev.json()).toEqual({ passos: 1, itens: ['Abrir o site portal.fornecedor.com.br'] });
    const f = (await a.pedir('GET', `/api/console/fluxos/${fluxo.id}`)).json<Fluxo>();
    // Fora do sistema (horizonte.teste): o passo guarda o endereço completo e fica marcado para a revisão.
    expect(f.passos[0]).toMatchObject({ url: 'https://portal.fornecedor.com.br/app/pedidos?aba=2', outroSite: 'portal.fornecedor.com.br' });
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

/** "Abrir chamado" com uma consulta de CNPJ em outro site no meio do caminho. */
function eventosComOutroSite(): EventoGravado[] {
  const hz = 'http://horizonte.teste/chamados';
  const fora = 'https://consulta.cnpj.exemplo/busca?copiloto_api=x';
  const t = 1_760_000_000_000;
  return [
    { tipo: 'navegar', ts: t, url: `${hz}?copiloto_gravacao=tok`, tituloPagina: 'Chamados' },
    { tipo: 'preencher', ts: t + 1_000, url: hz, elemento: { tag: 'input', name: 'assunto', rotulo: 'Assunto', css: '#assunto' }, formatoValor: 'aaaa' },
    { tipo: 'navegar', ts: t + 20_000, url: fora, tituloPagina: 'Consulta CNPJ' },
    { tipo: 'preencher', ts: t + 22_000, url: fora, elemento: { tag: 'input', name: 'cnpj', rotulo: 'CNPJ', css: '#cnpj' }, formatoValor: '99.999.999/9999-99' },
    { tipo: 'clique', ts: t + 23_000, url: fora, elemento: { tag: 'button', texto: 'Consultar', type: 'submit', css: 'form button' } },
    { tipo: 'navegar', ts: t + 40_000, url: hz, tituloPagina: 'Chamados' },
    { tipo: 'preencher', ts: t + 41_000, url: hz, elemento: { tag: 'input', name: 'cliente', rotulo: 'Cliente', css: '#cliente' }, formatoValor: 'aaaaaaa' },
    { tipo: 'clique', ts: t + 42_000, url: hz, elemento: { tag: 'button', texto: 'Abrir chamado', type: 'submit', css: 'form button' } },
  ];
}

describe('passos em outro site', () => {
  it('marca os passos fora do sistema, bloqueia teste e publicação até remover ou manter como instrução', async () => {
    const a = await ambiente();
    const { fluxo, token } = (await a.pedir('POST', '/api/console/fluxos', { nome: 'Abrir chamado', urlInicial: '/chamados' })).json() as { fluxo: Fluxo; token: string };
    expect((await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/eventos`, payload: { eventos: eventosComOutroSite() } })).statusCode).toBe(200);
    await a.app.inject({ method: 'POST', url: `/api/gravacao/${token}/concluir` });
    const base = `/api/console/fluxos/${fluxo.id}`;

    const gravado = (await a.pedir('GET', base)).json<Fluxo>();
    expect(gravado.passos.map((p) => [p.titulo, p.outroSite ?? null])).toEqual([
      ['Abrir a tela de chamados', null],
      ['Preencher assunto', null],
      ['Abrir o site consulta.cnpj.exemplo', 'consulta.cnpj.exemplo'],
      ['Preencher CNPJ', 'consulta.cnpj.exemplo'],
      ['Clicar em Consultar', 'consulta.cnpj.exemplo'],
      // A volta ao sistema é um passo: o robô abre a tela de novo, sem depender do outro site.
      ['Abrir a tela de chamados', null],
      ['Preencher cliente', null],
      ['Clicar em Abrir chamado', null],
    ]);
    // Endereço completo, sem os parâmetros do gravador; sem campo da tarefa e sem pendência.
    expect(gravado.passos[2].url).toBe('https://consulta.cnpj.exemplo/busca');
    expect(gravado.passos[3]).not.toHaveProperty('valor');
    expect(gravado.passos[3]).not.toHaveProperty('pendencia');
    expect(gravado.camposSugeridos.map((c) => c.chave)).toEqual(['assunto', 'cliente']);

    const valores = { valores: { assunto: 'Impressora', cliente: 'Padaria' }, usuarioId: '101' };
    const cedo = await a.pedir('POST', `${base}/testar`, valores);
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json()).toMatchObject({ erro: 'outro_site_pendente' });
    expect(cedo.json().mensagem).toMatch(/passo 3 \(consulta\.cnpj\.exemplo\)/);
    expect((await a.pedir('POST', `${base}/publicar`)).json()).toMatchObject({ erro: 'outro_site_pendente' });

    // A marca vem do endereço: o console não tira nem inventa (instrução num passo do sistema não vale).
    const forjado = gravado.passos.map(({ outroSite: _o, ...p }) => (p.n === 2 ? { ...p, instrucao: true } : p));
    const put = (await a.pedir('PUT', base, { passos: forjado })).json<Fluxo>();
    expect(put.passos.filter((p) => p.outroSite).map((p) => p.n)).toEqual([3, 4, 5]);
    expect(put.passos[1]).not.toHaveProperty('instrucao');

    // Leitor não decide; passo do sistema não tem essa escolha.
    expect((await a.pedir('POST', `${base}/passos/4/outro-site`, { decisao: 'remover' }, a.leitor.cookie)).statusCode).toBe(403);
    expect((await a.pedir('POST', `${base}/passos/2/outro-site`, { decisao: 'remover' })).statusCode).toBe(409);
    expect((await a.pedir('POST', `${base}/passos/4/outro-site`, { decisao: 'talvez' })).statusCode).toBe(400);

    // Manter como instrução, desfazer e manter de novo.
    let f = (await a.pedir('POST', `${base}/passos/4/outro-site`, { decisao: 'instrucao' })).json<Fluxo>();
    expect(f.passos[3]).toMatchObject({ instrucao: true, outroSite: 'consulta.cnpj.exemplo' });
    f = (await a.pedir('POST', `${base}/passos/4/outro-site`, { decisao: 'desfazer' })).json<Fluxo>();
    expect(f.passos[3]).not.toHaveProperty('instrucao');
    f = (await a.pedir('POST', `${base}/passos/4/outro-site`, { decisao: 'instrucao' })).json<Fluxo>();

    // Remover a abertura do site e o clique: os passos são renumerados e a lista "Antes de publicar" sabe.
    f = (await a.pedir('POST', `${base}/passos/5/outro-site`, { decisao: 'remover' })).json<Fluxo>();
    f = (await a.pedir('POST', `${base}/passos/3/outro-site`, { decisao: 'remover' })).json<Fluxo>();
    expect(f.passos.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(f.passos[2]).toMatchObject({ titulo: 'Preencher CNPJ', instrucao: true });
    expect(f.outrosSitesRemovidos).toEqual([
      { titulo: 'Clicar em Consultar', site: 'consulta.cnpj.exemplo' },
      { titulo: 'Abrir o site consulta.cnpj.exemplo', site: 'consulta.cnpj.exemplo' },
    ]);
    expect(a.ctx.auditoria.listar().map((x) => x.acao)).toEqual(
      expect.arrayContaining(['removeu o passo em outro site do fluxo', 'manteve como instrução o passo em outro site do fluxo']),
    );

    // Agora testa e publica; a tarefa criada pelo fluxo leva a instrução para o copiloto.
    const teste = await a.pedir('POST', `${base}/testar`, valores);
    expect(teste.statusCode).toBe(200);
    expect(teste.json().resultado.ok).toBe(true);
    const { tarefaId } = (await a.pedir('POST', `${base}/criar-tarefa`)).json() as { tarefaId: string };
    expect(a.ctx.catalogo.rascunho(tarefaId)!.definicao.campos.map((c) => c.chave)).toEqual(['assunto', 'cliente']);
    expect((await a.pedir('POST', `${base}/publicar`)).statusCode).toBe(200);
    const emUso = a.ctx.catalogo.emUso({ id: '101' }, true).find((t) => t.id === tarefaId)!;
    expect(emUso.instrucoes).toEqual(['Preencher CNPJ (em consulta.cnpj.exemplo)']);
    expect(ferramentaDaTarefa(emUso).description).toContain('Instruções (passos feitos fora do sistema');
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

  it('número do registro (Mapear campos), teste com o número lido e publicar ligando a tarefa no widget', async () => {
    const a = await ambiente();
    const { fluxo } = await gravarBoleto(a);
    const base = `/api/console/fluxos/${fluxo.id}`;
    const { tarefaId } = (await a.pedir('POST', `${base}/criar-tarefa`)).json() as { tarefaId: string };

    // Onde o número aparece: formato com 9 e a; tudo vazio volta a procurar no aviso.
    const ruim = await a.pedir('PUT', base, { resultado: { formato: 'CH--' } });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().mensagem).toBe('No formato do número, use 9 para cada dígito e a para cada letra. Ex.: CH-9999-9999.');
    const lugar = { seletor: '[data-campo="numero_chamado"]', formato: 'CH-9999-9999', nome: 'Chamado' };
    const comLugar = (await a.pedir('PUT', base, { resultado: lugar })).json<Fluxo>();
    expect(comLugar.resultado).toEqual(lugar);
    expect((await a.pedir('PUT', base, { resultado: { seletor: ' ', formato: '', nome: '' } })).json<Fluxo>().resultado).toBeNull();
    await a.pedir('PUT', base, { resultado: lugar });

    // O teste leva o lugar ao navegador e guarda o número lido, a duração e quem testou.
    a.falso!.registro = { numero: 'CH-2026-0153', nome: 'Chamado', artigo: 'o', texto: 'Chamado CH-2026-0153 aberto.', seletor: lugar.seletor, origem: 'configurado' };
    const t = await a.pedir('POST', `${base}/testar`, { valores: { cpf_cnpj_pagador: '12.345.678/0001-95', competencia: '10/2026' }, usuarioId: '102' });
    expect(a.falso!.pedidos.at(-1)!.fluxo.resultado).toEqual(lugar);
    expect(t.json().resultado.registro).toMatchObject({ numero: 'CH-2026-0153', origem: 'configurado' });
    const testado = t.json().fluxo as Fluxo;
    expect(testado.ultimoTeste).toMatchObject({ ok: true, duracaoMs: 10, usuarioNome: 'Marcos Teixeira', registro: { numero: 'CH-2026-0153' } });

    // Widget ligado com a ficha incompleta: nada é publicado e a mensagem diz o que falta.
    const rascunho = a.ctx.catalogo.rascunho(tarefaId)!.definicao;
    a.ctx.catalogo.salvarRascunho(tarefaId, { ...rascunho, quandoUsar: 'Curto' }, 'Júlia Martins');
    const incompleta = await a.pedir('POST', `${base}/publicar`, { ativar: true });
    expect(incompleta.statusCode).toBe(422);
    expect(incompleta.json()).toMatchObject({ erro: 'ficha_incompleta' });
    expect(incompleta.json().mensagem).toMatch(/^Antes de ativar a tarefa: Escreva em "Quando usar".* desligue o widget para publicar só o fluxo\.$/);
    expect((await a.pedir('GET', base)).json<Fluxo>().status).toBe('rascunho');
    a.ctx.catalogo.salvarRascunho(tarefaId, rascunho, 'Júlia Martins');

    expect((await a.pedir('POST', `${base}/publicar`, { ativar: true }, a.leitor.cookie)).statusCode).toBe(403);
    const pub = await a.pedir('POST', `${base}/publicar`, { ativar: true, perfis: ['Financeiro', 'Financeiro'] });
    expect(pub.statusCode).toBe(200);
    const corpo = pub.json<FluxoPublicado>();
    expect(corpo.fluxo).toMatchObject({ status: 'publicado', resultado: lugar });
    expect(corpo.tarefa).toMatchObject({ id: tarefaId, nome: 'Segunda via de boleto', status: 'ativa', versao: 1, ativada: true, publicadoPor: 'Júlia Martins' });
    const publicada = a.ctx.catalogo.publicada(tarefaId)!.definicao;
    expect(publicada).toMatchObject({ fluxoId: fluxo.id, perfisPermitidos: ['Financeiro'] });
    expect(a.ctx.auditoria.listar().map((x) => x.acao)).toEqual(expect.arrayContaining(['publicou a versão 1 da tarefa', 'publicou o fluxo']));

    // Uma versão nova do fluxo leva o lugar do número junto.
    const nova = (await a.pedir('POST', `${base}/gravar`)).json() as { fluxo: Fluxo };
    expect(nova.fluxo.resultado).toEqual(lugar);
  });

  it('publicar com o widget desligado: só o fluxo, ligado ao rascunho da tarefa', async () => {
    const a = await ambiente();
    const { fluxo } = await gravarBoleto(a);
    const base = `/api/console/fluxos/${fluxo.id}`;
    const { tarefaId } = (await a.pedir('POST', `${base}/criar-tarefa`)).json() as { tarefaId: string };
    await a.pedir('POST', `${base}/testar`, { valores: { cpf_cnpj_pagador: '12.345.678/0001-95', competencia: '10/2026' }, usuarioId: '102' });
    const pub = (await a.pedir('POST', `${base}/publicar`, { ativar: false })).json<FluxoPublicado>();
    expect(pub.tarefa).toMatchObject({ id: tarefaId, status: 'rascunho', ativada: false, publicadoPor: null });
    expect(a.ctx.catalogo.publicada(tarefaId)).toBeFalsy();
    expect(a.ctx.catalogo.rascunho(tarefaId)!.definicao.fluxoId).toBe(fluxo.id);
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

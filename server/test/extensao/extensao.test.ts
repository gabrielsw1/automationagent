// Entrada da extensão do navegador (E3/E4): código de uso único do console, troca pelo token da
// extensão, escopo (uma conta, uma empresa, só as rotas da extensão), revogação e gravações recentes.
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodigoExtensao, Fluxo, GravacoesRecentes, InfoExtensao, SessaoExtensao, TokenExtensao } from '@copiloto/shared';
import { COOKIE_SESSAO } from '../../src/auth/console.ts';
import { sistemaNovo } from '../../src/plataforma/index.ts';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';
import { eventosBoleto } from '../navegador/ajuda-navegador.ts';

let abertos: Ambiente[] = [];
afterEach(async () => {
  for (const a of abertos) await a.app.close();
  abertos = [];
});

async function ambiente() {
  const a = await criarAmbiente();
  abertos.push(a);
  return a;
}

function pkce() {
  const verificador = crypto.randomBytes(32).toString('base64url');
  const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');
  return { verificador, desafio };
}

const consoleApi = (a: Ambiente, cookie: string, metodo: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  a.app.inject({ method: metodo, url: `/api/console${url}`, headers: { cookie }, payload });

const extensao = (a: Ambiente, token: string | null, metodo: 'GET' | 'POST', url: string, payload?: object) =>
  a.app.inject({ method: metodo, url: `/api/extensao${url}`, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });

/** O caminho inteiro da entrada: código pelo console e troca pela extensão. */
async function conectar(a: Ambiente, cookie: string, empresaId = a.ctx.empresa.id) {
  const { verificador, desafio } = pkce();
  const c = await consoleApi(a, cookie, 'POST', '/extensao/codigo', { empresaId, desafio });
  expect(c.statusCode, c.body).toBe(200);
  const { codigo } = c.json<CodigoExtensao>();
  const t = await extensao(a, null, 'POST', '/trocar', { codigo, verificador, navegador: 'Chrome' });
  expect(t.statusCode, t.body).toBe(200);
  return t.json<TokenExtensao>();
}

describe('entrada da extensão com a conta do console', () => {
  it('troca o código de uso único pelo token; só o hash fica guardado', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const { verificador, desafio } = pkce();
    const r = await consoleApi(a, rafael.cookie, 'POST', '/extensao/codigo', { empresaId: a.ctx.empresa.id, desafio });
    expect(r.statusCode).toBe(200);
    const { codigo, expiraEm } = r.json<CodigoExtensao>();
    expect(Date.parse(expiraEm) - Date.now()).toBeLessThanOrEqual(120_000);

    // Verificador errado: recusa e gasta o código (não dá para tentar de novo).
    const errado = await extensao(a, null, 'POST', '/trocar', { codigo, verificador: pkce().verificador });
    expect(errado.statusCode).toBe(400);
    expect(errado.json()).toMatchObject({ erro: 'codigo_invalido' });
    expect((await extensao(a, null, 'POST', '/trocar', { codigo, verificador })).statusCode).toBe(400);

    const { token, sessao } = await conectar(a, rafael.cookie);
    expect(token).toMatch(/^cpx_/);
    expect(sessao).toMatchObject({
      pessoa: { nome: 'Rafael Lima', email: 'rafael@horizonte.com.br', iniciais: 'RL' },
      empresa: { id: a.ctx.empresa.id, nome: 'Horizonte', demo: true },
      perfil: 'admin',
      podeGravar: true,
      urlConsole: a.config.urlConsole.replace(/\/+$/, ''),
    });
    // O banco da plataforma guarda só o hash do token e do código.
    const tokens = a.plataforma.banco.todos<Record<string, unknown>>('SELECT * FROM tokens_extensao');
    expect(tokens).toHaveLength(1);
    expect(JSON.stringify(tokens)).not.toContain(token);
    expect(tokens[0]).toMatchObject({ navegador: 'Chrome', revogado_em: null });
    expect(JSON.stringify(a.plataforma.banco.todos('SELECT * FROM codigos_extensao'))).not.toContain(codigo);

    const lida = await extensao(a, token, 'GET', '/sessao');
    expect(lida.json<SessaoExtensao>().empresa.nome).toBe('Horizonte');
    expect(a.ctx.auditoria.listar().map((x) => x.acao)).toContain('conectou a extensão do navegador');
  });

  it('código vencido não vale, e sem sessão do console não há código', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx);
    const { verificador, desafio } = pkce();
    const { codigo } = (await consoleApi(a, rafael.cookie, 'POST', '/extensao/codigo', { empresaId: a.ctx.empresa.id, desafio })).json<CodigoExtensao>();
    a.plataforma.banco.executar('UPDATE codigos_extensao SET expira_em = ?', new Date(Date.now() - 1000).toISOString());
    expect((await extensao(a, null, 'POST', '/trocar', { codigo, verificador })).statusCode).toBe(400);

    const semSessao = await a.app.inject({ method: 'POST', url: '/api/console/extensao/codigo', payload: { empresaId: a.ctx.empresa.id, desafio } });
    expect(semSessao.statusCode).toBe(401);
    const desafioRuim = await consoleApi(a, rafael.cookie, 'POST', '/extensao/codigo', { empresaId: a.ctx.empresa.id, desafio: 'curto' });
    expect(desafioRuim.statusCode).toBe(400);
  });

  it('o token não abre as rotas do console, nem como cookie', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx);
    const { token } = await conectar(a, rafael.cookie);
    for (const url of ['/resumo', '/fluxos', '/auth/eu', '/extensao']) {
      const comBearer = await a.app.inject({ method: 'GET', url: `/api/console${url}`, headers: { authorization: `Bearer ${token}` } });
      expect(comBearer.statusCode, url).toBe(401);
      const comoCookie = await a.app.inject({ method: 'GET', url: `/api/console${url}`, headers: { cookie: `${COOKIE_SESSAO}=${token}` } });
      expect(comoCookie.statusCode, url).toBe(401);
    }
    const criar = await a.app.inject({ method: 'POST', url: '/api/console/fluxos', headers: { authorization: `Bearer ${token}` }, payload: { nome: 'X', urlInicial: '/x' } });
    expect(criar.statusCode).toBe(401);
    // E o cookie do console não abre as rotas da extensão.
    expect((await a.app.inject({ method: 'GET', url: '/api/extensao/sessao', headers: { cookie: rafael.cookie } })).statusCode).toBe(401);
  });

  it('"Sair" revoga o token na hora; sair dos outros aparelhos e sair da equipe também', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const um = await conectar(a, rafael.cookie);
    expect((await extensao(a, um.token, 'POST', '/sair')).json()).toEqual({ ok: true });
    expect((await extensao(a, um.token, 'GET', '/sessao')).statusCode).toBe(401);
    expect((await extensao(a, um.token, 'GET', '/gravacoes')).statusCode).toBe(401);
    // De novo (ou sem token): responde ok, sem efeito.
    expect((await extensao(a, um.token, 'POST', '/sair')).statusCode).toBe(200);
    expect((await extensao(a, null, 'POST', '/sair')).statusCode).toBe(200);

    const dois = await conectar(a, rafael.cookie);
    a.plataforma.encerrarSessoesDaConta(a.plataforma.conta('rafael@horizonte.com.br')!.id);
    expect((await extensao(a, dois.token, 'GET', '/sessao')).statusCode).toBe(401);

    const julia = entrarComo(a.ctx, 'editor', 'Júlia Martins', 'julia@horizonte.com.br');
    const tres = await conectar(a, julia.cookie);
    // Um Admin tira a Júlia da equipe: o token dela para de valer.
    const membro = a.ctx.banco.um<{ id: string }>("SELECT id FROM equipe WHERE email = 'julia@horizonte.com.br'")!;
    const admin = entrarComo(a.ctx, 'admin', 'Outro Admin');
    const tirar = await a.app.inject({ method: 'DELETE', url: `/api/console/equipe/${membro.id}`, headers: { cookie: admin.cookie } });
    expect(tirar.statusCode, tirar.body).toBeLessThan(300);
    const depois = await extensao(a, tres.token, 'GET', '/sessao');
    expect(depois.statusCode).toBe(401);
    expect(depois.json()).toMatchObject({ erro: 'extensao_desconectada' });
  });

  it('uma empresa por token: código só para empresas da conta, e as gravações são só da empresa do token', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const outra = a.plataforma.criarEmpresa({ nome: 'Vetor CRM', sistema: sistemaNovo('Vetor', 'https://app.vetor.com.br') });
    const ctxVetor = a.plataforma.contexto(outra.id);
    const estranha = a.plataforma.criarEmpresa({ nome: 'Padaria Estrela', sistema: sistemaNovo('Estrela') });

    // Empresa em que a conta não está: recusa.
    const { desafio } = pkce();
    const fora = await consoleApi(a, rafael.cookie, 'POST', '/extensao/codigo', { empresaId: estranha.id, desafio });
    expect(fora.statusCode).toBe(404);

    // Rafael também é Editor na Vetor: o "Trocar" lista as duas; o token da Vetor é outro.
    const rafaelVetor = entrarComo(ctxVetor, 'editor', 'Rafael Lima', 'rafael@horizonte.com.br');
    const horizonte = await conectar(a, rafael.cookie);
    expect(horizonte.sessao.empresas.map((e) => e.nome).sort()).toEqual(['Horizonte', 'Vetor CRM']);
    const vetor = await conectar(a, rafael.cookie, outra.id);
    expect(vetor.sessao.empresa.nome).toBe('Vetor CRM');

    // Uma gravação de Rafael em cada empresa: cada token vê só a da própria empresa.
    const flxH = (await consoleApi(a, rafael.cookie, 'POST', '/fluxos', { nome: 'Abrir chamado', urlInicial: '/chamados' })).json<{ fluxo: Fluxo }>().fluxo;
    const flxV = (await consoleApi(a, rafaelVetor.cookie, 'POST', '/fluxos', { nome: 'Cadastrar lead', urlInicial: '/leads' })).json<{ fluxo: Fluxo }>().fluxo;
    const daHorizonte = (await extensao(a, horizonte.token, 'GET', '/gravacoes')).json<GravacoesRecentes>();
    expect(daHorizonte.gravacoes.map((g) => g.fluxoId)).toEqual([flxH.id]);
    const daVetor = (await extensao(a, vetor.token, 'GET', '/gravacoes')).json<GravacoesRecentes>();
    expect(daVetor.gravacoes.map((g) => g.fluxoId)).toEqual([flxV.id]);
  });

  it('quem não é Admin nem Editor de tarefas não recebe código e, se perder o perfil, vê que falta permissão', async () => {
    const a = await ambiente();
    const leitor = entrarComo(a.ctx, 'leitor', 'Bruno Costa', 'bruno@horizonte.com.br');
    const { desafio } = pkce();
    const r = await consoleApi(a, leitor.cookie, 'POST', '/extensao/codigo', { empresaId: a.ctx.empresa.id, desafio });
    expect(r.statusCode).toBe(403);
    expect(r.json().mensagem).toMatch(/não permite gravar/);

    const julia = entrarComo(a.ctx, 'editor', 'Júlia Martins', 'julia@horizonte.com.br');
    const { token } = await conectar(a, julia.cookie);
    a.ctx.banco.executar("UPDATE equipe SET perfil = 'leitor' WHERE email = 'julia@horizonte.com.br'");
    const sessao = (await extensao(a, token, 'GET', '/sessao')).json<SessaoExtensao>();
    expect(sessao).toMatchObject({ perfil: 'leitor', podeGravar: false, empresas: [] });
    expect((await extensao(a, token, 'GET', '/gravacoes')).statusCode).toBe(403);
  });
});

describe('gravações recentes (popup)', () => {
  it('mostra as gravações da pessoa, com a situação de cada uma', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const julia = entrarComo(a.ctx, 'editor', 'Júlia Martins', 'julia@horizonte.com.br');
    const { token } = await conectar(a, rafael.cookie);

    const gravar = async (cookie: string, nome: string, concluir: boolean) => {
      const r = (await consoleApi(a, cookie, 'POST', '/fluxos', { nome, urlInicial: '/financeiro/segunda-via' })).json<{ fluxo: Fluxo; token: string }>();
      await a.app.inject({ method: 'POST', url: `/api/gravacao/${r.token}/eventos`, payload: { eventos: eventosBoleto() } });
      if (concluir) await a.app.inject({ method: 'POST', url: `/api/gravacao/${r.token}/concluir` });
      return r;
    };
    const enviada = await gravar(rafael.cookie, 'Segunda via de boleto', true);
    const revisando = await gravar(rafael.cookie, 'Emitir nota', true);
    await consoleApi(a, rafael.cookie, 'PUT', `/fluxos/${revisando.fluxo.id}`, { etapa: 'mapear' });
    const cancelada = await gravar(rafael.cookie, 'Cancelar pedido', false);
    await a.app.inject({ method: 'POST', url: `/api/gravacao/${cancelada.token}/cancelar` });
    const agora = await gravar(rafael.cookie, 'Agendar visita', false);
    await gravar(julia.cookie, 'Da Júlia', true);
    // Publicada (marcada direto no banco: publicar exige um teste de verdade, que não é o assunto aqui).
    const publicada = await gravar(rafael.cookie, 'Abrir chamado', true);
    a.ctx.banco.executar("UPDATE fluxos SET status = 'publicado', etapa = 'publicar' WHERE id = ?", publicada.fluxo.id);

    const { gravacoes } = (await extensao(a, token, 'GET', '/gravacoes')).json<GravacoesRecentes>();
    const porNome = Object.fromEntries(gravacoes.map((g) => [g.nome, g]));
    expect(Object.keys(porNome).sort()).toEqual(['Abrir chamado', 'Agendar visita', 'Emitir nota', 'Segunda via de boleto']);
    expect(porNome['Segunda via de boleto']).toMatchObject({ situacao: 'enviada', passos: 6, fluxoId: enviada.fluxo.id });
    expect(porNome['Emitir nota'].situacao).toBe('em_revisao');
    expect(porNome['Agendar visita']).toMatchObject({ situacao: 'gravando', fluxoId: agora.fluxo.id });
    expect(porNome['Abrir chamado'].situacao).toBe('publicada');
    expect(porNome['Segunda via de boleto'].url).toBe(`${a.config.urlConsole.replace(/\/+$/, '')}/aprender/${enviada.fluxo.id}`);
    expect(gravacoes.length).toBeLessThanOrEqual(5);
  });
});

describe('página "Instalar o gravador" (E1)', () => {
  it('lojas pelo ambiente e quem pode gravar na empresa', async () => {
    const a = await ambiente();
    const rafael = entrarComo(a.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    entrarComo(a.ctx, 'editor', 'Júlia Martins', 'julia@horizonte.com.br');
    const bruno = entrarComo(a.ctx, 'leitor', 'Bruno Costa', 'bruno@horizonte.com.br');
    a.plataforma.config.extensao.urlChrome = '';
    a.plataforma.config.extensao.urlEdge = '';
    const sem = (await consoleApi(a, bruno.cookie, 'GET', '/extensao')).json<InfoExtensao>();
    expect(sem.lojas).toEqual({ chrome: null, edge: null });
    expect(sem.ajudaInstalar).toMatch(/#instalar-pelo-pacote-sem-a-loja$/);
    expect(sem.quemPodeGravar.map((p) => [p.nome, p.perfil])).toEqual([
      ['Rafael Lima', 'admin'],
      ['Júlia Martins', 'editor'],
    ]);

    a.plataforma.config.extensao.urlChrome = 'https://chromewebstore.google.com/detail/copiloto/abc';
    const com = (await consoleApi(a, rafael.cookie, 'GET', '/extensao')).json<InfoExtensao>();
    expect(com.lojas.chrome).toBe('https://chromewebstore.google.com/detail/copiloto/abc');
    expect(com.quemPodeGravar[0]).toMatchObject({ nome: 'Rafael Lima', voce: true });
  });
});

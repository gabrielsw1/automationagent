// Rotas da base de conhecimento (C7): permissões, auditoria, envio de arquivos, vídeos, respostas
// prontas, perguntas sem resposta, "Testar uma pergunta" e leitura de um site servido localmente.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FonteConhecimento, PerguntaSemResposta, RespostaTeste } from '@copiloto/shared';
import { Conhecimento } from '../../src/conhecimento/index.ts';
import type { EventoConsole } from '../../src/eventos.ts';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';
import { gerarDocx, gerarPdf } from './arquivos.ts';

// ---------------------------------------------------------------- ajuda

interface Contexto extends Ambiente {
  base: Conhecimento;
  dirDados: string;
  admin: string;
  leitor: string;
  eventos: EventoConsole[];
}

const abertos: Contexto[] = [];

async function preparar(): Promise<Contexto> {
  const amb = await criarAmbiente();
  const dirDados = fs.mkdtempSync(path.join(process.env.DATA_DIR || os.tmpdir(), 'copiloto-conh-'));
  const base = amb.ctx.conhecimento as Conhecimento;
  base.ligar({ dirDados });
  const eventos: EventoConsole[] = [];
  amb.ctx.eventos.ouvirConsole((e) => eventos.push(e));
  const c: Contexto = {
    ...amb,
    base,
    dirDados,
    admin: entrarComo(amb.ctx, 'editor', 'Júlia Martins').cookie,
    leitor: entrarComo(amb.ctx, 'leitor', 'Paula Nunes').cookie,
    eventos,
  };
  abertos.push(c);
  return c;
}

afterEach(async () => {
  for (const c of abertos.splice(0)) {
    await c.app.close();
    fs.rmSync(c.dirDados, { recursive: true, force: true });
  }
});

/** Corpo multipart/form-data montado à mão (campos de texto e um arquivo). */
function multipart(campos: Record<string, string>, arquivo?: { nome: string; dados: Buffer; tipo?: string }) {
  const fronteira = '----copiloto' + Math.random().toString(16).slice(2);
  const partes: Buffer[] = [];
  for (const [nome, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`));
  }
  if (arquivo) {
    partes.push(
      Buffer.from(
        `--${fronteira}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\nContent-Type: ${arquivo.tipo ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      arquivo.dados,
      Buffer.from('\r\n'),
    );
  }
  partes.push(Buffer.from(`--${fronteira}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${fronteira}` } };
}

const URL_BASE = '/api/console/conhecimento';

async function enviarArquivo(c: Contexto, nome: string, dados: Buffer, campos: Record<string, string> = {}) {
  const corpo = multipart(campos, { nome, dados });
  return c.app.inject({
    method: 'POST',
    url: `${URL_BASE}/fontes/arquivo`,
    headers: { ...corpo.headers, cookie: c.admin },
    payload: corpo.payload,
  });
}

function auditoria(c: Contexto) {
  return c.ctx.banco.todos<{ ator: string; acao: string; alvo: string; detalhe: string | null }>(
    'SELECT ator, acao, alvo, detalhe FROM auditoria ORDER BY ts',
  );
}

function contarTrechos(c: Contexto, id: string): number {
  return c.ctx.banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM conhecimento_trechos WHERE fonte_id = ?', id)?.n ?? 0;
}

const paragrafo = (n: number, tema: string) =>
  Array.from({ length: n }, (_, i) => `Frase ${i + 1} sobre ${tema}, com detalhes para encher o trecho.`).join(' ');

// ---------------------------------------------------------------- permissões e auditoria

describe('permissões', () => {
  it('quem só vê lista e testa, mas não muda nada', async () => {
    const c = await preparar();
    const sem = await c.app.inject({ method: 'GET', url: `${URL_BASE}/fontes` });
    expect(sem.statusCode).toBe(401);

    const lista = await c.app.inject({ method: 'GET', url: `${URL_BASE}/fontes`, headers: { cookie: c.leitor } });
    expect(lista.statusCode).toBe(200);
    expect(Array.isArray(lista.json())).toBe(true);

    const teste = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/testar`,
      headers: { cookie: c.leitor },
      payload: { pergunta: 'qual o prazo?' },
    });
    expect(teste.statusCode).toBe(200);

    for (const [method, url, payload] of [
      ['POST', '/fontes/site', { url: 'http://127.0.0.1:9/ajuda' }],
      ['POST', '/fontes/respostas', { pergunta: 'Qual o horário?', resposta: 'Das 8h às 18h.' }],
      ['POST', '/fontes/video', { texto: '00:10 Olá' }],
      ['POST', '/fontes/x/sincronizar', {}],
      ['POST', '/fontes/x/pausar', {}],
      ['DELETE', '/fontes/x', undefined],
      ['POST', '/perguntas-sem-resposta/x/ignorar', {}],
      ['POST', '/perguntas-sem-resposta/x/responder', { resposta: 'Uma resposta.' }],
    ] as const) {
      const r = await c.app.inject({ method, url: URL_BASE + url, headers: { cookie: c.leitor }, payload });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(auditoria(c)).toEqual([]);
  });

  it('valida os pedidos com mensagens simples', async () => {
    const c = await preparar();
    const r = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/site`,
      headers: { cookie: c.admin },
      payload: { url: 'ftp://servidor/arquivo' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensagem ?? r.json().message).toMatch(/endereço/i);

    const vazio = await c.app.inject({ method: 'POST', url: `${URL_BASE}/testar`, headers: { cookie: c.admin }, payload: {} });
    expect(vazio.statusCode).toBe(400);

    const inexistente = await c.app.inject({ method: 'GET', url: `${URL_BASE}/fontes/fnt_nao_existe`, headers: { cookie: c.admin } });
    expect(inexistente.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------- arquivos

describe('arquivos', () => {
  it('PDF: lê por página, guarda o arquivo, audita e avisa o console', async () => {
    const c = await preparar();
    const pdf = gerarPdf([
      ['Manual do financeiro', 'Este manual explica as rotinas do módulo Financeiro do Horizonte: emissão de boletos,', 'conciliação bancária, relatórios de recebimento e negociação de débitos com os clientes.'],
      [],
      ['Segunda via de boleto', 'A segunda via mantém o número do boleto original e recalcula multa e juros.', 'A nova data de vencimento é sempre de 3 dias úteis depois da emissão da segunda via.'],
    ]);
    const r = await enviarArquivo(c, 'Manual do financeiro.pdf', pdf);
    expect(r.statusCode).toBe(201);
    const criada = r.json() as FonteConhecimento;
    expect(criada).toMatchObject({ tipo: 'arquivo', nome: 'Manual do financeiro.pdf', status: 'indexando', enviadoPor: 'Júlia Martins' });

    await c.base.aguardar();
    const fonte = (await c.app.inject({ method: 'GET', url: `${URL_BASE}/fontes/${criada.id}`, headers: { cookie: c.leitor } })).json();
    expect(fonte.status).toBe('indexado');
    expect(fonte.trechos).toBeGreaterThan(0);
    expect(fonte.detalhe).toMatch(/3 páginas/);
    expect(fonte.sincronizadoEm).toBeTruthy();

    const trechos = (await c.app.inject({ method: 'GET', url: `${URL_BASE}/fontes/${criada.id}/trechos`, headers: { cookie: c.leitor } })).json();
    expect(trechos.some((t: { local: string; texto: string }) => t.local.includes('3') && t.texto.includes('segunda via'))).toBe(true);

    // Arquivo guardado em DATA_DIR/conhecimento/<id>/.
    const pasta = path.join(c.dirDados, 'conhecimento', criada.id);
    expect(fs.readdirSync(pasta)).toHaveLength(1);

    expect(auditoria(c)).toEqual([
      { ator: 'Júlia Martins', acao: 'adicionou fonte de conhecimento', alvo: 'Arquivo “Manual do financeiro.pdf”', detalhe: expect.stringMatching(/KB$/) },
    ]);
    const status = c.eventos.filter((e) => e.tipo === 'fonte' && e.fonteId === criada.id).map((e) => (e as { status: string }).status);
    expect(status[0]).toBe('indexando');
    expect(status.at(-1)).toBe('indexado');

    // A busca já encontra o conteúdo do PDF.
    const teste = (await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/testar`,
      headers: { cookie: c.leitor },
      payload: { pergunta: 'A segunda via mantém o número do boleto?' },
    })).json() as RespostaTeste;
    expect(teste.citacoes[0]).toMatchObject({ n: 1, titulo: 'Manual do financeiro.pdf', local: 'página 3' });
    expect(teste.texto).toContain('[1]');
  });

  it('DOCX, TXT e Markdown viram trechos; trocar a versão mantém a mesma fonte', async () => {
    const c = await preparar();
    const docx = gerarDocx([
      { titulo: 'Política de cobrança' },
      { titulo: 'Boletos', nivel: 2 },
      { paragrafo: 'Os boletos vencem conforme o prazo de pagamento do cliente.' },
    ]);
    const ids: string[] = [];
    for (const [nome, dados] of [
      ['Política.docx', docx],
      ['Notas.txt', Buffer.from('PRAZOS\nAceitamos 15, 30, 45 ou 60 dias.\n\nO prazo padrão é 30 dias.')],
      ['Guia.md', Buffer.from('# Guia\n\n## Chamados\n\nAbra em Chamados › Novo chamado.\n')],
    ] as const) {
      const r = await enviarArquivo(c, nome, dados);
      expect(r.statusCode, nome).toBe(201);
      ids.push(r.json().id);
    }
    await c.base.aguardar();
    for (const id of ids) {
      expect(c.base.fonte(id).status).toBe('indexado');
      expect(contarTrechos(c, id)).toBeGreaterThan(0);
    }
    expect(c.base.buscar('quando vencem os boletos')[0].fonteId).toBe(ids[0]);
    expect(c.base.buscar('novo chamado')[0].local).toBe('seção Chamados');

    // Nova versão do TXT: mesma fonte, conteúdo trocado.
    const nova = await enviarArquivo(c, 'Notas.txt', Buffer.from('PRAZOS\nAgora aceitamos também 90 dias.'), { substituir: ids[1] });
    expect(nova.statusCode).toBe(200);
    expect(nova.json().id).toBe(ids[1]);
    await c.base.aguardar();
    expect(c.base.buscar('aceitamos 90 dias')[0].fonteId).toBe(ids[1]);
    const textos = c.base.trechosDaFonte(ids[1]).map((t) => t.texto).join('\n');
    expect(textos).toContain('90 dias');
    expect(textos).not.toContain('prazo padrão');
    expect(auditoria(c).at(-1)?.acao).toBe('trocou o arquivo da fonte');
  });

  it('recusa tipo não aceito e arquivo vazio; PDF escaneado vira erro com "como resolver"', async () => {
    const c = await preparar();
    const planilha = await enviarArquivo(c, 'Clientes.xlsx', Buffer.from('PK...'));
    expect(planilha.statusCode).toBe(415);
    expect(planilha.json().mensagem ?? planilha.json().message).toMatch(/PDF/);

    const vazio = await enviarArquivo(c, 'Vazio.txt', Buffer.alloc(0));
    expect(vazio.statusCode).toBe(400);

    const semArquivo = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/arquivo`,
      headers: { cookie: c.admin, 'content-type': 'application/json' },
      payload: {},
    });
    expect(semArquivo.statusCode).toBe(400);

    const escaneado = await enviarArquivo(c, 'Contrato escaneado.pdf', gerarPdf([[], []]));
    expect(escaneado.statusCode).toBe(201);
    await c.base.aguardar();
    const f = c.base.fonte(escaneado.json().id);
    expect(f.status).toBe('erro');
    expect(f.erro).toMatch(/digitaliza|image/i);
    expect(f.comoResolver).toBeTruthy();
    expect(f.trechos).toBe(0);
  });
});

// ---------------------------------------------------------------- vídeos e respostas prontas

describe('vídeos e respostas prontas', () => {
  it('transcrição colada e arquivo .vtt viram trechos com o tempo', async () => {
    const c = await preparar();
    const colada = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/video`,
      headers: { cookie: c.admin },
      payload: {
        nome: 'Treinamento: agenda',
        url: 'https://videos.exemplo/agenda',
        texto: [
          `00:05 Bem-vindos ao treinamento. ${paragrafo(4, 'a rotina da equipe')}`,
          `00:30 ${paragrafo(4, 'os clientes da carteira')}`,
          `01:00 ${paragrafo(4, 'os horários de atendimento')}`,
          `01:30 ${paragrafo(4, 'os cuidados no local')}`,
          `02:14 Para agendar uma visita técnica, abra a Agenda e clique em Nova visita. ${paragrafo(3, 'a agenda')}`,
        ].join('\n'),
      },
    });
    expect(colada.statusCode).toBe(201);

    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOlá, pessoal.\n\n00:01:10.000 --> 00:01:15.000\nO relatório de vendas fica em Relatórios › Vendas.\n';
    const corpo = multipart({ nome: 'Treinamento: relatórios' }, { nome: 'relatorios.vtt', dados: Buffer.from(vtt) });
    const arquivo = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/video`,
      headers: { ...corpo.headers, cookie: c.admin },
      payload: corpo.payload,
    });
    expect(arquivo.statusCode).toBe(201);

    const semTexto = await c.app.inject({ method: 'POST', url: `${URL_BASE}/fontes/video`, headers: { cookie: c.admin }, payload: { nome: 'x' } });
    expect(semTexto.statusCode).toBe(400);

    await c.base.aguardar();
    const agenda = c.base.buscar('agendar visita técnica')[0];
    expect(agenda).toMatchObject({ titulo: 'Treinamento: agenda', local: '02:14' });
    expect(agenda.url).toBe('https://videos.exemplo/agenda#t=134');
    // Falas curtas ficam num trecho só, que começa no tempo da primeira.
    expect(c.base.buscar('relatório de vendas')[0]).toMatchObject({ titulo: 'Treinamento: relatórios', local: '00:01' });
    expect(c.base.fonte(colada.json().id).detalhe).toMatch(/Transcrição/);
  });

  it('respostas prontas entram na mesma fonte e respondem o teste', async () => {
    const c = await preparar();
    const um = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/respostas`,
      headers: { cookie: c.admin },
      payload: { pergunta: 'Qual o horário do suporte?', resposta: 'O suporte atende de segunda a sexta, das 8h às 18h.' },
    });
    expect(um.statusCode).toBe(201);
    const dois = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/respostas`,
      headers: { cookie: c.admin },
      payload: { pergunta: 'Tem aplicativo para celular?', resposta: 'Ainda não há aplicativo; o sistema funciona no navegador do celular.' },
    });
    expect(dois.json().id).toBe(um.json().id);
    expect(dois.json()).toMatchObject({ tipo: 'respostas', status: 'indexado', trechos: 2, detalhe: '2 respostas' });

    const teste = (await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/testar`,
      headers: { cookie: c.leitor },
      payload: { pergunta: 'qual o horário de atendimento do suporte?' },
    })).json() as RespostaTeste;
    expect(teste.confianca).not.toBe('baixa');
    expect(teste.citacoes[0]).toMatchObject({ titulo: 'Qual o horário do suporte?', local: 'resposta pronta' });
    expect(teste.texto).toContain('8h às 18h');

    // Sincronizar refaz os trechos a partir da lista guardada.
    await c.app.inject({ method: 'POST', url: `${URL_BASE}/fontes/${um.json().id}/sincronizar`, headers: { cookie: c.admin } });
    await c.base.aguardar();
    expect(c.base.fonte(um.json().id)).toMatchObject({ status: 'indexado', trechos: 2 });
  });
});

// ---------------------------------------------------------------- perguntas sem resposta

describe('perguntas sem resposta', () => {
  it('o teste registra, agrupa; responder vira resposta pronta e ignorar some da lista', async () => {
    const c = await preparar();
    await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/respostas`,
      headers: { cookie: c.admin },
      payload: { pergunta: 'Qual o horário do suporte?', resposta: 'Das 8h às 18h, de segunda a sexta.' },
    });
    const testar = (pergunta: string) =>
      c.app.inject({ method: 'POST', url: `${URL_BASE}/testar`, headers: { cookie: c.leitor }, payload: { pergunta } });

    const r1 = (await testar('como cancelo a assinatura de um cliente?')).json() as RespostaTeste;
    expect(r1.confianca).toBe('baixa');
    expect(r1.citacoes).toEqual([]);
    await testar('Como cancelar assinatura do cliente');
    await testar('posso emitir nota fiscal de serviço?');

    let lista = (await c.app.inject({ method: 'GET', url: `${URL_BASE}/perguntas-sem-resposta`, headers: { cookie: c.leitor } })).json() as PerguntaSemResposta[];
    expect(lista).toHaveLength(2);
    const cancelar = lista.find((p) => p.pergunta.includes('cancelo'))!;
    expect(cancelar.vezes).toBe(2);
    expect(cancelar.causa).toBeTruthy();

    const respondida = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/perguntas-sem-resposta/${cancelar.id}/responder`,
      headers: { cookie: c.admin },
      payload: { resposta: 'Para cancelar a assinatura, abra a ficha do cliente, vá em Plano e clique em Cancelar assinatura. Só Administradores podem cancelar.' },
    });
    expect(respondida.statusCode).toBe(200);
    expect(respondida.json().fonte).toMatchObject({ tipo: 'respostas', trechos: 2 });

    const nota = lista.find((p) => p.pergunta.includes('nota'))!;
    expect((await c.app.inject({ method: 'POST', url: `${URL_BASE}/perguntas-sem-resposta/${nota.id}/ignorar`, headers: { cookie: c.admin } })).statusCode).toBe(200);
    // Responder de novo a mesma pergunta: já não está aberta.
    const deNovo = await c.app.inject({ method: 'POST', url: `${URL_BASE}/perguntas-sem-resposta/${nota.id}/ignorar`, headers: { cookie: c.admin } });
    expect(deNovo.statusCode).toBe(409);

    lista = (await c.app.inject({ method: 'GET', url: `${URL_BASE}/perguntas-sem-resposta`, headers: { cookie: c.leitor } })).json();
    expect(lista).toEqual([]);

    const r2 = (await testar('como cancelo a assinatura de um cliente?')).json() as RespostaTeste;
    expect(r2.confianca).not.toBe('baixa');
    expect(r2.citacoes[0].local).toBe('resposta pronta');

    // Ignorada continua ignorada mesmo se perguntarem de novo.
    await testar('posso emitir nota fiscal de serviço?');
    lista = (await c.app.inject({ method: 'GET', url: `${URL_BASE}/perguntas-sem-resposta`, headers: { cookie: c.leitor } })).json();
    expect(lista).toEqual([]);

    expect(auditoria(c).map((a) => a.acao)).toEqual([
      'adicionou resposta pronta',
      'respondeu pergunta sem resposta',
      'ignorou pergunta sem resposta',
    ]);
  });
});

// ---------------------------------------------------------------- site

interface SiteTeste {
  url: string;
  pedidos: string[];
  fora: boolean;
  fechar: () => Promise<void>;
}

const MENU = '<nav><a href="/ajuda/boletos">Boletos</a> <a href="/ajuda/planos">Planos</a> <a href="/ajuda/privado/interno">Interno</a> <a href="/loja/ofertas">Ofertas</a> <a href="https://externo.exemplo/x">Externo</a> Menu principal do portal</nav>';
const RODAPE = '<footer>© Horizonte Sistemas · Política de privacidade · Rodapé institucional</footer>';

function pagina(titulo: string, corpo: string) {
  return `<!doctype html><html><head><title>${titulo}</title></head><body><header>Cabeçalho do portal</header>${MENU}<main><h1>${titulo}</h1>${corpo}</main>${RODAPE}</body></html>`;
}

async function servirSite(): Promise<SiteTeste> {
  const pedidos: string[] = [];
  const site: SiteTeste = { url: '', pedidos, fora: false, fechar: async () => {} };
  const paginas: Record<string, string> = {
    '/ajuda': pagina(
      'Central de ajuda',
      '<p>Bem-vindo à central de ajuda do Horizonte. Escolha um artigo abaixo para ver o passo a passo.</p><ul><li><a href="/ajuda/boletos">Segunda via de boleto</a></li><li><a href="/ajuda/planos#topo">Planos</a></li><li><a href="/ajuda/manual.pdf">Manual em PDF</a></li></ul>',
    ),
    '/ajuda/boletos': pagina(
      'Como emitir a segunda via de um boleto',
      `<h2>Passo a passo</h2><p>Abra Financeiro › Boletos, encontre o boleto vencido e clique em Segunda via. O novo vencimento é de 3 dias úteis.</p><h2>Quem pode</h2><p>Perfis Financeiro, Gestor financeiro e Administradores. ${paragrafo(6, 'boletos')}</p>`,
    ),
    '/ajuda/planos': pagina(
      'Planos',
      '<h2>Premium</h2><p>O plano Premium custa R$ 1.290 por mês e tem usuários ilimitados.</p><p><a href="/ajuda/boletos?utm_source=menu">Ver boletos</a></p>',
    ),
    '/ajuda/privado/interno': pagina('Interno', '<p>Conteúdo interno que não deveria ser lido pelo robô.</p>'),
    '/loja/ofertas': pagina('Ofertas', '<p>Ofertas da loja, fora da área de ajuda.</p>'),
    '/portal': '',
    '/login': '<html><body><form><input type="password" name="senha"></form></body></html>',
    '/restrito': '',
  };
  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    pedidos.push(u.pathname + u.search);
    if (site.fora) {
      res.writeHead(500).end('erro');
      return;
    }
    if (u.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /ajuda/privado/\n');
      return;
    }
    if (u.pathname === '/portal') {
      res.writeHead(302, { location: '/login?volta=/portal' }).end();
      return;
    }
    if (u.pathname === '/restrito') {
      res.writeHead(403, { 'content-type': 'text/html' }).end('<h1>Proibido</h1>');
      return;
    }
    const html = paginas[u.pathname];
    if (html === undefined) {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Não encontrada</h1>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  site.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  site.fechar = () => new Promise((ok) => servidor.close(() => ok()));
  return site;
}

describe('site', () => {
  let site: SiteTeste;
  beforeAll(async () => {
    site = await servirSite();
  });
  afterAll(async () => {
    await site.fechar();
  });

  it('lê as páginas da mesma área, respeita o robots.txt e ignora menus e rodapés', async () => {
    const c = await preparar();
    site.fora = false;
    site.pedidos.length = 0;
    const r = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/site`,
      headers: { cookie: c.admin },
      payload: { url: `${site.url}/ajuda`, limitePaginas: 10 },
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    await c.base.aguardar();

    const f = c.base.fonte(id);
    expect(f).toMatchObject({ status: 'indexado', nome: 'Central de ajuda' });
    expect(f.detalhe).toMatch(/^3 páginas lidas/);
    expect(site.pedidos).toContain('/robots.txt');
    expect(site.pedidos).not.toContain('/ajuda/privado/interno');
    expect(site.pedidos).not.toContain('/loja/ofertas');
    expect(site.pedidos).not.toContain('/ajuda/manual.pdf');
    // A mesma página com utm/#topo não é lida duas vezes.
    expect(site.pedidos.filter((p) => p.startsWith('/ajuda/boletos'))).toHaveLength(1);

    const textos = c.base.trechosDaFonte(id, 100).map((t) => t.texto).join('\n');
    expect(textos).toContain('Segunda via');
    expect(textos).not.toMatch(/Menu principal|Rodapé institucional|Cabeçalho do portal/);

    const achado = c.base.buscar('quanto custa o plano premium')[0];
    expect(achado).toMatchObject({ titulo: 'Planos', url: `${site.url}/ajuda/planos`, local: 'seção Premium' });

    // Mesmo site de novo: conflito com explicação.
    const dup = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/site`,
      headers: { cookie: c.admin },
      payload: { url: `${site.url}/ajuda/` },
    });
    expect(dup.statusCode).toBe(409);

    // Avisos de progresso chegaram ao console.
    expect(c.eventos.some((e) => e.tipo === 'fonte' && e.fonteId === id && e.status === 'indexado')).toBe(true);
    expect(auditoria(c)[0]).toMatchObject({ acao: 'adicionou fonte de conhecimento', alvo: `Site ${site.url}/ajuda`, detalhe: 'até 10 páginas' });
  });

  it('respeita o limite de páginas', async () => {
    const c = await preparar();
    site.fora = false;
    const r = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/site`,
      headers: { cookie: c.admin },
      payload: { url: `${site.url}/ajuda`, limitePaginas: 2 },
    });
    await c.base.aguardar();
    expect(c.base.fonte(r.json().id).detalhe).toMatch(/^2 páginas lidas/);
  });

  it('erros de acesso viram mensagem com "como resolver"', async () => {
    const c = await preparar();
    site.fora = false;
    const casos: [string, RegExp][] = [
      ['/portal', /login|senha/i],
      ['/restrito', /bloque|permiss|acesso/i],
      ['/nao-existe', /não (foi )?encontrad|não existe/i],
    ];
    for (const [caminho, msg] of casos) {
      const r = await c.app.inject({
        method: 'POST',
        url: `${URL_BASE}/fontes/site`,
        headers: { cookie: c.admin },
        payload: { url: site.url + caminho },
      });
      expect(r.statusCode).toBe(201);
      await c.base.aguardar();
      const f = c.base.fonte(r.json().id);
      expect(f.status, caminho).toBe('erro');
      expect(f.erro, caminho).toMatch(msg);
      expect(f.comoResolver, caminho).toBeTruthy();
      expect(f.trechos).toBe(0);
    }
  });

  it('nova sincronização com falha mantém a versão anterior; pausar e remover', async () => {
    const c = await preparar();
    site.fora = false;
    const r = await c.app.inject({
      method: 'POST',
      url: `${URL_BASE}/fontes/site`,
      headers: { cookie: c.admin },
      payload: { url: `${site.url}/ajuda`, nome: 'Central do Horizonte' },
    });
    const id = r.json().id as string;
    await c.base.aguardar();
    const antes = contarTrechos(c, id);
    expect(antes).toBeGreaterThan(0);
    expect(c.base.fonte(id).nome).toBe('Central do Horizonte');

    site.fora = true;
    const sinc = await c.app.inject({ method: 'POST', url: `${URL_BASE}/fontes/${id}/sincronizar`, headers: { cookie: c.admin } });
    expect(sinc.statusCode).toBe(200);
    expect(sinc.json().status).toBe('indexando');
    await c.base.aguardar();
    const comErro = c.base.fonte(id);
    expect(comErro.status).toBe('erro');
    expect(comErro.erro).toMatch(/continua usando a versão lida em/);
    expect(contarTrechos(c, id)).toBe(antes);
    expect(c.base.buscar('segunda via de boleto').some((t) => t.fonteId === id)).toBe(true);

    // Pausada: o copiloto deixa de usar.
    const pausa = await c.app.inject({ method: 'POST', url: `${URL_BASE}/fontes/${id}/pausar`, headers: { cookie: c.admin } });
    expect(pausa.json().status).toBe('pausado');
    expect(c.base.buscar('segunda via de boleto').some((t) => t.fonteId === id)).toBe(false);

    // Volta a ler quando o site volta.
    site.fora = false;
    await c.app.inject({ method: 'POST', url: `${URL_BASE}/fontes/${id}/sincronizar`, headers: { cookie: c.admin } });
    await c.base.aguardar();
    expect(c.base.fonte(id)).toMatchObject({ status: 'indexado', erro: null });

    const del = await c.app.inject({ method: 'DELETE', url: `${URL_BASE}/fontes/${id}`, headers: { cookie: c.admin } });
    expect(del.statusCode).toBe(200);
    expect(contarTrechos(c, id)).toBe(0);
    expect(c.base.listarFontes()).toEqual([]);
    expect(c.eventos.at(-1)).toEqual({ tipo: 'fonte', fonteId: id, status: 'removido' });
    expect(auditoria(c).map((a) => a.acao)).toEqual([
      'adicionou fonte de conhecimento',
      'sincronizou fonte de conhecimento',
      'pausou fonte de conhecimento',
      'sincronizou fonte de conhecimento',
      'removeu fonte de conhecimento',
    ]);
  });
});

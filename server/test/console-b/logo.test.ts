// Logo do widget (C8 Aparência e "Sua marca"): conferência pelo conteúdo (PNG ou SVG), limite de
// 1 MB, SVG limpo (sem script, eventos, links externos), pasta da empresa, endereço público preso
// à chave do widget com cache, remoção e limpeza dos arquivos que ninguém usa.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { Canais, WidgetConfigPublica } from '@copiloto/shared';
import { assinarUsuario } from '../../src/auth/widget.ts';
import { conferirSvg, LogoRecusado, medidasPng, validarLogo } from '../../src/servicos/logo.ts';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';

/** PNG de verdade (RGB, uma cor), com CRC certo, para a largura e altura pedidas. */
function png(largura: number, altura: number): Buffer {
  const pedaco = (tipo: string, dados: Buffer) => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(corpo) >>> 0);
    return Buffer.concat([tamanho, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(largura * 3, 0x55)]);
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(bruto)),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

const SVG_OK = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Exportado pelo editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" width="64" height="64">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#2E5BFF"/><stop offset="1" stop-color="#1B3FCC"/></linearGradient></defs>
  <style>.a { fill: url(#g); }</style>
  <rect class="a" width="64" height="64" rx="12"/>
  <path d="M20 44 L32 16 L44 44 Z" fill="#fff" style="opacity: .9"/>
  <use xlink:href="#g"/>
  <text x="32" y="58" text-anchor="middle">P &amp; E</text>
</svg>`;

function recusa(conteudo: string | Buffer): string {
  try {
    validarLogo(typeof conteudo === 'string' ? Buffer.from(conteudo) : conteudo);
  } catch (e) {
    expect(e).toBeInstanceOf(LogoRecusado);
    return (e as Error).message;
  }
  throw new Error('O logo deveria ter sido recusado.');
}

describe('conferência do logo pelo conteúdo', () => {
  it('aceita PNG quadrado e lê as medidas do cabeçalho', () => {
    expect(medidasPng(png(96, 96))).toEqual({ largura: 96, altura: 96 });
    expect(validarLogo(png(96, 96))).toEqual({ tipo: 'image/png', extensao: 'png' });
    // Até 1,25 de proporção ainda conta como quadrado.
    expect(validarLogo(png(120, 100)).tipo).toBe('image/png');
  });

  it('recusa PNG comprido, pequeno demais, vazio, acima de 1 MB e o que não é PNG nem SVG', () => {
    expect(recusa(png(300, 100))).toBe(
      'O logo precisa ser quadrado: este tem 300 × 100 pixels. Use uma versão só com o símbolo, com a mesma largura e altura.',
    );
    expect(recusa(png(16, 16))).toBe('O logo é pequeno demais (16 × 16 pixels). Use pelo menos 32 × 32.');
    expect(recusa(Buffer.alloc(0))).toBe('O arquivo está vazio.');
    expect(recusa(Buffer.concat([png(64, 64), Buffer.alloc(1024 * 1024)]))).toBe('O logo tem 1,0 MB. O limite é 1 MB.');
    // A extensão não importa: um JPEG (ou um texto) com nome .png é recusado pelo conteúdo.
    expect(recusa(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]))).toBe('O logo precisa ser um arquivo PNG ou SVG.');
    expect(recusa('<html><body>oi</body></html>')).toBe('O logo precisa ser um arquivo PNG ou SVG.');
  });

  it('aceita SVG limpo (declaração XML, comentário, gradiente, estilo interno, link #id, entidades do XML)', () => {
    expect(validarLogo(Buffer.from(SVG_OK))).toEqual({ tipo: 'image/svg+xml', extensao: 'svg' });
    expect(conferirSvg(SVG_OK)).toEqual({ largura: 64, altura: 64 });
    expect(conferirSvg('<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="48px"><circle r="4"/></svg>')).toEqual({
      largura: 48,
      altura: 48,
    });
    // DOCTYPE simples (sem declarações internas) e elementos de editor passam.
    const inkscape = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 10 10"><sodipodi:namedview id="n" pagecolor="#fff"/><rect width="10" height="10"/></svg>`;
    expect(validarLogo(Buffer.from(inkscape)).tipo).toBe('image/svg+xml');
    // Imagem embutida em base64 (PNG) dentro do SVG é aceita.
    const embutida = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="data:image/png;base64,${png(32, 32).toString('base64')}" width="10" height="10"/></svg>`;
    expect(validarLogo(Buffer.from(embutida)).tipo).toBe('image/svg+xml');
  });

  it.each([
    ['script', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>', 'usa o elemento <script>'],
    ['evento', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><rect/></svg>', 'tem um evento (onload)'],
    ['evento em maiúsculas', '<svg viewBox="0 0 10 10"><rect ONCLICK="x()"/></svg>', 'tem um evento (ONCLICK)'],
    ['foreignObject', '<svg viewBox="0 0 10 10"><foreignObject><div>oi</div></foreignObject></svg>', 'usa o elemento <foreignObject>'],
    ['link a', '<svg viewBox="0 0 10 10"><a href="https://exemplo.com"><rect/></a></svg>', 'usa o elemento <a>'],
    ['animate', '<svg viewBox="0 0 10 10"><animate attributeName="href" to="javascript:alert(1)"/></svg>', 'usa o elemento <animate>'],
    ['href externo', '<svg viewBox="0 0 10 10"><use href="https://exemplo.com/a.svg#x"/></svg>', 'aponta para um arquivo ou endereço externo'],
    ['xlink:href externo', '<svg viewBox="0 0 10 10"><image xlink:href="https://exemplo.com/a.png"/></svg>', 'aponta para um arquivo ou endereço externo'],
    ['javascript em href', '<svg viewBox="0 0 10 10"><use href="java&#x09;script:alert(1)"/></svg>', 'tem um link que roda código'],
    ['data:text/html', '<svg viewBox="0 0 10 10"><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>', 'tem um link que roda código'],
    ['url() externa no style', '<svg viewBox="0 0 10 10"><rect style="fill: url(https://exemplo.com/x.svg#a)"/></svg>', 'o estilo aponta para um endereço externo'],
    ['url() externa no atributo', '<svg viewBox="0 0 10 10"><rect fill="url(//exemplo.com/x#a)"/></svg>', 'o estilo aponta para um endereço externo'],
    ['@import no <style>', '<svg viewBox="0 0 10 10"><style>@import url(https://exemplo.com/a.css);</style></svg>', 'o estilo carrega ou roda algo de fora'],
    ['@import em CDATA', '<svg viewBox="0 0 10 10"><style><![CDATA[@import "x.css";]]></style></svg>', 'o estilo carrega ou roda algo de fora'],
    [
      'DOCTYPE com entidades',
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 10 10"><text>&x;</text></svg>',
      'declara DOCTYPE com entidades',
    ],
    ['entidade fora do XML', '<svg viewBox="0 0 10 10"><text>&nbsp;</text></svg>', 'usa entidades que não são do XML'],
    ['xml-stylesheet', '<?xml-stylesheet href="https://exemplo.com/a.css"?><svg viewBox="0 0 10 10"/>', 'tem uma instrução de processamento'],
    ['xml:base', '<svg viewBox="0 0 10 10" xml:base="https://exemplo.com/"><use href="#a"/></svg>', 'muda a base dos endereços'],
    ['dois desenhos', '<svg viewBox="0 0 10 10"></svg><svg viewBox="0 0 10 10"></svg>', 'conteúdo depois do fim do desenho'],
    ['tag sem fechar', '<svg viewBox="0 0 10 10"><g><rect/></svg>', 'tem tags que não fecham na ordem'],
    ['comprido', '<svg viewBox="0 0 300 100"><rect width="300" height="100"/></svg>', 'O logo precisa ser quadrado: este tem 300 × 100.'],
  ])('recusa SVG com %s', (_caso, svg, trecho) => {
    expect(recusa(svg)).toContain(trecho);
  });
});

// ---------------------------------------------------------------- rotas

let amb: Ambiente | undefined;
let pasta: string | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
  if (pasta) fs.rmSync(pasta, { recursive: true, force: true });
  pasta = undefined;
});

async function preparar() {
  pasta = fs.mkdtempSync(path.join(process.env.DATA_DIR || os.tmpdir(), 'copiloto-logo-'));
  amb = await criarAmbiente({ dirDados: pasta });
  return amb;
}

function multipart(nome: string, dados: Buffer, campo = 'arquivo') {
  const fronteira = '----copiloto' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(
      `--${fronteira}\r\nContent-Disposition: form-data; name="${campo}"; filename="${nome}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    dados,
    Buffer.from(`\r\n--${fronteira}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${fronteira}` } };
}

async function enviar(a: Ambiente, cookie: string, nome: string, dados: Buffer, campo?: string) {
  const corpo = multipart(nome, dados, campo);
  return a.app.inject({ method: 'POST', url: '/api/console/canais/logo', headers: { ...corpo.headers, cookie }, payload: corpo.payload });
}

/** Configuração que o widget recebe ao abrir (snippet assinado, como no site do cliente). */
async function configDoWidget(a: Ambiente): Promise<WidgetConfigPublica> {
  const r = await a.app.inject({
    method: 'POST',
    url: '/api/widget/iniciar',
    payload: { chave: a.ctx.empresa.chavePublica, usuario: '101', assinatura: assinarUsuario('101', a.config.segredoWidget) },
  });
  expect(r.statusCode).toBe(200);
  return r.json<{ config: WidgetConfigPublica }>().config;
}

function arquivosNaPasta(a: Ambiente): string[] {
  const dir = path.join(a.ctx.config.dirDados, 'marca');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

describe('rotas do logo', () => {
  it('envia para o rascunho, guarda na pasta da empresa, serve pela chave com cache e publica', async () => {
    const a = await preparar();
    const { cookie } = entrarComo(a.ctx, 'editor', 'Júlia Martins');
    const leitor = entrarComo(a.ctx, 'leitor');
    const imagem = png(128, 128);

    expect((await enviar(a, leitor.cookie, 'logo.png', imagem)).statusCode).toBe(403);

    const r = await enviar(a, cookie, 'padaria-estrela.png', imagem);
    expect(r.statusCode).toBe(200);
    const c = r.json<Canais>();
    expect(c.temAlteracoes).toBe(true);
    expect(c.publicada.logo).toBeNull();
    const logo = c.rascunho.logo!;
    expect(logo).toMatchObject({ nome: 'padaria-estrela.png', tamanho: imagem.length, tipo: 'image/png' });
    expect(logo.arquivo).toMatch(/^[a-f0-9]{32}\.png$/);
    const chave = a.ctx.empresa.chavePublica;
    expect(logo.url).toBe(`${a.config.urlPublica}/api/widget/marca/${chave}/${logo.arquivo}`);

    // Fica na pasta da empresa, dentro de DATA_DIR.
    expect(a.ctx.config.dirDados.startsWith(pasta!)).toBe(true);
    expect(arquivosNaPasta(a)).toEqual([logo.arquivo]);
    expect(a.ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Júlia Martins', acao: 'enviou o logo do widget', detalhe: 'padaria-estrela.png (1 KB)' });

    // Endereço público (sem token), com cache longo e ETag.
    const caminho = new URL(logo.url).pathname;
    const servido = await a.app.inject({ method: 'GET', url: caminho });
    expect(servido.statusCode).toBe(200);
    expect(servido.headers['content-type']).toBe('image/png');
    expect(servido.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(servido.headers['x-content-type-options']).toBe('nosniff');
    expect(servido.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(servido.rawPayload.equals(imagem)).toBe(true);
    const etag = String(servido.headers.etag);
    expect((await a.app.inject({ method: 'GET', url: caminho, headers: { 'if-none-match': etag } })).statusCode).toBe(304);

    // O widget publicado ainda não tem logo (só o rascunho tem).
    expect((await configDoWidget(a)).logo).toBeNull();

    // Salvar o rascunho pelo formulário não apaga nem troca o logo.
    const salvo = await a.app.inject({
      method: 'PUT',
      url: '/api/console/canais/rascunho',
      headers: { cookie },
      payload: { config: { ...c.rascunho, nome: 'Assistente Estrela', logo: null } },
    });
    expect(salvo.json<Canais>().rascunho.logo?.arquivo).toBe(logo.arquivo);

    const publicado = (await a.app.inject({ method: 'POST', url: '/api/console/canais/publicar', headers: { cookie } })).json<Canais>();
    expect(publicado.temAlteracoes).toBe(false);
    expect(publicado.publicada.logo?.url).toBe(logo.url);
    // Depois de publicar, o widget das pessoas recebe o logo com o endereço público.
    expect((await configDoWidget(a)).logo).toMatchObject({ arquivo: logo.arquivo, url: logo.url, tipo: 'image/png' });
    expect(a.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'publicou a configuração do widget', detalhe: 'Mudou nome, logo' });
  });

  it('o endereço só serve logos em uso e só pela chave da própria empresa', async () => {
    const a = await preparar();
    const { cookie } = entrarComo(a.ctx, 'admin');
    const logo = (await enviar(a, cookie, 'logo.svg', Buffer.from(SVG_OK))).json<Canais>().rascunho.logo!;
    expect(logo.tipo).toBe('image/svg+xml');
    const caminho = new URL(logo.url).pathname;

    const svg = await a.app.inject({ method: 'GET', url: caminho });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect(svg.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");

    // Outra empresa: a chave dela não serve o arquivo desta, nem o mesmo arquivo copiado para lá.
    const outra = a.plataforma.criarEmpresa({ nome: 'Outra', sistema: { ...a.ctx.empresa.sistema } });
    const ctxOutra = a.plataforma.contexto(outra.id);
    expect((await a.app.inject({ method: 'GET', url: `/api/widget/marca/${outra.chavePublica}/${logo.arquivo}` })).statusCode).toBe(404);
    fs.mkdirSync(path.join(ctxOutra.config.dirDados, 'marca'), { recursive: true });
    fs.copyFileSync(path.join(a.ctx.config.dirDados, 'marca', logo.arquivo), path.join(ctxOutra.config.dirDados, 'marca', logo.arquivo));
    expect((await a.app.inject({ method: 'GET', url: `/api/widget/marca/${outra.chavePublica}/${logo.arquivo}` })).statusCode).toBe(404);

    // Chave que não existe, nome fora do padrão e arquivo que não está na configuração.
    expect((await a.app.inject({ method: 'GET', url: `/api/widget/marca/pk_naoexiste/${logo.arquivo}` })).statusCode).toBe(404);
    expect((await a.app.inject({ method: 'GET', url: `/api/widget/marca/${a.ctx.empresa.chavePublica}/..%2Fplataforma.db` })).statusCode).toBe(404);
    fs.writeFileSync(path.join(a.ctx.config.dirDados, 'marca', `${'0'.repeat(32)}.png`), png(40, 40));
    expect((await a.app.inject({ method: 'GET', url: `/api/widget/marca/${a.ctx.empresa.chavePublica}/${'0'.repeat(32)}.png` })).statusCode).toBe(
      404,
    );
  });

  it('recusa arquivo inválido com a mensagem para a pessoa e não grava nada', async () => {
    const a = await preparar();
    const { cookie } = entrarComo(a.ctx, 'admin');
    const svgRuim = await enviar(a, cookie, 'logo.svg', Buffer.from('<svg viewBox="0 0 10 10" onload="alert(1)"/>'));
    expect(svgRuim.statusCode).toBe(422);
    expect(svgRuim.json()).toMatchObject({
      erro: 'logo_invalido',
      mensagem: 'Este SVG não pode ser usado como logo: tem um evento (onload). Exporte só o desenho (sem scripts nem links) e envie de novo.',
    });
    const grande = await enviar(a, cookie, 'grande.png', Buffer.concat([png(64, 64), Buffer.alloc(1024 * 1024 + 10)]));
    expect(grande.statusCode).toBe(413);
    expect(grande.json()).toMatchObject({ erro: 'logo_invalido', mensagem: 'O logo passa de 1 MB. O limite é 1 MB.' });
    const jpeg = await enviar(a, cookie, 'foto.png', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    expect(jpeg.statusCode).toBe(422);
    expect(jpeg.json().mensagem).toBe('O logo precisa ser um arquivo PNG ou SVG.');
    const semArquivo = await enviar(a, cookie, 'logo.png', png(64, 64), 'outro');
    expect(semArquivo.statusCode).toBe(400);

    expect(arquivosNaPasta(a)).toEqual([]);
    const c = (await a.app.inject({ method: 'GET', url: '/api/console/canais', headers: { cookie } })).json<Canais>();
    expect(c.rascunho.logo).toBeNull();
    expect(c.temAlteracoes).toBe(false);
  });

  it('remover volta ao ícone padrão; trocar e descartar apagam os arquivos que ninguém usa', async () => {
    const a = await preparar();
    const { cookie } = entrarComo(a.ctx, 'editor', 'Júlia Martins');
    const primeiro = (await enviar(a, cookie, 'v1.png', png(64, 64))).json<Canais>().rascunho.logo!;
    await a.app.inject({ method: 'POST', url: '/api/console/canais/publicar', headers: { cookie } });

    // Trocar no rascunho: o publicado continua no ar até publicar de novo.
    const segundo = (await enviar(a, cookie, 'v2.png', png(80, 80))).json<Canais>().rascunho.logo!;
    expect(arquivosNaPasta(a)).toEqual([primeiro.arquivo, segundo.arquivo].sort());
    expect((await a.app.inject({ method: 'GET', url: new URL(primeiro.url).pathname })).statusCode).toBe(200);

    // Descartar: o rascunho volta ao publicado e o segundo arquivo sai do disco.
    const desc = (await a.app.inject({ method: 'POST', url: '/api/console/canais/descartar', headers: { cookie } })).json<Canais>();
    expect(desc.rascunho.logo?.arquivo).toBe(primeiro.arquivo);
    expect(arquivosNaPasta(a)).toEqual([primeiro.arquivo]);
    expect((await a.app.inject({ method: 'GET', url: new URL(segundo.url).pathname })).statusCode).toBe(404);

    // Remover: sai do rascunho, fica no publicado até publicar.
    const leitor = entrarComo(a.ctx, 'leitor');
    expect((await a.app.inject({ method: 'DELETE', url: '/api/console/canais/logo', headers: { cookie: leitor.cookie } })).statusCode).toBe(403);
    const removido = (await a.app.inject({ method: 'DELETE', url: '/api/console/canais/logo', headers: { cookie } })).json<Canais>();
    expect(removido.rascunho.logo).toBeNull();
    expect(removido.publicada.logo?.arquivo).toBe(primeiro.arquivo);
    expect(removido.temAlteracoes).toBe(true);
    expect(a.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'removeu o logo do widget', detalhe: 'v1.png' });

    const pub = (await a.app.inject({ method: 'POST', url: '/api/console/canais/publicar', headers: { cookie } })).json<Canais>();
    expect(pub.publicada.logo).toBeNull();
    expect(arquivosNaPasta(a)).toEqual([]);
    expect((await a.app.inject({ method: 'GET', url: new URL(primeiro.url).pathname })).statusCode).toBe(404);
  });
});

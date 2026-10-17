// Ajuda dos testes do navegador: ambiente com pasta de dados temporária, adaptador que aponta
// para um servidor HTTP local e eventos de gravação de exemplo (segunda via de boleto).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { EventoGravado } from '@copiloto/shared';
import type { AdaptadorSistema, ChamadaApi, SessaoNavegador } from '../../src/adaptadores/tipos.ts';
import { AdaptadorFalso, criarAmbiente, type Ambiente, type OpcoesAmbiente } from '../ajuda.ts';

export function pastaTemporaria(prefixo = 'copiloto-nav-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

/**
 * Como `criarAmbiente`, mas com DATA_DIR numa pasta temporária (prints e arquivos de verdade).
 * `dirDados` devolvido é a pasta da empresa de demonstração, onde ficam prints e arquivos.
 */
export async function criarAmbienteNavegador(opcoes: OpcoesAmbiente = {}): Promise<Ambiente & { dirDados: string }> {
  const amb = await criarAmbiente({ ...opcoes, dirDados: opcoes.dirDados ?? pastaTemporaria() });
  return { ...amb, dirDados: amb.ctx.config.dirDados };
}

/** Adaptador falso cujas telas ficam num servidor local (urlBase trocada). */
export class AdaptadorTelas implements AdaptadorSistema {
  readonly nome = 'Horizonte';
  private readonly falso = new AdaptadorFalso();
  sessaoValida = true;
  sessoes: string[] = [];

  constructor(readonly urlBase: string) {}

  verificarConexao() {
    return this.falso.verificarConexao();
  }
  buscarUsuario(id: string) {
    return this.falso.buscarUsuario(id);
  }
  listarUsuarios() {
    return this.falso.listarUsuarios();
  }
  listarPerfis() {
    return this.falso.listarPerfis();
  }
  descreverApi() {
    return this.falso.descreverApi();
  }
  chamar(c: ChamadaApi) {
    return this.falso.chamar(c);
  }
  async sessaoNavegador(usuarioId: string): Promise<SessaoNavegador> {
    this.sessoes.push(usuarioId);
    return { cookies: [{ name: 'hz_sessao', value: this.sessaoValida ? `ok-${usuarioId}` : 'vencida', url: this.urlBase }] };
  }
}

export interface ServidorTelas {
  url: string;
  estado: { versao: 'v1' | 'v2' | 'v3' };
  fechar: () => Promise<void>;
}

const LINHA = '34191.79001 01043.510047 91020.150008 1 96610000012345';

function pagina(corpo: string, secao: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${secao} · Horizonte</title></head>
<body data-pagina="${secao}"><nav><a href="/agenda">Agenda</a> <a href="/financeiro">Financeiro</a></nav><main>${corpo}</main>
<script src="http://localhost:1/copiloto.js" async></script></body></html>`;
}

/** Telas mínimas de "segunda via" para o executor: v1 (gravada), v2 (campo renomeado) e v3 (botão mudou). */
export async function subirTelas(): Promise<ServidorTelas> {
  const estado: ServidorTelas['estado'] = { versao: 'v1' };
  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const logado = /hz_sessao=ok-/.test(req.headers.cookie ?? '');
    const html = (s: number, corpo: string) => {
      res.writeHead(s, { 'content-type': 'text/html; charset=utf-8' });
      res.end(corpo);
    };
    if (u.pathname === '/entrar') return html(200, pagina('<h1>Entrar</h1><input type="password" name="senha">', 'Entrar'));
    if (!logado) {
      res.writeHead(302, { location: '/entrar' });
      return res.end();
    }
    if (u.pathname === '/financeiro/segunda-via') {
      const v = estado.versao;
      const campoDoc =
        v === 'v2'
          ? '<label for="doc">CPF/CNPJ</label><input id="doc" name="documento">'
          : '<label for="doc">CPF/CNPJ do pagador</label><input id="doc" name="doc_pagador">';
      const botao = v === 'v3' ? 'Buscar 2ª via' : 'Buscar boletos';
      return html(
        200,
        pagina(
          `<h1>Segunda via de boleto</h1>
<form action="/financeiro/resultado" method="get">
  <p>${campoDoc}</p>
  <p><label for="comp">Competência</label>
  <select id="comp" name="competencia"><option value="">Selecione</option><option value="2026-10">10/2026</option><option value="2026-09">09/2026</option></select></p>
  <p><label for="em">E-mail para envio</label><input id="em" name="email" type="email"></p>
  <p><label for="obs">Observações</label><textarea id="obs" name="obs"></textarea></p>
  <button type="submit">${botao}</button>
</form>
<p>Contato do financeiro: financeiro@horizonte.com.br · CNPJ 12.345.678/0001-95</p>`,
          'Financeiro',
        ),
      );
    }
    if (u.pathname === '/financeiro/resultado') {
      const doc = u.searchParams.get('doc_pagador') ?? u.searchParams.get('documento') ?? '';
      const comp = u.searchParams.get('competencia') ?? '';
      if (!doc || !comp) return html(200, pagina('<div role="alert">Nenhum boleto encontrado para este pagador e competência.</div>', 'Financeiro'));
      return html(
        200,
        pagina(
          `<h1>Boletos</h1><table><tr><td>${comp}</td><td><a href="/arquivos/boleto-123.pdf" download>Gerar 2ª via</a></td></tr></table>
<p>Linha digitável: <span data-campo="linha_digitavel">${LINHA}</span></p>`,
          'Financeiro',
        ),
      );
    }
    if (u.pathname === '/arquivos/boleto-123.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="boleto-123.pdf"' });
      return res.end('%PDF-1.4\n% boleto de teste\n');
    }
    html(404, pagina('<h1>Não encontrado</h1>', 'Erro'));
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    estado,
    fechar: () => new Promise<void>((r) => servidor.close(() => r())),
  };
}

export { LINHA as LINHA_DIGITAVEL };

const el = (e: Partial<NonNullable<EventoGravado['elemento']>> & { tag: string; css: string }) => e;

/** Gravação de exemplo: segunda via de boleto, como o widget mandaria (sem valores digitados). */
export function eventosBoleto(base = 'http://horizonte.teste'): EventoGravado[] {
  const url = `${base}/financeiro/segunda-via?copiloto_gravacao=tok`;
  const t0 = 1_760_000_000_000;
  return [
    { tipo: 'navegar', ts: t0, url, tituloPagina: 'Segunda via · Horizonte' },
    { tipo: 'clique', ts: t0 + 2_000, url, elemento: el({ tag: 'input', name: 'doc_pagador', id: 'doc', rotulo: 'CPF/CNPJ do pagador', css: 'main form > p:nth-of-type(1) > input' }) },
    {
      tipo: 'preencher',
      ts: t0 + 4_000,
      url,
      elemento: el({ tag: 'input', name: 'doc_pagador', id: 'doc', rotulo: 'CPF/CNPJ do pagador', css: 'main form > p:nth-of-type(1) > input' }),
      formatoValor: '99.999.999/9',
    },
    {
      tipo: 'preencher',
      ts: t0 + 6_000,
      url,
      elemento: el({ tag: 'input', name: 'doc_pagador', id: 'doc', rotulo: 'CPF/CNPJ do pagador', css: 'main form > p:nth-of-type(1) > input' }),
      formatoValor: '99.999.999/9999-99',
    },
    {
      tipo: 'selecionar',
      ts: t0 + 8_000,
      url,
      elemento: el({
        tag: 'select',
        name: 'competencia',
        id: 'comp',
        rotulo: 'Competência',
        css: 'main form select',
        contexto: '<select name="competencia"><option value="">Selecione</option><option value="2026-10">10/2026</option><option value="2026-09">09/2026</option></select>',
      }),
      opcaoTexto: '10/2026',
    },
    { tipo: 'clique', ts: t0 + 9_000, url, elemento: el({ tag: 'button', type: 'submit', texto: 'Buscar boletos', css: 'main form > button' }) },
    { tipo: 'navegar', ts: t0 + 9_400, url: `${base}/financeiro/resultado?doc_pagador=x&competencia=2026-10`, tituloPagina: 'Boletos · Horizonte' },
    {
      tipo: 'clique',
      ts: t0 + 12_000,
      url: `${base}/financeiro/resultado`,
      elemento: el({ tag: 'a', texto: 'Gerar 2ª via', href: `${base}/arquivos/boleto-123.pdf`, css: 'table tr:nth-child(1) a' }),
    },
    {
      tipo: 'download',
      ts: t0 + 12_300,
      url: `${base}/financeiro/resultado`,
      elemento: el({ tag: 'a', texto: 'Gerar 2ª via', href: `${base}/arquivos/boleto-123.pdf`, css: 'table tr:nth-child(1) a' }),
    },
    {
      tipo: 'leitura',
      ts: t0 + 15_000,
      url: `${base}/financeiro/resultado`,
      elemento: el({ tag: 'span', texto: '34191.79001…', css: 'main p > span[data-campo="linha_digitavel"]', contexto: '<span data-campo="linha_digitavel">99999.99999</span>' }),
    },
  ];
}

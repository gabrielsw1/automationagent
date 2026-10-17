// Conector só pela tela (Chromium de verdade): o navegador do copiloto entra no sistema da empresa
// com a conta de serviço (usuário e senha) ou com a sessão de quem pede (endereço de sessão
// assinado), antes do fluxo; e o "Testar acesso" do console.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Eu, Fluxo } from '@copiloto/shared';
import { lerConfig } from '../../src/config.ts';
import { Banco } from '../../src/db/banco.ts';
import { MIGRACOES } from '../../src/db/esquema.ts';
import { AdaptadorTela, assinarPedidoSessao } from '../../src/adaptadores/tela.ts';
import { LlmSimulado } from '../../src/llm/simulado.ts';
import { NavegadorPlaywright } from '../../src/navegador/executor.ts';
import type { EventoNavegador } from '../../src/navegador/tipos.ts';
import { codigoEnviado, criarAmbiente, type Ambiente } from '../ajuda.ts';
import { pastaTemporaria } from './ajuda-navegador.ts';

let servidor: http.Server;
let url: string;

const SEGREDO = 'sw_segredo-do-teste';

/**
 * Sistema de mentira: /login (usuário "robo", senha "certa"), /pedidos (exige a sessão e mostra
 * quem está logado) e /copiloto/sessao, que confere a assinatura do copiloto e devolve o cookie da
 * pessoa, ou um link de entrada única (/entrada) para a pessoa "link".
 */
function pagina(corpo: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ERP</title></head><body>${corpo}</body></html>`;
}
const FORM_LOGIN = (erro = '') =>
  pagina(`<h1>Entrar no ERP</h1>${erro}<form method="post" action="/login">
<label>Usuário <input name="usuario" type="text"></label>
<label>Senha <input name="senha" type="password"></label>
<button>Entrar</button></form>`);

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const html = (status: number, corpo: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extra });
      res.end(corpo);
    };
    if (u.pathname === '/login' && req.method === 'POST') {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const dados = new URLSearchParams(corpo);
        if (dados.get('usuario') === 'robo' && dados.get('senha') === 'certa') {
          res.writeHead(302, { location: '/pedidos', 'set-cookie': 'erp=ok; Path=/; HttpOnly' });
          return res.end();
        }
        html(200, FORM_LOGIN('<div role="alert">Usuário ou senha inválidos.</div>'));
      });
      return;
    }
    if (u.pathname === '/login') return html(200, FORM_LOGIN());
    if (u.pathname === '/copiloto/sessao' && req.method === 'POST') {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const { usuario, ts } = JSON.parse(corpo) as { usuario: string; ts: number };
        const ok = req.headers['x-copiloto-assinatura'] === assinarPedidoSessao(usuario, ts, SEGREDO) && Math.abs(Date.now() - ts) < 300_000;
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
        if (!ok) return res.end('{"erro":"assinatura"}');
        res.end(JSON.stringify(usuario === 'link' ? { url: '/entrada?token=uso-unico' } : { cookies: [{ name: 'erp', value: `ok-${usuario}` }] }));
      });
      return;
    }
    if (u.pathname === '/entrada' && u.searchParams.get('token') === 'uso-unico') {
      res.writeHead(302, { location: '/pedidos', 'set-cookie': 'erp=ok-link; Path=/; HttpOnly' });
      return res.end();
    }
    if (!/erp=ok/.test(req.headers.cookie ?? '')) {
      res.writeHead(302, { location: '/login' });
      return res.end();
    }
    const quem = /erp=ok-([\w-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'robo';
    if (u.pathname === '/pedidos') {
      return html(200, pagina(`<h1>Pedidos</h1><p>Total em aberto: <span data-campo="total">42</span></p><p>Logado: <span data-campo="quem">${quem}</span></p>`));
    }
    html(404, pagina('<h1>Não encontrado</h1>'));
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

function adaptadorEm(acesso: ConstructorParameters<typeof AdaptadorTela>[1]['acesso'], banco: Banco, segredo = SEGREDO) {
  return new AdaptadorTela(banco, { nome: 'ERP', urlBase: url, perfis: [], acesso, senha: () => 'certa', segredo: () => segredo });
}

async function rodar(adaptador: AdaptadorTela, banco: Banco, usuarioId: string) {
  const navegador = new NavegadorPlaywright(
    { config: { ...lerConfig(), dirDados: pastaTemporaria(), navegadorVisivel: false }, banco, adaptador, llm: new LlmSimulado() },
    { tempoElementoMs: 2_000, tempoNavegacaoMs: 10_000 },
  );
  const eventos: EventoNavegador[] = [];
  try {
    const r = await navegador.executar({
      execucaoId: 'EX-1',
      fluxo: fluxoPedidos(),
      valores: {},
      usuarioId,
      confiancaMinima: 0.8,
      mascararPrints: false,
      aoEvento: (e) => eventos.push(e),
      sinal: new AbortController().signal,
    });
    return { r, eventos };
  } finally {
    await navegador.fechar();
  }
}

function fluxoPedidos(): Fluxo {
  return {
    id: 'flx_pedidos',
    nome: 'Ler pedidos em aberto',
    tarefaId: null,
    etapa: 'publicar',
    status: 'publicado',
    versao: 1,
    passos: [
      { n: 1, tipo: 'navegar', titulo: 'Abrir pedidos', url: '/pedidos', seletores: [], seletorEscolhido: 0 },
      {
        n: 2,
        tipo: 'leitura',
        titulo: 'Ler o total em aberto',
        rotuloElemento: 'Total em aberto',
        seletores: [{ seletor: '[data-campo="total"]', estabilidade: 'estavel', motivo: 'marca' }],
        seletorEscolhido: 0,
        gera: 'total',
      },
      {
        n: 3,
        tipo: 'leitura',
        titulo: 'Ler quem está logado',
        rotuloElemento: 'Logado',
        seletores: [{ seletor: '[data-campo="quem"]', estabilidade: 'estavel', motivo: 'marca' }],
        seletorEscolhido: 0,
        gera: 'quem',
      },
    ],
    camposSugeridos: [],
    gravadoPor: null,
    gravadoEm: null,
    duracaoGravacaoMs: null,
    urlInicial: '/pedidos',
    salvoEm: new Date().toISOString(),
  };
}

describe('conta de serviço (Chromium)', { timeout: 60_000 }, () => {
  it('entra com a conta antes do fluxo e roda os passos já logado', async () => {
    const banco = new Banco(':memory:', MIGRACOES);
    try {
      const { r, eventos } = await rodar(adaptadorEm({ modo: 'conta', urlSessao: '', urlLogin: '/login', usuario: 'robo' }, banco), banco, 'u-1');
      expect(r).toMatchObject({ ok: true, gerados: { total: '42', quem: 'robo' } });
      expect(eventos[0]).toMatchObject({ tipo: 'login', titulo: 'Entrou no ERP com a conta do copiloto' });
      expect(eventos[0].detalhe).toContain('robo');
    } finally {
      banco.fechar();
    }
  });

  it('com a sessão de quem pede: o sistema confere a assinatura e entrega o cookie ou um link de entrada', async () => {
    const banco = new Banco(':memory:', MIGRACOES);
    const acesso = { modo: 'sessao' as const, urlSessao: '/copiloto/sessao', urlLogin: '', usuario: '' };
    try {
      // A pessoa chegou antes pelo widget (snippet assinado): o copiloto sabe o nome dela.
      await adaptadorEm(acesso, banco).aprenderUsuario({ id: 'u-9', nome: 'Joana Prado', email: '', perfis: [] });
      const comCookie = await rodar(adaptadorEm(acesso, banco), banco, 'u-9');
      expect(comCookie.r).toMatchObject({ ok: true, gerados: { quem: 'u-9' } });
      expect(comCookie.eventos[0]).toMatchObject({ tipo: 'login', titulo: 'Entrou no ERP com a sessão de Joana Prado' });

      const comLink = await rodar(adaptadorEm(acesso, banco), banco, 'link');
      expect(comLink.r).toMatchObject({ ok: true, gerados: { quem: 'link' } });

      // Assinatura com outro segredo: o sistema recusa e nada roda.
      const recusado = await rodar(adaptadorEm(acesso, banco, 'outro-segredo'), banco, 'u-9');
      expect(recusado.r).toMatchObject({ ok: false, motivo: 'sessao_expirada' });
      expect(!recusado.r.ok && recusado.r.mensagem).toBe('O ERP recusou o pedido de sessão (erro 401). Nada foi feito no sistema.');
      // Sem endereço de sessão, a mensagem diz onde configurar.
      const semEndereco = await rodar(adaptadorEm({ ...acesso, urlSessao: '' }, banco), banco, 'u-9');
      expect(!semEndereco.r.ok && semEndereco.r.mensagem).toContain('Configure em Sistema, no console.');
    } finally {
      banco.fechar();
    }
  });

  it('"Testar acesso" no console: entra com a senha certa e explica quando o sistema recusa', async () => {
    amb = await criarAmbiente({ dirDados: pastaTemporaria() });
    const r = await amb.app.inject({
      method: 'POST',
      url: '/api/console/auth/cadastro',
      payload: {
        empresa: { nome: 'Pedra Branca' },
        pessoa: { nome: 'Luana Freitas', email: 'luana@pedrabranca.com.br', senha: 'senha-forte-1' },
        aceites: { termos: true, dados: true },
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Eu>().empresa.nome).toBe('Pedra Branca');
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    const confirmado = await amb.app.inject({
      method: 'POST',
      url: '/api/console/auth/email/confirmar',
      headers: { cookie },
      payload: { codigo: codigoEnviado(amb, 'luana@pedrabranca.com.br') },
    });
    expect(confirmado.statusCode, confirmado.body).toBe(200);
    const pedir = (metodo: 'POST' | 'PUT', caminho: string, payload?: object) =>
      amb!.app.inject({ method: metodo, url: `/api/console${caminho}`, headers: { cookie }, payload });
    const salvar = (senha: string) =>
      pedir('PUT', '/sistema/config', { nome: 'ERP', url, acesso: { modo: 'conta', urlSessao: '', urlLogin: '/login', usuario: 'robo', senha }, perfis: [] });

    expect((await salvar('errada')).statusCode).toBe(200);
    const recusado = (await pedir('POST', '/sistema/testar-acesso')).json();
    expect(recusado.ok).toBe(false);
    expect(recusado.detalhe).toContain('não aceitou a conta do copiloto (robo)');
    expect(recusado.detalhe).toContain('Usuário ou senha inválidos.');

    expect((await salvar('certa')).statusCode).toBe(200);
    const aceito = (await pedir('POST', '/sistema/testar-acesso')).json();
    expect(aceito).toMatchObject({ ok: true });
    expect(aceito.detalhe).toContain('Entrou no ERP como robo');
    expect(aceito.detalhe).toContain('/pedidos');
  });
});

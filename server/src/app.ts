// Servidor HTTP (Fastify): API do widget, API do console, gravador de fluxos e arquivos estáticos.
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import estatico from '@fastify/static';
import type { ErroApi } from '@copiloto/shared';
import { RAIZ_REPO } from './config.ts';
import type { Contexto } from './contexto.ts';
import { ErroHttp } from './util/erros.ts';
import { codigoRef } from './util/ids.ts';
import rotasWidget from './rotas/widget.ts';
import rotasGravacao from './rotas/gravacao.ts';
import rotasConsole from './rotas/console/index.ts';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Contexto;
  }
}

export interface OpcoesApp {
  logger?: boolean;
}

export async function criarApp(ctx: Contexto, opcoes: OpcoesApp = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opcoes.logger ? { level: 'info', transport: undefined } : false,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });
  app.decorate('ctx', ctx);
  // Ao fechar: para vigias de "sistema voltou" e execuções em segundo plano.
  app.addHook('onClose', async () => {
    ctx.motor.parar();
  });

  // JSON vazio vira {} (ex.: POST /confirmar com content-type e sem corpo).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, corpo, pronto) => {
    const texto = String(corpo ?? '').trim();
    if (!texto) return pronto(null, {});
    try {
      pronto(null, JSON.parse(texto));
    } catch {
      pronto(new ErroHttp(400, 'json_invalido', 'O corpo da requisição não é um JSON válido.'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 5 } });
  // O widget roda dentro do sistema anfitrião (outra origem). Só domínios liberados no console.
  await app.register(cors, {
    origin: (origem, cb) => cb(null, origemPermitida(ctx, origem)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof ErroHttp) {
      const corpo: ErroApi = { erro: erro.codigo, mensagem: erro.message };
      return reply.status(erro.status).send(corpo);
    }
    const e = erro as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)) {
      const corpo: ErroApi = { erro: 'pedido_invalido', mensagem: 'Os dados enviados estão incompletos ou em formato inválido.' };
      return reply.status(e.statusCode ?? 400).send(corpo);
    }
    const ref = codigoRef();
    request.log.error({ err: erro, ref }, 'erro inesperado');
    if (!opcoes.logger) console.error(`[${ref}]`, erro);
    const corpo: ErroApi = {
      erro: 'erro_interno',
      mensagem: 'Algo deu errado do nosso lado. Tente de novo; se continuar, informe o código ao suporte.',
      ref,
    };
    return reply.status(500).send(corpo);
  });

  app.get('/api/saude', async () => ({
    ok: true,
    modoSimulado: ctx.llm.simulado,
    sistema: ctx.adaptador.nome,
  }));

  await app.register(rotasWidget, { prefix: '/api/widget' });
  await app.register(rotasGravacao, { prefix: '/api/gravacao' });
  await app.register(rotasConsole, { prefix: '/api/console' });

  // copiloto.js (script do widget). Em dev, `npm run dev` recompila widget/dist a cada mudança.
  const distWidget = path.join(RAIZ_REPO, 'widget', 'dist');
  app.get('/copiloto.js', async (_req, reply) => {
    const arquivo = path.join(distWidget, 'copiloto.js');
    if (!fs.existsSync(arquivo)) {
      return reply
        .status(503)
        .type('application/javascript')
        .send('console.warn("Copiloto: o widget ainda está sendo compilado. Recarregue em alguns segundos.");');
    }
    return reply
      .header('cache-control', 'no-cache')
      .type('application/javascript')
      .send(fs.createReadStream(arquivo));
  });

  // Console compilado (produção). Em dev o console roda no Vite (porta 5173) com proxy para cá.
  const distConsole = path.join(RAIZ_REPO, 'console', 'dist');
  if (fs.existsSync(path.join(distConsole, 'index.html'))) {
    await app.register(estatico, { root: distConsole, prefix: '/', wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.type('text/html').send(fs.createReadStream(path.join(distConsole, 'index.html')));
      }
      const corpo: ErroApi = { erro: 'nao_encontrado', mensagem: 'Endereço não encontrado.' };
      return reply.status(404).send(corpo);
    });
  } else {
    app.setNotFoundHandler((_request, reply) => {
      const corpo: ErroApi = { erro: 'nao_encontrado', mensagem: 'Endereço não encontrado.' };
      return reply.status(404).send(corpo);
    });
  }

  return app;
}

function origemPermitida(ctx: Contexto, origem: string | undefined): boolean {
  if (!origem) return true;
  let host: string;
  try {
    host = new URL(origem).host;
  } catch {
    return false;
  }
  if (host.startsWith('localhost:') || host.startsWith('127.0.0.1:') || host === 'localhost') return true;
  const { dominios } = ctx.configuracoes.ler('widget_publicado');
  return dominios.some((d) => d === host || d === new URL(origem).hostname);
}

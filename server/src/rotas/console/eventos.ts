// SSE do console: avisa telas abertas quando algo muda (execução, conversa, fonte, fluxo).
import type { FastifyPluginAsync } from 'fastify';
import { exigir } from '../../auth/console.ts';
import { ctxDe } from '../../contexto.ts';

const rotas: FastifyPluginAsync = async (app) => {
  app.get('/eventos', { preHandler: exigir('ver') }, async (request, reply) => {
    const ctx = ctxDe(request);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': conectado\n\n');
    const parar = ctx.eventos.ouvirConsole((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const batimento = setInterval(() => res.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(batimento);
      parar();
    });
  });
};

export default rotas;

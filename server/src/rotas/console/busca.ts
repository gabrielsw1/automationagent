// Busca global do console: GET /busca?q=. A busca em si fica em server/src/tarefas/busca.ts.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../auth/console.ts';
import { buscarNoConsole, type ResultadoBusca } from '../../tarefas/busca.ts';

const Consulta = z.object({ q: z.string().max(120).default('') });

const rotas: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: exigir('ver') }, async (request): Promise<{ itens: ResultadoBusca[] }> => {
    const r = Consulta.safeParse(request.query ?? {});
    const q = r.success ? r.data.q.trim() : '';
    return { itens: q.length >= 2 ? buscarNoConsole(app.ctx, q) : [] };
  });
};

export default rotas;

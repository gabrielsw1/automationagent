// Painel (C1): GET /painel?periodo=7d|30d|mes. A agregação fica em server/src/tarefas/painel.ts.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Painel } from '@copiloto/shared';
import { exigir } from '../../auth/console.ts';
import { montarPainel } from '../../tarefas/painel.ts';
import { pedidoInvalido } from '../../util/erros.ts';

const Consulta = z.object({ periodo: z.enum(['7d', '30d', 'mes']).default('30d') });

const rotas: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: exigir('ver') }, async (request): Promise<Painel> => {
    const r = Consulta.safeParse(request.query ?? {});
    if (!r.success) throw pedidoInvalido('Escolha o período: 7 dias, 30 dias ou mês atual.');
    return montarPainel(app.ctx, r.data.periodo);
  });
};

export default rotas;

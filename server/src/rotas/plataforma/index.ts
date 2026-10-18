// Rotas da Plataforma Starta em /api/plataforma. A sessão (cookie próprio, separado do console das
// empresas) é lida aqui; cada rota de dados exige a sessão completa (senha e código).
import type { FastifyPluginAsync } from 'fastify';
import { lerSessaoStarta } from '../../auth/starta.ts';
import auth from './auth.ts';
import empresas from './empresas.ts';
import equipe from './equipe.ts';
import faturas from './faturas.ts';
import painel from './painel.ts';

const rotas: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    const sessao = lerSessaoStarta(app.plataforma, request);
    if (sessao) request.sessaoStarta = sessao;
  });

  await app.register(auth, { prefix: '/auth' });
  await app.register(empresas, { prefix: '/empresas' });
  await app.register(faturas, { prefix: '/empresas' });
  await app.register(equipe, { prefix: '/equipe' });
  await app.register(painel);
};

export default rotas;

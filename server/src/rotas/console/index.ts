// Todas as rotas do console ficam em /api/console. A sessão é lida aqui: ela diz a empresa aberta
// (request.ctx) e o membro da equipe dela (request.membro). Cada rota exige a permissão certa com
// `preHandler: exigir('ver' | 'operar' | 'editar' | 'administrar')` e usa só `ctxDe(request)`.
import type { FastifyPluginAsync } from 'fastify';
import { COOKIE_SESSAO, lerSessaoConsole } from '../../auth/console.ts';
import auth from './auth.ts';
import busca from './busca.ts';
import canais from './canais.ts';
import conhecimento from './conhecimento.ts';
import equipe from './equipe.ts';
import eventos from './eventos.ts';
import execucoes from './execucoes.ts';
import fluxos from './fluxos.ts';
import guia from './guia.ts';
import painel from './painel.ts';
import prints from './prints.ts';
import resumo from './resumo.ts';
import sistema from './sistema.ts';
import tarefas from './tarefas.ts';
import teste from './teste.ts';

const rotas: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    const lida = lerSessaoConsole(app.plataforma, request.cookies[COOKIE_SESSAO]);
    if (!lida) return;
    if (lida.sessao) request.sessaoConsole = lida.sessao;
    request.ctx = lida.ctx;
    request.membro = lida.membro;
  });

  await app.register(auth, { prefix: '/auth' });
  await app.register(resumo);
  await app.register(eventos);
  await app.register(sistema, { prefix: '/sistema' });
  await app.register(teste, { prefix: '/teste' });
  await app.register(painel, { prefix: '/painel' });
  await app.register(guia, { prefix: '/guia' });
  await app.register(tarefas, { prefix: '/tarefas' });
  await app.register(execucoes, { prefix: '/execucoes' });
  await app.register(fluxos, { prefix: '/fluxos' });
  await app.register(prints, { prefix: '/prints' });
  await app.register(conhecimento, { prefix: '/conhecimento' });
  await app.register(canais, { prefix: '/canais' });
  await app.register(busca, { prefix: '/busca' });
  await app.register(equipe);
};

export default rotas;

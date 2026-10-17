// "Testar copiloto" e pré-visualizações do console: gera um token de widget em modo de teste
// para um usuário do sistema. No modo de teste nada é gravado no sistema.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../auth/console.ts';
import { criarTokenWidget } from '../../auth/widget.ts';
import { naoEncontrado, pedidoInvalido } from '../../util/erros.ts';

const Pedido = z.object({ usuarioId: z.string().min(1) });

const rotas: FastifyPluginAsync = async (app) => {
  const { adaptador, config } = app.ctx;

  app.post('/token', { preHandler: exigir('ver') }, async (request) => {
    const r = Pedido.safeParse(request.body);
    if (!r.success) throw pedidoInvalido('Escolha um usuário do sistema para simular.');
    const usuario = await adaptador.buscarUsuario(r.data.usuarioId);
    if (!usuario) throw naoEncontrado('Usuário do sistema');
    return {
      token: criarTokenWidget({ u: usuario.id, t: 1 }, config.segredoSessao, 4),
      usuario,
    };
  });
};

export default rotas;

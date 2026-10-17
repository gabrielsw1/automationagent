// Guia de início (C0): os cinco passos calculados a partir do estado real, e a verificação do
// widget instalado ("Já instalei, verificar").
import type { FastifyPluginAsync } from 'fastify';
import type { Guia } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import { calcularGuia } from '../../servicos/guia.ts';
import { ErroHttp } from '../../util/erros.ts';

const rotas: FastifyPluginAsync = async (app) => {
  const { configuracoes, auditoria } = app.ctx;

  app.get('/', { preHandler: exigir('ver') }, async (): Promise<Guia> => calcularGuia(app.ctx));

  app.post('/widget-verificado', { preHandler: exigir('editar') }, async (request): Promise<Guia> => {
    const m = membro(request);
    const instalacao = configuracoes.ler('widget_instalacao');
    if (!instalacao) {
      throw new ErroHttp(
        409,
        'widget_nao_visto',
        `Ainda não vimos o widget no ${app.ctx.adaptador.nome}. Confira se o código está antes do </body>, ` +
          'abra uma página do sistema com alguém logado e tente de novo em alguns segundos.',
      );
    }
    const feitos = configuracoes.ler('guia_feitos');
    if (!feitos.includes('widget')) {
      configuracoes.gravar('guia_feitos', [...feitos, 'widget'], m.nome);
      auditoria.registrar(m.nome, 'confirmou a instalação do widget', instalacao.origem);
    }
    return calcularGuia(app.ctx);
  });
};

export default rotas;

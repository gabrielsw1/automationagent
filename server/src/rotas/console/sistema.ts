// Dados do sistema anfitrião para o console: usuários (pré-visualização "Como Ana Ribeiro"),
// perfis ("Quem pode executar") e rotas da API (ficha da tarefa, "Executar via API").
import type { FastifyPluginAsync } from 'fastify';
import type { UsuarioSistema } from '@copiloto/shared';
import { exigir } from '../../auth/console.ts';
import { ErroHttp } from '../../util/erros.ts';

const rotas: FastifyPluginAsync = async (app) => {
  const { adaptador } = app.ctx;

  const comErro = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      throw new ErroHttp(502, 'sistema_indisponivel', `Não consegui falar com o ${adaptador.nome} agora.`);
    }
  };

  app.get('/usuarios', { preHandler: exigir('ver') }, async (): Promise<UsuarioSistema[]> =>
    comErro(() => adaptador.listarUsuarios()),
  );
  app.get('/perfis', { preHandler: exigir('ver') }, async (): Promise<string[]> =>
    comErro(() => adaptador.listarPerfis()),
  );
  app.get('/rotas', { preHandler: exigir('editar') }, async () => comErro(() => adaptador.descreverApi()));
  app.get('/conexao', { preHandler: exigir('ver') }, async () => ({
    ...(await adaptador.verificarConexao()),
    nome: adaptador.nome,
    url: app.ctx.config.sistema.urlApi,
    urlTelas: adaptador.urlBase,
  }));
};

export default rotas;

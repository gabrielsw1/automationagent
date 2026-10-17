// Servidor do Horizonte, o sistema de exemplo: API REST (/v1), telas HTML com login de
// demonstração e o snippet do copiloto, central de ajuda e o painel da demonstração (/_demo).
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { registrarApi } from './api.ts';
import { ErroHorizonte, Horizonte } from './negocio.ts';
import type { Estado } from './dados/tipos.ts';
import { criarPersistencia } from './persistencia.ts';
import { paginaErro, usuarioLogado, type Ctx } from './telas/comum.ts';
import { CSS, ICONE_SVG } from './telas/estilo.ts';
import { registrarEntrar } from './telas/entrar.ts';
import { registrarClientes } from './telas/clientes.ts';
import { registrarFinanceiro } from './telas/financeiro.ts';
import { registrarAgenda } from './telas/agenda.ts';
import { registrarRelatorios } from './telas/relatorios.ts';
import { registrarChamados } from './telas/chamados.ts';
import { registrarAjuda } from './telas/ajuda.ts';
import { registrarDemo } from './telas/demo.ts';

export const VERSAO = '2.3.1';

export interface OpcoesServidor {
  /** Dados iniciais (e de "Restaurar dados iniciais"). Padrão: dados de exemplo gerados para hoje. */
  estadoInicial?: Estado;
  /** Arquivo para persistir o estado (DATA_DIR/horizonte.json). Sem ele, tudo fica só em memória. */
  arquivoDados?: string | null;
  /** Relógio (os testes fixam a data). */
  agora?: () => Date;
  copilotoUrl?: string;
  copilotoChave?: string;
  widgetSegredo?: string;
  chaveServico?: string;
  /** Segredo do cookie de sessão das telas (padrão: derivado da chave de serviço). */
  segredoSessao?: string;
  /** Endereço público, usado em arquivo_url (padrão: o Host da requisição). */
  urlPublica?: string;
  logger?: FastifyServerOptions['logger'];
}

declare module 'fastify' {
  interface FastifyInstance {
    horizonte: Horizonte;
  }
}

export function criarServidor(opcoes: OpcoesServidor = {}): FastifyInstance {
  const agora = opcoes.agora ?? (() => new Date());
  const persistencia = opcoes.arquivoDados ? criarPersistencia(opcoes.arquivoDados) : null;
  const hz = new Horizonte({
    agora,
    estadoInicial: opcoes.estadoInicial,
    estadoAtual: persistencia?.carregar() ?? undefined,
    aoAlterar: persistencia ? (e) => persistencia.salvar(e) : undefined,
  });
  const chaveServico = opcoes.chaveServico ?? 'chave-servico-local';
  const ctx: Ctx = {
    hz,
    cfg: {
      copilotoUrl: opcoes.copilotoUrl ?? 'http://localhost:3000',
      copilotoChave: opcoes.copilotoChave ?? 'pk_local_horizonte',
      widgetSegredo: opcoes.widgetSegredo ?? 'segredo-widget-local',
      segredoSessao: opcoes.segredoSessao ?? `horizonte-sessao:${chaveServico}`,
    },
  };

  const app = Fastify({ logger: opcoes.logger ?? false });
  app.decorate('horizonte', hz);

  // JSON vazio vale como {} (DELETE com content-type: application/json, por exemplo).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, corpo, feito) => {
    const texto = String(corpo ?? '').trim();
    if (!texto) return feito(null, {});
    try {
      feito(null, JSON.parse(texto));
    } catch {
      feito(new ErroHorizonte(400, 'json_invalido', 'O corpo da requisição não é um JSON válido.'), undefined);
    }
  });

  app.register(cookie);
  app.register(formbody);

  app.register(async (instancia) => {
    registrarApi(instancia, { hz, chaveServico, segredoSessao: ctx.cfg.segredoSessao, versao: VERSAO, urlPublica: opcoes.urlPublica });
    registrarEntrar(instancia, ctx);
    registrarClientes(instancia, ctx);
    registrarFinanceiro(instancia, ctx);
    registrarAgenda(instancia, ctx);
    registrarRelatorios(instancia, ctx);
    registrarChamados(instancia, ctx);
    registrarAjuda(instancia, ctx);
    registrarDemo(instancia, ctx);

    instancia.get('/estatico/horizonte.css', async (_req, reply) =>
      reply.type('text/css; charset=utf-8').header('cache-control', 'public, max-age=300').send(CSS),
    );
    instancia.get('/estatico/icone.svg', async (_req, reply) =>
      reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400').send(ICONE_SVG),
    );
    instancia.get('/favicon.ico', async (_req, reply) => reply.redirect('/estatico/icone.svg', 301));
  });

  const ehApi = (url: string) => url === '/v1' || url.startsWith('/v1/') || url.startsWith('/v1?');

  app.setNotFoundHandler((req, reply) => {
    if (ehApi(req.url) || req.url.startsWith('/_demo/')) {
      return reply.status(404).send({ erro: 'nao_encontrado', mensagem: `Rota não encontrada: ${req.method} ${req.url.split('?')[0]}` });
    }
    return paginaErro(reply, ctx, usuarioLogado(req, ctx), 404, 'Página não encontrada', 'O endereço não existe no Horizonte.');
  });

  app.setErrorHandler((erro: FastifyError | ErroHorizonte, req, reply) => {
    const api = ehApi(req.url) || req.url.startsWith('/_demo/');
    if (erro instanceof ErroHorizonte) {
      if (api) return reply.status(erro.status).send(erro.corpo());
      return paginaErro(reply, ctx, usuarioLogado(req, ctx), erro.status, 'Não foi possível continuar', erro.message);
    }
    const status = erro.statusCode && erro.statusCode >= 400 && erro.statusCode < 500 ? erro.statusCode : 500;
    if (status >= 500) req.log.error(erro);
    if (api) {
      return reply.status(status).send(
        status === 500
          ? { erro: 'erro_interno', mensagem: 'Erro inesperado no Horizonte. Tente de novo em instantes.' }
          : { erro: 'requisicao_invalida', mensagem: 'Requisição inválida. Confira o corpo e os cabeçalhos enviados.' },
      );
    }
    return paginaErro(
      reply,
      ctx,
      usuarioLogado(req, ctx),
      status,
      status === 500 ? 'Erro inesperado' : 'Requisição inválida',
      status === 500 ? 'Algo deu errado no Horizonte. Tente de novo em instantes.' : 'Confira os dados enviados e tente de novo.',
    );
  });

  app.addHook('onClose', async () => persistencia?.descarregar());

  return app;
}

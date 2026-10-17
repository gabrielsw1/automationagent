// Monta todas as peças de uma empresa (banco, agente, motor, navegador...) e entrega às rotas
// (request.ctx). Cada empresa tem o próprio contexto; quem cria é a plataforma (plataforma/index.ts).
import type { Config } from './config.ts';
import { AdaptadorDaEmpresa, criarAdaptador, type AdaptadorSistema } from './adaptadores/index.ts';
import { Agente } from './agente/agente.ts';
import { Conhecimento, type BaseConhecimento } from './conhecimento/index.ts';
import { Banco } from './db/banco.ts';
import { Eventos } from './eventos.ts';
import { Motor } from './execucao/motor.ts';
import { criarLlm, type Llm } from './llm/index.ts';
import { criarNavegador, type Navegador } from './navegador/index.ts';
import { Atendimento } from './servicos/atendimento.ts';
import { Auditoria } from './servicos/auditoria.ts';
import { Catalogo } from './servicos/catalogo.ts';
import { Configuracoes } from './servicos/configuracoes.ts';
import { Conversas } from './servicos/conversas.ts';
import { Gastos } from './servicos/gastos.ts';
import { esquecerConexao } from './servicos/guia.ts';
import type { Empresa, Plataforma } from './plataforma/index.ts';
import type { FastifyRequest } from 'fastify';
import { ErroHttp } from './util/erros.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Contexto da empresa do pedido (sessão do console, token do widget ou token de gravação). */
    ctx?: Contexto;
  }
}

/** Contexto da empresa do pedido, ou 401 se o pedido não disse de qual empresa é. */
export function ctxDe(request: FastifyRequest): Contexto {
  if (!request.ctx) throw new ErroHttp(401, 'nao_autenticado', 'Sua sessão expirou. Entre de novo.');
  return request.ctx;
}

export interface Contexto {
  /** Config do servidor com o que é da empresa: pasta de dados, sistema e segredo do widget. */
  config: Config;
  /** A empresa dona deste contexto. */
  empresa: Empresa;
  plataforma: Plataforma;
  banco: Banco;
  eventos: Eventos;
  llm: Llm;
  adaptador: AdaptadorDaEmpresa;
  configuracoes: Configuracoes;
  auditoria: Auditoria;
  gastos: Gastos;
  conversas: Conversas;
  catalogo: Catalogo;
  conhecimento: BaseConhecimento;
  navegador: Navegador;
  motor: Motor;
  agente: Agente;
  atendimento: Atendimento;
}

export interface OpcoesContexto {
  arquivoBanco: string;
  empresa: Empresa;
  plataforma: Plataforma;
  /** Troca o modelo (ex.: simulado com regras próprias nos testes). */
  llm?: Llm;
  adaptador?: AdaptadorSistema;
  navegador?: Navegador;
}

function adaptadorReal(config: Config, banco: Banco, empresa: Empresa, plataforma: Plataforma): AdaptadorSistema {
  return criarAdaptador({
    config,
    banco,
    perfis: empresa.sistema.perfis,
    acesso: empresa.sistema.acesso,
    senhaAcesso: () => plataforma.senhaAcesso(empresa.id),
    segredoWidget: () => config.segredoWidget,
  });
}

export function criarContexto(config: Config, opcoes: OpcoesContexto): Contexto {
  const { empresa, plataforma } = opcoes;
  const banco = new Banco(opcoes.arquivoBanco);
  const eventos = new Eventos();
  let host: string | null = null;
  try {
    host = new URL(config.sistema.urlBase).host || null;
  } catch {
    host = null;
  }
  const configuracoes = new Configuracoes(banco, {
    nomeSistema: config.sistema.nome,
    dominiosPadrao: host ? [host] : [],
    chavePublicaPadrao: empresa.chavePublica,
    demo: empresa.demo,
  });
  const gastos = new Gastos(banco, config, configuracoes);
  const llm = opcoes.llm ?? criarLlm(config, gastos.registrarUso);
  const adaptador = opcoes.adaptador
    ? new AdaptadorDaEmpresa(opcoes.adaptador, true)
    : new AdaptadorDaEmpresa(adaptadorReal(config, banco, empresa, plataforma));
  const auditoria = new Auditoria(banco);
  const conversas = new Conversas(banco, eventos);
  const catalogo = new Catalogo(banco);
  const conhecimento = new Conhecimento(banco, llm, { eventos, dirDados: config.dirDados });
  const navegador = opcoes.navegador ?? criarNavegador({ config, banco, adaptador, llm });

  const parcial = {
    config,
    empresa,
    plataforma,
    banco,
    eventos,
    llm,
    adaptador,
    configuracoes,
    auditoria,
    gastos,
    conversas,
    catalogo,
    conhecimento,
    navegador,
  };
  const ctx = parcial as unknown as Contexto;
  ctx.motor = new Motor(ctx);
  ctx.atendimento = new Atendimento(ctx);
  ctx.agente = new Agente(ctx);
  return ctx;
}

/** O admin mudou o sistema da empresa no console: endereço, conta de serviço ou perfis. */
export function trocarSistema(ctx: Contexto, empresa: Empresa, plataforma: Plataforma) {
  ctx.empresa = empresa;
  ctx.config.sistema = plataforma.configDaEmpresa(empresa, ctx.config.dirDados).sistema;
  ctx.adaptador.trocar(adaptadorReal(ctx.config, ctx.banco, empresa, plataforma));
  esquecerConexao(ctx);
}

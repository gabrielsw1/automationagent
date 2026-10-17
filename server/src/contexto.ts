// Monta todas as peças do servidor uma vez e entrega às rotas (app.ctx).
import type { Config } from './config.ts';
import { criarAdaptador, type AdaptadorSistema } from './adaptadores/index.ts';
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
import path from 'node:path';

export interface Contexto {
  config: Config;
  banco: Banco;
  eventos: Eventos;
  llm: Llm;
  adaptador: AdaptadorSistema;
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
  /** Troca o banco (ex.: ':memory:' nos testes). */
  arquivoBanco?: string;
  /** Troca o modelo (ex.: simulado com regras próprias nos testes). */
  llm?: Llm;
  adaptador?: AdaptadorSistema;
  navegador?: Navegador;
}

export function criarContexto(config: Config, opcoes: OpcoesContexto = {}): Contexto {
  const banco = new Banco(opcoes.arquivoBanco ?? path.join(config.dirDados, 'copiloto.db'));
  const eventos = new Eventos();
  const configuracoes = new Configuracoes(banco, {
    nomeSistema: config.sistema.nome,
    dominiosPadrao: [new URL(config.sistema.urlBase).host],
    chavePublicaPadrao: process.env.WIDGET_CHAVE_PUBLICA || 'pk_local_horizonte',
  });
  const gastos = new Gastos(banco, config, configuracoes);
  const llm = opcoes.llm ?? criarLlm(config, gastos.registrarUso);
  const adaptador = opcoes.adaptador ?? criarAdaptador(config);
  const auditoria = new Auditoria(banco);
  const conversas = new Conversas(banco, eventos);
  const catalogo = new Catalogo(banco);
  const conhecimento = new Conhecimento(banco, llm, { eventos, dirDados: config.dirDados });
  const navegador = opcoes.navegador ?? criarNavegador({ config, banco, adaptador, llm });

  const parcial = {
    config,
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

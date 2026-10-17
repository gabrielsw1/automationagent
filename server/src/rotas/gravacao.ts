// Gravador de fluxos (/api/gravacao/:token). Quem chama é o widget, na aba do sistema que o
// console abriu com ?copiloto_gravacao=<token>. Não há sessão do console: o token é o segredo
// e só vale enquanto o fluxo está em gravação. Nunca chegam valores digitados, só o formato.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { EventoGravado, GravacaoEstado } from '@copiloto/shared';
import { aprenderFluxo, converterPorRegras } from '../navegador/aprender.ts';
import { Fluxos, type LinhaFluxo } from '../navegador/fluxos.ts';
import { agoraIso } from '../db/banco.ts';
import { ErroHttp, pedidoInvalido } from '../util/erros.ts';
import type { Contexto } from '../contexto.ts';

const MAX_EVENTOS = 2_000;

const ElementoGravado = z.object({
  tag: z.string().min(1).max(40),
  id: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  type: z.string().max(40).optional(),
  role: z.string().max(40).optional(),
  texto: z.string().max(500).optional(),
  rotulo: z.string().max(300).optional(),
  placeholder: z.string().max(300).optional(),
  ariaLabel: z.string().max(300).optional(),
  testId: z.string().max(200).optional(),
  href: z.string().max(2000).optional(),
  css: z.string().max(2000),
  contexto: z.string().max(6000).optional(),
});

const Evento = z.object({
  tipo: z.enum(['navegar', 'clique', 'preencher', 'selecionar', 'download', 'leitura']),
  ts: z.number(),
  url: z.string().max(4000),
  tituloPagina: z.string().max(300).optional(),
  elemento: ElementoGravado.optional(),
  // Só o formato: dígitos viram 9 e letras viram a. Qualquer outra coisa é descartada abaixo.
  formatoValor: z.string().max(300).optional(),
  opcaoTexto: z.string().max(300).optional(),
});

const PedidoEventos = z.object({ eventos: z.array(Evento).max(500) });

/** Garante que nenhum valor digitado fique guardado: o formato só pode ter 9, a e pontuação. */
function semValores(e: EventoGravado): EventoGravado {
  const limpo: EventoGravado = { ...e };
  if (limpo.formatoValor !== undefined) {
    limpo.formatoValor = limpo.formatoValor.replace(/\d/g, '9').replace(/\p{L}/gu, 'a');
  }
  if (limpo.elemento?.contexto) {
    // O HTML de contexto não pode levar o que foi digitado (value="..." de campos de texto).
    limpo.elemento = {
      ...limpo.elemento,
      contexto: limpo.elemento.contexto.replace(/\svalue=(["'])(.*?)\1/gi, (m, aspas, v, offset, todo) => {
        const antes = todo.slice(Math.max(0, todo.lastIndexOf('<', offset)), offset);
        return /^<option\b/i.test(antes) ? m : ` value=${aspas}${aspas}`;
      }),
    };
  }
  return limpo;
}

export function estadoGravacao(f: LinhaFluxo): GravacaoEstado {
  return { fluxoId: f.id, nome: f.nome, ativa: f.status === 'gravando', passos: f.passos.length };
}

/**
 * Termina a gravação: passos por regras na hora e, em segundo plano, o Claude organiza os
 * passos e sugere os campos (só aplica se ninguém mexeu no fluxo enquanto isso).
 */
export function concluirGravacao(ctx: Contexto, fluxo: LinhaFluxo): LinhaFluxo {
  const fluxos = new Fluxos(ctx.banco);
  const eventos = fluxo.eventosGravados;
  const camposTarefa = camposDaTarefa(ctx, fluxo.tarefaId);
  const { passos, camposSugeridos } = converterPorRegras(eventos, camposTarefa);
  const tempos = eventos.map((e) => e.ts).filter((t) => Number.isFinite(t));
  const duracao = tempos.length > 1 ? Math.max(...tempos) - Math.min(...tempos) : null;
  const atualizado = fluxos.atualizar(fluxo.id, {
    status: 'rascunho',
    etapa: 'revisar',
    passos,
    campos_sugeridos: camposSugeridos,
    gravado_em: agoraIso(),
    duracao_gravacao_ms: duracao,
  });
  ctx.auditoria.registrar(fluxo.gravadoPor ?? 'Gravador', 'concluiu a gravação do fluxo', fluxo.nome, `${passos.length} passos`);
  ctx.eventos.emitirConsole({ tipo: 'fluxo', fluxoId: fluxo.id, etapa: 'revisar', passos: passos.length });
  if (eventos.length > 0) void aprenderEmSegundoPlano(ctx, atualizado);
  return atualizado;
}

async function aprenderEmSegundoPlano(ctx: Contexto, fluxo: LinhaFluxo) {
  try {
    const r = await aprenderFluxo(ctx.llm, fluxo.eventosGravados, camposDaTarefa(ctx, fluxo.tarefaId));
    const fluxos = new Fluxos(ctx.banco);
    const agora = fluxos.obter(fluxo.id);
    if (!agora || agora.salvoEm !== fluxo.salvoEm || agora.status !== 'rascunho') return;
    fluxos.atualizar(fluxo.id, { passos: r.passos, campos_sugeridos: r.camposSugeridos });
    ctx.eventos.emitirConsole({ tipo: 'fluxo', fluxoId: fluxo.id, etapa: 'revisar', passos: r.passos.length });
  } catch {
    // Sem o Claude agora: os passos por regras continuam valendo; o console pode pedir de novo.
  }
}

/** Campos da tarefa ligada ao fluxo (rascunho, senão publicada). */
export function camposDaTarefa(ctx: Contexto, tarefaId: string | null) {
  if (!tarefaId) return [];
  const v = ctx.catalogo.rascunho(tarefaId) ?? ctx.catalogo.publicada(tarefaId);
  return v?.definicao.campos ?? [];
}

const rotas: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const fluxos = new Fluxos(ctx.banco);

  const doToken = (token: string): LinhaFluxo => {
    const f = fluxos.porToken(token);
    if (!f) throw new ErroHttp(404, 'gravacao_nao_encontrada', 'Esta gravação não existe mais. Comece uma nova pelo console.');
    return f;
  };
  const ativa = (f: LinhaFluxo) => {
    if (f.status !== 'gravando') throw new ErroHttp(409, 'gravacao_encerrada', 'Esta gravação já terminou. Comece uma nova pelo console.');
  };

  app.get<{ Params: { token: string } }>('/:token', async (request): Promise<GravacaoEstado> => {
    return estadoGravacao(doToken(request.params.token));
  });

  app.post<{ Params: { token: string } }>('/:token/eventos', async (request) => {
    const f = doToken(request.params.token);
    ativa(f);
    const r = PedidoEventos.safeParse(request.body);
    if (!r.success) throw pedidoInvalido('Os eventos da gravação vieram em formato inválido.');
    if (f.eventosGravados.length + r.data.eventos.length > MAX_EVENTOS) {
      throw new ErroHttp(413, 'gravacao_longa', 'A gravação ficou longa demais. Conclua e grave o restante em outro fluxo.');
    }
    const novos = (r.data.eventos as EventoGravado[]).map(semValores);
    const todos = [...f.eventosGravados, ...novos];
    const { passos } = converterPorRegras(todos, camposDaTarefa(ctx, f.tarefaId));
    fluxos.acrescentarEventos(f.id, novos, passos);
    ctx.eventos.emitirConsole({ tipo: 'fluxo', fluxoId: f.id, etapa: 'gravar', passos: passos.length });
    return { passos: passos.length };
  });

  app.post<{ Params: { token: string } }>('/:token/concluir', async (request) => {
    const f = doToken(request.params.token);
    ativa(f);
    const atualizado = concluirGravacao(ctx, f);
    return { ok: true, fluxoId: atualizado.id };
  });

  app.post<{ Params: { token: string } }>('/:token/cancelar', async (request) => {
    const f = doToken(request.params.token);
    ativa(f);
    fluxos.atualizar(f.id, { status: 'rascunho', etapa: 'gravar', eventos_gravados: [], passos: [] });
    ctx.auditoria.registrar(f.gravadoPor ?? 'Gravador', 'cancelou a gravação do fluxo', f.nome);
    ctx.eventos.emitirConsole({ tipo: 'fluxo', fluxoId: f.id, etapa: 'gravar', passos: 0 });
    return { ok: true };
  });
};

export default rotas;

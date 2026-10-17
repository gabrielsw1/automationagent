// Execuções (C5, C6): lista com filtros, CSV, detalhe e ações do suporte sobre uma execução.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ExecucaoDetalhe, ListaExecucoes } from '@copiloto/shared';
import { exigir, membro, type MembroLogado } from '../../auth/console.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import type { Ator } from '../../execucao/motor.ts';
import { conflito, naoEncontrado, pedidoInvalido } from '../../util/erros.ts';
import { csv, lerFiltros, listar, tarefasDoFiltro, type LinhaExecucao } from './execucoes/consulta.ts';
import {
  acoesPossiveis,
  buscarExecucao,
  definicaoDaExecucao,
  estadoDaConversa,
  montarDetalhe,
} from './execucoes/detalhe.ts';

const Texto = z.object({
  texto: z.string().trim().min(1, 'Escreva a mensagem antes de enviar.').max(2000, 'A mensagem pode ter até 2.000 caracteres.'),
});
const Nota = z.object({ nota: z.string().trim().max(1000, 'A nota pode ter até 1.000 caracteres.').optional() });
const Decisao = z.object({
  aprovado: z.boolean({ error: 'Diga se aprova ou recusa.' }),
  motivo: z.string().trim().max(500, 'O motivo pode ter até 500 caracteres.').optional(),
});

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

function ator(m: MembroLogado): Ator {
  return { tipo: 'membro', id: m.id, nome: m.nome };
}

type ComId = { Params: { id: string } };

const rotas: FastifyPluginAsync = async (app) => {
  const execucao = (ctx: Contexto, id: string): LinhaExecucao => {
    const r = buscarExecucao(ctx, id);
    if (!r) throw naoEncontrado('Execução');
    return r;
  };

  const conversaDe = (r: LinhaExecucao): string => {
    if (!r.conversa_id) throw conflito('Esta execução não tem conversa no widget.');
    return r.conversa_id;
  };

  app.get('/', { preHandler: exigir('ver') }, async (request): Promise<ListaExecucoes> => {
    const ctx = ctxDe(request);
    return listar(ctx, lerFiltros(request.query));
  });

  /** Opções do filtro "Tarefa". */
  app.get('/filtros', { preHandler: exigir('ver') }, async (request) => {
    const ctx = ctxDe(request);
    return { tarefas: tarefasDoFiltro(ctx) };
  });

  app.get('/exportar.csv', { preHandler: exigir('ver') }, async (request, reply) => {
    const ctx = ctxDe(request);
    const corpo = csv(ctx, lerFiltros(request.query));
    const hoje = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="execucoes-${hoje}.csv"`)
      .header('cache-control', 'no-store')
      .send(corpo);
  });

  app.get<ComId>('/:id', { preHandler: exigir('ver') }, async (request): Promise<ExecucaoDetalhe> => {
    const ctx = ctxDe(request);
    return montarDetalhe(ctx, execucao(ctx, request.params.id));
  });

  app.post<ComId>('/:id/reexecutar', { preHandler: exigir('operar') }, async (request) => {
    const ctx = ctxDe(request);
    const { motor, auditoria } = ctx;
    const m = membro(request);
    const r = execucao(ctx, request.params.id);
    const acoes = acoesPossiveis(r, definicaoDaExecucao(ctx, r), estadoDaConversa(ctx, r.conversa_id));
    if (!acoes.reexecutar) throw conflito('Só dá para reexecutar uma execução que falhou ou foi cancelada.');
    const id = await motor.reexecutar(r.id, ator(m));
    auditoria.registrar(m.nome, 'reexecutou', r.id, `Nova execução ${id}`);
    return { id };
  });

  app.post<ComId>('/:id/concluir', { preHandler: exigir('operar') }, async (request) => {
    const ctx = ctxDe(request);
    const { motor, auditoria } = ctx;
    const m = membro(request);
    const { nota } = validar(Nota, request.body);
    const r = execucao(ctx, request.params.id);
    const acoes = acoesPossiveis(r, definicaoDaExecucao(ctx, r), estadoDaConversa(ctx, r.conversa_id));
    if (!acoes.concluir) throw conflito('Esta execução não está esperando ninguém para ser concluída.');
    await motor.concluirManual(r.id, ator(m), nota || undefined);
    auditoria.registrar(m.nome, 'marcou como concluída', r.id, nota || null);
    return { ok: true };
  });

  app.post<ComId>('/:id/desfazer', { preHandler: exigir('administrar') }, async (request) => {
    const ctx = ctxDe(request);
    const { motor, auditoria } = ctx;
    const m = membro(request);
    const r = execucao(ctx, request.params.id);
    const acoes = acoesPossiveis(r, definicaoDaExecucao(ctx, r), estadoDaConversa(ctx, r.conversa_id));
    if (!acoes.desfazer) throw conflito('Esta execução não pode ser desfeita.');
    await motor.desfazer(r.id, ator(m));
    auditoria.registrar(m.nome, 'desfez', r.id, r.tarefa_nome);
    return { ok: true };
  });

  app.post<ComId>('/:id/avisar', { preHandler: exigir('operar') }, async (request) => {
    const ctx = ctxDe(request);
    const { atendimento, auditoria } = ctx;
    const m = membro(request);
    const { texto } = validar(Texto, request.body);
    const r = execucao(ctx, request.params.id);
    conversaDe(r);
    await atendimento.avisarUsuario(r.id, m, texto);
    auditoria.registrar(m.nome, 'avisou o usuário', r.id, `Para ${r.usuario_nome}`);
    return { ok: true };
  });

  app.post<ComId>('/:id/assumir', { preHandler: exigir('operar') }, async (request) => {
    const ctx = ctxDe(request);
    const { atendimento, auditoria } = ctx;
    const m = membro(request);
    const r = execucao(ctx, request.params.id);
    const conversaId = conversaDe(r);
    if (estadoDaConversa(ctx, conversaId) === 'copiloto') {
      throw conflito('A conversa está com o copiloto: ninguém pediu para falar com uma pessoa.');
    }
    await atendimento.assumir(conversaId, m);
    auditoria.registrar(m.nome, 'assumiu o atendimento', r.id, `Conversa com ${r.usuario_nome}`);
    return { ok: true };
  });

  app.post<ComId>('/:id/responder', { preHandler: exigir('operar') }, async (request) => {
    const ctx = ctxDe(request);
    const { atendimento, auditoria } = ctx;
    const m = membro(request);
    const { texto } = validar(Texto, request.body);
    const r = execucao(ctx, request.params.id);
    const conversaId = conversaDe(r);
    if (estadoDaConversa(ctx, conversaId) === 'copiloto') {
      throw conflito('Assuma a conversa antes de responder.');
    }
    await atendimento.responder(conversaId, m, texto);
    auditoria.registrar(m.nome, 'respondeu no atendimento', r.id, `Para ${r.usuario_nome}`);
    return { ok: true };
  });

  app.post<ComId>('/:id/encerrar-atendimento', { preHandler: exigir('operar') }, async (request) => {
    const ctx = ctxDe(request);
    const { atendimento, auditoria } = ctx;
    const m = membro(request);
    const r = execucao(ctx, request.params.id);
    const conversaId = conversaDe(r);
    if (estadoDaConversa(ctx, conversaId) === 'copiloto') {
      throw conflito('Este atendimento já foi encerrado.');
    }
    await atendimento.encerrar(conversaId, m);
    auditoria.registrar(m.nome, 'encerrou o atendimento', r.id, `Conversa com ${r.usuario_nome}`);
    return { ok: true };
  });

  app.post<ComId>(
    '/aprovacoes/:id/decidir',
    { preHandler: exigir('operar') },
    async (request) => {
      const ctx = ctxDe(request);
      const { banco, motor, auditoria } = ctx;
      const m = membro(request);
      const { aprovado, motivo } = validar(Decisao, request.body);
      const a = banco.um<{ id: string; execucao_id: string; estado: string; solicitante_nome: string }>(
        'SELECT id, execucao_id, estado, solicitante_nome FROM aprovacoes WHERE id = ?',
        request.params.id,
      );
      if (!a) throw naoEncontrado('Pedido de aprovação');
      if (a.estado !== 'enviada') throw conflito('Este pedido de aprovação já foi decidido ou cancelado.');
      await motor.decidirAprovacao(a.id, ator(m), aprovado, motivo || undefined);
      auditoria.registrar(
        m.nome,
        aprovado ? 'aprovou o pedido' : 'recusou o pedido',
        a.execucao_id,
        aprovado || !motivo ? `Pedido de ${a.solicitante_nome}` : `Pedido de ${a.solicitante_nome}. Motivo: ${motivo}`,
      );
      return { ok: true };
    },
  );
};

export default rotas;

// Contadores do menu lateral e faixas globais do console.
import type { FastifyPluginAsync } from 'fastify';
import type { ResumoConsole } from '@copiloto/shared';
import { euDe, exigir, membro } from '../../auth/console.ts';
import { ctxDe } from '../../contexto.ts';
import { inicioDoDia } from '../../servicos/gastos.ts';
import { calcularGuia } from '../../servicos/guia.ts';

const rotas: FastifyPluginAsync = async (app) => {
  app.get('/resumo', { preHandler: exigir('ver') }, async (request): Promise<ResumoConsole> => {
    const ctx = ctxDe(request);
    const { banco, gastos, llm, adaptador } = ctx;
    const m = membro(request);
    const hoje = inicioDoDia().toISOString();
    const atencao = banco.um<{ n: number }>(
      `SELECT COUNT(*) AS n FROM execucoes
       WHERE (status = 'falhou' AND criado_em >= ?)
          OR (transferida_para IS NOT NULL AND status NOT IN ('concluida', 'cancelada', 'desfeita'))`,
      hoje,
    )!.n;
    const aprovacoes = banco.um<{ n: number }>("SELECT COUNT(*) AS n FROM aprovacoes WHERE estado = 'enviada'")!.n;
    const guia = await calcularGuia(ctx);
    const limites = gastos.limites();
    const percentual = limites.mensal > 0 ? limites.usoMes / limites.mensal : 0;
    return {
      eu: euDe(ctx, m),
      execucoesAtencao: atencao,
      aprovacoesPendentes: aprovacoes,
      guia: { feitos: guia.feitos, total: guia.total },
      modoSimulado: llm.simulado,
      semClaude: llm.semChave,
      alertaGasto:
        limites.alerta80 && percentual >= 0.8
          ? { usado: limites.usoMes, limite: limites.mensal, percentual }
          : null,
      nomeSistema: adaptador.nome,
    };
  });
};

export default rotas;

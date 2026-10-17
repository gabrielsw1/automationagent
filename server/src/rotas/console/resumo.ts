// Contadores do menu lateral e faixas globais do console.
import type { FastifyPluginAsync } from 'fastify';
import type { ResumoConsole } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import { inicioDoDia } from '../../servicos/gastos.ts';
import { calcularGuia } from '../../servicos/guia.ts';

const rotas: FastifyPluginAsync = async (app) => {
  const { banco, gastos, llm, adaptador } = app.ctx;

  app.get('/resumo', { preHandler: exigir('ver') }, async (request): Promise<ResumoConsole> => {
    const m = membro(request);
    const hoje = inicioDoDia().toISOString();
    const atencao = banco.um<{ n: number }>(
      `SELECT COUNT(*) AS n FROM execucoes
       WHERE (status = 'falhou' AND criado_em >= ?)
          OR (transferida_para IS NOT NULL AND status NOT IN ('concluida', 'cancelada', 'desfeita'))`,
      hoje,
    )!.n;
    const aprovacoes = banco.um<{ n: number }>("SELECT COUNT(*) AS n FROM aprovacoes WHERE estado = 'enviada'")!.n;
    const guia = await calcularGuia(app.ctx);
    const limites = gastos.limites();
    const percentual = limites.mensal > 0 ? limites.usoMes / limites.mensal : 0;
    return {
      eu: { id: m.id, nome: m.nome, email: m.email, perfil: m.perfil, iniciais: m.iniciais },
      execucoesAtencao: atencao,
      aprovacoesPendentes: aprovacoes,
      guia: { feitos: guia.feitos, total: guia.total },
      modoSimulado: llm.simulado,
      alertaGasto:
        limites.alerta80 && percentual >= 0.8
          ? { usado: limites.usoMes, limite: limites.mensal, percentual }
          : null,
      nomeSistema: adaptador.nome,
    };
  });
};

export default rotas;

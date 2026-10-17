// Créditos da empresa no ciclo (mês do calendário em São Paulo): o que o plano inclui, o que os
// pacotes pagos somaram, o que as execuções gastaram e o que passou disso (créditos extras). Também
// decide se uma execução nova pode rodar quando os créditos acabam (Gastos.verificar chama aqui).
//
// - Usados: soma de execucoes.creditos no ciclo (1 pelo roteiro, 5 com conserto visual; testes, 0).
// - Restantes: incluídos + pacotes − usados. Extras: o que passou de incluídos + pacotes.
// - Sem créditos: a execução só roda como crédito extra se o plano tem preço de crédito e o valor
//   dos extras do mês ainda está abaixo do limite mensal de Equipe e limites. Senão, recusa antes.
// - A demonstração nunca bloqueia (números de exemplo) e empresas sem plano ou com plano sem teto de
//   créditos também não.
import { CONSERTOS_PARA_QUEBRADO, CREDITOS_POR_ROTEIRO, type CicloCreditos, type DestaqueConserto, type Plano, type UsoCiclo, type UsoTarefa } from '@copiloto/shared';
import type { Banco } from '../db/banco.ts';
import type { Empresa, Plataforma } from '../plataforma/index.ts';
import type { Configuracoes } from '../servicos/configuracoes.ts';
import { cicloDe, competenciaDe, deslocarCompetencia } from './ciclo.ts';

export const MENSAGEM_SEM_CREDITOS = 'Os créditos do mês acabaram. Um Admin pode comprar um pacote em Plano e créditos.';

const DIA = 86_400_000;

export type VerificacaoCreditos =
  | { permitido: true; extra: boolean }
  | { permitido: false; motivo: 'creditos'; mensagem: string };

export class Creditos {
  constructor(
    private readonly banco: Banco,
    private readonly plataforma: Plataforma,
    private readonly empresaId: string,
    private readonly demo: boolean,
    private readonly configuracoes: Configuracoes,
  ) {}

  /** A empresa lida agora (o plano muda pela Plataforma sem reabrir o contexto). */
  private empresa(): Empresa | undefined {
    return this.plataforma.empresa(this.empresaId);
  }

  plano(): Plano | null {
    const id = this.empresa()?.planoId;
    return (id && this.plataforma.plano(id)) || null;
  }

  /**
   * O uso do mês desta empresa é medido em créditos extras (R$), e não em custo do Claude e do
   * navegador: plano com teto de créditos e preço do crédito definido, fora da demonstração.
   */
  cobraPorCredito(plano = this.plano()): boolean {
    return !this.demo && !!plano && plano.creditosIncluidos !== null && plano.precoCreditoExtraCentavos !== null;
  }

  private somar(inicio: Date, fim: Date): { usados: number; conserto: number } {
    const l = this.banco.um<{ usados: number | null; conserto: number | null }>(
      `SELECT SUM(creditos) AS usados, SUM(CASE WHEN recuperacoes > 0 THEN creditos ELSE 0 END) AS conserto
         FROM execucoes WHERE criado_em >= ? AND criado_em < ? AND creditos > 0`,
      inicio.toISOString(),
      fim.toISOString(),
    );
    return { usados: l?.usados ?? 0, conserto: l?.conserto ?? 0 };
  }

  /** Créditos do ciclo de `competencia` (padrão: o mês corrente), até `agora` no ciclo corrente. */
  ciclo(agora = new Date(), competencia = competenciaDe(agora), plano = this.plano()): CicloCreditos {
    const { inicio, fim } = cicloDe(competencia);
    const ate = agora < fim ? agora : fim;
    const { usados, conserto } = this.somar(inicio, ate);
    const incluidos = plano?.creditosIncluidos ?? null;
    const pacotes = this.plataforma.faturas.creditosPagos(this.empresaId, inicio, fim);
    const restantes = incluidos === null ? null : incluidos + pacotes - usados;
    const extras = incluidos === null ? 0 : Math.max(0, usados - incluidos - pacotes);
    const preco = plano?.precoCreditoExtraCentavos ?? null;
    const decorridos = Math.max(1, Math.ceil((ate.getTime() - inicio.getTime()) / DIA));
    const porDia = usados > 0 ? usados / decorridos : null;
    let acabaEm: string | null = null;
    const corrente = agora >= inicio && agora < fim;
    if (corrente && restantes !== null && restantes > 0 && porDia) {
      const quando = new Date(agora.getTime() + (restantes / porDia) * DIA);
      if (quando < fim) acabaEm = quando.toISOString();
    }
    return {
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      competencia,
      incluidos,
      pacotes,
      usados,
      creditosRoteiro: usados - conserto,
      creditosConserto: conserto,
      restantes,
      extras,
      valorExtrasCentavos: preco === null ? null : extras * preco,
      porDia,
      acabaEm,
    };
  }

  /** Valor dos créditos extras do mês, em reais (o "gasto do mês" das empresas que pagam por crédito). */
  valorExtrasMes(agora = new Date()): number {
    return (this.ciclo(agora).valorExtrasCentavos ?? 0) / 100;
  }

  /** No ritmo do mês, o valor dos créditos extras no fim do ciclo, em reais. */
  previsaoExtrasMes(agora = new Date()): number {
    const c = this.ciclo(agora);
    const plano = this.plano();
    const preco = plano?.precoCreditoExtraCentavos ?? null;
    if (c.incluidos === null || preco === null || !c.porDia) return (c.valorExtrasCentavos ?? 0) / 100;
    const dias = (new Date(c.fim).getTime() - new Date(c.inicio).getTime()) / DIA;
    const previstos = Math.max(c.usados, c.porDia * dias);
    return (Math.max(0, previstos - c.incluidos - c.pacotes) * preco) / 100;
  }

  /** Pode rodar mais uma execução? Chamado por Gastos.verificar antes de criar cada execução. */
  verificar(agora = new Date()): VerificacaoCreditos {
    if (this.demo) return { permitido: true, extra: false };
    const plano = this.plano();
    if (!plano || plano.creditosIncluidos === null) return { permitido: true, extra: false };
    const c = this.ciclo(agora, competenciaDe(agora), plano);
    if (c.restantes !== null && c.restantes > 0) return { permitido: true, extra: false };
    const preco = plano.precoCreditoExtraCentavos;
    if (preco !== null) {
      const limite = this.configuracoes.ler('limites').mensal;
      if ((c.extras * preco) / 100 < limite) return { permitido: true, extra: true };
    }
    return { permitido: false, motivo: 'creditos', mensagem: MENSAGEM_SEM_CREDITOS };
  }

  /** Para onde foram os créditos no ciclo, por tarefa, e a tarefa que mais gastou com conserto visual. */
  uso(agora = new Date(), competencia = competenciaDe(agora)): UsoCiclo {
    const { inicio, fim } = cicloDe(competencia);
    const ate = agora < fim ? agora : fim;
    const ini = inicio.toISOString();
    const f = ate.toISOString();
    const linhas = this.banco.todos<{ tarefa_id: string | null; nome: string; execucoes: number; roteiro: number; conserto: number; creditos: number }>(
      `SELECT tarefa_id, MAX(tarefa_nome) AS nome, COUNT(*) AS execucoes,
              SUM(CASE WHEN recuperacoes > 0 THEN 0 ELSE 1 END) AS roteiro,
              SUM(CASE WHEN recuperacoes > 0 THEN 1 ELSE 0 END) AS conserto,
              SUM(creditos) AS creditos
         FROM execucoes WHERE criado_em >= ? AND criado_em < ? AND creditos > 0
        GROUP BY COALESCE(tarefa_id, tarefa_nome)
        ORDER BY creditos DESC, nome`,
      ini,
      f,
    );
    const tarefas: UsoTarefa[] = linhas.map((l) => ({
      tarefaId: l.tarefa_id,
      nome: l.nome,
      execucoes: l.execucoes,
      roteiro: l.roteiro,
      conserto: l.conserto,
      creditos: l.creditos,
      consertoFrequente: l.conserto > CONSERTOS_PARA_QUEBRADO,
    }));
    const total = tarefas.reduce(
      (s, t) => ({ execucoes: s.execucoes + t.execucoes, roteiro: s.roteiro + t.roteiro, conserto: s.conserto + t.conserto, creditos: s.creditos + t.creditos }),
      { execucoes: 0, roteiro: 0, conserto: 0, creditos: 0 },
    );
    return { inicio: ini, ate: f, competencia, tarefas, total, destaque: this.destaque(ini, f, total.creditos) };
  }

  private destaque(ini: string, fim: string, totalCiclo: number): DestaqueConserto | null {
    const topo = this.banco.um<{ tarefa_id: string; nome: string; primeiro: string }>(
      `SELECT tarefa_id, MAX(tarefa_nome) AS nome, MIN(criado_em) AS primeiro
         FROM execucoes WHERE criado_em >= ? AND criado_em < ? AND creditos > 0 AND recuperacoes > 0 AND tarefa_id IS NOT NULL
        GROUP BY tarefa_id ORDER BY SUM(creditos) DESC, nome LIMIT 1`,
      ini,
      fim,
    );
    if (!topo) return null;
    const desde = this.banco.um<{ execucoes: number; consertos: number | null; creditos: number | null }>(
      `SELECT COUNT(*) AS execucoes, SUM(CASE WHEN recuperacoes > 0 THEN 1 ELSE 0 END) AS consertos,
              SUM(CASE WHEN recuperacoes > 0 THEN creditos ELSE 0 END) AS creditos
         FROM execucoes WHERE tarefa_id = ? AND criado_em >= ? AND criado_em < ? AND creditos > 0`,
      topo.tarefa_id,
      topo.primeiro,
      fim,
    );
    const ultima = this.banco.um<{ id: string }>(
      `SELECT id FROM execucoes WHERE tarefa_id = ? AND criado_em >= ? AND criado_em < ? AND creditos > 0 AND recuperacoes > 0
        ORDER BY criado_em DESC LIMIT 1`,
      topo.tarefa_id,
      ini,
      fim,
    );
    const fluxo = this.banco.um<{ id: string }>('SELECT id FROM fluxos WHERE tarefa_id = ? ORDER BY salvo_em DESC LIMIT 1', topo.tarefa_id);
    const consertos = desde?.consertos ?? 0;
    const creditosConserto = desde?.creditos ?? 0;
    return {
      tarefaId: topo.tarefa_id,
      nome: topo.nome,
      primeiroConserto: topo.primeiro,
      consertos,
      execucoes: desde?.execucoes ?? 0,
      creditosConserto,
      fracaoCiclo: totalCiclo > 0 ? creditosConserto / totalCiclo : 0,
      creditosPeloRoteiro: consertos * CREDITOS_POR_ROTEIRO,
      execucaoId: ultima!.id,
      fluxoId: fluxo?.id ?? null,
    };
  }

  /** Pessoas que usaram o assistente no mês: conversaram no widget ou tiveram execuções. */
  usuariosMes(agora = new Date()): number {
    const ini = cicloDe(competenciaDe(agora)).inicio.toISOString();
    return (
      this.banco.um<{ n: number }>(
        `SELECT COUNT(*) AS n FROM (
           SELECT usuario_id FROM conversas WHERE canal = 'widget' AND atualizado_em >= ?
           UNION SELECT usuario_id FROM execucoes WHERE criado_em >= ? AND canal <> 'teste'
         )`,
        ini,
        ini,
      )?.n ?? 0
    );
  }

  /** O ciclo anterior ao de `agora`. */
  competenciaAnterior(agora = new Date()): string {
    return deslocarCompetencia(competenciaDe(agora), -1);
  }

  /** Depois de cada execução que gastou crédito: a recarga automática confere se precisa comprar um pacote. */
  async aposExecucao(): Promise<void> {
    if (this.demo) return;
    await this.plataforma.faturas.verificarRecarga(this.empresaId);
  }
}

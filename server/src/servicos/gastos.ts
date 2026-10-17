// Custos e limites de gasto. Valores em reais (custo em dólar x COTACAO_DOLAR).
//
// O "gasto do mês" (painel, Equipe e limites) depende de como a empresa paga:
// - Plano com teto de créditos e preço do crédito definido: é o valor dos créditos extras do mês
//   (o que vai além dos créditos incluídos e dos pacotes), e o limite mensal segura esses extras.
// - Demonstração e empresas sem preço de crédito: é o custo do Claude e do navegador, como antes.
// Antes de criar uma execução, os créditos do mês também são conferidos (cobranca/creditos.ts).
import type { Caminho, Limites } from '@copiloto/shared';
import type { Creditos } from '../cobranca/creditos.ts';
import type { Config } from '../config.ts';
import { agoraIso, type Banco } from '../db/banco.ts';
import type { Atribuicao, UsoLlm } from '../llm/tipos.ts';
import { novoId } from '../util/ids.ts';
import type { Configuracoes } from './configuracoes.ts';

/** Início do mês corrente (fuso de São Paulo) em ISO. */
export function inicioDoMes(agora = new Date()): Date {
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const deslocamento = agora.getTime() - sp.getTime();
  return new Date(new Date(sp.getFullYear(), sp.getMonth(), 1).getTime() + deslocamento);
}

export function inicioDoDia(agora = new Date()): Date {
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const deslocamento = agora.getTime() - sp.getTime();
  return new Date(new Date(sp.getFullYear(), sp.getMonth(), sp.getDate()).getTime() + deslocamento);
}

export type ResultadoLimite =
  | { permitido: true }
  | { permitido: false; motivo: 'mensal' | 'usuario_dia' | 'creditos'; mensagem: string };

export class Gastos {
  constructor(
    private readonly banco: Banco,
    private readonly config: Config,
    private readonly configuracoes: Configuracoes,
    /** Créditos da empresa (sem ele, como nos testes de peças soltas, vale só o custo). */
    private readonly creditos?: Creditos,
  ) {}

  /** O uso do mês desta empresa é medido em créditos extras. */
  porCreditos(): boolean {
    return !!this.creditos?.cobraPorCredito();
  }

  registrarUso = (uso: UsoLlm, a: Atribuicao) => {
    this.banco.inserir('uso_llm', {
      id: novoId('uso'),
      conversa_id: a.conversaId ?? null,
      execucao_id: a.execucaoId ?? null,
      finalidade: a.finalidade,
      modelo: uso.modelo,
      entrada: uso.entrada,
      saida: uso.saida,
      cache_leitura: uso.cacheLeitura,
      cache_escrita: uso.cacheEscrita,
      custo_usd: uso.custoUsd,
      criado_em: agoraIso(),
    });
  };

  emReais(usd: number): number {
    return usd * this.config.cotacaoDolar;
  }

  /** Custo de navegador de uma execução, pela duração. */
  custoNavegador(duracaoMs: number): number {
    return (duracaoMs / 60000) * this.config.custoNavegadorMinuto;
  }

  /** Gasto total em R$ entre duas datas: chamadas ao Claude + minutos de navegador + execuções de exemplo. */
  gastoEntre(inicio: Date, fim = new Date()): number {
    const ini = inicio.toISOString();
    const f = fim.toISOString();
    const llm = this.banco.um<{ t: number | null }>(
      'SELECT SUM(custo_usd) AS t FROM uso_llm WHERE criado_em >= ? AND criado_em < ?',
      ini,
      f,
    )?.t;
    const exec = this.banco.um<{ nav: number | null; ex: number | null }>(
      `SELECT SUM(COALESCE(custo_navegador, 0)) AS nav,
              SUM(CASE WHEN exemplo = 1 THEN COALESCE(custo_modelo, 0) ELSE 0 END) AS ex
       FROM execucoes WHERE criado_em >= ? AND criado_em < ?`,
      ini,
      f,
    );
    return this.emReais(llm ?? 0) + (exec?.nav ?? 0) + (exec?.ex ?? 0);
  }

  /** Custo do Claude e do navegador no mês (o que a Starta paga para rodar a empresa). */
  custoMes(agora = new Date()): number {
    return this.gastoEntre(inicioDoMes(agora), agora);
  }

  /** Gasto do mês: créditos extras, para quem paga por crédito; senão, o custo. */
  gastoMes(agora = new Date()): number {
    return this.creditos && this.porCreditos() ? this.creditos.valorExtrasMes(agora) : this.custoMes(agora);
  }

  /** Projeção linear do gasto até o fim do mês. */
  previsaoMes(agora = new Date()): number {
    if (this.creditos && this.porCreditos()) return this.creditos.previsaoExtrasMes(agora);
    const ini = inicioDoMes(agora);
    const proximo = new Date(ini);
    proximo.setUTCMonth(proximo.getUTCMonth() + 1);
    const decorrido = Math.max(agora.getTime() - ini.getTime(), 3600_000);
    return (this.gastoMes(agora) / decorrido) * (proximo.getTime() - ini.getTime());
  }

  limites(agora = new Date()): Limites {
    const l = this.configuracoes.ler('limites');
    const meta = this.configuracoes.metadados('limites');
    const ini = inicioDoMes(agora);
    const renova = new Date(ini);
    renova.setUTCMonth(renova.getUTCMonth() + 1);
    return {
      ...l,
      base: this.porCreditos() ? 'creditos' : 'custo',
      usoMes: arred(this.gastoMes(agora)),
      previsaoMes: arred(this.previsaoMes(agora)),
      renovaEm: renova.toISOString(),
      ...meta,
    };
  }

  /** Confere os limites antes de criar uma execução. Dúvidas respondidas não passam por aqui. */
  verificar(usuarioId: string, caminho: Caminho, agora = new Date()): ResultadoLimite {
    const c = this.creditos?.verificar(agora);
    if (c && !c.permitido) return c;
    const l = this.configuracoes.ler('limites');
    const gasto = this.gastoMes(agora);
    if (gasto >= l.mensal && (l.aoAtingir === 'pausar_tudo' || caminho === 'navegador')) {
      return {
        permitido: false,
        motivo: 'mensal',
        mensagem:
          l.aoAtingir === 'pausar_tudo'
            ? 'O copiloto atingiu o limite de gasto do mês e está pausado.'
            : 'O limite de gasto do mês foi atingido, então tarefas pela tela estão pausadas.',
      };
    }
    const hoje = this.banco.um<{ n: number }>(
      `SELECT COUNT(*) AS n FROM execucoes WHERE usuario_id = ? AND criado_em >= ? AND exemplo = 0
       AND status NOT IN ('cancelada', 'aguardando_confirmacao')`,
      usuarioId,
      inicioDoDia(agora).toISOString(),
    )?.n;
    if ((hoje ?? 0) >= l.porUsuarioDia) {
      return {
        permitido: false,
        motivo: 'usuario_dia',
        mensagem: `Você chegou ao limite de ${l.porUsuarioDia} execuções por dia.`,
      };
    }
    return { permitido: true };
  }

  /** Pausa ativa para o widget (faixa no topo do chat). */
  pausaAtiva(agora = new Date()): null | { tipo: 'navegador' | 'tudo'; mensagem: string } {
    const c = this.creditos?.verificar(agora);
    if (c && !c.permitido) {
      return { tipo: 'tudo', mensagem: 'Os créditos do mês acabaram e as tarefas estão pausadas até um Admin comprar um pacote. Posso chamar uma pessoa.' };
    }
    const l = this.configuracoes.ler('limites');
    if (this.gastoMes(agora) < l.mensal) return null;
    return l.aoAtingir === 'pausar_tudo'
      ? { tipo: 'tudo', mensagem: 'O copiloto está pausado até o limite de gasto renovar. Posso chamar uma pessoa.' }
      : { tipo: 'navegador', mensagem: 'Tarefas feitas pela tela estão pausadas até o limite de gasto renovar.' };
  }
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

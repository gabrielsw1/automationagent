// Configurações editáveis pelo console (widget, limites, segurança). Guardadas na tabela config
// como JSON, com valor padrão quando ainda não existem.
import type { ConfigWidget, Limites, Seguranca } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';

export interface LimitesGuardados {
  mensal: number;
  porUsuarioDia: number;
  alerta80: boolean;
  aoAtingir: Limites['aoAtingir'];
}

export interface SegurancaGuardada {
  mascararPrints: boolean;
  retencaoPrintsDias: Seguranca['retencaoPrintsDias'];
  retencaoConversasMeses: Seguranca['retencaoConversasMeses'];
}

export interface InstalacaoWidget {
  origem: string;
  vistoEm: string;
}

interface Esquema {
  widget_publicado: ConfigWidget;
  widget_rascunho: ConfigWidget;
  widget_chave_publica: string;
  widget_instalacao: InstalacaoWidget | null;
  limites: LimitesGuardados;
  seguranca: SegurancaGuardada;
  /** Passos do guia marcados manualmente (ex.: "widget" depois de "Já instalei, verificar"). */
  guia_feitos: string[];
}

export type ChaveConfig = keyof Esquema;

/** Widget de uma empresa nova; `demo` traz as boas-vindas e sugestões do Horizonte. */
export function widgetPadrao(nomeSistema: string, dominios: string[], demo = true): ConfigWidget {
  return {
    nome: 'Copiloto',
    boasVindas: demo
      ? `Oi! Posso cadastrar clientes, alterar planos, emitir relatórios e tirar dúvidas sobre o ${nomeSistema}. Antes de gravar qualquer coisa, eu mostro tudo para você conferir.`
      : `Oi! Posso fazer tarefas no ${nomeSistema} por você e tirar dúvidas. Antes de gravar qualquer coisa, eu mostro tudo para você conferir.`,
    sugestoes: demo ? ['Cadastrar cliente', 'Emitir relatório de vendas', 'Como emitir segunda via?'] : [],
    cor: '#FA276B',
    posicao: 'direita',
    atalho: true,
    proativa: { ativa: true, segundosParado: 30 },
    atendimentoHumano: { horario: 'segunda a sexta, das 8h às 18h' },
    dominios,
  };
}

export class Configuracoes {
  private readonly padroes: Esquema;

  constructor(
    private readonly banco: Banco,
    opcoes: { nomeSistema: string; dominiosPadrao: string[]; chavePublicaPadrao: string; demo: boolean },
  ) {
    const widget = widgetPadrao(opcoes.nomeSistema, opcoes.dominiosPadrao, opcoes.demo);
    this.padroes = {
      widget_publicado: widget,
      widget_rascunho: widget,
      widget_chave_publica: opcoes.chavePublicaPadrao,
      widget_instalacao: null,
      limites: { mensal: 1500, porUsuarioDia: 50, alerta80: true, aoAtingir: 'pausar_navegador' },
      seguranca: { mascararPrints: true, retencaoPrintsDias: 90, retencaoConversasMeses: 12 },
      guia_feitos: [],
    };
  }

  ler<K extends ChaveConfig>(chave: K): Esquema[K] {
    const linha = this.banco.um<{ valor: string }>('SELECT valor FROM config WHERE chave = ?', chave);
    return json<Esquema[K]>(linha?.valor, structuredClone(this.padroes[chave]));
  }

  /** Quem alterou por último e quando (para "Última alteração por ..."). */
  metadados(chave: ChaveConfig): { atualizadoPor: string | null; atualizadoEm: string | null } {
    const linha = this.banco.um<{ atualizado_por: string | null; atualizado_em: string }>(
      'SELECT atualizado_por, atualizado_em FROM config WHERE chave = ?',
      chave,
    );
    return { atualizadoPor: linha?.atualizado_por ?? null, atualizadoEm: linha?.atualizado_em ?? null };
  }

  gravar<K extends ChaveConfig>(chave: K, valor: Esquema[K], por: string | null) {
    this.banco.executar(
      `INSERT INTO config (chave, valor, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_por = excluded.atualizado_por,
       atualizado_em = excluded.atualizado_em`,
      chave,
      JSON.stringify(valor),
      por,
      agoraIso(),
    );
  }
}

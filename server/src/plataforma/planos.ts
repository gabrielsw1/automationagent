// Tabela de planos (banco da plataforma, migração 3): o site lê daqui e a área da Starta muda os
// preços. Preço NULL ainda não foi definido e aparece como "Sob consulta".
import type { BotaoPlano, Plano, PrecosPlano } from '@copiloto/shared';
import { json } from '../db/banco.ts';

export interface LinhaPlano {
  id: string;
  nome: string;
  ordem: number;
  descricao: string;
  usuarios_min: number;
  usuarios_max: number | null;
  creditos_incluidos: number | null;
  pacote_creditos: number;
  preco_mensal_centavos: number | null;
  taxa_implantacao_centavos: number | null;
  preco_credito_extra_centavos: number | null;
  nota_preco: string;
  destaques: string;
  botao: BotaoPlano;
  atualizado_em: string;
}

export const COLUNA_PRECO: Record<keyof PrecosPlano, string> = {
  precoMensalCentavos: 'preco_mensal_centavos',
  taxaImplantacaoCentavos: 'taxa_implantacao_centavos',
  precoCreditoExtraCentavos: 'preco_credito_extra_centavos',
};

export function dePlano(l: LinhaPlano): Plano {
  return {
    id: l.id,
    nome: l.nome,
    ordem: l.ordem,
    descricao: l.descricao,
    usuariosMin: l.usuarios_min,
    usuariosMax: l.usuarios_max,
    creditosIncluidos: l.creditos_incluidos,
    pacoteCreditos: l.pacote_creditos,
    precoMensalCentavos: l.preco_mensal_centavos,
    taxaImplantacaoCentavos: l.taxa_implantacao_centavos,
    precoCreditoExtraCentavos: l.preco_credito_extra_centavos,
    notaPreco: l.nota_preco,
    destaques: json<string[]>(l.destaques, []),
    botao: l.botao,
    atualizadoEm: l.atualizado_em,
  };
}

/** Preços que o cartão do plano mostra: mensal, crédito extra e a taxa de implantação quando a nota cita. */
function precosMostrados(p: Plano): (number | null)[] {
  return [
    p.precoMensalCentavos,
    p.precoCreditoExtraCentavos,
    ...(p.notaPreco.includes('{implantacao}') ? [p.taxaImplantacaoCentavos] : []),
  ];
}

/** Algum preço do site ainda não foi definido: enquanto isso, o site diz que faixas e valores são de exemplo. */
export function valoresDeExemplo(planos: Plano[]): boolean {
  return planos.some((p) => precosMostrados(p).includes(null));
}

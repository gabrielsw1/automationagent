// Caminho navegador com Playwright. (Implementação inicial: indica indisponível; o executor
// real, o gravador e a recuperação visual ficam em arquivos desta pasta.)
import type { Config } from '../config.ts';
import type { Banco } from '../db/banco.ts';
import type { AdaptadorSistema } from '../adaptadores/tipos.ts';
import type { Llm } from '../llm/tipos.ts';
import type { Navegador, PedidoExecucaoNavegador, ResultadoNavegador } from './tipos.ts';

export * from './tipos.ts';

export interface DependenciasNavegador {
  config: Config;
  banco: Banco;
  adaptador: AdaptadorSistema;
  llm: Llm;
}

export function criarNavegador(_deps: DependenciasNavegador): Navegador {
  return {
    async disponivel() {
      return { ok: false, detalhe: 'Executor de navegador ainda não configurado.' };
    },
    async executar(p: PedidoExecucaoNavegador): Promise<ResultadoNavegador> {
      return {
        ok: false,
        motivo: 'navegador_indisponivel',
        passo: null,
        mensagem: `O fluxo "${p.fluxo.nome}" não pode rodar agora: o navegador não está disponível.`,
        duracaoMs: 0,
      };
    },
    async fechar() {},
  };
}

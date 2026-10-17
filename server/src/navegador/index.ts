// Caminho navegador com Playwright: executor de fluxos gravados (com prints mascarados e
// recuperação visual), aprendizado de fluxos a partir da gravação e acesso à tabela de fluxos.
import { NavegadorPlaywright, type DependenciasNavegador, type OpcoesNavegador } from './executor.ts';
import type { Navegador } from './tipos.ts';

export * from './tipos.ts';
export type { DependenciasNavegador, OpcoesNavegador } from './executor.ts';
export { NavegadorPlaywright, escolherOpcao, ajustarFormato } from './executor.ts';
export { aprenderFluxo, converterPorRegras, pendenciaDe } from './aprender.ts';
export { Fluxos, lerFluxo, publico as fluxoPublico, type LinhaFluxo } from './fluxos.ts';
export { obterPrint, salvarPrint, caminhoPrint, apagarPrintsVencidos } from './prints.ts';

export function criarNavegador(deps: DependenciasNavegador, opcoes: OpcoesNavegador = {}): Navegador {
  return new NavegadorPlaywright(deps, opcoes);
}

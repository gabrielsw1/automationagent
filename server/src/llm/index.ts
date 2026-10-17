import type { Config } from '../config.ts';
import { LlmClaude } from './anthropic.ts';
import { LlmSemChave } from './sem-chave.ts';
import { LlmSimulado } from './simulado.ts';
import type { Llm, RegistrarUso } from './tipos.ts';

export * from './tipos.ts';
export { sim } from './simulado.ts';

export function criarLlm(config: Config, registrarUso: RegistrarUso): Llm {
  if (config.llmSimulado) return new LlmSimulado(registrarUso, 25);
  if (!config.temChaveClaude) return new LlmSemChave(config.modeloPrincipal);
  return new LlmClaude({
    modeloPrincipal: config.modeloPrincipal,
    modeloRapido: config.modeloRapido,
    esforco: config.esforco,
    registrarUso,
  });
}

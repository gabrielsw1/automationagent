// Escolhe o adaptador pelo nome em ADAPTADOR. Para o seu sistema, acrescente uma linha aqui.
import type { Config } from '../config.ts';
import { AdaptadorHorizonte } from './exemplo/index.ts';
import type { AdaptadorSistema } from './tipos.ts';

export * from './tipos.ts';

const ADAPTADORES: Record<string, (config: Config) => AdaptadorSistema> = {
  exemplo: (config) => new AdaptadorHorizonte(config),
};

export function criarAdaptador(config: Config): AdaptadorSistema {
  const criar = ADAPTADORES[config.adaptador];
  if (!criar) {
    throw new Error(
      `Adaptador "${config.adaptador}" não existe. Opções: ${Object.keys(ADAPTADORES).join(', ')}. Veja a seção "Ligar ao seu sistema de verdade" do README.`,
    );
  }
  return criar(config);
}

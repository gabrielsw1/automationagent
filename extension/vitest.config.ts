import { defineConfig } from 'vitest/config';

// Testes de unidade em jsdom com um chrome.* falso (test/chrome-falso.ts). O de ponta a ponta
// (test/e2e) roda em Node: compila a extensão, sobe o copiloto e abre o Chromium com ela carregada.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    // A barra leva os estilos (?inline) no Shadow DOM: os testes conferem que os tokens chegam lá.
    css: { include: [/\.css/] },
    testTimeout: 20_000,
    pool: 'forks',
    // node:sqlite (servidor do copiloto no teste de ponta a ponta) ainda é experimental no Node 22.
    poolOptions: { forks: { execArgv: ['--disable-warning=ExperimentalWarning'] } },
  },
});

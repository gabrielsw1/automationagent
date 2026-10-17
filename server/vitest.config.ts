import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    pool: 'forks',
    // node:sqlite ainda é marcado como experimental no Node 22: sem o aviso a cada arquivo.
    poolOptions: { forks: { execArgv: ['--disable-warning=ExperimentalWarning'] } },
  },
});

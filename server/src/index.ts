// Ponto de entrada do servidor do copiloto.
import { lerConfig } from './config.ts';
import { criarContexto } from './contexto.ts';
import { criarApp } from './app.ts';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const config = lerConfig();
const ctx = criarContexto(config);
const app = await criarApp(ctx, { logger: process.env.LOG === '1' });

await app.listen({ port: config.porta, host: config.host });
ctx.conhecimento.retomar();

const modo = ctx.llm.simulado
  ? 'modelo SIMULADO (defina ANTHROPIC_API_KEY para usar o Claude)'
  : `Claude ${config.modeloPrincipal} (rápido: ${config.modeloRapido})`;
console.log(`Copiloto no ar em ${config.urlPublica} · ${modo} · sistema: ${ctx.adaptador.nome} (${config.sistema.urlApi})`);

async function encerrar() {
  await app.close();
  await ctx.navegador.fechar();
  ctx.banco.fechar();
  process.exit(0);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

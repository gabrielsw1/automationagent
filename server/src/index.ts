// Ponto de entrada do servidor do copiloto: a plataforma (empresas, contas e sessões) e o
// contexto de cada empresa, aberto quando alguém dela usa o console ou o widget.
import { lerConfig } from './config.ts';
import { criarApp } from './app.ts';
import { Plataforma } from './plataforma/index.ts';
import { plataformaVazia, semearPlataforma, SENHA_PADRAO } from './seed/index.ts';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const config = lerConfig();
const plataforma = new Plataforma(config);
if (plataformaVazia(plataforma) && process.env.COPILOTO_SEED !== '0') {
  const r = semearPlataforma(plataforma);
  console.log(`Primeiro início: empresa de demonstração ${r.empresa.nome} criada (${r.tarefas} tarefas, ${r.execucoes} execuções).`);
  console.log(`Console: entre com rafael.lima@seusistema.com.br e a senha ${SENHA_PADRAO}, ou crie a conta de uma empresa nova.`);
}
const app = await criarApp(plataforma, { logger: process.env.LOG === '1' });

await app.listen({ port: config.porta, host: config.host });
// Abre as empresas ativas para retomar o que ficou pela metade (base de conhecimento, execuções).
const empresas = plataforma.listarEmpresas().filter((e) => e.status === 'ativa');
for (const e of empresas) plataforma.contexto(e.id).conhecimento.retomar();

const modo = config.llmSimulado
  ? 'modelo SIMULADO (COPILOTO_LLM=simulado: respostas por regras, só para testes)'
  : config.temChaveClaude
    ? `Claude ${config.modeloPrincipal} (rápido: ${config.modeloRapido})`
    : 'SEM a chave do Claude: defina ANTHROPIC_API_KEY. Até lá, o assistente avisa que não está ligado';
console.log(`Copiloto no ar em ${config.urlPublica} · ${modo} · ${empresas.length} empresa(s) ativa(s)`);

async function encerrar() {
  await app.close();
  await plataforma.fechar();
  process.exit(0);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

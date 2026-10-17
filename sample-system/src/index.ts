// Sobe o Horizonte. Variáveis de ambiente (todas opcionais):
//   PORT (ou HORIZONTE_PORT)  porta, padrão 4000
//   COPILOTO_URL              onde está o copiloto.js, padrão http://localhost:3000
//   COPILOTO_CHAVE            chave pública do widget, padrão pk_local_horizonte
//   WIDGET_SEGREDO            segredo da assinatura do snippet, padrão segredo-widget-local
//   SISTEMA_CHAVE_SERVICO     chave da API /v1, padrão chave-servico-local
//   DATA_DIR                  pasta de dados (relativa à raiz do repositório), padrão data
//   HORIZONTE_PERSISTIR=0     não grava DATA_DIR/horizonte.json (tudo em memória)
//   HORIZONTE_URL             endereço público, usado nos links de arquivos da API
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarServidor } from './servidor.ts';

const env = (nome: string, padrao: string): string => process.env[nome]?.trim() || padrao;

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const porta = Number(process.env.HORIZONTE_PORT?.trim() || env('PORT', '4000'));
const host = env('HOST', '0.0.0.0');
const arquivoDados = env('HORIZONTE_PERSISTIR', '1') === '0' ? null : path.resolve(raizRepo, env('DATA_DIR', 'data'), 'horizonte.json');

const app = criarServidor({
  copilotoUrl: env('COPILOTO_URL', 'http://localhost:3000'),
  copilotoChave: env('COPILOTO_CHAVE', 'pk_local_horizonte'),
  widgetSegredo: env('WIDGET_SEGREDO', 'segredo-widget-local'),
  chaveServico: env('SISTEMA_CHAVE_SERVICO', 'chave-servico-local'),
  urlPublica: process.env.HORIZONTE_URL?.trim() || undefined,
  arquivoDados,
  logger: { level: env('LOG_LEVEL', 'warn') },
});

try {
  await app.listen({ port: porta, host });
  console.log(`Horizonte (sistema de exemplo) em http://localhost:${porta} · demonstração em http://localhost:${porta}/_demo`);
  if (arquivoDados) console.log(`Dados em ${arquivoDados}`);
} catch (e) {
  console.error('Não consegui subir o Horizonte:', e);
  process.exit(1);
}

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    void app.close().finally(() => process.exit(0));
  });
}

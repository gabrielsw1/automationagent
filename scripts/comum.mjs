// Funções comuns de `npm run dev` e `npm start`. Só módulos do Node: roda antes do `npm install`.
// Funciona no PowerShell, no cmd e no bash (nada de sintaxe de shell aqui).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** Lê o .env da raiz, se existir, sem sobrescrever variáveis já definidas no terminal. */
export function carregarEnv() {
  const arquivo = path.join(RAIZ, '.env');
  if (!fs.existsSync(arquivo)) return;
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(arquivo, 'utf8')))) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
}

export function titulo(texto) {
  console.log(`\n\x1b[1m${texto}\x1b[0m`);
}

function rodar(comando, args) {
  const r = spawnSync(comando, args, { cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** Primeiro uso: instala as dependências sozinho (o `npm run dev` é o único comando). */
export function garantirDependencias() {
  const marcas = ['node_modules/concurrently', 'node_modules/tsx', 'node_modules/fastify', 'node_modules/vite'];
  if (marcas.every((m) => fs.existsSync(path.join(RAIZ, m)))) return;
  titulo('Instalando as dependências (só na primeira vez)...');
  if (!rodar(NPM, ['install'])) {
    console.error('Não consegui instalar as dependências. Rode "npm install" e veja o erro acima.');
    process.exit(1);
  }
}

/** Chromium do Playwright, usado nas tarefas pelo navegador. Baixa uma vez (cerca de 150 MB). */
export async function garantirChromium() {
  if (process.env.CHROMIUM_PATH || process.env.COPILOTO_SEM_NAVEGADOR === '1') return;
  try {
    const { chromium } = await import('playwright');
    if (fs.existsSync(chromium.executablePath())) return;
  } catch {
    // segue para a instalação
  }
  titulo('Baixando o Chromium para as tarefas pelo navegador (só na primeira vez)...');
  if (!rodar(NPX, ['playwright', 'install', 'chromium'])) {
    console.warn(
      'Não consegui baixar o Chromium. O copiloto sobe mesmo assim; só as tarefas pelo navegador ficam indisponíveis.\n' +
        'Tente depois com "npm run setup".',
    );
  }
}

/** Avisa se a chave do Claude está disponível (sem nunca mostrar a chave). */
export function avisoChave() {
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Claude: chave encontrada em ANTHROPIC_API_KEY. O copiloto usa o Claude de verdade.');
    return;
  }
  console.log(
    'Claude: ANTHROPIC_API_KEY não encontrada neste terminal. O copiloto roda em modo simulado (respostas por regras).\n' +
      (process.platform === 'win32'
        ? '  Se você usou "setx ANTHROPIC_API_KEY ...", feche este terminal e abra outro: o setx só vale para terminais novos.'
        : '  Defina com: export ANTHROPIC_API_KEY=...'),
  );
}

/** Variáveis comuns aos processos (silencia o aviso de SQLite experimental do Node 22). */
export function ambiente(extra = {}) {
  const opcoes = [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ');
  // O Horizonte e o copiloto precisam da mesma chave pública e do mesmo segredo do widget.
  const chave = process.env.WIDGET_CHAVE_PUBLICA || process.env.COPILOTO_CHAVE;
  const pares = chave ? { WIDGET_CHAVE_PUBLICA: chave, COPILOTO_CHAVE: chave } : {};
  return { ...process.env, ...pares, NODE_OPTIONS: opcoes, FORCE_COLOR: '1', ...extra };
}

export async function rodarJuntos(comandos) {
  const { concurrently } = await import('concurrently');
  const { result } = concurrently(comandos, {
    prefix: 'name',
    killOthersOn: ['failure'],
    restartTries: 0,
    cwd: RAIZ,
  });
  try {
    await result;
  } catch {
    process.exitCode = 1;
  }
}

// Compila a extensão em extension/dist (pasta para "Carregar sem compactação" no Chrome ou no Edge).
//   npm run build -w extension      compila uma vez
//   npm run dev -w extension        compila e recompila a cada mudança (o `npm run dev` da raiz já roda)
// Os content scripts e o service worker saem em arquivos únicos (IIFE, sem import), porque content
// script não carrega módulos; o popup e as opções são páginas normais do Vite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type InlineConfig } from 'vite';
import { iconePng, lerCores } from './icones.ts';
import { TAMANHOS_ICONE, manifesto } from './manifesto.ts';

export const RAIZ_EXTENSAO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(RAIZ_EXTENSAO, 'dist');
const TOKENS = path.resolve(RAIZ_EXTENSAO, '..', 'shared', 'styles', 'tokens.css');

const SCRIPTS = [
  { entrada: 'src/conteudo/pagina.ts', nome: 'pagina' },
  { entrada: 'src/conteudo/index.ts', nome: 'conteudo' },
  { entrada: 'src/fundo/index.ts', nome: 'fundo' },
] as const;

export interface OpcoesCompilar {
  saida?: string;
  /** Recompila a cada mudança (não termina). */
  observar?: boolean;
  /** Sem minificar e com mapa de código. */
  desenvolvimento?: boolean;
}

export function escreverManifestoEIcones(saida: string): void {
  const { version } = JSON.parse(fs.readFileSync(path.join(RAIZ_EXTENSAO, 'package.json'), 'utf8')) as { version: string };
  fs.writeFileSync(path.join(saida, 'manifest.json'), `${JSON.stringify(manifesto(version), null, 2)}\n`);
  const cores = lerCores(fs.readFileSync(TOKENS, 'utf8'));
  fs.mkdirSync(path.join(saida, 'icones'), { recursive: true });
  for (const t of TAMANHOS_ICONE) fs.writeFileSync(path.join(saida, 'icones', `${t}.png`), iconePng(t, cores));
}

export async function compilar(opcoes: OpcoesCompilar = {}): Promise<string> {
  const saida = path.resolve(opcoes.saida ?? DIST);
  const dev = opcoes.desenvolvimento ?? opcoes.observar ?? false;
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });

  const base = (build: InlineConfig['build']): InlineConfig => ({
    configFile: false,
    root: RAIZ_EXTENSAO,
    base: './',
    logLevel: 'warn',
    mode: dev ? 'development' : 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
    build: {
      outDir: saida,
      emptyOutDir: false,
      target: 'es2022',
      minify: dev ? false : 'esbuild',
      sourcemap: dev ? 'inline' : false,
      watch: opcoes.observar ? {} : null,
      ...build,
    },
  });

  for (const s of SCRIPTS) {
    await build(
      base({
        cssCodeSplit: false,
        lib: { entry: path.join(RAIZ_EXTENSAO, s.entrada), formats: ['iife'], name: `Copiloto_${s.nome}`, fileName: () => `${s.nome}.js` },
        rollupOptions: { output: { inlineDynamicImports: true } },
      }),
    );
  }
  await build(
    base({
      modulePreload: false,
      rollupOptions: { input: { popup: path.join(RAIZ_EXTENSAO, 'popup.html'), opcoes: path.join(RAIZ_EXTENSAO, 'opcoes.html') } },
    }),
  );
  escreverManifestoEIcones(saida);
  return saida;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const observar = process.argv.includes('--observar');
  compilar({ observar })
    .then((saida) => {
      const relativo = path.relative(process.cwd(), saida) || saida;
      console.log(
        observar
          ? `Extensão em ${relativo}, recompilando a cada mudança. No Chrome, recarregue a extensão em chrome://extensions.`
          : `Extensão pronta em ${relativo}. No Chrome ou no Edge: chrome://extensions › Modo do desenvolvedor › Carregar sem compactação.`,
      );
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Compila o widget num único arquivo dist/copiloto.js (IIFE, React incluído, CSS embutido via ?inline).
// O servidor do copiloto serve esse arquivo em /copiloto.js.
// `npm run dev -w widget` roda `vite build --watch --mode development` (sem minificar, com mapa de código).
export default defineConfig(({ mode }) => {
  const desenvolvimento = mode === 'development';
  return {
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(desenvolvimento ? 'development' : 'production'),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      minify: desenvolvimento ? false : 'esbuild',
      sourcemap: desenvolvimento ? 'inline' : false,
      cssCodeSplit: false,
      lib: {
        entry: 'src/main.ts',
        name: 'Copiloto',
        formats: ['iife'],
        fileName: () => 'copiloto.js',
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  };
});

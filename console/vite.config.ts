import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev o console roda aqui (5173) e repassa /api e /copiloto.js para o servidor (3000).
const servidor = process.env.COPILOTO_SERVIDOR ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CONSOLE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: servidor, changeOrigin: false },
      '/copiloto.js': { target: servidor },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom' },
} as never);

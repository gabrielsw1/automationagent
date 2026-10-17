// Lint de todo o monorepo (`npm run lint` roda isto e depois o typecheck de cada pacote).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'data/**', '**/coverage/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-control-regex': 'off',
      // Espaços especiais (como o espaço fino do Intl) aparecem de propósito em textos e regex.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }],
      // `const self = this` só onde a função precisa dos dois `this` (ex.: envolver history.pushState).
      '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['self'] }],
    },
  },
  {
    files: ['console/**/*.{ts,tsx}', 'widget/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Extensão do navegador: páginas, content scripts e service worker (os tipos do chrome.* vêm de src/chrome.d.ts).
    files: ['extension/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);

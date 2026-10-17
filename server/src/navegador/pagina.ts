// Código que roda DENTRO da página (page.evaluate).
//
// 1) Tipos: o servidor não carrega a biblioteca DOM do TypeScript; cada arquivo com código de
//    página declara localmente só os nomes que usa (declare const document: any; ...).
// 2) `__name`: quando o servidor roda com tsx (esbuild com keepNames), as funções internas do
//    código de página ganham chamadas a `__name(fn, "nome")`, que não existe no navegador.
//    Use `avaliar(page, fn, arg)` para código de página com funções internas, e
//    `SCRIPT_NOMES` como init script do contexto (cobre locator.evaluate).
import type { Page } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementoDom = any;

/** Define `__name` na página quando não existe (é só um marcador de nome, não muda nada). */
export const SCRIPT_NOMES = 'if (typeof globalThis.__name !== "function") { globalThis.__name = function (f) { return f; }; }';

/** Como page.evaluate(fn, arg), mas funciona mesmo com o código transformado pelo tsx. */
export async function avaliar<A, R>(page: Page, fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
  const codigo = `(() => { ${SCRIPT_NOMES} return (${fn.toString()})(${JSON.stringify(arg ?? null)}); })()`;
  return (await page.evaluate(codigo)) as R;
}

// Tipos mínimos para o código que roda DENTRO da página (page.evaluate). O servidor não carrega
// a biblioteca DOM do TypeScript; cada arquivo com código de página declara estes nomes localmente:
//   declare const document: any; declare const window: any; ...
// Este arquivo só documenta o padrão e exporta o tipo genérico de elemento.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementoDom = any;

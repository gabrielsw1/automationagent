// Ponte entre os dois content scripts da página, por eventos no document:
// - pagina.ts roda no mundo da página (como o widget) e captura com a Captura do widget;
// - index.ts roda no mundo isolado da extensão, desenha a barra e fala com o fundo.
// O site também vê esses eventos: por eles passam só comandos e eventos já sem valores digitados.
import type { EventoGravado } from '@copiloto/shared';

export const EVENTO_COMANDO = 'copiloto-extensao:comando';
export const EVENTO_CAPTURA = 'copiloto-extensao:evento';

export type Comando = 'comecar' | 'parar';

export function enviarComando(comando: Comando, doc: Document = document): void {
  doc.dispatchEvent(new CustomEvent(EVENTO_COMANDO, { detail: comando }));
}

/** Elementos do copiloto na página (barra da extensão e widget): não entram na gravação. */
export function ehDoCopiloto(alvo: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && alvo instanceof Element && alvo.closest('[data-copiloto]') !== null;
}

/** Lê o evento que veio do mundo da página (texto JSON) e confere o formato. */
export function lerEvento(detalhe: unknown): EventoGravado | null {
  if (typeof detalhe !== 'string') return null;
  try {
    const e = JSON.parse(detalhe) as Partial<EventoGravado>;
    if (!e || typeof e.tipo !== 'string' || typeof e.ts !== 'number' || typeof e.url !== 'string') return null;
    if (e.elemento && (typeof e.elemento.tag !== 'string' || typeof e.elemento.css !== 'string')) return null;
    return e as EventoGravado;
  } catch {
    return null;
  }
}

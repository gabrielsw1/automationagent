// Parâmetros da URL de gravação que o console abre: ?copiloto_gravacao=<token>&copiloto_api=<servidor>.
// Os mesmos que o widget lê; a extensão tira os dois da barra de endereço antes de qualquer script da página.

export const PARAMETRO_TOKEN = 'copiloto_gravacao';
export const PARAMETRO_API = 'copiloto_api';

export function lerParametros(href: string): { token: string; api: string | null } | null {
  try {
    const u = new URL(href);
    const token = u.searchParams.get(PARAMETRO_TOKEN)?.trim();
    if (!token) return null;
    return { token, api: u.searchParams.get(PARAMETRO_API)?.trim() || null };
  } catch {
    return null;
  }
}

export function semParametros(href: string): string {
  try {
    const u = new URL(href);
    if (!u.searchParams.has(PARAMETRO_TOKEN) && !u.searchParams.has(PARAMETRO_API)) return href;
    u.searchParams.delete(PARAMETRO_TOKEN);
    u.searchParams.delete(PARAMETRO_API);
    return u.toString();
  } catch {
    return href;
  }
}

/** Página onde dá para gravar (a extensão só roda em http e https). */
export function paginaGravavel(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href);
}

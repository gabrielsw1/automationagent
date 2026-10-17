// Endereço do sistema da empresa (cadastro e tela Sistema): as mesmas regras do servidor.

/** Endereço http(s) completo. Ex.: https://erp.suaempresa.com.br */
export function enderecoValido(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host;
  } catch {
    return false;
  }
}

/** "erp.suaempresa.com.br" → "https://erp.suaempresa.com.br" (quando a pessoa esquece o começo). */
export function completarEndereco(v: string): string {
  const t = v.trim();
  if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  return /^[^\s/]+\.[^\s/]+/.test(t) ? `https://${t}` : t;
}

/** Página de login: endereço completo ou caminho dentro do sistema (ex.: /login). */
export function paginaLoginValida(v: string, base: string): boolean {
  const t = v.trim();
  if (!t) return false;
  if (enderecoValido(t)) return true;
  if (!t.startsWith('/') || !enderecoValido(base)) return false;
  try {
    new URL(t, base.trim());
    return true;
  } catch {
    return false;
  }
}

/** "https://app.horizonte.com.br/x" → "app.horizonte.com.br" */
export function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

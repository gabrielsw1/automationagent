// Servidor do copiloto: o das opções (padrão http://localhost:3000) ou o que veio na URL da gravação.
// Fora de localhost e 127.0.0.1, a extensão só fala com um servidor depois de a pessoa liberar o
// endereço nas opções (permissão opcional do Chrome).

export const SERVIDOR_PADRAO = 'http://localhost:3000';
const CHAVE_SERVIDOR = 'servidor';

/** Origem http(s) de um endereço ("https://copiloto.empresa.com.br"), ou null se não for um. */
export function origemDe(endereco: string | null | undefined): string | null {
  if (!endereco) return null;
  try {
    const u = new URL(endereco.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Padrão de permissão do Chrome para o servidor. Sem porta: no Chrome, vale para todas as portas do host. */
export function padraoPermissao(origem: string): string {
  const u = new URL(origem);
  return `${u.protocol}//${u.hostname}/*`;
}

export async function temPermissao(origem: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [padraoPermissao(origem)] });
  } catch {
    return false;
  }
}

export async function servidorConfigurado(): Promise<string> {
  try {
    const r = await chrome.storage.local.get(CHAVE_SERVIDOR);
    return origemDe(r[CHAVE_SERVIDOR] as string | undefined) ?? SERVIDOR_PADRAO;
  } catch {
    return SERVIDOR_PADRAO;
  }
}

export async function salvarServidor(origem: string): Promise<void> {
  await chrome.storage.local.set({ [CHAVE_SERVIDOR]: origem });
}

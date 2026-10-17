// Utilitários pequenos do chat: ids, armazenamento seguro e textos de erro.

export function gerarId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** sessionStorage/localStorage podem não existir ou lançar erro (modo privado, iframe sem permissão). */
export interface Armazenamento {
  ler(chave: string): string | null;
  gravar(chave: string, valor: string): void;
  remover(chave: string): void;
}

export function armazenamento(tipo: 'sessao' | 'local' = 'sessao'): Armazenamento {
  const obter = (): Storage | null => {
    try {
      return tipo === 'sessao' ? globalThis.sessionStorage ?? null : globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    ler(chave) {
      try {
        return obter()?.getItem(chave) ?? null;
      } catch {
        return null;
      }
    },
    gravar(chave, valor) {
      try {
        obter()?.setItem(chave, valor);
      } catch {
        /* sem armazenamento: segue só em memória */
      }
    },
    remover(chave) {
      try {
        obter()?.removeItem(chave);
      } catch {
        /* idem */
      }
    },
  };
}

export function mensagemDeErro(e: unknown, padrao = 'Não deu certo. Tente de novo em instantes.'): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const m = (e as { message: string }).message.trim();
    if (m) return m;
  }
  return padrao;
}

export function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** "Falta: e-mail de cobrança": baixa só a primeira letra, sem estragar siglas (CNPJ, CPF). */
export function minusculaInicial(s: string): string {
  if (s.length < 2) return s.toLowerCase();
  const segunda = s[1];
  if (segunda === segunda.toUpperCase() && segunda !== segunda.toLowerCase()) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Texto puro a partir do markdown simples (para anúncios de leitor de tela e avisos). */
export function textoPuro(md: string): string {
  return md
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ehMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const plataforma =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(plataforma);
}

/** "o copiloto" quando o assistente se chama Copiloto; senão o nome como está ("Hora"). */
export function nomeComArtigo(nome: string): string {
  return nome.trim().toLowerCase() === 'copiloto' ? 'o copiloto' : nome.trim();
}

export function maiusculaInicial(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

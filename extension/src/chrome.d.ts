// Tipos mínimos das APIs do Chrome usadas pela extensão (só o que o código chama), para não
// depender do @types/chrome. Referência: https://developer.chrome.com/docs/extensions/reference/api

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab;
      id?: string;
      url?: string;
    }
    interface Manifest {
      version: string;
      [chave: string]: unknown;
    }
    const id: string;
    function getManifest(): Manifest;
    function getURL(caminho: string): string;
    function openOptionsPage(): Promise<void>;
    function sendMessage<R = unknown>(mensagem: unknown): Promise<R>;
    const onMessage: {
      addListener(
        fn: (mensagem: unknown, remetente: MessageSender, responder: (resposta?: unknown) => void) => boolean | void,
      ): void;
      removeListener(fn: (...args: never[]) => unknown): void;
    };
  }

  namespace storage {
    interface Area {
      get(chaves?: string | string[] | null): Promise<Record<string, unknown>>;
      set(itens: Record<string, unknown>): Promise<void>;
      remove(chaves: string | string[]): Promise<void>;
    }
    const session: Area;
    const local: Area;
    const onChanged: {
      addListener(fn: (mudancas: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
      windowId?: number;
    }
    function query(filtro: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function get(id: number): Promise<Tab>;
    function create(propriedades: { url: string; active?: boolean; openerTabId?: number }): Promise<Tab>;
    function sendMessage<R = unknown>(abaId: number, mensagem: unknown): Promise<R>;
    const onRemoved: { addListener(fn: (abaId: number) => void): void };
  }

  namespace permissions {
    interface Permissoes {
      origins?: string[];
      permissions?: string[];
    }
    function contains(p: Permissoes): Promise<boolean>;
    function request(p: Permissoes): Promise<boolean>;
    const onAdded: { addListener(fn: (p: Permissoes) => void): void };
  }
}

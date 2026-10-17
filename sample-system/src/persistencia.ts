// Persistência opcional do estado em DATA_DIR/horizonte.json (gravação atrasada e atômica).
import fs from 'node:fs';
import path from 'node:path';
import { VERSAO_ESTADO, type Estado } from './dados/tipos.ts';

export interface Persistencia {
  carregar(): Estado | null;
  salvar(estado: Estado): void;
  /** Grava o que estiver pendente agora (ao desligar). */
  descarregar(): void;
}

export function criarPersistencia(arquivo: string): Persistencia {
  let pendente: Estado | null = null;
  let timer: NodeJS.Timeout | null = null;

  const gravar = () => {
    if (!pendente) return;
    const estado = pendente;
    pendente = null;
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const temporario = `${arquivo}.tmp`;
      fs.writeFileSync(temporario, JSON.stringify(estado));
      fs.renameSync(temporario, arquivo);
    } catch (e) {
      console.error(`[horizonte] Não consegui gravar ${arquivo}:`, e);
    }
  };

  return {
    carregar() {
      try {
        const estado = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Estado;
        return estado && estado.versao === VERSAO_ESTADO && Array.isArray(estado.clientes) ? estado : null;
      } catch {
        return null;
      }
    },
    salvar(estado) {
      pendente = estado;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        gravar();
      }, 300);
      timer.unref();
    },
    descarregar() {
      if (timer) clearTimeout(timer);
      timer = null;
      gravar();
    },
  };
}

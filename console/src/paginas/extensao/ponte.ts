// Conversa do console com a extensão do navegador, pela própria janela (window.postMessage). A
// extensão marca o <html> de toda página com a versão (MARCA_EXTENSAO) e o content script dela
// responde às perguntas desta página. Só a aba do console configurado na extensão recebe a conta.
import { useEffect, useRef, useState } from 'react';
import {
  FONTE_CONSOLE,
  MARCA_EXTENSAO,
  ehMensagemDaExtensao,
  type ConexaoExtensao,
  type MensagemDaExtensao,
  type MensagemDoConsole,
} from '@copiloto/shared';

export interface EstadoExtensao {
  /** Marca no <html> (a extensão está instalada e ativa nesta aba). */
  instalada: boolean;
  versao: string | null;
  /** Conta em que a extensão entrou (null: ainda não entrou, ou não respondeu). */
  conexao: ConexaoExtensao | null;
  /** A extensão respondeu e aponta para este console. false: aponta para outro servidor. null: ainda não respondeu. */
  consoleConfigurado: boolean | null;
}

/** Versão da extensão pela marca no <html>, ou null se não estiver instalada. */
export function versaoNaPagina(doc: Document = document): string | null {
  return doc.documentElement.getAttribute(MARCA_EXTENSAO);
}

let contador = 0;
function novoId(): string {
  contador += 1;
  return `c${Date.now().toString(36)}${contador}`;
}

/**
 * Manda uma mensagem à extensão e espera a resposta com o mesmo id (ou null depois de `esperaMs`).
 * Só aceita resposta da própria janela, da mesma origem e no formato da extensão.
 */
export function perguntarExtensao(
  mensagem: Omit<Extract<MensagemDoConsole, { tipo: 'extensao:estado' }>, 'fonte' | 'id'> | Omit<Extract<MensagemDoConsole, { tipo: 'extensao:conectar' }>, 'fonte' | 'id'>,
  esperaMs = 1500,
): Promise<MensagemDaExtensao | null> {
  const id = novoId();
  return new Promise((resolver) => {
    const fim = (r: MensagemDaExtensao | null) => {
      window.removeEventListener('message', aoReceber);
      clearTimeout(relogio);
      resolver(r);
    };
    const aoReceber = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      if (ehMensagemDaExtensao(e.data) && e.data.id === id) fim(e.data);
    };
    window.addEventListener('message', aoReceber);
    const relogio = setTimeout(() => fim(null), esperaMs);
    window.postMessage({ ...mensagem, fonte: FONTE_CONSOLE, id } as MensagemDoConsole, window.location.origin);
  });
}

/**
 * Estado da extensão, atualizado sozinho: a página olha a marca e pergunta à extensão a cada
 * `intervaloMs` (quem instala com a página aberta vê a mudança sem recarregar).
 */
export function useExtensao(intervaloMs = 1500): EstadoExtensao {
  const [estado, setEstado] = useState<EstadoExtensao>(() => {
    const versao = versaoNaPagina();
    return { instalada: !!versao, versao, conexao: null, consoleConfigurado: null };
  });
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const conferir = async () => {
      const versao = versaoNaPagina();
      if (!versao) {
        if (vivo.current) setEstado({ instalada: false, versao: null, conexao: null, consoleConfigurado: null });
      } else {
        const r = await perguntarExtensao({ tipo: 'extensao:estado' });
        if (!vivo.current) return;
        if (r && r.tipo === 'extensao:estado') {
          setEstado((antes) => {
            const novo = { instalada: true, versao: r.versao, conexao: r.conexao, consoleConfigurado: r.consoleConfigurado };
            return JSON.stringify(antes) === JSON.stringify(novo) ? antes : novo;
          });
        } else {
          setEstado((antes) => (antes.instalada && antes.versao === versao ? antes : { instalada: true, versao, conexao: null, consoleConfigurado: null }));
        }
      }
      if (vivo.current) relogio = setTimeout(() => void conferir(), intervaloMs);
    };
    void conferir();
    return () => {
      vivo.current = false;
      clearTimeout(relogio);
    };
  }, [intervaloMs]);

  return estado;
}

/** Navegador desta página, para o botão principal da loja e para o texto do estado. */
export function navegadorAtual(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): 'Edge' | 'Chrome' | 'outro' {
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\b(Chrome|Chromium)\//.test(ua) && !/\b(OPR|Brave)\//.test(ua)) return 'Chrome';
  return 'outro';
}

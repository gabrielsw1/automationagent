// Ações que os cartões das mensagens podem disparar. O painel liga isso ao ControladorChat;
// a prévia estática usa a versão vazia.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AcaoBloco } from '@copiloto/shared';
import { mensagemDeErro } from './util.ts';

export interface PropsLink {
  href: string;
  target?: string;
  rel?: string;
}

export interface AcoesChat {
  enviar(texto: string): void;
  confirmar(execucaoId: string): Promise<void>;
  corrigir(execucaoId: string): Promise<void>;
  cancelarExecucao(execucaoId: string): Promise<void>;
  desfazer(execucaoId: string): Promise<void>;
  enviarAprovacao(aprovacaoId: string): Promise<void>;
  cancelarAprovacao(aprovacaoId: string): Promise<void>;
  pedirHumano(motivo?: string): Promise<void>;
  feedback(mensagemId: string, valor: 'util' | 'nao_util'): Promise<void>;
  executarAcao(acao: AcaoBloco, execucaoId?: string): Promise<void>;
  reenviar(idCliente: string): void;
  descartar(idCliente: string): void;
  novaConversa(): void;
  /** Atributos de um link vindo do servidor (resolve a URL e decide se abre em outra aba). */
  link(url: string): PropsLink;
  preencherComposer(texto: string): void;
  focarComposer(): void;
}

const nada = async () => {};

export const ACOES_VAZIAS: AcoesChat = {
  enviar: () => {},
  confirmar: nada,
  corrigir: nada,
  cancelarExecucao: nada,
  desfazer: nada,
  enviarAprovacao: nada,
  cancelarAprovacao: nada,
  pedirHumano: nada,
  feedback: nada,
  executarAcao: nada,
  reenviar: () => {},
  descartar: () => {},
  novaConversa: () => {},
  link: (url) => ({ href: url, target: '_blank', rel: 'noopener noreferrer' }),
  preencherComposer: () => {},
  focarComposer: () => {},
};

export const ContextoAcoes = createContext<AcoesChat>(ACOES_VAZIAS);

export function useAcoesChat(): AcoesChat {
  return useContext(ContextoAcoes);
}

/** Estado de um botão que chama o servidor: qual ação está carregando e a última mensagem de erro. */
export function useAcaoAssincrona() {
  const [carregando, setCarregando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const montado = useRef(true);
  const ocupado = useRef(false);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  async function executar(chave: string, fn: () => Promise<unknown>): Promise<boolean> {
    if (ocupado.current) return false;
    ocupado.current = true;
    setCarregando(chave);
    setErro(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (montado.current) setErro(mensagemDeErro(e));
      return false;
    } finally {
      ocupado.current = false;
      if (montado.current) setCarregando(null);
    }
  }
  return { carregando, erro, executar };
}

/** Relógio que anda a cada segundo enquanto `ativo` (contagem regressiva do Desfazer). */
export function useAgora(ativo: boolean, intervalo = 1000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), intervalo);
    return () => clearInterval(t);
  }, [ativo, intervalo]);
  return agora;
}

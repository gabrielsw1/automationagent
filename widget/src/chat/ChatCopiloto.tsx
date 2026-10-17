// Chat completo ligado ao servidor, para o console ("Testar copiloto", ficha da tarefa, guia).
// Usa GET /api/widget/sessao com um token já emitido (POST /api/console/teste/token).
import { useEffect, useState } from 'react';
import type { WidgetInicio } from '@copiloto/shared';
import { ClienteApi } from './api.ts';
import { ControladorChat } from './controlador.ts';
import { estiloMarca } from './cor.ts';
import { Icone } from './icones.tsx';
import { Cabecalho, Painel } from './painel.tsx';
import { mensagemDeErro } from './util.ts';

export interface PropsChatCopiloto {
  /** Token do widget (no console: POST /api/console/teste/token). */
  token: string;
  /** Origem do servidor do copiloto. Vazio = mesma origem. */
  apiBase?: string;
  aoFechar?: () => void;
  altura?: number | string;
}

interface Sessao {
  inicio: WidgetInicio;
  controlador: ControladorChat;
}

export function ChatCopiloto({ token, apiBase = '', aoFechar, altura = 640 }: PropsChatCopiloto) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    let controlador: ControladorChat | null = null;
    setSessao(null);
    setErro(null);
    const api = new ClienteApi(apiBase, token);
    api
      .sessao()
      .then((inicio) => {
        if (!ativo) return;
        controlador = new ControladorChat({ api, inicio });
        void controlador.iniciar();
        setSessao({ inicio, controlador });
      })
      .catch((e) => {
        if (ativo) setErro(mensagemDeErro(e, 'Não consegui abrir o chat de teste.'));
      });
    return () => {
      ativo = false;
      controlador?.destruir();
    };
  }, [token, apiBase, tentativa]);

  if (!sessao) {
    return (
      <div className="widget cp-chat" style={{ height: altura }} onKeyDown={(e) => e.key === 'Escape' && aoFechar?.()}>
        <Cabecalho nome="Copiloto" aoFechar={aoFechar} />
        <div className="widget-body cp-corpo">
          {erro ? (
            <div className="empty cp-vazio" role="alert">
              <span className="empty-icon">
                <Icone nome="aviso" tamanho="lg" />
              </span>
              <p>{erro}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTentativa((n) => n + 1)}>
                Tentar de novo
              </button>
            </div>
          ) : (
            <div className="stack-sm cp-carregando" aria-busy="true" aria-label="Abrindo o chat">
              <span className="skel cp-skel-60" />
              <span className="skel cp-skel-90" />
              <span className="skel cp-skel-75" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Painel
      key={token}
      controlador={sessao.controlador}
      modo="console"
      aoFechar={aoFechar}
      altura={altura}
      estilo={estiloMarca(sessao.inicio.config.cor)}
    />
  );
}

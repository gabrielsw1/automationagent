// Prévia estática do widget para a tela Canais do console (C8 "Pré-visualização ao vivo"), sem servidor.
// Reflete nome, boas-vindas, sugestões, cor principal (--brand-* locais), posição e atalho.
import { useMemo, type CSSProperties } from 'react';
import type { WidgetConfigPublica } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { Composer } from './composer.tsx';
import { variaveisMarca } from './cor.ts';
import { Icone } from './icones.tsx';
import { BoasVindas, Cabecalho, DicaComposer, placeholderBoasVindas } from './painel.tsx';
import { ehMac } from './util.ts';

export interface PropsPreviaWidget {
  config: WidgetConfigPublica;
  usuarioNome: string;
  pagina?: string;
}

export function PreviaWidget({ config, usuarioNome, pagina }: PropsPreviaWidget) {
  const estilo = useMemo(() => (variaveisMarca(config.cor) ?? {}) as CSSProperties, [config.cor]);
  const sugestoes = config.sugestoes.filter((s) => s.trim()).slice(0, 4).map((s) => ({ rotulo: s, mensagem: s }));
  const esquerda = config.posicao === 'esquerda';
  return (
    <div className={`cp-previa${esquerda ? ' cp-previa-esquerda' : ''}`} style={estilo}>
      <p className="sr-only">
        Pré-visualização do widget como {usuarioNome} veria, com o botão à {esquerda ? 'esquerda' : 'direita'} da tela.
      </p>
      <div className="widget cp-chat" inert aria-hidden="true">
        <Cabecalho nome={config.nome || 'Copiloto'} aoMinimizar={() => {}} />
        <div className="widget-body cp-corpo cp-corpo-ola">
          <BoasVindas
            primeiroNome={fmt.primeiroNome(usuarioNome) || usuarioNome}
            boasVindas={config.boasVindas}
            secao={pagina}
            sugestoes={sugestoes}
            recentes={[]}
          />
        </div>
        <div className="widget-foot">
          <Composer rotulo="Mensagem" placeholder={placeholderBoasVindas(sugestoes)} linhas={2} voz={false} />
          <DicaComposer horario={config.atendimentoHumano.horario} />
        </div>
      </div>
      <div className="cp-previa-lancador" aria-hidden="true">
        {config.atalho && (
          <span className="cp-dica-atalho">
            Abrir o copiloto: <span className="kbd">{ehMac() ? 'Cmd' : 'Ctrl'}</span> + <span className="kbd">K</span>
          </span>
        )}
        <span className="launcher cp-lancador">
          <Icone nome="brilho" tamanho="lg" />
        </span>
      </div>
    </div>
  );
}

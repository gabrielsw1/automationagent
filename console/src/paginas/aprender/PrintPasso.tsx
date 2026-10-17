// Print de um passo (capturado no teste do fluxo), com o contorno no elemento usado.
// A imagem vem de GET /api/console/prints/:id e o contorno de GET /prints/:id/info.
import { useState } from 'react';
import { fmt } from '@copiloto/shared';
import { api } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Icone } from '../../componentes/icones.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import type { Destaque, InfoPrint } from './comum.tsx';

export function PrintPasso({
  printId,
  titulo,
  destaque,
  limitado = true,
  legenda,
  podeAmpliar = true,
}: {
  printId: string;
  /** Texto alternativo: o que o passo fez. */
  titulo: string;
  /** Contorno vindo do evento (quando já se tem); senão usa o guardado com o print. */
  destaque?: Destaque | null;
  limitado?: boolean;
  legenda?: string;
  podeAmpliar?: boolean;
}) {
  const info = useApi<InfoPrint>(`/prints/${encodeURIComponent(printId)}/info`);
  const [falhou, setFalhou] = useState(false);
  const [ampliado, setAmpliado] = useState(false);

  const status = info.erro?.status;
  if (falhou || status === 404 || status === 410) {
    return (
      <div className="ap-print-vazio small">
        <div className="stack-sm" style={{ alignItems: 'center' }}>
          <Icone nome="info" />
          <span>
            {status === 410
              ? 'Este print já foi apagado: passou o prazo de guarda definido em Segurança. Teste o fluxo de novo para ver a tela.'
              : 'Não consegui abrir este print. Teste o fluxo de novo para capturar a tela.'}
          </span>
        </div>
      </div>
    );
  }

  const caixa = destaque ?? info.dados?.destaque ?? null;
  const largura = info.dados?.largura ?? null;
  const altura = info.dados?.altura ?? null;
  const contorno =
    caixa && largura && altura
      ? {
          left: `${(Math.max(0, caixa.x - 4) / largura) * 100}%`,
          top: `${(Math.max(0, caixa.y - 4) / altura) * 100}%`,
          width: `${((caixa.w + 8) / largura) * 100}%`,
          height: `${((caixa.h + 8) / altura) * 100}%`,
        }
      : null;
  const textoLegenda =
    legenda ??
    (info.dados
      ? `Print do teste de ${fmt.dataHora(info.dados.criadoEm)}.${info.dados.mascarado ? ' CPF, CNPJ, e-mails e senhas aparecem borrados.' : ''}`
      : 'Carregando o print…');

  const quadro = (limite: boolean) => (
    <div className={`ap-print-quadro${limite ? ' limitado' : ''}`}>
      <img src={api.url(`/prints/${encodeURIComponent(printId)}`)} alt={`Tela do passo: ${titulo}`} onError={() => setFalhou(true)} loading="lazy" />
      {contorno ? <span className="ap-print-destaque" style={contorno} aria-hidden="true" /> : null}
    </div>
  );

  return (
    <figure className="ap-print">
      <div style={{ position: 'relative' }}>
        {quadro(limitado)}
        {podeAmpliar ? (
          <button type="button" className="btn btn-secondary btn-sm ap-print-ampliar" onClick={() => setAmpliado(true)}>
            Ampliar
          </button>
        ) : null}
      </div>
      <figcaption className="row tiny muted" style={{ gap: 6 }}>
        <Icone nome="info" tamanho="sm" />
        {textoLegenda}
      </figcaption>
      {podeAmpliar ? (
        <Modal aberto={ampliado} titulo={titulo} aoFechar={() => setAmpliado(false)} largura={1100}>
          {quadro(false)}
        </Modal>
      ) : null}
    </figure>
  );
}

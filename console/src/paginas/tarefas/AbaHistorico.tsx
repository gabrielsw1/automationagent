// Histórico de versões da tarefa (C3), com "Restaurar como rascunho".
import { useState } from 'react';
import type { VersaoTarefa } from '@copiloto/shared';
import { Botao } from '../../componentes/Botao.tsx';
import { Confirmar } from '../../componentes/Modal.tsx';
import { quandoAs } from './ficha.ts';

const SELO: Record<VersaoTarefa['status'], { classe: string; rotulo: string }> = {
  publicada: { classe: 'badge-success', rotulo: 'Em uso' },
  rascunho: { classe: 'badge-warning', rotulo: 'Rascunho' },
  arquivada: { classe: 'badge-outline', rotulo: 'Anterior' },
};

export default function AbaHistorico({
  historico,
  podeEditar,
  versaoRascunho,
  sujo,
  restaurar,
}: {
  historico: VersaoTarefa[];
  podeEditar: boolean;
  versaoRascunho: number | null;
  sujo: boolean;
  /** Rejeita com a mensagem de erro. */
  restaurar: (versao: number) => Promise<void>;
}) {
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ordenado = [...historico].sort((a, b) => b.versao - a.versao);

  const confirmar = async () => {
    if (escolhida === null) return;
    setCarregando(true);
    setErro(null);
    try {
      await restaurar(escolhida);
      setEscolhida(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <section className="card" aria-labelledby="historico-titulo">
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h4" id="historico-titulo">
            Histórico de versões
          </h2>
          <span className="small muted">Cada publicação vira uma versão. O copiloto usa sempre a versão em uso.</span>
        </div>
      </div>
      {ordenado.length === 0 ? (
        <div className="card-body">
          <p className="small muted">Ainda não há versões. Publique a tarefa para começar o histórico.</p>
        </div>
      ) : (
        <ol className="ct-historico ct-lista-limpa">
          {ordenado.map((v) => (
            <li key={v.versao} className="row-top ct-versao">
              <span className={`ct-versao-ponto${v.status === 'publicada' ? ' is-atual' : ''}`} aria-hidden="true" />
              <div className="stack-sm grow" style={{ gap: 2, minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
                  <span className="strong">Versão {v.versao}</span>
                  <span className={`badge ${SELO[v.status].classe}`}>{SELO[v.status].rotulo}</span>
                </div>
                <span className="small muted">
                  {v.status === 'rascunho'
                    ? 'Ainda não publicada.'
                    : v.publicadoEm
                      ? `Publicada ${v.publicadoPor ? `por ${v.publicadoPor} ` : ''}${quandoAs(v.publicadoEm)}.`
                      : 'Publicada.'}
                </span>
                {v.resumoMudancas ? <p className="small ct-quebra">{v.resumoMudancas}</p> : null}
              </div>
              {podeEditar && v.status !== 'rascunho' ? (
                <Botao variante="fantasma" tamanho="sm" icone="desfazer" onClick={() => (setErro(null), setEscolhida(v.versao))}>
                  Restaurar como rascunho
                </Botao>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <Confirmar
        aberto={escolhida !== null}
        titulo={`Restaurar a versão ${escolhida ?? ''} como rascunho?`}
        texto={
          <>
            {versaoRascunho
              ? `O rascunho atual (versão ${versaoRascunho}) será substituído pela ficha da versão ${escolhida}.`
              : `A ficha da versão ${escolhida} vira um rascunho novo para você revisar.`}{' '}
            {sujo ? 'As mudanças não salvas nesta tela serão perdidas. ' : ''}A versão em uso continua valendo até você publicar.
          </>
        }
        rotuloConfirmar="Restaurar como rascunho"
        carregando={carregando}
        erro={erro}
        aoConfirmar={() => void confirmar()}
        aoFechar={() => setEscolhida(null)}
      />
    </section>
  );
}

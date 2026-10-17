// Cartão de uma fonte: tipo, status, o que foi lido, progresso, erro com "como resolver" e ações.
import { useRef } from 'react';
import type { FonteConhecimento } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { Botao, Icone, Progresso } from '../../componentes/index.ts';
import { EXTENSOES_ARQUIVO, IconeEnviar, IconeTipo, quandoEnviado } from './comum.tsx';

export interface AcoesFonte {
  verTrechos: (f: FonteConhecimento) => void;
  sincronizar: (f: FonteConhecimento) => void;
  pausar: (f: FonteConhecimento) => void;
  remover: (f: FonteConhecimento) => void;
  trocarArquivo: (f: FonteConhecimento, arquivo: File) => void;
  adicionarResposta: () => void;
}

function Selo({ f }: { f: FonteConhecimento }) {
  if (f.status === 'indexando') {
    return (
      <span className="badge badge-info">
        <span className="spinner ca-spinner-selo" aria-hidden="true" />
        Indexando
      </span>
    );
  }
  if (f.status === 'erro') {
    return (
      <span className="badge badge-danger">
        <Icone nome="alerta" tamanho="sm" />
        Erro
      </span>
    );
  }
  if (f.status === 'pausado') {
    return (
      <span className="badge badge-outline">
        <span className="dot" />
        Pausada
      </span>
    );
  }
  const quando = f.sincronizadoEm ? fmt.haQuanto(f.sincronizadoEm) : null;
  return (
    <span className="badge badge-success" title={f.sincronizadoEm ? `Lida em ${fmt.dataHora(f.sincronizadoEm)}` : undefined}>
      <span className="dot" />
      {f.tipo === 'site' && quando ? `Sincronizada ${quando === 'agora' ? 'agora' : quando}` : 'Indexado'}
    </span>
  );
}

function Subtitulo({ f }: { f: FonteConhecimento }) {
  if (f.tipo === 'site') {
    return (
      <p className="small mono muted cn-quebra" title={f.origem}>
        {f.origem.replace(/^https?:\/\//, '')}
      </p>
    );
  }
  if (f.tipo === 'respostas') return <p className="small muted">Escritas pela equipe no console</p>;
  return <p className="small muted">{quandoEnviado(f)}</p>;
}

function Detalhe({ texto }: { texto: string }) {
  if (!texto) return null;
  const [primeiro, ...resto] = texto.split(' · ');
  return (
    <p className="small">
      <span className="strong num">{primeiro}</span>
      {resto.length ? ` · ${resto.join(' · ')}` : ''}
    </p>
  );
}

export function CartaoFonte({
  fonte: f,
  podeEditar,
  online,
  ocupado,
  acoes,
}: {
  fonte: FonteConhecimento;
  podeEditar: boolean;
  online: boolean;
  /** Ação desta fonte em andamento (desativa os botões). */
  ocupado: boolean;
  acoes: AcoesFonte;
}) {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const idTitulo = `fonte-${f.id}-t`;
  const bloqueado = !online || ocupado;
  const rotuloVer = f.tipo === 'respostas' ? 'Ver respostas' : f.tipo === 'site' ? 'Ver páginas' : 'Ver trechos';
  const escolherArquivo = () => arquivoRef.current?.click();

  const verTrechos =
    f.trechos > 0 ? (
      <Botao variante="fantasma" tamanho="sm" onClick={() => acoes.verTrechos(f)}>
        {rotuloVer}
      </Botao>
    ) : null;
  const remover = (
    <Botao variante="fantasma" tamanho="sm" disabled={bloqueado} onClick={() => acoes.remover(f)}>
      Remover
    </Botao>
  );

  let botoes: React.ReactNode;
  if (!podeEditar) {
    botoes = verTrechos;
  } else if (f.tipo === 'respostas' && f.status !== 'erro' && f.status !== 'pausado') {
    botoes = (
      <>
        {verTrechos}
        <Botao tamanho="sm" icone="mais" disabled={bloqueado} onClick={acoes.adicionarResposta}>
          Adicionar resposta
        </Botao>
      </>
    );
  } else if (f.status === 'indexando') {
    botoes = (
      <>
        {verTrechos}
        <Botao tamanho="sm" disabled={bloqueado} carregando={ocupado} onClick={() => acoes.pausar(f)}>
          Pausar
        </Botao>
      </>
    );
  } else if (f.status === 'erro') {
    botoes = (
      <>
        {remover}
        {f.tipo === 'arquivo' ? (
          <Botao variante="primario" tamanho="sm" disabled={bloqueado} carregando={ocupado} onClick={escolherArquivo}>
            <IconeEnviar pequeno />
            Enviar de novo
          </Botao>
        ) : (
          <Botao variante="primario" tamanho="sm" icone="atualizar" disabled={bloqueado} carregando={ocupado} onClick={() => acoes.sincronizar(f)}>
            Tentar de novo
          </Botao>
        )}
      </>
    );
  } else if (f.status === 'pausado') {
    botoes = (
      <>
        {remover}
        <Botao tamanho="sm" icone="atualizar" disabled={bloqueado} carregando={ocupado} onClick={() => acoes.sincronizar(f)}>
          Retomar
        </Botao>
      </>
    );
  } else {
    botoes = (
      <>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm cn-remover"
          aria-label={`Remover ${f.nome}`}
          title="Remover fonte"
          disabled={bloqueado}
          onClick={() => acoes.remover(f)}
        >
          <Icone nome="lixeira" tamanho="sm" />
        </button>
        {verTrechos}
        {f.tipo === 'arquivo' ? (
          <Botao tamanho="sm" disabled={bloqueado} carregando={ocupado} onClick={escolherArquivo}>
            <IconeEnviar pequeno />
            Trocar versão
          </Botao>
        ) : (
          <Botao tamanho="sm" icone="atualizar" disabled={bloqueado} carregando={ocupado} onClick={() => acoes.sincronizar(f)}>
            Sincronizar agora
          </Botao>
        )}
      </>
    );
  }

  const progresso = f.progresso && f.progresso.total > 0 ? f.progresso : null;
  return (
    <article className="card cn-fonte" id={`fonte-${f.id}`} aria-labelledby={idTitulo}>
      <div className="card-body stack cn-fonte-corpo">
        <div className="row-top between">
          <IconeTipo tipo={f.tipo} />
          <Selo f={f} />
        </div>
        <div className="stack-sm">
          <h3 className="h4 cn-quebra" id={idTitulo}>
            {f.nome}
          </h3>
          <Subtitulo f={f} />
        </div>
        {f.status === 'erro' ? (
          <div className="stack-sm">
            <p className="small text-danger strong">{f.erro ?? 'Não foi possível ler esta fonte.'}</p>
            {f.comoResolver ? <p className="tiny muted">{f.comoResolver}</p> : null}
            {f.trechos === 0 ? <p className="tiny muted">Enquanto isso, o copiloto não usa esta fonte.</p> : null}
          </div>
        ) : f.status === 'indexando' ? (
          <div className="stack-sm">
            <div className="row between small">
              <span>
                {progresso ? (
                  <>
                    Indexando{' '}
                    <span className="strong num">
                      {progresso.feitos} de {progresso.total}
                    </span>
                  </>
                ) : (
                  'Lendo o conteúdo…'
                )}
              </span>
              {progresso ? <span className="muted num">{Math.round((progresso.feitos / progresso.total) * 100)}%</span> : null}
            </div>
            {progresso ? (
              <Progresso valor={progresso.feitos / progresso.total} rotulo={`Indexação de ${f.nome}`} />
            ) : (
              <div className="progress cn-progresso-indefinido" role="progressbar" aria-label={`Indexação de ${f.nome}`}>
                <span />
              </div>
            )}
            <p className="tiny muted">
              {f.trechos > 0 ? `Os ${f.trechos} trechos prontos já podem ser citados.` : 'Os trechos ficam disponíveis assim que forem lidos.'}
            </p>
          </div>
        ) : (
          <>
            <Detalhe texto={f.detalhe} />
            {f.status === 'pausado' ? (
              <p className="tiny muted">Pausada: o copiloto não usa esta fonte até você retomar.</p>
            ) : null}
          </>
        )}
      </div>
      {botoes ? <div className="card-foot cn-fonte-acoes">{botoes}</div> : null}
      {podeEditar && f.tipo === 'arquivo' ? (
        <input
          ref={arquivoRef}
          type="file"
          hidden
          accept={EXTENSOES_ARQUIVO.map((e) => `.${e}`).join(',')}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = '';
            if (arquivo) acoes.trocarArquivo(f, arquivo);
          }}
        />
      ) : null}
    </article>
  );
}

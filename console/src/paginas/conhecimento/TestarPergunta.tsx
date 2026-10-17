// "Testar uma pergunta": pergunta como um usuário, mostra a resposta com as fontes citadas
// numeradas e a confiança. Não aparece para os usuários.
import { useState, type FormEvent } from 'react';
import type { RespostaTeste } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Aviso, Botao, Icone, useToast } from '../../componentes/index.ts';
import { segundos, TextoComCitacoes } from './comum.tsx';

const ROTULO_CONFIANCA: Record<RespostaTeste['confianca'], string> = {
  alta: 'confiança alta',
  media: 'confiança média',
  baixa: 'confiança baixa',
};

export function TestarPergunta({
  online,
  podeEditar,
  aoSemResposta,
  aoCorrigir,
}: {
  online: boolean;
  podeEditar: boolean;
  /** A pergunta ficou sem resposta (foi para a lista). */
  aoSemResposta: () => void;
  /** "Não, corrigir": abre a resposta pronta com a pergunta preenchida. */
  aoCorrigir: (pergunta: string) => void;
}) {
  const toast = useToast();
  const [pergunta, setPergunta] = useState('');
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ pergunta: string; resposta: RespostaTeste } | null>(null);
  const [avaliada, setAvaliada] = useState(false);

  async function perguntar(e?: FormEvent) {
    e?.preventDefault();
    const p = pergunta.trim();
    if (p.length < 2) {
      setErroCampo('Escreva uma pergunta para testar.');
      return;
    }
    setErroCampo(null);
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await api.post<RespostaTeste>('/conhecimento/testar', { pergunta: p });
      setResultado({ pergunta: p, resposta });
      setAvaliada(false);
      if (resposta.confianca === 'baixa') aoSemResposta();
    } catch (err) {
      setErro((err as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  }

  const r = resultado?.resposta;
  return (
    <section className="card cn-testar" aria-labelledby="cn-t-testar">
      <div className="card-head">
        <h2 className="h4" id="cn-t-testar">
          Testar uma pergunta
        </h2>
        <span className="tiny muted">Não aparece para os usuários</span>
      </div>
      <div className="card-body stack">
        <form className="field" onSubmit={(e) => void perguntar(e)} noValidate>
          <label htmlFor="cn-pergunta-teste">Pergunte como um usuário perguntaria</label>
          <div className="input-group">
            <input
              id="cn-pergunta-teste"
              className={`input${erroCampo ? ' is-error' : ''}`}
              type="text"
              maxLength={500}
              placeholder="Como emito a segunda via de um boleto vencido?"
              value={pergunta}
              aria-invalid={erroCampo ? true : undefined}
              aria-describedby={erroCampo ? 'cn-pergunta-erro' : undefined}
              onChange={(e) => setPergunta(e.target.value)}
            />
            <Botao variante="primario" type="submit" carregando={enviando} disabled={!online}>
              Perguntar
            </Botao>
          </div>
          {erroCampo ? (
            <span className="error-text" id="cn-pergunta-erro">
              <Icone nome="alerta" tamanho="sm" />
              {erroCampo}
            </span>
          ) : null}
        </form>

        {erro ? (
          <Aviso tipo="erro" titulo="Não deu para testar agora">
            {erro}
          </Aviso>
        ) : null}

        {enviando && !r ? (
          <div className="msg msg-bot" aria-live="polite">
            <span className="avatar avatar-bot avatar-sm" aria-hidden="true">
              <Icone nome="copiloto" tamanho="sm" />
            </span>
            <div className="bubble">
              <span className="typing" aria-label="Procurando nas fontes">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        ) : null}

        {r && resultado ? (
          <div className={`stack${enviando ? ' cn-desbotado' : ''}`} aria-live="polite">
            <p className="tiny muted">
              Pergunta: <span className="strong">{resultado.pergunta}</span>
            </p>
            <div className="msg msg-bot cn-msg">
              <span className="avatar avatar-bot avatar-sm" aria-hidden="true">
                <Icone nome="copiloto" tamanho="sm" />
              </span>
              <div className="stack-sm">
                <div className="bubble stack-sm">
                  <TextoComCitacoes texto={r.texto} prefixo="cn-citacao" />
                </div>
                <div className="msg-meta">
                  Respondido em {segundos(r.duracaoMs)} ·{' '}
                  <span className={r.confianca === 'alta' ? 'text-success' : r.confianca === 'baixa' ? 'text-danger' : 'text-warning'}>
                    {ROTULO_CONFIANCA[r.confianca]}
                  </span>
                </div>
              </div>
            </div>

            {r.citacoes.length ? (
              <div className="card-flat stack-sm cn-citacoes">
                <p className="eyebrow">Fontes citadas</p>
                <ol className="stack-sm small">
                  {r.citacoes.map((c) => {
                    const rotulo = c.local ? `${c.titulo}, ${c.local}` : c.titulo;
                    return (
                      <li key={c.n} id={`cn-citacao-${c.n}`}>
                        {c.url && /^https?:/.test(c.url) ? (
                          <a href={c.url} target="_blank" rel="noreferrer">
                            {rotulo}
                            <Icone nome="externo" tamanho="sm" className="cn-icone-link" />
                          </a>
                        ) : (
                          <span>{rotulo}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}

            {r.confianca === 'baixa' ? (
              <Aviso
                tipo="aviso"
                titulo="As fontes não respondem a esta pergunta"
                acoes={
                  podeEditar ? (
                    <Botao tamanho="sm" icone="editar" onClick={() => aoCorrigir(resultado.pergunta)}>
                      Escrever a resposta
                    </Botao>
                  ) : undefined
                }
              >
                Ela entrou na lista de perguntas sem boa resposta. Escreva uma resposta pronta ou adicione uma fonte que fale disso.
              </Aviso>
            ) : avaliada ? (
              <p className="small muted" role="status">
                Obrigado. Se algo mudar, teste de novo.
              </p>
            ) : (
              <div className="row wrap">
                <span className="small muted">A resposta está certa?</span>
                <Botao
                  tamanho="sm"
                  icone="check"
                  onClick={() => {
                    setAvaliada(true);
                    toast.sucesso('Ótimo. O copiloto responde assim para os usuários.');
                  }}
                >
                  Sim
                </Botao>
                {podeEditar ? (
                  <Botao tamanho="sm" onClick={() => aoCorrigir(resultado.pergunta)}>
                    Não, corrigir
                  </Botao>
                ) : null}
              </div>
            )}
          </div>
        ) : !enviando ? (
          <p className="small muted">
            O copiloto procura nas fontes em uso, responde só com o que encontrar e numera de onde tirou cada parte.
          </p>
        ) : null}
      </div>
    </section>
  );
}

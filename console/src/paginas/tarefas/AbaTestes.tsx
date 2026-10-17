// Testes da tarefa (C3): frases com o resultado esperado do primeiro turno do agente, a última
// rodada e o resumo que aparece na coluna lateral da ficha.
import { useId, useState, type FormEvent } from 'react';
import type { CasoDeTeste, RodadaTestes, TarefaDefinicao } from '@copiloto/shared';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Progresso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { quandoAs } from './ficha.ts';

export interface EstadoRodada {
  rodando: boolean;
  erro: string | null;
  rodar: () => void;
}

const ROTULO_RESULTADO: Record<CasoDeTeste['esperado']['resultado'], string> = {
  pergunta: 'Pergunta um campo',
  confirmacao: 'Mostra a confirmação',
  recusa: 'Recusa ou explica',
};

/** "Perguntar o E-mail de cobrança", "Mostrar o cartão de confirmação"... */
export function descricaoEsperado(c: CasoDeTeste, def: TarefaDefinicao): string {
  const e = c.esperado;
  if (e.resultado === 'pergunta') {
    const campo = def.campos.find((x) => x.chave === e.campoPerguntado);
    return campo ? `Perguntar ${campo.rotulo.toLowerCase()}` : 'Perguntar um dado que falta';
  }
  if (e.resultado === 'confirmacao') {
    const vals = Object.entries(e.campos ?? {});
    return vals.length ? `Mostrar a confirmação com ${vals.map(([k, v]) => `${k} = ${v}`).join(', ')}` : 'Mostrar o cartão de confirmação';
  }
  return 'Recusar ou explicar que não dá';
}

function corDaRodada(r: RodadaTestes): 'badge-success' | 'badge-warning' | 'badge-danger' {
  if (r.aprovados === r.total) return 'badge-success';
  return r.aprovados / Math.max(1, r.total) >= 0.7 ? 'badge-warning' : 'badge-danger';
}

export function textoRodada(r: RodadaTestes, versaoRascunho: number | null): string {
  return `Última rodada ${quandoAs(r.criadoEm)}, com ${versaoRascunho === r.versao ? 'o rascunho da' : 'a'} versão ${r.versao}.`;
}

export function SeloRodada({ rodada }: { rodada: RodadaTestes | null }) {
  if (!rodada) return <span className="badge">Ainda não rodou</span>;
  return (
    <span className={`badge ${corDaRodada(rodada)}`}>
      {rodada.aprovados} de {rodada.total} aprovados
    </span>
  );
}

function ResultadoLinha({ caso, rodada, def }: { caso: CasoDeTeste; rodada: RodadaTestes | null; def: TarefaDefinicao }) {
  const r = rodada?.resultados.find((x) => x.casoId === caso.id);
  return (
    <>
      <span className={r ? (r.aprovado ? 'text-success' : 'text-danger') : 'muted'} aria-label={r ? (r.aprovado ? 'Aprovado' : 'Reprovado') : 'Ainda não rodou'}>
        <Icone nome={r ? (r.aprovado ? 'check' : 'erro') : 'relogio'} />
      </span>
      <div className="stack-sm grow" style={{ gap: 2, minWidth: 0 }}>
        <span className="small strong ct-quebra">“{caso.frase}”</span>
        {r ? (
          <span className={`tiny ${r.aprovado ? 'muted' : 'text-danger'}`}>
            {r.obtido}
            {!r.aprovado && r.esperado ? ` ${r.esperado}` : ''}
          </span>
        ) : (
          <span className="tiny muted">Esperado: {descricaoEsperado(caso, def).toLowerCase()}.</span>
        )}
      </div>
    </>
  );
}

/** Resumo da coluna lateral: selo, barra, três resultados (reprovados primeiro) e "Rodar testes". */
export function ResumoTestes({
  testes,
  rodada,
  def,
  versaoRascunho,
  podeEditar,
  estado,
  verTodos,
}: {
  testes: CasoDeTeste[];
  rodada: RodadaTestes | null;
  def: TarefaDefinicao;
  versaoRascunho: number | null;
  podeEditar: boolean;
  estado: EstadoRodada;
  verTodos: () => void;
}) {
  const ordem = (c: CasoDeTeste) => {
    const r = rodada?.resultados.find((x) => x.casoId === c.id);
    return r ? (r.aprovado ? 1 : 0) : 2;
  };
  const destaque = [...testes].sort((a, b) => ordem(a) - ordem(b)).slice(0, 3);
  return (
    <section className="card" aria-labelledby="testes-resumo-titulo">
      <div className="card-head">
        <h2 className="h4" id="testes-resumo-titulo">
          Testes
        </h2>
        {testes.length ? <SeloRodada rodada={rodada} /> : null}
      </div>
      <div className="card-body stack">
        {testes.length === 0 ? (
          <p className="small muted">Nenhum teste ainda. Testes conferem se o copiloto entende as frases da equipe antes de você publicar.</p>
        ) : (
          <>
            {rodada ? (
              <div className="stack-sm">
                <Progresso
                  valor={rodada.aprovados / Math.max(1, rodada.total)}
                  rotulo={`${rodada.aprovados} de ${rodada.total} aprovados`}
                  cor={rodada.aprovados === rodada.total ? 'var(--success-500)' : 'var(--warning-500)'}
                />
                <span className="tiny muted">{textoRodada(rodada, versaoRascunho)}</span>
              </div>
            ) : null}
            <ul className="stack ct-lista-limpa">
              {destaque.map((c) => (
                <li key={c.id} className="row-top" style={{ gap: 'var(--s-2)' }}>
                  <ResultadoLinha caso={c} rodada={rodada} def={def} />
                </li>
              ))}
            </ul>
          </>
        )}
        {estado.erro ? (
          <p className="small text-danger" role="alert">
            {estado.erro}
          </p>
        ) : null}
      </div>
      <div className="card-foot" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="ct-link small strong" onClick={verTodos}>
          {testes.length ? `Ver ${testes.length === 1 ? 'o teste' : `os ${testes.length} testes`}` : 'Adicionar testes'}
        </button>
        {podeEditar && testes.length ? (
          <Botao tamanho="sm" icone="play" carregando={estado.rodando} onClick={estado.rodar}>
            Rodar testes
          </Botao>
        ) : null}
      </div>
    </section>
  );
}

export default function AbaTestes({
  testes,
  rodada,
  def,
  versaoRascunho,
  podeEditar,
  estado,
  salvarTestes,
}: {
  testes: CasoDeTeste[];
  rodada: RodadaTestes | null;
  def: TarefaDefinicao;
  versaoRascunho: number | null;
  podeEditar: boolean;
  estado: EstadoRodada;
  /** Grava a lista inteira (PUT /tarefas/:id/testes). Rejeita com a mensagem de erro. */
  salvarTestes: (casos: CasoDeTeste[]) => Promise<void>;
}) {
  const id = useId();
  const [frase, setFrase] = useState('');
  const [resultado, setResultado] = useState<CasoDeTeste['esperado']['resultado']>('pergunta');
  const [campo, setCampo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);

  const fraseCurta = frase.trim().length < 3;
  const semCampo = resultado === 'pergunta' && !campo;
  const exemplosSemTeste = def.exemplos.filter((e) => !testes.some((t) => t.frase.trim().toLowerCase() === e.trim().toLowerCase()));

  const gravar = async (casos: CasoDeTeste[]) => {
    setSalvando(true);
    setErro(null);
    try {
      await salvarTestes(casos);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const adicionar = async (e: FormEvent) => {
    e.preventDefault();
    setTentou(true);
    if (fraseCurta || semCampo) return;
    const novo: CasoDeTeste = {
      id: `caso-${Date.now().toString(36)}`,
      frase: frase.trim(),
      esperado: { resultado, ...(resultado === 'pergunta' ? { campoPerguntado: campo } : {}) },
    };
    if (await gravar([...testes, novo])) {
      setFrase('');
      setTentou(false);
    }
  };

  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="testes-titulo">
        <div className="card-head wrap">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h4" id="testes-titulo">
              Testes
            </h2>
            <span className="small muted">Cada teste é uma frase da equipe e o que o copiloto deve fazer na primeira resposta.</span>
          </div>
          <div className="row wrap">
            {testes.length ? <SeloRodada rodada={rodada} /> : null}
            {podeEditar && testes.length ? (
              <Botao variante="primario" tamanho="sm" icone="play" carregando={estado.rodando} onClick={estado.rodar}>
                Rodar testes
              </Botao>
            ) : null}
          </div>
        </div>
        <div className="card-body stack">
          {rodada ? (
            <div className="stack-sm">
              <Progresso
                valor={rodada.aprovados / Math.max(1, rodada.total)}
                rotulo={`${rodada.aprovados} de ${rodada.total} aprovados`}
                cor={rodada.aprovados === rodada.total ? 'var(--success-500)' : 'var(--warning-500)'}
              />
              <span className="tiny muted">{textoRodada(rodada, versaoRascunho)}</span>
            </div>
          ) : null}
          {estado.rodando ? (
            <p className="row small muted" role="status">
              <span className="spinner" aria-hidden="true" />
              Rodando {testes.length === 1 ? 'o teste' : `os ${testes.length} testes`} com o rascunho. Pode levar até um minuto…
            </p>
          ) : null}
          {estado.erro ? (
            <Aviso tipo="erro" titulo="Os testes não rodaram" papel="alert">
              {estado.erro}
            </Aviso>
          ) : null}
          {erro ? (
            <Aviso tipo="erro" papel="alert">
              {erro}
            </Aviso>
          ) : null}
          {testes.length === 0 ? (
            <p className="small muted">Nenhum teste ainda. Adicione frases do jeito que a equipe escreve, inclusive pedidos que a tarefa não deve aceitar.</p>
          ) : (
            <ul className="ct-lista-testes ct-lista-limpa">
              {testes.map((c) => (
                <li key={c.id} className="row-top">
                  <ResultadoLinha caso={c} rodada={rodada} def={def} />
                  <span className="badge ct-selo-esperado" title={descricaoEsperado(c, def)}>
                    {ROTULO_RESULTADO[c.esperado.resultado]}
                  </span>
                  {podeEditar ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label={`Remover o teste “${c.frase}”`}
                      disabled={salvando}
                      onClick={() => void gravar(testes.filter((x) => x.id !== c.id))}
                    >
                      <Icone nome="lixeira" tamanho="sm" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {podeEditar ? (
        <section className="card" aria-labelledby={`${id}-novo`}>
          <div className="card-head">
            <h2 className="h4" id={`${id}-novo`}>
              Adicionar teste
            </h2>
          </div>
          <form className="card-body stack" onSubmit={(e) => void adicionar(e)} noValidate>
            <div className="field">
              <label htmlFor={`${id}-frase`}>Frase</label>
              <input
                id={`${id}-frase`}
                className={`input${tentou && fraseCurta ? ' is-error' : ''}`}
                value={frase}
                placeholder="Ex.: inclui a Delta Transportes com prazo de 90 dias"
                aria-invalid={tentou && fraseCurta ? true : undefined}
                onChange={(e) => setFrase(e.target.value)}
              />
              {tentou && fraseCurta ? <span className="error-text">Escreva a frase como a equipe pediria.</span> : null}
            </div>
            <div className="grid-2 ct-grade-form">
              <div className="field">
                <label htmlFor={`${id}-res`}>O copiloto deve</label>
                <select id={`${id}-res`} className="select" value={resultado} onChange={(e) => setResultado(e.target.value as typeof resultado)}>
                  <option value="pergunta">Perguntar um dado que falta</option>
                  <option value="confirmacao">Mostrar o cartão de confirmação</option>
                  <option value="recusa">Recusar ou explicar que não dá</option>
                </select>
              </div>
              {resultado === 'pergunta' ? (
                <div className="field">
                  <label htmlFor={`${id}-campo`}>Qual dado</label>
                  <select
                    id={`${id}-campo`}
                    className={`select${tentou && semCampo ? ' is-error' : ''}`}
                    value={campo}
                    aria-invalid={tentou && semCampo ? true : undefined}
                    onChange={(e) => setCampo(e.target.value)}
                  >
                    <option value="">Escolha o campo</option>
                    {def.campos.map((c) => (
                      <option key={c.chave} value={c.chave}>
                        {c.rotulo}
                      </option>
                    ))}
                  </select>
                  {tentou && semCampo ? <span className="error-text">Escolha qual dado o copiloto deve perguntar.</span> : null}
                </div>
              ) : null}
            </div>
            <div className="row wrap between">
              {exemplosSemTeste.length ? (
                <span className="small muted">
                  Ideia: use as frases de exemplo, como “{exemplosSemTeste[0]}”.{' '}
                  <button type="button" className="ct-link small" onClick={() => setFrase(exemplosSemTeste[0])}>
                    Usar esta frase
                  </button>
                </span>
              ) : (
                <span />
              )}
              <Botao type="submit" variante="secundario" icone="mais" carregando={salvando}>
                Adicionar teste
              </Botao>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

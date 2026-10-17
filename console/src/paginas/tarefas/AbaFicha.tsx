// Aba "Ficha" (C3): quando usar, frases de exemplo, campos e os textos que a pessoa vê.
import { useState } from 'react';
import type { Campo, TarefaDefinicao } from '@copiloto/shared';
import { Botao } from '../../componentes/Botao.tsx';
import { Campo as CampoForm } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import EditorCampo from './EditorCampo.tsx';
import { descricaoValidacao, renomearChave, ROTULO_TIPO } from './ficha.ts';

export interface PropsAba {
  def: TarefaDefinicao;
  mudar: (fn: (d: TarefaDefinicao) => TarefaDefinicao) => void;
  podeEditar: boolean;
}

function Frases({ def, mudar, podeEditar }: PropsAba) {
  const [nova, setNova] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const adicionar = () => {
    const t = nova.trim();
    if (t && !def.exemplos.includes(t)) mudar((d) => ({ ...d, exemplos: [...d.exemplos, t] }));
    setNova('');
  };
  return (
    <div className="stack-sm">
      <span className="label" id="frases-label">
        Frases de exemplo
      </span>
      <div className="chips" aria-labelledby="frases-label">
        {def.exemplos.length === 0 ? <span className="small muted">Nenhuma frase ainda.</span> : null}
        {def.exemplos.map((f) =>
          podeEditar ? (
            <button
              key={f}
              type="button"
              className="chip ct-chip"
              aria-label={`Remover frase: ${f}`}
              title={f}
              onClick={() => mudar((d) => ({ ...d, exemplos: d.exemplos.filter((x) => x !== f) }))}
            >
              <span className="ct-chip-texto">{f}</span>
              <Icone nome="fechar" tamanho="sm" />
            </button>
          ) : (
            <span key={f} className="chip ct-chip" title={f}>
              <span className="ct-chip-texto">{f}</span>
            </span>
          ),
        )}
        {podeEditar && !adicionando ? (
          <Botao variante="fantasma" tamanho="sm" icone="mais" onClick={() => setAdicionando(true)}>
            Adicionar frase
          </Botao>
        ) : null}
      </div>
      {podeEditar && adicionando ? (
        <div className="row wrap ct-nova-frase">
          <label className="sr-only" htmlFor="nova-frase">
            Nova frase de exemplo
          </label>
          <input
            id="nova-frase"
            className="input grow"
            autoFocus
            value={nova}
            placeholder="Ex.: abre cadastro pra Delta Transportes"
            onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                adicionar();
              }
              if (e.key === 'Escape') setAdicionando(false);
            }}
          />
          <Botao variante="secundario" tamanho="sm" onClick={adicionar} disabled={!nova.trim()}>
            Adicionar
          </Botao>
          <Botao variante="fantasma" tamanho="sm" onClick={() => setAdicionando(false)}>
            Pronto
          </Botao>
        </div>
      ) : null}
      <span className="help">Use frases do jeito que a equipe escreve, com abreviações e erros comuns.</span>
    </div>
  );
}

function Campos({ def, mudar, podeEditar }: PropsAba) {
  const [editando, setEditando] = useState<{ indice: number | null } | null>(null);
  const campoAtual = editando && editando.indice !== null ? def.campos[editando.indice] : null;
  const salvar = (c: Campo) => {
    mudar((d) => {
      if (editando?.indice === null || editando === null) return { ...d, campos: [...d.campos, c] };
      const antigo = d.campos[editando.indice];
      const campos = d.campos.map((x, i) => (i === editando.indice ? c : x));
      return renomearChave({ ...d, campos }, antigo.chave, c.chave);
    });
    setEditando(null);
  };
  const remover = () => {
    if (editando?.indice == null) return;
    const chave = def.campos[editando.indice].chave;
    mudar((d) => ({
      ...d,
      campos: d.campos.filter((_, i) => i !== editando.indice),
      api: d.api ? { ...d.api, mapeamento: d.api.mapeamento.filter((m) => m.campo !== chave) } : d.api,
    }));
    setEditando(null);
  };
  const mover = (i: number, delta: number) =>
    mudar((d) => {
      const campos = [...d.campos];
      const j = i + delta;
      if (j < 0 || j >= campos.length) return d;
      [campos[i], campos[j]] = [campos[j], campos[i]];
      return { ...d, campos };
    });

  return (
    <section className="card" aria-labelledby="campos-titulo">
      <div className="card-head wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h4" id="campos-titulo">
            Campos
          </h2>
          <span className="small muted">O copiloto só pede confirmação quando todos os obrigatórios estão preenchidos e válidos.</span>
        </div>
        {podeEditar ? (
          <Botao tamanho="sm" icone="mais" onClick={() => setEditando({ indice: null })}>
            Adicionar campo
          </Botao>
        ) : null}
      </div>
      {def.campos.length === 0 ? (
        <div className="card-body">
          <p className="small muted">Esta tarefa ainda não tem campos. Adicione os dados que o copiloto precisa coletar antes de executar.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table ct-tabela-campos">
            <thead>
              <tr>
                <th scope="col">Campo</th>
                <th scope="col">Tipo</th>
                <th scope="col">Obrigatório</th>
                <th scope="col">Validação</th>
                <th scope="col">Pergunta que o agente faz</th>
                {podeEditar ? (
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {def.campos.map((c, i) => (
                <tr key={c.chave}>
                  <td>
                    <div className="stack-sm" style={{ gap: 0 }}>
                      <span className="strong">{c.rotulo}</span>
                      <span className="tiny muted mono">{c.chave}</span>
                    </div>
                  </td>
                  <td className="small">{ROTULO_TIPO[c.tipo]}</td>
                  <td>
                    {c.obrigatorio ? (
                      <span className="row small text-success strong" style={{ gap: 4 }}>
                        <Icone nome="check" tamanho="sm" />
                        Sim
                      </span>
                    ) : (
                      <span className="small muted">Não</span>
                    )}
                  </td>
                  <td className="small">
                    {c.tipo === 'lista' && (c.opcoes ?? []).length > 0 ? (
                      <div className="row wrap" style={{ gap: 4 }}>
                        {(c.opcoes ?? []).map((o) => (
                          <span key={o} className="badge">
                            {o}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className={c.tipo === 'lista' ? 'text-danger' : 'muted'}>{descricaoValidacao(c)}</span>
                    )}
                  </td>
                  <td className="small">
                    {c.perguntar === false ? (
                      <span className="muted">Não pergunta. Mostra no cartão de confirmação para a pessoa trocar se quiser.</span>
                    ) : c.pergunta ? (
                      `“${c.pergunta}”`
                    ) : (
                      <span className="text-danger">Falta a pergunta</span>
                    )}
                  </td>
                  {podeEditar ? (
                    <td className="t-right">
                      <div className="row ct-acoes-campo">
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Subir ${c.rotulo}`} disabled={i === 0} onClick={() => mover(i, -1)}>
                          <Icone nome="subir" tamanho="sm" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          aria-label={`Descer ${c.rotulo}`}
                          disabled={i === def.campos.length - 1}
                          onClick={() => mover(i, 1)}
                        >
                          <Icone nome="seta-baixo" tamanho="sm" />
                        </button>
                        <Botao variante="fantasma" tamanho="sm" onClick={() => setEditando({ indice: i })} aria-label={`Editar ${c.rotulo}`}>
                          Editar
                        </Botao>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EditorCampo
        aberto={!!editando}
        campo={campoAtual}
        chavesUsadas={def.campos.filter((_, i) => i !== editando?.indice).map((c) => c.chave)}
        aoSalvar={salvar}
        aoRemover={remover}
        aoFechar={() => setEditando(null)}
      />
    </section>
  );
}

function Textos({ def, mudar, podeEditar }: PropsAba) {
  const chaves = def.campos.map((c) => `{${c.chave}}`);
  const linha = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <section className="card" aria-labelledby="textos-titulo">
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h4" id="textos-titulo">
            Textos que a pessoa vê
          </h2>
          <span className="small muted">No catálogo, no cartão de confirmação, no progresso e no recibo.</span>
        </div>
      </div>
      <fieldset className="card-body stack ct-fieldset" disabled={!podeEditar}>
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Nome da tarefa" obrigatorio>
            {(p) => <input {...p} value={def.nome} onChange={(e) => mudar((d) => ({ ...d, nome: e.target.value }))} />}
          </CampoForm>
          <CampoForm rotulo="Descrição no catálogo" ajuda="Uma linha. Ex.: Cria um cliente novo com CNPJ, cobrança e prazo.">
            {(p) => <input {...p} value={def.descricao} onChange={(e) => mudar((d) => ({ ...d, descricao: e.target.value }))} />}
          </CampoForm>
        </div>
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Título da confirmação" ajuda="No topo do cartão em que a pessoa confirma. Ex.: Confirme o cadastro.">
            {(p) => <input {...p} value={def.tituloConfirmacao} onChange={(e) => mudar((d) => ({ ...d, tituloConfirmacao: e.target.value }))} />}
          </CampoForm>
          <CampoForm rotulo="Título do progresso" ajuda="Enquanto executa, no gerúndio. Ex.: Cadastrando {nome_empresa}.">
            {(p) => (
              <input
                {...p}
                value={def.tituloProgresso ?? ''}
                placeholder={def.nome}
                onChange={(e) => mudar((d) => ({ ...d, tituloProgresso: e.target.value || undefined }))}
              />
            )}
          </CampoForm>
        </div>
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Título do recibo" ajuda="Quando termina. Ex.: Cliente {nome_empresa} criado (#{id}).">
            {(p) => <input {...p} value={def.tituloRecibo} onChange={(e) => mudar((d) => ({ ...d, tituloRecibo: e.target.value }))} />}
          </CampoForm>
          <CampoForm rotulo="Tempo estimado" ajuda="Aparece no cartão. Ex.: cerca de 5 s.">
            {(p) => (
              <input {...p} value={def.tempoEstimado ?? ''} onChange={(e) => mudar((d) => ({ ...d, tempoEstimado: e.target.value || undefined }))} />
            )}
          </CampoForm>
        </div>
        {chaves.length ? (
          <p className="help">
            Nos títulos dá para usar os campos: <span className="mono">{chaves.join(' ')}</span>
            {def.caminho === 'api' ? (
              <>
                {' '}
                e <span className="mono">{'{id}'}</span>, o código que o sistema devolve.
              </>
            ) : (
              '.'
            )}
          </p>
        ) : null}
        <div className="divider" />
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo="Páginas onde sugerir" ajuda="Seções do sistema, separadas por vírgula. Ex.: Clientes.">
            {(p) => (
              <input {...p} value={def.contextos.join(', ')} onChange={(e) => mudar((d) => ({ ...d, contextos: linha(e.target.value) }))} />
            )}
          </CampoForm>
          <CampoForm rotulo="Sugestão proativa" ajuda="Quando a pessoa fica parada nessas páginas. Ex.: Quer que eu cadastre um cliente?">
            {(p) => (
              <input
                {...p}
                value={def.sugestaoProativa ?? ''}
                onChange={(e) => mudar((d) => ({ ...d, sugestaoProativa: e.target.value || undefined }))}
              />
            )}
          </CampoForm>
        </div>
        <CampoForm rotulo="Próximos passos depois do recibo" classe="textarea" ajuda="Um por linha. Viram sugestões para continuar. Ex.: Alterar o plano de {nome_empresa}.">
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={def.proximosPassos.join('\n')}
              onChange={(e) =>
                mudar((d) => ({
                  ...d,
                  proximosPassos: e.target.value.split('\n').map((x) => x.trimStart()),
                }))
              }
              onBlur={() => mudar((d) => ({ ...d, proximosPassos: d.proximosPassos.map((x) => x.trim()).filter(Boolean) }))}
            />
          )}
        </CampoForm>
      </fieldset>
    </section>
  );
}

export default function AbaFicha(props: PropsAba) {
  const { def, mudar, podeEditar } = props;
  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="quando-titulo">
        <div className="card-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h4" id="quando-titulo">
              Quando usar
            </h2>
            <span className="small muted">É assim que o copiloto decide se um pedido é desta tarefa.</span>
          </div>
        </div>
        <div className="card-body stack">
          <CampoForm rotulo="Instrução para o agente" classe="textarea" ajuda="Escreva como explicaria a um colega novo. Evite siglas internas.">
            {(p) => (
              <textarea
                {...p}
                rows={4}
                value={def.quandoUsar}
                readOnly={!podeEditar}
                onChange={(e) => mudar((d) => ({ ...d, quandoUsar: e.target.value }))}
              />
            )}
          </CampoForm>
          <Frases {...props} />
        </div>
      </section>
      <Campos {...props} />
      <Textos def={def} mudar={mudar} podeEditar={podeEditar} />
    </div>
  );
}

// Etapa 3 · Mapear campos: liga cada campo da tela a um dado da tarefa (ou a um valor fixo),
// escolhe a tarefa do fluxo e mostra o que o fluxo devolve (dados lidos e arquivos).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Campo as CampoTarefa, Fluxo, ListaTarefas, PassoFluxo } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { ROTULO_TIPO, usaValor } from './comum.tsx';

const FIXO = '__fixo';
const NAO = '__nao';

function valorDoSelect(p: PassoFluxo): string {
  if (p.valor?.origem === 'campo') return p.valor.campo;
  if (p.valor?.origem === 'fixo') return FIXO;
  if (p.valor?.origem === 'nao_preencher') return NAO;
  return '';
}

/** Campo de texto que salva ao sair (para valor fixo e pergunta). */
function TextoAoSair({
  rotulo,
  valor,
  aoSalvar,
  somenteLeitura,
  ajuda,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  aoSalvar: (v: string) => void;
  somenteLeitura: boolean;
  ajuda?: string;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  return (
    <Campo rotulo={rotulo} ajuda={ajuda}>
      {(p) => (
        <input
          {...p}
          type="text"
          value={texto}
          readOnly={somenteLeitura}
          placeholder={placeholder}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            if (texto.trim() !== valor) aoSalvar(texto.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      )}
    </Campo>
  );
}

function LinhaMapa({
  passo,
  campos,
  daTarefa,
  somenteLeitura,
  aoMudarPasso,
  aoMudarCampo,
}: {
  passo: PassoFluxo;
  campos: CampoTarefa[];
  /** Os campos são da tarefa (pergunta só muda na ficha) ou sugeridos pela gravação. */
  daTarefa: boolean;
  somenteLeitura: boolean;
  aoMudarPasso: (p: PassoFluxo) => void;
  aoMudarCampo: (c: CampoTarefa) => void;
}) {
  const atual = valorDoSelect(passo);
  const campo = passo.valor?.origem === 'campo' ? campos.find((c) => c.chave === (passo.valor as { campo: string }).campo) : undefined;
  const trocar = (v: string) => {
    if (v === FIXO) aoMudarPasso({ ...passo, valor: { origem: 'fixo', valor: passo.valor?.origem === 'fixo' ? passo.valor.valor : '' } });
    else if (v === NAO) aoMudarPasso({ ...passo, valor: { origem: 'nao_preencher' } });
    else if (v) aoMudarPasso({ ...passo, valor: { origem: 'campo', campo: v } });
  };
  return (
    <div className="ap-linha-mapa stack-sm">
      <div className="ap-mapa">
        <div className="field">
          <span className="label">Campo na tela</span>
          <div className="ap-campo-tela">
            <span className="strong">{passo.rotuloElemento ?? passo.titulo}</span>
            <span className="tiny muted">
              Passo {passo.n} · {ROTULO_TIPO[passo.tipo]}
              {passo.formatoGravado ? ` · gravado no formato ${passo.formatoGravado}` : ''}
            </span>
          </div>
        </div>
        <span className="ap-mapa-seta" aria-hidden="true">
          <Icone nome="seta-direita" />
        </span>
        <Campo rotulo="Dado da tarefa" classe="select" erro={passo.pendencia ?? null}>
          {(p) => (
            <select {...p} value={atual} disabled={somenteLeitura} onChange={(e) => trocar(e.target.value)}>
              {atual === '' ? <option value="">Escolha um dado</option> : null}
              {campos.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {c.rotulo}
                  {c.obrigatorio ? ' (obrigatório)' : ''}
                </option>
              ))}
              {atual !== '' && atual !== FIXO && atual !== NAO && !campo ? <option value={atual}>{atual} (não existe na tarefa)</option> : null}
              <option value={FIXO}>Valor fixo</option>
              <option value={NAO}>Não preencher</option>
            </select>
          )}
        </Campo>
      </div>
      {passo.valor?.origem === 'fixo' ? (
        <TextoAoSair
          rotulo={passo.tipo === 'selecionar' ? 'Opção que o copiloto escolhe sempre' : 'Valor que o copiloto digita sempre'}
          valor={passo.valor.valor}
          somenteLeitura={somenteLeitura}
          placeholder={passo.tipo === 'selecionar' ? 'Texto da opção, como aparece na lista' : undefined}
          aoSalvar={(v) => aoMudarPasso({ ...passo, valor: { origem: 'fixo', valor: v } })}
        />
      ) : null}
      {campo && !daTarefa ? (
        <TextoAoSair
          rotulo="Pergunta se o dado faltar no pedido"
          valor={campo.pergunta}
          somenteLeitura={somenteLeitura}
          aoSalvar={(pergunta) => aoMudarCampo({ ...campo, pergunta })}
        />
      ) : null}
      {campo && daTarefa ? (
        <p className="small muted">
          Se faltar no pedido, o copiloto pergunta: “{campo.pergunta}” <span className="tiny">(muda na ficha da tarefa)</span>
        </p>
      ) : null}
      {passo.valor?.origem === 'nao_preencher' ? <p className="small muted">O copiloto deixa este campo como a tela abrir.</p> : null}
    </div>
  );
}

export function EtapaMapear({
  fluxo,
  campos,
  camposTarefa,
  nomeTarefa,
  erroTarefa,
  somenteLeitura,
  online,
  salvar,
  aoAtualizar,
  aoVoltar,
  aoContinuar,
}: {
  fluxo: Fluxo;
  campos: CampoTarefa[];
  /** Campos da tarefa ligada; null quando não há tarefa (ou ela não carregou). */
  camposTarefa: CampoTarefa[] | null;
  nomeTarefa: string | null;
  erroTarefa: ErroApiCliente | null;
  somenteLeitura: boolean;
  online: boolean;
  salvar: (mudancas: { passos?: PassoFluxo[]; camposSugeridos?: CampoTarefa[]; tarefaId?: string | null }) => Promise<boolean>;
  aoAtualizar: (f: Fluxo) => void;
  aoVoltar: () => void;
  aoContinuar: () => void;
}) {
  const toast = useToast();
  const tarefas = useApi<ListaTarefas>('/tarefas');
  const [criando, setCriando] = useState(false);
  const daTarefa = Boolean(camposTarefa && camposTarefa.length);
  const comValor = fluxo.passos.filter(usaValor);
  const devolve = fluxo.passos.filter((p) => (p.tipo === 'leitura' && p.gera) || p.tipo === 'download');
  const pendencias = fluxo.passos.filter((p) => p.pendencia);

  const mudarPasso = (novo: PassoFluxo) => void salvar({ passos: fluxo.passos.map((p) => (p.n === novo.n ? novo : p)) });
  const mudarCampo = (novo: CampoTarefa) => void salvar({ camposSugeridos: fluxo.camposSugeridos.map((c) => (c.chave === novo.chave ? novo : c)) });

  const criarTarefa = async () => {
    setCriando(true);
    try {
      const r = await api.post<{ fluxo: Fluxo; tarefaId: string }>(`/fluxos/${encodeURIComponent(fluxo.id)}/criar-tarefa`);
      aoAtualizar(r.fluxo);
      toast.mostrar({ tipo: 'sucesso', texto: `Tarefa “${fluxo.nome}” criada em rascunho com os dados deste fluxo.` });
      void tarefas.recarregar();
      return r;
    } catch (e) {
      toast.erro((e as ErroApiCliente).message);
      return undefined;
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="stack">
      <section className="card card-pad stack" aria-labelledby="tarefa-fluxo">
        <h2 className="h4" id="tarefa-fluxo">
          Tarefa deste fluxo
        </h2>
        <div className="row-top wrap" style={{ gap: 'var(--s-4)', alignItems: 'flex-end' }}>
          <Campo rotulo="Tarefa" classe="select" style={{ flex: '1 1 260px' }}>
            {(p) => (
              <select
                {...p}
                value={fluxo.tarefaId ?? ''}
                disabled={somenteLeitura || !online || (tarefas.carregando && !tarefas.dados)}
                onChange={(e) => void salvar({ tarefaId: e.target.value || null })}
              >
                <option value="">Sem tarefa por enquanto</option>
                {fluxo.tarefaId && !tarefas.dados?.tarefas.some((t) => t.id === fluxo.tarefaId) ? (
                  <option value={fluxo.tarefaId}>{nomeTarefa ?? 'Tarefa atual'}</option>
                ) : null}
                {(tarefas.dados?.tarefas ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          {fluxo.tarefaId ? (
            <Link className="btn btn-ghost" to={`/tarefas/${encodeURIComponent(fluxo.tarefaId)}`}>
              Abrir a ficha da tarefa
            </Link>
          ) : !somenteLeitura ? (
            <Botao icone="mais" carregando={criando} disabled={!online} onClick={() => void criarTarefa()}>
              Criar tarefa com estes dados
            </Botao>
          ) : null}
        </div>
        <p className="small muted">
          {fluxo.tarefaId
            ? 'Os dados abaixo são os campos da ficha da tarefa. Ao publicar, o fluxo entra no rascunho dela.'
            : 'Sem tarefa, os dados abaixo foram sugeridos pela gravação. Ao criar a tarefa, eles viram os campos da ficha.'}
        </p>
        {fluxo.tarefaId && erroTarefa ? (
          <Aviso tipo="aviso" titulo="Não consegui carregar os campos da tarefa">
            {erroTarefa.message} Os dados sugeridos pela gravação aparecem no lugar.
          </Aviso>
        ) : null}
      </section>

      <section className="card card-pad stack" aria-labelledby="dados-preenche">
        <div className="row between wrap">
          <h2 className="h4" id="dados-preenche">
            O que o fluxo preenche
          </h2>
          {pendencias.length ? (
            <span className="badge badge-warning">
              <span className="dot" />
              {pendencias.length} {pendencias.length === 1 ? 'pendência' : 'pendências'}
            </span>
          ) : comValor.length ? (
            <span className="badge badge-success">
              <span className="dot" />
              Tudo mapeado
            </span>
          ) : null}
        </div>
        {comValor.length === 0 ? (
          <p className="small muted">Este fluxo não preenche nenhum campo: ele só clica, lê ou baixa.</p>
        ) : campos.length === 0 ? (
          <Aviso titulo="Ainda não há dados para ligar">
            {fluxo.tarefaId ? 'A tarefa ainda não tem campos. Crie os campos na ficha da tarefa ou use valor fixo.' : 'Escolha uma tarefa ou use valor fixo em cada campo.'}
          </Aviso>
        ) : null}
        <div>
          {comValor.map((p) => (
            <LinhaMapa
              key={p.n}
              passo={p}
              campos={campos}
              daTarefa={daTarefa}
              somenteLeitura={somenteLeitura}
              aoMudarPasso={mudarPasso}
              aoMudarCampo={mudarCampo}
            />
          ))}
        </div>
        {pendencias.some((p) => !usaValor(p)) ? (
          <Aviso tipo="aviso" titulo="Há pendências em outros passos">
            {pendencias
              .filter((p) => !usaValor(p))
              .map((p) => `Passo ${p.n}: ${p.pendencia}`)
              .join(' · ')}
          </Aviso>
        ) : null}
      </section>

      {devolve.length ? (
        <section className="card card-pad stack-sm" aria-labelledby="dados-devolve">
          <h2 className="h4" id="dados-devolve">
            O que o fluxo devolve
          </h2>
          <p className="small muted">Aparece no recibo para a pessoa. Os nomes podem ser usados no título do recibo, como {'{numero}'}.</p>
          <dl className="kv">
            {devolve.map((p) => (
              <div key={p.n} style={{ display: 'contents' }}>
                <dt>Passo {p.n}</dt>
                <dd>
                  {p.tipo === 'download' ? 'Arquivo baixado' : 'Dado lido'} · <span className="mono">{p.gera ?? 'arquivo'}</span>
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {' '}
                    ({p.rotuloElemento ?? p.titulo})
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="row between wrap" style={{ paddingTop: 'var(--s-2)' }}>
        <Botao onClick={aoVoltar} icone="seta-esquerda">
          Voltar
        </Botao>
        <div className="row wrap">
          {pendencias.length && !somenteLeitura ? <span className="small muted">Resolva as pendências para testar.</span> : null}
          <Botao variante="primario" iconeDepois="seta-direita" disabled={pendencias.length > 0 && !somenteLeitura} onClick={aoContinuar}>
            Continuar para testes
          </Botao>
        </div>
      </div>
    </div>
  );
}

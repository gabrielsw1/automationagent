// Etapa 4 · Testar: roda o fluxo de verdade no sistema, como uma pessoa escolhida, com valores de
// teste, e mostra o que aconteceu em cada passo, com o print.
import { useEffect, useMemo, useState } from 'react';
import { fmt, type Campo as CampoTarefa, type Fluxo, type UsuarioSistema } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { PrintPasso } from './PrintPasso.tsx';
import type { Destaque, EventoTeste, RespostaTeste } from './comum.tsx';

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** Campos usados pelos passos (na ordem dos passos), com o campo da tarefa quando existe. */
function camposUsados(fluxo: Fluxo, campos: CampoTarefa[]): CampoTarefa[] {
  const vistos = new Set<string>();
  const lista: CampoTarefa[] = [];
  for (const p of fluxo.passos) {
    if (p.valor?.origem !== 'campo' || vistos.has(p.valor.campo)) continue;
    vistos.add(p.valor.campo);
    lista.push(
      campos.find((c) => c.chave === (p.valor as { campo: string }).campo) ?? {
        chave: p.valor.campo,
        rotulo: p.rotuloElemento ?? p.valor.campo,
        tipo: 'texto',
        obrigatorio: false,
        pergunta: '',
      },
    );
  }
  return lista;
}

function ControleValor({
  campo,
  valor,
  aoMudar,
  usuarios,
  desativado,
}: {
  campo: CampoTarefa;
  valor: string;
  aoMudar: (v: string) => void;
  usuarios: UsuarioSistema[];
  desativado: boolean;
}) {
  const ajuda: Partial<Record<CampoTarefa['tipo'], string>> = {
    documento: 'CPF ou CNPJ, com ou sem pontuação.',
    data: 'Use uma data em que a tela aceite o pedido.',
    pessoa: 'Pessoa do sistema que aparece na lista.',
  };
  return (
    <Campo rotulo={campo.rotulo} obrigatorio={campo.obrigatorio && campo.tipo !== 'pessoa'} ajuda={campo.ajuda ?? ajuda[campo.tipo]} classe={campo.tipo === 'lista' || campo.tipo === 'pessoa' ? 'select' : 'input'}>
      {(p) =>
        campo.tipo === 'lista' && campo.opcoes?.length ? (
          <select {...p} value={valor} disabled={desativado} onChange={(e) => aoMudar(e.target.value)}>
            <option value="">Escolha</option>
            {campo.opcoes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : campo.tipo === 'pessoa' && usuarios.length ? (
          <select {...p} value={valor} disabled={desativado} onChange={(e) => aoMudar(e.target.value)}>
            <option value="">Escolha</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...p}
            type={campo.tipo === 'data' ? 'date' : campo.tipo === 'hora' ? 'time' : campo.tipo === 'email' ? 'email' : 'text'}
            inputMode={campo.tipo === 'documento' || campo.tipo === 'telefone' || campo.tipo === 'numero' ? 'numeric' : undefined}
            value={valor}
            disabled={desativado}
            autoComplete="off"
            onChange={(e) => aoMudar(e.target.value)}
          />
        )
      }
    </Campo>
  );
}

/** O que aconteceu em cada passo, com o print (clique para ampliar). */
function ResultadoPassos({ fluxo, eventos, falhou }: { fluxo: Fluxo; eventos: EventoTeste[] | null; falhou: number | null }) {
  const [aberto, setAberto] = useState<{ printId: string; titulo: string; destaque?: Destaque } | null>(null);
  return (
    <ol className="steps" aria-label="Resultado de cada passo" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {fluxo.passos.map((p) => {
        const doPasso = eventos?.filter((e) => e.passo === p.n) ?? [];
        const ok = doPasso.find((e) => e.tipo === 'passo_ok');
        const falha = doPasso.find((e) => e.tipo === 'passo_falhou') ?? (falhou === p.n ? doPasso.at(-1) : undefined);
        const notas = doPasso.filter((e) => e.tipo === 'recuperacao' || e.tipo === 'aviso');
        const estado = ok ? 'done' : falhou === p.n ? 'fail' : eventos === null && p.printId ? 'done' : '';
        const titulo = ok?.titulo ?? (falhou === p.n ? (falha?.titulo ?? p.titulo) : p.titulo);
        const printId = ok?.printId ?? falha?.printId ?? (eventos === null ? p.printId : undefined);
        const destaque = ok?.destaque ?? falha?.destaque;
        return (
          <li key={p.n} className={`step ${estado}`}>
            <span className="step-dot" aria-hidden="true">
              {estado === 'done' ? <Icone nome="check" tamanho="sm" /> : estado === 'fail' ? <Icone nome="fechar" tamanho="sm" /> : p.n}
            </span>
            <div className="ap-resultado-passo grow">
              <div className="stack-sm grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="small strong">
                  {titulo}
                  <span className="sr-only">{estado === 'done' ? ' (feito)' : estado === 'fail' ? ' (falhou)' : eventos ? ' (não chegou a este passo)' : ''}</span>
                </span>
                {ok?.detalhe ? <span className="tiny muted">{ok.detalhe}</span> : null}
                {eventos && !ok && falhou !== p.n ? <span className="tiny muted">Não chegou a este passo.</span> : null}
                {notas.map((n, i) => (
                  <span key={i} className="ap-nota">
                    <Icone nome="alerta" tamanho="sm" />
                    <span>
                      {n.titulo}
                      {n.detalhe ? `. ${n.detalhe}` : ''}
                    </span>
                  </span>
                ))}
              </div>
              {printId ? (
                <button
                  type="button"
                  className="ap-miniatura"
                  onClick={() => setAberto({ printId, titulo, destaque })}
                  aria-label={`Ver o print do passo ${p.n}: ${titulo}`}
                >
                  <img src={api.url(`/prints/${encodeURIComponent(printId)}`)} alt="" loading="lazy" />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
      <Modal aberto={aberto !== null} titulo={aberto?.titulo ?? ''} aoFechar={() => setAberto(null)} largura={1100}>
        {aberto ? <PrintPasso printId={aberto.printId} titulo={aberto.titulo} destaque={aberto.destaque} limitado={false} podeAmpliar={false} /> : null}
      </Modal>
    </ol>
  );
}

function Cronometro({ desde }: { desde: number }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="ap-cronometro">{fmt.duracao(agora - desde)}</span>;
}

export function EtapaTestar({
  fluxo,
  campos,
  nomeSistema,
  podeTestar,
  online,
  aoTestado,
  aoRevisarPasso,
  aoVoltar,
  aoContinuar,
}: {
  fluxo: Fluxo;
  campos: CampoTarefa[];
  nomeSistema: string;
  podeTestar: boolean;
  online: boolean;
  aoTestado: (f: Fluxo) => void;
  aoRevisarPasso: (n: number) => void;
  aoVoltar: () => void;
  aoContinuar: () => void;
}) {
  const { resumo } = useSessao();
  const usuarios = useApi<UsuarioSistema[]>('/sistema/usuarios');
  const usados = useMemo(() => camposUsados(fluxo, campos), [fluxo, campos]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [usuarioId, setUsuarioId] = useState('');
  const [rodando, setRodando] = useState<number | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [resposta, setResposta] = useState<RespostaTeste | null>(null);

  // Começa como a própria pessoa do console, quando ela existe no sistema.
  useEffect(() => {
    if (usuarioId || !usuarios.dados) return;
    const eu = usuarios.dados.find((u) => u.email.toLowerCase() === resumo.eu.email.toLowerCase());
    if (eu) setUsuarioId(eu.id);
  }, [usuarios.dados, resumo.eu.email, usuarioId]);

  const pendencias = fluxo.passos.filter((p) => p.pendencia);
  const faltando = usados.filter((c) => c.obrigatorio && c.tipo !== 'pessoa' && !(valores[c.chave] ?? '').trim());

  const testar = async () => {
    setErro(null);
    setRodando(Date.now());
    try {
      const r = await api.post<RespostaTeste>(`/fluxos/${encodeURIComponent(fluxo.id)}/testar`, { valores, usuarioId });
      setResposta(r);
      aoTestado(r.fluxo);
    } catch (e) {
      setErro(e as ErroApiCliente);
    } finally {
      setRodando(null);
    }
  };

  const res = resposta?.resultado;
  const usuarioNome = usuarios.dados?.find((u) => u.id === usuarioId)?.nome;

  return (
    <div className="stack">
      <Aviso tipo="aviso" titulo={`O teste roda de verdade no ${nomeSistema}`}>
        O navegador entra como a pessoa escolhida, com as permissões dela, e faz cada passo, inclusive salvar. Use um cliente ou dados de teste.
      </Aviso>

      {pendencias.length ? (
        <Aviso tipo="erro" titulo="Resolva as pendências antes de testar" acoes={<Botao tamanho="sm" onClick={aoVoltar}>Voltar para mapear</Botao>}>
          {pendencias.map((p) => `Passo ${p.n}: ${p.pendencia}`).join(' · ')}
        </Aviso>
      ) : null}

      <div className="split">
        <section className="side-col card card-pad stack" aria-labelledby="valores-teste">
          <h2 className="h4" id="valores-teste">
            Valores do teste
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (podeTestar && !rodando) void testar();
            }}
          >
            <Campo
              rotulo="Rodar como"
              obrigatorio
              classe="select"
              erro={usuarios.erro ? `Não consegui listar as pessoas do ${nomeSistema}. ${usuarios.erro.message}` : null}
              ajuda="O navegador entra com a sessão desta pessoa, sem senha."
            >
              {(p) => (
                <select {...p} value={usuarioId} disabled={!podeTestar || rodando !== null} onChange={(e) => setUsuarioId(e.target.value)}>
                  <option value="">{usuarios.carregando ? 'Carregando…' : 'Escolha a pessoa'}</option>
                  {(usuarios.dados ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                      {u.perfis.length ? ` · ${u.perfis.join(', ')}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            {usados.map((c) => (
              <ControleValor
                key={c.chave}
                campo={c}
                valor={valores[c.chave] ?? ''}
                usuarios={usuarios.dados ?? []}
                desativado={!podeTestar || rodando !== null}
                aoMudar={(v) => setValores((atual) => ({ ...atual, [c.chave]: v }))}
              />
            ))}
            {usados.length === 0 ? <p className="small muted">Este fluxo não pede nenhum dado: só a pessoa que vai rodar.</p> : null}
            {erro ? (
              <Aviso tipo="erro" titulo={erro.offline ? 'Sem conexão' : 'O teste não rodou'}>
                {erro.message}
              </Aviso>
            ) : null}
            {podeTestar ? (
              <Botao
                type="submit"
                variante="primario"
                icone="play"
                bloco
                carregando={rodando !== null}
                disabled={!online || !usuarioId || faltando.length > 0 || pendencias.length > 0}
              >
                {res ? 'Testar de novo' : 'Rodar teste'}
              </Botao>
            ) : (
              <p className="small muted">Seu perfil não pode rodar testes.</p>
            )}
            {faltando.length && podeTestar ? <p className="tiny muted">Preencha: {faltando.map((c) => c.rotulo).join(', ')}.</p> : null}
          </form>
        </section>

        <section className="main-col card card-pad stack" aria-labelledby="resultado-teste" aria-busy={rodando !== null}>
          <div className="row between wrap">
            <h2 className="h4" id="resultado-teste">
              {rodando ? 'Testando…' : res ? 'Resultado do teste' : 'Último teste'}
            </h2>
            {res ? <span className="small muted">Levou {fmt.duracao(res.duracaoMs)}</span> : null}
          </div>

          {rodando ? (
            <div className="row" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span className="small">
                O navegador está fazendo os {fluxo.passos.length} passos no {nomeSistema}
                {usuarioNome ? ` como ${usuarioNome}` : ''}… <Cronometro desde={rodando} />. Costuma levar menos de um minuto.
              </span>
            </div>
          ) : null}

          {!rodando && res ? (
            res.ok ? (
              <Aviso tipo="sucesso" titulo="Deu certo" papel="status">
                {res.mensagem}
              </Aviso>
            ) : (
              <Aviso
                tipo="erro"
                titulo={res.passo ? `Parou no passo ${res.passo}` : 'O teste não terminou'}
                acoes={
                  res.passo ? (
                    <Botao tamanho="sm" onClick={() => aoRevisarPasso(res.passo!)}>
                      Revisar o passo {res.passo}
                    </Botao>
                  ) : undefined
                }
              >
                {res.mensagem}
                {res.candidato ? ` O mais parecido na tela é “${res.candidato.texto}”, com confiança de ${pct(res.candidato.confianca)}.` : ''}
              </Aviso>
            )
          ) : null}

          {!rodando && !res && fluxo.ultimoTeste ? (
            <Aviso tipo={fluxo.ultimoTeste.ok ? 'sucesso' : 'erro'} titulo={fluxo.ultimoTeste.ok ? `Deu certo em ${fmt.dataHora(fluxo.ultimoTeste.em)}` : `Falhou em ${fmt.dataHora(fluxo.ultimoTeste.em)}`}>
              {fluxo.ultimoTeste.ok
                ? 'Mudou algo nos passos? Teste de novo antes de publicar.'
                : `${fluxo.ultimoTeste.passoFalhou ? `Passo ${fluxo.ultimoTeste.passoFalhou}: ` : ''}${fluxo.ultimoTeste.erro ?? ''}`}
            </Aviso>
          ) : null}

          {!rodando && !res && !fluxo.ultimoTeste ? (
            <p className="small muted">Ainda não testado. Preencha os valores e rode o teste para ver o print de cada passo.</p>
          ) : null}

          {res && !rodando && (Object.keys(res.gerados).length || res.arquivos.length) ? (
            <dl className="kv">
              {Object.entries(res.gerados).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt className="mono">{k}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
              {res.arquivos.map((a) => (
                <div key={a.nome} style={{ display: 'contents' }}>
                  <dt>Arquivo</dt>
                  <dd>{a.nome}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {!rodando && (res || fluxo.ultimoTeste) ? (
            <ResultadoPassos fluxo={fluxo} eventos={resposta?.eventos ?? null} falhou={res ? (res.ok ? null : (res.passo ?? null)) : (fluxo.ultimoTeste?.passoFalhou ?? null)} />
          ) : null}
        </section>
      </div>

      <div className="row between wrap" style={{ paddingTop: 'var(--s-2)' }}>
        <Botao onClick={aoVoltar} icone="seta-esquerda">
          Voltar
        </Botao>
        <Botao variante="primario" iconeDepois="seta-direita" disabled={!fluxo.ultimoTeste?.ok} onClick={aoContinuar}>
          Continuar para publicar
        </Botao>
      </div>
    </div>
  );
}

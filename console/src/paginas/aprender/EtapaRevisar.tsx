// Etapa 2 · Revisar passos: lista dos passos (com o print do último teste), título de cada passo,
// jeito de achar o elemento na tela (estável ou frágil) e remoção de passos sobrando.
import { useEffect, useState, type ReactNode } from 'react';
import { fmt, type Campo as CampoTarefa, type Fluxo, type PassoFluxo } from '@copiloto/shared';
import { api } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone, type NomeIcone } from '../../componentes/icones.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { PrintPasso } from './PrintPasso.tsx';
import { ehFragil, resumoDoPasso, ROTULO_TIPO, SeloEstabilidade, seletorDo } from './comum.tsx';

const ICONE_TIPO: Record<PassoFluxo['tipo'], NomeIcone> = {
  navegar: 'externo',
  clique: 'seta-direita',
  preencher: 'editar',
  selecionar: 'seta-baixo',
  leitura: 'busca',
  download: 'baixar',
  esperar: 'relogio',
};

/** Lista lateral de passos, com miniatura do print quando há. */
export function ListaPassos({
  passos,
  campos,
  selecionado,
  aoSelecionar,
  titulo = 'Passos capturados',
}: {
  passos: PassoFluxo[];
  campos: CampoTarefa[];
  selecionado: number;
  aoSelecionar: (n: number) => void;
  titulo?: string;
}) {
  return (
    <section className="stack-sm" aria-labelledby="passos-titulo">
      <div className="row between">
        <h2 className="h4" id="passos-titulo">
          {titulo}
        </h2>
        <span className="small muted">
          {passos.length} {passos.length === 1 ? 'passo' : 'passos'}
        </span>
      </div>
      <ol className="ap-passos">
        {passos.map((p) => {
          const atual = p.n === selecionado;
          return (
            <li key={p.n}>
              <button
                type="button"
                className={`ap-passo-botao${p.pendencia ? ' pendente' : ''}`}
                aria-pressed={atual}
                onClick={() => aoSelecionar(p.n)}
              >
                <span className="ap-miniatura" aria-hidden="true">
                  {p.printId ? <img src={api.url(`/prints/${encodeURIComponent(p.printId)}`)} alt="" loading="lazy" /> : <Icone nome={ICONE_TIPO[p.tipo]} />}
                </span>
                <span className="ap-passo-texto">
                  <span className={`tiny ${atual ? 'text-brand strong' : p.pendencia ? 'text-warning strong' : 'muted'}`}>{resumoDoPasso(p, campos)}</span>
                  <span className="small strong">{p.titulo}</span>
                </span>
                {ehFragil(p) ? (
                  <span className="badge badge-warning" style={{ flex: 'none' }}>
                    Frágil
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Cabeçalho do cartão de um passo, com "anterior" e "próximo". */
export function CabecaPasso({
  passo,
  total,
  aoIr,
  children,
}: {
  passo: PassoFluxo;
  total: number;
  aoIr: (n: number) => void;
  children?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
        <span className="tiny muted">
          Passo {passo.n} de {total} · {ROTULO_TIPO[passo.tipo]}
        </span>
        {children}
      </div>
      <div className="row" style={{ gap: 'var(--s-2)' }}>
        <Botao variante="fantasma" tamanho="sm" icone="seta-esquerda" disabled={passo.n <= 1} onClick={() => aoIr(passo.n - 1)}>
          Anterior
        </Botao>
        <Botao variante="fantasma" tamanho="sm" iconeDepois="seta-direita" disabled={passo.n >= total} onClick={() => aoIr(passo.n + 1)}>
          Próximo
        </Botao>
      </div>
    </div>
  );
}

/** Texto que fica salvo ao sair do campo (ou com Enter). */
function TextoEditavel({
  rotulo,
  valor,
  aoSalvar,
  desativado,
  ajuda,
  mono,
  validar,
}: {
  rotulo: string;
  valor: string;
  aoSalvar: (v: string) => void;
  desativado?: boolean;
  ajuda?: ReactNode;
  mono?: boolean;
  validar?: (v: string) => string | null;
}) {
  const [texto, setTexto] = useState(valor);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setTexto(valor);
    setErro(null);
  }, [valor]);
  const salvar = () => {
    const v = texto.trim();
    if (v === valor) return;
    const e = validar ? validar(v) : v ? null : 'Não pode ficar vazio.';
    setErro(e);
    if (!e) aoSalvar(v);
  };
  return (
    <Campo rotulo={rotulo} ajuda={ajuda} erro={erro}>
      {(p) => (
        <input
          {...p}
          className={`${p.className}${mono ? ' mono' : ''}`}
          type="text"
          value={texto}
          readOnly={desativado}
          spellCheck={!mono}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              salvar();
            }
            if (e.key === 'Escape') setTexto(valor);
          }}
        />
      )}
    </Campo>
  );
}

function DetalhePasso({
  fluxo,
  passo,
  somenteLeitura,
  aoMudar,
  aoRemover,
  aoIr,
}: {
  fluxo: Fluxo;
  passo: PassoFluxo;
  somenteLeitura: boolean;
  aoMudar: (p: PassoFluxo) => void;
  aoRemover: () => void;
  aoIr: (n: number) => void;
}) {
  const escolhido = seletorDo(passo);
  return (
    <section className="card" aria-labelledby="passo-titulo">
      <CabecaPasso passo={passo} total={fluxo.passos.length} aoIr={aoIr}>
        <h2 className="h4" id="passo-titulo">
          {passo.titulo}
        </h2>
      </CabecaPasso>
      <div className="card-body stack">
        {passo.printId ? (
          <PrintPasso printId={passo.printId} titulo={passo.titulo} />
        ) : (
          <div className="ap-print-vazio small">
            <div className="stack-sm" style={{ alignItems: 'center' }}>
              <Icone nome={ICONE_TIPO[passo.tipo]} />
              <span>O print deste passo aparece depois do primeiro teste. Valores digitados ficam ocultos.</span>
            </div>
          </div>
        )}
        {passo.pendencia ? <Aviso tipo="aviso" titulo={`Falta resolver: ${passo.pendencia}`} /> : null}

        <div className="divider" />

        <TextoEditavel
          rotulo="O que este passo faz"
          valor={passo.titulo}
          desativado={somenteLeitura}
          ajuda="Um verbo e o nome do que aparece na tela, como a equipe fala. Ex.: Preencher CPF/CNPJ."
          aoSalvar={(titulo) => aoMudar({ ...passo, titulo })}
        />

        {passo.tipo === 'navegar' ? (
          <TextoEditavel
            rotulo="Endereço da tela"
            valor={passo.url ?? ''}
            mono
            desativado={somenteLeitura}
            ajuda="Caminho da tela no sistema. O copiloto abre este endereço com a sessão da pessoa."
            validar={(v) => (v.startsWith('/') || /^https?:\/\//.test(v) ? null : 'Use um caminho que começa com /, por exemplo /financeiro/segunda-via.')}
            aoSalvar={(url) => aoMudar({ ...passo, url })}
          />
        ) : null}

        {passo.tipo === 'leitura' || (passo.tipo === 'download' && passo.gera) ? (
          <TextoEditavel
            rotulo={passo.tipo === 'leitura' ? 'Nome do dado lido' : 'Nome do arquivo gerado'}
            valor={passo.gera ?? ''}
            mono
            desativado={somenteLeitura}
            ajuda="Aparece no recibo e pode ser usado no título dele. Só letras minúsculas, números e _."
            validar={(v) => (/^[a-z0-9_]{1,60}$/.test(v) ? null : 'Use só letras minúsculas, números e _, por exemplo linha_digitavel.')}
            aoSalvar={(gera) => aoMudar({ ...passo, gera })}
          />
        ) : null}

        {passo.formatoGravado && passo.tipo === 'preencher' ? (
          <p className="small muted">
            Na gravação foi digitado algo no formato <span className="mono">{passo.formatoGravado}</span>. O valor em si não é guardado: cada pedido usa o dado
            informado pela pessoa.
          </p>
        ) : null}

        {passo.tipo !== 'navegar' ? (
          passo.seletores.length ? (
            <fieldset className="ap-seletores">
              <legend className="label" style={{ marginBottom: 'var(--s-2)' }}>
                Como o copiloto acha {passo.rotuloElemento ? `“${passo.rotuloElemento}”` : 'o elemento'} na tela
              </legend>
              {passo.seletores.map((s, i) => (
                <label key={`${i}-${s.seletor}`} className="ap-seletor">
                  <input
                    type="radio"
                    name={`seletor-${passo.n}`}
                    checked={i === passo.seletorEscolhido}
                    disabled={somenteLeitura}
                    onChange={() => aoMudar({ ...passo, seletorEscolhido: i })}
                  />
                  <span className="stack-sm grow" style={{ gap: 4, minWidth: 0 }}>
                    <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                      <span className="mono">{s.seletor}</span>
                      <SeloEstabilidade estabilidade={s.estabilidade} />
                      {i === passo.seletorEscolhido ? <span className="tiny strong text-brand">Em uso</span> : null}
                    </span>
                    <span className="small muted">{s.motivo.charAt(0).toUpperCase() + s.motivo.slice(1)}.</span>
                  </span>
                </label>
              ))}
              <p className="help">
                {escolhido?.estabilidade === 'fragil'
                  ? 'O jeito em uso é frágil. Se a tela mudar, o copiloto procura um elemento parecido e só segue sozinho quando tem confiança; senão, para e avisa você.'
                  : 'Se o jeito em uso falhar, o copiloto tenta os outros desta lista, na ordem, antes de procurar pela tela.'}
              </p>
            </fieldset>
          ) : (
            <Aviso tipo="aviso" titulo="Este passo não tem como achar o elemento na tela">
              Grave de novo para o copiloto capturar o elemento.
            </Aviso>
          )
        ) : null}

        {!somenteLeitura ? (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Botao variante="fantasma" tamanho="sm" icone="lixeira" onClick={aoRemover}>
              Remover este passo
            </Botao>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function EtapaRevisar({
  fluxo,
  campos,
  somenteLeitura,
  online,
  selecionado,
  aoSelecionar,
  salvarPassos,
  aoGravarDeNovo,
  aoOrganizar,
  aoContinuar,
}: {
  fluxo: Fluxo;
  campos: CampoTarefa[];
  somenteLeitura: boolean;
  online: boolean;
  selecionado: number;
  aoSelecionar: (n: number) => void;
  salvarPassos: (passos: PassoFluxo[]) => Promise<boolean>;
  aoGravarDeNovo: () => void;
  aoOrganizar: () => void;
  aoContinuar: () => void;
}) {
  const toast = useToast();
  const passos = fluxo.passos;
  const passo = passos.find((p) => p.n === selecionado) ?? passos[0];
  const frageis = passos.filter((p) => p.tipo !== 'navegar' && ehFragil(p));

  if (!passo) {
    return (
      <Aviso tipo="aviso" titulo="Este fluxo não tem passos">
        Grave a tarefa de novo para o copiloto aprender os passos.
      </Aviso>
    );
  }

  const renumerar = (lista: PassoFluxo[]) => lista.map((p, i) => ({ ...p, n: i + 1 }));

  const mudar = (novo: PassoFluxo) => {
    void salvarPassos(passos.map((p) => (p.n === novo.n ? novo : p)));
  };

  const remover = async () => {
    if (passos.length <= 1) {
      toast.erro('O fluxo precisa de pelo menos um passo. Para recomeçar, use “Gravar de novo”.');
      return;
    }
    const anteriores = passos;
    const ok = await salvarPassos(renumerar(passos.filter((p) => p.n !== passo.n)));
    if (!ok) return;
    aoSelecionar(Math.min(passo.n, passos.length - 1));
    toast.mostrar({
      texto: `Passo ${passo.n} removido: ${passo.titulo}.`,
      acao: {
        rotulo: 'Desfazer',
        aoClicar: () => {
          void salvarPassos(anteriores).then((v) => v && aoSelecionar(passo.n));
        },
      },
    });
  };

  return (
    <div className="stack">
      <div className="split">
        <aside className="side-col stack">
          <ListaPassos passos={passos} campos={campos} selecionado={passo.n} aoSelecionar={aoSelecionar} />
          <section className="card card-pad stack-sm" aria-labelledby="esta-gravacao">
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <Icone nome="aprender" className="text-accent" />
              <h2 className="h4" id="esta-gravacao">
                Esta gravação
              </h2>
            </div>
            <p className="small">
              {fluxo.gravadoPor ?? 'Alguém da equipe'}
              {fluxo.gravadoEm ? `, ${fmt.dataHora(fluxo.gravadoEm)}` : ''}
              {fluxo.duracaoGravacaoMs ? `, ${fmt.duracao(fluxo.duracaoGravacaoMs)}` : ''}. Senhas e valores digitados não foram gravados.
            </p>
            {!somenteLeitura ? (
              <div className="row wrap" style={{ paddingTop: 'var(--s-1)' }}>
                <Botao tamanho="sm" icone="copiloto" disabled={!online} onClick={aoOrganizar}>
                  Organizar com o Claude
                </Botao>
              </div>
            ) : null}
          </section>
        </aside>

        <div className="main-col stack">
          <DetalhePasso
            key={passo.n}
            fluxo={fluxo}
            passo={passo}
            somenteLeitura={somenteLeitura}
            aoMudar={mudar}
            aoRemover={() => void remover()}
            aoIr={aoSelecionar}
          />

          {frageis.map((p) => (
            <Aviso
              key={p.n}
              tipo="aviso"
              titulo={`O passo ${p.n} depende ${p.tipo === 'clique' || p.tipo === 'download' ? 'do texto do botão' : 'do texto da tela'}. Se a tela mudar, o copiloto tenta se recuperar sozinho e avisa você.`}
              acoes={
                p.n !== passo.n ? (
                  <Botao variante="fantasma" tamanho="sm" onClick={() => aoSelecionar(p.n)}>
                    Ver passo {p.n}
                  </Botao>
                ) : undefined
              }
            >
              <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                <span className="mono">{seletorDo(p)?.seletor}</span>
                <SeloEstabilidade estabilidade="fragil" />
              </span>
            </Aviso>
          ))}

          <div className="row between wrap" style={{ paddingTop: 'var(--s-2)' }}>
            {!somenteLeitura ? (
              <Botao variante="fantasma" icone="aprender" disabled={!online} onClick={aoGravarDeNovo}>
                Gravar de novo
              </Botao>
            ) : (
              <span />
            )}
            <Botao variante="primario" iconeDepois="seta-direita" onClick={aoContinuar}>
              Continuar para mapear
            </Botao>
          </div>
        </div>
      </div>
    </div>
  );
}

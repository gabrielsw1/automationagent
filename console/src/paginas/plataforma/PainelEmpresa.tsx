// Painel da empresa aberta (S7, à direita da lista): situação, responsável, Admin, acesso ao
// sistema, usuários, as 5 etapas da implantação, fluxos com conserto frequente e "Entrar como
// suporte". "Mais ações" edita o acompanhamento e pausa ou reativa a empresa.
import { useState } from 'react';
import { fmt, ROTULO_SITUACAO, type DetalheEmpresaStarta, type LinhaEmpresaStarta } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { useAcao } from '../../api/hooks.ts';
import { apiPlataforma, useApiPlataforma } from '../../api/plataforma.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { ItemMenu, Menu } from '../../componentes/Menu.tsx';
import { Confirmar } from '../../componentes/Modal.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { FaturasEmpresa } from './FaturasEmpresa.tsx';
import { ModalAcompanhamento, ModalRegravar, ModalSuporte } from './ModaisEmpresa.tsx';
import { Etapas, plural, ROTULO_ACESSO, SeloDemo } from './pecas.tsx';

function desde(e: Pick<LinhaEmpresaStarta, 'situacao' | 'faseDesde' | 'suspensaEm'>): string {
  const quando = e.situacao === 'pausado' ? e.suspensaEm : e.faseDesde;
  return quando ? `${ROTULO_SITUACAO[e.situacao]} desde ${fmt.data(quando)}` : ROTULO_SITUACAO[e.situacao];
}

function Cabeca({
  e,
  aoFechar,
  acoes,
}: {
  e: Pick<LinhaEmpresaStarta, 'nome' | 'iniciais' | 'demo' | 'situacao' | 'faseDesde' | 'suspensaEm'> & { dominio?: string | null };
  aoFechar: () => void;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="card-head cp-painel-cabeca">
      <div className="row-top" style={{ gap: 'var(--s-3)', minWidth: 0 }}>
        <span className="avatar" aria-hidden="true">
          {e.iniciais}
        </span>
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <h2 id="t-detalhe" className="h3">
            {e.nome}
          </h2>
          {e.demo ? <SeloDemo /> : null}
          <span className="tiny muted cp-quebra">
            {desde(e)}
            {e.dominio ? (
              <>
                {' · '}
                <span className="mono">
                  {e.dominio.split('.').map((parte, i) => (
                    <span key={i}>
                      {i > 0 ? '.' : ''}
                      {i > 0 ? <wbr /> : null}
                      {parte}
                    </span>
                  ))}
                </span>
              </>
            ) : null}
          </span>
        </div>
      </div>
      <div className="cp-painel-botoes">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar detalhe" onClick={aoFechar}>
          <Icone nome="fechar" tamanho="sm" />
        </button>
        {acoes}
      </div>
    </div>
  );
}

function Conteudo({ d }: { d: DetalheEmpresaStarta }) {
  const [regravar, setRegravar] = useState(false);
  const [suporte, setSuporte] = useState(false);
  const feitas = d.implantacao.filter((e) => e.feita).length;
  const pausada = d.situacao === 'pausado';
  return (
    <div className="card-body stack-lg">
      <dl className="kv cp-kv">
        <dt>Responsável</dt>
        <dd>{d.responsavel?.nome ?? <span className="muted cp-peso-normal">Sem responsável</span>}</dd>
        <dt>Admin na empresa</dt>
        <dd title={d.adminEmpresa?.email}>{d.adminEmpresa?.nome ?? <span className="muted cp-peso-normal">Ainda sem Admin ativo</span>}</dd>
        <dt>Acesso ao sistema</dt>
        <dd>{ROTULO_ACESSO[d.acesso]}</dd>
        <dt>Usuários</dt>
        <dd className="num">{d.limiteUsuarios !== null ? `${fmt.numero(d.usuarios)} de ${fmt.numero(d.limiteUsuarios)}` : fmt.numero(d.usuarios)}</dd>
      </dl>

      <section className="stack-sm" aria-labelledby="t-impl">
        <div className="row between">
          <h3 id="t-impl" className="h4">
            Implantação
          </h3>
          <span className="small muted num">
            {feitas} de {d.implantacao.length}
          </span>
        </div>
        <Etapas etapas={d.implantacao} />
      </section>

      <section className="stack-sm" aria-labelledby="t-conserto">
        <h3 id="t-conserto" className="h4">
          Fluxos com conserto frequente
        </h3>
        {d.fluxosComConserto.length ? (
          <>
            <ul className="card-flat cp-fluxos">
              {d.fluxosComConserto.map((f) => (
                <li key={f.tarefaId} className="row-top between">
                  <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                    <span className="small strong">{f.nome}</span>
                    <span className="tiny muted cp-quatro-linhas" title={f.detalhe ?? undefined}>
                      {plural(f.consertos30d, 'conserto', 'consertos')} em 30 dias
                      {f.ultimoConserto ? ` · último em ${fmt.diaMes(f.ultimoConserto)}` : ''}
                      {f.detalhe ? ` · ${f.detalhe.split(' · ')[0]}` : ''}
                    </span>
                  </div>
                  {f.quebrado ? <span className="badge badge-danger">Quebrado</span> : null}
                </li>
              ))}
            </ul>
            <Botao tamanho="sm" icone="enviar" className="cp-alinhar-inicio" onClick={() => setRegravar(true)}>
              Sugerir regravação à empresa
            </Botao>
          </>
        ) : (
          <p className="small muted">Nenhum fluxo precisou de conserto visual nos últimos 30 dias.</p>
        )}
      </section>

      <FaturasEmpresa empresaId={d.id} />

      <hr className="divider" />

      <section className="stack-sm" aria-labelledby="t-suporte">
        <h3 id="t-suporte" className="h4">
          Conteúdo da empresa
        </h3>
        <p className="small muted">
          Conversas e prints estão ocultos. Entre no modo suporte só quando a empresa pedir ajuda ou um fluxo precisar de diagnóstico.
        </p>
        <Botao bloco icone="cadeado" aria-describedby="nota-suporte" disabled={pausada} onClick={() => setSuporte(true)}>
          Entrar como suporte
        </Botao>
        <p id="nota-suporte" className="tiny muted row-top cp-nota">
          <Icone nome="info" tamanho="sm" />
          <span>
            {pausada
              ? 'A empresa está pausada. Reative para entrar como suporte.'
              : 'Fica registrado na auditoria da empresa e ela é avisada. Você vai precisar dizer o motivo.'}
          </span>
        </p>
      </section>

      <ModalRegravar aberto={regravar} empresa={d} fluxos={d.fluxosComConserto} aoFechar={() => setRegravar(false)} />
      <ModalSuporte aberto={suporte} empresa={d} aoFechar={() => setSuporte(false)} />
    </div>
  );
}

export function PainelEmpresa({
  id,
  linha,
  aoFechar,
  aoMudar,
}: {
  id: string;
  /** A linha da lista, para o cabeçalho aparecer enquanto o detalhe carrega. */
  linha: LinhaEmpresaStarta | undefined;
  aoFechar: () => void;
  /** Algo mudou na empresa: a lista e os contadores buscam de novo. */
  aoMudar: () => void;
}) {
  const toast = useToast();
  const detalhe = useApiPlataforma<DetalheEmpresaStarta>(`/empresas/${encodeURIComponent(id)}`);
  const [editando, setEditando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const d = detalhe.dados;
  const status = useAcao((novo: 'ativa' | 'suspensa') => apiPlataforma.put<DetalheEmpresaStarta>(`/empresas/${encodeURIComponent(id)}/status`, { status: novo }));

  const atualizado = (novo: DetalheEmpresaStarta) => {
    detalhe.definir(() => novo);
    aoMudar();
  };

  const mudarStatus = async () => {
    if (!d) return;
    const pausar = d.situacao !== 'pausado';
    const r = await status.executar(pausar ? 'suspensa' : 'ativa');
    if (!r) return;
    atualizado(r);
    setConfirmar(false);
    toast.sucesso(pausar ? `${r.nome} foi pausada.` : `${r.nome} foi reativada.`);
  };

  const cabeca = d ?? linha;
  const acoes = d ? (
    <Menu
      largura={240}
      botao={(p) => (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Mais ações para ${d.nome}`} {...p}>
          <Icone nome="pontos" tamanho="sm" />
        </button>
      )}
    >
      {(fechar) => (
        <>
          <ItemMenu
            titulo="Editar acompanhamento"
            icone="editar"
            aoClicar={() => {
              fechar();
              setEditando(true);
            }}
          />
          <ItemMenu
            titulo={d.situacao === 'pausado' ? 'Reativar empresa' : 'Pausar empresa'}
            icone={d.situacao === 'pausado' ? 'play' : 'cadeado'}
            perigo={d.situacao !== 'pausado'}
            aoClicar={() => {
              fechar();
              status.limparErro();
              setConfirmar(true);
            }}
          />
        </>
      )}
    </Menu>
  ) : null;

  return (
    <aside id="painel-empresa" className="side-col card cp-painel" aria-labelledby="t-detalhe">
      {cabeca ? (
        <Cabeca e={{ ...cabeca, dominio: d?.dominio }} aoFechar={aoFechar} acoes={acoes} />
      ) : (
        <div className="card-head">
          <h2 id="t-detalhe" className="h4">
            Empresa
          </h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar detalhe" onClick={aoFechar}>
            <Icone nome="fechar" tamanho="sm" />
          </button>
        </div>
      )}
      {d ? (
        <Conteudo d={d} />
      ) : detalhe.erro ? (
        <div className="card-body">
          <EstadoErro
            erro={detalhe.erro}
            aoTentar={detalhe.erro.status === 404 ? undefined : () => void detalhe.recarregar()}
            titulo={detalhe.erro.status === 404 ? 'Empresa não encontrada' : 'Não conseguimos carregar a empresa'}
          />
        </div>
      ) : (
        <div className="card-body">
          <Carregando linhas={6} texto="Carregando a empresa…" />
        </div>
      )}

      {d ? (
        <>
          <ModalAcompanhamento aberto={editando} empresa={d} aoFechar={() => setEditando(false)} aoSalvar={atualizado} />
          <Confirmar
            aberto={confirmar}
            titulo={d.situacao === 'pausado' ? `Reativar ${d.nome}?` : `Pausar ${d.nome}?`}
            texto={
              d.situacao === 'pausado'
                ? 'A equipe volta a entrar no console e o assistente volta a atender no sistema dela.'
                : 'Ninguém da equipe dela entra no console e o assistente para de atender no sistema dela até você reativar. Nada é apagado.'
            }
            rotuloConfirmar={d.situacao === 'pausado' ? 'Reativar empresa' : 'Pausar empresa'}
            perigo={d.situacao !== 'pausado'}
            carregando={status.enviando}
            erro={status.erro ? mensagemErro(status.erro) : null}
            aoConfirmar={() => void mudarStatus()}
            aoFechar={() => setConfirmar(false)}
          />
        </>
      ) : null}
    </aside>
  );
}

function mensagemErro(e: ErroApiCliente): string {
  return e.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : e.message;
}

// Guia de início (C0): os cinco passos para colocar o copiloto no ar, calculados pelo servidor
// (GET /guia). O passo atual abre com o que dá para fazer ali mesmo: descrever a primeira tarefa,
// personalizar e instalar o widget, convidar a equipe. Ao lado, o chat de teste.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  fmt,
  type Canais,
  type ConectorSistema,
  type ConfigWidget,
  type Guia as DadosGuia,
  type ListaTarefas,
  type SistemaEmpresa,
} from '@copiloto/shared';
import { api } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { ChatDeTeste } from '../../componentes/ChatDeTeste.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo as CampoForm, Progresso, Segmentado } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useMigalhas } from '../../componentes/pagina.tsx';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { trechoInstalacao } from '../canais/instalacao.ts';
import { ROTULO_MODO } from '../sistema/Acesso.tsx';
import ModalDescrever from '../tarefas/ModalDescrever.tsx';
import './guia.css';

type Passo = DadosGuia['passos'][number];

const EXTENSO = ['nenhum', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis'];

export function textoFaltam(faltam: number): string {
  if (faltam <= 0) return 'Todos os passos estão feitos.';
  const n = EXTENSO[faltam] ?? String(faltam);
  return faltam === 1 ? 'Falta um passo' : `Faltam ${n} passos`;
}

/** Trecho de instalação do widget, igual ao da tela Canais e widget. */
export function codigoInstalacao(urlScript: string, chave: string, conector: ConectorSistema = 'api'): string {
  return trechoInstalacao(urlScript, chave, conector);
}

function Concluido() {
  return <span className="badge badge-success">Concluído</span>;
}

// ---------- Passo 4: widget ----------

function PassoWidget({ podeEditar, aoVerificar }: { podeEditar: boolean; aoVerificar: (g: DadosGuia) => void }) {
  const { resumo } = useSessao();
  const toast = useToast();
  const canais = useApi<Canais>('/canais');
  const [config, setConfig] = useState<ConfigWidget | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erroVerificar, setErroVerificar] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (canais.dados && !config) setConfig(canais.dados.rascunho);
  }, [canais.dados, config]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const mudar = (p: Partial<ConfigWidget>) => {
    if (!config) return;
    const nova = { ...config, ...p };
    setConfig(nova);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSalvando(true);
      api
        .put<Canais>('/canais/rascunho', { config: nova })
        .then((c) => canais.definir(() => c))
        .catch((e: Error) => toast.erro(`Não salvei a configuração do widget: ${e.message}`))
        .finally(() => setSalvando(false));
    }, 700);
  };

  const publicar = async () => {
    setPublicando(true);
    try {
      const c = await api.post<Canais>('/canais/publicar');
      canais.definir(() => c);
      toast.sucesso('Widget atualizado. Quem abrir o sistema agora já vê o novo nome e a nova mensagem.');
    } catch (e) {
      toast.erro(`Não publiquei o widget: ${(e as Error).message}`);
    } finally {
      setPublicando(false);
    }
  };

  const verificar = async () => {
    setVerificando(true);
    setErroVerificar(null);
    try {
      const g = await api.post<DadosGuia>('/guia/widget-verificado');
      aoVerificar(g);
      toast.sucesso('Widget encontrado no sistema. Passo concluído.');
    } catch (e) {
      setErroVerificar((e as Error).message);
    } finally {
      setVerificando(false);
    }
  };

  if (canais.erro && !canais.dados) {
    return (
      <Aviso tipo="erro" titulo="Não consegui abrir a configuração do widget" acoes={<Botao tamanho="sm" onClick={() => void canais.recarregar()}>Tentar de novo</Botao>}>
        {canais.erro.message} Você também pode configurar em <Link to="/canais">Canais e widget</Link>.
      </Aviso>
    );
  }
  if (!canais.dados || !config) {
    return (
      <div className="card-flat stack-sm" style={{ padding: 'var(--s-5)' }} aria-busy="true">
        <div className="skel" style={{ height: 14, width: '40%' }} />
        <div className="skel" style={{ height: 36 }} />
        <div className="skel" style={{ height: 72 }} />
      </div>
    );
  }

  const tela = canais.dados.conector === 'tela';
  const codigo = codigoInstalacao(canais.dados.urlScript, canais.dados.chavePublica, canais.dados.conector);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.erro('Não consegui copiar. Selecione o código e copie com Ctrl+C.');
    }
  };
  const assunto = `Instalar o copiloto no ${resumo.nomeSistema}`;
  const corpo =
    `Olá! Para o copiloto aparecer no ${resumo.nomeSistema}, cole este código antes do </body> nas páginas em que ele deve aparecer:\n\n${codigo}\n\n` +
    (tela
      ? 'Troque ID_DO_USUARIO_LOGADO, NOME_DO_USUARIO, EMAIL_DO_USUARIO e PERFIS_SEPARADOS_POR_VIRGULA pelos dados de quem está logado, e ' +
        'ASSINATURA_DO_SEU_SERVIDOR pelo HMAC-SHA256 desses dados (um por linha, com os perfis separados só por vírgula) com o segredo do widget, ' +
        'calculado no servidor (nunca no navegador). Assim o copiloto sabe quem pede e o que essa pessoa pode fazer. ' +
        'As instruções completas, com exemplos de código, estão em Canais e widget, no console do copiloto.\n'
      : 'Troque ID_DO_USUARIO_LOGADO pelo identificador de quem está logado e ASSINATURA_DO_SEU_SERVIDOR pelo HMAC-SHA256 desse ID com o segredo do widget, ' +
        'calculado no servidor (nunca no navegador). Assim o copiloto age só com as permissões dessa pessoa.\n');
  const mailto = `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;

  return (
    <div className="card-flat stack cg-widget">
      <fieldset className="cg-fieldset stack" disabled={!podeEditar}>
        <legend className="sr-only">Aparência do widget</legend>
        <div className="grid-2 cg-grade">
          <CampoForm rotulo="Nome do copiloto" ajuda="Aparece no topo do chat.">
            {(p) => <input {...p} value={config.nome} maxLength={40} onChange={(e) => mudar({ nome: e.target.value })} />}
          </CampoForm>
          <div className="field">
            <span className="label" id="posicao-label">
              Posição na tela
            </span>
            <Segmentado
              rotulo="Posição na tela"
              valor={config.posicao}
              desativado={!podeEditar}
              opcoes={[
                { valor: 'direita', rotulo: 'Canto direito' },
                { valor: 'esquerda', rotulo: 'Canto esquerdo' },
              ]}
              aoTrocar={(posicao) => mudar({ posicao })}
            />
            <span className="help">Escolha o lado que não cobre botões do seu sistema.</span>
          </div>
        </div>
        <CampoForm rotulo="Mensagem de boas-vindas" classe="textarea" ajuda="Diga o que ele sabe fazer. Pedidos fora da lista de tarefas são recusados com educação.">
          {(p) => <textarea {...p} rows={3} maxLength={400} value={config.boasVindas} onChange={(e) => mudar({ boasVindas: e.target.value })} />}
        </CampoForm>
        <div className="row wrap between" aria-live="polite">
          <span className="small muted">
            {salvando ? 'Salvando…' : canais.dados.temAlteracoes ? 'Alterações salvas como rascunho. Publique para o widget mudar.' : 'Igual ao que está no ar.'}
          </span>
          {canais.dados.temAlteracoes && podeEditar ? (
            <Botao tamanho="sm" carregando={publicando} disabled={salvando} onClick={() => void publicar()}>
              Publicar no widget
            </Botao>
          ) : null}
        </div>
      </fieldset>

      <div className="divider" />

      <div className="stack-sm">
        <div className="row between wrap">
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="label">Código de instalação</span>
            <span className="help">
              Cole antes do <span className="mono">&lt;/body&gt;</span> em todas as páginas do seu sistema onde o copiloto deve aparecer.
            </span>
          </div>
          <Botao tamanho="sm" icone={copiado ? 'check' : 'copiar'} onClick={() => void copiar()}>
            {copiado ? 'Copiado' : 'Copiar código'}
          </Botao>
        </div>
        <pre className="mono cg-codigo">
          <code>{codigo}</code>
        </pre>
        {tela ? (
          <p className="help">
            Troque <span className="mono">ID_DO_USUARIO_LOGADO</span>, <span className="mono">NOME_DO_USUARIO</span>,{' '}
            <span className="mono">EMAIL_DO_USUARIO</span> e <span className="mono">PERFIS_SEPARADOS_POR_VIRGULA</span> pelos dados de quem está
            usando o sistema, e <span className="mono">ASSINATURA_DO_SEU_SERVIDOR</span> pela assinatura calculada no seu servidor. Assim o copiloto sabe
            quem pede e o que essa pessoa pode fazer. <Link to="/canais">Ver como calcular a assinatura</Link>.
          </p>
        ) : (
          <p className="help">
            Troque <span className="mono">ID_DO_USUARIO_LOGADO</span> pelo identificador de quem está usando o sistema, e{' '}
            <span className="mono">ASSINATURA_DO_SEU_SERVIDOR</span> pela assinatura calculada no seu servidor. Assim o copiloto age só com as permissões
            dessa pessoa. <Link to="/canais">Ver como calcular a assinatura</Link>.
          </p>
        )}
      </div>

      {erroVerificar ? (
        <Aviso tipo="aviso" papel="alert" titulo="Ainda não encontramos o widget">
          {erroVerificar}
        </Aviso>
      ) : null}

      <div className="row wrap">
        {podeEditar ? (
          <Botao variante="primario" icone="check" carregando={verificando} onClick={() => void verificar()}>
            Já instalei, verificar
          </Botao>
        ) : null}
        <a className="btn btn-ghost" href={mailto}>
          <Icone nome="externo" tamanho="sm" />
          Enviar instruções ao desenvolvedor
        </a>
      </div>
      {canais.dados.instalacao ? (
        <p className="small text-success">
          Visto em {canais.dados.instalacao.origem} {fmt.haQuanto(canais.dados.instalacao.vistoEm)}.
        </p>
      ) : null}
    </div>
  );
}

// ---------- Página ----------

export default function Guia() {
  const { resumo, recarregarResumo } = useSessao();
  const podeEditar = usePode('editar');
  const podeAdministrar = usePode('administrar');
  const guia = useApi<DadosGuia>('/guia');
  const tarefas = useApi<ListaTarefas>('/tarefas');
  // Sistema ligado só pelas telas (empresas novas) ou pela API (demonstração). Sem resposta, vale a API.
  const sistema = useApi<SistemaEmpresa>('/sistema/config');
  const pelasTelas = sistema.dados?.conector === 'tela';
  const [descrever, setDescrever] = useState(false);
  useMigalhas([{ rotulo: 'Guia de início' }]);

  if (guia.carregando && !guia.dados) return <Carregando texto="Abrindo o guia de início…" />;
  if (guia.erro && !guia.dados) return <EstadoErro erro={guia.erro} aoTentar={() => void guia.recarregar()} />;
  const g = guia.dados!;

  const primeira = tarefas.dados?.tarefas.find((t) => t.versaoPublicada !== null) ?? tarefas.dados?.tarefas[0] ?? null;
  const rascunhos = tarefas.dados?.tarefas.filter((t) => t.versaoPublicada === null) ?? [];
  const atual = g.passos.find((p) => !p.feito)?.chave ?? null;
  const faltam = g.total - g.feitos;
  const nome = fmt.primeiroNome(resumo.eu.nome);

  const aoVerificar = (novo: DadosGuia) => {
    guia.definir(() => novo);
    void recarregarResumo();
  };

  /** Link do lado direito do título, por passo concluído. */
  const linkFeito = (p: Passo): ReactNode => {
    switch (p.chave) {
      case 'sistema':
        return pelasTelas ? (
          <Link className="small strong" to="/sistema">
            Ver sistema
          </Link>
        ) : null;
      case 'tarefa':
        return primeira ? (
          <Link className="small strong" to={`/tarefas/${primeira.id}`}>
            Abrir tarefa
          </Link>
        ) : null;
      case 'testes':
        return primeira ? (
          <Link className="small strong" to={`/tarefas/${primeira.id}?aba=testes`}>
            Ver testes
          </Link>
        ) : null;
      case 'widget':
        return (
          <Link className="small strong" to="/canais">
            Ver widget
          </Link>
        );
      case 'equipe':
        return (
          <Link className="small strong" to="/equipe">
            Ver equipe
          </Link>
        );
    }
  };

  const resumoPasso = (p: Passo): ReactNode => {
    if (p.chave === 'sistema' && p.feito && pelasTelas && sistema.dados) {
      return (
        <>
          <p className="small">
            <span className="muted">Telas no ar · </span>
            <span className="mono">{g.sistema.url}</span>
          </p>
          <p className="small muted">
            O copiloto entra pelas telas: {ROTULO_MODO[sistema.dados.acesso.modo].toLowerCase()}. Grave os fluxos em Aprender fluxo.
          </p>
        </>
      );
    }
    if (p.chave === 'sistema' && p.feito) {
      return (
        <>
          <p className="small">
            <span className="muted">API conectada · </span>
            <span className="mono">{g.sistema.url}</span>
          </p>
          <p className="small muted">
            Seu sistema tem API? Use API (mais rápido e não quebra com mudanças de tela). Não tem? Grave o fluxo na tela.
          </p>
        </>
      );
    }
    if (p.chave === 'testes' && p.feito) {
      const m = /^(\d+ de \d+ acertos)(.*)$/.exec(p.resumo);
      return m ? (
        <p className="small muted">
          <span className="strong text-success">{m[1]}</span>
          {m[2]}
        </p>
      ) : (
        <p className="small muted">{p.resumo}</p>
      );
    }
    return <p className="small muted">{p.resumo}</p>;
  };

  const conteudoAtual = (p: Passo): ReactNode => {
    switch (p.chave) {
      case 'sistema':
        if (pelasTelas) {
          return (
            <Aviso
              tipo="aviso"
              titulo={`Ainda não conseguimos abrir o ${g.sistema.nome}`}
              acoes={
                <>
                  {podeAdministrar ? (
                    <Link className="btn btn-secondary btn-sm" to="/sistema">
                      Abrir Sistema
                    </Link>
                  ) : null}
                  <Botao tamanho="sm" icone="atualizar" onClick={() => void guia.recarregar()}>
                    Tentar de novo
                  </Botao>
                </>
              }
            >
              <p className="small">{p.resumo}</p>
              <p className="small">
                Confira em Sistema o endereço das telas e como o copiloto entra nelas. Depois, tente de novo.
              </p>
            </Aviso>
          );
        }
        return (
          <Aviso
            tipo="aviso"
            titulo={`Ainda não conseguimos falar com o ${g.sistema.nome}`}
            acoes={
              <Botao tamanho="sm" icone="atualizar" onClick={() => void guia.recarregar()}>
                Tentar de novo
              </Botao>
            }
          >
            <p className="small">{p.resumo}</p>
            <p className="small">
              A conexão é configurada no servidor do copiloto (endereço da API <span className="mono">{g.sistema.url}</span> e chave de acesso). Confira com
              quem instalou e tente de novo.
            </p>
          </Aviso>
        );
      case 'tarefa':
        return (
          <div className="stack-sm">
            {rascunhos.length > 0 ? (
              <Aviso tipo="info">
                Você já tem {rascunhos.length === 1 ? 'uma tarefa' : `${rascunhos.length} tarefas`} em rascunho:{' '}
                <Link to={`/tarefas/${rascunhos[0].id}`}>{rascunhos[0].nome}</Link>. Revise e publique para concluir este passo.
              </Aviso>
            ) : null}
            {podeEditar ? (
              <div className="row wrap">
                <Botao variante="primario" icone="editar" onClick={() => setDescrever(true)}>
                  Descrever a tarefa
                </Botao>
                <Link className="btn btn-secondary" to="/aprender">
                  <Icone nome="aprender" tamanho="sm" />
                  Gravar o fluxo na tela
                </Link>
              </div>
            ) : (
              <p className="small muted">Peça a um Admin ou Editor de tarefas para criar a primeira tarefa.</p>
            )}
          </div>
        );
      case 'testes':
        return primeira ? (
          <div className="row wrap">
            <Link className="btn btn-primary" to={`/tarefas/${primeira.id}?aba=testes`}>
              <Icone nome="play" tamanho="sm" />
              Abrir os testes de {primeira.nome}
            </Link>
            <span className="small muted">O passo fica concluído quando pelo menos 80% dos testes acertam.</span>
          </div>
        ) : null;
      case 'widget':
        return <PassoWidget podeEditar={podeEditar} aoVerificar={aoVerificar} />;
      case 'equipe':
        return (
          <div>
            <Link className="btn btn-primary" to="/equipe">
              <Icone nome="equipe" tamanho="sm" />
              Convidar agora
            </Link>
          </div>
        );
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="stack-sm cg-intro">
          <span className="eyebrow">Guia de início</span>
          <h1 className="h1">{faltam > 0 ? 'Vamos colocar o copiloto no ar' : 'O copiloto está no ar'}</h1>
          <p className="body-lg muted">
            {faltam > 0
              ? `Olá, ${nome}. ${textoFaltam(faltam)} para a sua equipe começar a pedir tarefas ao copiloto. Leva cerca de 10 minutos, e você pode parar e voltar quando quiser.`
              : `Tudo pronto, ${nome}. A sua equipe já pode pedir tarefas ao copiloto. Acompanhe os pedidos no painel.`}
          </p>
        </div>
        <div className="stack-sm cg-progresso">
          <div className="row between">
            <span className="strong">
              {g.feitos} de {g.total} passos
            </span>
            <span className="small muted num">{fmt.percentual(g.feitos / Math.max(1, g.total), 0)}</span>
          </div>
          <Progresso valor={g.feitos / Math.max(1, g.total)} rotulo={`${g.feitos} de ${g.total} passos feitos`} />
          {faltam === 0 ? (
            <Link className="btn btn-primary btn-sm" to="/painel">
              Ir para o painel
            </Link>
          ) : null}
        </div>
      </div>

      <div className="split">
        <div className="main-col">
          <section className="card" aria-labelledby="checklist-titulo">
            <div className="card-head">
              <h2 className="h3" id="checklist-titulo">
                Passos para ativar
              </h2>
              <span className="small muted">Salvo automaticamente</span>
            </div>
            <div className="card-body">
              <ol className="steps cg-passos">
                {g.passos.map((p, i) => {
                  const ativo = p.chave === atual;
                  return (
                    <li key={p.chave} className={`step${p.feito ? ' done' : ''}${ativo ? ' active' : ''}`} aria-current={ativo ? 'step' : undefined}>
                      <span className="step-dot" aria-hidden="true">
                        {p.feito ? <Icone nome="check" tamanho="sm" /> : i + 1}
                      </span>
                      <div className={`grow ${ativo ? 'stack' : 'stack-sm'} cg-passo`}>
                        <div className="row between wrap">
                          <div className="row wrap">
                            <h3 className="h4">
                              {i + 1}. {p.titulo}
                            </h3>
                            {p.feito ? <Concluido /> : null}
                            {ativo ? (
                              <span className="badge badge-info">
                                <span className="dot" />
                                Passo atual
                              </span>
                            ) : null}
                          </div>
                          {p.feito ? linkFeito(p) : null}
                          {!p.feito && !ativo && p.chave === 'equipe' ? (
                            <Link className="btn btn-secondary btn-sm" to="/equipe">
                              Convidar agora
                            </Link>
                          ) : null}
                        </div>
                        {ativo && p.chave === 'widget' ? (
                          <p className="small muted">
                            Escolha como o copiloto se apresenta e cole um trecho de código no seu sistema. Ele aparece como um botão no canto da tela, só
                            para quem está logado.
                          </p>
                        ) : ativo && p.chave === 'equipe' ? (
                          <p className="small muted">Chame quem vai criar tarefas e acompanhar execuções. Você define o que cada pessoa pode ver e alterar.</p>
                        ) : (
                          resumoPasso(p)
                        )}
                        {!p.feito && !ativo && p.chave === 'equipe' ? <p className="small muted">Dá para fazer antes dos outros passos.</p> : null}
                        {ativo ? conteudoAtual(p) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        </div>

        <aside className="side-col stack cg-lateral" aria-label="Teste e ajuda">
          <section className="card" aria-labelledby="teste-titulo">
            <div className="card-body stack-sm cg-teste">
              <ChatDeTeste
                seletor="pilula"
                focarAoAbrir={false}
                altura={500}
                titulo={
                  <div className="row" style={{ gap: 'var(--s-2)' }}>
                    <span className="avatar avatar-bot avatar-sm" aria-hidden="true">
                      <Icone nome="copiloto" tamanho="sm" />
                    </span>
                    <h2 className="h4" id="teste-titulo">
                      Teste o copiloto agora
                    </h2>
                  </div>
                }
              />
              <p className="tiny muted">No modo de teste nada é gravado no seu sistema.</p>
            </div>
          </section>

          <section className="card card-pad stack-sm" aria-labelledby="ajuda-titulo">
            <h2 className="h4" id="ajuda-titulo">
              Precisa de ajuda?
            </h2>
            <p className="small muted">
              O passo a passo completo da instalação, com exemplos de como calcular a assinatura em várias linguagens, está em Canais e widget.
            </p>
            <Link className="btn btn-secondary btn-block" to="/canais">
              <Icone nome="canais" tamanho="sm" />
              Abrir Canais e widget
            </Link>
          </section>
        </aside>
      </div>

      <ModalDescrever aberto={descrever} aoFechar={() => setDescrever(false)} />
    </div>
  );
}


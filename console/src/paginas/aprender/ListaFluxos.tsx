// Lista dos fluxos gravados e o começo de uma gravação nova (C4).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MARCA_EXTENSAO, fmt, type Fluxo, type ListaTarefas } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi, useEventosConsole } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { Aviso, CabecalhoPagina, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { useMigalhas, useOnline } from '../../componentes/pagina.tsx';
import { SeloCaminho } from '../../componentes/Selos.tsx';
import { recarregar, usePode, useSessao } from '../../componentes/sessao.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { ETAPAS, prepararAba, rotuloSituacao, type RespostaGravacao } from './comum.tsx';

function ComoFunciona() {
  const textos = [
    'Você faz a tarefa uma vez na tela, com um cliente de teste.',
    'Confere os passos que o copiloto entendeu.',
    'Liga cada campo da tela a um dado da tarefa.',
    'Roda o fluxo de verdade e vê o print de cada passo.',
    'Publica e o copiloto passa a usar o fluxo.',
  ];
  return (
    <section className="card card-pad stack" aria-labelledby="como-funciona">
      <h2 className="h4" id="como-funciona">
        Como funciona
      </h2>
      <ol className="ap-como-funciona">
        {ETAPAS.map((e, i) => (
          <li key={e.id}>
            <span className="ap-como-numero" aria-hidden="true">
              {i + 1}
            </span>
            <span className="stack-sm" style={{ gap: 2 }}>
              <span className="small strong">{e.rotulo}</span>
              <span className="tiny muted">{textos[i]}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A extensão do copiloto marca o <html> de toda página logo no início. */
export function extensaoInstalada(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(MARCA_EXTENSAO);
}

/**
 * Endereço que chega do "Gravar esta aba" da extensão: vira caminho quando é uma tela do sistema
 * (mesma origem de urlTelas); de outro site, fica o endereço completo.
 */
export function enderecoParaGravar(url: string, urlTelas?: string | null): string {
  try {
    const u = new URL(url);
    if (urlTelas && u.origin === new URL(urlTelas).origin) return `${u.pathname}${u.search}${u.hash}`;
    return u.toString();
  } catch {
    return url;
  }
}

function SobreExtensao() {
  if (extensaoInstalada()) {
    return (
      <p className="small text-success row" style={{ gap: 'var(--s-2)' }}>
        <Icone nome="check" tamanho="sm" />
        Extensão instalada: a gravação funciona em qualquer site, mesmo sem o widget.
      </p>
    );
  }
  return (
    <p className="tiny muted">
      Para gravar em sites sem o widget do copiloto, instale o gravador de fluxos (extensão do navegador).{' '}
      <Link to="/aprender/instalar">Como instalar</Link>
    </p>
  );
}

export function ModalNovaGravacao({
  aberto,
  aoFechar,
  tarefaInicial,
  urlInicialSugerida,
}: {
  aberto: boolean;
  aoFechar: () => void;
  tarefaInicial?: string | null;
  /** Endereço completo vindo da extensão ("Gravar esta aba"). */
  urlInicialSugerida?: string | null;
}) {
  const navegar = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { resumo } = useSessao();
  const tarefas = useApi<ListaTarefas>(aberto ? '/tarefas' : null);
  const conexao = useApi<{ urlTelas: string }>(aberto && urlInicialSugerida ? '/sistema/conexao' : null);
  const [nome, setNome] = useState('');
  const [tarefaId, setTarefaId] = useState<string>(tarefaInicial ?? '');
  const [urlInicial, setUrlInicial] = useState(urlInicialSugerida ? enderecoParaGravar(urlInicialSugerida) : '');
  const [erros, setErros] = useState<{ nome?: string; url?: string; geral?: string }>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErros({});
    setTarefaId(tarefaInicial ?? '');
  }, [aberto, tarefaInicial]);

  // Endereço da extensão: completo até saber o endereço das telas; aí vira caminho, se for do sistema.
  const urlTelas = conexao.dados?.urlTelas;
  useEffect(() => {
    if (!aberto || !urlInicialSugerida) return;
    setUrlInicial(enderecoParaGravar(urlInicialSugerida, urlTelas));
  }, [aberto, urlInicialSugerida, urlTelas]);

  // Ao escolher a tarefa, sugere o nome do fluxo.
  const tarefa = tarefas.dados?.tarefas.find((t) => t.id === tarefaId);
  useEffect(() => {
    if (tarefa && !nome.trim()) setNome(tarefa.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarefa?.id]);

  const comecar = async () => {
    const e: typeof erros = {};
    if (nome.trim().length < 2) e.nome = 'Dê um nome ao fluxo, por exemplo “Segunda via de boleto”.';
    if (!urlInicial.trim()) e.url = `Informe a página do ${resumo.nomeSistema} onde a tarefa começa.`;
    setErros(e);
    if (e.nome || e.url) return;
    // A aba abre já no clique; o endereço chega logo depois.
    const aba = prepararAba();
    setEnviando(true);
    try {
      const r = await api.post<RespostaGravacao>('/fluxos', { nome: nome.trim(), tarefaId: tarefaId || null, urlInicial: urlInicial.trim() });
      const abriu = aba.ir(r.urlGravacao);
      toast.mostrar({
        tipo: 'info',
        texto: abriu
          ? `Gravação começou. Faça a tarefa na aba do ${resumo.nomeSistema} que abriu.`
          : 'Gravação começou. Seu navegador bloqueou a aba nova: use “Abrir a tela de gravação”.',
      });
      aoFechar();
      navegar(`/aprender/${encodeURIComponent(r.fluxo.id)}`);
    } catch (err) {
      aba.fechar();
      setErros({ geral: (err as ErroApiCliente).message });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      travado={enviando}
      titulo="Começar gravação"
      descricao={`Uma aba do ${resumo.nomeSistema} vai abrir com a barra “Gravando” do copiloto. Faça a tarefa do começo ao fim, uma vez.`}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone="aprender" carregando={enviando} disabled={!online} onClick={() => void comecar()}>
            Abrir e gravar
          </Botao>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          void comecar();
        }}
      >
        {erros.geral ? <Aviso tipo="erro" titulo="Não deu para começar a gravação">{erros.geral}</Aviso> : null}
        <Campo rotulo="Nome do fluxo" obrigatorio erro={erros.nome}>
          {(p) => <input {...p} type="text" value={nome} maxLength={120} placeholder="Ex.: Segunda via de boleto" onChange={(e) => setNome(e.target.value)} data-autofoco />}
        </Campo>
        <Campo
          rotulo="Tarefa"
          classe="select"
          ajuda={tarefas.erro ? 'Não consegui carregar as tarefas. Você pode ligar o fluxo a uma tarefa depois.' : 'Se a tarefa ainda não existe, deixe sem: o copiloto sugere os campos pela gravação.'}
        >
          {(p) => (
            <select {...p} value={tarefaId} onChange={(e) => setTarefaId(e.target.value)} disabled={tarefas.carregando && !tarefas.dados}>
              <option value="">Sem tarefa por enquanto</option>
              {(tarefas.dados?.tarefas ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {t.caminho === 'api' ? ' (reserva da API)' : ''}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo
          rotulo="Página onde a tarefa começa"
          obrigatorio
          erro={erros.url}
          ajuda={
            urlInicialSugerida
              ? 'Veio da aba em que você clicou em Gravar esta aba, no gravador. Pode trocar se a tarefa começar em outra tela.'
              : `Endereço de uma tela do ${resumo.nomeSistema}. Pode colar o endereço completo da barra do navegador.`
          }
        >
          {(p) => (
            <input
              {...p}
              type="text"
              value={urlInicial}
              placeholder="Ex.: /financeiro/segunda-via"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setUrlInicial(e.target.value)}
            />
          )}
        </Campo>
        <Aviso titulo={`Entre no ${resumo.nomeSistema} antes de gravar`}>
          Se a aba pedir usuário e senha, entre primeiro e só depois faça a tarefa. A entrada no sistema não precisa fazer parte do fluxo.
        </Aviso>
        <p className="tiny muted">Senhas e valores digitados nunca são gravados: o copiloto guarda só o formato (por exemplo, 99.999.999/9999-99).</p>
        <SobreExtensao />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function ListaFluxos() {
  useMigalhas([{ rotulo: 'Aprender fluxo' }]);
  const navegar = useNavigate();
  const [busca, setBusca] = useSearchParams();
  const podeEditar = usePode('editar');
  const online = useOnline();
  const { resumo } = useSessao();
  const fluxos = useApi<Fluxo[]>('/fluxos');
  const tarefas = useApi<ListaTarefas>('/tarefas');
  const tarefaDaUrl = busca.get('tarefa');
  // ?gravar=<endereço>: vem do "Gravar esta aba" da extensão do navegador.
  const gravarDaUrl = busca.get('gravar');
  // ?empresa=<id>: a empresa da conta da extensão. Se o console estiver em outra, troca antes de gravar.
  const empresaDaUrl = busca.get('empresa');
  const [trocandoEmpresa, setTrocandoEmpresa] = useState<string | null>(null);
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null);
  useEffect(() => {
    if (!empresaDaUrl) return;
    const semEmpresa = new URLSearchParams(busca);
    semEmpresa.delete('empresa');
    if (empresaDaUrl === resumo.eu.empresa.id) {
      setBusca(semEmpresa, { replace: true });
      return;
    }
    const destino = resumo.eu.empresas.find((e) => e.id === empresaDaUrl);
    if (!destino) {
      setErroEmpresa('O gravador está conectado a uma empresa em que você não está mais. Clique em Trocar no ícone do gravador e escolha a empresa de novo.');
      setBusca(semEmpresa, { replace: true });
      return;
    }
    setTrocandoEmpresa(destino.nome);
    api
      .post('/auth/empresa', { empresaId: destino.id })
      .then(() => recarregar.console(`/aprender?${semEmpresa.toString()}`))
      .catch((e: ErroApiCliente) => {
        setTrocandoEmpresa(null);
        setErroEmpresa(`Não consegui abrir a ${destino.nome} para gravar. ${e.message}`);
        setBusca(semEmpresa, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaDaUrl]);
  const [novo, setNovo] = useState(Boolean(tarefaDaUrl || gravarDaUrl) || busca.get('nova') === '1');

  useEventosConsole((e) => {
    if (e.tipo === 'fluxo') void fluxos.recarregar();
  });

  const nomeTarefa = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tarefas.dados?.tarefas ?? []) m.set(t.id, t.nome);
    return m;
  }, [tarefas.dados]);

  // Versões do mesmo fluxo ficam juntas, da mais nova para a mais antiga.
  const linhas = useMemo(() => {
    const lista = [...(fluxos.dados ?? [])];
    const chave = (f: Fluxo) => `${f.nome}\u0000${f.tarefaId ?? ''}`;
    const recente = new Map<string, string>();
    for (const f of lista) {
      const k = chave(f);
      if (!recente.has(k) || recente.get(k)! < f.salvoEm) recente.set(k, f.salvoEm);
    }
    return lista.sort((a, b) => {
      const ra = recente.get(chave(a))!;
      const rb = recente.get(chave(b))!;
      if (ra !== rb) return ra < rb ? 1 : -1;
      if (chave(a) !== chave(b)) return chave(a) < chave(b) ? -1 : 1;
      return b.versao - a.versao;
    });
  }, [fluxos.dados]);

  const fecharNovo = () => {
    setNovo(false);
    if (busca.has('tarefa') || busca.has('nova') || busca.has('gravar')) {
      const b = new URLSearchParams(busca);
      b.delete('tarefa');
      b.delete('nova');
      b.delete('gravar');
      setBusca(b, { replace: true });
    }
  };

  const acao = podeEditar ? (
    <Botao variante="primario" icone="aprender" disabled={!online} onClick={() => setNovo(true)}>
      Começar gravação
    </Botao>
  ) : null;
  const instalar = !extensaoInstalada() ? (
    <Link className="btn btn-secondary" to="/aprender/instalar">
      <Icone nome="extensao" />
      Instalar o gravador
    </Link>
  ) : null;

  if (trocandoEmpresa) return <Carregando texto={`Abrindo a ${trocandoEmpresa} para gravar…`} />;

  let conteudo;
  if (fluxos.carregando && !fluxos.dados) conteudo = <Carregando forma="tabela" texto="Carregando os fluxos…" />;
  else if (fluxos.erro && !fluxos.dados) {
    conteudo = <EstadoErro erro={fluxos.erro} aoTentar={() => void fluxos.recarregar()} titulo="Não conseguimos carregar os fluxos gravados" />;
  } else if (linhas.length === 0) {
    conteudo = (
      <EstadoVazio
        emCartao
        icone="aprender"
        titulo="Nenhum fluxo gravado ainda"
        texto={`Quando uma tela do ${resumo.nomeSistema} não tem API, grave a tarefa uma vez e o copiloto aprende a repetir os passos num navegador na nuvem.`}
        acao={acao}
      />
    );
  } else {
    conteudo = (
      <Tabela
        rotulo="Fluxos gravados"
        linhas={linhas}
        chave={(f) => f.id}
        aoClicarLinha={(f) => navegar(`/aprender/${encodeURIComponent(f.id)}`)}
        colunas={[
          {
            titulo: 'Fluxo',
            celula: (f) => (
              <div className="stack-sm" style={{ gap: 2 }}>
                <Link to={`/aprender/${encodeURIComponent(f.id)}`} className="strong">
                  {f.nome}
                </Link>
                <span className="tiny muted">
                  Versão {f.versao}
                  {f.urlInicial ? ` · começa em ${f.urlInicial}` : ''}
                </span>
              </div>
            ),
          },
          {
            titulo: 'Tarefa',
            celula: (f) =>
              f.tarefaId ? (
                <Link to={`/tarefas/${encodeURIComponent(f.tarefaId)}`}>{nomeTarefa.get(f.tarefaId) ?? 'Abrir tarefa'}</Link>
              ) : (
                <span className="muted">Sem tarefa</span>
              ),
          },
          {
            titulo: 'Situação',
            celula: (f) => {
              const s = rotuloSituacao(f);
              return (
                <span className={`badge ${s.classe}`}>
                  <span className="dot" />
                  {s.texto}
                </span>
              );
            },
          },
          { titulo: 'Passos', alinhar: 'direita', classe: 'num', celula: (f) => fmt.numero(f.passos.length) },
          {
            titulo: 'Último teste',
            celula: (f) =>
              f.ultimoTeste ? (
                <span className={f.ultimoTeste.ok ? 'text-success small' : 'text-danger small'}>
                  {f.ultimoTeste.ok ? 'Deu certo' : `Falhou no passo ${f.ultimoTeste.passoFalhou ?? '-'}`} · {fmt.quando(f.ultimoTeste.em)}
                </span>
              ) : (
                <span className="muted small">Ainda não testado</span>
              ),
          },
          { titulo: 'Atualizado', celula: (f) => <span className="small">{fmt.quando(f.salvoEm)}</span> },
        ]}
      />
    );
  }

  return (
    <div className="stack-lg">
      <CabecalhoPagina
        titulo="Aprender fluxo"
        selos={<SeloCaminho caminho="navegador" />}
        subtitulo={`Para telas sem API: você faz a tarefa uma vez no ${resumo.nomeSistema} e o copiloto aprende os passos para repetir num navegador na nuvem.`}
        acoes={
          linhas.length || instalar ? (
            <>
              {instalar}
              {linhas.length ? acao : null}
            </>
          ) : null
        }
      />
      {erroEmpresa ? (
        <Aviso tipo="aviso" titulo="Gravação na empresa do gravador">
          {erroEmpresa}
        </Aviso>
      ) : null}
      {!podeEditar ? (
        <Aviso titulo="Você pode ver os fluxos, mas não gravar nem publicar">Seu perfil só permite ver. Peça a um Admin ou a um Editor de tarefas para gravar fluxos.</Aviso>
      ) : null}
      {conteudo}
      <ComoFunciona />
      {podeEditar ? <ModalNovaGravacao aberto={novo && !empresaDaUrl} aoFechar={fecharNovo} tarefaInicial={tarefaDaUrl} urlInicialSugerida={gravarDaUrl} /> : null}
    </div>
  );
}

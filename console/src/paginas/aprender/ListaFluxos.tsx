// Lista dos fluxos gravados e o começo de uma gravação nova (C4).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, type Fluxo, type ListaTarefas } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi, useEventosConsole } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { Aviso, CabecalhoPagina, Campo } from '../../componentes/formulario.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { useMigalhas, useOnline } from '../../componentes/pagina.tsx';
import { SeloCaminho } from '../../componentes/Selos.tsx';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
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

export function ModalNovaGravacao({
  aberto,
  aoFechar,
  tarefaInicial,
}: {
  aberto: boolean;
  aoFechar: () => void;
  tarefaInicial?: string | null;
}) {
  const navegar = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { resumo } = useSessao();
  const tarefas = useApi<ListaTarefas>(aberto ? '/tarefas' : null);
  const [nome, setNome] = useState('');
  const [tarefaId, setTarefaId] = useState<string>(tarefaInicial ?? '');
  const [urlInicial, setUrlInicial] = useState('');
  const [erros, setErros] = useState<{ nome?: string; url?: string; geral?: string }>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErros({});
    setTarefaId(tarefaInicial ?? '');
  }, [aberto, tarefaInicial]);

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
          ajuda={`Endereço de uma tela do ${resumo.nomeSistema}. Pode colar o endereço completo da barra do navegador.`}
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
        <p className="tiny muted">Senhas e valores digitados nunca são gravados: o copiloto guarda só o formato (por exemplo, 99.999.999/9999-99).</p>
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
  const [novo, setNovo] = useState(Boolean(tarefaDaUrl) || busca.get('nova') === '1');

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
    if (busca.has('tarefa') || busca.has('nova')) {
      const b = new URLSearchParams(busca);
      b.delete('tarefa');
      b.delete('nova');
      setBusca(b, { replace: true });
    }
  };

  const acao = podeEditar ? (
    <Botao variante="primario" icone="aprender" disabled={!online} onClick={() => setNovo(true)}>
      Começar gravação
    </Botao>
  ) : null;

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
        acoes={linhas.length ? acao : null}
      />
      {!podeEditar ? (
        <Aviso titulo="Você pode ver os fluxos, mas não gravar nem publicar">Seu perfil só permite ver. Peça a um Admin ou a um Editor de tarefas para gravar fluxos.</Aviso>
      ) : null}
      {conteudo}
      <ComoFunciona />
      {podeEditar ? <ModalNovaGravacao aberto={novo} aoFechar={fecharNovo} tarefaInicial={tarefaDaUrl} /> : null}
    </div>
  );
}

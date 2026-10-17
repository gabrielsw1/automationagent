// Assistente de um fluxo (C4): Gravar → Revisar passos → Mapear campos → Testar → Publicar.
// O fluxo é recarregado ao vivo pelos eventos do console (e a cada 4 s enquanto grava).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt, type Campo, type EtapaFluxo, type Fluxo, type PassoFluxo, type TarefaDetalhe } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi, useEventosConsole } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, CabecalhoPagina } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Confirmar } from '../../componentes/Modal.tsx';
import { useMigalhas, useOnline } from '../../componentes/pagina.tsx';
import { SeloCaminho } from '../../componentes/Selos.tsx';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { camposDoFluxo, ETAPAS, indiceEtapa, PontoAoVivo, prepararAba, type RespostaGravacao } from './comum.tsx';
import { EtapaGravar } from './EtapaGravar.tsx';
import { EtapaMapear } from './EtapaMapear.tsx';
import { EtapaPublicar } from './EtapaPublicar.tsx';
import { EtapaRevisar } from './EtapaRevisar.tsx';
import { EtapaTestar } from './EtapaTestar.tsx';

type Mudancas = Partial<{ passos: PassoFluxo[]; camposSugeridos: Campo[]; tarefaId: string | null; etapa: EtapaFluxo; nome: string }>;

function Etapas({
  atual,
  alcancada,
  liberadas,
  aoIr,
}: {
  atual: EtapaFluxo;
  /** A etapa mais adiantada já alcançada (as anteriores aparecem como feitas). */
  alcancada: number;
  liberadas: boolean;
  aoIr: (e: EtapaFluxo) => void;
}) {
  const iAtual = indiceEtapa(atual);
  return (
    <ol className="card ap-etapas" aria-label="Etapas do assistente">
      {ETAPAS.map((e, i) => {
        const feita = i < alcancada && i !== iAtual;
        const classe = i === iAtual ? 'atual' : feita ? 'feita' : 'futura';
        const pode = liberadas && i !== iAtual && i <= Math.max(alcancada, iAtual);
        return [
          i > 0 ? <li key={`l${i}`} aria-hidden="true" className={`ap-etapa-linha${i <= alcancada ? ' feita' : ''}`} /> : null,
          <li key={e.id} className={`ap-etapa ${classe}`} aria-current={i === iAtual ? 'step' : undefined}>
            <button type="button" disabled={!pode} onClick={() => aoIr(e.id)}>
              <span className="ap-etapa-bola" aria-hidden="true">
                {feita ? <Icone nome="check" tamanho="sm" /> : i + 1}
              </span>
              <span className="ap-etapa-nome">
                {i + 1} {e.rotulo}
              </span>
              <span className="sr-only">{i === iAtual ? '(etapa atual)' : feita ? '(concluída)' : ''}</span>
            </button>
          </li>,
        ];
      })}
    </ol>
  );
}

export default function Assistente({ fluxoId }: { fluxoId: string }) {
  const navegar = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const podeEditar = usePode('editar');
  const { resumo } = useSessao();
  const caminho = `/fluxos/${encodeURIComponent(fluxoId)}`;
  const [intervalo, setIntervalo] = useState<number | undefined>(undefined);
  const fluxo = useApi<Fluxo>(caminho, { intervaloMs: intervalo });
  const f = fluxo.dados;
  const tarefa = useApi<TarefaDetalhe>(f?.tarefaId ? `/tarefas/${encodeURIComponent(f.tarefaId)}` : null);
  const [etapa, setEtapa] = useState<EtapaFluxo | null>(null);
  const [selecionado, setSelecionado] = useState(1);
  const [confirmar, setConfirmar] = useState<null | 'gravar' | 'organizar' | 'apagar'>(null);
  const [agindo, setAgindo] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const statusAnterior = useRef<Fluxo['status'] | null>(null);

  useMigalhas([{ rotulo: 'Aprender fluxo', para: '/aprender' }, { rotulo: f?.nome ?? 'Fluxo' }]);

  useEffect(() => setIntervalo(f?.status === 'gravando' ? 4000 : undefined), [f?.status]);

  // Etapa inicial vem do servidor; quando a gravação termina (pelo widget), vai para "Revisar".
  useEffect(() => {
    if (!f) return;
    const antes = statusAnterior.current;
    statusAnterior.current = f.status;
    if (f.status === 'gravando') setEtapa('gravar');
    else if (antes === 'gravando') {
      setEtapa(f.passos.length ? 'revisar' : 'gravar');
      setSelecionado(1);
      if (f.passos.length) toast.sucesso(`Gravação concluída com ${f.passos.length} ${f.passos.length === 1 ? 'passo' : 'passos'}. Confira cada um.`);
    } else if (antes === null) setEtapa(f.passos.length ? f.etapa : 'gravar');
  }, [f, toast]);

  useEventosConsole((e) => {
    if (e.tipo !== 'fluxo' || e.fluxoId !== fluxoId) return;
    if (e.etapa === 'apagado') {
      toast.mostrar({ tipo: 'info', texto: 'Este fluxo foi apagado.' });
      navegar('/aprender', { replace: true });
      return;
    }
    void fluxo.recarregar();
  });

  const atualizar = useCallback((novo: Fluxo) => fluxo.definir(() => novo), [fluxo]);

  /** Salva mudanças (mostra na hora e confirma com o servidor). */
  const salvar = useCallback(
    async (m: Mudancas): Promise<boolean> => {
      fluxo.definir((atual) => (atual ? { ...atual, ...m } : atual));
      try {
        const novo = await api.put<Fluxo>(caminho, m);
        fluxo.definir(() => novo);
        return true;
      } catch (e) {
        toast.erro((e as ErroApiCliente).message);
        void fluxo.recarregar();
        return false;
      }
    },
    [caminho, fluxo, toast],
  );

  if (fluxo.carregando && !f) return <Carregando forma="ficha" texto="Abrindo o fluxo…" />;
  if (!f) {
    if (fluxo.erro?.status === 404) {
      return (
        <EstadoErro
          erro={fluxo.erro}
          titulo="Este fluxo não existe mais"
          texto="Ele pode ter sido apagado por alguém da equipe."
          aoTentar={() => navegar('/aprender')}
        />
      );
    }
    return <EstadoErro erro={fluxo.erro} aoTentar={() => void fluxo.recarregar()} titulo="Não conseguimos abrir o fluxo" />;
  }

  const publicado = f.status === 'publicado';
  const somenteLeitura = !podeEditar || publicado;
  const etapaAtual: EtapaFluxo = etapa ?? f.etapa;
  const alcancada = publicado ? ETAPAS.length : f.status === 'gravando' ? 0 : indiceEtapa(f.etapa);
  const definicao = tarefa.dados ? (tarefa.dados.rascunho ?? tarefa.dados.publicada)?.definicao : undefined;
  const camposTarefa = f.tarefaId && definicao ? definicao.campos : null;
  const campos = camposDoFluxo(f, camposTarefa);
  const nomeTarefa = definicao?.nome ?? null;

  /** Vai para outra etapa; guarda o avanço no servidor (para retomar depois). */
  const irPara = (e: EtapaFluxo) => {
    setEtapa(e);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
    if (!somenteLeitura && f.status !== 'gravando' && indiceEtapa(e) > indiceEtapa(f.etapa)) void salvar({ etapa: e });
  };

  const gravarDeNovo = async (urlInicial?: string) => {
    const aba = prepararAba();
    setAgindo(true);
    setErroAcao(null);
    try {
      const r = await api.post<RespostaGravacao>(`${caminho}/gravar`, urlInicial ? { urlInicial } : {});
      setConfirmar(null);
      if (!aba.ir(r.urlGravacao)) toast.mostrar({ tipo: 'info', texto: 'Seu navegador bloqueou a aba nova: use “Abrir a tela de gravação”.' });
      if (r.fluxo.id !== f.id) {
        toast.mostrar({ tipo: 'info', texto: `Versão ${r.fluxo.versao} criada. A versão ${f.versao} continua valendo até você publicar a nova.` });
        navegar(`/aprender/${encodeURIComponent(r.fluxo.id)}`);
      } else {
        statusAnterior.current = 'gravando';
        atualizar(r.fluxo);
        setEtapa('gravar');
      }
    } catch (e) {
      aba.fechar();
      setErroAcao((e as ErroApiCliente).message);
      if (!confirmar) toast.erro((e as ErroApiCliente).message);
    } finally {
      setAgindo(false);
    }
  };

  const organizar = async () => {
    setAgindo(true);
    setErroAcao(null);
    try {
      const novo = await api.post<Fluxo>(`${caminho}/aprender`);
      atualizar(novo);
      setConfirmar(null);
      setSelecionado(1);
      setEtapa('revisar');
      toast.sucesso(`O Claude organizou ${novo.passos.length} passos. Confira os títulos e o mapeamento.`);
    } catch (e) {
      setErroAcao((e as ErroApiCliente).message);
    } finally {
      setAgindo(false);
    }
  };

  const apagar = async () => {
    setAgindo(true);
    setErroAcao(null);
    try {
      await api.del(caminho);
      setConfirmar(null);
      toast.sucesso(`Fluxo “${f.nome}” apagado.`);
      navegar('/aprender', { replace: true });
    } catch (e) {
      setErroAcao((e as ErroApiCliente).message);
    } finally {
      setAgindo(false);
    }
  };

  const novaVersao = async () => {
    setAgindo(true);
    try {
      const nova = await api.post<Fluxo>(`${caminho}/nova-versao`);
      toast.mostrar({ tipo: 'info', texto: `Versão ${nova.versao} criada em rascunho. A versão ${f.versao} continua valendo até você publicar a nova.` });
      navegar(`/aprender/${encodeURIComponent(nova.id)}`);
    } catch (e) {
      toast.erro((e as ErroApiCliente).message);
    } finally {
      setAgindo(false);
    }
  };

  const pedirGravarDeNovo = (url?: string) => {
    if (f.passos.length === 0 && !publicado) void gravarDeNovo(url);
    else {
      setErroAcao(null);
      setConfirmar('gravar');
    }
  };

  const situacao =
    f.status === 'gravando' ? (
      <PontoAoVivo rotulo="Gravando" />
    ) : publicado ? (
      <span className="badge badge-success">
        <span className="dot" />
        Publicado · versão {f.versao}
      </span>
    ) : (
      <span className="small muted">
        Versão {f.versao} em rascunho · salvo {fmt.quando(f.salvoEm).toLowerCase()}
      </span>
    );

  let corpo;
  switch (etapaAtual) {
    case 'gravar':
      corpo = (
        <EtapaGravar
          fluxo={f}
          nomeSistema={resumo.nomeSistema}
          podeEditar={podeEditar}
          online={online}
          aoAtualizar={atualizar}
          aoGravarDeNovo={pedirGravarDeNovo}
          aoContinuar={() => irPara('revisar')}
        />
      );
      break;
    case 'revisar':
      corpo = (
        <EtapaRevisar
          fluxo={f}
          campos={campos}
          somenteLeitura={somenteLeitura}
          online={online}
          selecionado={selecionado}
          aoSelecionar={setSelecionado}
          salvarPassos={(passos) => salvar({ passos })}
          aoGravarDeNovo={() => pedirGravarDeNovo()}
          aoOrganizar={() => {
            setErroAcao(null);
            setConfirmar('organizar');
          }}
          aoContinuar={() => irPara('mapear')}
        />
      );
      break;
    case 'mapear':
      corpo = (
        <EtapaMapear
          fluxo={f}
          campos={campos}
          camposTarefa={camposTarefa}
          nomeTarefa={nomeTarefa}
          erroTarefa={f.tarefaId ? tarefa.erro : null}
          somenteLeitura={somenteLeitura}
          online={online}
          salvar={salvar}
          aoAtualizar={atualizar}
          aoVoltar={() => irPara('revisar')}
          aoContinuar={() => irPara('testar')}
        />
      );
      break;
    case 'testar':
      corpo = (
        <EtapaTestar
          fluxo={f}
          campos={campos}
          nomeSistema={resumo.nomeSistema}
          podeTestar={podeEditar}
          online={online}
          aoTestado={atualizar}
          aoRevisarPasso={(n) => {
            setSelecionado(n);
            irPara('revisar');
          }}
          aoVoltar={() => irPara('mapear')}
          aoContinuar={() => irPara('publicar')}
        />
      );
      break;
    default:
      corpo = (
        <EtapaPublicar
          fluxo={f}
          nomeTarefa={nomeTarefa}
          somenteLeitura={somenteLeitura}
          online={online}
          aoPublicado={atualizar}
          aoIrPara={(e) => irPara(e)}
        />
      );
  }

  return (
    <div className="stack-lg">
      <CabecalhoPagina
        eyebrow="Aprender fluxo"
        titulo={`Aprender fluxo: ${f.nome}`}
        selos={<SeloCaminho caminho="navegador" />}
        subtitulo={`O copiloto vai repetir estes passos na tela do ${resumo.nomeSistema}, num navegador na nuvem, com a sessão de quem pediu.`}
        acoes={situacao}
      />

      {!podeEditar ? (
        <Aviso titulo="Você pode ver este fluxo, mas não mudar">Seu perfil só permite ver. Peça a um Admin ou a um Editor de tarefas para gravar, testar e publicar.</Aviso>
      ) : publicado ? (
        <Aviso
          titulo={`Esta é a versão ${f.versao}, publicada e em uso`}
          acoes={
            <>
              <Botao tamanho="sm" variante="primario" icone="editar" carregando={agindo && confirmar === null} disabled={!online} onClick={() => void novaVersao()}>
                Criar nova versão
              </Botao>
              <Botao tamanho="sm" icone="aprender" disabled={!online} onClick={() => pedirGravarDeNovo()}>
                Gravar de novo
              </Botao>
            </>
          }
        >
          Para mudar os passos, crie uma nova versão: esta continua valendo até você publicar a nova. Testar aqui não muda nada no fluxo.
        </Aviso>
      ) : null}

      <Etapas atual={etapaAtual} alcancada={alcancada} liberadas={f.status !== 'gravando' && f.passos.length > 0} aoIr={irPara} />

      {corpo}

      {podeEditar && !publicado && f.status !== 'gravando' ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Botao
            variante="fantasma"
            tamanho="sm"
            icone="lixeira"
            disabled={!online}
            onClick={() => {
              setErroAcao(null);
              setConfirmar('apagar');
            }}
          >
            Apagar este fluxo
          </Botao>
        </div>
      ) : null}

      <Confirmar
        aberto={confirmar === 'gravar'}
        titulo="Gravar de novo?"
        texto={
          publicado
            ? `Uma versão nova (${f.versao + 1}) começa a ser gravada. A versão ${f.versao} continua valendo até você publicar a nova.`
            : 'Os passos atuais e os prints do último teste serão substituídos pela gravação nova.'
        }
        rotuloConfirmar="Abrir e gravar"
        carregando={agindo}
        erro={erroAcao}
        aoConfirmar={() => void gravarDeNovo()}
        aoFechar={() => setConfirmar(null)}
      />
      <Confirmar
        aberto={confirmar === 'organizar'}
        titulo="Organizar os passos com o Claude?"
        texto="O Claude refaz os passos a partir da gravação: junta o que é repetido, dá nomes simples e sugere os dados. O que você mudou nos títulos e no mapeamento será substituído."
        rotuloConfirmar="Organizar"
        carregando={agindo}
        erro={erroAcao}
        aoConfirmar={() => void organizar()}
        aoFechar={() => setConfirmar(null)}
      />
      <Confirmar
        aberto={confirmar === 'apagar'}
        titulo={`Apagar o fluxo “${f.nome}”?`}
        texto="Os passos e os prints dos testes somem. Não dá para desfazer."
        rotuloConfirmar="Apagar fluxo"
        perigo
        carregando={agindo}
        erro={erroAcao}
        aoConfirmar={() => void apagar()}
        aoFechar={() => setConfirmar(null)}
      />
    </div>
  );
}

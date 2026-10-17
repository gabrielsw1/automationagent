// Etapa 1 · Gravar: acompanha a gravação ao vivo (os passos chegam enquanto a pessoa faz a tarefa
// na aba do sistema), conclui ou cancela pelo console e recomeça quando preciso.
import { useState } from 'react';
import { fmt, type Fluxo } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { EstadoVazio } from '../../componentes/estados.tsx';
import { Campo } from '../../componentes/formulario.tsx';
import { Confirmar } from '../../componentes/Modal.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { PontoAoVivo, prepararAba, ROTULO_TIPO, type RespostaGravacao } from './comum.tsx';

export function EtapaGravar({
  fluxo,
  nomeSistema,
  podeEditar,
  online,
  aoAtualizar,
  aoGravarDeNovo,
  aoContinuar,
}: {
  fluxo: Fluxo;
  nomeSistema: string;
  podeEditar: boolean;
  online: boolean;
  aoAtualizar: (f: Fluxo) => void;
  /** Recomeça a gravação (pede confirmação quando já há passos). */
  aoGravarDeNovo: (urlInicial?: string) => void;
  aoContinuar: () => void;
}) {
  const toast = useToast();
  const base = `/fluxos/${encodeURIComponent(fluxo.id)}`;
  const [concluindo, setConcluindo] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelar, setErroCancelar] = useState<string | null>(null);
  const [urlInicial, setUrlInicial] = useState(fluxo.urlInicial ?? '');

  const abrirTela = async () => {
    const aba = prepararAba();
    setAbrindo(true);
    try {
      const r = await api.get<RespostaGravacao>(`${base}/gravacao`);
      if (!aba.ir(r.urlGravacao)) toast.erro('Seu navegador bloqueou a aba nova. Permita janelas deste site e tente de novo.');
    } catch (e) {
      aba.fechar();
      toast.erro((e as ErroApiCliente).message);
    } finally {
      setAbrindo(false);
    }
  };

  const concluir = async () => {
    setConcluindo(true);
    try {
      const f = await api.post<Fluxo>(`${base}/concluir-gravacao`);
      // O assistente passa para "Revisar" e avisa quando o status muda.
      aoAtualizar(f);
    } catch (e) {
      toast.erro((e as ErroApiCliente).message);
    } finally {
      setConcluindo(false);
    }
  };

  const cancelar = async () => {
    setCancelando(true);
    setErroCancelar(null);
    try {
      const f = await api.post<Fluxo>(`${base}/cancelar-gravacao`);
      setConfirmarCancelar(false);
      aoAtualizar(f);
      toast.mostrar({ tipo: 'info', texto: 'Gravação cancelada. Nada foi guardado.' });
    } catch (e) {
      setErroCancelar((e as ErroApiCliente).message);
    } finally {
      setCancelando(false);
    }
  };

  if (fluxo.status === 'gravando') {
    const n = fluxo.passos.length;
    return (
      <section className="card card-pad stack ap-gravando" aria-labelledby="gravando-titulo">
        <div className="row between wrap">
          <div className="stack-sm" style={{ gap: 2 }}>
            <PontoAoVivo rotulo="Gravando agora" />
            <h2 className="h3" id="gravando-titulo">
              Faça a tarefa na aba do {nomeSistema}
            </h2>
          </div>
          <span className="small muted" aria-live="polite">
            {n === 0 ? 'Nenhum passo ainda' : `${n} ${n === 1 ? 'passo' : 'passos'} até agora`}
          </span>
        </div>
        <ol className="ap-dicas small">
          <li>Na aba que abriu, faça a tarefa do começo ao fim, uma vez, com um cliente de teste.</li>
          <li>Senhas e valores digitados não são gravados: o copiloto guarda só o formato.</li>
          <li>Ao terminar, clique em “Concluir” na barra do copiloto, lá na tela, ou aqui embaixo.</li>
        </ol>
        {n > 0 ? (
          <ol className="ap-passos" aria-label="Passos capturados até agora">
            {fluxo.passos.map((p) => (
              <li key={`${p.n}-${p.titulo}`} className="card-flat row ap-novo-passo" style={{ padding: 'var(--s-2) var(--s-3)', gap: 'var(--s-3)' }}>
                <span className="tiny muted" style={{ minWidth: 92 }}>
                  Passo {p.n} · {ROTULO_TIPO[p.tipo]}
                </span>
                <span className="small strong">{p.titulo}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">Os passos aparecem aqui enquanto você grava. Se a aba não abriu, use “Abrir a tela de gravação”.</p>
        )}
        {podeEditar ? (
          <div className="row between wrap" style={{ paddingTop: 'var(--s-2)' }}>
            <div className="row wrap">
              <Botao icone="externo" carregando={abrindo} disabled={!online} onClick={() => void abrirTela()}>
                Abrir a tela de gravação
              </Botao>
              <Botao variante="fantasma" disabled={!online} onClick={() => setConfirmarCancelar(true)}>
                Cancelar gravação
              </Botao>
            </div>
            <Botao variante="primario" icone="check" carregando={concluindo} disabled={!online || n === 0} onClick={() => void concluir()}>
              Concluir gravação
            </Botao>
          </div>
        ) : null}
        <p className="tiny muted">
          {fluxo.gravadoPor ? `Gravação de ${fluxo.gravadoPor}` : 'Gravação'} · começa em {fluxo.urlInicial ?? '/'}
        </p>
        <Confirmar
          aberto={confirmarCancelar}
          titulo="Cancelar a gravação?"
          texto="Os passos capturados até agora serão descartados. Você pode gravar de novo depois."
          rotuloConfirmar="Cancelar gravação"
          rotuloCancelar="Continuar gravando"
          perigo
          carregando={cancelando}
          erro={erroCancelar}
          aoConfirmar={() => void cancelar()}
          aoFechar={() => setConfirmarCancelar(false)}
        />
      </section>
    );
  }

  if (fluxo.passos.length === 0) {
    return (
      <EstadoVazio
        emCartao
        icone="aprender"
        titulo="Nada gravado ainda"
        texto={`Abra a tela do ${nomeSistema} onde a tarefa começa e faça a tarefa uma vez. O copiloto acompanha cada clique e cada campo.`}
        acao={
          podeEditar ? (
            <form
              className="stack"
              style={{ width: 'min(420px, 100%)', textAlign: 'left' }}
              onSubmit={(e) => {
                e.preventDefault();
                aoGravarDeNovo(urlInicial.trim() || undefined);
              }}
            >
              <Campo rotulo="Página onde a tarefa começa" ajuda={`Endereço de uma tela do ${nomeSistema}, por exemplo /financeiro/segunda-via.`}>
                {(p) => <input {...p} type="text" value={urlInicial} spellCheck={false} onChange={(e) => setUrlInicial(e.target.value)} />}
              </Campo>
              <Botao type="submit" variante="primario" icone="aprender" disabled={!online}>
                Começar a gravar
              </Botao>
            </form>
          ) : null
        }
      />
    );
  }

  return (
    <section className="card card-pad stack" aria-labelledby="gravacao-titulo">
      <h2 className="h3" id="gravacao-titulo">
        Gravação concluída
      </h2>
      <p>
        {fluxo.gravadoPor ?? 'Alguém da equipe'} gravou {fluxo.passos.length} {fluxo.passos.length === 1 ? 'passo' : 'passos'}
        {fluxo.gravadoEm ? ` em ${fmt.dataHora(fluxo.gravadoEm)}` : ''}
        {fluxo.duracaoGravacaoMs ? `, em ${fmt.duracao(fluxo.duracaoGravacaoMs)}` : ''}, começando em {fluxo.urlInicial ?? '/'}.
      </p>
      <p className="small muted">
        Gravar de novo substitui os passos atuais.
        {fluxo.status === 'publicado' ? ' Como este fluxo está publicado, a gravação nova vira uma versão nova; a atual continua valendo até você publicar a nova.' : ''}
      </p>
      <div className="row between wrap">
        {podeEditar ? (
          <Botao variante="fantasma" icone="aprender" disabled={!online} onClick={() => aoGravarDeNovo()}>
            Gravar de novo
          </Botao>
        ) : (
          <span />
        )}
        <Botao variante="primario" iconeDepois="seta-direita" onClick={aoContinuar}>
          Revisar os passos
        </Botao>
      </div>
    </section>
  );
}

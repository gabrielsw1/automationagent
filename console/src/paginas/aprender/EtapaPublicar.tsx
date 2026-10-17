// Etapa 5 · Publicar: confere o que falta e publica. Com tarefa, o fluxo entra no rascunho dela.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, type Fluxo } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useToast } from '../../componentes/Toast.tsx';

function Item({ ok, titulo, texto, acao }: { ok: boolean | null; titulo: string; texto: string; acao?: React.ReactNode }) {
  return (
    <li className={`step ${ok === true ? 'done' : ok === false ? 'fail' : ''}`}>
      <span className="step-dot" aria-hidden="true">
        {ok === true ? <Icone nome="check" tamanho="sm" /> : ok === false ? <Icone nome="fechar" tamanho="sm" /> : <Icone nome="info" tamanho="sm" />}
      </span>
      <div className="stack-sm grow" style={{ gap: 2 }}>
        <span className="small strong">
          {titulo}
          <span className="sr-only">{ok === true ? ' (pronto)' : ok === false ? ' (falta)' : ''}</span>
        </span>
        <span className="small muted">{texto}</span>
        {acao}
      </div>
    </li>
  );
}

export function EtapaPublicar({
  fluxo,
  nomeTarefa,
  somenteLeitura,
  online,
  aoPublicado,
  aoIrPara,
}: {
  fluxo: Fluxo;
  nomeTarefa: string | null;
  somenteLeitura: boolean;
  online: boolean;
  aoPublicado: (f: Fluxo) => void;
  aoIrPara: (etapa: 'mapear' | 'testar') => void;
}) {
  const toast = useToast();
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ligadaA, setLigadaA] = useState<{ id: string; nome: string } | null>(null);
  const pendencias = fluxo.passos.filter((p) => p.pendencia);
  const testeOk = Boolean(fluxo.ultimoTeste?.ok);
  const publicado = fluxo.status === 'publicado';
  const pronto = pendencias.length === 0 && testeOk && fluxo.passos.length > 0;

  const publicar = async () => {
    setPublicando(true);
    setErro(null);
    try {
      const r = await api.post<{ fluxo: Fluxo; tarefa: { id: string; nome: string } | null }>(`/fluxos/${encodeURIComponent(fluxo.id)}/publicar`);
      setLigadaA(r.tarefa);
      aoPublicado(r.fluxo);
      toast.sucesso(r.tarefa ? `Fluxo publicado e ligado ao rascunho de “${r.tarefa.nome}”.` : 'Fluxo publicado.');
    } catch (e) {
      setErro((e as ErroApiCliente).message);
    } finally {
      setPublicando(false);
    }
  };

  const tarefaLink = fluxo.tarefaId ? (
    <Link to={`/tarefas/${encodeURIComponent(fluxo.tarefaId)}`}>{ligadaA?.nome ?? nomeTarefa ?? 'a tarefa'}</Link>
  ) : null;

  if (publicado) {
    return (
      <section className="card card-pad stack" aria-labelledby="publicado-titulo">
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <span className="badge badge-success">
            <span className="dot" />
            Publicado
          </span>
          <h2 className="h3" id="publicado-titulo">
            Versão {fluxo.versao} publicada
          </h2>
        </div>
        {fluxo.tarefaId ? (
          <p>
            {ligadaA ? (
              <>
                O fluxo entrou no rascunho da tarefa {tarefaLink}. Publique a tarefa para o copiloto começar a usar esta versão.
              </>
            ) : (
              <>Este fluxo é da tarefa {tarefaLink}. O copiloto usa o fluxo que estiver na versão publicada da tarefa.</>
            )}
          </p>
        ) : (
          <p>O fluxo está pronto, mas não está ligado a nenhuma tarefa. Para usar, escolha este fluxo na ficha da tarefa, aba Execução, em “Fluxo gravado”.</p>
        )}
        <p className="small muted">
          {fluxo.ultimoTeste?.ok ? `Último teste com sucesso em ${fmt.dataHora(fluxo.ultimoTeste.em)}. ` : ''}
          Para mudar os passos, crie uma nova versão: esta continua valendo até você publicar a nova.
        </p>
        {fluxo.tarefaId ? (
          <div className="row wrap">
            <Link className="btn btn-primary" to={`/tarefas/${encodeURIComponent(fluxo.tarefaId)}`}>
              Abrir a ficha da tarefa
              <Icone nome="seta-direita" tamanho="sm" />
            </Link>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card card-pad stack" aria-labelledby="publicar-titulo">
      <h2 className="h3" id="publicar-titulo">
        Publicar a versão {fluxo.versao}
      </h2>
      <ol className="steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        <Item
          ok={pendencias.length === 0}
          titulo={pendencias.length ? `${pendencias.length} ${pendencias.length === 1 ? 'passo com pendência' : 'passos com pendência'}` : `${fluxo.passos.length} passos sem pendência`}
          texto={pendencias.length ? pendencias.map((p) => `Passo ${p.n}: ${p.pendencia}`).join(' · ') : 'Cada campo da tela está ligado a um dado ou a um valor fixo.'}
          acao={
            pendencias.length ? (
              <Botao tamanho="sm" variante="fantasma" onClick={() => aoIrPara('mapear')}>
                Resolver no mapeamento
              </Botao>
            ) : undefined
          }
        />
        <Item
          ok={testeOk}
          titulo={testeOk ? 'Teste com sucesso' : 'Falta um teste com sucesso'}
          texto={
            testeOk
              ? `Rodou do começo ao fim em ${fmt.dataHora(fluxo.ultimoTeste!.em)}.`
              : fluxo.ultimoTeste
                ? `O último teste falhou${fluxo.ultimoTeste.passoFalhou ? ` no passo ${fluxo.ultimoTeste.passoFalhou}` : ''}. Depois de qualquer mudança nos passos, teste de novo.`
                : 'Rode o fluxo uma vez no sistema antes de publicar.'
          }
          acao={
            !testeOk ? (
              <Botao tamanho="sm" variante="fantasma" onClick={() => aoIrPara('testar')}>
                Ir para o teste
              </Botao>
            ) : undefined
          }
        />
        <Item
          ok={fluxo.tarefaId ? true : null}
          titulo={fluxo.tarefaId ? 'Ligado a uma tarefa' : 'Sem tarefa'}
          texto={
            fluxo.tarefaId
              ? `Ao publicar, o fluxo entra no rascunho da tarefa “${nomeTarefa ?? 'ligada'}”. Ela passa a usá-lo quando você publicar a tarefa.`
              : 'Dá para publicar assim e escolher o fluxo depois, na ficha da tarefa (aba Execução).'
          }
        />
      </ol>
      {erro ? <Aviso tipo="erro" titulo="Não deu para publicar">{erro}</Aviso> : null}
      {!somenteLeitura ? (
        <div className="row between wrap">
          <Botao onClick={() => aoIrPara('testar')} icone="seta-esquerda">
            Voltar
          </Botao>
          <Botao variante="primario" icone="check" carregando={publicando} disabled={!online || !pronto} onClick={() => void publicar()}>
            Publicar versão {fluxo.versao}
          </Botao>
        </div>
      ) : null}
    </section>
  );
}

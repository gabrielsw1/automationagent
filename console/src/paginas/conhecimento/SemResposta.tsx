// "Perguntas sem boa resposta": o que o copiloto não soube responder nos últimos 30 dias.
// "Escrever resposta" vira uma resposta pronta; "Ignorar" tira da lista.
import { useEffect, useState } from 'react';
import type { FonteConhecimento, PerguntaSemResposta } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Aviso, Botao, Campo, Carregando, EstadoErro, Modal, useToast } from '../../componentes/index.ts';

function ResponderPergunta({
  item,
  aoFechar,
  aoSalvar,
}: {
  item: PerguntaSemResposta | null;
  aoFechar: () => void;
  aoSalvar: (fonte: FonteConhecimento) => void;
}) {
  const [pergunta, setPergunta] = useState('');
  const [resposta, setResposta] = useState('');
  const [erro, setErro] = useState<{ pergunta?: string; resposta?: string }>({});
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!item) return;
    setPergunta(item.pergunta);
    setResposta('');
    setErro({});
    setErroEnvio(null);
  }, [item]);

  async function salvar() {
    if (!item) return;
    const e: typeof erro = {};
    if (pergunta.trim().length < 3) e.pergunta = 'Escreva a pergunta.';
    if (resposta.trim().length < 3) e.resposta = 'Escreva a resposta.';
    setErro(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const r = await api.post<{ ok: true; fonte: FonteConhecimento }>(`/conhecimento/perguntas-sem-resposta/${item.id}/responder`, {
        resposta: resposta.trim(),
        ...(pergunta.trim() !== item.pergunta ? { pergunta: pergunta.trim() } : {}),
      });
      aoSalvar(r.fonte);
    } catch (err) {
      setErroEnvio((err as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={!!item}
      titulo="Escrever resposta"
      descricao={item ? `Perguntaram isso ${item.vezes === 1 ? '1 vez' : `${item.vezes} vezes`} nos últimos 30 dias.` : undefined}
      aoFechar={aoFechar}
      travado={enviando}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={enviando} onClick={() => void salvar()}>
            Salvar resposta
          </Botao>
        </>
      }
    >
      <Campo rotulo="Pergunta" obrigatorio erro={erro.pergunta} ajuda="Pode ajustar o texto: vale para perguntas parecidas também.">
        {(p) => <input {...p} type="text" maxLength={500} value={pergunta} onChange={(e) => setPergunta(e.target.value)} />}
      </Campo>
      <Campo
        rotulo="Resposta"
        classe="textarea"
        obrigatorio
        erro={erro.resposta}
        ajuda="Vira uma resposta pronta: o copiloto passa a usar este texto na hora e cita “Respostas prontas da equipe”."
      >
        {(p) => <textarea {...p} rows={6} maxLength={8000} value={resposta} onChange={(e) => setResposta(e.target.value)} data-autofoco />}
      </Campo>
      {erroEnvio ? (
        <Aviso tipo="erro" titulo="Não deu para salvar">
          {erroEnvio}
        </Aviso>
      ) : null}
    </Modal>
  );
}

export function SemResposta({
  itens,
  erro,
  recarregar,
  podeEditar,
  online,
  aoResponder,
}: {
  itens: PerguntaSemResposta[] | undefined;
  erro: ErroApiCliente | null;
  recarregar: () => void;
  podeEditar: boolean;
  online: boolean;
  /** Uma pergunta virou resposta pronta (a lista de fontes muda). */
  aoResponder: (fonte: FonteConhecimento) => void;
}) {
  const toast = useToast();
  const [respondendo, setRespondendo] = useState<PerguntaSemResposta | null>(null);
  const [ignorando, setIgnorando] = useState<string | null>(null);
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());

  async function ignorar(item: PerguntaSemResposta) {
    setIgnorando(item.id);
    try {
      await api.post(`/conhecimento/perguntas-sem-resposta/${item.id}/ignorar`);
      setOcultas((s) => new Set(s).add(item.id));
      toast.sucesso('Pergunta ignorada. Ela não volta para a lista, mesmo se perguntarem de novo.');
      recarregar();
    } catch (err) {
      toast.erro((err as ErroApiCliente).message);
    } finally {
      setIgnorando(null);
    }
  }

  const lista = itens?.filter((i) => !ocultas.has(i.id));
  let corpo: React.ReactNode;
  if (erro && !itens) {
    corpo = (
      <div className="card-body">
        <EstadoErro erro={erro} aoTentar={recarregar} titulo="Não conseguimos carregar as perguntas" />
      </div>
    );
  } else if (!lista) {
    corpo = (
      <div className="card-body">
        <Carregando linhas={4} texto="Carregando perguntas" />
      </div>
    );
  } else if (lista.length === 0) {
    corpo = (
      <div className="card-body">
        <p className="small muted cn-vazio-lista">Nenhuma pergunta sem resposta nos últimos 30 dias. Quando o copiloto não souber algo, a pergunta aparece aqui.</p>
      </div>
    );
  } else {
    corpo = (
      <ul className="cn-perguntas">
        {lista.map((p) => (
          <li key={p.id} className="cn-pergunta">
            <div className="stack-sm grow cn-pergunta-texto">
              <p className="strong small cn-quebra">{p.pergunta}</p>
              <p className="tiny muted">
                {p.causa} · última vez {fmt.haQuanto(p.ultimaEm)}
              </p>
              {podeEditar ? (
                <div className="row cn-pergunta-acoes">
                  <Botao tamanho="sm" disabled={!online} onClick={() => setRespondendo(p)}>
                    Escrever resposta
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="sm"
                    disabled={!online || ignorando === p.id}
                    carregando={ignorando === p.id}
                    onClick={() => void ignorar(p)}
                  >
                    Ignorar
                  </Botao>
                </div>
              ) : null}
            </div>
            <span className="badge num">{p.vezes === 1 ? '1 vez' : `${p.vezes} vezes`}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="card cn-sem-resposta" aria-labelledby="cn-t-sem">
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h4" id="cn-t-sem">
            Perguntas sem boa resposta
          </h2>
          <p className="tiny muted">Últimos 30 dias · o copiloto disse que não sabia ou a pessoa marcou “não ajudou”</p>
        </div>
      </div>
      {corpo}
      {!podeEditar && lista?.length ? (
        <p className="tiny muted cn-rodape-lista">Só quem pode editar a base escreve respostas. Peça a um editor ou Admin.</p>
      ) : null}
      <ResponderPergunta
        item={respondendo}
        aoFechar={() => setRespondendo(null)}
        aoSalvar={(fonte) => {
          if (respondendo) setOcultas((s) => new Set(s).add(respondendo.id));
          setRespondendo(null);
          toast.sucesso('Resposta salva. O copiloto já usa esta resposta.');
          aoResponder(fonte);
          recarregar();
        }}
      />
    </section>
  );
}

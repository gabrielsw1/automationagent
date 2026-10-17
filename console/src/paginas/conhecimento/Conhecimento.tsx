// C7 · Base de conhecimento: fontes (site, arquivos, vídeos, respostas prontas) com status e
// progresso ao vivo, perguntas sem boa resposta e "Testar uma pergunta".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FonteConhecimento, PerguntaSemResposta } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi, useEventosConsole } from '../../api/hooks.ts';
import {
  Botao,
  CabecalhoPagina,
  Carregando,
  Confirmar,
  EstadoErro,
  EstadoVazio,
  Gaveta,
  useOnline,
  usePode,
  useToast,
} from '../../componentes/index.ts';
import { AdicionarFonte, type TipoNovaFonte } from './AdicionarFonte.tsx';
import { CartaoFonte, type AcoesFonte } from './CartaoFonte.tsx';
import { EXTENSOES_ARQUIVO, emUso, problemaDoArquivo } from './comum.tsx';
import { SemResposta } from './SemResposta.tsx';
import { TestarPergunta } from './TestarPergunta.tsx';
import './conhecimento.css';

interface Trecho {
  titulo: string;
  local: string | null;
  url: string | null;
  texto: string;
}

function GavetaTrechos({ fonte, aoFechar }: { fonte: FonteConhecimento | null; aoFechar: () => void }) {
  const { dados, erro, carregando, recarregar } = useApi<Trecho[]>(fonte ? `/conhecimento/fontes/${fonte.id}/trechos` : null);
  const respostas = fonte?.tipo === 'respostas';
  return (
    <Gaveta aberta={!!fonte} titulo={fonte ? fonte.nome : ''} aoFechar={aoFechar} largura={520}>
      {!fonte ? null : erro && !dados ? (
        <EstadoErro erro={erro} aoTentar={() => void recarregar()} titulo="Não conseguimos carregar os trechos" />
      ) : carregando || !dados ? (
        <Carregando linhas={6} texto="Carregando trechos" />
      ) : dados.length === 0 ? (
        <p className="small muted">Ainda não há trechos lidos desta fonte.</p>
      ) : (
        <div className="stack">
          <p className="small muted">
            {respostas
              ? `${dados.length} ${dados.length === 1 ? 'resposta' : 'respostas'} que o copiloto usa como estão escritas.`
              : `${fonte.trechos} trechos que o copiloto pode citar${fonte.trechos > dados.length ? ` (mostrando os ${dados.length} primeiros)` : ''}.`}
          </p>
          <ol className="cn-trechos">
            {dados.map((t, i) => (
              <li key={i} className="card-flat stack-sm cn-trecho">
                <div className="row between wrap" style={{ gap: 'var(--s-2)' }}>
                  <span className="strong small cn-quebra">{t.titulo}</span>
                  {t.local && !respostas ? <span className="badge">{t.local}</span> : null}
                </div>
                <p className="small cn-trecho-texto">{respostas ? t.texto.split('\n').slice(1).join('\n') || t.texto : t.texto}</p>
                {t.url && /^https?:/.test(t.url) ? (
                  <a className="tiny cn-quebra" href={t.url} target="_blank" rel="noreferrer">
                    {t.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Gaveta>
  );
}

export default function Conhecimento() {
  const podeEditar = usePode('editar');
  const online = useOnline();
  const toast = useToast();
  const fontes = useApi<FonteConhecimento[]>('/conhecimento/fontes');
  const perguntas = useApi<PerguntaSemResposta[]>('/conhecimento/perguntas-sem-resposta');

  const [adicionar, setAdicionar] = useState<{ tipo: TipoNovaFonte; pergunta?: string } | null>(null);
  const [vendo, setVendo] = useState<FonteConhecimento | null>(null);
  const [removendo, setRemovendo] = useState<FonteConhecimento | null>(null);
  const [erroRemover, setErroRemover] = useState<string | null>(null);
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set());

  // Atualização ao vivo: o servidor avisa a cada mudança de status e de progresso das fontes.
  const recarregarFontes = fontes.recarregar;
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aoEvento = useCallback(
    (e: { tipo: string }) => {
      if (e.tipo !== 'fonte' || espera.current) return;
      espera.current = setTimeout(() => {
        espera.current = null;
        void recarregarFontes();
      }, 400);
    },
    [recarregarFontes],
  );
  useEventosConsole(aoEvento);
  useEffect(() => () => void (espera.current && clearTimeout(espera.current)), []);

  // Sem eventos ao vivo (proxy que corta SSE), confere de tempos em tempos enquanto algo é lido.
  const indexando = fontes.dados?.some((f) => f.status === 'indexando') ?? false;
  useEffect(() => {
    if (!indexando) return;
    const id = setInterval(() => void recarregarFontes(), 8000);
    return () => clearInterval(id);
  }, [indexando, recarregarFontes]);

  const substituir = (f: FonteConhecimento) => fontes.definir((lista) => lista?.map((x) => (x.id === f.id ? f : x)));
  const incluir = (f: FonteConhecimento) =>
    fontes.definir((lista) => (lista?.some((x) => x.id === f.id) ? lista.map((x) => (x.id === f.id ? f : x)) : [...(lista ?? []), f]));

  async function emAcao(id: string, fn: () => Promise<void>) {
    setOcupadas((s) => new Set(s).add(id));
    try {
      await fn();
    } catch (e) {
      toast.erro((e as ErroApiCliente).message);
    } finally {
      setOcupadas((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  const acoes: AcoesFonte = {
    verTrechos: setVendo,
    sincronizar: (f) =>
      void emAcao(f.id, async () => {
        substituir(await api.post<FonteConhecimento>(`/conhecimento/fontes/${f.id}/sincronizar`));
        toast.sucesso(`Lendo “${f.nome}” de novo. A versão atual continua valendo até a nova ficar pronta.`);
      }),
    pausar: (f) =>
      void emAcao(f.id, async () => {
        substituir(await api.post<FonteConhecimento>(`/conhecimento/fontes/${f.id}/pausar`));
        toast.sucesso('Fonte pausada. O copiloto não usa esta fonte até você retomar.');
      }),
    remover: (f) => {
      setErroRemover(null);
      setRemovendo(f);
    },
    trocarArquivo: (f, arquivo) => {
      const problema = problemaDoArquivo(arquivo, EXTENSOES_ARQUIVO);
      if (problema) {
        toast.erro(problema);
        return;
      }
      void emAcao(f.id, async () => {
        const dados = new FormData();
        dados.append('substituir', f.id);
        dados.append('arquivo', arquivo, arquivo.name);
        substituir(await api.upload<FonteConhecimento>('/conhecimento/fontes/arquivo', dados));
        toast.sucesso(`Lendo a nova versão de “${f.nome}”.`);
      });
    },
    adicionarResposta: () => setAdicionar({ tipo: 'resposta' }),
  };

  async function confirmarRemocao() {
    if (!removendo) return;
    const f = removendo;
    setOcupadas((s) => new Set(s).add(f.id));
    try {
      await api.del(`/conhecimento/fontes/${f.id}`);
      fontes.definir((lista) => lista?.filter((x) => x.id !== f.id));
      setRemovendo(null);
      toast.sucesso(`“${f.nome}” foi removida. O copiloto não usa mais esta fonte.`);
    } catch (e) {
      setErroRemover((e as ErroApiCliente).message);
    } finally {
      setOcupadas((s) => {
        const n = new Set(s);
        n.delete(f.id);
        return n;
      });
    }
  }

  const botaoAdicionar = podeEditar ? (
    <Botao variante="primario" icone="mais" disabled={!online} onClick={() => setAdicionar({ tipo: 'site' })}>
      Adicionar fonte
    </Botao>
  ) : null;

  const cabecalho = (
    <CabecalhoPagina
      titulo="Base de conhecimento"
      subtitulo="O copiloto responde dúvidas usando só estas fontes e cita de onde tirou."
      acoes={botaoAdicionar}
    />
  );

  const lista = fontes.dados;
  let secaoFontes: React.ReactNode;
  if (fontes.erro && !lista) {
    secaoFontes = <EstadoErro erro={fontes.erro} aoTentar={() => void fontes.recarregar()} titulo="Não conseguimos carregar as fontes" />;
  } else if (!lista) {
    secaoFontes = <Carregando forma="tabela" texto="Carregando fontes" />;
  } else if (lista.length === 0) {
    secaoFontes = (
      <EstadoVazio
        emCartao
        icone="conhecimento"
        titulo="Nenhuma fonte ainda"
        texto="Adicione a central de ajuda, manuais em PDF, vídeos de treinamento ou respostas da equipe. O copiloto só responde dúvidas com base no que estiver aqui."
        acao={
          podeEditar ? (
            <Botao variante="primario" icone="mais" disabled={!online} onClick={() => setAdicionar({ tipo: 'site' })}>
              Adicionar a primeira fonte
            </Botao>
          ) : (
            <p className="small muted">Peça a um editor ou Admin para adicionar as fontes.</p>
          )
        }
      />
    );
  } else {
    const usadas = lista.filter(emUso).length;
    secaoFontes = (
      <div className="grid-auto cn-fontes">
        {lista.map((f) => (
          <CartaoFonte key={f.id} fonte={f} podeEditar={podeEditar} online={online} ocupado={ocupadas.has(f.id)} acoes={acoes} />
        ))}
      </div>
    );
    secaoFontes = (
      <>
        <div className="row between wrap">
          <h2 className="h3" id="cn-t-fontes">
            Fontes
          </h2>
          <p className="small muted">
            {lista.length === 1 ? '1 fonte' : `${lista.length} fontes`} · {usadas === 1 ? '1 em uso agora' : `${usadas} em uso agora`}
          </p>
        </div>
        {secaoFontes}
      </>
    );
  }

  return (
    <div className="stack-lg cn-pagina">
      {cabecalho}
      <section className="stack" aria-labelledby={lista?.length ? 'cn-t-fontes' : undefined} aria-label={lista?.length ? undefined : 'Fontes'}>
        {secaoFontes}
      </section>

      <div className="grid-2 cn-colunas">
        <SemResposta
          itens={perguntas.dados}
          erro={perguntas.erro}
          recarregar={() => void perguntas.recarregar()}
          podeEditar={podeEditar}
          online={online}
          aoResponder={(f) => incluir(f)}
        />
        <TestarPergunta
          online={online}
          podeEditar={podeEditar}
          aoSemResposta={() => void perguntas.recarregar()}
          aoCorrigir={(pergunta) => setAdicionar({ tipo: 'resposta', pergunta })}
        />
      </div>

      <AdicionarFonte
        aberto={!!adicionar}
        tipoInicial={adicionar?.tipo}
        perguntaInicial={adicionar?.pergunta}
        aoFechar={() => setAdicionar(null)}
        aoCriar={(f, tipo) => {
          setAdicionar(null);
          incluir(f);
          toast.sucesso(
            tipo === 'resposta'
              ? 'Resposta salva. O copiloto já usa esta resposta.'
              : `“${f.nome}” foi adicionada. A leitura continua em segundo plano e você pode sair desta tela.`,
          );
          if (tipo === 'resposta') void perguntas.recarregar();
        }}
      />

      <GavetaTrechos fonte={vendo} aoFechar={() => setVendo(null)} />

      <Confirmar
        aberto={!!removendo}
        titulo={removendo ? `Remover “${removendo.nome}”?` : ''}
        texto={
          removendo
            ? `O copiloto deixa de usar ${removendo.trechos === 1 ? 'o trecho' : `os ${removendo.trechos} trechos`} desta fonte${
                removendo.tipo === 'arquivo' || removendo.tipo === 'video' ? ' e o arquivo enviado é apagado' : ''
              }. Não dá para desfazer.`
            : ''
        }
        rotuloConfirmar="Remover fonte"
        perigo
        carregando={removendo ? ocupadas.has(removendo.id) : false}
        erro={erroRemover}
        aoConfirmar={() => void confirmarRemocao()}
        aoFechar={() => setRemovendo(null)}
      />
    </div>
  );
}

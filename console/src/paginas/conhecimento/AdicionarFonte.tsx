// "Adicionar fonte": site, arquivo, vídeo (transcrição) ou resposta pronta.
import { useEffect, useState, type FormEvent } from 'react';
import type { FonteConhecimento } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Aviso, Botao, Campo, Icone, Modal, Segmentado, useOnline } from '../../componentes/index.ts';
import {
  EXTENSOES_ARQUIVO,
  EXTENSOES_LEGENDA,
  IconeEnviar,
  LIMITE_ARQUIVO_MB,
  LIMITE_PAGINAS_MAX,
  problemaDoArquivo,
  tamanhoLegivel,
  urlValida,
} from './comum.tsx';

export type TipoNovaFonte = 'site' | 'arquivo' | 'video' | 'resposta';

interface Erros {
  url?: string;
  limite?: string;
  arquivo?: string;
  texto?: string;
  link?: string;
  pergunta?: string;
  resposta?: string;
}

/** Área de escolher arquivo (clique ou arraste). */
function EscolherArquivo({
  arquivo,
  aceitas,
  erro,
  aoEscolher,
  dica,
}: {
  arquivo: File | null;
  aceitas: string[];
  erro?: string;
  aoEscolher: (f: File | null) => void;
  dica: string;
}) {
  const [arrastando, setArrastando] = useState(false);
  return (
    <div className="field">
      <span className="cn-rotulo">Arquivo</span>
      <label
        className={`cn-soltar${arrastando ? ' cn-soltar-ativo' : ''}${erro ? ' cn-soltar-erro' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          aoEscolher(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <input
          type="file"
          className="sr-only"
          accept={aceitas.map((a) => `.${a}`).join(',')}
          onChange={(e) => aoEscolher(e.target.files?.[0] ?? null)}
          aria-invalid={erro ? true : undefined}
        />
        <IconeEnviar />
        {arquivo ? (
          <span className="stack-sm" style={{ gap: 2 }}>
            <span className="strong small cn-quebra">{arquivo.name}</span>
            <span className="tiny muted">{tamanhoLegivel(arquivo.size)} · clique para trocar</span>
          </span>
        ) : (
          <span className="stack-sm" style={{ gap: 2 }}>
            <span className="strong small">Escolha um arquivo ou arraste para cá</span>
            <span className="tiny muted">{dica}</span>
          </span>
        )}
      </label>
      {erro ? (
        <span className="error-text" role="alert">
          <Icone nome="alerta" tamanho="sm" />
          {erro}
        </span>
      ) : null}
    </div>
  );
}

export function AdicionarFonte({
  aberto,
  tipoInicial = 'site',
  perguntaInicial = '',
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  tipoInicial?: TipoNovaFonte;
  perguntaInicial?: string;
  aoFechar: () => void;
  aoCriar: (fonte: FonteConhecimento, tipo: TipoNovaFonte) => void;
}) {
  const online = useOnline();
  const [tipo, setTipo] = useState<TipoNovaFonte>(tipoInicial);
  const [url, setUrl] = useState('');
  const [limite, setLimite] = useState('50');
  const [nome, setNome] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [modoVideo, setModoVideo] = useState<'colar' | 'legenda'>('colar');
  const [texto, setTexto] = useState('');
  const [linkVideo, setLinkVideo] = useState('');
  const [pergunta, setPergunta] = useState(perguntaInicial);
  const [resposta, setResposta] = useState('');
  const [erros, setErros] = useState<Erros>({});
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  // Cada abertura começa limpa, no tipo pedido.
  useEffect(() => {
    if (!aberto) return;
    setTipo(tipoInicial);
    setUrl('');
    setLimite('50');
    setNome('');
    setArquivo(null);
    setModoVideo('colar');
    setTexto('');
    setLinkVideo('');
    setPergunta(perguntaInicial);
    setResposta('');
    setErros({});
    setErroEnvio(null);
  }, [aberto, tipoInicial, perguntaInicial]);

  const trocarTipo = (t: TipoNovaFonte) => {
    setTipo(t);
    setErros({});
    setErroEnvio(null);
    setArquivo(null);
  };

  function validar(): Erros {
    const e: Erros = {};
    if (tipo === 'site') {
      if (!url.trim()) e.url = 'Informe o endereço do site.';
      else if (!urlValida(url)) e.url = 'Use o endereço completo, começando com https:// (ex.: https://ajuda.suaempresa.com.br).';
      const n = Number(limite);
      if (!Number.isInteger(n) || n < 1 || n > LIMITE_PAGINAS_MAX) e.limite = `Use um número de 1 a ${LIMITE_PAGINAS_MAX}.`;
    } else if (tipo === 'arquivo') {
      if (!arquivo) e.arquivo = 'Escolha um arquivo PDF, DOCX, TXT ou MD.';
      else e.arquivo = problemaDoArquivo(arquivo, EXTENSOES_ARQUIVO) ?? undefined;
    } else if (tipo === 'video') {
      if (modoVideo === 'legenda') {
        if (!arquivo) e.arquivo = 'Escolha o arquivo de legenda (.vtt ou .srt).';
        else e.arquivo = problemaDoArquivo(arquivo, EXTENSOES_LEGENDA) ?? undefined;
      } else if (texto.trim().length < 20) {
        e.texto = 'Cole a transcrição do vídeo (com os tempos, se tiver, como “02:14 Agora clique em…”).';
      }
      if (linkVideo.trim() && !urlValida(linkVideo)) e.link = 'Use o link completo do vídeo, começando com https://.';
    } else {
      if (pergunta.trim().length < 3) e.pergunta = 'Escreva a pergunta como as pessoas perguntam.';
      if (resposta.trim().length < 3) e.resposta = 'Escreva a resposta.';
    }
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Erros;
  }

  async function enviar(ev?: FormEvent) {
    ev?.preventDefault();
    const e = validar();
    setErros(e);
    setErroEnvio(null);
    if (Object.keys(e).length) return;
    setEnviando(true);
    try {
      let fonte: FonteConhecimento;
      if (tipo === 'site') {
        fonte = await api.post<FonteConhecimento>('/conhecimento/fontes/site', {
          url: url.trim(),
          limitePaginas: Number(limite),
          ...(nome.trim() ? { nome: nome.trim() } : {}),
        });
      } else if (tipo === 'arquivo') {
        const dados = new FormData();
        dados.append('arquivo', arquivo!, arquivo!.name);
        fonte = await api.upload<FonteConhecimento>('/conhecimento/fontes/arquivo', dados);
      } else if (tipo === 'video') {
        if (modoVideo === 'legenda') {
          const dados = new FormData();
          if (nome.trim()) dados.append('nome', nome.trim());
          if (linkVideo.trim()) dados.append('url', linkVideo.trim());
          dados.append('arquivo', arquivo!, arquivo!.name);
          fonte = await api.upload<FonteConhecimento>('/conhecimento/fontes/video', dados);
        } else {
          fonte = await api.post<FonteConhecimento>('/conhecimento/fontes/video', {
            texto,
            ...(nome.trim() ? { nome: nome.trim() } : {}),
            ...(linkVideo.trim() ? { url: linkVideo.trim() } : {}),
          });
        }
      } else {
        fonte = await api.post<FonteConhecimento>('/conhecimento/fontes/respostas', {
          pergunta: pergunta.trim(),
          resposta: resposta.trim(),
        });
      }
      aoCriar(fonte, tipo);
    } catch (err) {
      setErroEnvio((err as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  }

  const rotuloEnviar =
    tipo === 'site' ? 'Ler o site' : tipo === 'arquivo' ? 'Enviar arquivo' : tipo === 'video' ? 'Adicionar vídeo' : 'Salvar resposta';

  return (
    <Modal
      aberto={aberto}
      titulo="Adicionar fonte"
      descricao="O copiloto passa a responder com base nesta fonte e cita de onde tirou cada informação."
      aoFechar={aoFechar}
      travado={enviando}
      largura={600}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={enviando} disabled={!online} onClick={() => void enviar()}>
            {rotuloEnviar}
          </Botao>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => void enviar(e)} noValidate>
        <Segmentado<TipoNovaFonte>
          rotulo="Tipo de fonte"
          valor={tipo}
          aoTrocar={trocarTipo}
          desativado={enviando}
          opcoes={[
            { valor: 'site', rotulo: 'Site' },
            { valor: 'arquivo', rotulo: 'Arquivo' },
            { valor: 'video', rotulo: 'Vídeo' },
            { valor: 'resposta', rotulo: 'Resposta pronta' },
          ]}
        />

        {tipo === 'site' ? (
          <>
            <Campo
              rotulo="Endereço do site"
              obrigatorio
              erro={erros.url}
              ajuda="O copiloto lê esta página e as páginas abaixo dela no mesmo site, respeitando o robots.txt. Páginas que pedem login não são lidas."
            >
              {(p) => (
                <input
                  {...p}
                  type="url"
                  inputMode="url"
                  placeholder="https://ajuda.suaempresa.com.br"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  data-autofoco
                />
              )}
            </Campo>
            <div className="cn-campos-lado">
              <Campo rotulo="Até quantas páginas" erro={erros.limite} ajuda={`De 1 a ${LIMITE_PAGINAS_MAX}.`}>
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    min={1}
                    max={LIMITE_PAGINAS_MAX}
                    value={limite}
                    onChange={(e) => setLimite(e.target.value)}
                  />
                )}
              </Campo>
              <Campo rotulo="Nome (opcional)" ajuda="Sem nome, usamos o título da primeira página.">
                {(p) => <input {...p} type="text" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />}
              </Campo>
            </div>
          </>
        ) : null}

        {tipo === 'arquivo' ? (
          <EscolherArquivo
            arquivo={arquivo}
            aceitas={EXTENSOES_ARQUIVO}
            erro={erros.arquivo}
            aoEscolher={(f) => {
              setArquivo(f);
              setErros({});
            }}
            dica={`PDF, DOCX, TXT ou MD, até ${LIMITE_ARQUIVO_MB} MB. PDF escaneado (só imagem) não é lido.`}
          />
        ) : null}

        {tipo === 'video' ? (
          <>
            <Campo rotulo="Nome do vídeo" ajuda="Aparece nas citações, por exemplo “Treinamento: agendamento de visitas”.">
              {(p) => <input {...p} type="text" maxLength={160} value={nome} onChange={(e) => setNome(e.target.value)} data-autofoco />}
            </Campo>
            <Campo rotulo="Link do vídeo (opcional)" erro={erros.link} ajuda="Com o link, as citações abrem o vídeo no minuto certo.">
              {(p) => (
                <input
                  {...p}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={linkVideo}
                  onChange={(e) => setLinkVideo(e.target.value)}
                />
              )}
            </Campo>
            <Segmentado<'colar' | 'legenda'>
              rotulo="Como enviar a transcrição"
              valor={modoVideo}
              aoTrocar={(m) => {
                setModoVideo(m);
                setErros({});
                setArquivo(null);
              }}
              desativado={enviando}
              opcoes={[
                { valor: 'colar', rotulo: 'Colar transcrição' },
                { valor: 'legenda', rotulo: 'Enviar legenda (.vtt ou .srt)' },
              ]}
            />
            {modoVideo === 'colar' ? (
              <Campo
                rotulo="Transcrição"
                classe="textarea"
                obrigatorio
                erro={erros.texto}
                ajuda="Com os tempos no começo da linha (“02:14 Agora clique em Nova visita”), as citações mostram o minuto."
              >
                {(p) => <textarea {...p} rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />}
              </Campo>
            ) : (
              <EscolherArquivo
                arquivo={arquivo}
                aceitas={EXTENSOES_LEGENDA}
                erro={erros.arquivo}
                aoEscolher={(f) => {
                  setArquivo(f);
                  setErros({});
                }}
                dica="Legenda .vtt ou .srt (o YouTube e o Vimeo deixam baixar)."
              />
            )}
          </>
        ) : null}

        {tipo === 'resposta' ? (
          <>
            <Campo rotulo="Pergunta" obrigatorio erro={erros.pergunta} ajuda="Do jeito que as pessoas perguntam.">
              {(p) => (
                <input
                  {...p}
                  type="text"
                  maxLength={500}
                  placeholder="Como cancelo a assinatura de um cliente?"
                  value={pergunta}
                  onChange={(e) => setPergunta(e.target.value)}
                  data-autofoco
                />
              )}
            </Campo>
            <Campo
              rotulo="Resposta"
              classe="textarea"
              obrigatorio
              erro={erros.resposta}
              ajuda="Curta e direta. O copiloto usa este texto e cita “Respostas prontas da equipe”."
            >
              {(p) => <textarea {...p} rows={6} maxLength={8000} value={resposta} onChange={(e) => setResposta(e.target.value)} />}
            </Campo>
          </>
        ) : null}

        {erroEnvio ? (
          <Aviso tipo="erro" titulo="Não deu para adicionar a fonte">
            {erroEnvio}
          </Aviso>
        ) : null}
        {!online ? <Aviso tipo="aviso">Você está sem internet. Conecte-se para enviar.</Aviso> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

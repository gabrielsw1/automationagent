// Caixa de mensagem: Enter envia, Shift+Enter quebra linha, anexos (POST /anexos) e ditado por voz
// quando o navegador oferece reconhecimento de fala.
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { AnexoEnviado } from '@copiloto/shared';
import { Icone } from './icones.tsx';
import { gerarId, mensagemDeErro } from './util.ts';

export interface ControleComposer {
  preencher(texto: string): void;
  focar(): void;
}

interface AnexoLocal {
  idLocal: string;
  nome: string;
  situacao: 'enviando' | 'pronto' | 'erro';
  anexo?: AnexoEnviado;
  erro?: string;
}

const LIMITE_ANEXOS = 5;
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

interface ReconhecimentoFala {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function construtorFala(): (new () => ReconhecimentoFala) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => ReconhecimentoFala) | undefined) ?? null;
}

export interface PropsComposer {
  rotulo: string;
  placeholder: string;
  linhas?: number;
  aoEnviar?: (texto: string, anexos: AnexoEnviado[]) => void;
  aoAnexar?: (arquivo: File) => Promise<AnexoEnviado>;
  voz?: boolean;
  desabilitado?: boolean;
  ref?: Ref<ControleComposer>;
}

export function Composer({ rotulo, placeholder, linhas = 1, aoEnviar, aoAnexar, voz = true, desabilitado, ref }: PropsComposer) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<AnexoLocal[]>([]);
  const [ouvindo, setOuvindo] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const fala = useRef<ReconhecimentoFala | null>(null);
  const Fala = voz ? construtorFala() : null;

  useImperativeHandle(ref, () => ({
    preencher(t: string) {
      setTexto(t);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(t.length, t.length);
      });
    },
    focar() {
      area.current?.focus();
    },
  }));

  // Cresce com o texto (até o max-height do CSS).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [texto]);

  useEffect(() => () => fala.current?.stop(), []);

  const subindo = anexos.some((a) => a.situacao === 'enviando');
  const prontos = anexos.filter((a) => a.situacao === 'pronto' && a.anexo).map((a) => a.anexo!);
  const podeEnviar = !desabilitado && !subindo && (texto.trim().length > 0 || prontos.length > 0);

  function enviar() {
    if (!podeEnviar) return;
    aoEnviar?.(texto, prontos);
    setTexto('');
    setAnexos([]);
    fala.current?.stop();
  }

  async function escolherArquivos(lista: FileList | null) {
    if (!lista || !aoAnexar) return;
    const livres = Math.max(0, LIMITE_ANEXOS - anexos.length);
    for (const f of Array.from(lista).slice(0, livres)) {
      const idLocal = gerarId();
      if (f.size > TAMANHO_MAXIMO) {
        setAnexos((a) => [...a, { idLocal, nome: f.name, situacao: 'erro', erro: 'Arquivo maior que 25 MB.' }]);
        continue;
      }
      setAnexos((a) => [...a, { idLocal, nome: f.name, situacao: 'enviando' }]);
      try {
        const anexo = await aoAnexar(f);
        setAnexos((a) => a.map((x) => (x.idLocal === idLocal ? { ...x, situacao: 'pronto', anexo } : x)));
      } catch (e) {
        setAnexos((a) =>
          a.map((x) =>
            x.idLocal === idLocal ? { ...x, situacao: 'erro', erro: mensagemDeErro(e, 'Não consegui enviar o arquivo.') } : x,
          ),
        );
      }
    }
    if (arquivo.current) arquivo.current.value = '';
  }

  function alternarVoz() {
    if (!Fala) return;
    if (ouvindo) {
      fala.current?.stop();
      return;
    }
    const r = new Fala();
    r.lang = 'pt-BR';
    r.interimResults = false;
    r.continuous = false;
    const base = texto;
    r.onresult = (ev) => {
      const partes: string[] = [];
      for (let i = 0; i < ev.results.length; i++) partes.push(ev.results[i][0]?.transcript ?? '');
      const dito = partes.join(' ').trim();
      if (dito) setTexto(base ? `${base.trimEnd()} ${dito}` : dito);
    };
    r.onend = () => setOuvindo(false);
    r.onerror = () => setOuvindo(false);
    fala.current = r;
    try {
      r.start();
      setOuvindo(true);
    } catch {
      setOuvindo(false);
    }
  }

  return (
    <div className="stack-sm cp-gap-6">
      {anexos.length > 0 && (
        <ul className="cp-anexos" aria-label="Arquivos anexados">
          {anexos.map((a) => (
            <li key={a.idLocal} className={`cp-anexo${a.situacao === 'erro' ? ' cp-anexo-erro' : ''}`}>
              {a.situacao === 'enviando' ? (
                <span className="spinner cp-spinner-sm" aria-hidden="true" />
              ) : (
                <Icone nome={a.situacao === 'erro' ? 'aviso' : 'clipe'} tamanho="sm" />
              )}
              <span className="cp-anexo-nome">{a.nome}</span>
              {a.situacao === 'enviando' && <span className="sr-only">enviando</span>}
              {a.erro && <span className="cp-anexo-msg">{a.erro}</span>}
              <button
                type="button"
                className="cp-anexo-tirar"
                aria-label={`Remover ${a.nome}`}
                onClick={() => setAnexos((l) => l.filter((x) => x.idLocal !== a.idLocal))}
              >
                <Icone nome="fechar" tamanho="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer">
        <label className="sr-only" htmlFor={id}>
          {rotulo}
        </label>
        <textarea
          id={id}
          ref={area}
          rows={linhas}
          value={texto}
          placeholder={placeholder}
          disabled={desabilitado}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              enviar();
            }
          }}
        />
        {aoAnexar && (
          <>
            <input
              ref={arquivo}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void escolherArquivos(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label="Anexar arquivo"
              disabled={desabilitado || anexos.length >= LIMITE_ANEXOS}
              onClick={() => arquivo.current?.click()}
            >
              <Icone nome="clipe" />
            </button>
          </>
        )}
        {Fala && (
          <button
            type="button"
            className={`btn btn-ghost btn-icon btn-sm${ouvindo ? ' cp-ouvindo' : ''}`}
            aria-label={ouvindo ? 'Parar de ouvir' : 'Falar por voz'}
            aria-pressed={ouvindo}
            disabled={desabilitado}
            onClick={alternarVoz}
          >
            <Icone nome="microfone" />
          </button>
        )}
        <button type="button" className="btn btn-primary btn-icon" aria-label="Enviar" disabled={!podeEnviar} onClick={enviar}>
          <Icone nome="enviar" />
        </button>
      </div>
    </div>
  );
}

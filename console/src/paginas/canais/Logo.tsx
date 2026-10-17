// Campo "Logo" (S3 "Sua marca" e Canais e widget › Aparência): arrastar ou escolher um PNG ou SVG
// quadrado de até 1 MB. O arquivo vai na hora para o servidor (POST /canais/logo), entra no
// rascunho do widget e aparece na pré-visualização; vale para os usuários depois de publicar.
import { useId, useRef, useState, type DragEvent } from 'react';
import { fmt, type Canais, type LogoWidget } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Icone } from '../../componentes/icones.tsx';
import './logo.css';

export const LIMITE_LOGO = 1024 * 1024;
const TIPOS = ['image/png', 'image/svg+xml'];

/** Conferência rápida antes de enviar (o servidor confere de novo, pelo conteúdo). */
export function problemaNoArquivo(f: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (!TIPOS.includes(f.type) && !['png', 'svg'].includes(ext)) return 'O logo precisa ser um arquivo PNG ou SVG.';
  if (f.size > LIMITE_LOGO) return `O logo tem ${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB. O limite é 1 MB.`;
  if (f.size === 0) return 'O arquivo está vazio.';
  return null;
}

/** "12 KB" (arredondado, no mínimo 1 KB). */
export function tamanhoLogo(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function CampoLogo({
  logo,
  travado = false,
  iniciais,
  aoMudar,
}: {
  logo: LogoWidget | null | undefined;
  travado?: boolean;
  /** Iniciais mostradas no lugar da imagem enquanto ela carrega ou se não abrir. */
  iniciais: string;
  /** Resposta do servidor depois de enviar ou remover. */
  aoMudar: (c: Canais) => void;
}) {
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<'enviar' | 'remover' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [imagemFalhou, setImagemFalhou] = useState<string | null>(null);

  const enviar = async (f: File | undefined) => {
    if (!f || travado || enviando) return;
    const problema = problemaNoArquivo(f);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando('enviar');
    try {
      const dados = new FormData();
      dados.append('arquivo', f, f.name);
      aoMudar(await api.upload<Canais>('/canais/logo', dados));
    } catch (e) {
      const ex = e as ErroApiCliente;
      setErro(ex.offline ? 'Sem conexão. Confira a internet e envie o logo de novo.' : ex.message);
    } finally {
      setEnviando(null);
      if (entrada.current) entrada.current.value = '';
    }
  };

  const remover = async () => {
    if (!logo || enviando) return;
    setErro(null);
    setEnviando('remover');
    try {
      aoMudar(await api.del<Canais>('/canais/logo'));
    } catch (e) {
      setErro((e as ErroApiCliente).message);
    } finally {
      setEnviando(null);
    }
  };

  const aoSoltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    void enviar(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="field">
      <span className="label" id={`${id}-rotulo`}>
        Logo
      </span>
      {!travado ? (
        <div
          className={`cl-zona${arrastando ? ' cl-zona-ativa' : ''}${erro ? ' cl-zona-erro' : ''}`}
          role="group"
          aria-labelledby={`${id}-rotulo`}
          aria-describedby={`${id}-ajuda`}
          aria-busy={enviando === 'enviar'}
          onDragOver={(e) => {
            e.preventDefault();
            if (!arrastando) setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={aoSoltar}
        >
          {enviando === 'enviar' ? <span className="spinner" aria-hidden="true" /> : <Icone nome="enviarArquivo" tamanho="lg" className="cl-zona-icone" />}
          <span className="small">
            {enviando === 'enviar' ? (
              'Enviando o logo…'
            ) : (
              <>
                Arraste o logo para cá ou{' '}
                <label htmlFor={`${id}-arquivo`} className="strong text-brand cl-escolher">
                  escolha um arquivo
                </label>
              </>
            )}
          </span>
          <input
            ref={entrada}
            id={`${id}-arquivo`}
            className="sr-only"
            type="file"
            accept="image/png,image/svg+xml"
            disabled={!!enviando}
            onChange={(e) => void enviar(e.target.files?.[0])}
          />
          <span id={`${id}-ajuda`} className="tiny muted">
            PNG ou SVG quadrado, até 1 MB. Aparece no topo e ao lado das respostas.
          </span>
        </div>
      ) : !logo ? (
        <span className="small muted">Sem logo: o assistente usa o ícone padrão.</span>
      ) : null}
      {erro ? (
        <span className="error-text" role="alert">
          <Icone nome="alerta" tamanho="sm" />
          {erro}
        </span>
      ) : null}
      {logo ? (
        <div className="row between cl-arquivo">
          <span className="row cl-arquivo-nome">
            <span className="avatar cl-miniatura" aria-hidden="true">
              {logo.url && imagemFalhou !== logo.url ? <img src={logo.url} alt="" onError={() => setImagemFalhou(logo.url)} /> : iniciais}
            </span>
            <span className="stack-sm cl-min0" style={{ gap: 0 }}>
              <span className="small strong cl-truncar">{logo.nome}</span>
              <span className="tiny muted">
                {tamanhoLogo(logo.tamanho)} · enviado {fmt.haQuanto(logo.enviadoEm)}
              </span>
            </span>
          </span>
          {!travado ? (
            <button
              className={`btn btn-ghost btn-sm${enviando === 'remover' ? ' is-loading' : ''}`}
              type="button"
              aria-label={`Remover ${logo.nome}`}
              aria-busy={enviando === 'remover'}
              disabled={!!enviando}
              onClick={() => void remover()}
            >
              Remover
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

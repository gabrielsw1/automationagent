// Peças comuns da tela Conhecimento (C7): rótulos, ícone do tipo de fonte e regras de envio
// (as mesmas do servidor, para avisar antes de mandar).
import type { FonteConhecimento } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { Icone } from '../../componentes/index.ts';

export const LIMITE_ARQUIVO_MB = 20;
export const LIMITE_PAGINAS_MAX = 500;
export const EXTENSOES_ARQUIVO = ['pdf', 'docx', 'txt', 'md'];
export const EXTENSOES_LEGENDA = ['vtt', 'srt', 'txt'];

export const ROTULO_TIPO: Record<FonteConhecimento['tipo'], string> = {
  site: 'Site',
  arquivo: 'Arquivo',
  video: 'Vídeo',
  respostas: 'Respostas prontas',
};

export function extensao(nome: string): string {
  const i = nome.lastIndexOf('.');
  return i >= 0 ? nome.slice(i + 1).toLowerCase() : '';
}

/** Mensagem de erro para um arquivo escolhido, ou null se ele pode ser enviado. */
export function problemaDoArquivo(arquivo: File, aceitas: string[]): string | null {
  const ext = extensao(arquivo.name);
  if (!aceitas.includes(ext)) {
    const lista = aceitas.map((a) => a.toUpperCase()).join(', ').replace(/, ([^,]*)$/, ' ou $1');
    return `Arquivos .${ext || '?'} não são aceitos aqui. Envie ${lista}.`;
  }
  if (arquivo.size === 0) return 'O arquivo está vazio. Confira se escolheu o arquivo certo.';
  if (arquivo.size > LIMITE_ARQUIVO_MB * 1024 * 1024) {
    return `O arquivo passa de ${LIMITE_ARQUIVO_MB} MB. Divida o documento em partes menores e envie cada uma como uma fonte.`;
  }
  return null;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** "1,8 s" */
export function segundos(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')} s`;
}

/** URL aceita para um site: http(s) com domínio. */
export function urlValida(texto: string): boolean {
  try {
    const u = new URL(texto.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** A fonte está sendo usada nas respostas agora (pausadas e com erro sem versão anterior não contam). */
export function emUso(f: FonteConhecimento): boolean {
  return f.status !== 'pausado' && f.trechos > 0;
}

export function quandoEnviado(f: FonteConhecimento): string {
  const dia = fmt.quando(f.criadoEm);
  const quando = dia.startsWith('Hoje') || dia.startsWith('Ontem') ? dia.toLowerCase() : `em ${dia}`;
  return f.enviadoPor ? `Enviado por ${f.enviadoPor} ${quando}` : `Adicionado ${quando}`;
}

/** Ícone de enviar arquivo (seta para cima numa bandeja), no mesmo traço dos ícones do console. */
export function IconeEnviar({ pequeno }: { pequeno?: boolean }) {
  return (
    <svg className={`i${pequeno ? ' i-sm' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </svg>
  );
}

/** Ícone do tipo de fonte (quadrado colorido do design). */
export function IconeTipo({ tipo }: { tipo: FonteConhecimento['tipo'] }) {
  return (
    <span className={`cn-icone-tipo cn-icone-${tipo}`} aria-hidden="true">
      {tipo === 'site' ? (
        <Icone nome="externo" />
      ) : tipo === 'video' ? (
        <Icone nome="play" />
      ) : tipo === 'respostas' ? (
        <Icone nome="chat" />
      ) : (
        <svg className="i" viewBox="0 0 24 24">
          <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <path d="M14 3v6h6M8 13h8M8 17h5" />
        </svg>
      )}
    </span>
  );
}

/** Texto da resposta com os marcadores [n] virando links para a lista de fontes citadas. */
export function TextoComCitacoes({ texto, prefixo }: { texto: string; prefixo: string }) {
  const paragrafos = texto.split(/\n+/).filter((p) => p.trim());
  return (
    <>
      {paragrafos.map((p, i) => (
        <p key={i}>
          {p.split(/(\[\d+\])/g).map((parte, j) => {
            const m = /^\[(\d+)\]$/.exec(parte);
            if (!m) return <span key={j}>{parte}</span>;
            return (
              <a key={j} href={`#${prefixo}-${m[1]}`} className="cn-marcador" aria-label={`Fonte ${m[1]}`}>
                <sup className="strong">[{m[1]}]</sup>
              </a>
            );
          })}
        </p>
      ))}
    </>
  );
}

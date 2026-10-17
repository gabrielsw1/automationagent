// Linhas de conhecimento_fontes ↔ FonteConhecimento (o que o console mostra no cartão da fonte).
import type { FonteConhecimento } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import { json, type Banco } from '../db/banco.ts';

export type TipoFonte = FonteConhecimento['tipo'];
export type StatusFonte = FonteConhecimento['status'];

export interface LinhaFonte {
  id: string;
  tipo: TipoFonte;
  nome: string;
  origem: string;
  status: StatusFonte;
  erro: string | null;
  como_resolver: string | null;
  meta: string;
  progresso_feitos: number | null;
  progresso_total: number | null;
  arquivo: string | null;
  enviado_por: string | null;
  criado_em: string;
  sincronizado_em: string | null;
}

export interface RespostaPronta {
  id: string;
  pergunta: string;
  resposta: string;
  autor: string | null;
  em: string;
}

export interface MetaFonte {
  /** Site: máximo de páginas por sincronização. */
  limitePaginas?: number;
  /** Site: páginas lidas; PDF: páginas do arquivo. */
  paginas?: number;
  /** Site: páginas puladas (erro, robots.txt, sem texto). */
  ignoradas?: number;
  /** Arquivo: tamanho em bytes e formato. */
  tamanho?: number;
  formato?: 'pdf' | 'docx' | 'md' | 'txt' | 'vtt' | 'srt' | 'texto';
  /** Nome original do arquivo enviado. */
  nomeArquivo?: string;
  /** Vídeo: link para assistir e duração (segundos). */
  url?: string;
  duracao?: number | null;
  /** Respostas prontas (fonte do tipo "respostas"). */
  itens?: RespostaPronta[];
  /** Site: o nome foi gerado do endereço e pode trocar pelo título da página inicial. */
  nomeAutomatico?: boolean;
  /** Fonte de demonstração (seed): não é retomada ao iniciar o servidor. */
  exemplo?: boolean;
  /** A última sincronização falhou, mas os trechos da versão anterior continuam valendo. */
  usaVersaoAnterior?: boolean;
}

export function metaDe(l: Pick<LinhaFonte, 'meta'>): MetaFonte {
  return json<MetaFonte>(l.meta, {});
}

export function contarTrechos(banco: Banco): Map<string, number> {
  const linhas = banco.todos<{ fonte_id: string; n: number }>(
    'SELECT fonte_id, COUNT(*) AS n FROM conhecimento_trechos GROUP BY fonte_id',
  );
  return new Map(linhas.map((l) => [l.fonte_id, l.n]));
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function plural(n: number, um: string, varios: string): string {
  return `${fmt.numero(n)} ${n === 1 ? um : varios}`;
}

/** Linha curta embaixo do nome: "86 páginas · 4,2 MB", "12 páginas lidas", "8 respostas". */
export function detalheDaFonte(l: LinhaFonte, trechos: number): string {
  const m = metaDe(l);
  const partes: string[] = [];
  switch (l.tipo) {
    case 'site':
      if (m.paginas) partes.push(plural(m.paginas, 'página lida', 'páginas lidas'));
      if (m.ignoradas) partes.push(plural(m.ignoradas, 'ignorada', 'ignoradas'));
      if (!partes.length) partes.push(`até ${plural(m.limitePaginas ?? 50, 'página', 'páginas')}`);
      break;
    case 'arquivo':
      if (m.formato === 'pdf' && m.paginas) partes.push(plural(m.paginas, 'página', 'páginas'));
      else if (m.formato) partes.push(m.formato.toUpperCase());
      if (m.tamanho) partes.push(tamanhoLegivel(m.tamanho));
      break;
    case 'video':
      partes.push(m.formato === 'texto' ? 'Transcrição colada' : 'Transcrição');
      if (m.duracao) partes.push(fmt.duracao(m.duracao * 1000).replace(/ \d+ s$/, ''));
      break;
    case 'respostas': {
      const n = m.itens?.length ?? trechos;
      partes.push(plural(n, 'resposta', 'respostas'));
      break;
    }
  }
  if (!partes.length || (l.tipo !== 'respostas' && trechos > 0)) partes.push(plural(trechos, 'trecho', 'trechos'));
  return partes.join(' · ');
}

export function paraFonte(l: LinhaFonte, trechos: number): FonteConhecimento {
  const comProgresso = (l.status === 'indexando' || l.status === 'pausado') && l.progresso_total != null && l.progresso_total > 0;
  return {
    id: l.id,
    tipo: l.tipo,
    nome: l.nome,
    origem: l.origem,
    status: l.status,
    detalhe: detalheDaFonte(l, trechos),
    erro: l.erro,
    comoResolver: l.como_resolver,
    progresso: comProgresso ? { feitos: Math.min(l.progresso_feitos ?? 0, l.progresso_total!), total: l.progresso_total! } : null,
    trechos,
    enviadoPor: l.enviado_por,
    criadoEm: l.criado_em,
    sincronizadoEm: l.sincronizado_em,
  };
}

// Prints das execuções e dos testes de fluxo: arquivo em DATA_DIR/prints/<id>.png e uma linha
// na tabela `prints`, com a data em que deve ser apagado (retenção da aba Segurança).
import fs from 'node:fs';
import path from 'node:path';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import { novoId } from '../util/ids.ts';
import type { Destaque } from './tipos.ts';

export interface LinhaPrint {
  id: string;
  execucaoId: string | null;
  fluxoId: string | null;
  arquivo: string;
  legenda: string | null;
  destaque: Destaque | null;
  mascarado: boolean;
  criadoEm: string;
  apagarEm: string | null;
}

/** Retenção configurada em Segurança (padrão 90 dias), lida direto da tabela config. */
export function retencaoPrintsDias(banco: Banco): number {
  const linha = banco.um<{ valor: string }>("SELECT valor FROM config WHERE chave = 'seguranca'");
  const s = json<{ retencaoPrintsDias?: number }>(linha?.valor, {});
  return typeof s.retencaoPrintsDias === 'number' && s.retencaoPrintsDias > 0 ? s.retencaoPrintsDias : 90;
}

export function caminhoPrint(dirDados: string, arquivo: string): string {
  return path.isAbsolute(arquivo) ? arquivo : path.join(dirDados, arquivo);
}

export function salvarPrint(
  banco: Banco,
  dirDados: string,
  imagem: Buffer,
  info: { execucaoId?: string | null; fluxoId?: string | null; legenda?: string; destaque?: Destaque | null; mascarado: boolean },
): string {
  const id = novoId('prt');
  const relativo = path.join('prints', `${id}.png`);
  const destino = path.join(dirDados, relativo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, imagem);
  const agora = new Date();
  const apagarEm = new Date(agora.getTime() + retencaoPrintsDias(banco) * 86_400_000);
  banco.inserir('prints', {
    id,
    execucao_id: info.execucaoId ?? null,
    fluxo_id: info.fluxoId ?? null,
    arquivo: relativo,
    legenda: info.legenda ?? null,
    destaque: info.destaque ?? null,
    mascarado: info.mascarado,
    criado_em: agora.toISOString(),
    apagar_em: apagarEm.toISOString(),
  });
  return id;
}

export function obterPrint(banco: Banco, id: string): LinhaPrint | null {
  const l = banco.um<Record<string, unknown>>('SELECT * FROM prints WHERE id = ?', id);
  return l ? printDe(l) : null;
}

/** Apaga arquivo e linha dos prints vencidos. Devolve quantos apagou. */
export function apagarPrintsVencidos(banco: Banco, dirDados: string, agora = agoraIso()): number {
  const vencidos = banco.todos<{ id: string; arquivo: string }>(
    'SELECT id, arquivo FROM prints WHERE apagar_em IS NOT NULL AND apagar_em < ?',
    agora,
  );
  for (const p of vencidos) apagarArquivo(caminhoPrint(dirDados, p.arquivo));
  if (vencidos.length) banco.executar('DELETE FROM prints WHERE apagar_em IS NOT NULL AND apagar_em < ?', agora);
  return vencidos.length;
}

/** Apaga um print (arquivo e linha). */
export function apagarPrint(banco: Banco, dirDados: string, id: string) {
  const p = banco.um<{ arquivo: string }>('SELECT arquivo FROM prints WHERE id = ?', id);
  if (!p) return;
  apagarArquivo(caminhoPrint(dirDados, p.arquivo));
  banco.executar('DELETE FROM prints WHERE id = ?', id);
}

/** Apaga os prints de um fluxo (ao excluir o fluxo). */
export function apagarPrintsDoFluxo(banco: Banco, dirDados: string, fluxoId: string) {
  const lista = banco.todos<{ arquivo: string }>('SELECT arquivo FROM prints WHERE fluxo_id = ?', fluxoId);
  for (const p of lista) apagarArquivo(caminhoPrint(dirDados, p.arquivo));
  banco.executar('DELETE FROM prints WHERE fluxo_id = ?', fluxoId);
}

function apagarArquivo(caminho: string) {
  try {
    fs.rmSync(caminho, { force: true });
  } catch {
    /* já não existe */
  }
}

function printDe(l: Record<string, unknown>): LinhaPrint {
  return {
    id: String(l.id),
    execucaoId: (l.execucao_id as string | null) ?? null,
    fluxoId: (l.fluxo_id as string | null) ?? null,
    arquivo: String(l.arquivo),
    legenda: (l.legenda as string | null) ?? null,
    destaque: json<Destaque | null>(l.destaque, null),
    mascarado: Boolean(l.mascarado),
    criadoEm: String(l.criado_em),
    apagarEm: (l.apagar_em as string | null) ?? null,
  };
}

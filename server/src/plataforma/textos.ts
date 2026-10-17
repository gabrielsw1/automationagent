// Textos jurídicos do site: Termos de uso, Privacidade e Contrato de tratamento de dados (LGPD).
// Os aprovados pelo advogado da Starta ficam na pasta de TEXTOS_LEGAIS_DIR, um <documento>.md cada;
// sem a pasta, ou sem o arquivo de um documento, vale a minuta que vem com o produto em docs/legal
// (o site mostra a faixa "Minuta em revisão jurídica"). A versão sai do cabeçalho do arquivo
// (`---`, `versao: 2026-10-17`, `---`) ou, sem ele, de um hash curto do texto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TITULO_DOCUMENTO_LEGAL, type DocumentoLegal, type TextoLegal } from '@copiloto/shared';
import { RAIZ_REPO, type Config } from '../config.ts';

/** Minutas que vão com o código (e com a imagem do Docker, que copia o repositório inteiro). */
export const PASTA_MINUTAS = path.join(RAIZ_REPO, 'docs', 'legal');

/** Cabeçalho `---` ... `---` no começo do arquivo: só `versao` importa; o resto é nota para quem edita. */
function separarCabecalho(conteudo: string): { versao: string | null; corpo: string } {
  const m = conteudo.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { versao: null, corpo: conteudo.trim() };
  const versao = m[1].match(/^versao:\s*(.+)$/m)?.[1].trim() || null;
  return { versao, corpo: conteudo.slice(m[0].length).trim() };
}

export function lerTextoLegal(config: Config, documento: DocumentoLegal): TextoLegal | undefined {
  const aprovado = config.textosLegaisDir ? path.join(config.textosLegaisDir, `${documento}.md`) : null;
  const fonte = aprovado && fs.existsSync(aprovado) ? 'aprovado' : 'minuta';
  const arquivo = fonte === 'aprovado' ? aprovado! : path.join(PASTA_MINUTAS, `${documento}.md`);
  let conteudo: string;
  try {
    conteudo = fs.readFileSync(arquivo, 'utf8').replace(/\r\n?/g, '\n');
  } catch {
    return undefined;
  }
  const { versao, corpo } = separarCabecalho(conteudo);
  return {
    documento,
    titulo: TITULO_DOCUMENTO_LEGAL[documento],
    versao: versao ?? crypto.createHash('sha256').update(conteudo).digest('hex').slice(0, 12),
    fonte,
    markdown: corpo,
  };
}

/**
 * Versão do que se aceita no cadastro: Termos de uso e contrato de tratamento de dados (LGPD).
 * Ex.: "termos@2026-10-17 contrato-lgpd@2026-10-17". null se algum texto não pôde ser lido.
 */
export function versaoDosTermos(config: Config): string | null {
  const textos = (['termos', 'contrato-lgpd'] as const).map((d) => lerTextoLegal(config, d));
  if (textos.some((t) => !t)) return null;
  return textos.map((t) => `${t!.documento}@${t!.versao}`).join(' ');
}

// Passos gravados em outro site. A extensão grava a aba inteira, e o caminho às vezes passa por fora
// do sistema da empresa (uma consulta de CNPJ, um buscador de CEP). O copiloto só repete passos no
// sistema: esses passos ficam marcados (`outroSite`) e, na revisão, a pessoa escolhe "Remover" ou
// "Manter como instrução". Enquanto houver um sem escolha, o fluxo não pode ser testado nem publicado.
import type { Campo, PassoFluxo } from '@copiloto/shared';

/** Host do sistema ("app.horizonte.com.br", com a porta se houver), sem "www.". null: sem endereço. */
export function hostDoSistema(urlBase: string | null | undefined): string | null {
  if (!urlBase) return null;
  try {
    const u = new URL(urlBase);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Host do endereço quando ele é de outro site; undefined para caminhos e para o próprio sistema. */
export function outroSiteDe(url: string | undefined, hostSistema: string | null): string | undefined {
  if (!url || !hostSistema || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const host = new URL(url).host.replace(/^www\./, '').toLowerCase();
    return host && host !== hostSistema ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

/** Endereço completo sem os parâmetros do gravador (para passos em outro site). */
export function enderecoSemGravador(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('copiloto_gravacao');
    u.searchParams.delete('copiloto_api');
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Confere a marca de cada passo pelo endereço: endereço completo de outro site marca; caminho do
 * sistema desmarca (a marca nunca vem do console, só do endereço gravado).
 */
export function marcarOutrosSites(passos: PassoFluxo[], urlSistema: string | null | undefined): PassoFluxo[] {
  const host = hostDoSistema(urlSistema);
  return passos.map((p) => {
    const site = outroSiteDe(p.url, host);
    if (site) return { ...p, outroSite: site };
    if (!p.outroSite && !p.instrucao) return p;
    const { outroSite: _o, instrucao: _i, ...resto } = p;
    return resto;
  });
}

/** Passos que ainda esperam "Remover" ou "Manter como instrução". */
export function outrosSitesPendentes(passos: PassoFluxo[]): PassoFluxo[] {
  return passos.filter((p) => !!p.outroSite && !p.instrucao);
}

/**
 * Tira dos campos sugeridos os que só eram usados por passos que o robô não executa (removidos ou
 * mantidos como instrução). Campos que nenhum passo usava continuam (a pessoa pode ter criado).
 */
export function podarCamposSugeridos(campos: Campo[], antes: PassoFluxo[], depois: PassoFluxo[]): Campo[] {
  const usados = (passos: PassoFluxo[], executaveis: boolean) =>
    new Set(
      passos
        .filter((p) => !executaveis || (!p.instrucao && !p.outroSite))
        .flatMap((p) => (p.valor?.origem === 'campo' ? [p.valor.campo] : [])),
    );
  const usadosAntes = usados(antes, false);
  const usadosDepois = usados(depois, true);
  return campos.filter((c) => !usadosAntes.has(c.chave) || usadosDepois.has(c.chave));
}

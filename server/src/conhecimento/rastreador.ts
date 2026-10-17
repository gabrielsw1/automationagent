// Rastreador de sites para a base de conhecimento: começa na URL informada, segue links do mesmo
// domínio (dentro da mesma área do site), respeita o robots.txt de forma simples e lê cada página.
import { errosFonte, ErroFonte } from './erros.ts';
import { lerPaginaHtml, type PaginaHtml } from './extratores.ts';

export const AGENTE = 'CopilotoBot/1.0 (+base de conhecimento do Copiloto)';
const TIMEOUT_MS = 15_000;
const TAMANHO_MAX_PAGINA = 5 * 1024 * 1024;
const EXTENSOES_IGNORADAS =
  /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|gz|png|jpe?g|gif|webp|svg|ico|mp4|mp3|webm|mov|avi|css|js|json|xml|rss|txt|csv)$/i;

// ---------- robots.txt ----------

export interface Robots {
  permitido(caminho: string): boolean;
}

function regraParaRegex(regra: string): RegExp {
  const fim = regra.endsWith('$');
  const corpo = (fim ? regra.slice(0, -1) : regra)
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + corpo + (fim ? '$' : ''));
}

/** Lê um robots.txt: usa o grupo do nosso agente (CopilotoBot) ou, se não houver, o de "*". */
export function lerRobots(texto: string): Robots {
  type Grupo = { agentes: string[]; regras: { permitir: boolean; caminho: string }[] };
  const grupos: Grupo[] = [];
  let atual: Grupo | null = null;
  let ultimaFoiAgente = false;
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(linha);
    if (!m) continue;
    const campo = m[1].toLowerCase();
    const valor = m[2].trim();
    if (campo === 'user-agent') {
      if (!atual || !ultimaFoiAgente) {
        atual = { agentes: [], regras: [] };
        grupos.push(atual);
      }
      atual.agentes.push(valor.toLowerCase());
      ultimaFoiAgente = true;
    } else if ((campo === 'disallow' || campo === 'allow') && atual) {
      ultimaFoiAgente = false;
      if (campo === 'disallow' && !valor) continue; // "Disallow:" vazio libera tudo
      atual.regras.push({ permitir: campo === 'allow', caminho: valor });
    } else {
      ultimaFoiAgente = false;
    }
  }
  const nosso = grupos.find((g) => g.agentes.some((a) => a.split('/')[0].trim() === 'copilotobot'));
  const grupo = nosso ?? grupos.find((g) => g.agentes.includes('*'));
  const regras = (grupo?.regras ?? []).map((r) => ({ ...r, re: regraParaRegex(r.caminho), tamanho: r.caminho.length }));
  return {
    permitido(caminho: string) {
      let melhor: { permitir: boolean; tamanho: number } | null = null;
      for (const r of regras) {
        if (!r.re.test(caminho)) continue;
        if (!melhor || r.tamanho > melhor.tamanho || (r.tamanho === melhor.tamanho && r.permitir)) melhor = r;
      }
      return melhor ? melhor.permitir : true;
    },
  };
}

// ---------- Busca de páginas ----------

interface Resposta {
  status: number;
  url: string;
  tipo: string;
  corpo: string;
}

async function baixar(url: string, sinal?: AbortSignal): Promise<Resposta> {
  const sinais = [AbortSignal.timeout(TIMEOUT_MS), ...(sinal ? [sinal] : [])];
  const r = await fetch(url, {
    headers: { 'user-agent': AGENTE, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.any(sinais),
  });
  const tipo = r.headers.get('content-type') ?? '';
  const tamanho = Number(r.headers.get('content-length') ?? 0);
  let corpo = '';
  if (r.ok && /html|xml|text\/plain/i.test(tipo) && tamanho <= TAMANHO_MAX_PAGINA) {
    corpo = await r.text();
    if (corpo.length > TAMANHO_MAX_PAGINA) corpo = corpo.slice(0, TAMANHO_MAX_PAGINA);
  } else {
    await r.body?.cancel().catch(() => {});
  }
  return { status: r.status, url: r.url || url, tipo, corpo };
}

/** Normaliza uma URL para comparar: sem #âncora, sem barra final repetida. */
export function normalizarUrl(u: URL): string {
  const c = new URL(u.toString());
  c.hash = '';
  for (const p of [...c.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(p)) c.searchParams.delete(p);
  let s = c.toString();
  if (c.pathname.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** Área do site que será rastreada: o primeiro trecho do caminho ("/ajuda/x" → "/ajuda"). */
export function prefixoDaArea(inicio: URL): string {
  const partes = inicio.pathname.split('/').filter(Boolean);
  if (partes.length === 0) return '/';
  if (partes.length === 1 && /\.[a-z0-9]+$/i.test(partes[0])) return '/';
  return '/' + partes[0];
}

function dentroDaArea(u: URL, inicio: URL, prefixo: string): boolean {
  if (u.host !== inicio.host) return false;
  if (!/^https?:$/.test(u.protocol)) return false;
  if (prefixo === '/') return true;
  return u.pathname === prefixo || u.pathname.startsWith(prefixo + '/') || u.pathname.startsWith(prefixo + '.');
}

function pareceLogin(final: URL, pedido: URL): boolean {
  if (final.pathname === pedido.pathname) return false;
  return /(log-?in|sign-?in|entrar|auth|sso|sessao|session|acesso)/i.test(final.pathname + final.search);
}

export interface PaginaRastreada extends PaginaHtml {
  url: string;
}

export interface OpcoesRastreio {
  url: string;
  limite: number;
  sinal?: AbortSignal;
  /** Chamado a cada página lida (com conteúdo) e a cada página visitada (para o progresso). */
  aoPagina?: (pagina: PaginaRastreada) => void | Promise<void>;
  aoProgresso?: (feitas: number, total: number) => void | Promise<void>;
}

export interface ResultadoRastreio {
  lidas: number;
  ignoradas: { url: string; motivo: string }[];
}

/** Rastreia o site. Erros na primeira página viram ErroFonte (com "como resolver"); nas outras, a página é ignorada. */
export async function rastrearSite(op: OpcoesRastreio): Promise<ResultadoRastreio> {
  let inicio: URL;
  try {
    inicio = new URL(op.url);
    if (!/^https?:$/.test(inicio.protocol)) throw new Error();
  } catch {
    throw errosFonte.urlInvalida();
  }
  const prefixo = prefixoDaArea(inicio);

  let robots: Robots = { permitido: () => true };
  try {
    const r = await baixar(new URL('/robots.txt', inicio).toString(), op.sinal);
    if (r.status === 200 && r.corpo) robots = lerRobots(r.corpo);
  } catch (e) {
    if (op.sinal?.aborted) throw e;
    // Sem robots.txt: tudo liberado.
  }
  if (!robots.permitido(inicio.pathname + inicio.search)) throw errosFonte.siteBloqueado();

  const fila: string[] = [normalizarUrl(inicio)];
  const vistas = new Set<string>(fila);
  const conteudos = new Set<string>();
  const ignoradas: ResultadoRastreio['ignoradas'] = [];
  let lidas = 0;
  let visitadas = 0;

  while (fila.length && lidas < op.limite) {
    if (op.sinal?.aborted) throw op.sinal.reason ?? new Error('interrompido');
    const atual = fila.shift()!;
    const primeira = visitadas === 0;
    visitadas += 1;
    const pedido = new URL(atual);
    let r: Resposta;
    try {
      r = await baixar(atual, op.sinal);
    } catch (e) {
      if (op.sinal?.aborted) throw e;
      if (primeira) {
        const causa = (e as { cause?: { code?: string } }).cause?.code;
        throw errosFonte.siteForaDoAr(
          causa === 'ENOTFOUND' ? 'o endereço não existe' : causa === 'ECONNREFUSED' ? 'conexão recusada' : (e as Error).name === 'TimeoutError' ? 'demorou demais para responder' : undefined,
        );
      }
      ignoradas.push({ url: atual, motivo: 'não abriu' });
      continue;
    }
    const final = new URL(r.url);
    if (primeira) {
      if (r.status === 401 || r.status === 407) throw errosFonte.siteLogin();
      if (r.status === 403) throw errosFonte.siteProibido();
      if (r.status === 404 || r.status === 410) throw errosFonte.siteNaoEncontrado();
      if (r.status >= 400) throw errosFonte.siteForaDoAr(`erro ${r.status}`);
      if (pareceLogin(final, pedido)) throw errosFonte.siteLogin();
      if (!r.corpo) throw errosFonte.siteNaoHtml();
    } else if (r.status >= 400 || !r.corpo || pareceLogin(final, pedido)) {
      ignoradas.push({ url: atual, motivo: r.status >= 400 ? `erro ${r.status}` : 'sem texto' });
      await op.aoProgresso?.(lidas, Math.min(op.limite, lidas + fila.length));
      continue;
    }

    const pagina = lerPaginaHtml(r.corpo);
    if (primeira && pagina.pedeLogin && pagina.caracteres < 400) throw errosFonte.siteLogin();

    // Links da página (mesmo domínio e mesma área, respeitando o robots.txt).
    for (const href of pagina.links) {
      let u: URL;
      try {
        u = new URL(href, final);
      } catch {
        continue;
      }
      if (!dentroDaArea(u, inicio, prefixo) || EXTENSOES_IGNORADAS.test(u.pathname)) continue;
      const n = normalizarUrl(u);
      if (vistas.has(n)) continue;
      vistas.add(n);
      if (!robots.permitido(u.pathname + u.search)) {
        ignoradas.push({ url: n, motivo: 'bloqueada pelo robots.txt' });
        continue;
      }
      fila.push(n);
    }

    const assinatura = pagina.secoes.map((s) => s.paragrafos.join('\n')).join('\n').slice(0, 4000);
    if (pagina.naoIndexar) {
      ignoradas.push({ url: atual, motivo: 'marcada para não indexar' });
    } else if (pagina.caracteres < 40 || conteudos.has(assinatura)) {
      if (pagina.caracteres < 40) ignoradas.push({ url: atual, motivo: 'sem texto' });
    } else {
      conteudos.add(assinatura);
      lidas += 1;
      await op.aoPagina?.({ ...pagina, url: normalizarUrl(final) });
    }
    await op.aoProgresso?.(lidas, Math.min(op.limite, Math.max(lidas, lidas + fila.length)));
  }

  if (lidas === 0) throw errosFonte.siteSemTexto();
  return { lidas, ignoradas };
}

export { ErroFonte };

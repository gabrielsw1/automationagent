// Número do registro criado: depois do último passo, o navegador lê da tela o número do que o
// fluxo criou ("Chamado #1287") para o recibo. Com o lugar configurado no fluxo (Mapear campos),
// lê daquele elemento; sem, procura no aviso de confirmação com padrões conservadores e, se não
// achar exatamente um número, não chuta: o recibo sai sem número.
import type { Page } from 'playwright';
import type { RegistroLido, ResultadoFluxo } from '@copiloto/shared';
import { localizar } from './seletores.ts';

/* Código de página (page.evaluate): nomes do navegador declarados só neste arquivo (ver pagina.ts). */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const getComputedStyle: (el: any) => { display: string; visibility: string };
declare const location: { origin: string };

/** O que o texto diz do registro: o número e, quando dá, o nome ("Chamado") e o artigo. */
export interface RegistroNoTexto {
  numero: string;
  nome?: string;
  artigo?: 'o' | 'a';
}

// Um código de registro: começa com até 6 letras e um separador ("CH-", "PED/") ou direto com um
// dígito, e segue com letras, dígitos e separadores. Sempre tem pelo menos um dígito.
const CODIGO = String.raw`(?:[A-Za-z]{1,6}[-/.]?)?\d[\w./-]*`;
const LETRA = String.raw`\p{L}`;
const ANTES = String.raw`(?<![\p{L}\d])`;
const PARTICIPIO = String.raw`(?:criad|abert|cadastrad|registrad|gerad|salv|agendad|enviad|emitid|incluíd|lançad)[oa]s?`;

/** Palavras que não são o nome do registro ("o #1287", "com o número 1287"). */
const NAO_SAO_NOME = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'seu', 'sua', 'do', 'da', 'de', 'no', 'na', 'em', 'com', 'e', 'é', 'foi', 'sob', 'pelo',
  'pela', 'para', 'ao', 'número', 'numero', 'código', 'codigo', 'nº', 'n', 'item', 'linha', 'página', 'pagina', 'versão', 'versao',
]);

/** Nomes que terminam em "a" mas são masculinos, e os femininos que não terminam em "a". */
const MASCULINOS_EM_A = new Set(['problema', 'sistema', 'tema', 'dia', 'mapa', 'programa', 'clima', 'idioma', 'esquema', 'diagrama', 'telegrama', 'cinema']);
const FEMININOS = new Set(['ordem', 'nota', 'os', 'nf', 'nfe', 'nfs', 'nfs-e', 'nf-e']);

/** "o chamado", "a visita", "a ordem de serviço": pelo primeiro nome, com as exceções comuns. */
export function artigoDe(nome: string): 'o' | 'a' {
  const p = nome.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (FEMININOS.has(p)) return 'a';
  if (MASCULINOS_EM_A.has(p)) return 'o';
  if (/(a|ção|são|dade|gem|ise)$/.test(p)) return 'a';
  return 'o';
}

/** Datas, CPF, CNPJ, telefone, horas e valores não são número de registro. */
function pareceOutraCoisa(c: string): boolean {
  if (/^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(c)) return true; // data
  if (/^\d{4}-\d{2}-\d{2}/.test(c)) return true; // data ISO
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(c)) return true; // CPF
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(c)) return true; // CNPJ
  if (/^\d{4,5}-\d{4}$/.test(c)) return true; // telefone
  if (/^\d{1,3}(?:\.\d{3})+$/.test(c)) return true; // valor ("1.250")
  return false;
}

function limparCodigo(c: string): string | null {
  const s = c.replace(/^#\s?/, '').replace(/[./-]+$/, '');
  if (!s || s.length > 32 || !/\d/.test(s) || pareceOutraCoisa(s)) return null;
  return s;
}

function nomeValido(palavra: string | undefined): string | undefined {
  const p = palavra?.trim();
  if (!p || p.length < 3 || NAO_SAO_NOME.has(p.toLowerCase())) return undefined;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function artigoDoParticipio(p: string | undefined): 'o' | 'a' | undefined {
  if (!p) return undefined;
  return /as?$/.test(p.toLowerCase()) ? 'a' : 'o';
}

/**
 * Procura o número do registro num texto de confirmação, só nos padrões em que um sistema anuncia
 * o que criou: "Chamado #1287 criado", "Pedido nº 1287", "Protocolo: 2026-0042", "Chamado
 * CH-2026-0153 aberto", "Cliente cadastrado com o código 1043". Se o texto tiver mais de um
 * número nesses padrões, devolve null: melhor o recibo sem número do que um número errado.
 */
export function extrairRegistro(texto: string): RegistroNoTexto | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const achados: RegistroNoTexto[] = [];
  const anotar = (codigo: string | undefined, nome?: string, artigo?: 'o' | 'a') => {
    const numero = codigo ? limparCodigo(codigo) : null;
    if (numero) achados.push({ numero, nome, artigo });
  };
  const padroes: [RegExp, (m: RegExpMatchArray) => void][] = [
    // "Chamado #1287", "#1287 criado"
    [
      new RegExp(String.raw`${ANTES}(?:(${LETRA}+) )?#\s?(${CODIGO})(?: (?:foi )?(${PARTICIPIO}))?`, 'giu'),
      (m) => anotar(m[2], nomeValido(m[1]), artigoDoParticipio(m[3])),
    ],
    // "Pedido nº 1287", "n.º 1287"
    [
      new RegExp(String.raw`${ANTES}(?:(${LETRA}+) )?n\.?\s?[º°]\.?\s?:?\s?(${CODIGO})(?: (?:foi )?(${PARTICIPIO}))?`, 'giu'),
      (m) => anotar(m[2], nomeValido(m[1]), artigoDoParticipio(m[3])),
    ],
    // "Protocolo: 2026-0042", "Cliente cadastrado com o código 1043", "Número do chamado: 1287"
    [
      new RegExp(
        String.raw`${ANTES}(?:(${LETRA}+) (?:foi )?(${PARTICIPIO}) com (?:o|a) )?(protocolo|ticket|n[úu]mero|c[óo]digo)(?: d[oa] (${LETRA}+))?\s?:?\s?(${CODIGO})`,
        'giu',
      ),
      (m) => {
        const chave = m[3].toLowerCase();
        const nome = nomeValido(m[1]) ?? nomeValido(m[4]) ?? (/^(protocolo|ticket)$/.test(chave) ? nomeValido(m[3]) : undefined);
        anotar(m[5], nome, artigoDoParticipio(m[2]));
      },
    ],
    // "Chamado CH-2026-0153 aberto", "O pedido 1287 foi criado"
    [
      new RegExp(String.raw`${ANTES}(${LETRA}+) #?(${CODIGO}) (?:foi )?(${PARTICIPIO})(?![\p{L}])`, 'giu'),
      (m) => {
        const nome = nomeValido(m[1]);
        if (nome) anotar(m[2], nome, artigoDoParticipio(m[3]));
      },
    ],
  ];
  for (const [re, aoAchar] of padroes) for (const m of t.matchAll(re)) aoAchar(m);
  const distintos = new Set(achados.map((a) => a.numero.toLowerCase()));
  if (distintos.size !== 1) return null;
  const numero = achados[0].numero;
  const nome = achados.find((a) => a.nome)?.nome;
  const artigo = achados.find((a) => a.nome === nome && a.artigo)?.artigo ?? (nome ? artigoDe(nome) : undefined);
  return { numero, ...(nome ? { nome, artigo } : {}) };
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formato do número, como no gravador (9 é um dígito, a é uma letra), em expressão regular.
 * "CH-9999-9999" casa "CH-2026-0153" e também "CH-2026-10000" (o sequencial cresce).
 */
export function formatoParaRegex(formato: string): RegExp | null {
  const f = formato.trim();
  if (!f || !/[9a]/i.test(f)) return null;
  let re = '';
  for (const parte of f.match(/9+|a+|A+|[^9aA]+/g) ?? []) {
    if (parte[0] === '9') re += String.raw`\d{${parte.length},}`;
    else if (parte[0] === 'a' || parte[0] === 'A') re += String.raw`\p{L}{${parte.length}}`;
    else re += escaparRegex(parte);
  }
  return new RegExp(String.raw`${ANTES}${re}(?![\p{L}\d])`, 'u');
}

/** Número dentro do texto do elemento configurado: pelo formato, ou o único código que ele tem. */
export function numeroDoElemento(texto: string, formato?: string): string | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (formato?.trim()) {
    const re = formatoParaRegex(formato);
    const m = re ? t.match(re) : null;
    return m ? m[0] : null;
  }
  const inteiro = t.match(new RegExp(String.raw`^#?\s?(${CODIGO})$`, 'u'));
  if (inteiro) return limparCodigo(inteiro[1]);
  const doTexto = extrairRegistro(t);
  if (doTexto) return doTexto.numero;
  const codigos = [...t.matchAll(new RegExp(String.raw`${ANTES}#?(${CODIGO})`, 'gu'))].map((m) => limparCodigo(m[1])).filter((c): c is string => !!c);
  return new Set(codigos).size === 1 ? codigos[0] : null;
}

/** Como o recibo mostra o número: só dígitos ganham "#" ("#1287"); códigos ficam como a tela mostra. */
export function numeroParaRecibo(numero: string): string {
  return /^\d+$/.test(numero) ? `#${numero}` : numero;
}

// ---------- Leitura na página ----------

/** Onde um sistema mostra que deu certo. Só estes elementos entram na procura sem configuração. */
const CONFIRMACOES =
  '[role=status], [role=alert], [aria-live], .alert, .alerta, .toast, .flash, .notice, .notification, .snackbar, .success, .sucesso, .alert-success, .alerta-ok, [data-campo="mensagem_sucesso"]';

interface ElementoLido {
  texto: string;
  /** Texto do aviso em volta (para achar o nome do registro). */
  contexto: string;
}

async function lerElemento(page: Page, seletor: string, tempoMs: number): Promise<ElementoLido | null> {
  const loc = localizar(page, seletor).first();
  try {
    await loc.waitFor({ state: 'visible', timeout: tempoMs });
  } catch {
    return null;
  }
  return loc
    .evaluate(
      (el: any, confirmacoes: string) => {
        const limpo = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
        const tag = el.tagName.toLowerCase();
        const texto = limpo(['input', 'textarea', 'select'].includes(tag) ? el.value : el.innerText || el.textContent);
        const volta = el.closest(confirmacoes) || el.parentElement;
        return { texto, contexto: limpo(volta ? volta.innerText || volta.textContent : texto) };
      },
      CONFIRMACOES,
    )
    .catch(() => null);
}

/** Textos dos avisos de confirmação visíveis e do título da página. */
async function textosDeConfirmacao(page: Page): Promise<string[]> {
  return page
    .evaluate((sel: string) => {
      const textos: string[] = [];
      const visivel = (el: any) => {
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0;
      };
      for (const el of Array.from<any>(document.querySelectorAll(`${sel}, h1`))) {
        if (!visivel(el)) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 3 && t.length <= 300 && !textos.includes(t)) textos.push(t);
      }
      return textos;
    }, CONFIRMACOES)
    .catch(() => []);
}

/** O que a página diz sobre o número: o link para abrir o registro e onde o número está. */
async function detalhesNaPagina(page: Page, numero: string): Promise<{ url?: string; seletor?: string }> {
  return page
    .evaluate(
      ({ numero, sel }: { numero: string; sel: string }) => {
        const limpo = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
        const contem = (el: any) => limpo(el.innerText || el.textContent).replace(/#\s?/g, '').includes(numero);
        let url: string | undefined;
        for (const a of Array.from<any>(document.querySelectorAll('a[href]'))) {
          const t = limpo(a.innerText || a.textContent).replace(/^#\s?/, '');
          if (t !== numero && !(t.includes(numero) && t.length <= numero.length + 40)) continue;
          try {
            const u = new URL(a.href, document.baseURI);
            if (u.origin === location.origin && /^https?:$/.test(u.protocol)) {
              url = u.toString();
              break;
            }
          } catch {
            /* link inválido */
          }
        }
        // O elemento mais interno com o número, dentro de um aviso de confirmação (ou na página).
        const caixas = Array.from<any>(document.querySelectorAll(sel)).filter(contem);
        let alvo: any = caixas[0] ?? null;
        for (;;) {
          if (!alvo) break;
          const filho = Array.from<any>(alvo.children).find(contem);
          if (!filho) break;
          alvo = filho;
        }
        let seletor: string | undefined;
        const aspas = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        for (let el = alvo; el && el !== document.body; el = el.parentElement) {
          const campo = el.getAttribute('data-campo');
          const testId = el.getAttribute('data-testid');
          const id = el.getAttribute('id');
          if (campo) seletor = `[data-campo=${aspas(campo)}]`;
          else if (testId) seletor = `[data-testid=${aspas(testId)}]`;
          else if (id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id)) seletor = `#${id}`;
          else if (el.getAttribute('role') === 'status' || el.getAttribute('role') === 'alert') seletor = `[role=${el.getAttribute('role')}]`;
          if (seletor) break;
        }
        return { url, seletor };
      },
      { numero, sel: CONFIRMACOES },
    )
    .catch(() => ({}));
}

function dormir(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Lê o número do registro criado na tela atual. `resultado.seletor` configurado: lê daquele
 * elemento (e, se não aparecer em `tempoMs`, devolve null). Sem configuração: procura nos avisos
 * de confirmação até `tempoMs`, e só aceita quando há exatamente um número.
 */
export async function lerRegistro(page: Page, resultado: ResultadoFluxo | null | undefined, tempoMs = 2_000): Promise<RegistroLido | null> {
  const nomeConfigurado = resultado?.nome?.trim() || undefined;
  if (resultado?.seletor?.trim()) {
    const lido = await lerElemento(page, resultado.seletor.trim(), tempoMs);
    if (!lido) return null;
    const numero = numeroDoElemento(lido.texto, resultado.formato);
    if (!numero) return null;
    const doAviso = extrairRegistro(lido.contexto);
    const daTela = doAviso && doAviso.numero.toLowerCase() === numero.toLowerCase() ? doAviso : null;
    const nome = nomeConfigurado ?? daTela?.nome;
    const artigo = nome ? (nome === daTela?.nome ? daTela.artigo : undefined) ?? artigoDe(nome) : undefined;
    const { url } = await detalhesNaPagina(page, numero);
    return {
      numero,
      ...(nome ? { nome, artigo } : {}),
      ...(url ? { url } : {}),
      texto: lido.contexto || lido.texto,
      seletor: resultado.seletor.trim(),
      origem: 'configurado',
    };
  }
  const limite = Date.now() + tempoMs;
  for (;;) {
    const textos = await textosDeConfirmacao(page);
    const achados = textos.map((texto) => ({ texto, r: extrairRegistro(texto) })).filter((a) => a.r);
    const distintos = new Set(achados.map((a) => a.r!.numero.toLowerCase()));
    if (distintos.size > 1) return null;
    if (distintos.size === 1) {
      const { texto, r } = achados[0];
      const nome = nomeConfigurado ?? r!.nome;
      const artigo = nome ? (nome === r!.nome ? r!.artigo : undefined) ?? artigoDe(nome) : undefined;
      const { url, seletor } = await detalhesNaPagina(page, r!.numero);
      return {
        numero: r!.numero,
        ...(nome ? { nome, artigo } : {}),
        ...(url ? { url } : {}),
        texto,
        ...(seletor ? { seletor } : {}),
        origem: 'aviso',
      };
    }
    if (Date.now() >= limite) return null;
    await dormir(250);
  }
}

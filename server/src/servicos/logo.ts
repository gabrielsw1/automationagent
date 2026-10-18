// Logo da empresa no widget (Canais e widget › Aparência e "Sua marca" no cadastro).
// O arquivo fica na pasta da empresa (DATA_DIR/empresas/<id>/marca/<hash>.<ext>), com nome pelo
// conteúdo, e é servido num endereço público preso à chave do widget, com cache longo.
// PNG e SVG são conferidos pelo conteúdo, não pela extensão. O SVG passa por uma lista fechada de
// elementos e atributos: sem script, sem eventos, sem referências externas e sem foreignObject.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigWidget, LogoWidget } from '@copiloto/shared';
import { agoraIso } from '../db/banco.ts';
import { ErroHttp } from '../util/erros.ts';

/** 1 MB. */
export const LIMITE_LOGO = 1024 * 1024;
/** Lado maior dividido pelo menor: até 1,25 conta como quadrado. */
const PROPORCAO_MAXIMA = 1.25;
const LADO_MINIMO = 32;

export type TipoLogo = LogoWidget['tipo'];

/** Logo recusado: a mensagem vai para a pessoa como está. */
export class LogoRecusado extends ErroHttp {
  constructor(mensagem: string, status = 422) {
    super(status, 'logo_invalido', mensagem);
  }
}

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Largura e altura do PNG (cabeçalho IHDR), ou null se não for um PNG. */
export function medidasPng(b: Buffer): { largura: number; altura: number } | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(ASSINATURA_PNG) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

function conferirProporcao(largura: number, altura: number, unidade: string) {
  if (!(largura > 0) || !(altura > 0)) throw new LogoRecusado('Não consegui ler o tamanho do logo. Exporte o arquivo de novo e envie.');
  const proporcao = Math.max(largura, altura) / Math.min(largura, altura);
  if (proporcao > PROPORCAO_MAXIMA) {
    const medidas = `${fmtNumero(largura)} × ${fmtNumero(altura)}${unidade}`;
    throw new LogoRecusado(`O logo precisa ser quadrado: este tem ${medidas}. Use uma versão só com o símbolo, com a mesma largura e altura.`);
  }
}

function fmtNumero(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

// ---------- SVG ----------

const ELEMENTOS_SVG = new Set(
  [
    'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
    'textPath', 'title', 'desc', 'metadata', 'style', 'image', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
    'pattern', 'marker', 'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feDropShadow', 'feFlood',
    'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  ].map((e) => e.toLowerCase()),
);
/** Elementos de editores (Inkscape, Illustrator) que o navegador ignora; os atributos deles passam pela mesma conferência. */
const PREFIXOS_INERTES = ['sodipodi:', 'inkscape:', 'rdf:', 'cc:', 'dc:', 'i:', 'x:', 'sketch:', 'serif:'];

const DOCTYPE = /<!DOCTYPE\s+svg(?:\s+PUBLIC\s+"[^"[\]<>]*"\s+"[^"[\]<>]*")?\s*>/iy;
const FECHA = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
const ABRE = /<([A-Za-z_][\w:.-]*)/y;
const ATRIBUTO = /([^\s=/>"'<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const IMAGEM_EMBUTIDA = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const ENTIDADES = /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});)/i;

function recusarSvg(motivo: string): never {
  throw new LogoRecusado(`Este SVG não pode ser usado como logo: ${motivo}. Exporte só o desenho (sem scripts nem links) e envie de novo.`);
}

/** Confere CSS (atributo style ou elemento <style>): só referências internas (#id), nada que carregue ou rode algo. */
function conferirCss(css: string) {
  const t = css.toLowerCase();
  if (/@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|<\//.test(t)) recusarSvg('o estilo carrega ou roda algo de fora');
  for (const m of t.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    if (!m[2].startsWith('#')) recusarSvg('o estilo aponta para um endereço externo');
  }
}

function conferirAtributo(elemento: string, nome: string, valor: string) {
  const n = nome.toLowerCase();
  if (n.startsWith('on')) recusarSvg(`tem um evento (${nome})`);
  if (n === 'xmlns' || n.startsWith('xmlns:')) return; // declaração de namespace, não carrega nada
  if (n === 'xml:base') recusarSvg('muda a base dos endereços');
  const v = valor.trim();
  if (/^(?:javascript|vbscript):|data:text\/html/i.test(v.replace(/[\s\u0000-\u001f]+/g, ''))) recusarSvg('tem um link que roda código');
  if (n === 'href' || n.endsWith(':href')) {
    if (v.startsWith('#')) return;
    if (elemento === 'image' && IMAGEM_EMBUTIDA.test(v)) return;
    recusarSvg('aponta para um arquivo ou endereço externo');
  }
  if (n === 'style') conferirCss(v);
  else if (/url\s*\(/i.test(v)) conferirCss(v);
}

function decodificarEntidades(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Lê o SVG com um analisador próprio e estrito (não um navegador): recusa DOCTYPE e entidades,
 * instruções de processamento (fora a declaração XML), elementos fora da lista (script,
 * foreignObject, a, animate, iframe...), atributos de evento, links que não sejam internos e CSS
 * que carregue algo. Devolve as medidas pelo viewBox (ou largura e altura), quando há.
 */
export function conferirSvg(texto: string): { largura: number; altura: number } | null {
  const s = texto.replace(/^﻿/, '');
  if (s.includes('�')) recusarSvg('o texto não está em UTF-8');
  const pilha: string[] = [];
  let raiz: Record<string, string> | null = null;
  let fechouRaiz = false;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const texto = lt < 0 ? s.slice(i) : s.slice(i, lt);
    if (texto.trim()) {
      if (!pilha.length) recusarSvg('tem texto fora do desenho');
      if (ENTIDADES.test(texto)) recusarSvg('usa entidades que não são do XML');
      if (pilha[pilha.length - 1] === 'style') conferirCss(decodificarEntidades(texto));
    }
    if (lt < 0) break;
    i = lt;
    if (s.startsWith('<!--', i)) {
      const fim = s.indexOf('-->', i + 4);
      if (fim < 0) recusarSvg('tem um comentário sem fim');
      i = fim + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const fim = s.indexOf(']]>', i + 9);
      if (fim < 0 || !pilha.length) recusarSvg('tem um bloco CDATA fora do lugar');
      if (pilha[pilha.length - 1] === 'style') conferirCss(s.slice(i + 9, fim));
      i = fim + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const fim = s.indexOf('?>', i + 2);
      if (fim < 0 || raiz || !/^<\?xml\s/i.test(s.slice(i, fim)) || /stylesheet/i.test(s.slice(i, fim))) {
        recusarSvg('tem uma instrução de processamento');
      }
      i = fim + 2;
      continue;
    }
    if (s.startsWith('<!', i)) {
      // DOCTYPE simples (exportado por alguns editores) passa; com declarações internas ([...]), não.
      DOCTYPE.lastIndex = i;
      const d = DOCTYPE.exec(s);
      if (!d || raiz) recusarSvg('declara DOCTYPE com entidades');
      i += d[0].length;
      continue;
    }
    if (s.startsWith('</', i)) {
      FECHA.lastIndex = i;
      const m = FECHA.exec(s);
      if (!m) recusarSvg('tem uma tag de fechamento inválida');
      const nome = m[1].toLowerCase();
      if (pilha.pop() !== nome) recusarSvg('tem tags que não fecham na ordem');
      if (!pilha.length) fechouRaiz = true;
      i += m[0].length;
      continue;
    }
    // Abertura de tag.
    ABRE.lastIndex = i;
    const nomeM = ABRE.exec(s);
    if (!nomeM) recusarSvg('tem um < solto');
    const nomeOriginal = nomeM[1];
    const nome = nomeOriginal.toLowerCase();
    if (fechouRaiz) recusarSvg('tem conteúdo depois do fim do desenho');
    if (!pilha.length && raiz) recusarSvg('tem mais de um desenho no arquivo');
    if (!raiz && nome !== 'svg') recusarSvg('não começa com <svg>');
    const inerte = PREFIXOS_INERTES.some((p) => nome.startsWith(p));
    if (!inerte && !ELEMENTOS_SVG.has(nome)) recusarSvg(`usa o elemento <${nomeOriginal}>`);
    i += nomeM[0].length;
    const atributos: Record<string, string> = {};
    let autoFechada = false;
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) recusarSvg('termina no meio de uma tag');
      if (s.startsWith('/>', i)) {
        autoFechada = true;
        i += 2;
        break;
      }
      if (s[i] === '>') {
        i++;
        break;
      }
      ATRIBUTO.lastIndex = i;
      const attr = ATRIBUTO.exec(s);
      if (!attr) recusarSvg(`tem um atributo inválido em <${nomeOriginal}>`);
      const valorBruto = attr[2] ?? attr[3] ?? '';
      if (valorBruto.includes('<') || ENTIDADES.test(valorBruto)) recusarSvg(`tem um valor inválido em <${nomeOriginal}>`);
      const valor = decodificarEntidades(valorBruto);
      conferirAtributo(nome, attr[1], valor);
      atributos[attr[1].toLowerCase()] = valor;
      i += attr[0].length;
    }
    if (!raiz) raiz = atributos;
    if (autoFechada) {
      if (!pilha.length) fechouRaiz = true;
    } else pilha.push(nome);
  }
  if (!raiz) recusarSvg('não tem um desenho <svg>');
  if (pilha.length) recusarSvg('tem tags que não fecham');
  const vb = raiz.viewbox?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) return { largura: vb[2], altura: vb[3] };
  const w = parseFloat(raiz.width ?? '');
  const h = parseFloat(raiz.height ?? '');
  if (Number.isFinite(w) && Number.isFinite(h) && !/%/.test(`${raiz.width}${raiz.height}`)) return { largura: w, altura: h };
  return null;
}

/** Confere um logo enviado pelo conteúdo (PNG ou SVG), o tamanho (até 1 MB) e a proporção quadrada. */
export function validarLogo(conteudo: Buffer): { tipo: TipoLogo; extensao: 'png' | 'svg' } {
  if (conteudo.length === 0) throw new LogoRecusado('O arquivo está vazio.');
  if (conteudo.length > LIMITE_LOGO) {
    throw new LogoRecusado(`O logo tem ${(conteudo.length / 1024 / 1024).toFixed(1).replace('.', ',')} MB. O limite é 1 MB.`, 413);
  }
  const png = medidasPng(conteudo);
  if (png) {
    conferirProporcao(png.largura, png.altura, ' pixels');
    if (Math.min(png.largura, png.altura) < LADO_MINIMO) {
      throw new LogoRecusado(`O logo é pequeno demais (${png.largura} × ${png.altura} pixels). Use pelo menos ${LADO_MINIMO} × ${LADO_MINIMO}.`);
    }
    return { tipo: 'image/png', extensao: 'png' };
  }
  const inicio = conteudo.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  const pareceSvg = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(inicio);
  if (!pareceSvg) throw new LogoRecusado('O logo precisa ser um arquivo PNG ou SVG.');
  const medidas = conferirSvg(conteudo.toString('utf8'));
  if (medidas) conferirProporcao(medidas.largura, medidas.altura, '');
  return { tipo: 'image/svg+xml', extensao: 'svg' };
}

// ---------- Guardar, servir e limpar ----------

const NOME_ARQUIVO = /^[a-f0-9]{32}\.(png|svg)$/;

export function pastaLogos(dirDados: string): string {
  return path.join(dirDados, 'marca');
}

/** Guarda o logo conferido na pasta da empresa. O nome é o hash do conteúdo (enviar de novo não duplica). */
export function guardarLogo(dirDados: string, conteudo: Buffer, nomeEnviado: string): LogoWidget {
  const { tipo, extensao } = validarLogo(conteudo);
  const hash = crypto.createHash('sha256').update(conteudo).digest('hex').slice(0, 32);
  const arquivo = `${hash}.${extensao}`;
  const pasta = pastaLogos(dirDados);
  fs.mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, arquivo);
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, conteudo);
  const nome = path.basename(nomeEnviado || `logo.${extensao}`).replace(/[\u0000-\u001f]+/g, '').slice(0, 120) || `logo.${extensao}`;
  return { arquivo, nome, tamanho: conteudo.length, tipo, enviadoEm: agoraIso(), url: '' };
}

/** Caminho do logo no disco, só se o nome for um dos nossos e o arquivo existir. */
export function caminhoLogo(dirDados: string, arquivo: string): string | null {
  if (!NOME_ARQUIVO.test(arquivo)) return null;
  const caminho = path.join(pastaLogos(dirDados), arquivo);
  return fs.existsSync(caminho) ? caminho : null;
}

/** Apaga os logos que nem o rascunho nem a publicação usam mais. */
export function limparLogos(dirDados: string, emUso: (string | null | undefined)[]) {
  const pasta = pastaLogos(dirDados);
  if (!fs.existsSync(pasta)) return;
  const manter = new Set(emUso.filter(Boolean));
  for (const nome of fs.readdirSync(pasta)) {
    if (NOME_ARQUIVO.test(nome) && !manter.has(nome)) fs.rmSync(path.join(pasta, nome), { force: true });
  }
}

/** Endereço público do logo: preso à chave do widget da empresa. */
export function urlLogo(urlPublica: string, chavePublica: string, arquivo: string): string {
  return `${urlPublica.replace(/\/+$/, '')}/api/widget/marca/${encodeURIComponent(chavePublica)}/${arquivo}`;
}

/** A configuração com o endereço do logo preenchido (o guardado não tem endereço). */
export function comUrlDoLogo<T extends Pick<ConfigWidget, 'logo'>>(config: T, urlPublica: string, chavePublica: string): T {
  if (!config.logo) return { ...config, logo: null };
  return { ...config, logo: { ...config.logo, url: urlLogo(urlPublica, chavePublica, config.logo.arquivo) } };
}

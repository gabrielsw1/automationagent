// Markdown dos textos jurídicos: títulos (# a ####), parágrafos, listas (- item, 1. item), **negrito**
// e links [texto](endereço). Monta elementos React (o texto é sempre escapado) e nunca usa HTML cru;
// links só para http(s), mailto ou caminhos do próprio site, o resto vira texto.
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Bloco =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3 | 4; texto: string }
  | { tipo: 'p'; texto: string }
  | { tipo: 'ul' | 'ol'; itens: string[] };

const TITULO = /^(#{1,4})\s+(.*?)\s*#*$/;
const ITEM_UL = /^\s*[-*]\s+(.*)$/;
const ITEM_OL = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function blocosMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  let atual: Bloco | null = null;
  for (const linha of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const titulo = linha.match(TITULO);
    const ul = linha.match(ITEM_UL);
    const ol = ul ? null : linha.match(ITEM_OL);
    if (!linha.trim()) {
      atual = null;
    } else if (titulo) {
      blocos.push({ tipo: 'titulo', nivel: titulo[1].length as 1 | 2 | 3 | 4, texto: titulo[2] });
      atual = null;
    } else if (ul || ol) {
      const tipo = ul ? 'ul' : 'ol';
      if (!atual || atual.tipo !== tipo) {
        atual = { tipo, itens: [] };
        blocos.push(atual);
      }
      atual.itens.push((ul ?? ol)![1]);
    } else if (atual && (atual.tipo === 'ul' || atual.tipo === 'ol')) {
      // Linha seguida de um item: continuação dele.
      atual.itens[atual.itens.length - 1] += ` ${linha.trim()}`;
    } else if (atual?.tipo === 'p') {
      atual.texto += ` ${linha.trim()}`;
    } else {
      atual = { tipo: 'p', texto: linha.trim() };
      blocos.push(atual);
    }
  }
  return blocos;
}

const INLINE = /(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^\s)]+\))/g;

/** Endereço que pode virar link: http(s), mailto ou caminho do próprio site ("/termos", "#planos"). */
function destinoSeguro(href: string): 'interno' | 'externo' | null {
  if (/^\/(?!\/)/.test(href) || href.startsWith('#')) return 'interno';
  if (/^(https?:\/\/|mailto:)/i.test(href)) return 'externo';
  return null;
}

function inline(texto: string, chave: string): ReactNode[] {
  const saida: ReactNode[] = [];
  let ultimo = 0;
  let n = 0;
  for (const m of texto.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > ultimo) saida.push(texto.slice(ultimo, i));
    const k = `${chave}-${n++}`;
    const [todo, negrito, link] = m;
    if (negrito) {
      saida.push(<strong key={k}>{inline(negrito.slice(2, -2), k)}</strong>);
    } else if (link) {
      const fim = link.indexOf('](');
      const rotulo = inline(link.slice(1, fim), k);
      const href = link.slice(fim + 2, -1);
      const destino = destinoSeguro(href);
      if (destino === 'interno' && href.startsWith('/')) {
        saida.push(
          <Link key={k} to={href}>
            {rotulo}
          </Link>,
        );
      } else if (destino) {
        saida.push(
          <a key={k} href={href} {...(destino === 'externo' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {rotulo}
          </a>,
        );
      } else saida.push(<Fragment key={k}>{rotulo}</Fragment>);
    } else saida.push(todo);
    ultimo = i + todo.length;
  }
  if (ultimo < texto.length) saida.push(texto.slice(ultimo));
  return saida;
}

const CLASSE_TITULO = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export function Markdown({ texto }: { texto: string }) {
  return (
    <>
      {blocosMarkdown(texto).map((b, i) => {
        const k = `b${i}`;
        if (b.tipo === 'titulo') {
          const Titulo = `h${b.nivel}` as const;
          return (
            <Titulo key={k} className={CLASSE_TITULO[b.nivel]}>
              {inline(b.texto, k)}
            </Titulo>
          );
        }
        if (b.tipo === 'p') return <p key={k}>{inline(b.texto, k)}</p>;
        const Lista = b.tipo;
        return (
          <Lista key={k}>
            {b.itens.map((item, j) => (
              <li key={j}>{inline(item, `${k}-${j}`)}</li>
            ))}
          </Lista>
        );
      })}
    </>
  );
}

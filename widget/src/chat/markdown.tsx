// Markdown simples das mensagens: parágrafos, quebras de linha, **negrito**, *itálico*, `código`,
// listas (- item, 1. item), links [texto](https://...) e citações [1] das fontes. Sem HTML cru.
import { Fragment, type ReactNode } from 'react';

const INLINE =
  /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\((?:https?:\/\/|\/)[^\s)]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\[\d{1,2}\])|(\*[^*\s\n](?:[^*\n]*[^*\s\n])?\*)/g;

function inline(texto: string, chave: string, citacoes: boolean, abrir?: (url: string) => void): ReactNode[] {
  const saida: ReactNode[] = [];
  let ultimo = 0;
  let n = 0;
  for (const m of texto.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > ultimo) saida.push(texto.slice(ultimo, i));
    const k = `${chave}-${n++}`;
    const [todo, negrito, codigo, link, url, citacao, italico] = m;
    if (negrito) saida.push(<strong key={k}>{inline(negrito.slice(2, -2), k, citacoes, abrir)}</strong>);
    else if (codigo) saida.push(<code key={k} className="mono">{codigo.slice(1, -1)}</code>);
    else if (link) {
      const fim = link.indexOf('](');
      const rotulo = link.slice(1, fim);
      const href = link.slice(fim + 2, -1);
      saida.push(<Link key={k} href={href} abrir={abrir}>{rotulo}</Link>);
    } else if (url) saida.push(<Link key={k} href={url} abrir={abrir}>{url}</Link>);
    else if (citacao) {
      if (citacoes) {
        const num = citacao.slice(1, -1);
        saida.push(
          <sup key={k} className="cp-cita" aria-label={`fonte ${num}`}>
            {num}
          </sup>,
        );
      } else saida.push(citacao);
    } else if (italico) saida.push(<em key={k}>{italico.slice(1, -1)}</em>);
    else saida.push(todo);
    ultimo = i + todo.length;
  }
  if (ultimo < texto.length) saida.push(texto.slice(ultimo));
  return saida;
}

function Link({ href, abrir, children }: { href: string; abrir?: (url: string) => void; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (abrir) {
          e.preventDefault();
          abrir(href);
        }
      }}
    >
      {children}
    </a>
  );
}

type BlocoMd = { tipo: 'p'; linhas: string[] } | { tipo: 'ul' | 'ol'; itens: string[] };

const ITEM_UL = /^\s*[-*•]\s+(.*)$/;
const ITEM_OL = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function dividirBlocos(texto: string): BlocoMd[] {
  const blocos: BlocoMd[] = [];
  let atual: BlocoMd | null = null;
  for (const linha of texto.replace(/\r\n?/g, '\n').split('\n')) {
    if (!linha.trim()) {
      atual = null;
      continue;
    }
    const ul = linha.match(ITEM_UL);
    const ol = ul ? null : linha.match(ITEM_OL);
    if (ul || ol) {
      const tipo = ul ? 'ul' : 'ol';
      const conteudo = (ul ?? ol)![1];
      if (!atual || atual.tipo !== tipo) {
        atual = { tipo, itens: [] };
        blocos.push(atual);
      }
      atual.itens.push(conteudo);
    } else if (atual && atual.tipo !== 'p' && /^\s{2,}\S/.test(linha)) {
      // Continuação do item anterior (linha recuada).
      atual.itens[atual.itens.length - 1] += ` ${linha.trim()}`;
    } else {
      if (!atual || atual.tipo !== 'p') {
        atual = { tipo: 'p', linhas: [] };
        blocos.push(atual);
      }
      atual.linhas.push(linha);
    }
  }
  return blocos;
}

export function Markdown({
  texto,
  citacoes = false,
  abrir,
}: {
  texto: string;
  citacoes?: boolean;
  abrir?: (url: string) => void;
}) {
  const blocos = dividirBlocos(texto);
  return (
    <div className="cp-md">
      {blocos.map((b, i) => {
        const k = `b${i}`;
        if (b.tipo === 'p') {
          return (
            <p key={k}>
              {b.linhas.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l, `${k}-${j}`, citacoes, abrir)}
                </Fragment>
              ))}
            </p>
          );
        }
        const Lista = b.tipo;
        return (
          <Lista key={k}>
            {b.itens.map((item, j) => (
              <li key={j}>{inline(item, `${k}-${j}`, citacoes, abrir)}</li>
            ))}
          </Lista>
        );
      })}
    </div>
  );
}

/** Texto curto de uma linha, com negrito e código (usado em etiquetas e rótulos). */
export function MarkdownLinha({ texto }: { texto: string }) {
  return <>{inline(texto.replace(/\s*\n+\s*/g, ' '), 'l', false)}</>;
}

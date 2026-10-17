// Tabela simples com o visual do design (cabeçalho cinza, linha destacada no hover).
//
//   <Tabela
//     rotulo="Tarefas mais usadas"
//     linhas={tarefas}
//     chave={(t) => t.id}
//     colunas={[
//       { titulo: 'Tarefa', celula: (t) => <Link to={`/tarefas/${t.id}`}>{t.nome}</Link> },
//       { titulo: 'Execuções', alinhar: 'direita', celula: (t) => fmt.numero(t.execucoes) },
//     ]}
//     vazio="Nenhuma tarefa ainda."
//     aoClicarLinha={(t) => navegar(`/tarefas/${t.id}`)}
//   />
//
// A tabela rola na horizontal quando não cabe (celular). `aoClicarLinha` deixa a linha toda clicável;
// mantenha um link ou botão dentro dela para quem usa teclado.
import type { ReactNode } from 'react';

export interface ColunaTabela<T> {
  titulo: ReactNode;
  celula: (linha: T) => ReactNode;
  alinhar?: 'esquerda' | 'direita';
  /** Classe extra na célula (ex.: 'num', 'strong'). */
  classe?: string | ((linha: T) => string);
  /** Título só para leitores de tela (ex.: coluna de ações). */
  tituloOculto?: boolean;
  largura?: number | string;
}

export function Tabela<T>({
  linhas,
  colunas,
  chave,
  rotulo,
  vazio,
  aoClicarLinha,
  semBorda,
}: {
  linhas: T[];
  colunas: ColunaTabela<T>[];
  chave: (linha: T) => string;
  rotulo?: string;
  vazio?: ReactNode;
  aoClicarLinha?: (linha: T) => void;
  semBorda?: boolean;
}) {
  return (
    <div className="table-wrap" style={semBorda ? { border: 0, borderRadius: 0 } : undefined}>
      <table className="table" aria-label={rotulo}>
        <thead>
          <tr>
            {colunas.map((c, i) => (
              <th key={i} scope="col" className={c.alinhar === 'direita' ? 't-right' : undefined} style={c.largura ? { width: c.largura } : undefined}>
                {c.tituloOculto ? <span className="sr-only">{c.titulo}</span> : c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 && vazio ? (
            <tr>
              <td colSpan={colunas.length} className="muted small ca-tabela-vazia">
                {vazio}
              </td>
            </tr>
          ) : null}
          {linhas.map((l) => (
            <tr
              key={chave(l)}
              className={aoClicarLinha ? 'ca-linha-clicavel' : undefined}
              onClick={
                aoClicarLinha
                  ? (e) => {
                      if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return;
                      aoClicarLinha(l);
                    }
                  : undefined
              }
            >
              {colunas.map((c, i) => {
                const extra = typeof c.classe === 'function' ? c.classe(l) : c.classe;
                const cls = [c.alinhar === 'direita' ? 't-right' : '', extra ?? ''].filter(Boolean).join(' ');
                return (
                  <td key={i} className={cls || undefined}>
                    {c.celula(l)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

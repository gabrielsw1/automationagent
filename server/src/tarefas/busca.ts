// Busca global do console ("Buscar no console"): tarefas, execuções, pessoas, fontes de
// conhecimento, fluxos gravados e as próprias páginas do console.
import type { StatusExecucao, StatusTarefa } from '@copiloto/shared';
import { fmt, ROTULO_PERFIL, type PerfilEquipe } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';

export type TipoResultado = 'tarefa' | 'execucao' | 'pessoa' | 'conhecimento' | 'fluxo' | 'pagina';

export interface ResultadoBusca {
  tipo: TipoResultado;
  titulo: string;
  detalhe: string;
  destino: string;
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Todos os termos da busca aparecem no texto (sem acento e sem caixa). */
function casa(termos: string[], ...textos: (string | null | undefined)[]): boolean {
  const alvo = norm(textos.filter(Boolean).join(' '));
  return termos.every((t) => alvo.includes(t));
}

const STATUS_TAREFA: Record<StatusTarefa, string> = {
  ativa: 'Ativa',
  teste: 'Em teste',
  rascunho: 'Rascunho',
  inativa: 'Inativa',
};

export const STATUS_EXECUCAO: Record<StatusExecucao, string> = {
  aguardando_confirmacao: 'Aguardando confirmação',
  aguardando_aprovacao: 'Aguardando aprovação',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  falhou: 'Falhou',
  desfeita: 'Desfeita',
  cancelada: 'Cancelada',
};

const PAGINAS: { titulo: string; destino: string; palavras: string; detalhe: string }[] = [
  { titulo: 'Painel', destino: '/painel', palavras: 'painel inicio resumo indicadores gasto', detalhe: 'Números do copiloto' },
  { titulo: 'Execuções', destino: '/execucoes', palavras: 'execucoes historico falhas aprovacoes', detalhe: 'Tudo o que o copiloto fez' },
  { titulo: 'Tarefas', destino: '/tarefas', palavras: 'tarefas catalogo nova tarefa', detalhe: 'O que o copiloto sabe fazer' },
  { titulo: 'Aprender fluxo', destino: '/aprender', palavras: 'aprender fluxo gravar tela navegador', detalhe: 'Gravar uma tarefa na tela' },
  { titulo: 'Conhecimento', destino: '/conhecimento', palavras: 'conhecimento duvidas fontes perguntas ajuda', detalhe: 'De onde vêm as respostas' },
  { titulo: 'Canais e widget', destino: '/canais', palavras: 'canais widget aparencia instalacao codigo', detalhe: 'Como o copiloto aparece no sistema' },
  { titulo: 'Equipe e limites', destino: '/equipe', palavras: 'equipe limites gasto convidar seguranca auditoria perfis', detalhe: 'Pessoas, limites de gasto e segurança' },
  { titulo: 'Guia de início', destino: '/guia', palavras: 'guia inicio primeiros passos ativar', detalhe: 'Passos para colocar o copiloto no ar' },
];

export function buscarNoConsole(ctx: Contexto, consulta: string, limitePorTipo = 5): ResultadoBusca[] {
  const termos = norm(consulta).split(/\s+/).filter(Boolean);
  if (termos.length === 0 || norm(consulta).length < 2) return [];
  const { banco, catalogo } = ctx;
  const itens: ResultadoBusca[] = [];

  // Tarefas (ficha publicada ou rascunho).
  let n = 0;
  for (const t of catalogo.listar()) {
    if (n >= limitePorTipo) break;
    const def = (catalogo.publicada(t.id) ?? catalogo.rascunho(t.id))?.definicao;
    if (!def) continue;
    if (!casa(termos, def.nome, def.descricao, t.slug, def.exemplos.join(' '))) continue;
    itens.push({
      tipo: 'tarefa',
      titulo: def.nome,
      detalhe: [STATUS_TAREFA[t.status], def.descricao].filter(Boolean).join(' · '),
      destino: `/tarefas/${t.id}`,
    });
    n++;
  }

  // Execuções: código, pedido, pessoa ou tarefa. O LIKE do SQLite não ignora acentos, então
  // juntamos o que o LIKE achou com as execuções recentes e conferimos tudo sem acento aqui.
  type LinhaBusca = { id: string; pedido: string; usuario_nome: string; tarefa_nome: string; status: StatusExecucao; criado_em: string };
  const colunas = 'SELECT id, pedido, usuario_nome, tarefa_nome, status, criado_em FROM execucoes';
  const like = `%${consulta.trim().replace(/[%_]/g, '')}%`;
  const primeiro = `%${termos[0]}%`;
  const porLike = banco.todos<LinhaBusca>(
    `${colunas} WHERE id LIKE ? OR pedido LIKE ? OR usuario_nome LIKE ? OR tarefa_nome LIKE ?
        OR id LIKE ? OR pedido LIKE ? OR usuario_nome LIKE ? OR tarefa_nome LIKE ?
     ORDER BY criado_em DESC LIMIT 200`,
    like,
    like,
    like,
    like,
    primeiro,
    primeiro,
    primeiro,
    primeiro,
  );
  const recentes = banco.todos<LinhaBusca>(`${colunas} ORDER BY criado_em DESC LIMIT 1000`);
  const vistas = new Set<string>();
  const execs = [...porLike, ...recentes]
    .filter((x) => !vistas.has(x.id) && vistas.add(x.id))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  for (const e of execs.filter((x) => casa(termos, x.id, x.pedido, x.usuario_nome, x.tarefa_nome)).slice(0, limitePorTipo)) {
    itens.push({
      tipo: 'execucao',
      titulo: `${e.id} · ${e.tarefa_nome}`,
      detalhe: `${e.usuario_nome} · ${STATUS_EXECUCAO[e.status] ?? e.status} · ${fmt.quando(e.criado_em)}`,
      destino: `/execucoes/${encodeURIComponent(e.id)}`,
    });
  }

  // Pessoas da equipe do console.
  const equipe = banco.todos<{ nome: string | null; email: string; perfil: PerfilEquipe; status: string }>(
    'SELECT nome, email, perfil, status FROM equipe ORDER BY nome',
  );
  for (const p of equipe.filter((x) => casa(termos, x.nome, x.email)).slice(0, limitePorTipo)) {
    itens.push({
      tipo: 'pessoa',
      titulo: p.nome ?? p.email,
      detalhe: `Equipe · ${ROTULO_PERFIL[p.perfil] ?? p.perfil}${p.status === 'convidado' ? ' · convite pendente' : ''} · ${p.email}`,
      destino: '/equipe',
    });
  }

  // Pessoas do sistema que já pediram algo ao copiloto.
  const usuarios = banco.todos<{ usuario_nome: string; n: number }>(
    'SELECT usuario_nome, COUNT(*) AS n FROM execucoes GROUP BY usuario_nome ORDER BY n DESC LIMIT 2000',
  );
  for (const u of usuarios.filter((x) => casa(termos, x.usuario_nome)).slice(0, limitePorTipo)) {
    itens.push({
      tipo: 'pessoa',
      titulo: u.usuario_nome,
      detalhe: `Usuário do ${ctx.adaptador.nome} · ${u.n === 1 ? '1 execução' : `${fmt.numero(u.n)} execuções`}`,
      destino: `/execucoes?busca=${encodeURIComponent(u.usuario_nome)}`,
    });
  }

  // Fontes de conhecimento.
  const fontes = banco.todos<{ nome: string; origem: string; status: string }>(
    'SELECT nome, origem, status FROM conhecimento_fontes ORDER BY criado_em DESC',
  );
  for (const f of fontes.filter((x) => casa(termos, x.nome, x.origem)).slice(0, limitePorTipo)) {
    itens.push({
      tipo: 'conhecimento',
      titulo: f.nome,
      detalhe: `Conhecimento · ${f.origem}`,
      destino: '/conhecimento',
    });
  }

  // Fluxos gravados.
  const fluxos = banco.todos<{ id: string; nome: string; status: string }>('SELECT id, nome, status FROM fluxos ORDER BY salvo_em DESC');
  for (const f of fluxos.filter((x) => casa(termos, x.nome)).slice(0, limitePorTipo)) {
    itens.push({
      tipo: 'fluxo',
      titulo: f.nome,
      detalhe: `Fluxo gravado · ${f.status === 'publicado' ? 'publicado' : 'rascunho'}`,
      destino: `/aprender/${encodeURIComponent(f.id)}`,
    });
  }

  // Páginas do console.
  for (const p of PAGINAS.filter((x) => casa(termos, x.titulo, x.palavras)).slice(0, 3)) {
    itens.push({ tipo: 'pagina', titulo: p.titulo, detalhe: p.detalhe, destino: p.destino });
  }
  return itens;
}

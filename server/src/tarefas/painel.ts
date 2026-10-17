// Painel (C1): números do período, execuções por dia, o que precisa de atenção, tarefas mais
// usadas, gasto do mês e pedidos por canal.
import type { ItemAtencao, Painel, Periodo } from '@copiloto/shared';
import { fmt } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import { json } from '../db/banco.ts';
import { inicioDoDia } from '../servicos/gastos.ts';
import { definicaoAtual, pedidosSemTarefa, taxaSucesso } from './lista.ts';
import { diaSp, janela } from './tempo.ts';

interface LinhaExec {
  id: string;
  tarefa_id: string | null;
  tarefa_nome: string;
  caminho: string | null;
  status: string;
  canal: string;
  criado_em: string;
  duracao_ms: number | null;
  custo_modelo: number | null;
  custo_navegador: number | null;
}

/** Execuções que de fato rodaram (ou estão rodando): fora as que esperam o "confirmo" e as canceladas. */
const RODARAM = `status NOT IN ('aguardando_confirmacao', 'cancelada')`;
const OK = new Set(['concluida', 'desfeita']);

export const ROTULO_CANAL: Record<string, string> = {
  widget: 'Widget no sistema',
  teste: 'Teste no console',
};

function media(valores: number[]): number | null {
  return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
}

function arred(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

function minusculaInicial(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function diagnosticoTexto(bruto: string | null, erro: string | null): string | null {
  const d = json<{ titulo?: string; detalhe?: string } | string | null>(bruto, bruto);
  if (d && typeof d === 'object') return [d.titulo, d.detalhe].filter(Boolean).join(' ') || null;
  if (typeof d === 'string' && d.trim()) return d.trim();
  return erro?.trim() || null;
}

function itensAtencao(ctx: Contexto, agora: Date, desdeSemTarefa: Date): ItemAtencao[] {
  const { banco } = ctx;
  const itens: ItemAtencao[] = [];

  // Falhas de hoje, por tarefa.
  const falhas = banco.todos<{
    tarefa_id: string | null;
    tarefa_nome: string;
    n: number;
    ultima: string;
    pessoas: number;
  }>(
    `SELECT tarefa_id, tarefa_nome, COUNT(*) AS n, MAX(criado_em) AS ultima, COUNT(DISTINCT usuario_id) AS pessoas
     FROM execucoes WHERE status = 'falhou' AND criado_em >= ?
     GROUP BY tarefa_id, tarefa_nome ORDER BY n DESC, ultima DESC LIMIT 2`,
    inicioDoDia(agora).toISOString(),
  );
  for (const f of falhas) {
    const ultima = banco.um<{ diagnostico: string | null; erro: string | null }>(
      `SELECT diagnostico, erro FROM execucoes WHERE status = 'falhou' AND criado_em >= ? AND tarefa_nome = ?
       ORDER BY criado_em DESC LIMIT 1`,
      inicioDoDia(agora).toISOString(),
      f.tarefa_nome,
    );
    const motivo = diagnosticoTexto(ultima?.diagnostico ?? null, ultima?.erro ?? null);
    const filtro = f.tarefa_id ? `&tarefa=${encodeURIComponent(f.tarefa_id)}` : '';
    itens.push({
      tipo: 'falhas',
      titulo:
        f.n === 1
          ? `1 execução falhou em “${f.tarefa_nome}”`
          : `${fmt.numero(f.n)} execuções falharam em “${f.tarefa_nome}”`,
      detalhe:
        motivo ??
        (f.pessoas === 1
          ? 'Abra a execução para ver o que aconteceu e o que fazer.'
          : `${f.pessoas} pessoas foram afetadas. Abra as execuções para ver o que aconteceu em cada uma.`),
      acao: { rotulo: 'Revisar', destino: `/execucoes?aba=atencao&periodo=hoje${filtro}` },
      quantidade: f.n,
    });
  }

  // Pedidos sem tarefa (os dois temas mais pedidos no período).
  for (const p of pedidosSemTarefa(banco, desdeSemTarefa).slice(0, 2)) {
    itens.push({
      tipo: 'sem_tarefa',
      titulo:
        p.quantidade === 1
          ? `1 pedido sobre “${p.tema}” sem tarefa`
          : `${fmt.numero(p.quantidade)} pedidos sobre “${p.tema}” sem tarefa`,
      detalhe: 'O copiloto explicou que ainda não faz isso e ofereceu falar com uma pessoa.',
      acao: { rotulo: 'Criar tarefa', destino: `/tarefas?criar=${encodeURIComponent(p.tema)}` },
      quantidade: p.quantidade,
    });
  }

  // Aprovações esperando decisão.
  const aprov = banco.todos<{ solicitante_nome: string; criado_em: string; tarefa_nome: string; pedido: string }>(
    `SELECT a.solicitante_nome, a.criado_em, e.tarefa_nome, e.pedido FROM aprovacoes a
     JOIN execucoes e ON e.id = a.execucao_id WHERE a.estado = 'enviada' ORDER BY a.criado_em`,
  );
  if (aprov.length > 0) {
    const a = aprov[0];
    const q = fmt.haQuanto(a.criado_em, agora);
    const espera = q === 'agora' ? 'há instantes' : q;
    itens.push({
      tipo: 'aprovacao',
      titulo:
        aprov.length === 1
          ? `1 aprovação pendente: ${minusculaInicial(a.tarefa_nome)}`
          : `${aprov.length} aprovações pendentes`,
      detalhe:
        aprov.length === 1
          ? `${a.solicitante_nome} pediu “${a.pedido}” e não tem permissão para isso. Aguarda aprovação ${espera}.`
          : `A mais antiga é de ${a.solicitante_nome} e aguarda ${espera}.`,
      acao: { rotulo: 'Ver', destino: '/execucoes?aba=aprovacao' },
      quantidade: aprov.length,
    });
  }

  // Conversas passadas para uma pessoa e ainda sem resposta.
  const transferidas = banco.um<{ n: number }>(
    `SELECT COUNT(*) AS n FROM execucoes
     WHERE transferida_para IS NOT NULL AND status NOT IN ('concluida', 'cancelada', 'desfeita')`,
  )!.n;
  if (transferidas > 0) {
    itens.push({
      tipo: 'transferidas',
      titulo:
        transferidas === 1 ? '1 pedido espera uma pessoa do suporte' : `${transferidas} pedidos esperam uma pessoa do suporte`,
      detalhe: 'O copiloto passou estes casos para a equipe. Responda ou conclua pelo detalhe da execução.',
      acao: { rotulo: 'Atender', destino: '/execucoes?aba=atencao' },
      quantidade: transferidas,
    });
  }

  // Fontes de conhecimento com erro.
  const fontes = banco.todos<{ nome: string; erro: string | null; como_resolver: string | null }>(
    "SELECT nome, erro, como_resolver FROM conhecimento_fontes WHERE status = 'erro' ORDER BY criado_em",
  );
  if (fontes.length > 0) {
    const f = fontes[0];
    itens.push({
      tipo: 'fonte_erro',
      titulo: fontes.length === 1 ? `A fonte “${f.nome}” não foi lida` : `${fontes.length} fontes de conhecimento com erro`,
      detalhe:
        [f.erro, f.como_resolver].filter(Boolean).join(' ') ||
        'O copiloto não consegue usar esta fonte para responder dúvidas até o problema ser resolvido.',
      acao: { rotulo: 'Resolver', destino: '/conhecimento' },
      quantidade: fontes.length,
    });
  }
  return itens;
}

export function montarPainel(ctx: Contexto, periodo: Periodo, agora = new Date()): Painel {
  const { banco, gastos, config } = ctx;
  const j = janela(periodo, agora);

  const linhas = banco.todos<LinhaExec>(
    `SELECT id, tarefa_id, tarefa_nome, caminho, status, canal, criado_em, duracao_ms, custo_modelo, custo_navegador
     FROM execucoes WHERE criado_em >= ? AND criado_em <= ? AND ${RODARAM}`,
    j.inicio.toISOString(),
    j.fim.toISOString(),
  );
  const anteriores = banco.um<{ n: number }>(
    `SELECT COUNT(*) AS n FROM execucoes WHERE criado_em >= ? AND criado_em < ? AND ${RODARAM}`,
    j.anteriorInicio.toISOString(),
    j.anteriorFim.toISOString(),
  )!.n;

  // Custo do Claude por execução (quando a execução não tem custo próprio gravado).
  const usoPorExec = new Map(
    banco
      .todos<{ execucao_id: string; usd: number }>(
        `SELECT execucao_id, SUM(custo_usd) AS usd FROM uso_llm
         WHERE execucao_id IS NOT NULL AND criado_em >= ? GROUP BY execucao_id`,
        j.inicio.toISOString(),
      )
      .map((l) => [l.execucao_id, l.usd * config.cotacaoDolar]),
  );

  const porDia = new Map(j.dias.map((d) => [d, { dia: d, concluidas: 0, falhas: 0 }]));
  const porTarefa = new Map<
    string,
    { tarefaId: string; nome: string; caminhos: Map<string, number>; n: number; ok: number; falhas: number; custos: number[] }
  >();
  const porCanal = new Map<string, number>([
    ['widget', 0],
    ['teste', 0],
  ]);
  const duracaoApi: number[] = [];
  const duracaoNav: number[] = [];
  let ok = 0;
  let falhas = 0;

  for (const l of linhas) {
    const dia = porDia.get(diaSp(l.criado_em));
    const concluiu = OK.has(l.status);
    if (concluiu) ok++;
    if (l.status === 'falhou') falhas++;
    if (dia) {
      if (concluiu) dia.concluidas++;
      if (l.status === 'falhou') dia.falhas++;
    }
    if (concluiu && l.duracao_ms) (l.caminho === 'navegador' ? duracaoNav : duracaoApi).push(l.duracao_ms);
    porCanal.set(l.canal, (porCanal.get(l.canal) ?? 0) + 1);
    if (l.tarefa_id) {
      const t = porTarefa.get(l.tarefa_id) ?? {
        tarefaId: l.tarefa_id,
        nome: l.tarefa_nome,
        caminhos: new Map<string, number>(),
        n: 0,
        ok: 0,
        falhas: 0,
        custos: [] as number[],
      };
      t.n++;
      if (concluiu) t.ok++;
      if (l.status === 'falhou') t.falhas++;
      if (l.caminho) t.caminhos.set(l.caminho, (t.caminhos.get(l.caminho) ?? 0) + 1);
      const custoModelo = l.custo_modelo ?? usoPorExec.get(l.id) ?? null;
      if (custoModelo !== null || l.custo_navegador !== null) t.custos.push((custoModelo ?? 0) + (l.custo_navegador ?? 0));
      porTarefa.set(l.tarefa_id, t);
    }
  }

  const maisUsadas = [...porTarefa.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((t) => {
      const tarefa = ctx.catalogo.obter(t.tarefaId);
      const def = tarefa ? definicaoAtual(ctx, t.tarefaId) : null;
      const caminhoMaisUsado = [...t.caminhos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const custo = media(t.custos);
      return {
        tarefaId: t.tarefaId,
        nome: def?.nome ?? t.nome,
        caminho: (def?.caminho ?? caminhoMaisUsado ?? 'api') as 'api' | 'navegador',
        status: tarefa?.status ?? ('inativa' as const),
        execucoes: t.n,
        sucesso: taxaSucesso(t.ok, t.falhas),
        custoMedio: custo === null ? null : arred(custo),
      };
    });

  const executadas = linhas.length;
  const limites = gastos.limites(agora);
  const tempoApi = media(duracaoApi);
  const tempoNav = media(duracaoNav);
  const temExemplo = !!banco.um('SELECT 1 FROM execucoes WHERE exemplo = 1 LIMIT 1');

  return {
    periodo,
    inicio: j.inicio.toISOString(),
    fim: j.fim.toISOString(),
    atualizadoEm: agora.toISOString(),
    temDadosDeExemplo: temExemplo,
    executadas,
    variacao: anteriores > 0 ? arred((executadas - anteriores) / anteriores, 4) : null,
    taxaSucesso: taxaSucesso(ok, falhas),
    falhas,
    tempoMedioApiS: tempoApi === null ? null : arred(tempoApi / 1000, 1),
    tempoMedioNavegadorS: tempoNav === null ? null : arred(tempoNav / 1000, 1),
    gastoMes: limites.usoMes,
    limiteMes: limites.mensal,
    previsaoMes: limites.previsaoMes,
    porDia: [...porDia.values()],
    atencao: itensAtencao(ctx, agora, j.inicio),
    maisUsadas,
    porCanal: [...porCanal.entries()].map(([canal, total]) => ({ canal, rotulo: ROTULO_CANAL[canal] ?? canal, total })),
  };
}

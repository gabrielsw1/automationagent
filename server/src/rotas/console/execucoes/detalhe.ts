// Detalhe de uma execução (C6): linha do tempo, prints, dados do pedido, conversa, auditoria e custos.
import {
  fmt,
  type Bloco,
  type EventoLinhaTempo,
  type ExecucaoDetalhe,
  type MensagemWidget,
  type TarefaDefinicao,
  type UsuarioSistema,
} from '@copiloto/shared';
import type { Contexto } from '../../../contexto.ts';
import { json } from '../../../db/banco.ts';
import {
  custoModeloDe,
  custoModeloPorExecucao,
  linhaDe,
  nomesEquipe,
  STATUS_FINAIS,
  type LinhaExecucao,
} from './consulta.ts';

type ItemDado = { rotulo: string; valor: string };

interface LinhaEvento {
  id: string;
  ts: string;
  tipo: string;
  titulo: string;
  detalhe: string | null;
  estado: string;
  dados: string | null;
  print_id: string | null;
  fim: string | null;
  candidato?: string | null;
}

interface LinhaPrint {
  id: string;
  legenda: string | null;
  destaque: string | null;
  mascarado: number;
  criado_em: string;
  apagar_em: string | null;
}

const TIPOS_EVENTO: EventoLinhaTempo['tipo'][] = [
  'pedido',
  'confirmacao',
  'login',
  'passo',
  'falha',
  'recuperacao',
  'transferencia',
  'conclusao',
  'aviso',
  'desfeito',
  'api',
];
const ESTADOS_EVENTO: EventoLinhaTempo['estado'][] = ['ok', 'falhou', 'info', 'aviso'];

// ---------- Usuários do sistema (para perfis e campos do tipo pessoa), com cache curto ----------

// Um cache por empresa (contexto): com várias empresas alternando, um cache só se apagaria a cada pedido.
const cacheUsuarios = new WeakMap<Contexto, { em: number; lista: UsuarioSistema[] }>();

async function usuariosDoSistema(ctx: Contexto): Promise<UsuarioSistema[]> {
  const cache = cacheUsuarios.get(ctx);
  if (cache && Date.now() - cache.em < 60_000) return cache.lista;
  try {
    const lista = await Promise.race([
      ctx.adaptador.listarUsuarios(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tempo')), 1500)),
    ]);
    cacheUsuarios.set(ctx, { em: Date.now(), lista });
    return lista;
  } catch {
    return cacheUsuarios.get(ctx)?.lista ?? [];
  }
}

// ---------- Ajudantes ----------

function texto(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v);
  if (typeof v === 'object' && v && 'nome' in v && typeof (v as { nome: unknown }).nome === 'string') {
    return (v as { nome: string }).nome;
  }
  return JSON.stringify(v);
}

function humanizar(chave: string): string {
  const s = chave.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listaRotuloValor(v: unknown): ItemDado[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const itens = v
    .filter((x): x is { rotulo: unknown; valor: unknown } => !!x && typeof x === 'object' && 'rotulo' in x)
    .map((x) => ({ rotulo: String(x.rotulo), valor: texto(x.valor) ?? '—' }));
  return itens;
}

function objetoParaLista(o: Record<string, unknown>, ignorar: string[] = []): ItemDado[] {
  return Object.entries(o)
    .filter(([k, v]) => !ignorar.includes(k) && v !== undefined && v !== null && typeof v !== 'object')
    .map(([k, v]) => ({ rotulo: humanizar(k), valor: texto(v) ?? '—' }));
}

function normalizarConfianca(c: number): number {
  return c > 1 ? c / 100 : c;
}

/** `dados` do evento: lista de {rotulo, valor}, ou objeto com dados/campos/itens e candidato. */
function lerDadosEvento(bruto: string | null): Pick<EventoLinhaTempo, 'dados' | 'candidato'> {
  const v = json<unknown>(bruto, null);
  if (v === null) return {};
  const direto = listaRotuloValor(v);
  if (direto) return direto.length ? { dados: direto } : {};
  if (typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const r: Pick<EventoLinhaTempo, 'dados' | 'candidato'> = {};
  const lista = listaRotuloValor(o.dados ?? o.campos ?? o.itens);
  if (lista?.length) r.dados = lista;
  const c = (o.candidato ?? (typeof o.confianca === 'number' ? o : null)) as Record<string, unknown> | null;
  if (c && typeof c === 'object' && typeof c.confianca === 'number') {
    r.candidato = { texto: String(c.texto ?? c.rotulo ?? ''), confianca: normalizarConfianca(c.confianca) };
  }
  if (!r.dados && !lista) {
    const resto = objetoParaLista(o, ['candidato', 'confianca', 'texto', 'rotulo', 'destaque']);
    if (resto.length) r.dados = resto;
  }
  return r;
}

/** Coluna `candidato` do evento: JSON { texto, confianca } (confiança de 0 a 1 ou de 0 a 100). */
function lerCandidato(bruto: string | null): EventoLinhaTempo['candidato'] | undefined {
  const c = json<Record<string, unknown> | null>(bruto, null);
  if (!c || typeof c !== 'object' || typeof c.confianca !== 'number') return undefined;
  return { texto: String(c.texto ?? ''), confianca: normalizarConfianca(c.confianca) };
}

function lerDestaque(bruto: string | null): { x: number; y: number; w: number; h: number } | undefined {
  const d = json<Record<string, unknown> | null>(bruto, null);
  if (!d) return undefined;
  const n = (k: string, alt: string) => (typeof d[k] === 'number' ? (d[k] as number) : typeof d[alt] === 'number' ? (d[alt] as number) : NaN);
  const r = { x: n('x', 'left'), y: n('y', 'top'), w: n('w', 'width'), h: n('h', 'height') };
  return Object.values(r).every(Number.isFinite) ? r : undefined;
}

function horaCompleta(iso: string): string {
  return `${fmt.data(iso)}, ${fmt.horaSegundos(iso)}`;
}

function mascararIp(ip: string): string {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) return `${v4[1]}.${v4[2]}.•••.•••`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:••••`;
  return '•••';
}

/** Dados do pedido: valores confirmados, com os rótulos da ficha da tarefa. */
function dadosDoPedido(bruto: string, def: TarefaDefinicao | null, usuarios: UsuarioSistema[]): ItemDado[] {
  const v = json<unknown>(bruto, {});
  const lista = listaRotuloValor(v);
  if (lista) return lista;
  if (!v || typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  const itens: ItemDado[] = [];
  const usados = new Set<string>();
  for (const campo of def?.campos ?? []) {
    if (!(campo.chave in o)) continue;
    usados.add(campo.chave);
    let valor = texto(o[campo.chave]);
    if (valor === null) continue;
    if (campo.tipo === 'pessoa') valor = usuarios.find((u) => u.id === valor)?.nome ?? valor;
    else valor = fmt.valorCampo(campo, valor) || valor;
    itens.push({ rotulo: campo.rotulo, valor });
  }
  for (const [k, bruto2] of Object.entries(o)) {
    if (usados.has(k) || k.startsWith('_')) continue;
    const valor = texto(bruto2);
    if (valor !== null) itens.push({ rotulo: humanizar(k), valor });
  }
  return itens;
}

// ---------- Conversa ----------

function semMarkdown(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
}

function resumoBloco(b: Bloco): string | null {
  switch (b.tipo) {
    case 'confirmacao':
      return `Cartão de confirmação exibido: ${b.titulo}`;
    case 'progresso':
      return null;
    case 'recibo':
      return `Recibo: ${b.titulo}. ${b.resumo}${b.desfeito ? ' (desfeito)' : ''}`;
    case 'conflito':
      return `Avisou que o registro já existe: ${b.existente.titulo}`;
    case 'erro':
      return [b.titulo, b.detalhe].filter(Boolean).join(' ');
    case 'aprovacao':
      return {
        rascunho: 'Ofereceu pedir aprovação',
        enviada: 'Pedido de aprovação enviado',
        aprovada: 'Pedido de aprovação aprovado',
        recusada: `Pedido de aprovação recusado${b.motivoRecusa ? `: ${b.motivoRecusa}` : ''}`,
        cancelada: 'Pedido de aprovação cancelado',
      }[b.estado];
    case 'resumo_humano':
      return `Resumo enviado para ${b.para}`;
    case 'coleta':
      return null;
    default:
      return null;
  }
}

function referencia(m: MensagemWidget, execucaoId: string): boolean {
  return m.blocos.some((b) => 'execucaoId' in b && b.execucaoId === execucaoId);
}

function conversaDaExecucao(ctx: Contexto, r: LinhaExecucao): ExecucaoDetalhe['conversa'] {
  if (!r.conversa_id) return [];
  const todas = ctx.conversas.mensagens(r.conversa_id);
  if (todas.length === 0) return [];
  const proxima = ctx.banco.um<{ criado_em: string }>(
    'SELECT criado_em FROM execucoes WHERE conversa_id = ? AND criado_em > ? AND id <> ? ORDER BY criado_em LIMIT 1',
    r.conversa_id,
    r.criado_em,
    r.id,
  )?.criado_em;
  // Começa na mensagem em que a pessoa fez o pedido (ou na última dela antes da execução).
  let inicio = -1;
  for (let i = todas.length - 1; i >= 0; i--) {
    const m = todas[i];
    if (m.autor === 'usuario' && m.criadoEm <= r.criado_em && (m.texto ?? '').trim() === r.pedido.trim()) {
      inicio = i;
      break;
    }
  }
  if (inicio < 0) {
    for (let i = todas.length - 1; i >= 0; i--) {
      if (todas[i].autor === 'usuario' && todas[i].criadoEm <= r.criado_em) {
        inicio = i;
        break;
      }
    }
  }
  const fatia = todas.filter(
    (m, i) => (i >= Math.max(0, inicio) && (!proxima || m.criadoEm < proxima)) || referencia(m, r.id),
  );
  const itens: ExecucaoDetalhe['conversa'] = [];
  for (const m of fatia) {
    const partes = [m.texto ? semMarkdown(m.texto) : null, ...m.blocos.map(resumoBloco)].filter(
      (x): x is string => !!x && x.trim() !== '',
    );
    if (partes.length > 0) {
      itens.push({
        id: m.id,
        autor:
          m.autor === 'usuario'
            ? r.usuario_nome
            : m.autor === 'copiloto'
              ? 'Copiloto'
              : m.autor === 'pessoa'
                ? (m.autorNome ?? 'Suporte')
                : 'Sistema',
        autorTipo: m.autor,
        texto: partes.join('\n'),
        ts: m.criadoEm,
      });
    }
    for (const b of m.blocos) {
      if (b.tipo === 'confirmacao' && b.execucaoId === r.id && b.estado === 'confirmado' && b.confirmadoEm) {
        itens.push({
          id: `${m.id}-confirmado`,
          autor: r.usuario_nome,
          autorTipo: 'usuario',
          texto: 'Tocou em “Confirmar e executar”',
          ts: b.confirmadoEm,
        });
      }
    }
  }
  itens.sort((a, b) => a.ts.localeCompare(b.ts));
  return itens.slice(-80);
}

// ---------- Diagnóstico ----------

function diagnosticoPadrao(
  r: LinhaExecucao,
  linha: ReturnType<typeof linhaDe>,
  aprovador: string | null,
): ExecucaoDetalhe['diagnostico'] {
  const via = linha.caminho === 'navegador' ? 'pelo navegador' : linha.caminho === 'api' ? 'pela API' : '';
  const erro = r.erro ? (json<{ mensagem?: string } | string>(r.erro, r.erro) as { mensagem?: string } | string) : null;
  const textoErro = typeof erro === 'string' ? erro : (erro?.mensagem ?? null);
  if (linha.transferidaPara && !STATUS_FINAIS.includes(r.status)) {
    return {
      titulo: `O pedido está com ${linha.transferidaPara} e ainda não foi concluído.`,
      detalhe: textoErro
        ? `O copiloto passou o caso para uma pessoa: ${textoErro}`
        : 'O copiloto passou o caso para uma pessoa com os dados confirmados. Marque como concluída quando resolver.',
      tom: 'aviso',
    };
  }
  switch (r.status) {
    case 'concluida':
      return {
        titulo: 'Concluída sem erros.',
        detalhe: [
          via && linha.duracaoMs !== null ? `Feito ${via} em ${fmt.duracao(linha.duracaoMs)}.` : null,
          r.concluido_em ? `Terminou às ${fmt.horaSegundos(r.concluido_em)}.` : null,
        ]
          .filter(Boolean)
          .join(' '),
        tom: 'sucesso',
      };
    case 'falhou':
      return {
        titulo: 'Não foi possível concluir este pedido.',
        detalhe: textoErro ?? 'Veja na linha do tempo em que passo a execução parou.',
        tom: 'erro',
      };
    case 'em_andamento':
      return { titulo: 'O copiloto está executando este pedido agora.', detalhe: 'A linha do tempo atualiza sozinha.', tom: 'info' };
    case 'aguardando_confirmacao':
      return {
        titulo: `Esperando ${fmt.primeiroNome(r.usuario_nome)} conferir os dados e confirmar.`,
        detalhe: 'Nada é gravado antes do “Confirmar e executar”.',
        tom: 'info',
      };
    case 'aguardando_aprovacao':
      return {
        titulo: aprovador ? `Esperando a aprovação de ${aprovador}.` : 'Esperando aprovação.',
        detalhe: `${fmt.primeiroNome(r.usuario_nome)} não tem permissão para esta tarefa e pediu aprovação. Nada foi gravado.`,
        tom: 'aviso',
      };
    case 'desfeita':
      return { titulo: 'Esta execução foi desfeita.', detalhe: 'O que tinha sido gravado foi revertido no sistema.', tom: 'info' };
    case 'cancelada':
      return { titulo: 'Cancelada antes de gravar.', detalhe: 'Nada foi gravado no sistema.', tom: 'info' };
    default:
      return null;
  }
}

function lerDiagnostico(bruto: string | null): ExecucaoDetalhe['diagnostico'] {
  const d = json<Record<string, unknown> | null>(bruto, null);
  if (!d || typeof d.titulo !== 'string') return null;
  const tom = ['erro', 'aviso', 'sucesso', 'info'].includes(d.tom as string) ? (d.tom as 'erro') : 'info';
  return { titulo: d.titulo, detalhe: typeof d.detalhe === 'string' ? d.detalhe : '', tom };
}

// ---------- Montagem ----------

export function definicaoDaExecucao(ctx: Contexto, r: Pick<LinhaExecucao, 'tarefa_id' | 'tarefa_versao'>): TarefaDefinicao | null {
  if (!r.tarefa_id) return null;
  const v =
    (r.tarefa_versao ? ctx.catalogo.versao(r.tarefa_id, r.tarefa_versao) : null) ?? ctx.catalogo.publicada(r.tarefa_id);
  return v?.definicao ?? null;
}

export function aprovacaoDaExecucao(ctx: Contexto, execucaoId: string): ExecucaoDetalhe['aprovacao'] {
  const a = ctx.banco.um<{
    id: string;
    estado: string;
    aprovador_nome: string | null;
    perfil_necessario: string | null;
    decidido_por: string | null;
  }>(
    `SELECT id, estado, aprovador_nome, perfil_necessario, decidido_por FROM aprovacoes WHERE execucao_id = ?
     AND estado <> 'rascunho' ORDER BY criado_em DESC LIMIT 1`,
    execucaoId,
  );
  if (!a) return null;
  const estado = (['enviada', 'aprovada', 'recusada', 'cancelada'].includes(a.estado) ? a.estado : 'enviada') as
    'enviada';
  // Depois da decisão, mostra quem decidiu de fato (pode ser outra pessoa que não a indicada).
  const decidiu = estado !== 'enviada' ? a.decidido_por : null;
  return {
    id: a.id,
    estado,
    aprovador: decidiu ?? a.aprovador_nome ?? (a.perfil_necessario ? `perfil ${a.perfil_necessario}` : null),
  };
}

/** O que dá para fazer com a execução agora (sem olhar o perfil de quem vê). */
export function acoesPossiveis(
  r: LinhaExecucao,
  def: TarefaDefinicao | null,
  estadoConversa: ExecucaoDetalhe['estadoConversa'],
): ExecucaoDetalhe['acoes'] {
  const transferidaAberta = !!r.transferida_para && !STATUS_FINAIS.includes(r.status);
  const fluxoId = def?.fluxoId ?? null;
  return {
    reexecutar: !!r.tarefa_id && (r.status === 'falhou' || r.status === 'cancelada'),
    concluir: r.status === 'falhou' || transferidaAberta,
    avisar: !!r.conversa_id,
    atualizarFluxo: !!fluxoId && r.caminho === 'navegador' && (r.status === 'falhou' || transferidaAberta),
    desfazer: r.status === 'concluida' && (!!r.desfazer_ate || !!def?.api?.desfazer),
    responder: !!r.conversa_id && estadoConversa !== 'copiloto',
  };
}

export function estadoDaConversa(ctx: Contexto, conversaId: string | null): ExecucaoDetalhe['estadoConversa'] {
  if (!conversaId) return 'copiloto';
  const c = ctx.conversas.buscar(conversaId);
  const modo = c?.estado.modo ?? 'copiloto';
  return modo === 'aguardando_pessoa' || modo === 'pessoa' ? modo : 'copiloto';
}

export function buscarExecucao(ctx: Contexto, id: string): LinhaExecucao | undefined {
  return ctx.banco.um<LinhaExecucao>('SELECT * FROM execucoes WHERE id = ?', id);
}

export async function montarDetalhe(ctx: Contexto, r: LinhaExecucao, agora = new Date()): Promise<ExecucaoDetalhe> {
  const { banco, configuracoes } = ctx;
  const membros = nomesEquipe(banco);
  const uso = custoModeloPorExecucao(ctx, [r.id]);
  const linha = linhaDe(r, agora, membros, uso);
  const def = definicaoDaExecucao(ctx, r);
  const usuarios = await usuariosDoSistema(ctx);

  // Prints na ordem da linha do tempo, para "Print 1 de 3".
  const eventos = banco.todos<LinhaEvento>(
    'SELECT * FROM execucao_eventos WHERE execucao_id = ? ORDER BY ts, rowid',
    r.id,
  );
  const idsPrints = eventos.map((e) => e.print_id).filter((x): x is string => !!x);
  const prints = new Map<string, LinhaPrint>();
  if (idsPrints.length) {
    for (const p of banco.todos<LinhaPrint>(
      `SELECT id, legenda, destaque, mascarado, criado_em, apagar_em FROM prints WHERE id IN (${idsPrints.map(() => '?').join(', ')})`,
      ...idsPrints,
    )) {
      prints.set(p.id, p);
    }
  }
  const comPrint = idsPrints.filter((id) => prints.has(id));
  const linhaTempo: EventoLinhaTempo[] = eventos.map((e) => {
    const ev: EventoLinhaTempo = {
      id: e.id,
      ts: e.ts,
      tipo: TIPOS_EVENTO.includes(e.tipo as EventoLinhaTempo['tipo']) ? (e.tipo as EventoLinhaTempo['tipo']) : 'passo',
      titulo: e.titulo,
      estado: ESTADOS_EVENTO.includes(e.estado as EventoLinhaTempo['estado'])
        ? (e.estado as EventoLinhaTempo['estado'])
        : 'info',
      ...lerDadosEvento(e.dados),
    };
    const candidato = lerCandidato(e.candidato ?? null);
    if (candidato) ev.candidato = candidato;
    if (e.detalhe) ev.detalhe = e.detalhe;
    if (e.fim) ev.fim = e.fim;
    const p = e.print_id ? prints.get(e.print_id) : undefined;
    if (p) {
      const n = comPrint.indexOf(p.id) + 1;
      const legenda = p.legenda ?? (p.mascarado ? 'dados mascarados' : '');
      ev.print = {
        id: p.id,
        legenda: `Print ${n} de ${comPrint.length}${legenda ? ` · ${legenda}` : ''}`,
        url: `/api/console/prints/${encodeURIComponent(p.id)}`,
      };
      const destaque = lerDestaque(p.destaque);
      if (destaque) ev.print.destaque = destaque;
    }
    return ev;
  });

  const estadoConversa = estadoDaConversa(ctx, r.conversa_id);
  const aprovacao = aprovacaoDaExecucao(ctx, r.id);

  // Auditoria da execução.
  const solicitante = usuarios.find((u) => u.id === r.usuario_id);
  const primeiro = fmt.primeiroNome(r.usuario_nome);
  const auditoria: ItemDado[] = [];
  if (r.confirmado_por || r.confirmado_em) {
    const quem = r.confirmado_por
      ? r.confirmado_por === r.usuario_id
        ? r.usuario_nome
        : (usuarios.find((u) => u.id === r.confirmado_por)?.nome ?? membros.get(r.confirmado_por) ?? r.confirmado_por)
      : r.usuario_nome;
    auditoria.push({ rotulo: 'Confirmado por', valor: quem });
    if (r.confirmado_em) auditoria.push({ rotulo: 'Quando', valor: horaCompleta(r.confirmado_em) });
  } else {
    auditoria.push({ rotulo: 'Confirmado por', valor: 'Ainda não confirmado' });
  }
  if (r.ip) auditoria.push({ rotulo: 'IP', valor: mascararIp(r.ip) });
  auditoria.push({
    rotulo: 'Permissões',
    valor: solicitante?.perfis.length
      ? `As de ${primeiro} (perfil ${solicitante.perfis.join(', ')})`
      : `As de ${primeiro}`,
  });
  if (linha.transferidaPara) {
    auditoria.push({
      rotulo: 'Transferida para',
      valor: r.transferida_em ? `${linha.transferidaPara}, ${horaCompleta(r.transferida_em)}` : linha.transferidaPara,
    });
  }
  if (r.desfazer_ate && r.status === 'concluida') {
    auditoria.push({ rotulo: 'Desfazer até', valor: horaCompleta(r.desfazer_ate) });
  }
  const resultado = json<{ titulo?: string; codigo?: string; id?: string; simulado?: boolean } | null>(r.resultado, null);
  if (resultado && typeof resultado === 'object' && (resultado.titulo || resultado.codigo || resultado.id)) {
    const cod = resultado.codigo ?? (resultado.id ? `#${resultado.id}` : null);
    auditoria.push({
      rotulo: 'Resultado',
      valor: [resultado.titulo, cod && !resultado.titulo?.includes(cod) ? `(${cod})` : null].filter(Boolean).join(' '),
    });
  }
  if (r.canal === 'teste' || resultado?.simulado) {
    auditoria.push({ rotulo: 'Modo de teste', valor: 'Nada foi gravado no sistema' });
  }
  if (prints.size > 0) {
    const ret = configuracoes.ler('seguranca').retencaoPrintsDias;
    const datas = [...prints.values()].map((p) => p.apagar_em ?? new Date(Date.parse(p.criado_em) + ret * 86400_000).toISOString());
    datas.sort();
    auditoria.push({ rotulo: 'Retenção', valor: `Prints apagados em ${fmt.data(datas[0])}` });
  }

  const custoModelo = custoModeloDe(r, uso);
  return {
    linha,
    diagnostico: lerDiagnostico(r.diagnostico) ?? diagnosticoPadrao(r, linha, aprovacao?.aprovador ?? null),
    linhaTempo,
    tarefaVersao: r.tarefa_versao,
    custoModelo: custoModelo === null ? null : Math.round(custoModelo * 100) / 100,
    custoNavegador: r.custo_navegador,
    dados: dadosDoPedido(r.dados, def, usuarios),
    conversa: conversaDaExecucao(ctx, r),
    conversaId: r.conversa_id,
    estadoConversa,
    auditoria,
    acoes: acoesPossiveis(r, def, estadoConversa),
    fluxoId: def?.fluxoId ?? null,
    aprovacao,
  };
}

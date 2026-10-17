// Aprender fluxo (C4): criar a gravação, revisar e mapear os passos, testar no sistema com o
// navegador e publicar. Ver docs/arquitetura.md, "Gravador de fluxos" e "API do console".
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validarCampo, type Campo, type Fluxo, type PassoFluxo, type TarefaDefinicao } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import type { Contexto } from '../../contexto.ts';
import { aprenderFluxo, pendenciaDe } from '../../navegador/aprender.ts';
import { Fluxos, publico, type LinhaFluxo } from '../../navegador/fluxos.ts';
import { apagarPrint, apagarPrintsDoFluxo } from '../../navegador/prints.ts';
import type { EventoNavegador, ResultadoNavegador } from '../../navegador/tipos.ts';
import { ErroLlm, RecusaDoModelo } from '../../llm/tipos.ts';
import { agoraIso } from '../../db/banco.ts';
import { ErroHttp, conflito, naoEncontrado, pedidoInvalido } from '../../util/erros.ts';
import { camposDaTarefa, concluirGravacao } from '../gravacao.ts';

const TIPOS_PASSO = ['navegar', 'clique', 'preencher', 'selecionar', 'leitura', 'download', 'esperar'] as const;
const TIPOS_CAMPO = ['texto', 'documento', 'email', 'telefone', 'lista', 'data', 'hora', 'numero', 'moeda', 'pessoa'] as const;
const ETAPAS = ['gravar', 'revisar', 'mapear', 'testar', 'publicar'] as const;

const Seletor = z.object({
  seletor: z.string().trim().min(1).max(2000),
  estabilidade: z.enum(['estavel', 'fragil']),
  motivo: z.string().max(400),
});

const Valor = z.discriminatedUnion('origem', [
  z.object({ origem: z.literal('campo'), campo: z.string().min(1).max(60) }),
  z.object({ origem: z.literal('fixo'), valor: z.string().max(500) }),
  z.object({ origem: z.literal('nao_preencher') }),
]);

const Passo = z.object({
  n: z.number().int().optional(),
  tipo: z.enum(TIPOS_PASSO),
  titulo: z.string().trim().min(1).max(200),
  rotuloElemento: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  seletores: z.array(Seletor).max(20),
  seletorEscolhido: z.number().int().min(0),
  valor: Valor.optional(),
  formatoGravado: z.string().max(300).optional(),
  gera: z.string().max(60).optional(),
  printId: z.string().max(60).optional(),
  pendencia: z.string().max(300).optional(),
});

const CampoZ = z.looseObject({
  chave: z.string().regex(/^[a-z0-9_]{1,60}$/, 'A chave do campo usa só letras minúsculas, números e _.'),
  rotulo: z.string().trim().min(1).max(120),
  tipo: z.enum(TIPOS_CAMPO),
  obrigatorio: z.boolean(),
  pergunta: z.string().max(300),
  opcoes: z.array(z.string()).optional(),
});

const PedidoCriar = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao fluxo.').max(120),
  tarefaId: z.string().nullable().optional(),
  urlInicial: z.string().trim().min(1, 'Informe a página onde a tarefa começa.').max(2000),
});

const PedidoAtualizar = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  tarefaId: z.string().nullable().optional(),
  etapa: z.enum(ETAPAS).optional(),
  passos: z.array(Passo).max(200).optional(),
  camposSugeridos: z.array(CampoZ).max(60).optional(),
  urlInicial: z.string().trim().min(1).max(2000).optional(),
});

const PedidoTestar = z.object({
  valores: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  usuarioId: z.string().min(1, 'Escolha o usuário do sistema que vai rodar o teste.'),
});

export interface RespostaGravacao {
  fluxo: Fluxo;
  token: string;
  urlGravacao: string;
}

export interface RespostaTesteFluxo {
  fluxo: Fluxo;
  resultado: {
    ok: boolean;
    mensagem: string;
    motivo?: string;
    passo?: number | null;
    duracaoMs: number;
    gerados: Record<string, string>;
    arquivos: { nome: string; tipo: string }[];
    recuperacoes: number;
    printId?: string;
    candidato?: { texto: string; confianca: number };
  };
  eventos: EventoNavegador[];
}

/** Endereço que o console abre numa aba nova: a tela inicial com o token do gravador. */
export function urlDeGravacao(urlBase: string, urlInicial: string, token: string): string {
  const base = urlBase.replace(/\/+$/, '');
  const caminho = urlInicial.startsWith('/') ? urlInicial : `/${urlInicial}`;
  return `${base}${caminho}${caminho.includes('?') ? '&' : '?'}copiloto_gravacao=${encodeURIComponent(token)}`;
}

/** Aceita "/caminho" ou um endereço completo do próprio sistema; devolve o caminho. */
function caminhoInicial(urlBase: string, entrada: string, nomeSistema: string): string {
  const t = entrada.trim();
  if (t.startsWith('/')) return t;
  try {
    const u = new URL(t);
    const base = new URL(urlBase);
    if (u.host !== base.host) throw new Error('outro host');
    u.searchParams.delete('copiloto_gravacao');
    const busca = u.searchParams.toString();
    return u.pathname + (busca ? `?${busca}` : '');
  } catch {
    throw pedidoInvalido(`Use um endereço do ${nomeSistema}, por exemplo /financeiro/segunda-via.`);
  }
}

function primeiraMensagem(e: z.ZodError, padrao: string): string {
  const m = e.issues[0]?.message;
  return m && !/^(Invalid|Expected|Too)/i.test(m) ? m : padrao;
}

/** Campos que valem para mapear: os da tarefa, ou os sugeridos quando ainda não há tarefa. */
function camposDoFluxo(ctx: Contexto, f: Pick<LinhaFluxo, 'tarefaId' | 'camposSugeridos'>): Campo[] {
  const daTarefa = camposDaTarefa(ctx, f.tarefaId);
  return daTarefa.length ? daTarefa : f.camposSugeridos;
}

/** Passos editados: numera, corrige índices e recalcula as pendências. */
function prepararPassos(passos: z.infer<typeof Passo>[], chaves: Set<string>): PassoFluxo[] {
  return passos.map((p, i) => {
    const passo: PassoFluxo = {
      n: i + 1,
      tipo: p.tipo,
      titulo: p.titulo,
      seletores: p.seletores,
      seletorEscolhido: p.seletores.length ? Math.min(p.seletorEscolhido, p.seletores.length - 1) : 0,
    };
    if (p.rotuloElemento) passo.rotuloElemento = p.rotuloElemento;
    if (p.url) passo.url = p.url;
    if (p.formatoGravado) passo.formatoGravado = p.formatoGravado;
    if (p.gera) passo.gera = p.gera;
    if (p.printId) passo.printId = p.printId;
    if (p.valor && (p.tipo === 'preencher' || p.tipo === 'selecionar' || p.tipo === 'esperar')) passo.valor = p.valor;
    let pendencia = pendenciaDe(passo);
    if (!pendencia && passo.valor?.origem === 'campo' && chaves.size > 0 && !chaves.has(passo.valor.campo)) {
      pendencia = `O dado “${passo.valor.campo}” não existe na tarefa. Escolha outro.`;
    }
    if (pendencia) passo.pendencia = pendencia;
    return passo;
  });
}

const semPrints = (passos: PassoFluxo[]) => JSON.stringify(passos.map(({ printId: _p, pendencia: _q, ...p }) => p));

const rotas: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { banco, auditoria, eventos, adaptador, catalogo } = ctx;
  const fluxos = new Fluxos(banco);
  const testando = new Set<string>();

  const obter = (id: string): LinhaFluxo => {
    const f = fluxos.obter(id);
    if (!f) throw naoEncontrado('Fluxo');
    return f;
  };
  const nomeDe = (request: FastifyRequest) => membro(request).nome;
  const avisar = (f: LinhaFluxo) => eventos.emitirConsole({ tipo: 'fluxo', fluxoId: f.id, etapa: f.etapa, passos: f.passos.length });
  const respostaGravacao = (f: LinhaFluxo): RespostaGravacao => ({
    fluxo: publico(f),
    token: f.tokenGravacao!,
    urlGravacao: urlDeGravacao(adaptador.urlBase, f.urlInicial ?? '/', f.tokenGravacao!),
  });
  const tarefaExiste = (id: string | null | undefined) => {
    if (id && !catalogo.obter(id)) throw pedidoInvalido('A tarefa escolhida não existe mais. Escolha outra.');
  };

  app.get('/', { preHandler: exigir('ver') }, async (): Promise<Fluxo[]> => fluxos.listar().map(publico));

  app.post('/', { preHandler: exigir('editar') }, async (request): Promise<RespostaGravacao> => {
    const r = PedidoCriar.safeParse(request.body);
    if (!r.success) throw pedidoInvalido(primeiraMensagem(r.error, 'Informe o nome do fluxo e a página onde a tarefa começa.'));
    tarefaExiste(r.data.tarefaId);
    const urlInicial = caminhoInicial(adaptador.urlBase, r.data.urlInicial, adaptador.nome);
    const f = fluxos.criar({ nome: r.data.nome, tarefaId: r.data.tarefaId ?? null, urlInicial, por: nomeDe(request) });
    auditoria.registrar(nomeDe(request), 'começou a gravar o fluxo', f.nome, `Página inicial ${urlInicial}`);
    avisar(f);
    return respostaGravacao(f);
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: exigir('ver') }, async (request): Promise<Fluxo> => publico(obter(request.params.id)));

  app.put<{ Params: { id: string } }>('/:id', { preHandler: exigir('editar') }, async (request): Promise<Fluxo> => {
    const f = obter(request.params.id);
    const r = PedidoAtualizar.safeParse(request.body);
    if (!r.success) throw pedidoInvalido(primeiraMensagem(r.error, 'Os passos do fluxo vieram em formato inválido.'));
    const d = r.data;
    const mudaConteudo = d.nome !== undefined || d.tarefaId !== undefined || d.passos !== undefined || d.camposSugeridos !== undefined || d.urlInicial !== undefined;
    if (f.status === 'publicado' && mudaConteudo) {
      throw conflito('Este fluxo já está publicado e em uso. Crie uma nova versão para mudar os passos; a atual continua valendo até você publicar a nova.');
    }
    if (f.status === 'gravando' && (d.passos !== undefined || d.camposSugeridos !== undefined)) {
      throw conflito('A gravação ainda está em andamento. Conclua a gravação antes de revisar os passos.');
    }
    tarefaExiste(d.tarefaId);
    const campos: Record<string, unknown> = {};
    if (d.nome !== undefined) campos.nome = d.nome;
    if (d.tarefaId !== undefined) campos.tarefa_id = d.tarefaId;
    if (d.etapa !== undefined) campos.etapa = d.etapa;
    if (d.urlInicial !== undefined) campos.url_inicial = caminhoInicial(adaptador.urlBase, d.urlInicial, adaptador.nome);
    const camposSugeridos = (d.camposSugeridos as Campo[] | undefined) ?? f.camposSugeridos;
    if (d.camposSugeridos !== undefined) campos.campos_sugeridos = camposSugeridos;
    let passos = f.passos;
    if (d.passos !== undefined || d.tarefaId !== undefined || d.camposSugeridos !== undefined) {
      const chaves = new Set(camposDoFluxo(ctx, { tarefaId: d.tarefaId !== undefined ? d.tarefaId : f.tarefaId, camposSugeridos }).map((c) => c.chave));
      passos = prepararPassos(d.passos ?? f.passos, chaves);
      campos.passos = passos;
      const outraTarefa = d.tarefaId !== undefined && d.tarefaId !== f.tarefaId;
      if (outraTarefa || semPrints(passos) !== semPrints(f.passos)) campos.ultimo_teste = null;
    }
    const atualizado = fluxos.atualizar(f.id, campos);
    if (mudaConteudo) {
      auditoria.registrar(nomeDe(request), 'editou o fluxo', atualizado.nome, d.passos ? `${passos.length} passos` : null);
    }
    avisar(atualizado);
    return publico(atualizado);
  });

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: exigir('editar') }, async (request) => {
    const f = obter(request.params.id);
    const usando: string[] = [];
    for (const t of catalogo.listar()) {
      const versoes = [catalogo.publicada(t.id), catalogo.rascunho(t.id)].filter(Boolean);
      if (versoes.some((v) => v!.definicao.fluxoId === f.id)) usando.push(versoes[0]!.definicao.nome);
    }
    if (usando.length) {
      throw conflito(`Este fluxo é usado pela tarefa ${usando.map((n) => `“${n}”`).join(', ')}. Troque o fluxo da tarefa antes de apagar.`);
    }
    apagarPrintsDoFluxo(banco, ctx.config.dirDados, f.id);
    fluxos.apagar(f.id);
    auditoria.registrar(nomeDe(request), 'apagou o fluxo', f.nome, `versão ${f.versao}`);
    eventos.emitirConsole({ tipo: 'fluxo', fluxoId: f.id, etapa: 'apagado', passos: 0 });
    return { ok: true };
  });

  // ---------- Gravação ----------

  app.get<{ Params: { id: string } }>('/:id/gravacao', { preHandler: exigir('editar') }, async (request): Promise<RespostaGravacao> => {
    const f = obter(request.params.id);
    if (f.status !== 'gravando' || !f.tokenGravacao) throw conflito('Este fluxo não está em gravação agora.');
    return respostaGravacao(f);
  });

  /** Grava de novo. Num fluxo publicado, cria uma versão nova (a publicada continua valendo). */
  app.post<{ Params: { id: string } }>('/:id/gravar', { preHandler: exigir('editar') }, async (request): Promise<RespostaGravacao> => {
    let f = obter(request.params.id);
    const corpo = z.object({ urlInicial: z.string().trim().min(1).max(2000).optional() }).safeParse(request.body ?? {});
    const urlInicial = corpo.success && corpo.data.urlInicial ? caminhoInicial(adaptador.urlBase, corpo.data.urlInicial, adaptador.nome) : undefined;
    if (f.status === 'publicado') f = fluxos.novaVersao(f, nomeDe(request));
    apagarPrintsDoFluxo(banco, ctx.config.dirDados, f.id);
    const regravado = fluxos.regravar(f.id, nomeDe(request), urlInicial);
    auditoria.registrar(nomeDe(request), 'começou a gravar de novo o fluxo', regravado.nome, `versão ${regravado.versao}`);
    avisar(regravado);
    return respostaGravacao(regravado);
  });

  app.post<{ Params: { id: string } }>('/:id/concluir-gravacao', { preHandler: exigir('editar') }, async (request): Promise<Fluxo> => {
    const f = obter(request.params.id);
    if (f.status !== 'gravando') throw conflito('Este fluxo não está em gravação.');
    return publico(concluirGravacao(ctx, f));
  });

  app.post<{ Params: { id: string } }>('/:id/cancelar-gravacao', { preHandler: exigir('editar') }, async (request): Promise<Fluxo> => {
    const f = obter(request.params.id);
    if (f.status !== 'gravando') throw conflito('Este fluxo não está em gravação.');
    const atualizado = fluxos.atualizar(f.id, { status: 'rascunho', etapa: 'gravar', eventos_gravados: [], passos: [] });
    auditoria.registrar(nomeDe(request), 'cancelou a gravação do fluxo', f.nome);
    avisar(atualizado);
    return publico(atualizado);
  });

  app.post<{ Params: { id: string } }>('/:id/nova-versao', { preHandler: exigir('editar') }, async (request): Promise<Fluxo> => {
    const f = obter(request.params.id);
    if (f.status !== 'publicado') throw conflito('Só um fluxo publicado ganha versão nova. Este ainda é um rascunho: edite direto.');
    const nova = fluxos.novaVersao(f, nomeDe(request));
    auditoria.registrar(nomeDe(request), 'criou uma nova versão do fluxo', nova.nome, `versão ${nova.versao}`);
    avisar(nova);
    return publico(nova);
  });

  // ---------- Aprender, testar, publicar ----------

  app.post<{ Params: { id: string } }>('/:id/aprender', { preHandler: exigir('editar') }, async (request): Promise<Fluxo> => {
    const f = obter(request.params.id);
    if (f.status === 'gravando') throw conflito('A gravação ainda está em andamento. Conclua a gravação primeiro.');
    if (f.status === 'publicado') throw conflito('Este fluxo já está publicado. Crie uma nova versão para mudar os passos.');
    if (f.eventosGravados.length === 0) throw conflito('Este fluxo não tem gravação para aprender. Grave a tarefa na tela primeiro.');
    let r;
    try {
      r = await aprenderFluxo(ctx.llm, f.eventosGravados, camposDaTarefa(ctx, f.tarefaId));
    } catch (e) {
      if (e instanceof ErroLlm || e instanceof RecusaDoModelo) {
        throw new ErroHttp(503, 'claude_indisponivel', 'O Claude não respondeu agora. Os passos que já estão aqui continuam valendo; tente de novo em instantes.');
      }
      throw e;
    }
    const atualizado = fluxos.atualizar(f.id, {
      passos: r.passos,
      campos_sugeridos: r.camposSugeridos,
      etapa: 'revisar',
      ultimo_teste: null,
    });
    auditoria.registrar(nomeDe(request), 'pediu ao Claude para organizar o fluxo', f.nome, `${r.passos.length} passos`);
    avisar(atualizado);
    return publico(atualizado);
  });

  app.post<{ Params: { id: string } }>('/:id/criar-tarefa', { preHandler: exigir('editar') }, async (request) => {
    const f = obter(request.params.id);
    if (f.tarefaId && catalogo.obter(f.tarefaId)) throw conflito('Este fluxo já está ligado a uma tarefa.');
    if (f.camposSugeridos.length === 0 && f.passos.length === 0) throw conflito('Grave o fluxo antes de criar a tarefa.');
    const definicao = definicaoPadrao(f, adaptador.nome);
    const tarefa = catalogo.criar(definicao, nomeDe(request));
    const atualizado = fluxos.atualizar(f.id, { tarefa_id: tarefa.id });
    auditoria.registrar(nomeDe(request), 'criou a tarefa a partir do fluxo', definicao.nome, `Fluxo “${f.nome}”`);
    avisar(atualizado);
    return { fluxo: publico(atualizado), tarefaId: tarefa.id };
  });

  app.post<{ Params: { id: string } }>('/:id/testar', { preHandler: exigir('editar') }, async (request, reply): Promise<RespostaTesteFluxo> => {
    const f = obter(request.params.id);
    const r = PedidoTestar.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(primeiraMensagem(r.error, 'Informe os valores do teste e o usuário do sistema.'));
    if (f.status === 'gravando') throw conflito('A gravação ainda está em andamento. Conclua a gravação antes de testar.');
    if (f.passos.length === 0) throw conflito('Este fluxo ainda não tem passos para testar.');
    if (testando.has(f.id)) throw conflito('Já há um teste deste fluxo rodando. Espere ele terminar.');

    let usuario;
    try {
      usuario = await adaptador.buscarUsuario(r.data.usuarioId);
    } catch {
      throw new ErroHttp(502, 'sistema_indisponivel', `Não consegui falar com o ${adaptador.nome} agora.`);
    }
    if (!usuario) throw pedidoInvalido('Este usuário não existe no sistema. Escolha outro.');

    const valores = validarValores(camposDoFluxo(ctx, f), f.passos, r.data.valores);
    const def = f.tarefaId ? (catalogo.rascunho(f.tarefaId) ?? catalogo.publicada(f.tarefaId))?.definicao : undefined;
    const seguranca = ctx.configuracoes.ler('seguranca');
    const execucaoId = `teste_${f.id}_${Date.now().toString(36)}`;
    const recebidos: EventoNavegador[] = [];
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), 5 * 60_000);
    // Se o console fechar a conexão no meio (a pessoa saiu da tela), o teste para.
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controle.abort();
    });
    testando.add(f.id);
    let resultado: ResultadoNavegador;
    try {
      resultado = await ctx.navegador.executar({
        execucaoId,
        fluxo: publico(f),
        valores,
        usuarioId: usuario.id,
        confiancaMinima: def?.confiancaMinima ?? 0.85,
        mascararPrints: seguranca.mascararPrints,
        aoEvento: (e) => recebidos.push(e),
        sinal: controle.signal,
      });
    } finally {
      clearTimeout(relogio);
      testando.delete(f.id);
    }

    // Prints do teste ficam ligados ao fluxo (não a uma execução) e substituem os do teste anterior.
    banco.executar('UPDATE prints SET fluxo_id = ?, execucao_id = NULL WHERE execucao_id = ?', f.id, execucaoId);
    const novosPrints = new Set(recebidos.map((e) => e.printId).filter(Boolean) as string[]);
    if (!resultado.ok && resultado.printId) novosPrints.add(resultado.printId);
    const antigos = banco.todos<{ id: string }>('SELECT id FROM prints WHERE fluxo_id = ?', f.id).filter((p) => !novosPrints.has(p.id));
    for (const p of antigos) apagarPrint(banco, ctx.config.dirDados, p.id);

    const passos = f.passos.map((p) => ({ ...p, printId: undefined as string | undefined }));
    for (const e of recebidos) {
      if (e.passo && e.printId && passos[e.passo - 1]) passos[e.passo - 1].printId = e.printId;
    }
    const ultimoTeste: NonNullable<Fluxo['ultimoTeste']> = resultado.ok
      ? { em: agoraIso(), ok: true }
      : { em: agoraIso(), ok: false, passoFalhou: resultado.passo ?? undefined, erro: resultado.mensagem };
    const atualizado = fluxos.atualizar(f.id, {
      passos: passos.map((p) => (p.printId ? p : (({ printId: _x, ...resto }) => resto)(p))),
      ultimo_teste: ultimoTeste,
      etapa: f.status === 'publicado' ? f.etapa : resultado.ok ? 'publicar' : 'testar',
    });
    auditoria.registrar(
      nomeDe(request),
      'testou o fluxo',
      f.nome,
      resultado.ok ? `Deu certo como ${usuario.nome}` : `Falhou no passo ${resultado.passo ?? '-'}: ${resultado.mensagem}`,
    );
    avisar(atualizado);
    return {
      fluxo: publico(atualizado),
      resultado: resultado.ok
        ? {
            ok: true,
            mensagem: `O fluxo rodou do começo ao fim como ${usuario.nome}${resultado.recuperacoes ? `, com ${resultado.recuperacoes} ${resultado.recuperacoes === 1 ? 'recuperação' : 'recuperações'} visuais` : ''}.`,
            duracaoMs: resultado.duracaoMs,
            gerados: resultado.gerados,
            arquivos: resultado.arquivos.map((a) => ({ nome: a.nome, tipo: a.tipo })),
            recuperacoes: resultado.recuperacoes,
          }
        : {
            ok: false,
            mensagem: resultado.mensagem,
            motivo: resultado.motivo,
            passo: resultado.passo,
            duracaoMs: resultado.duracaoMs,
            gerados: {},
            arquivos: [],
            recuperacoes: recebidos.filter((e) => e.tipo === 'recuperacao').length,
            printId: resultado.printId,
            candidato: resultado.candidato,
          },
      eventos: recebidos,
    };
  });

  app.post<{ Params: { id: string } }>('/:id/publicar', { preHandler: exigir('editar') }, async (request) => {
    const f = obter(request.params.id);
    if (f.status === 'gravando') throw conflito('A gravação ainda está em andamento. Conclua, revise e teste antes de publicar.');
    if (f.status === 'publicado') throw conflito('Este fluxo já está publicado.');
    if (f.passos.length === 0) throw conflito('Este fluxo não tem passos. Grave a tarefa na tela primeiro.');
    const pendentes = f.passos.filter((p) => p.pendencia);
    if (pendentes.length) {
      throw conflito(`Resolva as pendências antes de publicar: ${pendentes.map((p) => `passo ${p.n} (${p.pendencia})`).join('; ')}.`);
    }
    if (!f.ultimoTeste?.ok) throw conflito('Teste o fluxo com sucesso antes de publicar. Depois de qualquer mudança nos passos, teste de novo.');
    const quem = nomeDe(request);
    const atualizado = fluxos.atualizar(f.id, { status: 'publicado', etapa: 'publicar' });
    let tarefa: { id: string; nome: string } | null = null;
    if (f.tarefaId && catalogo.obter(f.tarefaId)) {
      const v = catalogo.rascunho(f.tarefaId) ?? catalogo.publicada(f.tarefaId);
      if (v) {
        catalogo.salvarRascunho(f.tarefaId, { ...v.definicao, fluxoId: f.id }, quem);
        tarefa = { id: f.tarefaId, nome: v.definicao.nome };
      }
    }
    auditoria.registrar(quem, 'publicou o fluxo', f.nome, tarefa ? `Versão ${f.versao}, ligado ao rascunho da tarefa “${tarefa.nome}”` : `Versão ${f.versao}`);
    avisar(atualizado);
    return { fluxo: publico(atualizado), tarefa };
  });
};

/** Valida e normaliza os valores do teste pelos campos (data ISO, CNPJ formatado...). */
function validarValores(campos: Campo[], passos: PassoFluxo[], entrada: Record<string, string | number | boolean | null>): Record<string, string> {
  const usados = new Set(passos.flatMap((p) => (p.valor?.origem === 'campo' ? [p.valor.campo] : [])));
  const valores: Record<string, string> = {};
  const faltando: string[] = [];
  const erros: string[] = [];
  for (const chave of usados) {
    const campo = campos.find((c) => c.chave === chave);
    const bruto = entrada[chave];
    const texto = bruto === null || bruto === undefined ? '' : String(bruto).trim();
    if (!campo) {
      if (texto) valores[chave] = texto;
      continue;
    }
    if (!texto) {
      if (campo.obrigatorio && campo.tipo !== 'pessoa') faltando.push(campo.rotulo);
      continue;
    }
    const r = validarCampo(campo, texto);
    if (r.ok) valores[chave] = r.valor ?? texto;
    else erros.push(r.erro ?? `${campo.rotulo}: valor inválido.`);
  }
  if (faltando.length) throw pedidoInvalido(`Preencha os valores do teste: ${faltando.join(', ')}.`);
  if (erros.length) throw pedidoInvalido(erros[0]);
  return valores;
}

/** Ficha inicial de uma tarefa criada a partir do fluxo (caminho navegador). */
function definicaoPadrao(f: LinhaFluxo, nomeSistema: string): TarefaDefinicao {
  const campos = f.camposSugeridos.length
    ? f.camposSugeridos
    : f.passos
        .filter((p) => p.valor?.origem === 'campo')
        .map((p) => ({ chave: (p.valor as { campo: string }).campo, rotulo: p.rotuloElemento ?? p.titulo, tipo: 'texto' as const, obrigatorio: true, pergunta: `Qual é ${p.rotuloElemento ?? 'o valor'}?` }));
  const leituras = f.passos.filter((p) => p.tipo === 'leitura' && p.gera).map((p) => p.gera!);
  const segundos = Math.max(10, f.passos.length * 4);
  return {
    nome: f.nome,
    descricao: `Faz “${f.nome}” na tela do ${nomeSistema}, repetindo o fluxo gravado.`,
    quandoUsar: `Use quando a pessoa pedir para ${f.nome.toLowerCase()}.`,
    exemplos: [],
    campos,
    caminho: 'navegador',
    fluxoId: f.id,
    usarFluxoSeApiFalhar: false,
    confirmacao: true,
    desfazerMinutos: 0,
    perfisPermitidos: [],
    tituloRecibo: leituras.length ? `${f.nome}: {${leituras[0]}}` : `${f.nome} concluída`,
    tituloConfirmacao: `Confirme: ${f.nome}`,
    proximosPassos: [],
    contextos: [],
    confiancaMinima: 0.85,
    tempoEstimado: `cerca de ${segundos} s`,
  };
}

export default rotas;

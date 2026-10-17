// Catálogo e ficha das tarefas (C2, C3). Toda mudança exige o perfil certo e vai para a auditoria.
// A lógica que não é rota fica em server/src/tarefas/.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { CasoDeTeste, ListaTarefas, RodadaTestes, TarefaDefinicao, TarefaDetalhe } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import { ErroLlm, RecusaDoModelo } from '../../llm/tipos.ts';
import { testarChamada, type ResultadoChamada } from '../../tarefas/chamada.ts';
import { lerDefinicao, pendenciasParaPublicar, resumirAlteracoes } from '../../tarefas/definicao.ts';
import { descreverTarefa } from '../../tarefas/descrever.ts';
import { montarDetalhe, tarefaNaoEncontrada } from '../../tarefas/detalhe.ts';
import { montarLista } from '../../tarefas/lista.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';

const ComDefinicao = z.object({ definicao: z.unknown() });
const Descrever = z.object({
  descricao: z
    .string()
    .trim()
    .min(15, 'Descreva a tarefa com um pouco mais de detalhe: o que ela faz e quais dados precisa.')
    .max(4000, 'A descrição ficou longa demais. Resuma em até 4.000 caracteres.'),
});
const Ignorar = z.object({ tema: z.string().trim().min(1, 'Informe o tema a ignorar.').max(200) });
const Publicar = z.object({ resumoMudancas: z.string().trim().max(500).nullish() });
const Status = z.object({ status: z.enum(['ativa', 'teste', 'inativa']) });
const Restaurar = z.object({ versao: z.number().int().positive() });
const RodarTestes = z.object({ usarRascunho: z.boolean().default(true) });
const TestarChamada = z.object({ definicao: z.unknown().optional() });
const Casos = z.object({
  casos: z
    .array(
      z.object({
        id: z.string().min(1).max(60).optional(),
        frase: z.string().trim().min(3, 'Cada teste precisa de uma frase, como a equipe escreveria.').max(500),
        esperado: z.object({
          resultado: z.enum(['pergunta', 'confirmacao', 'recusa']),
          campoPerguntado: z.string().trim().max(60).optional(),
          campos: z.record(z.string(), z.string()).optional(),
        }),
      }),
    )
    .max(100, 'Use no máximo 100 testes por tarefa.'),
});

function validar<T>(esquema: z.ZodType<T>, corpo: unknown, padrao = 'Os dados enviados estão incompletos.'): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) {
    const msg = r.error.issues[0]?.message;
    throw pedidoInvalido(msg && !/^(Invalid|Expected|Too)/.test(msg) ? msg : padrao);
  }
  return r.data;
}

function definicaoDoCorpo(corpo: unknown): TarefaDefinicao {
  const { definicao } = validar(ComDefinicao, corpo);
  const r = lerDefinicao(definicao);
  if (!r.ok) throw pedidoInvalido(r.mensagem);
  return r.definicao;
}

type ComParams = { Params: { id: string } };

const rotas: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { catalogo, auditoria, banco } = ctx;

  const tarefa = (id: string) => {
    const t = catalogo.obter(id);
    if (!t) throw tarefaNaoEncontrada();
    return t;
  };
  const nomeDa = (id: string) => (catalogo.rascunho(id) ?? catalogo.publicada(id))?.definicao.nome ?? id;

  app.get('/', { preHandler: exigir('ver') }, async (): Promise<ListaTarefas> => montarLista(ctx));

  app.post('/', { preHandler: exigir('editar') }, async (request, reply): Promise<TarefaDetalhe> => {
    const m = membro(request);
    const definicao = definicaoDoCorpo(request.body);
    const t = catalogo.criar(definicao, m.nome);
    auditoria.registrar(m.nome, 'criou a tarefa', definicao.nome, `Rascunho da versão 1, caminho ${definicao.caminho === 'api' ? 'API' : 'navegador'}.`);
    reply.code(201);
    return montarDetalhe(ctx, t.id);
  });

  app.post('/descrever', { preHandler: exigir('editar') }, async (request): Promise<{ definicao: TarefaDefinicao }> => {
    const { descricao } = validar(Descrever, request.body);
    try {
      return { definicao: await descreverTarefa(ctx, descricao) };
    } catch (e) {
      if (e instanceof RecusaDoModelo) {
        throw new ErroHttp(422, 'recusado', 'O Claude não montou uma ficha para esse texto. Reescreva a descrição focando no que a tarefa faz no sistema.');
      }
      if (e instanceof ErroLlm) throw new ErroHttp(502, 'llm_indisponivel', `Não consegui montar a ficha agora: ${e.message}`);
      throw e;
    }
  });

  app.post('/sem-tarefa/ignorar', { preHandler: exigir('editar') }, async (request) => {
    const m = membro(request);
    const { tema } = validar(Ignorar, request.body);
    const r = banco.executar("UPDATE pedidos SET ignorado = 1 WHERE tipo = 'sem_tarefa' AND ignorado = 0 AND tema = ?", tema);
    auditoria.registrar(m.nome, 'ignorou os pedidos sem tarefa', tema, `${Number(r.changes)} pedidos marcados como ignorados.`);
    return { ok: true };
  });

  app.get<ComParams>('/:id', { preHandler: exigir('ver') }, async (request): Promise<TarefaDetalhe> => {
    tarefa(request.params.id);
    return montarDetalhe(ctx, request.params.id);
  });

  app.put<ComParams>('/:id/rascunho', { preHandler: exigir('editar') }, async (request): Promise<TarefaDetalhe> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const definicao = definicaoDoCorpo(request.body);
    const novo = !catalogo.rascunho(t.id);
    const v = catalogo.salvarRascunho(t.id, definicao, m.nome);
    auditoria.registrar(m.nome, novo ? 'começou um rascunho da tarefa' : 'salvou o rascunho da tarefa', definicao.nome, `Versão ${v.versao}.`);
    return montarDetalhe(ctx, t.id);
  });

  app.delete<ComParams>('/:id/rascunho', { preHandler: exigir('editar') }, async (request): Promise<TarefaDetalhe> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const r = catalogo.rascunho(t.id);
    if (!r) throw new ErroHttp(409, 'sem_rascunho', 'Esta tarefa não tem rascunho para descartar.');
    if (!t.versaoPublicada) {
      throw new ErroHttp(409, 'nunca_publicada', 'Esta tarefa ainda não foi publicada, então o rascunho é a única versão. Para tirá-la do ar, desative a tarefa.');
    }
    catalogo.descartarRascunho(t.id);
    auditoria.registrar(m.nome, 'descartou o rascunho da tarefa', r.definicao.nome, `Versão ${r.versao}.`);
    return montarDetalhe(ctx, t.id);
  });

  app.post<ComParams>('/:id/publicar', { preHandler: exigir('editar') }, async (request): Promise<TarefaDetalhe> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const { resumoMudancas } = validar(Publicar, request.body);
    const r = catalogo.rascunho(t.id);
    if (!r) throw new ErroHttp(409, 'sem_rascunho', 'Não há alterações para publicar. Edite a ficha e salve o rascunho primeiro.');
    const pendencias = pendenciasParaPublicar(r.definicao);
    if (pendencias.length > 0) {
      throw new ErroHttp(422, 'ficha_incompleta', `Antes de publicar: ${pendencias.join(' ')}`);
    }
    const anterior = catalogo.publicada(t.id)?.definicao ?? null;
    const resumo = resumoMudancas?.trim() || resumirAlteracoes(anterior, r.definicao);
    const v = catalogo.publicar(t.id, m.nome, resumo);
    auditoria.registrar(m.nome, `publicou a versão ${v.versao} da tarefa`, r.definicao.nome, resumo);
    return montarDetalhe(ctx, t.id);
  });

  app.post<ComParams>('/:id/status', { preHandler: exigir('editar') }, async (request): Promise<TarefaDetalhe> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const { status } = validar(Status, request.body, 'Escolha o status: ativa, em teste ou inativa.');
    if (status !== 'inativa' && !t.versaoPublicada) {
      throw new ErroHttp(409, 'nunca_publicada', 'Publique a tarefa antes de ativá-la ou colocá-la em teste.');
    }
    if (status !== t.status) {
      catalogo.definirStatus(t.id, status, m.nome);
      const acao = { ativa: 'ativou a tarefa', teste: 'colocou em teste a tarefa', inativa: 'desativou a tarefa' }[status];
      auditoria.registrar(m.nome, acao, nomeDa(t.id));
    }
    return montarDetalhe(ctx, t.id);
  });

  app.post<ComParams>('/:id/restaurar', { preHandler: exigir('editar') }, async (request): Promise<TarefaDetalhe> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const { versao } = validar(Restaurar, request.body, 'Informe a versão a restaurar.');
    const v = catalogo.versao(t.id, versao);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', `A versão ${versao} desta tarefa não existe.`);
    if (v.status === 'rascunho') throw new ErroHttp(409, 'ja_rascunho', `A versão ${versao} já é o rascunho atual.`);
    const r = catalogo.salvarRascunho(t.id, v.definicao, m.nome);
    auditoria.registrar(m.nome, `restaurou a versão ${versao} como rascunho da tarefa`, v.definicao.nome, `Rascunho da versão ${r.versao}.`);
    return montarDetalhe(ctx, t.id);
  });

  app.put<ComParams>('/:id/testes', { preHandler: exigir('editar') }, async (request): Promise<CasoDeTeste[]> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const { casos } = validar(Casos, request.body, 'Confira os testes: cada um precisa de uma frase e do resultado esperado.');
    catalogo.salvarTestes(t.id, casos as CasoDeTeste[]);
    auditoria.registrar(m.nome, 'alterou os testes da tarefa', nomeDa(t.id), `${casos.length} ${casos.length === 1 ? 'teste' : 'testes'}.`);
    return catalogo.testes(t.id);
  });

  app.post<ComParams>('/:id/testes/rodar', { preHandler: exigir('editar') }, async (request): Promise<RodadaTestes> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const { usarRascunho } = validar(RodarTestes, request.body);
    if (catalogo.testes(t.id).length === 0) {
      throw new ErroHttp(409, 'sem_testes', 'Adicione pelo menos um teste antes de rodar.');
    }
    const comRascunho = usarRascunho && !!catalogo.rascunho(t.id);
    if (!comRascunho && !catalogo.publicada(t.id)) {
      throw new ErroHttp(409, 'sem_versao', 'Salve o rascunho da ficha antes de rodar os testes.');
    }
    let rodada: RodadaTestes;
    try {
      rodada = await ctx.agente.rodarTestes(t.id, { usarRascunho: comRascunho });
    } catch (e) {
      if (e instanceof ErroHttp) throw e;
      if (e instanceof ErroLlm) throw new ErroHttp(502, 'llm_indisponivel', `Não consegui rodar os testes agora: ${e.message}`);
      const msg = e instanceof Error ? e.message : '';
      if (/n[aã]o implementado/i.test(msg)) {
        throw new ErroHttp(
          503,
          'testes_indisponiveis',
          'Os testes automáticos ainda não estão disponíveis neste servidor. Enquanto isso, converse com o copiloto na pré-visualização, que usa o rascunho.',
        );
      }
      request.log.error({ err: e }, 'falha ao rodar testes');
      throw new ErroHttp(502, 'testes_falharam', 'Não consegui rodar os testes agora. Nada foi alterado na tarefa; tente de novo em instantes.');
    }
    auditoria.registrar(
      m.nome,
      'rodou os testes da tarefa',
      nomeDa(t.id),
      `${rodada.aprovados} de ${rodada.total} aprovados, com ${comRascunho ? 'o rascunho' : 'a versão publicada'} (versão ${rodada.versao}).`,
    );
    return rodada;
  });

  app.post<ComParams>('/:id/testar-chamada', { preHandler: exigir('editar') }, async (request): Promise<ResultadoChamada> => {
    const m = membro(request);
    const t = tarefa(request.params.id);
    const corpo = validar(TestarChamada, request.body);
    const rasc = catalogo.rascunho(t.id);
    let def: TarefaDefinicao | undefined;
    if (corpo.definicao !== undefined) {
      const r = lerDefinicao(corpo.definicao);
      if (!r.ok) throw pedidoInvalido(r.mensagem);
      def = r.definicao;
    } else def = (rasc ?? catalogo.publicada(t.id))?.definicao;
    if (!def) throw tarefaNaoEncontrada();
    if (def.caminho !== 'api' || !def.api) {
      throw new ErroHttp(409, 'sem_api', 'Esta tarefa não usa a API. Para o caminho navegador, teste o fluxo gravado.');
    }
    const resultado = await testarChamada(ctx, def);
    // Marca "Testada às ..." no rascunho quando a chamada testada é a do rascunho.
    if (resultado.ok && rasc?.definicao.api) {
      const { testadaEm: _a, ...doRascunho } = rasc.definicao.api;
      const { testadaEm: _b, ...testada } = def.api;
      if (JSON.stringify(doRascunho) === JSON.stringify(testada)) {
        catalogo.salvarRascunho(t.id, { ...rasc.definicao, api: { ...rasc.definicao.api, testadaEm: new Date().toISOString() } }, m.nome);
      }
    }
    auditoria.registrar(
      m.nome,
      'testou a chamada da API da tarefa',
      def.nome,
      `${def.api.metodo} ${def.api.caminho}: ${resultado.ok ? 'funcionou' : `falhou (${resultado.status || 'sem resposta'})`}.`,
    );
    return resultado;
  });
};

export default rotas;

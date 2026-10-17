// Rotas da base de conhecimento (C7): fontes, perguntas sem resposta e "Testar uma pergunta".
// Ver docs/arquitetura.md, seção "API do console" (conhecimento).
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FonteConhecimento, PerguntaSemResposta, RespostaTeste } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import { Conhecimento, ErroFonte } from '../../conhecimento/index.ts';
import { LIMITE_ARQUIVO_MB } from '../../conhecimento/erros.ts';
import { LIMITE_PAGINAS_MAX } from '../../conhecimento/ingestao.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import { ErroLlm, RecusaDoModelo } from '../../llm/tipos.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';

const Id = z.object({ id: z.string().min(1).max(64) });

const PedidoSite = z.object({
  url: z.string().trim().min(1).max(2000),
  limitePaginas: z.coerce.number().int().min(1).max(LIMITE_PAGINAS_MAX).optional(),
  nome: z.string().trim().max(120).optional(),
});

const PedidoVideo = z.object({
  nome: z.string().trim().max(160).optional(),
  texto: z.string().max(2_000_000).optional(),
  url: z.string().trim().max(2000).optional(),
});

const PedidoResposta = z.object({
  pergunta: z.string().trim().min(3).max(500),
  resposta: z.string().trim().min(3).max(8000),
});

const PedidoResponderPergunta = z.object({
  resposta: z.string().trim().min(3).max(8000),
  pergunta: z.string().trim().min(3).max(500).optional(),
});

const PedidoTeste = z.object({ pergunta: z.string().trim().min(2).max(500) });

/** ErroFonte (com "como resolver") → resposta HTTP com a explicação completa. */
function erroDeFonte(e: unknown): never {
  if (e instanceof ErroFonte) {
    const status = e.codigo === 'tipo_nao_aceito' ? 415 : e.codigo === 'arquivo_grande' ? 413 : 400;
    throw new ErroHttp(status, e.codigo, `${e.message} ${e.comoResolver}`);
  }
  throw e;
}

/** A base de conhecimento da empresa, ligada aos eventos e à pasta de dados dela. */
function baseDe(ctx: Contexto): Conhecimento {
  const base = ctx.conhecimento;
  if (!(base instanceof Conhecimento)) throw new Error('Base de conhecimento indisponível.');
  return base;
}

function validar<T>(esquema: z.ZodType<T>, dados: unknown, mensagem: string): T {
  const r = esquema.safeParse(dados ?? {});
  if (!r.success) throw pedidoInvalido(mensagem);
  return r.data;
}

interface Envio {
  campos: Record<string, string>;
  arquivo?: { nome: string; dados: Buffer };
}

/** Lê um envio multipart: o primeiro arquivo e os campos de texto (em qualquer ordem). */
async function lerEnvio(request: FastifyRequest): Promise<Envio> {
  const envio: Envio = { campos: {} };
  try {
    for await (const parte of request.parts({ limits: { fileSize: LIMITE_ARQUIVO_MB * 1024 * 1024 + 1, files: 1 } })) {
      if (parte.type === 'file') {
        const dados = await parte.toBuffer();
        if (!envio.arquivo) envio.arquivo = { nome: parte.filename || 'arquivo', dados };
      } else if (typeof parte.value === 'string') {
        envio.campos[parte.fieldname] = parte.value;
      }
    }
  } catch (e) {
    const codigo = (e as { code?: string }).code ?? '';
    if (codigo === 'FST_REQ_FILE_TOO_LARGE') {
      throw new ErroHttp(
        413,
        'arquivo_grande',
        `O arquivo passa de ${LIMITE_ARQUIVO_MB} MB. Divida o documento em partes menores ou reduza as imagens e envie cada parte como uma fonte.`,
      );
    }
    if (codigo === 'FST_FILES_LIMIT') throw pedidoInvalido('Envie um arquivo por vez.');
    throw pedidoInvalido('Não foi possível receber o arquivo. Tente enviar de novo.');
  }
  return envio;
}

const rotas: FastifyPluginAsync = async (app) => {
  // Ao fechar: interrompe as leituras de fontes em andamento de todas as empresas e espera terminarem.
  app.addHook('onClose', async () => {
    const bases = app.plataforma.abertos().map((ctx) => ctx.conhecimento).filter((b) => b instanceof Conhecimento);
    for (const base of bases) base.parar();
    await Promise.all(bases.map((base) => base.aguardar()));
  });

  const auditar = ({ auditoria }: Contexto, request: FastifyRequest, acao: string, alvo: string, detalhe?: string) =>
    auditoria.registrar(membro(request).nome, acao, alvo, detalhe);

  // ---------- Fontes

  app.get('/fontes', { preHandler: exigir('ver') }, async (request): Promise<FonteConhecimento[]> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    return base.listarFontes();
  });

  app.get('/fontes/:id', { preHandler: exigir('ver') }, async (request): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Fonte inválida.');
    return base.fonte(id);
  });

  app.get('/fontes/:id/trechos', { preHandler: exigir('ver') }, async (request) => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Fonte inválida.');
    return base.trechosDaFonte(id, 100);
  });

  app.post('/fontes/site', { preHandler: exigir('editar') }, async (request, reply): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const p = validar(PedidoSite, request.body, 'Informe o endereço do site, começando com https://.');
    let fonte: FonteConhecimento;
    try {
      fonte = base.adicionarSite({ ...p, enviadoPor: membro(request).nome });
    } catch (e) {
      erroDeFonte(e);
    }
    auditar(ctx, request, 'adicionou fonte de conhecimento', `Site ${fonte.origem}`, `até ${p.limitePaginas ?? 50} páginas`);
    return reply.status(201).send(fonte);
  });

  app.post('/fontes/arquivo', { preHandler: exigir('editar') }, async (request, reply): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    if (!request.isMultipart()) throw pedidoInvalido('Envie o arquivo pelo formulário (PDF, DOCX, TXT ou MD).');
    const envio = await lerEnvio(request);
    if (!envio.arquivo) throw pedidoInvalido('Escolha um arquivo PDF, DOCX, TXT ou MD para enviar.');
    const substituir = envio.campos.substituir?.trim() || undefined;
    let fonte: FonteConhecimento;
    try {
      fonte = base.adicionarArquivo({
        nomeArquivo: envio.arquivo.nome,
        dados: envio.arquivo.dados,
        enviadoPor: membro(request).nome,
        substituir,
      });
    } catch (e) {
      erroDeFonte(e);
    }
    auditar(
      ctx,
      request,
      substituir ? 'trocou o arquivo da fonte' : 'adicionou fonte de conhecimento',
      `Arquivo “${fonte.nome}”`,
      `${Math.max(1, Math.round(envio.arquivo.dados.length / 1024))} KB`,
    );
    return reply.status(substituir ? 200 : 201).send(fonte);
  });

  app.post('/fontes/video', { preHandler: exigir('editar') }, async (request, reply): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    let p: z.infer<typeof PedidoVideo>;
    let arquivo: Envio['arquivo'];
    if (request.isMultipart()) {
      const envio = await lerEnvio(request);
      p = validar(PedidoVideo, envio.campos, 'Confira o nome e o link do vídeo.');
      arquivo = envio.arquivo;
    } else {
      p = validar(PedidoVideo, request.body, 'Cole a transcrição do vídeo ou envie o arquivo de legenda (.vtt ou .srt).');
    }
    if (!arquivo && !p.texto?.trim()) {
      throw pedidoInvalido('Cole a transcrição do vídeo ou envie o arquivo de legenda (.vtt ou .srt).');
    }
    let fonte: FonteConhecimento;
    try {
      fonte = base.adicionarVideo({ ...p, arquivo, enviadoPor: membro(request).nome });
    } catch (e) {
      erroDeFonte(e);
    }
    auditar(ctx, request, 'adicionou fonte de conhecimento', `Vídeo “${fonte.nome}”`, arquivo ? arquivo.nome : 'transcrição colada');
    return reply.status(201).send(fonte);
  });

  app.post('/fontes/respostas', { preHandler: exigir('editar') }, async (request, reply): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const p = validar(PedidoResposta, request.body, 'Escreva a pergunta e a resposta (pelo menos algumas palavras em cada).');
    const fonte = base.adicionarResposta({ ...p, autor: membro(request).nome });
    auditar(ctx, request, 'adicionou resposta pronta', `Pergunta “${p.pergunta}”`);
    return reply.status(201).send(fonte);
  });

  app.post('/fontes/:id/sincronizar', { preHandler: exigir('editar') }, async (request): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Fonte inválida.');
    const fonte = base.sincronizar(id);
    auditar(ctx, request, 'sincronizou fonte de conhecimento', `“${fonte.nome}”`);
    return fonte;
  });

  app.post('/fontes/:id/pausar', { preHandler: exigir('editar') }, async (request): Promise<FonteConhecimento> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Fonte inválida.');
    const fonte = base.pausar(id);
    auditar(ctx, request, 'pausou fonte de conhecimento', `“${fonte.nome}”`);
    return fonte;
  });

  app.delete('/fontes/:id', { preHandler: exigir('editar') }, async (request) => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Fonte inválida.');
    const fonte = base.fonte(id);
    base.remover(id);
    auditar(ctx, request, 'removeu fonte de conhecimento', `“${fonte.nome}”`, `${fonte.trechos} trechos apagados`);
    return { ok: true };
  });

  // ---------- Perguntas sem resposta

  app.get('/perguntas-sem-resposta', { preHandler: exigir('ver') }, async (request): Promise<PerguntaSemResposta[]> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    return base.listarSemResposta();
  });

  app.post('/perguntas-sem-resposta/:id/responder', { preHandler: exigir('editar') }, async (request) => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Pergunta inválida.');
    const p = validar(PedidoResponderPergunta, request.body, 'Escreva a resposta (pelo menos algumas palavras).');
    const original = base.perguntaAberta(id);
    const fonte = base.responderSemResposta(id, p.resposta, membro(request).nome, p.pergunta);
    auditar(ctx, request, 'respondeu pergunta sem resposta', `Pergunta “${original.pergunta}”`, 'virou resposta pronta');
    return { ok: true, fonte };
  });

  app.post('/perguntas-sem-resposta/:id/ignorar', { preHandler: exigir('editar') }, async (request) => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { id } = validar(Id, request.params, 'Pergunta inválida.');
    const original = base.perguntaAberta(id);
    base.ignorarSemResposta(id);
    auditar(ctx, request, 'ignorou pergunta sem resposta', `Pergunta “${original.pergunta}”`);
    return { ok: true };
  });

  // ---------- Testar uma pergunta

  app.post('/testar', { preHandler: exigir('ver') }, async (request): Promise<RespostaTeste> => {
    const ctx = ctxDe(request);
    const base = baseDe(ctx);
    const { pergunta } = validar(PedidoTeste, request.body, 'Escreva uma pergunta para testar.');
    try {
      return await base.responder(pergunta);
    } catch (e) {
      if (e instanceof ErroLlm) throw new ErroHttp(503, 'claude_indisponivel', e.message);
      if (e instanceof RecusaDoModelo) {
        throw new ErroHttp(422, 'recusado', 'O modelo não quis responder a esta pergunta. Tente escrever de outro jeito.');
      }
      throw e;
    }
  });
};

export default rotas;

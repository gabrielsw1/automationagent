// Rotas do widget (/api/widget): ver docs/arquitetura.md, seção "API do widget".
// O widget roda no navegador da pessoa, dentro do sistema anfitrião. A chave pública do snippet diz
// de qual empresa ele é; a identidade vem do snippet assinado (HMAC do ID do usuário, ou do ID com
// nome, e-mail e perfis). Depois disso, um token curto, que leva a empresa, vale para as demais rotas.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  fmt,
  type ConversaWidget,
  type ItemRecente,
  type PaginaContexto,
  type Sugestao,
  type UsuarioSistema,
  type WidgetConfigPublica,
  type WidgetInicio,
  textoAssinado,
} from '@copiloto/shared';
import { assinaturaValida, criarTokenWidget, lerTokenWidget } from '../auth/widget.ts';
import { ErroConexaoSistema } from '../adaptadores/tipos.ts';
import { ctxDe, type Contexto } from '../contexto.ts';
import { agoraIso } from '../db/banco.ts';
import { assinarArquivo, caminhoArquivo, type Ator } from '../execucao/motor.ts';
import { lerExecucao } from '../execucao/registro.ts';
import { normalizar } from '../agente/extracao.ts';
import { podeExecutar } from '../servicos/catalogo.ts';
import type { ConversaLinha } from '../servicos/conversas.ts';
import { ErroHttp, naoEncontrado, pedidoInvalido, semPermissao } from '../util/erros.ts';
import { novoId } from '../util/ids.ts';

export interface SessaoWidget {
  /** Contexto da empresa do widget (vem do token). */
  ctx: Contexto;
  usuario: UsuarioSistema;
  /** Token de teste do console: usa rascunhos e nada é gravado no sistema. */
  teste: boolean;
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    widget?: SessaoWidget;
  }
}

const Pagina = z
  .object({ secao: z.string().max(120).optional(), titulo: z.string().max(200).optional(), url: z.string().max(2000).optional() })
  .optional();

// Nome, e-mail e perfis vêm assinados junto com o ID (sem quebra de linha, que separa as partes).
const SemQuebra = z.string().regex(/^[^\r\n]*$/);
const PedidoInicio = z.object({
  chave: z.string().min(1).max(200),
  usuario: z.string().min(1).max(200),
  assinatura: z.string().max(200).optional(),
  nome: SemQuebra.max(200).optional(),
  email: SemQuebra.max(200).optional(),
  perfis: z.array(SemQuebra.min(1).max(80).regex(/^[^,]*$/)).max(50).optional(),
  pagina: Pagina,
});

const PedidoMensagem = z.object({
  texto: z.string().max(4000).default(''),
  contexto: Pagina,
  anexos: z.array(z.string().max(80)).max(5).optional(),
  idCliente: z.string().max(80).optional(),
});

const TIPOS_ANEXO: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const LIMITE_ANEXO = 25 * 1024 * 1024;

function hostDe(origem: string | undefined): string | null {
  if (!origem) return null;
  try {
    return new URL(origem).host;
  } catch {
    return null;
  }
}

function localhost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;
  // Por empresa: usuários lidos do sistema (1 minuto) e quando o widget foi visto pela última vez.
  const cacheUsuarios = new WeakMap<Contexto, Map<string, { em: number; u: UsuarioSistema }>>();
  const ultimaInstalacao = new WeakMap<Contexto, number>();

  async function usuarioPorId(ctx: Contexto, id: string): Promise<UsuarioSistema | null> {
    let cache = cacheUsuarios.get(ctx);
    if (!cache) cacheUsuarios.set(ctx, (cache = new Map()));
    const c = cache.get(id);
    if (c && Date.now() - c.em < 60_000) return c.u;
    const u = await ctx.adaptador.buscarUsuario(id);
    if (u) cache.set(id, { em: Date.now(), u });
    return u;
  }

  /** Contexto de uma empresa ativa, ou o erro que o widget mostra. */
  function contextoDaEmpresa(empresaId: string | undefined, erro: () => ErroHttp): Contexto {
    const empresa = empresaId ? plataforma.empresa(empresaId) : undefined;
    if (!empresa) throw erro();
    if (empresa.status !== 'ativa') {
      throw new ErroHttp(403, 'empresa_suspensa', 'O copiloto desta empresa está pausado. Fale com o administrador do sistema.');
    }
    return plataforma.contexto(empresa.id);
  }

  /** Lê o token (cabeçalho ou ?token=), a empresa e a pessoa. Rotas públicas: /iniciar e arquivos com link assinado. */
  app.addHook('onRequest', async (request) => {
    const rota = request.routeOptions.url ?? '';
    if (rota.endsWith('/iniciar')) return;
    const cabecalho = request.headers.authorization;
    const token =
      (cabecalho?.startsWith('Bearer ') ? cabecalho.slice(7) : undefined) ?? (request.query as { token?: string } | undefined)?.token;
    if (rota.endsWith('/arquivos/:nome') && !token) {
      // Link assinado (recibo): ?e=<empresa>&chave=<assinatura>. A assinatura é conferida na rota.
      const empresa = (request.query as { e?: string } | undefined)?.e;
      request.ctx = contextoDaEmpresa(empresa, () => naoEncontrado('Arquivo'));
      return;
    }
    const dados = lerTokenWidget(token, plataforma.config.segredoSessao);
    const expirada = () => new ErroHttp(401, 'sessao_expirada', 'Sua sessão do copiloto expirou. Recarregue a página.');
    if (!dados) throw expirada();
    const ctx = contextoDaEmpresa(dados.e, expirada);
    let usuario: UsuarioSistema | null;
    try {
      usuario = await usuarioPorId(ctx, dados.u);
    } catch {
      throw new ErroHttp(503, 'sistema_indisponivel', `Não consegui falar com o ${ctx.adaptador.nome} agora.`);
    }
    if (!usuario) throw new ErroHttp(401, 'usuario_nao_encontrado', 'Seu usuário não foi encontrado no sistema.');
    request.ctx = ctx;
    request.widget = { ctx, usuario, teste: dados.t === 1, token: token! };
  });

  function sessao(request: FastifyRequest): SessaoWidget {
    if (!request.widget) throw new ErroHttp(401, 'sessao_expirada', 'Sua sessão do copiloto expirou. Recarregue a página.');
    return request.widget;
  }

  const canal = (s: SessaoWidget) => (s.teste ? 'teste' : 'widget') as 'teste' | 'widget';

  function configPublica(ctx: Contexto, teste: boolean): WidgetConfigPublica {
    const { dominios: _d, ...publica } = ctx.configuracoes.ler(teste ? 'widget_rascunho' : 'widget_publicado');
    return publica;
  }

  function sugestoesPara(ctx: Contexto, usuario: UsuarioSistema, teste: boolean, pagina?: PaginaContexto | null): Sugestao[] {
    const config = configPublica(ctx, teste);
    const tarefas = ctx.catalogo.emUso(usuario, teste).filter((t) => podeExecutar(t.definicao, usuario.perfis));
    const secao = normalizar(pagina?.secao ?? '');
    const daPagina = tarefas.filter((t) => secao && t.definicao.contextos.some((c) => normalizar(c) === secao));
    const lista: Sugestao[] = [];
    const vistos = new Set<string>();
    const add = (rotulo: string, mensagem = rotulo) => {
      const k = normalizar(rotulo);
      if (vistos.has(k) || lista.length >= 4) return;
      vistos.add(k);
      lista.push({ rotulo, mensagem });
    };
    for (const t of daPagina) add(t.definicao.nome);
    for (const s of config.sugestoes) {
      // Sugestão do console que é uma tarefa só aparece se a pessoa puder fazê-la.
      const tarefa = ctx.catalogo.emUso(usuario, teste).find((t) => normalizar(t.definicao.nome) === normalizar(s));
      if (tarefa && !podeExecutar(tarefa.definicao, usuario.perfis)) continue;
      add(s);
    }
    for (const t of tarefas) add(t.definicao.nome);
    return lista;
  }

  function recentes(ctx: Contexto, usuario: UsuarioSistema): ItemRecente[] {
    return ctx.banco
      .todos<{ id: string; tarefa_nome: string; status: ItemRecente['status']; criado_em: string; resultado: string | null; dados: string }>(
        `SELECT id, tarefa_nome, status, criado_em, resultado, dados FROM execucoes
         WHERE usuario_id = ? AND canal = 'widget' AND status NOT IN ('aguardando_confirmacao', 'cancelada')
         ORDER BY criado_em DESC LIMIT 5`,
        usuario.id,
      )
      .map((l) => {
        const resultado = l.resultado ? (JSON.parse(l.resultado) as { titulo?: string }) : null;
        const principal = Object.values(JSON.parse(l.dados || '{}') as Record<string, string>)[0];
        return {
          execucaoId: l.id,
          titulo: resultado?.titulo ?? `${l.tarefa_nome}${principal ? ` · ${principal}` : ''}`,
          status: l.status,
          quando: l.criado_em,
        };
      });
  }

  function inicio(s: SessaoWidget, pagina?: PaginaContexto | null): WidgetInicio {
    const { ctx } = s;
    const aberta = ctx.conversas.emAberto(s.usuario.id, canal(s));
    return {
      token: s.token,
      usuario: { id: s.usuario.id, nome: s.usuario.nome, primeiroNome: fmt.primeiroNome(s.usuario.nome), perfis: s.usuario.perfis },
      config: configPublica(ctx, s.teste),
      sugestoes: sugestoesPara(ctx, s.usuario, s.teste, pagina ?? aberta?.contexto),
      recentes: recentes(ctx, s.usuario),
      conversaId: aberta?.id ?? null,
      modoSimulado: ctx.llm.simulado,
      modoTeste: s.teste,
      pausa: s.teste ? null : ctx.gastos.pausaAtiva(),
    };
  }

  function conversaDe(s: SessaoWidget, id: string): ConversaLinha {
    const c = s.ctx.conversas.buscar(id);
    if (!c || c.usuarioId !== s.usuario.id) throw naoEncontrado('Conversa');
    return c;
  }

  function paraWidget(ctx: Contexto, c: ConversaLinha): ConversaWidget {
    return { id: c.id, mensagens: ctx.conversas.mensagens(c.id), estado: c.estado, contexto: c.contexto };
  }

  function ator(s: SessaoWidget): Ator {
    return { tipo: 'usuario', id: s.usuario.id, nome: s.usuario.nome };
  }

  function execucaoDe(s: SessaoWidget, id: string) {
    const e = lerExecucao(s.ctx.banco, id);
    if (!e || e.usuarioId !== s.usuario.id) throw naoEncontrado('Execução');
    return e;
  }

  // ------------------------------------------------------------ início

  app.post('/iniciar', async (request) => {
    const r = PedidoInicio.safeParse(request.body);
    if (!r.success) throw pedidoInvalido('O snippet do copiloto está incompleto (data-chave e data-usuario são obrigatórios).');
    const { chave, usuario: usuarioId, assinatura, pagina, nome, email, perfis } = r.data;
    const ctx = contextoDaEmpresa(
      plataforma.empresaPorChave(chave)?.id,
      () => new ErroHttp(401, 'chave_invalida', 'A chave pública do widget não confere. Copie o trecho de instalação de novo no console.'),
    );
    const origem = request.headers.origin ?? request.headers.referer;
    const host = hostDe(origem);
    const { dominios } = ctx.configuracoes.ler('widget_publicado');
    if (host && !localhost(host) && !dominios.some((d) => d === host || d === host.split(':')[0])) {
      throw new ErroHttp(403, 'dominio_nao_liberado', `O domínio ${host} não está liberado para o widget. Libere em Canais, no console.`);
    }
    const identidade = { nome, email, perfis };
    // WIDGET_EXIGIR_ASSINATURA=0 só vale para a demonstração: nas empresas clientes, sem assinatura
    // qualquer um poderia se passar por qualquer pessoa.
    const exigir = ctx.config.exigirAssinatura || !ctx.empresa.demo;
    if (exigir && !assinaturaValida(textoAssinado(usuarioId, identidade), assinatura, ctx.config.segredoWidget)) {
      throw new ErroHttp(401, 'assinatura_invalida', 'A assinatura do usuário no snippet não confere (data-assinatura).');
    }
    let usuario: UsuarioSistema | null;
    try {
      // Conector só pela tela: o snippet assinado é quem diz o nome e os perfis da pessoa
      // (com só o ID, a pessoa entra sem perfis e com o ID no lugar do nome).
      const aprender = ctx.adaptador.aprenderUsuario;
      if (aprender && (nome || email || perfis || !(await ctx.adaptador.buscarUsuario(usuarioId)))) {
        await aprender({ id: usuarioId, nome: nome?.trim() || usuarioId, email: email?.trim() ?? '', perfis: (perfis ?? []).map((p) => p.trim()) });
        cacheUsuarios.get(ctx)?.delete(usuarioId);
      }
      usuario = await usuarioPorId(ctx, usuarioId);
    } catch (e) {
      if (e instanceof ErroConexaoSistema) throw new ErroHttp(503, 'sistema_indisponivel', `Não consegui falar com o ${ctx.adaptador.nome} agora.`);
      throw e;
    }
    if (!usuario) throw new ErroHttp(404, 'usuario_nao_encontrado', 'Este usuário não existe no sistema.');
    // "Detectado em ..." na tela Canais (no máximo uma gravação por minuto).
    if (host && Date.now() - (ultimaInstalacao.get(ctx) ?? 0) > 60_000) {
      ultimaInstalacao.set(ctx, Date.now());
      ctx.configuracoes.gravar('widget_instalacao', { origem: origem ? new URL(origem).origin : host, vistoEm: agoraIso() }, null);
    }
    const token = criarTokenWidget({ e: ctx.empresa.id, u: usuario.id }, ctx.config.segredoSessao, 12);
    const aberta = ctx.conversas.emAberto(usuario.id, 'widget');
    if (aberta && pagina) ctx.conversas.atualizarContexto(aberta.id, pagina);
    return inicio({ ctx, usuario, teste: false, token }, pagina);
  });

  app.get('/sessao', async (request) => inicio(sessao(request)));

  // ------------------------------------------------------------ conversas

  app.get('/conversa', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const c = ctx.conversas.emAberto(s.usuario.id, canal(s));
    return c ? paraWidget(ctx, c) : null;
  });

  app.post('/conversas', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const corpo = z.object({ contexto: Pagina }).safeParse(request.body ?? {});
    const aberta = ctx.conversas.emAberto(s.usuario.id, canal(s));
    if (aberta) ctx.conversas.encerrar(aberta.id);
    const c = ctx.conversas.criar({
      usuarioId: s.usuario.id,
      usuarioNome: s.usuario.nome,
      canal: canal(s),
      usarRascunhos: s.teste,
      contexto: corpo.success ? (corpo.data.contexto ?? null) : null,
    });
    return paraWidget(ctx, c);
  });

  app.get('/conversas/:id', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    return paraWidget(ctx, conversaDe(s, (request.params as { id: string }).id));
  });

  app.post('/conversas/:id/mensagens', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const c = conversaDe(s, (request.params as { id: string }).id);
    const r = PedidoMensagem.safeParse(request.body);
    if (!r.success) throw pedidoInvalido('Mensagem inválida.');
    const { texto, contexto, anexos, idCliente } = r.data;
    if (idCliente) {
      const ja = ctx.conversas.porIdCliente(c.id, idCliente);
      if (ja) return { mensagem: ja };
    }
    const nomesAnexos: string[] = [];
    for (const id of anexos ?? []) {
      const a = ctx.banco.um<{ nome: string }>('SELECT nome FROM anexos WHERE id = ? AND usuario_id = ?', id, s.usuario.id);
      if (!a) throw pedidoInvalido('Anexo não encontrado.');
      ctx.banco.executar('UPDATE anexos SET conversa_id = ? WHERE id = ?', c.id, id);
      nomesAnexos.push(a.nome);
    }
    if (!texto.trim() && !nomesAnexos.length) throw pedidoInvalido('Escreva uma mensagem.');
    if (c.encerradaEm) throw new ErroHttp(409, 'conversa_encerrada', 'Esta conversa foi encerrada. Comece uma nova.');
    if (contexto) ctx.conversas.atualizarContexto(c.id, contexto);
    const textoFinal = texto.trim() || `Enviei ${nomesAnexos.length === 1 ? 'um anexo' : 'anexos'}: ${nomesAnexos.join(', ')}`;
    const mensagem = ctx.conversas.adicionar(c.id, {
      autor: 'usuario',
      texto: textoFinal,
      idCliente,
      ...(nomesAnexos.length ? { nota: `Anexos: ${nomesAnexos.join(', ')}` } : {}),
    });
    // O agente responde em segundo plano; a resposta chega pelo SSE.
    void ctx.agente.aoMensagem(c.id, textoFinal, { anexos: nomesAnexos });
    return { mensagem };
  });

  app.get('/eventos', async (request, reply) => {
    const s = sessao(request);
    const { ctx } = s;
    const conversaId = (request.query as { conversa?: string }).conversa;
    if (!conversaId) throw pedidoInvalido('Informe a conversa.');
    conversaDe(s, conversaId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n: conectado\n\n');
    const parar = ctx.eventos.ouvirConversa(conversaId, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const batimento = setInterval(() => res.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(batimento);
      parar();
    });
  });

  // ------------------------------------------------------------ execuções

  const ip = (request: FastifyRequest) => request.ip;

  app.post('/execucoes/:id/confirmar', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const e = execucaoDe(s, (request.params as { id: string }).id);
    await ctx.motor.confirmar(e.id, s.usuario.id, ip(request));
    return { ok: true };
  });

  app.post('/execucoes/:id/corrigir', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const e = execucaoDe(s, (request.params as { id: string }).id);
    await ctx.motor.corrigir(e.id, s.usuario.id);
    return { ok: true };
  });

  app.post('/execucoes/:id/cancelar', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const e = execucaoDe(s, (request.params as { id: string }).id);
    await ctx.motor.cancelar(e.id, ator(s));
    return { ok: true };
  });

  app.post('/execucoes/:id/desfazer', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const e = execucaoDe(s, (request.params as { id: string }).id);
    await ctx.motor.desfazer(e.id, ator(s));
    return { ok: true };
  });

  app.post('/execucoes/:id/tentar', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const e = execucaoDe(s, (request.params as { id: string }).id);
    const id = await ctx.motor.reexecutar(e.id, ator(s));
    return { ok: true, id };
  });

  app.post('/execucoes/:id/atualizar-existente', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const e = execucaoDe(s, (request.params as { id: string }).id);
    await ctx.motor.atualizarExistente(e.id, s.usuario.id);
    return { ok: true };
  });

  app.get('/execucoes/:id/arquivos/:nome', async (request, reply) => {
    const ctx = ctxDe(request);
    const { id, nome } = request.params as { id: string; nome: string };
    const chave = (request.query as { chave?: string }).chave;
    const e = lerExecucao(ctx.banco, id);
    if (!e) throw naoEncontrado('Arquivo');
    if (request.widget) {
      if (e.usuarioId !== request.widget.usuario.id) throw naoEncontrado('Arquivo');
    } else {
      const esperada = assinarArquivo(ctx.empresa.id, id, nome, ctx.config.segredoSessao);
      if (!chave || chave.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(chave), Buffer.from(esperada))) {
        throw semPermissao('Link de arquivo inválido.');
      }
    }
    const arquivo = caminhoArquivo(ctx.config.dirDados, id, nome);
    if (!arquivo) throw naoEncontrado('Arquivo');
    const tipo = TIPOS_ANEXO[path.extname(arquivo).toLowerCase()] ?? 'application/octet-stream';
    return reply
      .header('content-type', tipo)
      .header('content-disposition', `attachment; filename="${path.basename(arquivo).replace(/"/g, '')}"`)
      .send(fs.createReadStream(arquivo));
  });

  // ------------------------------------------------------------ aprovações, pessoa, avaliação

  app.post('/aprovacoes/:id/enviar', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    await ctx.motor.enviarAprovacao((request.params as { id: string }).id, s.usuario.id);
    return { ok: true };
  });

  app.post('/aprovacoes/:id/cancelar', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const a = ctx.banco.um<{ execucao_id: string; solicitante_id: string }>(
      'SELECT execucao_id, solicitante_id FROM aprovacoes WHERE id = ?',
      (request.params as { id: string }).id,
    );
    if (!a || a.solicitante_id !== s.usuario.id) throw naoEncontrado('Pedido de aprovação');
    await ctx.motor.cancelar(a.execucao_id, ator(s));
    return { ok: true };
  });

  app.post('/conversas/:id/humano', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const c = conversaDe(s, (request.params as { id: string }).id);
    const motivo = z.object({ motivo: z.string().max(500).optional() }).safeParse(request.body ?? {});
    await ctx.atendimento.pedirPessoa(c.id, (motivo.success && motivo.data.motivo) || 'A pessoa pediu para falar com alguém.');
    return { ok: true };
  });

  app.post('/mensagens/:id/feedback', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const r = z.object({ valor: z.enum(['util', 'nao_util']) }).safeParse(request.body);
    if (!r.success) throw pedidoInvalido('Avaliação inválida.');
    const m = ctx.conversas.mensagem((request.params as { id: string }).id);
    if (!m) throw naoEncontrado('Mensagem');
    conversaDe(s, m.conversaId);
    ctx.conversas.atualizar(m.id, (x) => {
      x.feedback = r.data.valor;
    });
    // Resposta da base marcada como não útil vira pergunta sem resposta para a equipe revisar.
    if (r.data.valor === 'nao_util' && m.blocos.some((b) => b.tipo === 'fontes')) {
      const anteriores = ctx.conversas.mensagens(m.conversaId);
      const i = anteriores.findIndex((x) => x.id === m.id);
      const pergunta = anteriores
        .slice(0, i)
        .reverse()
        .find((x) => x.autor === 'usuario' && x.texto)?.texto;
      if (pergunta) ctx.conhecimento.registrarSemResposta(pergunta, 'resposta_nao_ajudou');
    }
    return { ok: true };
  });

  app.post('/anexos', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const arquivo = await request.file();
    if (!arquivo) throw pedidoInvalido('Envie um arquivo no campo "arquivo".');
    const ext = path.extname(arquivo.filename).toLowerCase();
    if (!TIPOS_ANEXO[ext]) throw pedidoInvalido('Tipo de arquivo não aceito. Envie PDF, imagem, planilha, DOCX ou TXT.');
    const buffer = await arquivo.toBuffer();
    if (buffer.length > LIMITE_ANEXO) throw new ErroHttp(413, 'arquivo_grande', 'O arquivo passa de 25 MB.');
    const id = novoId('anx');
    const dir = path.join(ctx.config.dirDados, 'anexos');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `${id}${ext}`);
    fs.writeFileSync(destino, buffer);
    const nome = path.basename(arquivo.filename).slice(0, 120);
    ctx.banco.inserir('anexos', {
      id,
      usuario_id: s.usuario.id,
      nome,
      tipo: TIPOS_ANEXO[ext],
      tamanho: buffer.length,
      arquivo: destino,
      criado_em: agoraIso(),
    });
    return { id, nome, tipo: TIPOS_ANEXO[ext], tamanho: buffer.length };
  });

  app.post('/proativa', async (request) => {
    const s = sessao(request);
    const { ctx } = s;
    const r = z.object({ pagina: z.string().max(120), segundosParado: z.number().min(0).max(3600) }).safeParse(request.body);
    if (!r.success) throw pedidoInvalido('Pedido inválido.');
    const config = configPublica(ctx, s.teste);
    if (!config.proativa.ativa || r.data.segundosParado < config.proativa.segundosParado) return { sugestao: null };
    const pagina = normalizar(r.data.pagina);
    const tarefa = ctx.catalogo
      .emUso(s.usuario, s.teste)
      .find(
        (t) =>
          t.definicao.sugestaoProativa &&
          podeExecutar(t.definicao, s.usuario.perfis) &&
          t.definicao.contextos.some((c) => normalizar(c) === pagina),
      );
    if (!tarefa) return { sugestao: null };
    return {
      sugestao: {
        texto: tarefa.definicao.sugestaoProativa!,
        detalhe: 'Me passe os dados numa mensagem. Eu confiro tudo com você antes de gravar.',
        mensagem: tarefa.definicao.nome,
      },
    };
  });

  app.get('/recentes', async (request) => {
    const s = sessao(request);
    return recentes(s.ctx, s.usuario);
  });
};

export default rotas;

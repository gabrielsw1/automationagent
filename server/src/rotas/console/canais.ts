// Canais e widget (C8): rascunho da configuração do widget, publicar, descartar, logo e instalação.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Canais, ConfigWidget, SegredoWidget } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';
import { comUrlDoLogo, guardarLogo, LIMITE_LOGO, limparLogos, LogoRecusado } from '../../servicos/logo.ts';

/** Domínio sem protocolo, caminho nem barra (aceita porta). Ex.: app.horizonte.com.br, localhost:4000. */
export function normalizarDominio(entrada: string): string {
  let d = entrada.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.split(/[/?#]/)[0] ?? '';
  return d.replace(/\.$/, '');
}

const DOMINIO = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

const EsquemaConfig = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao assistente.').max(40, 'O nome pode ter até 40 caracteres.'),
  boasVindas: z
    .string()
    .trim()
    .min(1, 'Escreva a mensagem de boas-vindas.')
    .max(280, 'A mensagem de boas-vindas pode ter até 280 caracteres.'),
  sugestoes: z
    .array(z.string().trim().min(1, 'Uma sugestão está vazia.').max(60, 'Cada sugestão pode ter até 60 caracteres.'))
    .max(4, 'Use no máximo 4 sugestões.'),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a cor no formato #RRGGBB.'),
  posicao: z.enum(['direita', 'esquerda']),
  atalho: z.boolean(),
  proativa: z.object({
    ativa: z.boolean(),
    segundosParado: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  }),
  atendimentoHumano: z.object({
    horario: z.string().trim().max(120, 'O horário pode ter até 120 caracteres.'),
  }),
  dominios: z
    .array(z.string())
    .max(20, 'Libere no máximo 20 domínios.')
    .transform((lista, c) => {
      const saida: string[] = [];
      for (const bruto of lista) {
        const d = normalizarDominio(bruto);
        if (!d) continue;
        if (!DOMINIO.test(d)) {
          c.addIssue({ code: 'custom', message: `“${bruto}” não parece um domínio. Use, por exemplo, app.suaempresa.com.br.` });
          return z.NEVER;
        }
        if (!saida.includes(d)) saida.push(d);
      }
      return saida;
    }),
});

const Pedido = z.object({ config: EsquemaConfig });

const ROTULOS: Record<keyof ConfigWidget, string> = {
  nome: 'nome',
  boasVindas: 'boas-vindas',
  sugestoes: 'sugestões',
  cor: 'cor',
  posicao: 'posição',
  atalho: 'atalho',
  proativa: 'sugestão proativa',
  atendimentoHumano: 'horário do atendimento',
  dominios: 'domínios',
  logo: 'logo',
};

/** O que conta como mudança em cada campo (o logo, pelo arquivo; o resto, pelo valor). */
function valorComparado(c: ConfigWidget, k: keyof ConfigWidget): string {
  if (k === 'logo') return c.logo?.arquivo ?? '';
  return JSON.stringify(c[k]);
}

/** Campos que mudaram entre duas configurações, em português. */
export function camposAlterados(a: ConfigWidget, b: ConfigWidget): string[] {
  return (Object.keys(ROTULOS) as (keyof ConfigWidget)[])
    .filter((k) => valorComparado(a, k) !== valorComparado(b, k))
    .map((k) => ROTULOS[k]);
}

/** Apaga da pasta da empresa os logos que o rascunho e a publicação não usam mais. */
function limparLogosSemUso(ctx: Contexto) {
  const { configuracoes } = ctx;
  limparLogos(ctx.config.dirDados, [configuracoes.ler('widget_publicado').logo?.arquivo, configuracoes.ler('widget_rascunho').logo?.arquivo]);
}

export function lerCanais(ctx: Contexto): Canais {
  const { configuracoes, config, empresa } = ctx;
  const publicada = comUrlDoLogo(configuracoes.ler('widget_publicado'), config.urlPublica, empresa.chavePublica);
  const rascunho = comUrlDoLogo(configuracoes.ler('widget_rascunho'), config.urlPublica, empresa.chavePublica);
  return {
    publicada,
    rascunho,
    temAlteracoes: camposAlterados(publicada, rascunho).length > 0,
    chavePublica: empresa.chavePublica,
    urlScript: `${config.urlPublica.replace(/\/+$/, '')}/copiloto.js`,
    instalacao: configuracoes.ler('widget_instalacao'),
    conector: empresa.sistema.conector,
  };
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  app.get('/', { preHandler: exigir('ver') }, async (request): Promise<Canais> => lerCanais(ctxDe(request)));

  app.put('/rascunho', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const ctx = ctxDe(request);
    const { configuracoes, auditoria, banco } = ctx;
    const m = membro(request);
    const r = Pedido.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Configuração inválida.');
    const anterior = configuracoes.ler('widget_rascunho');
    // O logo só muda pelas rotas próprias (enviar e remover); aqui ele fica como está.
    const nova: ConfigWidget = { ...r.data.config, logo: anterior.logo ?? null };
    const mudou = camposAlterados(anterior, nova);
    if (mudou.length === 0) return lerCanais(ctx);
    configuracoes.gravar('widget_rascunho', nova, m.nome);
    // O console salva o rascunho enquanto a pessoa digita: um registro por pessoa a cada 10 minutos basta.
    const recente = banco.um<{ n: number }>(
      `SELECT COUNT(*) AS n FROM auditoria WHERE ator = ? AND acao = 'editou o rascunho do widget' AND ts >= ?`,
      m.nome,
      new Date(Date.now() - 10 * 60_000).toISOString(),
    )!.n;
    if (recente === 0) auditoria.registrar(m.nome, 'editou o rascunho do widget', 'Canais e widget', `Mudou ${mudou.join(', ')}`);
    return lerCanais(ctx);
  });

  app.post('/publicar', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const ctx = ctxDe(request);
    const { configuracoes, auditoria } = ctx;
    const m = membro(request);
    const publicada = configuracoes.ler('widget_publicado');
    const rascunho = configuracoes.ler('widget_rascunho');
    const mudou = camposAlterados(publicada, rascunho);
    if (mudou.length === 0) return lerCanais(ctx);
    configuracoes.gravar('widget_publicado', rascunho, m.nome);
    plataforma.atualizarDominios(ctx.empresa.id, rascunho.dominios);
    auditoria.registrar(m.nome, 'publicou a configuração do widget', 'Canais e widget', `Mudou ${mudou.join(', ')}`);
    limparLogosSemUso(ctx);
    return lerCanais(ctx);
  });

  app.post('/descartar', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const ctx = ctxDe(request);
    const { configuracoes, auditoria } = ctx;
    const m = membro(request);
    const publicada = configuracoes.ler('widget_publicado');
    const rascunho = configuracoes.ler('widget_rascunho');
    if (camposAlterados(publicada, rascunho).length === 0) return lerCanais(ctx);
    configuracoes.gravar('widget_rascunho', publicada, m.nome);
    auditoria.registrar(m.nome, 'descartou as alterações do widget', 'Canais e widget');
    limparLogosSemUso(ctx);
    return lerCanais(ctx);
  });

  // Logo: entra no rascunho (como as outras mudanças) e vale no widget depois de "Publicar alterações".
  app.post('/logo', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const ctx = ctxDe(request);
    const { configuracoes, auditoria } = ctx;
    const m = membro(request);
    let arquivo;
    try {
      arquivo = await request.file({ limits: { fileSize: LIMITE_LOGO + 1, files: 1 } });
    } catch {
      throw pedidoInvalido('Envie o logo como arquivo, no campo "arquivo".');
    }
    if (!arquivo || arquivo.fieldname !== 'arquivo') throw pedidoInvalido('Envie o logo como arquivo, no campo "arquivo".');
    let conteudo: Buffer;
    try {
      conteudo = await arquivo.toBuffer();
    } catch {
      throw new LogoRecusado('O logo passa de 1 MB. O limite é 1 MB.', 413);
    }
    if (arquivo.file.truncated) throw new LogoRecusado('O logo passa de 1 MB. O limite é 1 MB.', 413);
    const logo = guardarLogo(ctx.config.dirDados, conteudo, arquivo.filename);
    const rascunho = configuracoes.ler('widget_rascunho');
    configuracoes.gravar('widget_rascunho', { ...rascunho, logo }, m.nome);
    auditoria.registrar(m.nome, 'enviou o logo do widget', 'Canais e widget', `${logo.nome} (${Math.max(1, Math.round(logo.tamanho / 1024))} KB)`);
    limparLogosSemUso(ctx);
    return lerCanais(ctx);
  });

  app.delete('/logo', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const ctx = ctxDe(request);
    const { configuracoes, auditoria } = ctx;
    const m = membro(request);
    const rascunho = configuracoes.ler('widget_rascunho');
    if (!rascunho.logo) return lerCanais(ctx);
    configuracoes.gravar('widget_rascunho', { ...rascunho, logo: null }, m.nome);
    auditoria.registrar(m.nome, 'removeu o logo do widget', 'Canais e widget', rascunho.logo.nome);
    limparLogosSemUso(ctx);
    return lerCanais(ctx);
  });

  // Segredo que o sistema da empresa usa para assinar quem está logado no snippet. Só Admin vê.
  function semSegredoProprio(ctx: Contexto) {
    if (ctx.empresa.demo) {
      throw new ErroHttp(
        409,
        'segredo_do_ambiente',
        'Na demonstração o segredo vem da variável WIDGET_SEGREDO do servidor, a mesma que o Horizonte usa.',
      );
    }
  }

  app.get('/segredo', { preHandler: exigir('administrar') }, async (request): Promise<SegredoWidget> => {
    const ctx = ctxDe(request);
    semSegredoProprio(ctx);
    ctx.auditoria.registrar(membro(request).nome, 'viu o segredo do widget', 'Canais e widget');
    return { segredo: plataforma.segredoWidget(ctx.empresa) };
  });

  app.post('/segredo/novo', { preHandler: exigir('administrar') }, async (request): Promise<SegredoWidget> => {
    const ctx = ctxDe(request);
    semSegredoProprio(ctx);
    const segredo = plataforma.novoSegredoWidget(ctx.empresa.id);
    ctx.auditoria.registrar(
      membro(request).nome,
      'gerou um segredo novo do widget',
      'Canais e widget',
      'O segredo antigo parou de valer: o sistema precisa assinar com o novo.',
    );
    return { segredo };
  });
};

export default rotas;

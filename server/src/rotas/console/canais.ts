// Canais e widget (C8): rascunho da configuração do widget, publicar, descartar e instalação.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Canais, ConfigWidget } from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import type { Contexto } from '../../contexto.ts';
import { pedidoInvalido } from '../../util/erros.ts';

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
};

/** Campos que mudaram entre duas configurações, em português. */
export function camposAlterados(a: ConfigWidget, b: ConfigWidget): string[] {
  return (Object.keys(ROTULOS) as (keyof ConfigWidget)[])
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ROTULOS[k]);
}

export function lerCanais(ctx: Contexto): Canais {
  const { configuracoes, config } = ctx;
  const publicada = configuracoes.ler('widget_publicado');
  const rascunho = configuracoes.ler('widget_rascunho');
  return {
    publicada,
    rascunho,
    temAlteracoes: camposAlterados(publicada, rascunho).length > 0,
    chavePublica: configuracoes.ler('widget_chave_publica'),
    urlScript: `${config.urlPublica.replace(/\/+$/, '')}/copiloto.js`,
    instalacao: configuracoes.ler('widget_instalacao'),
  };
}

const rotas: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { configuracoes, auditoria, banco } = ctx;

  app.get('/', { preHandler: exigir('ver') }, async (): Promise<Canais> => lerCanais(ctx));

  app.put('/rascunho', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const m = membro(request);
    const r = Pedido.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Configuração inválida.');
    const anterior = configuracoes.ler('widget_rascunho');
    const mudou = camposAlterados(anterior, r.data.config);
    if (mudou.length === 0) return lerCanais(ctx);
    configuracoes.gravar('widget_rascunho', r.data.config, m.nome);
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
    const m = membro(request);
    const publicada = configuracoes.ler('widget_publicado');
    const rascunho = configuracoes.ler('widget_rascunho');
    const mudou = camposAlterados(publicada, rascunho);
    if (mudou.length === 0) return lerCanais(ctx);
    configuracoes.gravar('widget_publicado', rascunho, m.nome);
    auditoria.registrar(m.nome, 'publicou a configuração do widget', 'Canais e widget', `Mudou ${mudou.join(', ')}`);
    return lerCanais(ctx);
  });

  app.post('/descartar', { preHandler: exigir('editar') }, async (request): Promise<Canais> => {
    const m = membro(request);
    const publicada = configuracoes.ler('widget_publicado');
    const rascunho = configuracoes.ler('widget_rascunho');
    if (camposAlterados(publicada, rascunho).length === 0) return lerCanais(ctx);
    configuracoes.gravar('widget_rascunho', publicada, m.nome);
    auditoria.registrar(m.nome, 'descartou as alterações do widget', 'Canais e widget');
    return lerCanais(ctx);
  });
};

export default rotas;

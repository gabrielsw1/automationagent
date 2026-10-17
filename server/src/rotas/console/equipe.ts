// Equipe e limites (C9): membros e convites, limites de gasto, segurança e registro de auditoria.
// Registrado sem prefixo: as rotas ficam em /equipe, /limites, /seguranca e /auditoria.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  fmt,
  ROTULO_PERFIL,
  type Limites,
  type MembroEquipe,
  type PerfilEquipe,
  type RegistroAuditoria,
  type Seguranca,
} from '@copiloto/shared';
import { exigir, membro } from '../../auth/console.ts';
import type { Contexto } from '../../contexto.ts';
import { agoraIso } from '../../db/banco.ts';
import { conflito, naoEncontrado, pedidoInvalido } from '../../util/erros.ts';
import { novoId, tokenAleatorio } from '../../util/ids.ts';

const DIAS_CONVITE = 7;

const Perfil = z.enum(['admin', 'editor', 'suporte', 'leitor'], { error: 'Escolha um perfil.' });

const Convite = z.object({
  email: z
    .string({ error: 'Digite o e-mail da pessoa.' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Digite um e-mail válido, por exemplo nome@empresa.com.br.')),
  perfil: Perfil,
});

const TrocaPerfil = z.object({ perfil: Perfil });

const EsquemaLimites = z.object({
  mensal: z
    .number({ error: 'Digite o limite mensal em reais.' })
    .min(0, 'O limite mensal não pode ser negativo.')
    .max(10_000_000, 'Limite mensal alto demais.'),
  porUsuarioDia: z
    .number({ error: 'Digite quantas execuções cada usuário pode fazer por dia.' })
    .int('Use um número inteiro de execuções.')
    .min(1, 'Cada usuário precisa poder fazer pelo menos 1 execução por dia.')
    .max(10_000, 'Limite por usuário alto demais.'),
  alerta80: z.boolean(),
  aoAtingir: z.enum(['pausar_navegador', 'pausar_tudo']),
});

const EsquemaSeguranca = z.object({
  mascararPrints: z.boolean(),
  retencaoPrintsDias: z.union([z.literal(30), z.literal(90), z.literal(180)], {
    error: 'Escolha 30, 90 ou 180 dias.',
  }),
  retencaoConversasMeses: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)], {
    error: 'Escolha 3, 6, 12 ou 24 meses.',
  }),
});

const Antes = z.object({ antes: z.string().max(40).optional() });

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

interface LinhaMembro {
  id: string;
  nome: string | null;
  email: string;
  perfil: PerfilEquipe;
  status: 'ativo' | 'convidado';
  convite_token: string | null;
  convite_enviado_em: string | null;
  convite_expira_em: string | null;
  ultimo_acesso: string | null;
  criado_em: string;
}

function membroDe(l: LinhaMembro): MembroEquipe {
  const m: MembroEquipe = {
    id: l.id,
    nome: l.nome,
    email: l.email,
    perfil: l.perfil,
    status: l.status,
    ultimoAcesso: l.ultimo_acesso,
  };
  if (l.status === 'convidado') {
    m.conviteEnviadoEm = l.convite_enviado_em;
    m.conviteExpiraEm = l.convite_expira_em;
  }
  return m;
}

function quem(l: Pick<LinhaMembro, 'nome' | 'email'>): string {
  return l.nome ?? l.email;
}

function moeda(v: number): string {
  return fmt.moeda(v);
}

export function lerSeguranca(ctx: Contexto): Seguranca {
  return { ...ctx.configuracoes.ler('seguranca'), ...ctx.configuracoes.metadados('seguranca') };
}

const rotas: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { banco, auditoria, configuracoes, gastos, config } = ctx;

  const linha = (id: string): LinhaMembro => {
    const l = banco.um<LinhaMembro>('SELECT * FROM equipe WHERE id = ?', id);
    if (!l) throw naoEncontrado('Membro da equipe');
    return l;
  };

  const adminsAtivos = () =>
    banco.um<{ n: number }>("SELECT COUNT(*) AS n FROM equipe WHERE perfil = 'admin' AND status = 'ativo'")!.n;

  const linkConvite = (token: string) => `${config.urlConsole.replace(/\/+$/, '')}/convite/${token}`;

  const novoConvite = () => {
    const agora = new Date();
    return {
      convite_token: tokenAleatorio(24),
      convite_enviado_em: agora.toISOString(),
      convite_expira_em: new Date(agora.getTime() + DIAS_CONVITE * 86400_000).toISOString(),
    };
  };

  // ---------- Equipe ----------

  app.get('/equipe', { preHandler: exigir('ver') }, async (): Promise<MembroEquipe[]> => {
    return banco
      .todos<LinhaMembro>(
        `SELECT * FROM equipe ORDER BY CASE status WHEN 'ativo' THEN 0 ELSE 1 END,
         CASE perfil WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 WHEN 'suporte' THEN 2 ELSE 3 END, criado_em`,
      )
      .map(membroDe);
  });

  app.post('/equipe/convites', { preHandler: exigir('administrar') }, async (request) => {
    const m = membro(request);
    const d = validar(Convite, request.body);
    const existente = banco.um<LinhaMembro>('SELECT * FROM equipe WHERE email = ?', d.email);
    if (existente?.status === 'ativo') throw conflito(`${quem(existente)} já está na equipe.`);
    if (existente) throw conflito('Já existe um convite pendente para este e-mail. Use “Reenviar” para gerar um link novo.');
    const id = novoId('mbr');
    const convite = novoConvite();
    banco.inserir('equipe', {
      id,
      nome: null,
      email: d.email,
      perfil: d.perfil,
      status: 'convidado',
      ...convite,
      criado_em: agoraIso(),
    });
    auditoria.registrar(m.nome, 'convidou', d.email, `Perfil ${ROTULO_PERFIL[d.perfil]}`);
    return { membro: membroDe(linha(id)), linkConvite: linkConvite(convite.convite_token) };
  });

  app.post<{ Params: { id: string } }>('/equipe/:id/reenviar', { preHandler: exigir('administrar') }, async (request) => {
    const m = membro(request);
    const l = linha(request.params.id);
    if (l.status !== 'convidado') throw conflito(`${quem(l)} já aceitou o convite.`);
    const convite = novoConvite();
    banco.atualizar('equipe', l.id, convite);
    auditoria.registrar(m.nome, 'reenviou o convite', l.email, `Novo link válido por ${DIAS_CONVITE} dias`);
    return { membro: membroDe(linha(l.id)), linkConvite: linkConvite(convite.convite_token) };
  });

  app.put<{ Params: { id: string } }>(
    '/equipe/:id/perfil',
    { preHandler: exigir('administrar') },
    async (request): Promise<MembroEquipe> => {
      const m = membro(request);
      const { perfil } = validar(TrocaPerfil, request.body);
      const l = linha(request.params.id);
      if (l.perfil === perfil) return membroDe(l);
      if (l.perfil === 'admin' && l.status === 'ativo' && adminsAtivos() <= 1) {
        throw conflito('É o único admin: promova outra pessoa a Admin antes de mudar este perfil.');
      }
      banco.atualizar('equipe', l.id, { perfil });
      auditoria.registrar(
        m.nome,
        l.status === 'convidado' ? 'mudou o perfil do convite' : 'mudou o perfil',
        quem(l),
        `De ${ROTULO_PERFIL[l.perfil]} para ${ROTULO_PERFIL[perfil]}`,
      );
      return membroDe(linha(l.id));
    },
  );

  app.delete<{ Params: { id: string } }>('/equipe/:id', { preHandler: exigir('administrar') }, async (request) => {
    const m = membro(request);
    const l = linha(request.params.id);
    if (l.status === 'ativo') {
      if (l.id === m.id) throw conflito('Você não pode remover a si mesmo. Peça a outro Admin.');
      if (l.perfil === 'admin' && adminsAtivos() <= 1) {
        throw conflito('É o único admin e não pode ser removido.');
      }
    }
    banco.executar('DELETE FROM equipe WHERE id = ?', l.id);
    if (l.status === 'convidado') auditoria.registrar(m.nome, 'cancelou o convite', l.email);
    else auditoria.registrar(m.nome, 'removeu da equipe', quem(l), `Perfil ${ROTULO_PERFIL[l.perfil]}`);
    return { ok: true };
  });

  // ---------- Limites de gasto ----------

  // Como no design (Estados-Console): só Admin vê e muda os limites.
  app.get('/limites', { preHandler: exigir('administrar') }, async (): Promise<Limites> => gastos.limites());

  app.put('/limites', { preHandler: exigir('administrar') }, async (request): Promise<Limites> => {
    const m = membro(request);
    const d = validar(EsquemaLimites, request.body);
    const novo = { ...d, mensal: Math.round(d.mensal * 100) / 100 };
    const antes = configuracoes.ler('limites');
    const mudancas: string[] = [];
    if (antes.mensal !== novo.mensal) mudancas.push(`limite mensal de ${moeda(antes.mensal)} para ${moeda(novo.mensal)}`);
    if (antes.porUsuarioDia !== novo.porUsuarioDia) {
      mudancas.push(`limite por usuário de ${antes.porUsuarioDia} para ${novo.porUsuarioDia} execuções por dia`);
    }
    if (antes.alerta80 !== novo.alerta80) mudancas.push(novo.alerta80 ? 'ligou o alerta em 80%' : 'desligou o alerta em 80%');
    if (antes.aoAtingir !== novo.aoAtingir) {
      mudancas.push(
        novo.aoAtingir === 'pausar_tudo'
          ? 'ao atingir o limite: pausar tudo'
          : 'ao atingir o limite: pausar só o navegador',
      );
    }
    if (mudancas.length > 0) {
      configuracoes.gravar('limites', novo, m.nome);
      const texto = mudancas.join('; ');
      auditoria.registrar(m.nome, 'alterou os limites de gasto', 'Limites de gasto', texto.charAt(0).toUpperCase() + texto.slice(1));
    }
    return gastos.limites();
  });

  // ---------- Segurança e dados ----------

  app.get('/seguranca', { preHandler: exigir('ver') }, async (): Promise<Seguranca> => lerSeguranca(ctx));

  app.put('/seguranca', { preHandler: exigir('administrar') }, async (request): Promise<Seguranca> => {
    const m = membro(request);
    const d = validar(EsquemaSeguranca, request.body);
    const antes = configuracoes.ler('seguranca');
    const mudancas: string[] = [];
    if (antes.mascararPrints !== d.mascararPrints) {
      mudancas.push(d.mascararPrints ? 'Ligou a máscara de dados nos prints' : 'Desligou a máscara de dados nos prints');
    }
    if (antes.retencaoPrintsDias !== d.retencaoPrintsDias) {
      mudancas.push(`Prints guardados por ${d.retencaoPrintsDias} dias (antes ${antes.retencaoPrintsDias})`);
    }
    if (antes.retencaoConversasMeses !== d.retencaoConversasMeses) {
      mudancas.push(`Conversas guardadas por ${d.retencaoConversasMeses} meses (antes ${antes.retencaoConversasMeses})`);
    }
    if (mudancas.length > 0) {
      configuracoes.gravar('seguranca', d, m.nome);
      auditoria.registrar(m.nome, 'alterou segurança e dados', 'Segurança e dados', mudancas.join('; '));
    }
    return lerSeguranca(ctx);
  });

  // ---------- Registro de auditoria ----------

  app.get('/auditoria', { preHandler: exigir('administrar') }, async (request): Promise<RegistroAuditoria[]> => {
    const { antes } = validar(Antes, request.query);
    return auditoria.listar(50, antes || undefined);
  });
};

export default rotas;

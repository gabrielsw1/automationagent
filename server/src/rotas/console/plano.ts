// Plano e créditos (S5): o plano da empresa, os créditos do ciclo e para onde foram, as faturas, a
// forma de pagamento, pacotes, recarga automática e o pedido de mudança de plano.
// Só o Admin vê; a Starta no modo suporte também vê, mas não compra nem muda nada. A demonstração
// mostra números de exemplo, com compras e cobrança desligadas.
import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import {
  cnpjValido,
  formatarCnpj,
  precoEmReais,
  somenteDigitos,
  type DadosCobranca,
  type Fatura,
  type PacoteComprado,
  type PedidoMudancaPlano,
  type PlanoECreditos,
  type RecargaAutomatica,
} from '@copiloto/shared';
import { exigir, membro, type MembroLogado } from '../../auth/console.ts';
import { competenciaDe, deslocarCompetencia } from '../../cobranca/ciclo.ts';
import { demonstrativoPdf } from '../../cobranca/pdf.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import { emailMudancaPlano } from '../../email/modelos.ts';
import { naoEncontrado, pedidoInvalido, semPermissao } from '../../util/erros.ts';

const Recarga = z.object({
  ligada: z.boolean({ error: 'Diga se a recarga fica ligada.' }),
  limite: z.number().int('Use um número inteiro de créditos.').min(1, 'O limite é de pelo menos 1 crédito.').max(10_000_000).nullable(),
});

const Cobranca = z.object({
  razaoSocial: z.string({ error: 'Digite a razão social.' }).trim().min(2, 'Digite a razão social.').max(200),
  cnpj: z
    .string({ error: 'Digite o CNPJ.' })
    .trim()
    .refine((c) => cnpjValido(c), 'Esse CNPJ não é válido. Confira os números.'),
  emailCobranca: z
    .string({ error: 'Digite o e-mail que recebe as cobranças.' })
    .trim()
    .toLowerCase()
    .max(200)
    .pipe(z.email('Digite um e-mail válido, por exemplo financeiro@empresa.com.br.')),
  cep: z
    .string()
    .trim()
    .optional()
    .refine((c) => !c || somenteDigitos(c).length === 8, 'O CEP tem 8 números.'),
  numero: z.string().trim().max(20, 'Número do endereço muito longo.').optional(),
  metodo: z.enum(['boleto', 'cartao'], { error: 'Escolha boleto ou cartão.' }),
});

const Metodo = z.object({ metodo: z.enum(['boleto', 'cartao'], { error: 'Escolha boleto ou cartão.' }) });

const Mudanca = z.object({
  planoId: z.string({ error: 'Escolha um plano.' }).min(1, 'Escolha um plano.'),
  mensagem: z.string().trim().max(2000, 'Mensagem muito longa.').optional(),
});

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

/** Admin da empresa ou a Starta no modo suporte. */
const verPlano: preHandlerHookHandler = async (request) => {
  const m = membro(request);
  if (m.perfil !== 'admin' && !m.suporte) throw semPermissao('Só um Admin vê o plano e os créditos.');
};

function somenteLeitura(ctx: Contexto, m: MembroLogado): string | null {
  if (m.suporte) return 'Modo suporte: a Starta vê o plano e as faturas, mas só um Admin da empresa compra créditos ou muda o plano.';
  if (ctx.empresa.demo) return 'Demonstração: os números são de exemplo, e compras e cobrança ficam desligadas.';
  if (m.perfil !== 'admin') return 'Só um Admin pode mudar isso.';
  return null;
}

/** Para quem pode comprar e mudar: Admin da empresa, fora do modo suporte e da demonstração. */
function exigirAlterar(request: FastifyRequest): { ctx: Contexto; m: MembroLogado } {
  const ctx = ctxDe(request);
  const m = membro(request);
  const motivo = somenteLeitura(ctx, m);
  if (motivo) throw semPermissao(motivo);
  return { ctx, m };
}

function pedidoMudanca(ctx: Contexto): PedidoMudancaPlano | null {
  const c = ctx.plataforma.ultimoPedidoPlano(ctx.empresa.id);
  if (!c) return null;
  return { planoId: c.planoId ?? null, planoNome: (c.planoId && ctx.plataforma.plano(c.planoId)?.nome) || null, em: c.criadoEm };
}

function nomeArquivo(f: Fatura): string {
  return f.tipo === 'mensal' && f.competencia ? `fatura-${f.competencia}.pdf` : `pacote-creditos-${f.criadoEm.slice(0, 10)}.pdf`;
}

const rotas: FastifyPluginAsync = async (app) => {
  app.get('/plano', { preHandler: [exigir('ver'), verPlano] }, async (request): Promise<PlanoECreditos> => {
    const ctx = ctxDe(request);
    const m = membro(request);
    const { plataforma } = ctx;
    const empresa = plataforma.empresa(ctx.empresa.id)!;
    const plano = (empresa.planoId && plataforma.plano(empresa.planoId)) || null;
    const agora = new Date();
    const ciclo = ctx.creditos.ciclo(agora, competenciaDe(agora), plano);
    const anterior = deslocarCompetencia(ciclo.competencia, -1);
    const motivo = somenteLeitura(ctx, m);
    const preco = plano?.precoCreditoExtraCentavos ?? null;
    return {
      empresa: { nome: empresa.nome, cnpj: empresa.cnpj ? formatarCnpj(empresa.cnpj) : null, demo: empresa.demo, faixaUsuarios: empresa.faixaUsuarios },
      exemplo: empresa.demo,
      plano,
      situacao: empresa.status === 'suspensa' ? 'pausado' : empresa.fase,
      usuariosMes: ctx.creditos.usuariosMes(agora),
      renovaEm: ciclo.fim,
      ciclo,
      uso: { atual: ctx.creditos.uso(agora), anterior: ctx.creditos.uso(agora, anterior) },
      faturaAberta: plataforma.faturas.faturaAberta(empresa, agora),
      faturas: plataforma.faturas.listar(empresa.id),
      cobranca: plataforma.faturas.dadosCobranca(empresa.id),
      recarga: plataforma.faturas.recarga(empresa.id),
      pacote: {
        creditos: plano?.pacoteCreditos ?? 0,
        precoCentavos: plano && preco !== null ? plano.pacoteCreditos * preco : null,
        pendente: plataforma.faturas.pacotePendente(empresa.id),
      },
      pagamentos: {
        modo: plataforma.faturas.modo,
        notaFiscal: plataforma.faturas.notaFiscal,
        cartaoGuardado: plataforma.faturas.temCartaoGuardado(empresa.id),
      },
      limiteMensal: ctx.configuracoes.ler('limites').mensal,
      pedidoMudanca: pedidoMudanca(ctx),
      planos: plataforma.planos(),
      podeAlterar: motivo === null,
      motivoSomenteLeitura: motivo,
    };
  });

  app.post('/plano/pacotes', { preHandler: exigir('administrar') }, async (request): Promise<PacoteComprado> => {
    const { ctx, m } = exigirAlterar(request);
    const r = await ctx.plataforma.faturas.comprarPacote(ctx.empresa.id, { ip: request.ip });
    ctx.auditoria.registrar(m.nome, 'comprou um pacote de créditos', `${(r.fatura.creditos ?? 0).toLocaleString('pt-BR')} créditos`, precoEmReais(r.fatura.totalCentavos));
    return r;
  });

  app.put('/plano/recarga', { preHandler: exigir('administrar') }, async (request): Promise<RecargaAutomatica> => {
    const { ctx, m } = exigirAlterar(request);
    const d = validar(Recarga, request.body);
    const r = ctx.plataforma.faturas.definirRecarga(ctx.empresa.id, d, request.ip);
    ctx.auditoria.registrar(
      m.nome,
      r.ligada ? 'ligou a recarga automática' : 'desligou a recarga automática',
      'Plano e créditos',
      r.ligada && r.limite ? `Compra um pacote quando restarem menos de ${r.limite.toLocaleString('pt-BR')} créditos` : null,
    );
    return r;
  });

  app.put('/plano/cobranca', { preHandler: exigir('administrar') }, async (request): Promise<DadosCobranca> => {
    const { ctx, m } = exigirAlterar(request);
    const d = validar(Cobranca, request.body);
    const r = await ctx.plataforma.faturas.salvarCobranca(ctx.empresa.id, d);
    // O CNPJ da empresa é o mesmo da cobrança: o contexto aberto passa a ver o novo.
    ctx.empresa = ctx.plataforma.empresa(ctx.empresa.id) ?? ctx.empresa;
    ctx.auditoria.registrar(m.nome, 'alterou os dados de cobrança', 'Plano e créditos', `${d.razaoSocial} · ${formatarCnpj(d.cnpj)} · ${d.emailCobranca}`);
    return r;
  });

  app.put('/plano/metodo', { preHandler: exigir('administrar') }, async (request): Promise<DadosCobranca> => {
    const { ctx, m } = exigirAlterar(request);
    const { metodo } = validar(Metodo, request.body);
    ctx.plataforma.banco.executar('UPDATE empresas SET metodo_pagamento = ? WHERE id = ?', metodo, ctx.empresa.id);
    ctx.auditoria.registrar(m.nome, 'mudou a forma de pagamento', 'Plano e créditos', metodo === 'cartao' ? 'Cartão de crédito' : 'Boleto bancário');
    return ctx.plataforma.faturas.dadosCobranca(ctx.empresa.id);
  });

  app.post('/plano/mudanca', { preHandler: exigir('administrar') }, async (request): Promise<PedidoMudancaPlano> => {
    const { ctx, m } = exigirAlterar(request);
    const d = validar(Mudanca, request.body);
    const { plataforma } = ctx;
    const empresa = plataforma.empresa(ctx.empresa.id)!;
    const pedido = plataforma.plano(d.planoId);
    if (!pedido) throw naoEncontrado('Plano');
    if (pedido.id === empresa.planoId) throw pedidoInvalido(`Vocês já estão no plano ${pedido.nome}.`);
    const contato = plataforma.registrarContato({
      nome: m.nome,
      email: m.email,
      empresa: empresa.nome,
      faixa: empresa.faixaUsuarios,
      mensagem: d.mensagem,
      origem: 'mudanca_plano',
      ip: request.ip,
      empresaId: empresa.id,
      planoId: pedido.id,
    });
    const atual = empresa.planoId ? (plataforma.plano(empresa.planoId)?.nome ?? null) : null;
    ctx.auditoria.registrar(m.nome, 'pediu mudança de plano', 'Plano e créditos', `${atual ?? 'Sem plano'} → ${pedido.nome}`);
    const para = plataforma.config.emailVendas;
    if (para) {
      await plataforma.correio
        .enviar(
          emailMudancaPlano({
            para,
            empresa: empresa.nome,
            cnpj: empresa.cnpj ? formatarCnpj(empresa.cnpj) : null,
            pessoa: m.nome,
            email: m.email,
            planoAtual: atual,
            planoPedido: pedido.nome,
            mensagem: d.mensagem || null,
            em: contato.criadoEm,
            linkPlataforma: `${plataforma.config.urlConsole.replace(/\/+$/, '')}/plataforma?empresa=${encodeURIComponent(empresa.id)}`,
          }),
        )
        .catch((e) => request.log.error(e, 'Falha ao enviar o pedido de mudança de plano'));
    }
    return { planoId: pedido.id, planoNome: pedido.nome, em: contato.criadoEm };
  });

  app.get<{ Params: { id: string } }>('/plano/faturas/:id/pdf', { preHandler: [exigir('ver'), verPlano] }, async (request, reply) => {
    const ctx = ctxDe(request);
    const f = ctx.plataforma.faturas.obter(request.params.id);
    if (!f || f.empresaId !== ctx.empresa.id) throw naoEncontrado('Fatura');
    const empresa = ctx.plataforma.empresa(ctx.empresa.id)!;
    const pdf = await demonstrativoPdf({ fatura: f, empresa: { nome: empresa.nome, cnpj: empresa.cnpj }, cobranca: ctx.plataforma.faturas.dadosCobranca(empresa.id) });
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="${nomeArquivo(f)}"`)
      .header('Cache-Control', 'private, no-store')
      .send(Buffer.from(pdf));
  });
};

export default rotas;

// O sistema da empresa no console: como o copiloto entra nele (endereço, conta de serviço, perfis),
// usuários (pré-visualização "Como Ana Ribeiro"), perfis ("Quem pode executar") e rotas da API
// (ficha da tarefa, "Executar via API").
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SistemaEmpresa, SistemaEmpresaPedido, UsuarioSistema, VerificacaoSistema } from '@copiloto/shared';
import { AdaptadorTela } from '../../adaptadores/tela.ts';
import { exigir, membro } from '../../auth/console.ts';
import { ctxDe, type Contexto } from '../../contexto.ts';
import { hostDe, type SistemaGuardado } from '../../plataforma/index.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';
import { UrlSistema } from './auth.ts';

/** Endereço completo ou caminho no sistema (ex.: /copiloto/sessao), que vira endereço http(s) válido. */
function urlValida(endereco: string, base: string): boolean {
  try {
    return UrlSistema.safeParse(new URL(endereco, base).toString()).success;
  } catch {
    return false;
  }
}

const Perfil = z.string().trim().min(1).max(50, 'Cada perfil pode ter até 50 caracteres.').regex(/^[^,\n]+$/, 'Perfil não pode ter vírgula.');

const Pedido = z
  .object({
    nome: z.string().trim().min(2, 'Diga como a equipe chama o sistema.').max(60, 'O nome do sistema pode ter até 60 caracteres.'),
    url: UrlSistema,
    acesso: z.object({
      modo: z.enum(['sessao', 'conta', 'nenhum']),
      urlSessao: z.string().trim().max(500).default(''),
      urlLogin: z.string().trim().max(500),
      usuario: z.string().trim().max(200),
      senha: z.string().max(500).optional(),
    }),
    perfis: z.array(Perfil).max(50, 'Use no máximo 50 perfis.'),
  })
  .superRefine((d, c) => {
    if (d.acesso.modo === 'sessao' && d.acesso.urlSessao && !urlValida(d.acesso.urlSessao, d.url)) {
      c.addIssue({ code: 'custom', message: 'O endereço de sessão não é válido. Use o endereço completo, começando com https://' });
    }
    if (d.acesso.modo !== 'conta') return;
    if (!d.acesso.urlLogin) c.addIssue({ code: 'custom', message: 'Diga em que página o copiloto entra no sistema.' });
    else {
      try {
        new URL(d.acesso.urlLogin, d.url);
      } catch {
        c.addIssue({ code: 'custom', message: 'O endereço da página de login não é válido.' });
      }
    }
    if (!d.acesso.usuario) c.addIssue({ code: 'custom', message: 'Diga o usuário da conta do copiloto.' });
  }) satisfies z.ZodType<SistemaEmpresaPedido>;

const Verificar = z.object({ url: UrlSistema });

/**
 * O endereço do sistema mudou de domínio: o widget passa a ser liberado no novo (no lugar do
 * antigo), no rascunho e no publicado. Os outros domínios que a empresa liberou continuam.
 */
function trocarDominio(ctx: Contexto, antigo: string | null, novo: string | null, quem: string) {
  if (!novo || antigo === novo) return;
  for (const chave of ['widget_rascunho', 'widget_publicado'] as const) {
    const cfg = ctx.configuracoes.ler(chave);
    const dominios = [novo, ...cfg.dominios.filter((d) => d !== antigo && d !== novo)].slice(0, 20);
    ctx.configuracoes.gravar(chave, { ...cfg, dominios }, quem);
  }
  ctx.plataforma.atualizarDominios(ctx.empresa.id, ctx.configuracoes.ler('widget_publicado').dominios);
}

function sistemaDe(ctx: Contexto): SistemaEmpresa {
  const { sistema, demo } = ctx.empresa;
  return {
    nome: sistema.nome,
    url: sistema.conector === 'api' ? ctx.adaptador.urlBase : sistema.url,
    conector: sistema.conector,
    acesso: {
      modo: sistema.acesso.modo,
      urlSessao: sistema.acesso.urlSessao,
      urlLogin: sistema.acesso.urlLogin,
      usuario: sistema.acesso.usuario,
      temSenha: !!ctx.plataforma.senhaAcesso(ctx.empresa.id),
    },
    perfis: sistema.perfis,
    editavel: !demo && sistema.conector === 'tela',
  };
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  const comErro = async <T>(ctx: Contexto, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      throw new ErroHttp(502, 'sistema_indisponivel', `Não consegui falar com o ${ctx.adaptador.nome} agora.`);
    }
  };

  app.get('/usuarios', { preHandler: exigir('ver') }, async (request): Promise<UsuarioSistema[]> => {
    const ctx = ctxDe(request);
    return comErro(ctx, () => ctx.adaptador.listarUsuarios());
  });
  app.get('/perfis', { preHandler: exigir('ver') }, async (request): Promise<string[]> => {
    const ctx = ctxDe(request);
    return comErro(ctx, () => ctx.adaptador.listarPerfis());
  });
  app.get('/rotas', { preHandler: exigir('editar') }, async (request) => {
    const ctx = ctxDe(request);
    return comErro(ctx, () => ctx.adaptador.descreverApi());
  });
  app.get('/conexao', { preHandler: exigir('ver') }, async (request) => {
    const { adaptador, config } = ctxDe(request);
    return {
      ...(await adaptador.verificarConexao()),
      nome: adaptador.nome,
      url: config.sistema.urlApi || adaptador.urlBase,
      urlTelas: adaptador.urlBase,
    };
  });

  app.get('/config', { preHandler: exigir('ver') }, async (request): Promise<SistemaEmpresa> => sistemaDe(ctxDe(request)));

  app.put('/config', { preHandler: exigir('administrar') }, async (request): Promise<SistemaEmpresa> => {
    const ctx = ctxDe(request);
    const m = membro(request);
    if (!sistemaDe(ctx).editavel) {
      throw new ErroHttp(409, 'sistema_fixo', 'Na demonstração o sistema é o Horizonte, configurado no servidor.');
    }
    const r = Pedido.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
    const d = r.data;
    const { modo } = d.acesso;
    const conta = modo === 'conta';
    const senhaNova = conta ? d.acesso.senha?.trim() || undefined : null;
    if (conta && !senhaNova && !plataforma.senhaAcesso(ctx.empresa.id)) throw pedidoInvalido('Digite a senha da conta do copiloto.');
    const antes = ctx.empresa.sistema;
    const sistema: SistemaGuardado = {
      nome: d.nome,
      url: d.url.replace(/\/+$/, ''),
      conector: antes.conector,
      acesso: {
        modo,
        urlSessao: modo === 'sessao' ? d.acesso.urlSessao : '',
        urlLogin: conta ? d.acesso.urlLogin : '',
        usuario: conta ? d.acesso.usuario : '',
      },
      perfis: [...new Set(d.perfis)],
    };
    plataforma.atualizarSistema(ctx.empresa.id, sistema, senhaNova);
    trocarDominio(ctx, hostDe(antes.url), hostDe(sistema.url), m.nome);
    const mudancas: string[] = [];
    if (antes.nome !== sistema.nome) mudancas.push(`nome de ${antes.nome} para ${sistema.nome}`);
    if (antes.url !== sistema.url) mudancas.push(`endereço para ${sistema.url}`);
    if (antes.acesso.modo !== sistema.acesso.modo) {
      mudancas.push(
        modo === 'conta'
          ? `passou a entrar com a conta ${sistema.acesso.usuario}`
          : modo === 'sessao'
            ? 'passou a entrar com a sessão de quem pede'
            : 'passou a abrir as telas sem login',
      );
    } else if (conta && (antes.acesso.usuario !== sistema.acesso.usuario || antes.acesso.urlLogin !== sistema.acesso.urlLogin)) {
      mudancas.push(`conta de serviço ${sistema.acesso.usuario}`);
    } else if (modo === 'sessao' && antes.acesso.urlSessao !== sistema.acesso.urlSessao) {
      mudancas.push(`endereço de sessão ${sistema.acesso.urlSessao || '(vazio)'}`);
    }
    if (conta && typeof senhaNova === 'string') mudancas.push('trocou a senha da conta de serviço');
    if (JSON.stringify(antes.perfis) !== JSON.stringify(sistema.perfis)) mudancas.push('perfis');
    if (mudancas.length) ctx.auditoria.registrar(m.nome, 'alterou o sistema', sistema.nome, `Mudou ${mudancas.join('; ')}`);
    return sistemaDe(ctx);
  });

  /** "Verificar endereço" (cadastro e página Sistema): o servidor do copiloto chega até as telas? */
  app.post('/verificar', { preHandler: exigir('administrar') }, async (request): Promise<VerificacaoSistema> => {
    const ctx = ctxDe(request);
    const r = Verificar.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Endereço inválido.');
    const tela = new AdaptadorTela(ctx.banco, {
      nome: ctx.empresa.sistema.nome,
      urlBase: r.data.url,
      perfis: [],
      acesso: { modo: 'nenhum', urlSessao: '', urlLogin: '', usuario: '' },
      senha: () => null,
      segredo: () => '',
    });
    return tela.verificarConexao();
  });

  /**
   * Abre o navegador do copiloto e entra como antes de um fluxo, sem rodar passos. No modo sessão,
   * pede a sessão de `usuarioId` (sem ele, de quem usou o widget por último).
   */
  app.post('/testar-acesso', { preHandler: exigir('administrar') }, async (request): Promise<VerificacaoSistema> => {
    const { navegador, adaptador, banco } = ctxDe(request);
    if (!navegador.testarAcesso) return { ok: false, detalhe: `O navegador deste servidor não sabe testar o acesso ao ${adaptador.nome}.` };
    const pedido = (request.body ?? {}) as { usuarioId?: unknown };
    let usuarioId = typeof pedido.usuarioId === 'string' ? pedido.usuarioId.trim().slice(0, 200) : '';
    if (!usuarioId) usuarioId = banco.um<{ id: string }>('SELECT id FROM usuarios_sistema ORDER BY visto_em DESC LIMIT 1')?.id ?? '';
    return navegador.testarAcesso(usuarioId);
  });
};

export default rotas;

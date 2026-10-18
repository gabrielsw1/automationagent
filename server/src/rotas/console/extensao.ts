// Extensão do navegador no console: a página "Instalar o gravador" (E1) e a entrega do código de
// entrada à extensão (/extensao/conectar). O código é de uso único, vale 2 minutos e fica preso à
// conta, à empresa escolhida e ao desafio que a extensão mandou; sem o verificador da extensão, não
// serve para nada. O token que a extensão recebe em troca nunca vale nas rotas do console.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { fmt, pode, type CodigoExtensao, type InfoExtensao, type PerfilEquipe } from '@copiloto/shared';
import { exigir, membro, perfilNaEmpresa } from '../../auth/console.ts';
import { ctxDe } from '../../contexto.ts';
import { ErroHttp, pedidoInvalido, semPermissao } from '../../util/erros.ts';

const PedidoCodigo = z.object({
  empresaId: z.string().min(1).max(100),
  desafio: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const ORDEM_PERFIL: Record<PerfilEquipe, number> = { admin: 0, editor: 1, suporte: 2, leitor: 3 };

const rotas: FastifyPluginAsync = async (app) => {
  const plataforma = app.plataforma;

  app.get('/', { preHandler: exigir('ver') }, async (request): Promise<InfoExtensao> => {
    const ctx = ctxDe(request);
    const eu = membro(request);
    const { urlChrome, urlEdge, ajudaInstalar } = plataforma.config.extensao;
    const equipe = ctx.banco.todos<{ id: string; nome: string | null; email: string; perfil: PerfilEquipe }>(
      "SELECT id, nome, email, perfil FROM equipe WHERE status = 'ativo' AND perfil IN ('admin', 'editor')",
    );
    const quemPodeGravar = equipe
      .map((l) => {
        const nome = l.nome ?? l.email;
        return { id: l.id, nome, email: l.email, iniciais: fmt.iniciais(nome), perfil: l.perfil, voce: l.email.toLowerCase() === eu.email.toLowerCase() };
      })
      .sort((a, b) => Number(b.voce) - Number(a.voce) || ORDEM_PERFIL[a.perfil] - ORDEM_PERFIL[b.perfil] || a.nome.localeCompare(b.nome, 'pt-BR'));
    return { lojas: { chrome: urlChrome || null, edge: urlEdge || null }, ajudaInstalar, quemPodeGravar };
  });

  /** Código de entrada para a extensão, na empresa escolhida (só onde a pessoa pode gravar). */
  app.post('/codigo', { preHandler: exigir('ver') }, async (request): Promise<CodigoExtensao> => {
    const m = membro(request);
    if (m.suporte || !request.sessaoConsole) {
      throw semPermissao('No modo suporte não dá para conectar a extensão. Quem grava entra com a própria conta.');
    }
    const r = PedidoCodigo.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido('O pedido da extensão veio incompleto. Clique em Entrar de novo no gravador.');
    const conta = request.sessaoConsole.conta;
    const empresa = plataforma.empresasDe(conta.email).find((e) => e.id === r.data.empresaId);
    if (!empresa) throw new ErroHttp(404, 'empresa_nao_encontrada', 'Você não está na equipe desta empresa.');
    const naEmpresa = perfilNaEmpresa(plataforma.contexto(empresa.id), conta.email);
    if (!naEmpresa) throw new ErroHttp(404, 'empresa_nao_encontrada', 'Você não está na equipe desta empresa.');
    if (!pode(naEmpresa.perfil, 'editar')) {
      throw semPermissao(`Seu perfil na ${empresa.nome} não permite gravar fluxos. Só Admin e Editor de tarefas gravam.`);
    }
    return plataforma.novoCodigoExtensao(conta.id, empresa.id, r.data.desafio);
  });
};

export default rotas;

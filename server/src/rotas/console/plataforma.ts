// Painel da plataforma (quem vende o copiloto): todas as empresas clientes, com métricas de uso e
// nunca o conteúdo (conversas, prints e dados dos clientes ficam no espaço de cada empresa).
// Só para os e-mails de COPILOTO_ADMINS, em qualquer empresa que estejam abertos no console.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { EmpresaPlataforma } from '@copiloto/shared';
import { membro } from '../../auth/console.ts';
import type { Empresa, Plataforma } from '../../plataforma/index.ts';
import { ErroHttp, pedidoInvalido, semPermissao } from '../../util/erros.ts';

const DIA = 86_400_000;

const MudarStatus = z.object({ status: z.enum(['ativa', 'suspensa'], { error: 'Use ativa ou suspensa.' }) });

function linhaDe(plataforma: Plataforma, empresa: Empresa): EmpresaPlataforma {
  const { banco } = plataforma.contexto(empresa.id);
  const desde = new Date(Date.now() - 30 * DIA).toISOString();
  const n = (sql: string) => banco.um<{ n: number }>(sql)?.n ?? 0;
  const execucoes = banco.um<{ total: number; ok: number | null; falhas: number | null }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN status = 'falhou' THEN 1 ELSE 0 END) AS falhas
       FROM execucoes WHERE criado_em >= ? AND canal != 'teste'`,
    desde,
  ) ?? { total: 0, ok: 0, falhas: 0 };
  const terminadas = (execucoes.ok ?? 0) + (execucoes.falhas ?? 0);
  return {
    id: empresa.id,
    nome: empresa.nome,
    demo: empresa.demo,
    status: empresa.status,
    criadoEm: empresa.criadoEm,
    criadoPor: empresa.criadoPor,
    cnpj: empresa.cnpj,
    faixaUsuarios: empresa.faixaUsuarios,
    sistema: { nome: empresa.sistema.nome, url: empresa.sistema.url, conector: empresa.sistema.conector, acesso: empresa.sistema.acesso.modo },
    equipe: n("SELECT COUNT(*) AS n FROM equipe WHERE status = 'ativo'"),
    usuarios: n("SELECT COUNT(DISTINCT usuario_id) AS n FROM conversas WHERE canal = 'widget'"),
    tarefasAtivas: n("SELECT COUNT(*) AS n FROM tarefas WHERE status = 'ativa'"),
    execucoes30d: execucoes.total ?? 0,
    sucesso30d: terminadas > 0 ? (execucoes.ok ?? 0) / terminadas : null,
    ultimaExecucao: banco.um<{ m: string | null }>("SELECT MAX(criado_em) AS m FROM execucoes WHERE canal != 'teste'")?.m ?? null,
  };
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  async function soAdmin(request: FastifyRequest) {
    if (!plataforma.adminDaPlataforma(membro(request).email)) throw semPermissao('Só quem administra a plataforma vê as empresas clientes.');
  }

  app.get('/empresas', { preHandler: soAdmin }, async (): Promise<EmpresaPlataforma[]> =>
    plataforma.listarEmpresas().map((e) => linhaDe(plataforma, e)),
  );

  app.put<{ Params: { id: string } }>('/empresas/:id/status', { preHandler: soAdmin }, async (request): Promise<EmpresaPlataforma> => {
    const r = MudarStatus.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
    const empresa = plataforma.empresa(request.params.id);
    if (!empresa) throw new ErroHttp(404, 'nao_encontrado', 'Empresa não encontrada.');
    if (empresa.status !== r.data.status) {
      plataforma.mudarStatus(empresa.id, r.data.status);
      const quem = membro(request).nome;
      plataforma
        .contexto(empresa.id)
        .auditoria.registrar(
          `${quem} (plataforma)`,
          r.data.status === 'suspensa' ? 'suspendeu a empresa' : 'reativou a empresa',
          empresa.nome,
          r.data.status === 'suspensa' ? 'Ninguém entra no console nem no widget até reativar.' : undefined,
        );
    }
    return linhaDe(plataforma, plataforma.empresa(empresa.id)!);
  });
};

export default rotas;

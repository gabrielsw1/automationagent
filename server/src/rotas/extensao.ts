// Rotas da extensão do navegador (/api/extensao). A extensão entra com a conta do console sem pedir
// senha: o console entrega um código de uso único (POST /api/console/extensao/codigo) e a extensão
// troca o código, com o verificador que só ela tem, pelo token dela (POST /trocar).
//
// O token (Authorization: Bearer cpx_...) vale para uma conta numa empresa e só nestas rotas: as
// rotas do console leem apenas o cookie de sessão. A cada pedido a equipe da empresa é conferida
// de novo: quem saiu da equipe perde o token; quem deixou de ser Admin ou Editor de tarefas vê o
// aviso de permissão no popup.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  fmt,
  pode,
  type EmpresaDaExtensao,
  type GravacaoRecente,
  type GravacoesRecentes,
  type SessaoExtensao,
  type SituacaoGravacaoRecente,
  type TokenExtensao,
} from '@copiloto/shared';
import { iniciais, perfilNaEmpresa, type MembroLogado } from '../auth/console.ts';
import type { Contexto } from '../contexto.ts';
import { json } from '../db/banco.ts';
import type { Conta, Empresa, Plataforma, TokenExtensaoLido } from '../plataforma/index.ts';
import { ErroHttp, pedidoInvalido } from '../util/erros.ts';

const PedidoTroca = z.object({
  codigo: z.string().min(10).max(200),
  verificador: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  navegador: z.string().max(40).optional(),
});

/** Quantas gravações recentes o popup recebe. */
const RECENTES = 5;

export function tokenDoCabecalho(request: FastifyRequest): string | undefined {
  const h = request.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1];
}

const desconectada = (texto = 'A extensão saiu da sua conta. Entre de novo pelo ícone do gravador.') =>
  new ErroHttp(401, 'extensao_desconectada', texto);

interface SessaoLida {
  token: string;
  lido: TokenExtensaoLido;
  empresa: Empresa;
  ctx: Contexto;
  membro: MembroLogado;
}

/** Token → conta, empresa ativa e membro ativo da equipe. Sem isso, 401 (e o token deixa de valer). */
export function lerSessaoExtensao(plataforma: Plataforma, request: FastifyRequest): SessaoLida {
  const token = tokenDoCabecalho(request);
  const lido = plataforma.lerTokenExtensao(token);
  if (!token || !lido) throw desconectada();
  const empresa = plataforma.empresa(lido.empresaId);
  if (!empresa || empresa.status !== 'ativa') {
    plataforma.revogarTokenExtensaoPorId(lido.id);
    throw desconectada('Esta empresa não está ativa no Copiloto agora. Entre de novo e escolha outra empresa.');
  }
  const ctx = plataforma.contexto(empresa.id);
  const m = perfilNaEmpresa(ctx, lido.conta.email);
  if (!m) {
    plataforma.revogarTokenExtensaoPorId(lido.id);
    throw desconectada(`Você não está mais na equipe da ${empresa.nome}. Entre de novo e escolha outra empresa.`);
  }
  return { token, lido, empresa, ctx, membro: m };
}

/** Empresas da conta em que ela pode gravar (Admin e Editor de tarefas), a demonstração por último. */
function empresasParaGravar(plataforma: Plataforma, conta: Conta): EmpresaDaExtensao[] {
  return plataforma.empresasDe(conta.email).flatMap((e) => {
    const m = perfilNaEmpresa(plataforma.contexto(e.id), conta.email);
    if (!m || !pode(m.perfil, 'editar')) return [];
    return [{ id: e.id, nome: e.nome, demo: e.demo, iniciais: fmt.iniciaisEmpresa(e.nome), perfil: m.perfil }];
  });
}

function sessaoDe(plataforma: Plataforma, s: Pick<SessaoLida, 'lido' | 'empresa' | 'membro'>): SessaoExtensao {
  return {
    pessoa: { nome: s.membro.nome, email: s.membro.email, iniciais: iniciais(s.membro.nome) },
    empresa: { id: s.empresa.id, nome: s.empresa.nome, demo: s.empresa.demo, iniciais: fmt.iniciaisEmpresa(s.empresa.nome) },
    perfil: s.membro.perfil,
    podeGravar: pode(s.membro.perfil, 'editar'),
    empresas: empresasParaGravar(plataforma, s.lido.conta),
    urlConsole: plataforma.config.urlConsole.replace(/\/+$/, ''),
  };
}

interface LinhaRecente {
  id: string;
  nome: string;
  tarefa_id: string | null;
  status: string;
  etapa: string;
  passos: string;
  gravado_em: string | null;
  criado_em: string;
  salvo_em: string;
}

function situacaoDe(l: LinhaRecente, passos: number): SituacaoGravacaoRecente | null {
  if (l.status === 'gravando') return 'gravando';
  if (l.status === 'publicado') return 'publicada';
  // Cancelada (sem passos e de volta a "gravar"): não aparece.
  if (l.etapa === 'gravar' || passos === 0) return null;
  return l.etapa === 'revisar' ? 'enviada' : 'em_revisao';
}

/** Gravações recentes da pessoa nesta empresa: a mais nova de cada fluxo (versões juntas). */
export function gravacoesRecentes(ctx: Contexto, m: Pick<MembroLogado, 'email' | 'nome'>, urlConsole: string, limite = RECENTES): GravacaoRecente[] {
  const linhas = ctx.banco.todos<LinhaRecente>(
    `SELECT id, nome, tarefa_id, status, etapa, passos, gravado_em, criado_em, salvo_em FROM fluxos
     WHERE lower(gravado_por_email) = ? OR (gravado_por_email IS NULL AND gravado_por = ?)
     ORDER BY COALESCE(gravado_em, salvo_em) DESC LIMIT 60`,
    m.email.toLowerCase(),
    m.nome,
  );
  const vistos = new Set<string>();
  const lista: GravacaoRecente[] = [];
  for (const l of linhas) {
    const chave = `${l.nome}\u0000${l.tarefa_id ?? ''}`;
    if (vistos.has(chave)) continue;
    const passos = json<unknown[]>(l.passos, []).length;
    const situacao = situacaoDe(l, passos);
    if (!situacao) continue;
    vistos.add(chave);
    lista.push({
      fluxoId: l.id,
      nome: l.nome,
      situacao,
      passos,
      em: (situacao === 'gravando' ? l.salvo_em : l.gravado_em) ?? l.salvo_em,
      url: `${urlConsole.replace(/\/+$/, '')}/aprender/${encodeURIComponent(l.id)}`,
    });
    if (lista.length >= limite) break;
  }
  return lista;
}

const rotas: FastifyPluginAsync = async (app) => {
  const plataforma = app.plataforma;

  /** Código do console + verificador da extensão → token da extensão. */
  app.post('/trocar', async (request): Promise<TokenExtensao> => {
    const r = PedidoTroca.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido('O pedido de entrada da extensão veio incompleto. Clique em Entrar de novo no gravador.');
    const trocado = plataforma.trocarCodigoExtensao(r.data.codigo, r.data.verificador, r.data.navegador);
    if (!trocado) throw new ErroHttp(400, 'codigo_invalido', 'Este pedido de entrada venceu ou já foi usado. Clique em Entrar de novo no gravador.');
    const lido = plataforma.lerTokenExtensao(trocado.token)!;
    const empresa = plataforma.empresa(trocado.empresaId);
    const ctx = empresa?.status === 'ativa' ? plataforma.contexto(empresa.id) : undefined;
    const m = ctx ? perfilNaEmpresa(ctx, lido.conta.email) : undefined;
    if (!empresa || !ctx || !m) {
      plataforma.revogarTokenExtensaoPorId(lido.id);
      throw desconectada('Você não está na equipe desta empresa. Entre de novo e escolha outra empresa.');
    }
    ctx.auditoria.registrar(m.nome, 'conectou a extensão do navegador', empresa.nome, r.data.navegador ?? null);
    return { token: trocado.token, sessao: sessaoDe(plataforma, { lido, empresa, membro: m }) };
  });

  app.get('/sessao', async (request): Promise<SessaoExtensao> => {
    return sessaoDe(plataforma, lerSessaoExtensao(plataforma, request));
  });

  /** "Gravações recentes" do popup: as da pessoa, na empresa do token. */
  app.get('/gravacoes', async (request): Promise<GravacoesRecentes> => {
    const s = lerSessaoExtensao(plataforma, request);
    if (!pode(s.membro.perfil, 'editar')) {
      throw new ErroHttp(403, 'sem_permissao', `Seu perfil na ${s.empresa.nome} não permite gravar fluxos. Peça a um Admin para mudar o seu perfil.`);
    }
    return { gravacoes: gravacoesRecentes(s.ctx, s.membro, plataforma.config.urlConsole) };
  });

  /** "Sair" no popup: o token para de valer na hora (pedido repetido ou de token vencido também responde ok). */
  app.post('/sair', async (request) => {
    const token = tokenDoCabecalho(request);
    const lido = plataforma.lerTokenExtensao(token);
    plataforma.revogarTokenExtensao(token);
    if (lido) {
      const empresa = plataforma.empresa(lido.empresaId);
      if (empresa) plataforma.contexto(empresa.id).auditoria.registrar(lido.conta.nome ?? lido.conta.email, 'desconectou a extensão do navegador', empresa.nome);
    }
    return { ok: true };
  });
};

export default rotas;

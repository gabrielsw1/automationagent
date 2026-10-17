// Entrar, sair, aceitar convite e criar o primeiro admin.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Eu } from '@copiloto/shared';
import {
  COOKIE_SESSAO,
  criarSessao,
  definirCookie,
  encerrarSessao,
  iniciais,
  membro,
  membroDaSessao,
} from '../../auth/console.ts';
import { hashSenha, verificarSenha } from '../../auth/senha.ts';
import { agoraIso } from '../../db/banco.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';
import { novoId } from '../../util/ids.ts';

const Entrar = z.object({ email: z.string().trim().toLowerCase(), senha: z.string() });
const NovaSenha = z.object({
  nome: z.string().trim().min(2, 'Diga seu nome.'),
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.'),
});
const PrimeiroAdmin = NovaSenha.extend({ email: z.string().trim().toLowerCase().email('E-mail inválido.') });

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

const rotas: FastifyPluginAsync = async (app) => {
  const { banco, auditoria, config } = app.ctx;
  const seguro = config.urlPublica.startsWith('https://');

  app.get('/eu', async (request): Promise<Eu> => {
    const m = membro(request);
    return { id: m.id, nome: m.nome, email: m.email, perfil: m.perfil, iniciais: m.iniciais };
  });

  app.post('/entrar', async (request, reply): Promise<Eu> => {
    const { email, senha } = validar(Entrar, request.body);
    const l = banco.um<{ id: string; senha_hash: string | null; status: string }>(
      'SELECT id, senha_hash, status FROM equipe WHERE email = ?',
      email,
    );
    if (!l || l.status !== 'ativo' || !verificarSenha(senha, l.senha_hash)) {
      throw new ErroHttp(401, 'credenciais', 'E-mail ou senha não conferem.');
    }
    const { token, expira } = criarSessao(banco, l.id);
    definirCookie(reply, token, expira, seguro);
    const m = membroDaSessao(banco, token)!;
    return { id: m.id, nome: m.nome, email: m.email, perfil: m.perfil, iniciais: m.iniciais };
  });

  app.post('/sair', async (request, reply) => {
    encerrarSessao(banco, request.cookies[COOKIE_SESSAO]);
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  });

  /** Sem ninguém com senha na equipe, a tela de entrada pede para criar o primeiro admin. */
  app.get('/primeiro-acesso', async () => {
    const n = banco.um<{ n: number }>("SELECT COUNT(*) AS n FROM equipe WHERE status = 'ativo'")!.n;
    return { precisaCriarAdmin: n === 0, demo: process.env.COPILOTO_DEMO !== '0' };
  });

  app.post('/primeiro-admin', async (request, reply): Promise<Eu> => {
    const n = banco.um<{ n: number }>("SELECT COUNT(*) AS n FROM equipe WHERE status = 'ativo'")!.n;
    if (n > 0) throw new ErroHttp(409, 'ja_existe', 'O primeiro admin já foi criado. Entre com e-mail e senha.');
    const d = validar(PrimeiroAdmin, request.body);
    const id = novoId('mbr');
    banco.inserir('equipe', {
      id,
      nome: d.nome,
      email: d.email,
      perfil: 'admin',
      status: 'ativo',
      senha_hash: hashSenha(d.senha),
      criado_em: agoraIso(),
    });
    auditoria.registrar(d.nome, 'criou o primeiro acesso de admin', d.email);
    const { token, expira } = criarSessao(banco, id);
    definirCookie(reply, token, expira, seguro);
    return { id, nome: d.nome, email: d.email, perfil: 'admin', iniciais: iniciais(d.nome) };
  });

  app.get<{ Params: { token: string } }>('/convite/:token', async (request) => {
    const l = banco.um<{ email: string; perfil: string; convite_expira_em: string | null }>(
      "SELECT email, perfil, convite_expira_em FROM equipe WHERE convite_token = ? AND status = 'convidado'",
      request.params.token,
    );
    if (!l) throw new ErroHttp(404, 'convite_invalido', 'Este convite não existe ou já foi usado.');
    if (l.convite_expira_em && l.convite_expira_em < agoraIso()) {
      throw new ErroHttp(410, 'convite_expirado', 'Este convite expirou. Peça a um Admin para reenviar.');
    }
    return { email: l.email, perfil: l.perfil };
  });

  app.post<{ Params: { token: string } }>('/convite/:token', async (request, reply): Promise<Eu> => {
    const d = validar(NovaSenha, request.body);
    const l = banco.um<{ id: string; email: string; perfil: Eu['perfil']; convite_expira_em: string | null }>(
      "SELECT id, email, perfil, convite_expira_em FROM equipe WHERE convite_token = ? AND status = 'convidado'",
      request.params.token,
    );
    if (!l) throw new ErroHttp(404, 'convite_invalido', 'Este convite não existe ou já foi usado.');
    if (l.convite_expira_em && l.convite_expira_em < agoraIso()) {
      throw new ErroHttp(410, 'convite_expirado', 'Este convite expirou. Peça a um Admin para reenviar.');
    }
    banco.atualizar('equipe', l.id, {
      nome: d.nome,
      senha_hash: hashSenha(d.senha),
      status: 'ativo',
      convite_token: null,
    });
    auditoria.registrar(d.nome, 'aceitou o convite', l.email);
    const { token, expira } = criarSessao(banco, l.id);
    definirCookie(reply, token, expira, seguro);
    return { id: l.id, nome: d.nome, email: l.email, perfil: l.perfil, iniciais: iniciais(d.nome) };
  });
};

export default rotas;

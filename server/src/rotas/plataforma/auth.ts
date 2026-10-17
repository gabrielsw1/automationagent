// Entrar na Plataforma (A7): e-mail e senha, depois o código do aplicativo autenticador ou um
// código de recuperação. "Confiar neste aparelho por 30 dias" pula o código nesse navegador.
// Também a ativação (convite ou acesso redefinido): QR code, senha e códigos de recuperação.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AtivacaoConcluida, AtivacaoStarta, EntradaStarta, EuStarta } from '@copiloto/shared';
import { iniciais } from '../../auth/console.ts';
import { COOKIE_APARELHO, COOKIE_STARTA, definirCookieStarta, euStarta, exigirStarta, pessoaStarta } from '../../auth/starta.ts';
import { qrSvg, uriTotp } from '../../auth/totp.ts';
import { MINUTOS_BLOQUEIO_STARTA } from '../../plataforma/starta.ts';
import { ErroHttp, pedidoInvalido } from '../../util/erros.ts';
import { problemaSenhaSimples } from '../console/auth.ts';
import { validar } from './comum.ts';

const Entrar = z.object({ email: z.string().trim().toLowerCase().email('Digite um e-mail válido.'), senha: z.string().min(1, 'Digite a senha.').max(200) });
const SegundaEtapa = z.object({
  codigo: z.string().trim().min(1, 'Digite o código.').max(20),
  tipo: z.enum(['aplicativo', 'recuperacao']).default('aplicativo'),
  confiarAparelho: z.boolean().default(false),
});
const Ativar = z.object({ senha: z.string(), codigo: z.string().trim().regex(/^\d{6}$/, 'Digite os 6 dígitos do aplicativo.') });
const CodigoAplicativo = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, 'Digite os 6 dígitos do aplicativo.') });

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;
  const seguro = plataforma.config.urlPublica.startsWith('https://');

  /** Etapa 1. A resposta é a mesma para e-mail sem conta e senha errada. */
  app.post('/entrar', async (request, reply): Promise<EntradaStarta> => {
    const { email, senha } = validar(Entrar, request.body);
    const r = plataforma.starta.conferirSenha(email, senha);
    if (!r.pessoa) {
      if (r.bloqueadaAte) {
        throw new ErroHttp(423, 'bloqueado', `Por segurança, o acesso ficou bloqueado por ${MINUTOS_BLOQUEIO_STARTA} minutos.`, { ate: r.bloqueadaAte });
      }
      throw new ErroHttp(401, 'credenciais', 'E-mail ou senha incorretos. Confira e tente de novo.');
    }
    plataforma.starta.encerrarSessao(request.cookies[COOKIE_STARTA]);
    if (plataforma.starta.aparelhoConfiavel(r.pessoa.id, request.cookies[COOKIE_APARELHO])) {
      const { token, expira } = plataforma.starta.criarSessao(r.pessoa.id, 'completa');
      definirCookieStarta(reply, COOKIE_STARTA, token, expira, seguro);
      return { etapa: 'completa', eu: euStarta(plataforma, r.pessoa) };
    }
    const { token, expira } = plataforma.starta.criarSessao(r.pessoa.id, 'codigo');
    definirCookieStarta(reply, COOKIE_STARTA, token, expira, seguro);
    return { etapa: 'codigo', pessoa: { nome: r.pessoa.nome, iniciais: iniciais(r.pessoa.nome) } };
  });

  /** Etapa 2: código do aplicativo ou de recuperação. */
  app.post('/codigo', async (request, reply): Promise<EuStarta> => {
    const d = validar(SegundaEtapa, request.body);
    const token = request.cookies[COOKIE_STARTA];
    const sessao = request.sessaoStarta;
    if (!token || !sessao) throw new ErroHttp(401, 'recomecar', 'Sua entrada expirou. Digite o e-mail e a senha de novo.');
    if (sessao.etapa === 'completa') return euStarta(plataforma, sessao.pessoa);
    const r = plataforma.starta.conferirSegundaEtapa(token, d.codigo, d.tipo);
    if (!r.ok) {
      if (r.restantes === 0) {
        reply.clearCookie(COOKIE_STARTA, { path: '/api/plataforma' });
        throw new ErroHttp(401, 'recomecar', 'Foram 5 códigos incorretos. Por segurança, digite o e-mail e a senha de novo.');
      }
      const resto = r.restantes === 1 ? 'Resta 1 tentativa' : `Restam ${r.restantes} tentativas`;
      throw new ErroHttp(
        400,
        'codigo_incorreto',
        d.tipo === 'aplicativo' ? `Código incorreto. ${resto}.` : `Código de recuperação incorreto ou já usado. ${resto}.`,
        { restantes: r.restantes },
      );
    }
    if (d.confiarAparelho) {
      const aparelho = plataforma.starta.confiarAparelho(sessao.pessoa.id);
      definirCookieStarta(reply, COOKIE_APARELHO, aparelho.token, aparelho.expira, seguro);
    }
    return euStarta(plataforma, sessao.pessoa);
  });

  app.get('/eu', { preHandler: exigirStarta }, async (request): Promise<EuStarta> => euStarta(plataforma, pessoaStarta(request)));

  app.post('/sair', async (request, reply) => {
    plataforma.starta.encerrarSessao(request.cookies[COOKIE_STARTA]);
    reply.clearCookie(COOKIE_STARTA, { path: '/api/plataforma' });
    return { ok: true };
  });

  /** "Gere códigos novos se estiverem acabando": pede um código do aplicativo para confirmar. */
  app.post('/codigos-recuperacao', { preHandler: exigirStarta }, async (request): Promise<{ codigosRecuperacao: string[] }> => {
    const p = pessoaStarta(request);
    const { codigo } = validar(CodigoAplicativo, request.body);
    if (!plataforma.starta.conferirAplicativo(p.id, codigo)) throw new ErroHttp(400, 'codigo_incorreto', 'Código incorreto. Use o que aparece agora no aplicativo.');
    return { codigosRecuperacao: plataforma.starta.novosCodigos(p.id) };
  });

  // ---------------------------------------------------------------- ativação

  app.get<{ Params: { token: string } }>('/ativar/:token', async (request): Promise<AtivacaoStarta> => {
    const a = plataforma.starta.ativacao(request.params.token);
    if (!a) throw new ErroHttp(410, 'link_expirado', 'Este link expirou ou já foi usado. Peça a um Admin da plataforma para enviar outro.');
    const uri = uriTotp(a.segredo, a.pessoa.email);
    return { nome: a.pessoa.nome, email: a.pessoa.email, segredo: a.segredo, uri, qrSvg: await qrSvg(uri), expiraEm: a.expiraEm };
  });

  app.post<{ Params: { token: string } }>('/ativar/:token', async (request, reply): Promise<AtivacaoConcluida> => {
    const { senha, codigo } = validar(Ativar, request.body);
    const problema = problemaSenhaSimples(senha);
    if (problema) throw pedidoInvalido(problema);
    const r = plataforma.starta.ativar(request.params.token, senha, codigo);
    if (!r.ok && r.motivo === 'link') throw new ErroHttp(410, 'link_expirado', 'Este link expirou ou já foi usado. Peça a um Admin da plataforma para enviar outro.');
    if (!r.ok) {
      throw new ErroHttp(400, 'codigo_incorreto', 'Código incorreto. Confira se o relógio do celular está certo e use o código que aparece agora no aplicativo.');
    }
    const { token, expira } = plataforma.starta.criarSessao(r.pessoa.id, 'completa');
    definirCookieStarta(reply, COOKIE_STARTA, token, expira, seguro);
    return { eu: euStarta(plataforma, r.pessoa), codigosRecuperacao: r.codigos };
  });
};

export default rotas;

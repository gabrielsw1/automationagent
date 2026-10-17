// Login de demonstração: escolhe uma pessoa da lista e recebe o cookie hz_sessao.
import type { FastifyInstance } from 'fastify';
import { COOKIE_SESSAO, criarSessao, HORAS_SESSAO } from '../sessao.ts';
import { campoForm, enviarPagina, html, iniciais, usuarioLogado, type Ctx } from './comum.ts';

/** Só aceita caminhos internos ("/clientes?x=1"), nunca outro site. */
function destinoSeguro(voltar: unknown): string {
  const v = typeof voltar === 'string' ? voltar : '';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.startsWith('/entrar') || v.startsWith('/sair')) return '/clientes';
  return v;
}

export function registrarEntrar(app: FastifyInstance, ctx: Ctx): void {
  app.get('/', async (req, reply) => reply.redirect(usuarioLogado(req, ctx) ? '/clientes' : '/entrar', 302));

  app.get<{ Querystring: { voltar?: string } }>('/entrar', async (req, reply) => {
    const atual = usuarioLogado(req, ctx);
    const voltar = destinoSeguro(req.query.voltar);
    const conteudo = html`<div class="caixa-entrar">
      <div class="cabecalho-pagina">
        <div>
          <h1>Entrar no Horizonte</h1>
          <p class="subtitulo">Ambiente de demonstração: escolha com quem você quer entrar. Não há senha.</p>
        </div>
      </div>
      ${atual ? html`<div class="alerta alerta-info">Você está como <strong>${atual.nome}</strong>. Escolha outra pessoa para trocar.</div>` : ''}
      <form method="post" action="/entrar" class="painel">
        <input type="hidden" name="voltar" value="${voltar}">
        <h2>Pessoas</h2>
        <div class="usuarios">
          ${ctx.hz.usuarios().map(
            (u) => html`<button type="submit" class="usuario-opcao" name="usuario_id" value="${u.id}" data-usuario-id="${u.id}">
              <span class="avatar" aria-hidden="true">${iniciais(u.nome)}</span>
              <span class="info"><strong>${u.nome}</strong><small>${u.perfis.join(', ')}</small><small>${u.email}</small></span>
            </button>`,
          )}
        </div>
      </form>
      <p class="nota">Cada perfil vê e pode fazer coisas diferentes. Veja <a href="/ajuda/perfis-de-acesso">Perfis de acesso</a>.</p>
    </div>`;
    return enviarPagina(reply, ctx, { titulo: 'Entrar', pagina: 'Entrar', usuario: null, conteudo, naoIndexar: true });
  });

  app.post('/entrar', async (req, reply) => {
    const u = ctx.hz.usuario(campoForm(req, 'usuario_id'));
    if (!u) return reply.redirect('/entrar', 303);
    const { valor } = criarSessao(u.id, ctx.cfg.segredoSessao, ctx.hz.agora());
    reply.setCookie(COOKIE_SESSAO, valor, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: HORAS_SESSAO * 3600 });
    return reply.redirect(destinoSeguro(campoForm(req, 'voltar')), 303);
  });

  app.get('/sair', async (_req, reply) => {
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return reply.redirect('/entrar', 302);
  });
}

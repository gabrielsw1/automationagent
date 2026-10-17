// Central de ajuda: aberta sem login (o copiloto indexa como fonte de conhecimento).
import type { FastifyInstance } from 'fastify';
import { ARTIGOS, artigoPorSlug } from '../ajuda/artigos.ts';
import { fmtData } from '../util/datas.ts';
import { normalizar } from '../util/texto.ts';
import { bruto, enviarPagina, html, paginaErro, usuarioLogado, type Ctx } from './comum.ts';

export function registrarAjuda(app: FastifyInstance, ctx: Ctx): void {
  app.get<{ Querystring: { q?: string } }>('/ajuda', async (req, reply) => {
    const u = usuarioLogado(req, ctx);
    const q = (req.query.q ?? '').trim();
    const nq = normalizar(q);
    const artigos = nq
      ? ARTIGOS.filter((a) => normalizar(`${a.titulo} ${a.resumo} ${a.corpo.replace(/<[^>]+>/g, ' ')}`).includes(nq))
      : ARTIGOS;
    const categorias = [...new Set(artigos.map((a) => a.categoria))];
    const conteudo = html`<div class="cabecalho-pagina">
        <div>
          <h1>Central de ajuda do Horizonte</h1>
          <p class="subtitulo">Artigos curtos sobre clientes, boletos, agenda, relatórios e acessos.</p>
        </div>
      </div>
      <form method="get" action="/ajuda" class="busca" role="search" style="margin-bottom:18px">
        <label for="q" class="pular">Buscar na ajuda</label>
        <input id="q" name="q" type="search" value="${q}" placeholder="Buscar na ajuda">
        <button type="submit" class="btn btn-secundario">Buscar</button>
      </form>
      ${artigos.length === 0 ? html`<div class="painel vazio">Nenhum artigo encontrado para "${q}".</div>` : ''}
      ${categorias.map(
        (cat) => html`<h2>${cat}</h2>
          <ul class="artigos" style="margin-bottom:20px">
            ${artigos
              .filter((a) => a.categoria === cat)
              .map((a) => html`<li><a href="/ajuda/${a.slug}">${a.titulo}</a><p>${a.resumo}</p></li>`)}
          </ul>`,
      )}`;
    return enviarPagina(reply, ctx, {
      titulo: 'Central de ajuda',
      pagina: 'Ajuda',
      usuario: u,
      conteudo,
      descricao: 'Central de ajuda do Horizonte: clientes, boletos, agenda, relatórios e perfis de acesso.',
    });
  });

  app.get<{ Params: { slug: string } }>('/ajuda/:slug', async (req, reply) => {
    const u = usuarioLogado(req, ctx);
    const a = artigoPorSlug(req.params.slug);
    if (!a) return paginaErro(reply, ctx, u, 404, 'Artigo não encontrado', 'Esse artigo não existe ou mudou de endereço. Veja a lista na Central de ajuda.', 'Ajuda');
    const relacionados = ARTIGOS.filter((x) => x.categoria === a.categoria && x.slug !== a.slug);
    const conteudo = html`<div class="trilha"><a href="/ajuda">Central de ajuda</a> › ${a.categoria}</div>
      <article class="artigo painel">
        <h1>${a.titulo}</h1>
        <p class="meta">${a.categoria} · Atualizado em ${fmtData(a.atualizadoEm)}</p>
        <p><strong>${a.resumo}</strong></p>
        ${bruto(a.corpo)}
      </article>
      ${
        relacionados.length
          ? html`<section class="painel"><h2>Veja também</h2><ul>${relacionados.map((r) => html`<li><a href="/ajuda/${r.slug}">${r.titulo}</a></li>`)}</ul></section>`
          : ''
      }`;
    return enviarPagina(reply, ctx, { titulo: a.titulo, pagina: 'Ajuda', usuario: u, conteudo, descricao: a.resumo });
  });
}

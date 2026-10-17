// Chamados de suporte: lista, abertura e detalhe.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErroHorizonte } from '../negocio.ts';
import { PRIORIDADES, type Usuario } from '../dados/tipos.ts';
import { nomeUsuario } from '../dados/usuarios.ts';
import { fmtDataHora } from '../util/datas.ts';
import {
  avisoSemPermissao,
  campoAreaTexto,
  campoForm,
  campoSelecao,
  campoTexto,
  enviarPagina,
  etiquetaSituacao,
  exigirLogin,
  html,
  paginaErro,
  resumoErros,
  type Ctx,
  type Html,
} from './comum.ts';

const ROTULOS: Record<string, string> = { assunto: 'Assunto', cliente: 'Cliente', prioridade: 'Prioridade', descricao: 'Descrição' };

interface EstadoForm {
  valores: Record<string, string>;
  erros: Record<string, string>;
  alerta?: Html;
}

function pagina(reply: FastifyReply, ctx: Ctx, u: Usuario, f: EstadoForm, aberto?: string, status = 200) {
  const hz = ctx.hz;
  const novo = aberto ? hz.chamado(aberto) : undefined;
  const chamados = hz.chamados();
  const conteudo = html`<div class="cabecalho-pagina">
      <div><h1>Chamados de suporte</h1><p class="subtitulo">${chamados.filter((c) => c.status !== 'Resolvido').length} chamados em andamento.</p></div>
    </div>
    ${novo ? html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Chamado <strong data-campo="numero_chamado">${novo.numero}</strong> aberto.</div>` : ''}
    <div class="duas-colunas">
      <section>
        <div class="tabela-wrap">
          <table>
            <thead><tr><th>Número</th><th>Assunto</th><th>Cliente</th><th>Prioridade</th><th>Situação</th><th>Aberto em</th></tr></thead>
            <tbody>${chamados.map(
              (c) => html`<tr>
                <td><a href="/chamados/${c.id}" class="codigo">${c.numero}</a></td>
                <td>${c.assunto}</td>
                <td>${c.cliente_nome}</td>
                <td>${etiquetaSituacao(c.prioridade)}</td>
                <td>${etiquetaSituacao(c.status)}</td>
                <td>${fmtDataHora(c.criado_em)}</td>
              </tr>`,
            )}</tbody>
          </table>
        </div>
      </section>
      <form method="post" action="/chamados" class="painel" novalidate>
        <h2>Abrir chamado</h2>
        ${f.alerta ?? ''}
        ${resumoErros(f.erros, ROTULOS, {}, 'Não foi possível abrir o chamado.')}
        ${campoTexto({ nome: 'assunto', rotulo: 'Assunto', valor: f.valores.assunto, erro: f.erros.assunto, maximo: 120 })}
        ${campoTexto({ nome: 'cliente', rotulo: 'Cliente', valor: f.valores.cliente, erro: f.erros.cliente, lista: 'lista-clientes-chamado' })}
        ${campoSelecao({
          nome: 'prioridade',
          rotulo: 'Prioridade',
          opcoes: PRIORIDADES.map((p) => ({ valor: p, rotulo: p })),
          selecionado: f.valores.prioridade,
          vazio: 'Selecione',
          erro: f.erros.prioridade,
        })}
        ${campoAreaTexto({ nome: 'descricao', rotulo: 'Descrição', valor: f.valores.descricao, erro: f.erros.descricao, maximo: 2000, linhas: 5 })}
        <button type="submit" class="btn">Abrir chamado</button>
      </form>
    </div>
    <datalist id="lista-clientes-chamado">${hz.listarClientes().map((c) => html`<option value="${c.razao_social}"></option>`)}</datalist>`;
  return enviarPagina(reply, ctx, { titulo: 'Chamados', pagina: 'Chamados', usuario: u, conteudo }, status);
}

export function registrarChamados(app: FastifyInstance, ctx: Ctx): void {
  const { hz } = ctx;

  app.get<{ Querystring: { aberto?: string } }>('/chamados', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    return pagina(reply, ctx, u, { valores: {}, erros: {} }, req.query.aberto);
  });

  app.post('/chamados', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const valores = Object.fromEntries(Object.keys(ROTULOS).map((k) => [k, campoForm(req, k)]));
    try {
      const c = hz.abrirChamado(valores, u);
      return reply.redirect(`/chamados?aberto=${c.id}`, 303);
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      if (e.status === 422) return pagina(reply, ctx, u, { valores, erros: e.campos }, undefined, 422);
      if (e.erro === 'ambiguo') return pagina(reply, ctx, u, { valores, erros: { cliente: e.message } }, undefined, 409);
      return pagina(reply, ctx, u, { valores, erros: {}, alerta: avisoSemPermissao(e.message) }, undefined, e.status);
    }
  });

  app.get<{ Params: { id: string } }>('/chamados/:id', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const c = hz.chamado(req.params.id);
    if (!c) return paginaErro(reply, ctx, u, 404, 'Chamado não encontrado', `Não existe chamado com o número ${req.params.id}.`, 'Chamados');
    const conteudo = html`<div class="cabecalho-pagina">
        <div>
          <div class="trilha"><a href="/chamados">Chamados</a> › ${c.numero}</div>
          <h1>${c.assunto}</h1>
          <p class="subtitulo">Chamado ${c.numero}</p>
        </div>
      </div>
      <section class="painel">
        <dl class="ficha">
          <dt>Número</dt><dd class="codigo" data-campo="numero_chamado">${c.numero}</dd>
          <dt>Cliente</dt><dd data-campo="cliente">${c.cliente_id ? html`<a href="/clientes/${c.cliente_id}">${c.cliente_nome}</a>` : c.cliente_nome}</dd>
          <dt>Prioridade</dt><dd data-campo="prioridade">${c.prioridade}</dd>
          <dt>Situação</dt><dd data-campo="status">${c.status}</dd>
          <dt>Aberto por</dt><dd>${nomeUsuario(c.criado_por)} em ${fmtDataHora(c.criado_em)}</dd>
          <dt>Descrição</dt><dd data-campo="descricao">${c.descricao}</dd>
        </dl>
      </section>
      <p><a href="/chamados">Voltar para os chamados</a></p>`;
    return enviarPagina(reply, ctx, { titulo: `Chamado ${c.numero}`, pagina: 'Chamados', usuario: u, conteudo });
  });
}


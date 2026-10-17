// Peças comuns das telas: HTML com escape automático, layout (cabeçalho, menu, snippet do copiloto),
// campos de formulário com rótulo e mensagem de erro, e a sessão da pessoa logada.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Horizonte } from '../negocio.ts';
import type { Usuario } from '../dados/tipos.ts';
import { assinaturaWidget, COOKIE_SESSAO, lerSessao } from '../sessao.ts';
import { ICONE_SVG } from './estilo.ts';

export class Html {
  constructor(readonly valor: string) {}
  toString(): string {
    return this.valor;
  }
}

export function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderizar(v: unknown): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.valor;
  if (Array.isArray(v)) return v.map(renderizar).join('');
  return escapar(String(v));
}

/** Template HTML: tudo que é interpolado passa por escape, menos outros `html` e `bruto`. */
export function html(partes: TemplateStringsArray, ...valores: unknown[]): Html {
  let s = partes[0];
  for (let i = 0; i < valores.length; i++) s += renderizar(valores[i]) + partes[i + 1];
  return new Html(s);
}

export function bruto(s: string): Html {
  return new Html(s);
}

export interface ConfigTelas {
  copilotoUrl: string;
  copilotoChave: string;
  widgetSegredo: string;
  segredoSessao: string;
}

export interface Ctx {
  hz: Horizonte;
  cfg: ConfigTelas;
}

/** Snippet do copiloto, exatamente como em docs/arquitetura.md. */
export function snippetCopiloto(cfg: ConfigTelas, usuarioId: string): Html {
  const url = cfg.copilotoUrl.replace(/\/$/, '');
  const assinatura = assinaturaWidget(usuarioId, cfg.widgetSegredo);
  return html`<script src="${url}/copiloto.js" data-chave="${cfg.copilotoChave}" data-usuario="${usuarioId}" data-assinatura="${assinatura}" async></script>`;
}

export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

export function usuarioLogado(req: FastifyRequest, ctx: Ctx): Usuario | null {
  const id = lerSessao(req.cookies?.[COOKIE_SESSAO], ctx.cfg.segredoSessao, ctx.hz.agora());
  return id ? ctx.hz.usuario(id) ?? null : null;
}

/** Devolve a pessoa logada ou redireciona para /entrar (guardando o endereço para voltar). */
export function exigirLogin(req: FastifyRequest, reply: FastifyReply, ctx: Ctx): Usuario | null {
  const u = usuarioLogado(req, ctx);
  if (u) return u;
  void reply.redirect(`/entrar?voltar=${encodeURIComponent(req.url)}`, 302);
  return null;
}

export type Secao = 'Clientes' | 'Financeiro' | 'Agenda' | 'Relatórios' | 'Chamados' | 'Ajuda' | 'Entrar' | 'Demonstração' | 'Erro';

export interface OpcoesPagina {
  titulo: string;
  pagina: Secao;
  usuario: Usuario | null;
  conteudo: Html;
  descricao?: string;
  /** Script da própria página (antes do snippet do copiloto). */
  script?: string;
  /** Não inclui o snippet do copiloto (página de bastidores da demonstração). */
  semCopiloto?: boolean;
  /** Pede aos buscadores e ao indexador de conhecimento para não indexar a página. */
  naoIndexar?: boolean;
}

function menu(pagina: Secao): Html {
  const ativo = (s: Secao) => (s === pagina ? 'ativo' : '');
  const aria = (s: Secao) => (s === pagina ? bruto(' aria-current="page"') : '');
  return html`<nav class="menu" aria-label="Menu principal">
      <a href="/clientes" class="${ativo('Clientes')}"${aria('Clientes')}>Clientes</a>
      <details class="submenu ${ativo('Financeiro')}">
        <summary>Financeiro</summary>
        <div class="submenu-itens"><a href="/financeiro/segunda-via">Boletos</a></div>
      </details>
      <details class="submenu ${ativo('Agenda')}">
        <summary>Agenda</summary>
        <div class="submenu-itens"><a href="/agenda">Visitas</a><a href="/agenda/nova-visita">Nova visita</a></div>
      </details>
      <a href="/relatorios" class="${ativo('Relatórios')}"${aria('Relatórios')}>Relatórios</a>
      <a href="/chamados" class="${ativo('Chamados')}"${aria('Chamados')}>Chamados</a>
      <a href="/ajuda" class="${ativo('Ajuda')}"${aria('Ajuda')}>Ajuda</a>
    </nav>`;
}

const SCRIPT_MENU = `document.addEventListener('click',function(e){document.querySelectorAll('details.submenu[open]').forEach(function(d){if(!d.contains(e.target))d.removeAttribute('open');});});`;

export function layout(ctx: Ctx, o: OpcoesPagina): string {
  const u = o.usuario;
  const topoDireita = u
    ? html`<div class="sessao">
        <span class="avatar" aria-hidden="true">${iniciais(u.nome)}</span>
        <span class="quem"><strong data-campo="usuario_logado">${u.nome}</strong><small>${u.perfis.join(', ')}</small></span>
        <a class="trocar" href="/sair">Trocar usuário</a>
      </div>`
    : o.pagina === 'Entrar'
      ? ''
      : html`<div class="sessao"><a class="btn btn-claro btn-pequeno" href="/entrar">Entrar</a></div>`;
  const navegacao = u
    ? menu(o.pagina)
    : html`<nav class="menu" aria-label="Menu principal"><a href="/ajuda" class="${o.pagina === 'Ajuda' ? 'ativo' : ''}">Central de ajuda</a></nav>`;
  return `<!doctype html>
${html`<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${o.titulo} · Horizonte</title>
  ${o.descricao ? html`<meta name="description" content="${o.descricao}">` : ''}
  ${o.naoIndexar ? html`<meta name="robots" content="noindex, nofollow">` : ''}
  <link rel="stylesheet" href="/estatico/horizonte.css">
  <link rel="icon" href="/estatico/icone.svg" type="image/svg+xml">
</head>
<body data-pagina="${o.pagina}">
  <a class="pular" href="#conteudo">Pular para o conteúdo</a>
  <header class="topo">
    <a class="marca" href="/">${bruto(ICONE_SVG)}<span>Horizonte</span></a>
    ${navegacao}
    ${topoDireita}
  </header>
  <main id="conteudo" class="conteudo">
${o.conteudo}
  </main>
  <footer class="rodape">Horizonte · Gestão de clientes e serviços · Ambiente de demonstração${u ? html` · <a href="/_demo">Painel da demonstração</a>` : ''}</footer>
  <script>${bruto(SCRIPT_MENU)}</script>
  ${o.script ? html`<script>${bruto(o.script)}</script>` : ''}
  ${u && !o.semCopiloto ? snippetCopiloto(ctx.cfg, u.id) : ''}
</body>
</html>`}
`;
}

export function enviarPagina(reply: FastifyReply, ctx: Ctx, o: OpcoesPagina, status = 200): FastifyReply {
  return reply.status(status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(layout(ctx, o));
}

export function paginaErro(
  reply: FastifyReply,
  ctx: Ctx,
  usuario: Usuario | null,
  status: number,
  titulo: string,
  mensagem: string,
  pagina: Secao = 'Erro',
): FastifyReply {
  return enviarPagina(
    reply,
    ctx,
    {
      titulo,
      pagina,
      naoIndexar: true,
      usuario,
      conteudo: html`<div class="painel"><h1>${titulo}</h1><p>${mensagem}</p><p><a href="/">Voltar para o início</a></p></div>`,
    },
    status,
  );
}

/** Página para quem não tem o perfil necessário. */
export function avisoSemPermissao(mensagem: string): Html {
  return html`<div class="alerta alerta-aviso" role="alert" data-campo="sem_permissao"><strong>Acesso restrito.</strong> ${mensagem}</div>`;
}

// ---------------- Formulários ----------------

export interface Opcao {
  valor: string;
  rotulo: string;
}

interface CampoBase {
  nome: string;
  rotulo: string;
  id?: string;
  erro?: string;
  ajuda?: string;
  obrigatorio?: boolean;
}

function descritores(id: string, c: CampoBase): Html {
  const ids = [c.ajuda ? `ajuda-${id}` : '', c.erro ? `erro-${id}` : ''].filter(Boolean).join(' ');
  return html`${ids ? html` aria-describedby="${ids}"` : ''}${c.erro ? bruto(' aria-invalid="true"') : ''}${c.obrigatorio ? bruto(' aria-required="true"') : ''}`;
}

function rodapeCampo(id: string, c: CampoBase): Html {
  return html`${c.ajuda ? html`<p class="ajuda" id="ajuda-${id}">${c.ajuda}</p>` : ''}${c.erro ? html`<p class="erro-campo" id="erro-${id}" data-erro-campo="${c.nome}">${c.erro}</p>` : ''}`;
}

export function campoTexto(
  c: CampoBase & { valor?: string; tipo?: string; lista?: string; placeholder?: string; autocomplete?: string; inputmode?: string; maximo?: number },
): Html {
  const id = c.id ?? c.nome;
  return html`<div class="campo${c.erro ? ' com-erro' : ''}">
    <label for="${id}">${c.rotulo}</label>
    <input id="${id}" name="${c.nome}" type="${c.tipo ?? 'text'}" value="${c.valor ?? ''}"${c.lista ? html` list="${c.lista}"` : ''}${c.placeholder ? html` placeholder="${c.placeholder}"` : ''} autocomplete="${c.autocomplete ?? 'off'}"${c.inputmode ? html` inputmode="${c.inputmode}"` : ''}${c.maximo ? html` maxlength="${c.maximo}"` : ''}${descritores(id, c)}>
    ${rodapeCampo(id, c)}
  </div>`;
}

export function campoSelecao(c: CampoBase & { opcoes: Opcao[]; selecionado?: string; vazio?: string }): Html {
  const id = c.id ?? c.nome;
  return html`<div class="campo${c.erro ? ' com-erro' : ''}">
    <label for="${id}">${c.rotulo}</label>
    <select id="${id}" name="${c.nome}"${descritores(id, c)}>
      ${c.vazio !== undefined ? html`<option value="">${c.vazio}</option>` : ''}
      ${c.opcoes.map((o) => html`<option value="${o.valor}"${o.valor === c.selecionado ? bruto(' selected') : ''}>${o.rotulo}</option>`)}
    </select>
    ${rodapeCampo(id, c)}
  </div>`;
}

export function campoAreaTexto(c: CampoBase & { valor?: string; linhas?: number; maximo?: number; placeholder?: string }): Html {
  const id = c.id ?? c.nome;
  return html`<div class="campo${c.erro ? ' com-erro' : ''}">
    <label for="${id}">${c.rotulo}</label>
    <textarea id="${id}" name="${c.nome}" rows="${c.linhas ?? 4}"${c.maximo ? html` maxlength="${c.maximo}"` : ''}${c.placeholder ? html` placeholder="${c.placeholder}"` : ''}${descritores(id, c)}>${c.valor ?? ''}</textarea>
    ${rodapeCampo(id, c)}
  </div>`;
}

/** Resumo dos erros no topo do formulário, com link para cada campo. */
export function resumoErros(erros: Record<string, string>, rotulos: Record<string, string>, ids: Record<string, string> = {}, titulo = 'Não foi possível salvar.'): Html {
  const chaves = Object.keys(erros);
  if (chaves.length === 0) return html``;
  return html`<div class="alerta alerta-erro" role="alert" data-campo="erros">
    <strong>${titulo}</strong> Corrija ${chaves.length === 1 ? 'o campo destacado' : `os ${chaves.length} campos destacados`} abaixo.
    <ul>${chaves.map((k) => html`<li><a href="#${ids[k] ?? k}">${rotulos[k] ?? k}</a>: ${erros[k]}</li>`)}</ul>
  </div>`;
}

/** Texto do corpo de um formulário (application/x-www-form-urlencoded). */
export function campoForm(req: FastifyRequest, nome: string): string {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const v = b[nome];
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v);
}

export function etiquetaSituacao(s: string): Html {
  const cor =
    s === 'Pago' || s === 'Concluída' || s === 'Resolvido'
      ? 'verde'
      : s === 'Vencido' || s === 'Cancelada' || s === 'Urgente'
        ? 'vermelha'
        : s === 'Em aberto' || s === 'Aberto' || s === 'Alta'
          ? 'amarela'
          : s === 'Agendada' || s === 'Em atendimento' || s === 'Média'
            ? 'azul'
            : 'cinza';
  return html`<span class="etiqueta etiqueta-${cor}">${s}</span>`;
}

export function etiquetaPlano(p: string): Html {
  const cor = p === 'Premium' ? 'roxa' : p === 'Pro' ? 'azul' : 'cinza';
  return html`<span class="etiqueta etiqueta-${cor}">${p}</span>`;
}

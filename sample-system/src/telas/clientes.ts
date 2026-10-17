// Telas de clientes: lista, ficha, cadastro, edição e alteração de plano.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErroHorizonte, situacaoBoleto } from '../negocio.ts';
import { PLANOS, PRAZOS, PRECO_PLANO, type Cliente, type Usuario } from '../dados/tipos.ts';
import { mensagemSemPermissao, nomeUsuario } from '../dados/usuarios.ts';
import { fmtData, fmtDataHora, fmtMoeda } from '../util/datas.ts';
import {
  avisoSemPermissao,
  campoForm,
  campoSelecao,
  campoTexto,
  enviarPagina,
  etiquetaPlano,
  etiquetaSituacao,
  exigirLogin,
  html,
  paginaErro,
  resumoErros,
  type Ctx,
  type Html,
} from './comum.ts';

const ROTULOS: Record<string, string> = {
  razao_social: 'Razão social',
  cnpj: 'CNPJ',
  email_cobranca: 'E-mail de cobrança',
  prazo_pagamento_dias: 'Prazo de pagamento',
  responsavel_id: 'Responsável',
};

const CAMPOS_CLIENTE = Object.keys(ROTULOS);

interface EstadoForm {
  valores: Record<string, string>;
  erros: Record<string, string>;
  alerta?: Html;
}

function formCliente(ctx: Ctx, acao: string, botao: string, f: EstadoForm, cancelar: string): Html {
  const usuarios = ctx.hz.usuarios();
  return html`<form method="post" action="${acao}" class="formulario painel" novalidate>
    ${f.alerta ?? ''}
    ${resumoErros(f.erros, ROTULOS)}
    ${campoTexto({ nome: 'razao_social', rotulo: 'Razão social', valor: f.valores.razao_social, erro: f.erros.razao_social, obrigatorio: true, maximo: 120, ajuda: 'Nome registrado da empresa, como no cartão CNPJ.' })}
    ${campoTexto({ nome: 'cnpj', rotulo: 'CNPJ', valor: f.valores.cnpj, erro: f.erros.cnpj, obrigatorio: true, placeholder: '00.000.000/0000-00', inputmode: 'numeric' })}
    ${campoTexto({ nome: 'email_cobranca', rotulo: 'E-mail de cobrança', tipo: 'email', valor: f.valores.email_cobranca, erro: f.erros.email_cobranca, obrigatorio: true, placeholder: 'financeiro@empresa.com.br', ajuda: 'Para onde vão boletos e notas fiscais.' })}
    <div class="linha-campos">
      ${campoSelecao({
        nome: 'prazo_pagamento_dias',
        rotulo: 'Prazo de pagamento',
        opcoes: PRAZOS.map((p) => ({ valor: String(p), rotulo: `${p} dias` })),
        selecionado: f.valores.prazo_pagamento_dias,
        vazio: 'Selecione',
        erro: f.erros.prazo_pagamento_dias,
        obrigatorio: true,
      })}
      ${campoSelecao({
        nome: 'responsavel_id',
        rotulo: 'Responsável',
        opcoes: usuarios.map((u) => ({ valor: u.id, rotulo: u.nome })),
        selecionado: f.valores.responsavel_id,
        vazio: 'Selecione',
        erro: f.erros.responsavel_id,
        obrigatorio: true,
      })}
    </div>
    <div class="acoes">
      <button type="submit" class="btn">${botao}</button>
      <a class="btn btn-secundario" href="${cancelar}">Cancelar</a>
    </div>
  </form>`;
}

/** Converte o erro de negócio em mensagens por campo e alerta. */
function errosDoNegocio(e: unknown): EstadoForm['erros'] & { _alerta?: string; _existente?: string } {
  if (!(e instanceof ErroHorizonte)) throw e;
  if (e.status === 422) return { ...e.campos };
  if (e.erro === 'cnpj_duplicado') {
    const existente = e.extras.existente as Cliente;
    return { cnpj: e.message, _existente: existente.id };
  }
  return { _alerta: e.message };
}

function alertaDe(erros: ReturnType<typeof errosDoNegocio>, ctx: Ctx): Html | undefined {
  if (erros._existente) {
    const c = ctx.hz.cliente(erros._existente);
    if (c) {
      return html`<div class="alerta alerta-aviso" role="alert" data-campo="cliente_existente">
        <strong>CNPJ já cadastrado.</strong> Esse CNPJ pertence a <a href="/clientes/${c.id}">${c.razao_social} (${c.codigo})</a>. Nada foi gravado.
      </div>`;
    }
  }
  if (erros._alerta) return html`<div class="alerta alerta-erro" role="alert">${erros._alerta}</div>`;
  return undefined;
}

function semChavesInternas(erros: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(erros).filter(([k, v]) => !k.startsWith('_') && v)) as Record<string, string>;
}

function paginaNovo(reply: FastifyReply, ctx: Ctx, u: Usuario, f: EstadoForm, status = 200) {
  const restrito = !ctx.hz.pode(u, 'clientes');
  const conteudo = html`<div class="cabecalho-pagina">
      <div>
        <div class="trilha"><a href="/clientes">Clientes</a> › Novo cliente</div>
        <h1>Novo cliente</h1>
        <p class="subtitulo">Todos os campos são obrigatórios. O cliente começa no plano Básico.</p>
      </div>
    </div>
    ${restrito && !f.alerta ? avisoSemPermissao(mensagemSemPermissao('clientes')) : ''}
    ${formCliente(ctx, '/clientes/novo', 'Salvar cliente', f, '/clientes')}`;
  return enviarPagina(reply, ctx, { titulo: 'Novo cliente', pagina: 'Clientes', usuario: u, conteudo }, status);
}

function paginaEditar(reply: FastifyReply, ctx: Ctx, u: Usuario, c: Cliente, f: EstadoForm, status = 200) {
  const conteudo = html`<div class="cabecalho-pagina">
      <div>
        <div class="trilha"><a href="/clientes">Clientes</a> › <a href="/clientes/${c.id}">${c.razao_social}</a> › Editar</div>
        <h1>Editar cliente <span class="destaque-codigo">${c.codigo}</span></h1>
        <p class="subtitulo">O plano muda na ficha do cliente, em "Plano".</p>
      </div>
    </div>
    ${!ctx.hz.pode(u, 'clientes') && !f.alerta ? avisoSemPermissao(mensagemSemPermissao('clientes')) : ''}
    ${formCliente(ctx, `/clientes/${c.id}/editar`, 'Salvar alterações', f, `/clientes/${c.id}`)}`;
  return enviarPagina(reply, ctx, { titulo: `Editar ${c.razao_social}`, pagina: 'Clientes', usuario: u, conteudo }, status);
}

interface ExtrasFicha {
  aviso?: Html;
  erroPlano?: string;
  valoresPlano?: { plano?: string; a_partir_de?: string };
}

function paginaFicha(reply: FastifyReply, ctx: Ctx, u: Usuario, c: Cliente, extras: ExtrasFicha = {}, status = 200) {
  const hz = ctx.hz;
  const hoje = hz.hoje();
  const atrasados = hz.boletosEmAtraso(c.id);
  const boletos = hz.estado.boletos
    .filter((b) => b.cliente_id === c.id)
    .sort((a, b) => b.emissao.localeCompare(a.emissao))
    .slice(0, 6);
  const visitas = hz
    .visitas()
    .filter((v) => v.cliente_id === c.id)
    .reverse()
    .slice(0, 5);
  const chamados = hz
    .chamados()
    .filter((ch) => ch.cliente_id === c.id)
    .slice(0, 5);
  const alteracoes = hz.alteracoesDoCliente(c.id);
  const podePlano = hz.pode(u, 'planos');
  const ultimaAtiva = alteracoes.find((a) => !a.desfeita_em);

  const painelPlano = html`<section class="painel" aria-labelledby="titulo-plano">
    <h2 id="titulo-plano">Plano</h2>
    <p>Plano atual: ${etiquetaPlano(c.plano)} · ${fmtMoeda(PRECO_PLANO[c.plano])} por mês</p>
    ${extras.erroPlano ? html`<div class="alerta alerta-erro" role="alert" data-campo="erro_plano">${extras.erroPlano}</div>` : ''}
    ${
      podePlano
        ? html`<form method="post" action="/clientes/${c.id}/plano" novalidate>
            <div class="linha-campos">
              ${campoSelecao({
                nome: 'plano',
                rotulo: 'Novo plano',
                opcoes: PLANOS.map((p) => ({ valor: p, rotulo: `${p} (${fmtMoeda(PRECO_PLANO[p])}/mês)` })),
                selecionado: extras.valoresPlano?.plano ?? PLANOS.find((p) => p !== c.plano),
              })}
              ${campoTexto({ nome: 'a_partir_de', rotulo: 'A partir de', tipo: 'date', valor: extras.valoresPlano?.a_partir_de ?? hoje })}
            </div>
            <button type="submit" class="btn">Alterar plano</button>
          </form>`
        : html`<p class="nota">Alterar o plano exige o perfil Gestor financeiro ou Administradores. Peça a um Gestor financeiro, que aprova a mudança.</p>`
    }
    ${
      alteracoes.length
        ? html`<h3>Histórico de planos</h3>
          <div class="tabela-wrap"><table>
            <thead><tr><th>Data</th><th>De</th><th>Para</th><th>A partir de</th><th>Por</th><th></th></tr></thead>
            <tbody>${alteracoes.map(
              (a) => html`<tr>
                <td>${fmtDataHora(a.criado_em)}</td><td>${a.plano_anterior}</td><td>${a.plano}</td><td>${fmtData(a.a_partir_de)}</td>
                <td>${nomeUsuario(a.criado_por)}</td>
                <td>${
                  a.desfeita_em
                    ? html`<span class="etiqueta etiqueta-cinza">Desfeita</span>`
                    : podePlano && a === ultimaAtiva && c.plano === a.plano
                      ? html`<form method="post" action="/clientes/${c.id}/plano/${a.id}/desfazer"><button type="submit" class="btn btn-perigo btn-pequeno">Desfazer</button></form>`
                      : ''
                }</td>
              </tr>`,
            )}</tbody>
          </table></div>`
        : ''
    }
  </section>`;

  const conteudo = html`<div class="cabecalho-pagina">
      <div>
        <div class="trilha"><a href="/clientes">Clientes</a> › ${c.razao_social}</div>
        <h1>${c.razao_social}</h1>
        <p class="subtitulo">Cliente desde ${fmtData(c.criado_em.slice(0, 10))}</p>
      </div>
      <div class="acoes">
        ${hz.pode(u, 'clientes') ? html`<a class="btn btn-secundario" href="/clientes/${c.id}/editar">Editar</a>` : ''}
        <a class="btn btn-secundario" href="/agenda/nova-visita?cliente=${encodeURIComponent(c.razao_social)}">Agendar visita</a>
        <a class="btn btn-secundario" href="/financeiro/segunda-via?doc_pagador=${encodeURIComponent(c.cnpj)}">Boletos</a>
      </div>
    </div>
    ${extras.aviso ?? ''}
    ${atrasados.length ? html`<div class="alerta alerta-aviso" data-campo="aviso_atraso"><strong>Boleto vencido.</strong> Este cliente tem ${atrasados.length === 1 ? '1 boleto' : `${atrasados.length} boletos`} em atraso (${atrasados.map((b) => b.competencia).join(', ')}).</div>` : ''}
    <div class="duas-colunas">
      <div>
        <section class="painel" aria-labelledby="titulo-dados">
          <h2 id="titulo-dados">Dados do cliente</h2>
          <dl class="ficha">
            <dt>Código</dt><dd><span class="codigo" data-campo="codigo">${c.codigo}</span></dd>
            <dt>Razão social</dt><dd data-campo="razao_social">${c.razao_social}</dd>
            <dt>CNPJ</dt><dd data-campo="cnpj">${c.cnpj}</dd>
            <dt>E-mail de cobrança</dt><dd data-campo="email_cobranca">${c.email_cobranca}</dd>
            <dt>Prazo de pagamento</dt><dd data-campo="prazo_pagamento_dias">${c.prazo_pagamento_dias} dias</dd>
            <dt>Plano</dt><dd data-campo="plano">${c.plano}</dd>
            <dt>Responsável</dt><dd data-campo="responsavel">${nomeUsuario(c.responsavel_id)}</dd>
            <dt>Cadastrado em</dt><dd data-campo="criado_em">${fmtDataHora(c.criado_em)}</dd>
          </dl>
        </section>
        <section class="painel" aria-labelledby="titulo-boletos">
          <h2 id="titulo-boletos">Boletos recentes</h2>
          ${
            boletos.length
              ? html`<div class="tabela-wrap"><table>
                  <thead><tr><th>Número</th><th>Competência</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th></tr></thead>
                  <tbody>${boletos.map(
                    (b) => html`<tr><td class="codigo">${b.numero}</td><td>${b.competencia}</td><td>${fmtData(b.vencimento)}</td><td class="num">${fmtMoeda(b.valor)}</td><td>${etiquetaSituacao(situacaoBoleto(b, hoje))}</td></tr>`,
                  )}</tbody></table></div>`
              : html`<p class="nota">Nenhum boleto emitido ainda.</p>`
          }
        </section>
      </div>
      <div>
        ${painelPlano}
        <section class="painel" aria-labelledby="titulo-visitas">
          <h2 id="titulo-visitas">Visitas técnicas</h2>
          ${
            visitas.length
              ? html`<ul>${visitas.map((v) => html`<li><a href="/agenda/visitas/${v.id}">${v.protocolo}</a> · ${fmtData(v.data)} às ${v.horario} · ${v.status}</li>`)}</ul>`
              : html`<p class="nota">Nenhuma visita registrada.</p>`
          }
        </section>
        <section class="painel" aria-labelledby="titulo-chamados">
          <h2 id="titulo-chamados">Chamados</h2>
          ${
            chamados.length
              ? html`<ul>${chamados.map((ch) => html`<li><a href="/chamados/${ch.id}">${ch.numero}</a> · ${ch.assunto} · ${ch.status}</li>`)}</ul>`
              : html`<p class="nota">Nenhum chamado aberto.</p>`
          }
        </section>
      </div>
    </div>`;
  return enviarPagina(reply, ctx, { titulo: c.razao_social, pagina: 'Clientes', usuario: u, conteudo }, status);
}

function valoresDoForm(req: { body?: unknown }): Record<string, string> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  return Object.fromEntries(CAMPOS_CLIENTE.map((k) => [k, typeof b[k] === 'string' ? (b[k] as string).trim() : '']));
}

export function registrarClientes(app: FastifyInstance, ctx: Ctx): void {
  const { hz } = ctx;

  app.get<{ Querystring: { busca?: string; removido?: string } }>('/clientes', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const busca = (req.query.busca ?? '').trim();
    const clientes = hz.listarClientes({ busca });
    const hoje = hz.hoje();
    const conteudo = html`<div class="cabecalho-pagina">
        <div>
          <h1>Clientes</h1>
          <p class="subtitulo">${hz.estado.clientes.length} clientes cadastrados.</p>
        </div>
        ${hz.pode(u, 'clientes') ? html`<a class="btn" href="/clientes/novo">Novo cliente</a>` : ''}
      </div>
      ${req.query.removido ? html`<div class="alerta alerta-ok" role="status">Cliente excluído.</div>` : ''}
      <form method="get" action="/clientes" class="busca" role="search">
        <label for="busca" class="pular">Buscar cliente</label>
        <input id="busca" name="busca" type="search" value="${busca}" placeholder="Buscar por nome, código ou CNPJ">
        <button type="submit" class="btn btn-secundario">Buscar</button>
      </form>
      <div class="tabela-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>Código</th><th>Razão social</th><th>CNPJ</th><th>Plano</th><th>Prazo</th><th>Responsável</th><th>Situação</th></tr></thead>
          <tbody>
            ${clientes.map((c) => {
              const atraso = hz.estado.boletos.some((b) => b.cliente_id === c.id && situacaoBoleto(b, hoje) === 'Vencido');
              return html`<tr data-cliente-id="${c.id}">
                <td class="codigo">${c.codigo}</td>
                <td><a href="/clientes/${c.id}">${c.razao_social}</a></td>
                <td class="codigo">${c.cnpj}</td>
                <td>${etiquetaPlano(c.plano)}</td>
                <td>${c.prazo_pagamento_dias} dias</td>
                <td>${nomeUsuario(c.responsavel_id)}</td>
                <td>${atraso ? html`<span class="etiqueta etiqueta-vermelha">Boleto vencido</span>` : html`<span class="etiqueta etiqueta-verde">Em dia</span>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
        ${clientes.length === 0 ? html`<div class="vazio">Nenhum cliente encontrado para "${busca}".</div>` : ''}
      </div>`;
    return enviarPagina(reply, ctx, { titulo: 'Clientes', pagina: 'Clientes', usuario: u, conteudo });
  });

  app.get('/clientes/novo', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    return paginaNovo(reply, ctx, u, { valores: { responsavel_id: u.id }, erros: {} });
  });

  app.post('/clientes/novo', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const valores = valoresDoForm(req);
    try {
      const c = hz.criarCliente(valores, u);
      return reply.redirect(`/clientes/${c.id}?criado=1`, 303);
    } catch (e) {
      const erros = errosDoNegocio(e);
      const status = e instanceof ErroHorizonte ? e.status : 400;
      return paginaNovo(reply, ctx, u, { valores, erros: semChavesInternas(erros), alerta: alertaDe(erros, ctx) }, status);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { criado?: string; salvo?: string } }>('/clientes/:id', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const c = hz.cliente(req.params.id);
    if (!c) return paginaErro(reply, ctx, u, 404, 'Cliente não encontrado', `Não existe cliente com o código #${req.params.id}.`, 'Clientes');
    const aviso = req.query.criado
      ? html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Cliente cadastrado com o código <strong>${c.codigo}</strong>.</div>`
      : req.query.salvo
        ? html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Alterações salvas.</div>`
        : undefined;
    return paginaFicha(reply, ctx, u, c, { aviso });
  });

  app.get<{ Params: { id: string } }>('/clientes/:id/editar', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const c = hz.cliente(req.params.id);
    if (!c) return paginaErro(reply, ctx, u, 404, 'Cliente não encontrado', `Não existe cliente com o código #${req.params.id}.`, 'Clientes');
    const valores = {
      razao_social: c.razao_social,
      cnpj: c.cnpj,
      email_cobranca: c.email_cobranca,
      prazo_pagamento_dias: String(c.prazo_pagamento_dias),
      responsavel_id: c.responsavel_id,
    };
    return paginaEditar(reply, ctx, u, c, { valores, erros: {} });
  });

  app.post<{ Params: { id: string } }>('/clientes/:id/editar', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const c = hz.cliente(req.params.id);
    if (!c) return paginaErro(reply, ctx, u, 404, 'Cliente não encontrado', `Não existe cliente com o código #${req.params.id}.`, 'Clientes');
    const valores = valoresDoForm(req);
    try {
      hz.atualizarCliente(c.id, valores, u);
      return reply.redirect(`/clientes/${c.id}?salvo=1`, 303);
    } catch (e) {
      const erros = errosDoNegocio(e);
      const status = e instanceof ErroHorizonte ? e.status : 400;
      return paginaEditar(reply, ctx, u, c, { valores, erros: semChavesInternas(erros), alerta: alertaDe(erros, ctx) }, status);
    }
  });

  app.post<{ Params: { id: string } }>('/clientes/:id/plano', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const c = hz.cliente(req.params.id);
    if (!c) return paginaErro(reply, ctx, u, 404, 'Cliente não encontrado', `Não existe cliente com o código #${req.params.id}.`, 'Clientes');
    const plano = campoForm(req, 'plano');
    const aPartirDe = campoForm(req, 'a_partir_de');
    try {
      const a = hz.alterarPlano({ cliente: c.id, plano, a_partir_de: aPartirDe }, u);
      const aviso = html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Plano alterado de ${a.plano_anterior} para <strong>${a.plano}</strong> a partir de ${fmtData(a.a_partir_de)}.</div>`;
      return paginaFicha(reply, ctx, u, hz.cliente(c.id)!, { aviso });
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      const msg = e.status === 422 ? Object.values(e.campos).join(' ') || e.message : e.message;
      return paginaFicha(reply, ctx, u, c, { erroPlano: msg, valoresPlano: { plano, a_partir_de: aPartirDe } }, e.status);
    }
  });

  app.post<{ Params: { id: string; alteracao: string } }>('/clientes/:id/plano/:alteracao/desfazer', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const c = hz.cliente(req.params.id);
    if (!c) return paginaErro(reply, ctx, u, 404, 'Cliente não encontrado', `Não existe cliente com o código #${req.params.id}.`, 'Clientes');
    try {
      const a = hz.desfazerAlteracao(req.params.alteracao, u);
      const aviso = html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Alteração desfeita: o plano voltou para <strong>${a.plano_anterior}</strong>.</div>`;
      return paginaFicha(reply, ctx, u, hz.cliente(c.id)!, { aviso });
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      return paginaFicha(reply, ctx, u, c, { erroPlano: e.message }, e.status);
    }
  });
}

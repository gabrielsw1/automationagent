// Agenda: visitas técnicas. Não há API: o copiloto agenda pelas telas.
// Com a demo "tela_agendamento_v2" ligada, a tela muda (rótulo "Data", name="dt_visita" e botão
// "Confirmar agendamento") para mostrar a recuperação visual do navegador do copiloto.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErroHorizonte, HORARIOS } from '../negocio.ts';
import { PRIMEIRO_DISPONIVEL, TECNICOS, type Usuario, type Visita } from '../dados/tipos.ts';
import { mensagemSemPermissao, nomeUsuario } from '../dados/usuarios.ts';
import { fmtData, fmtDataHora } from '../util/datas.ts';
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

interface EstadoForm {
  valores: Record<string, string>;
  erros: Record<string, string>;
  alerta?: Html;
}

function paginaNovaVisita(reply: FastifyReply, ctx: Ctx, u: Usuario, f: EstadoForm, status = 200) {
  const hz = ctx.hz;
  const v2 = hz.estado.demo.tela_agendamento_v2;
  const campoData = v2 ? 'dt_visita' : 'data_visita';
  const rotuloData = v2 ? 'Data' : 'Data da visita';
  const rotulos: Record<string, string> = {
    cliente: 'Cliente',
    data: rotuloData,
    horario: 'Horário',
    tecnico: 'Técnico',
    observacoes: 'Observações',
  };
  const lista = html`<datalist id="lista-clientes">${hz.listarClientes().map((c) => html`<option value="${c.razao_social}">${c.codigo} · ${c.cnpj}</option>`)}</datalist>`;
  const cliente = campoTexto({
    nome: 'cliente',
    rotulo: 'Cliente',
    valor: f.valores.cliente,
    erro: f.erros.cliente,
    lista: 'lista-clientes',
    obrigatorio: true,
    placeholder: 'Comece a digitar o nome do cliente',
  });
  const data = campoTexto({
    nome: campoData,
    rotulo: rotuloData,
    tipo: 'date',
    valor: f.valores.data,
    erro: f.erros.data,
    obrigatorio: true,
    ajuda: v2 ? undefined : 'De segunda a sexta.',
  });
  const horario = campoSelecao({
    nome: 'horario',
    rotulo: 'Horário',
    opcoes: HORARIOS.map((h) => ({ valor: h, rotulo: h })),
    selecionado: f.valores.horario,
    vazio: 'Selecione',
    erro: f.erros.horario,
    obrigatorio: true,
  });
  const tecnico = campoSelecao({
    nome: 'tecnico',
    rotulo: 'Técnico',
    opcoes: [...TECNICOS, PRIMEIRO_DISPONIVEL].map((t) => ({ valor: t, rotulo: t })),
    selecionado: f.valores.tecnico || PRIMEIRO_DISPONIVEL,
    erro: f.erros.tecnico,
  });
  const observacoes = campoAreaTexto({
    nome: 'observacoes',
    rotulo: 'Observações',
    valor: f.valores.observacoes,
    erro: f.erros.observacoes,
    maximo: 500,
    placeholder: 'Endereço, contato no local, equipamento...',
  });
  const ids = { data: campoData };
  const formulario = v2
    ? html`<form method="post" action="/agenda/nova-visita" class="formulario painel" novalidate data-versao="2">
        ${f.alerta ?? ''}
        ${resumoErros(f.erros, rotulos, ids, 'Não foi possível agendar.')}
        <h2>Quando</h2>
        <div class="linha-campos">${data}${horario}</div>
        <h2>Onde e com quem</h2>
        <div class="linha-campos">${cliente}${tecnico}</div>
        ${observacoes}
        <div class="acoes">
          <a class="btn btn-secundario" href="/agenda">Voltar</a>
          <button type="submit" class="btn">Confirmar agendamento</button>
        </div>
      </form>`
    : html`<form method="post" action="/agenda/nova-visita" class="formulario painel" novalidate data-versao="1">
        ${f.alerta ?? ''}
        ${resumoErros(f.erros, rotulos, ids, 'Não foi possível agendar.')}
        ${cliente}
        <div class="linha-campos">${data}${horario}</div>
        ${tecnico}
        ${observacoes}
        <div class="acoes">
          <button type="submit" class="btn">Agendar visita</button>
          <a class="btn btn-secundario" href="/agenda">Cancelar</a>
        </div>
      </form>`;
  const conteudo = html`<div class="cabecalho-pagina">
      <div>
        <div class="trilha"><a href="/agenda">Agenda</a> › Nova visita</div>
        <h1>${v2 ? 'Agendar visita técnica' : 'Nova visita técnica'}</h1>
        <p class="subtitulo">Visitas de segunda a sexta, das 08:00 às 17:00.</p>
      </div>
    </div>
    ${!hz.pode(u, 'agenda') && !f.alerta ? avisoSemPermissao(mensagemSemPermissao('agenda')) : ''}
    ${formulario}
    ${lista}`;
  return enviarPagina(reply, ctx, { titulo: 'Nova visita', pagina: 'Agenda', usuario: u, conteudo }, status);
}

function linhaVisita(v: Visita): Html {
  return html`<tr>
    <td><a href="/agenda/visitas/${v.id}" class="codigo">${v.protocolo}</a></td>
    <td>${fmtData(v.data)}</td><td>${v.horario}</td>
    <td>${v.cliente_nome}</td><td>${v.tecnico}</td>
    <td>${etiquetaSituacao(v.status)}</td>
  </tr>`;
}

export function registrarAgenda(app: FastifyInstance, ctx: Ctx): void {
  const { hz } = ctx;

  app.get('/agenda', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const hoje = hz.hoje();
    const todas = hz.visitas();
    const proximas = todas.filter((v) => v.data >= hoje && v.status === 'Agendada');
    const anteriores = todas.filter((v) => !(v.data >= hoje && v.status === 'Agendada')).reverse().slice(0, 10);
    const tabela = (lista: Visita[], vazio: string) =>
      lista.length
        ? html`<div class="tabela-wrap"><table>
            <thead><tr><th>Protocolo</th><th>Data</th><th>Horário</th><th>Cliente</th><th>Técnico</th><th>Situação</th></tr></thead>
            <tbody>${lista.map(linhaVisita)}</tbody></table></div>`
        : html`<div class="tabela-wrap"><div class="vazio">${vazio}</div></div>`;
    const conteudo = html`<div class="cabecalho-pagina">
        <div><h1>Agenda de visitas técnicas</h1><p class="subtitulo">Técnicos: ${TECNICOS.join(', ')}.</p></div>
        ${hz.pode(u, 'agenda') ? html`<a class="btn" href="/agenda/nova-visita">Nova visita</a>` : ''}
      </div>
      <h2>Próximas visitas</h2>
      ${tabela(proximas, 'Nenhuma visita agendada.')}
      <h2 style="margin-top:22px">Visitas anteriores e canceladas</h2>
      ${tabela(anteriores, 'Nenhuma visita anterior.')}`;
    return enviarPagina(reply, ctx, { titulo: 'Agenda', pagina: 'Agenda', usuario: u, conteudo });
  });

  app.get<{ Querystring: { cliente?: string } }>('/agenda/nova-visita', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    return paginaNovaVisita(reply, ctx, u, { valores: { cliente: (req.query.cliente ?? '').trim() }, erros: {} });
  });

  app.post('/agenda/nova-visita', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const valores = {
      cliente: campoForm(req, 'cliente'),
      data: campoForm(req, 'dt_visita') || campoForm(req, 'data_visita'),
      horario: campoForm(req, 'horario'),
      tecnico: campoForm(req, 'tecnico'),
      observacoes: campoForm(req, 'observacoes'),
    };
    try {
      const v = hz.agendarVisita(valores, u);
      return reply.redirect(`/agenda/visitas/${v.id}?agendada=1`, 303);
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      if (e.status === 422) return paginaNovaVisita(reply, ctx, u, { valores, erros: e.campos }, 422);
      return paginaNovaVisita(reply, ctx, u, { valores, erros: {}, alerta: avisoSemPermissao(e.message) }, e.status);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { agendada?: string; cancelada?: string } }>('/agenda/visitas/:id', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const v = hz.visita(req.params.id);
    if (!v) return paginaErro(reply, ctx, u, 404, 'Visita não encontrada', `Não existe visita com o número ${req.params.id}.`, 'Agenda');
    const conteudo = html`<div class="cabecalho-pagina">
        <div>
          <div class="trilha"><a href="/agenda">Agenda</a> › Visitas › ${v.protocolo}</div>
          <h1>Visita técnica ${v.protocolo}</h1>
          <p class="subtitulo">${v.cliente_nome}</p>
        </div>
        ${
          v.status === 'Agendada' && hz.pode(u, 'agenda')
            ? html`<form method="post" action="/agenda/visitas/${v.id}/cancelar"><button type="submit" class="btn btn-perigo">Cancelar visita</button></form>`
            : ''
        }
      </div>
      ${req.query.agendada ? html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">Visita agendada. Protocolo <strong>${v.protocolo}</strong>.</div>` : ''}
      ${req.query.cancelada ? html`<div class="alerta alerta-aviso" role="status">Visita cancelada.</div>` : ''}
      <section class="painel">
        <dl class="ficha">
          <dt>Protocolo</dt><dd class="codigo" data-campo="protocolo">${v.protocolo}</dd>
          <dt>Cliente</dt><dd data-campo="cliente"><a href="/clientes/${v.cliente_id}">${v.cliente_nome}</a></dd>
          <dt>Data</dt><dd data-campo="data_visita">${fmtData(v.data)}</dd>
          <dt>Horário</dt><dd data-campo="horario">${v.horario}</dd>
          <dt>Técnico</dt><dd data-campo="tecnico">${v.tecnico}</dd>
          <dt>Situação</dt><dd data-campo="status">${v.status}</dd>
          <dt>Observações</dt><dd data-campo="observacoes">${v.observacoes || '—'}</dd>
          <dt>Agendada por</dt><dd>${nomeUsuario(v.criado_por)} em ${fmtDataHora(v.criado_em)}</dd>
        </dl>
      </section>
      <p><a href="/agenda">Voltar para a agenda</a></p>`;
    return enviarPagina(reply, ctx, { titulo: `Visita ${v.protocolo}`, pagina: 'Agenda', usuario: u, conteudo });
  });

  app.post<{ Params: { id: string } }>('/agenda/visitas/:id/cancelar', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    try {
      const v = hz.cancelarVisita(req.params.id, u);
      return reply.redirect(`/agenda/visitas/${v.id}?cancelada=1`, 303);
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      return paginaErro(reply, ctx, u, e.status, 'Não foi possível cancelar', e.message, 'Agenda');
    }
  });
}

// Financeiro › Boletos: busca por pagador e competência e gera a segunda via (PDF + linha digitável).
// Não há API de boletos: o copiloto faz esta tarefa pelas telas.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErroHorizonte } from '../negocio.ts';
import type { Boleto, Usuario } from '../dados/tipos.ts';
import { mensagemSemPermissao } from '../dados/usuarios.ts';
import type { ViaCalculada } from '../boletos.ts';
import { fmtData, fmtMoeda } from '../util/datas.ts';
import {
  avisoSemPermissao,
  campoForm,
  campoSelecao,
  campoTexto,
  enviarPagina,
  etiquetaSituacao,
  exigirLogin,
  html,
  resumoErros,
  type Ctx,
  type Html,
} from './comum.ts';

const ROTULOS = { doc_pagador: 'CPF/CNPJ do pagador', competencia: 'Competência' };

const SCRIPT_BOLETOS = `
document.addEventListener('submit', function (e) {
  var form = e.target;
  if (!form || !form.matches || !form.matches('form[data-form="boletos"]')) return;
  var botao = e.submitter;
  if (!botao || botao.name !== 'gerar') return;
  e.preventDefault();
  var area = document.getElementById('area-resultado');
  botao.disabled = true;
  fetch('/financeiro/boletos/' + encodeURIComponent(botao.value) + '/segunda-via', {
    method: 'POST', headers: { accept: 'application/json' }, credentials: 'same-origin'
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (res) {
    if (!res.ok) throw new Error(res.d.mensagem || 'Não foi possível gerar a segunda via.');
    area.innerHTML = res.d.html;
    var a = document.createElement('a');
    a.href = res.d.url; a.download = res.d.nome_arquivo; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
  }).catch(function (err) {
    area.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'alerta alerta-erro'; div.setAttribute('role', 'alert'); div.setAttribute('data-campo', 'erro_segunda_via');
    div.textContent = err.message;
    area.appendChild(div);
  }).finally(function () { botao.disabled = false; });
});
document.addEventListener('click', function (e) {
  var b = e.target && e.target.closest && e.target.closest('[data-copiar]');
  if (!b) return;
  var alvo = document.querySelector('[data-campo="linha_digitavel"]');
  if (alvo && navigator.clipboard) navigator.clipboard.writeText(alvo.textContent.trim()).then(function () { b.textContent = 'Copiada'; });
});
`;

function urlPdf(numero: string): string {
  return `/financeiro/boletos/${numero}/segunda-via.pdf`;
}

/** Painel com o resultado da segunda via (mesmo HTML com e sem JavaScript). */
export function painelSegundaVia(boleto: Boleto, via: ViaCalculada, comJs: boolean): Html {
  return html`<section class="resultado-via" id="resultado-segunda-via" role="status" aria-labelledby="titulo-via">
    <h2 id="titulo-via">2ª via gerada</h2>
    <p>Boleto <strong data-campo="numero_boleto">${boleto.numero}</strong> · <span data-campo="pagador">${boleto.pagador_nome}</span> · competência ${boleto.competencia}</p>
    <p>Vencimento <strong data-campo="vencimento">${fmtData(via.vencimento)}</strong> · Valor <strong data-campo="valor">${fmtMoeda(via.valor)}</strong>${
      via.situacao === 'Vencido' ? html` <span class="nota">(original ${fmtMoeda(via.valor_original)}, vencido em ${fmtData(boleto.vencimento)}; inclui multa e juros)</span>` : ''
    }${via.situacao === 'Pago' ? html` <span class="nota">(já pago em ${fmtData(boleto.pago_em!)}; esta via é só para conferência)</span>` : ''}</p>
    <div><strong>Linha digitável</strong></div>
    <code class="linha-digitavel" data-campo="linha_digitavel">${via.linha_digitavel}</code>
    <div class="acoes">
      <button type="button" class="btn btn-secundario btn-pequeno" data-copiar>Copiar linha digitável</button>
      <a class="btn btn-secundario btn-pequeno" href="${urlPdf(boleto.numero)}" download="boleto-${boleto.numero}.pdf">Baixar PDF</a>
      ${comJs ? html`<span class="nota">O download do PDF (boleto-${boleto.numero}.pdf) começou.</span>` : ''}
    </div>
  </section>`;
}

interface EstadoBusca {
  doc: string;
  competencia: string;
  erros: Record<string, string>;
  resultado?: Boleto[];
  alerta?: Html;
  gerado?: { boleto: Boleto; via: ViaCalculada };
}

function pagina(reply: FastifyReply, ctx: Ctx, u: Usuario, e: EstadoBusca, status = 200) {
  const hz = ctx.hz;
  const hoje = hz.hoje();
  const competencias = hz.competencias();
  const restrito = !hz.pode(u, 'boletos');
  const tabela =
    e.resultado === undefined
      ? ''
      : e.resultado.length === 0
        ? html`<div class="alerta alerta-info" role="status" data-campo="sem_resultado">Nenhum boleto encontrado para este pagador e competência.</div>`
        : html`<form method="post" action="/financeiro/segunda-via" data-form="boletos">
            <input type="hidden" name="filtro_doc" value="${e.doc}">
            <input type="hidden" name="filtro_competencia" value="${e.competencia}">
            <div class="tabela-wrap">
              <table>
                <caption class="pular">Boletos encontrados</caption>
                <thead><tr><th>Número</th><th>Pagador</th><th>CPF/CNPJ</th><th>Competência</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead>
                <tbody>${e.resultado.map((b) => {
                  const situacao = b.pago_em ? 'Pago' : b.vencimento >= hoje ? 'Em aberto' : 'Vencido';
                  return html`<tr data-boleto="${b.numero}">
                    <td class="codigo">${b.numero}</td>
                    <td>${b.pagador_nome}<div class="nota">${b.descricao}</div></td>
                    <td class="codigo">${b.pagador_doc}</td>
                    <td>${b.competencia}</td>
                    <td>${fmtData(b.vencimento)}</td>
                    <td class="num">${fmtMoeda(b.valor)}</td>
                    <td>${etiquetaSituacao(situacao)}${b.pago_em ? html`<div class="nota">em ${fmtData(b.pago_em)}</div>` : ''}</td>
                    <td><button type="submit" class="btn btn-pequeno" name="gerar" value="${b.numero}">Gerar 2ª via</button></td>
                  </tr>`;
                })}</tbody>
              </table>
            </div>
          </form>`;
  const conteudo = html`<div class="cabecalho-pagina">
      <div>
        <div class="trilha">Financeiro › Boletos</div>
        <h1>Segunda via de boletos</h1>
        <p class="subtitulo">Busque pelo documento de quem paga e pelo mês de referência. A 2ª via de boleto vencido sai com novo vencimento, multa e juros.</p>
      </div>
    </div>
    ${restrito ? avisoSemPermissao(mensagemSemPermissao('boletos')) : ''}
    ${e.alerta ?? ''}
    <form method="post" action="/financeiro/segunda-via" class="painel" novalidate data-form="busca">
      ${resumoErros(e.erros, ROTULOS, {}, 'Não foi possível buscar.')}
      <div class="linha-campos">
        ${campoTexto({ nome: 'doc_pagador', rotulo: 'CPF/CNPJ do pagador', valor: e.doc, erro: e.erros.doc_pagador, obrigatorio: true, inputmode: 'numeric', placeholder: 'Somente números ou com pontuação' })}
        ${campoSelecao({
          nome: 'competencia',
          rotulo: 'Competência',
          opcoes: competencias.map((c) => ({ valor: c, rotulo: c })),
          selecionado: e.competencia || competencias[0],
          erro: e.erros.competencia,
          obrigatorio: true,
        })}
      </div>
      <button type="submit" class="btn">Buscar boletos</button>
    </form>
    <section aria-label="Resultado da busca">
      ${tabela}
      <div id="area-resultado">${e.gerado ? painelSegundaVia(e.gerado.boleto, e.gerado.via, false) : ''}</div>
    </section>`;
  return enviarPagina(reply, ctx, { titulo: 'Segunda via de boletos', pagina: 'Financeiro', usuario: u, conteudo, script: SCRIPT_BOLETOS }, status);
}

function buscar(ctx: Ctx, u: Usuario, doc: string, competencia: string): { estado: EstadoBusca; status: number } {
  const estado: EstadoBusca = { doc, competencia, erros: {} };
  try {
    estado.resultado = ctx.hz.buscarBoletos({ doc_pagador: doc, competencia }, u);
    return { estado, status: 200 };
  } catch (e) {
    if (!(e instanceof ErroHorizonte)) throw e;
    if (e.status === 422) estado.erros = e.campos;
    else estado.alerta = html`<div class="alerta alerta-erro" role="alert">${e.message}</div>`;
    return { estado, status: e.status };
  }
}

export function registrarFinanceiro(app: FastifyInstance, ctx: Ctx): void {
  const { hz } = ctx;

  app.get('/financeiro', async (_req, reply) => reply.redirect('/financeiro/segunda-via', 302));

  app.get<{ Querystring: { doc_pagador?: string } }>('/financeiro/segunda-via', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    return pagina(reply, ctx, u, { doc: (req.query.doc_pagador ?? '').trim(), competencia: '', erros: {} });
  });

  app.post('/financeiro/segunda-via', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const gerar = campoForm(req, 'gerar');
    if (gerar) {
      // Sem JavaScript: gera a 2ª via e mostra a mesma página com o resultado e o link do PDF.
      const { estado } = buscar(ctx, u, campoForm(req, 'filtro_doc'), campoForm(req, 'filtro_competencia'));
      try {
        estado.gerado = hz.gerarSegundaVia(gerar, u);
        return pagina(reply, ctx, u, estado);
      } catch (e) {
        if (!(e instanceof ErroHorizonte)) throw e;
        estado.alerta = html`<div class="alerta alerta-erro" role="alert">${e.message}</div>`;
        return pagina(reply, ctx, u, estado, e.status);
      }
    }
    const { estado, status } = buscar(ctx, u, campoForm(req, 'doc_pagador'), campoForm(req, 'competencia'));
    return pagina(reply, ctx, u, estado, status);
  });

  app.post<{ Params: { numero: string } }>('/financeiro/boletos/:numero/segunda-via', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    try {
      const { boleto, via } = hz.gerarSegundaVia(req.params.numero, u);
      return {
        numero: boleto.numero,
        pagador: boleto.pagador_nome,
        competencia: boleto.competencia,
        situacao: via.situacao,
        vencimento: via.vencimento,
        valor: via.valor,
        linha_digitavel: via.linha_digitavel,
        url: urlPdf(boleto.numero),
        nome_arquivo: `boleto-${boleto.numero}.pdf`,
        html: painelSegundaVia(boleto, via, true).valor,
      };
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      return reply.status(e.status).send(e.corpo());
    }
  });

  app.get<{ Params: { numero: string } }>('/financeiro/boletos/:numero/segunda-via.pdf', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    try {
      const pdf = hz.pdfBoleto(req.params.numero, u);
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="boleto-${req.params.numero}.pdf"`)
        .header('cache-control', 'no-store')
        .send(pdf);
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      return reply.status(e.status).type('text/plain; charset=utf-8').send(e.message);
    }
  });
}

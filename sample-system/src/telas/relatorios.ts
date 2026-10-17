// Relatórios de vendas: formulário, lista dos já gerados e download dos arquivos.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErroHorizonte } from '../negocio.ts';
import type { Usuario } from '../dados/tipos.ts';
import { mensagemSemPermissao, nomeUsuario } from '../dados/usuarios.ts';
import { INICIO_VENDAS } from '../dados/vendas.ts';
import { ROTULO_AGRUPAMENTO, nomeArquivoRelatorio } from '../relatorios.ts';
import { fmtData, fmtDataHora, fmtMoeda, inicioCompetencia, competenciaDe, somarDias } from '../util/datas.ts';
import {
  avisoSemPermissao,
  campoForm,
  campoSelecao,
  campoTexto,
  enviarPagina,
  exigirLogin,
  html,
  resumoErros,
  type Ctx,
  type Html,
} from './comum.ts';

const ROTULOS: Record<string, string> = {
  periodo_inicio: 'Início do período',
  periodo_fim: 'Fim do período',
  agrupar_por: 'Agrupar por',
  formato: 'Formato',
};

interface EstadoForm {
  valores: Record<string, string>;
  erros: Record<string, string>;
  alerta?: Html;
}

function caminhoArquivo(id: string, formato: string): string {
  return `/arquivos/relatorios/${id}.${formato === 'pdf' ? 'pdf' : 'csv'}`;
}

function pagina(reply: FastifyReply, ctx: Ctx, u: Usuario, f: EstadoForm, gerado?: string, status = 200) {
  const hz = ctx.hz;
  const relatorios = hz.relatorios();
  const novo = gerado ? hz.relatorio(gerado) : undefined;
  const conteudo = html`<div class="cabecalho-pagina">
      <div><h1>Relatórios de vendas</h1><p class="subtitulo">Vendas registradas desde ${fmtData(INICIO_VENDAS)}.</p></div>
    </div>
    ${!hz.pode(u, 'relatorios') && !f.alerta ? avisoSemPermissao(mensagemSemPermissao('relatorios')) : ''}
    ${
      novo
        ? html`<div class="alerta alerta-ok" role="status" data-campo="mensagem_sucesso">
            Relatório nº ${novo.numero} gerado: ${novo.linhas} linhas, total de ${fmtMoeda(novo.total_vendas)}.
            <a href="${caminhoArquivo(novo.id, novo.formato)}" data-campo="arquivo_relatorio">Baixar ${novo.formato === 'pdf' ? 'PDF' : 'planilha'}</a>
          </div>`
        : ''
    }
    <div class="duas-colunas">
      <section>
        <h2>Gerados recentemente</h2>
        <div class="tabela-wrap">
          <table>
            <thead><tr><th>Nº</th><th>Período</th><th>Agrupado por</th><th class="num">Total</th><th>Gerado</th><th>Arquivo</th></tr></thead>
            <tbody>${relatorios.slice(0, 15).map(
              (r) => html`<tr>
                <td>${r.numero}</td>
                <td>${fmtData(r.periodo_inicio)} a ${fmtData(r.periodo_fim)}</td>
                <td>${ROTULO_AGRUPAMENTO[r.agrupar_por]}</td>
                <td class="num">${fmtMoeda(r.total_vendas)}</td>
                <td>${fmtDataHora(r.criado_em)}<div class="nota">${nomeUsuario(r.criado_por)}</div></td>
                <td><a href="${caminhoArquivo(r.id, r.formato)}" download="${nomeArquivoRelatorio(r)}">${r.formato === 'pdf' ? 'PDF' : 'Planilha'}</a></td>
              </tr>`,
            )}</tbody>
          </table>
          ${relatorios.length === 0 ? html`<div class="vazio">Nenhum relatório gerado ainda.</div>` : ''}
        </div>
      </section>
      <form method="post" action="/relatorios" class="painel" novalidate>
        <h2>Novo relatório</h2>
        ${f.alerta ?? ''}
        ${resumoErros(f.erros, ROTULOS, {}, 'Não foi possível gerar.')}
        ${campoTexto({ nome: 'periodo_inicio', rotulo: 'Início do período', tipo: 'date', valor: f.valores.periodo_inicio, erro: f.erros.periodo_inicio })}
        ${campoTexto({ nome: 'periodo_fim', rotulo: 'Fim do período', tipo: 'date', valor: f.valores.periodo_fim, erro: f.erros.periodo_fim })}
        ${campoSelecao({
          nome: 'agrupar_por',
          rotulo: 'Agrupar por',
          opcoes: [
            { valor: 'vendedor', rotulo: 'Vendedor' },
            { valor: 'regiao', rotulo: 'Região' },
            { valor: 'produto', rotulo: 'Produto' },
          ],
          selecionado: f.valores.agrupar_por || 'vendedor',
          erro: f.erros.agrupar_por,
        })}
        ${campoSelecao({
          nome: 'formato',
          rotulo: 'Formato',
          opcoes: [
            { valor: 'pdf', rotulo: 'PDF' },
            { valor: 'planilha', rotulo: 'Planilha (CSV)' },
          ],
          selecionado: f.valores.formato || 'pdf',
          erro: f.erros.formato,
        })}
        <button type="submit" class="btn">Gerar relatório</button>
      </form>
    </div>`;
  return enviarPagina(reply, ctx, { titulo: 'Relatórios', pagina: 'Relatórios', usuario: u, conteudo }, status);
}

export function registrarRelatorios(app: FastifyInstance, ctx: Ctx): void {
  const { hz } = ctx;

  app.get<{ Querystring: { gerado?: string } }>('/relatorios', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const hoje = hz.hoje();
    const inicioMes = inicioCompetencia(competenciaDe(hoje));
    const valores = { periodo_inicio: inicioCompetencia(competenciaDe(somarDias(inicioMes, -1))), periodo_fim: somarDias(inicioMes, -1) };
    return pagina(reply, ctx, u, { valores, erros: {} }, req.query.gerado);
  });

  app.post('/relatorios', async (req, reply) => {
    const u = exigirLogin(req, reply, ctx);
    if (!u) return reply;
    const valores = Object.fromEntries(Object.keys(ROTULOS).map((k) => [k, campoForm(req, k)]));
    try {
      const { relatorio } = hz.gerarRelatorio(valores, u);
      return reply.redirect(`/relatorios?gerado=${relatorio.id}`, 303);
    } catch (e) {
      if (!(e instanceof ErroHorizonte)) throw e;
      if (e.status === 422) return pagina(reply, ctx, u, { valores, erros: e.campos }, undefined, 422);
      return pagina(reply, ctx, u, { valores, erros: {}, alerta: avisoSemPermissao(e.message) }, undefined, e.status);
    }
  });

  // Arquivos gerados: o id é difícil de adivinhar, então o link funciona sem login (o copiloto baixa e entrega).
  app.get<{ Params: { arquivo: string } }>('/arquivos/relatorios/:arquivo', async (req, reply) => {
    const m = req.params.arquivo.match(/^([a-z0-9]+)\.(pdf|csv)$/);
    const arquivo = m ? hz.arquivoRelatorio(m[1]) : null;
    if (!m || !arquivo || arquivo.extensao !== m[2]) {
      return reply.status(404).type('text/plain; charset=utf-8').send('Arquivo não encontrado.');
    }
    return reply
      .type(arquivo.tipo)
      .header('content-disposition', `attachment; filename="${arquivo.nome}"`)
      .header('cache-control', 'private, max-age=300')
      .send(arquivo.conteudo);
  });
}

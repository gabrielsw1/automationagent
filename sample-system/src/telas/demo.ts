// Bastidores da demonstração: interruptores "API instável" e "Tela de agendamento nova"
// e o botão para restaurar os dados iniciais. Não faz parte do "sistema" (sem login, sem copiloto).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CNPJ_LIVRE_DEMO } from '../dados/semente.ts';
import { enviarPagina, html, usuarioLogado, type Ctx } from './comum.ts';

function querJson(req: FastifyRequest): boolean {
  const tipo = String(req.headers['content-type'] ?? '');
  const aceita = String(req.headers.accept ?? '');
  return tipo.includes('json') || (aceita.includes('json') && !aceita.includes('html'));
}

function booleano(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true' || v === 'sim' || v === 'on') return true;
  if (v === 0 || v === '0' || v === 'false' || v === 'nao' || v === 'off') return false;
  return undefined;
}

export function registrarDemo(app: FastifyInstance, ctx: Ctx): void {
  const { hz } = ctx;

  app.get<{ Querystring: { ok?: string } }>('/_demo', async (req, reply) => {
    const d = hz.estado.demo;
    const interruptor = (nome: string, titulo: string, descricao: string, ligado: boolean) => html`<div class="interruptor">
        <div>
          <strong>${titulo}</strong> <span class="etiqueta ${ligado ? 'etiqueta-vermelha' : 'etiqueta-cinza'}" data-campo="${nome}">${ligado ? 'Ligado' : 'Desligado'}</span>
          <p>${descricao}</p>
        </div>
        <form method="post" action="/_demo/estado">
          <input type="hidden" name="${nome}" value="${ligado ? '0' : '1'}">
          <button type="submit" class="btn ${ligado ? '' : 'btn-secundario'}">${ligado ? 'Desligar' : 'Ligar'}</button>
        </form>
      </div>`;
    const conteudo = html`<div class="cabecalho-pagina">
        <div>
          <h1>Painel da demonstração</h1>
          <p class="subtitulo">Controles para simular problemas no Horizonte durante a apresentação do copiloto.</p>
        </div>
      </div>
      ${req.query.ok === 'restaurado' ? html`<div class="alerta alerta-ok" role="status">Dados iniciais restaurados.</div>` : ''}
      ${req.query.ok === 'salvo' ? html`<div class="alerta alerta-ok" role="status">Configuração da demonstração salva.</div>` : ''}
      <section class="painel">
        <h2>Simulações</h2>
        ${interruptor(
          'api_instavel',
          'API instável',
          'Todas as rotas /v1 respondem 503, menos /v1/sessoes. Serve para mostrar o copiloto usando o fluxo gravado como reserva, ou avisando que o sistema está fora do ar.',
          d.api_instavel,
        )}
        ${interruptor(
          'tela_agendamento_v2',
          'Tela de agendamento nova',
          'Agenda › Nova visita muda: o campo de data passa a se chamar "Data" (name="dt_visita") e o botão vira "Confirmar agendamento". Serve para mostrar a recuperação visual.',
          d.tela_agendamento_v2,
        )}
      </section>
      <section class="painel">
        <h2>Dados</h2>
        <p>Volta clientes, boletos, visitas, chamados, relatórios e os interruptores ao estado inicial. O próximo cliente cadastrado volta a ser o #4821.</p>
        <form method="post" action="/_demo/restaurar"><button type="submit" class="btn btn-perigo">Restaurar dados iniciais</button></form>
      </section>
      <section class="painel">
        <h2>Para a apresentação</h2>
        <ul>
          <li>CNPJ livre para cadastro novo: <strong class="codigo">${CNPJ_LIVRE_DEMO}</strong> (ex.: "ACME Logística").</li>
          <li>CNPJ já cadastrado (conflito): <strong class="codigo">12.345.678/0001-95</strong>, ACME Log Ltda #3190.</li>
          <li>Boletos: Transportes Vale (${hz.cliente('1187')?.cnpj ?? ''}) e Clínica Bem Viver (${hz.cliente('1342')?.cnpj ?? ''}), competências dos últimos 12 meses.</li>
          <li>Ambiguidade na troca de plano: "Transportes" (Transportes Vale e Delta Transportes).</li>
        </ul>
        <p><a href="/entrar">Entrar no Horizonte</a> · <a href="/ajuda">Central de ajuda</a></p>
      </section>`;
    return enviarPagina(reply, ctx, { titulo: 'Painel da demonstração', pagina: 'Demonstração', usuario: usuarioLogado(req, ctx), conteudo, semCopiloto: true, naoIndexar: true });
  });

  app.get('/_demo/estado', async () => ({ ...hz.estado.demo }));

  app.post('/_demo/estado', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const estado = hz.definirDemo({ api_instavel: booleano(b.api_instavel), tela_agendamento_v2: booleano(b.tela_agendamento_v2) });
    if (querJson(req)) return estado;
    return reply.redirect('/_demo?ok=salvo', 303);
  });

  app.post('/_demo/restaurar', async (req, reply) => {
    hz.restaurar();
    if (querJson(req)) return { ok: true, ...hz.estado.demo };
    return reply.redirect('/_demo?ok=restaurado', 303);
  });
}

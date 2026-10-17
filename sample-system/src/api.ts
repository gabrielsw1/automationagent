// API REST do Horizonte (/v1). Autenticação por chave de serviço (Authorization: Bearer) e
// X-Usuario-Id: cada chamada usa as permissões dessa pessoa. Ver docs/arquitetura.md.
//
// x-simulacao: 1 → valida tudo (permissões e duplicidade inclusive) e responde como se tivesse gravado,
// com "simulado": true, sem gravar. idempotency-key → a mesma chave devolve a mesma resposta sem gravar de novo.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErroHorizonte, type Horizonte } from './negocio.ts';
import { PERFIS, PLANOS, PRECO_PLANO, type Usuario } from './dados/tipos.ts';
import { nomeArquivoRelatorio } from './relatorios.ts';
import { COOKIE_SESSAO, criarSessao, segredosIguais } from './sessao.ts';

export interface OpcoesApi {
  hz: Horizonte;
  chaveServico: string;
  segredoSessao: string;
  versao: string;
  /** Endereço público do Horizonte para montar arquivo_url (padrão: o Host da requisição). */
  urlPublica?: string;
}

type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RotaApi {
  metodo: MetodoHttp;
  caminho: string;
  descricao: string;
  campos?: { nome: string; tipo: string; obrigatorio: boolean; descricao?: string }[];
  idRetorno?: string;
}

export const ROTAS: RotaApi[] = [
  { metodo: 'GET', caminho: '/v1/saude', descricao: 'Confere se a API está no ar. Responde { ok, versao }.' },
  { metodo: 'GET', caminho: '/v1/usuarios', descricao: 'Lista as pessoas que usam o Horizonte, com e-mail e perfis de acesso.' },
  { metodo: 'GET', caminho: '/v1/usuarios/{id}', descricao: 'Uma pessoa pelo ID (404 se não existir).' },
  { metodo: 'GET', caminho: '/v1/perfis', descricao: 'Perfis de acesso: Comercial, Financeiro, Atendimento, Técnico, Gestor financeiro e Administradores.' },
  {
    metodo: 'POST',
    caminho: '/v1/sessoes',
    descricao: 'Abre uma sessão das telas para a pessoa (cookie hz_sessao), usada pelo navegador automático.',
    campos: [{ nome: 'usuario_id', tipo: 'texto', obrigatorio: true, descricao: 'ID da pessoa no Horizonte, por exemplo 101.' }],
  },
  {
    metodo: 'GET',
    caminho: '/v1/clientes?documento={cnpj}&busca={texto}',
    descricao:
      'Procura clientes. "documento" é o CNPJ só com números (serve para ver se o cliente já existe); "busca" procura no nome, sem acento e sem diferença de maiúsculas.',
  },
  { metodo: 'GET', caminho: '/v1/clientes/{id}', descricao: 'Ficha de um cliente pelo código (ex.: 3190). 404 se não existir.' },
  {
    metodo: 'POST',
    caminho: '/v1/clientes',
    descricao:
      'Cadastra um cliente (empresa). Todo cliente novo começa no plano Básico. Erros: 409 cnpj_duplicado (com o cliente existente), 422 validacao (com os campos), 403 sem_permissao (perfis Comercial, Atendimento ou Administradores).',
    campos: [
      { nome: 'razao_social', tipo: 'texto', obrigatorio: true, descricao: 'Nome registrado da empresa.' },
      { nome: 'cnpj', tipo: 'documento', obrigatorio: true, descricao: 'CNPJ válido, com ou sem pontuação.' },
      { nome: 'email_cobranca', tipo: 'email', obrigatorio: true, descricao: 'E-mail que recebe boletos e notas.' },
      { nome: 'prazo_pagamento_dias', tipo: 'numero', obrigatorio: true, descricao: 'Prazo de pagamento em dias: 15, 30, 45 ou 60.' },
      { nome: 'responsavel_id', tipo: 'texto', obrigatorio: true, descricao: 'ID da pessoa responsável pela conta (ver /v1/usuarios).' },
    ],
    idRetorno: 'id',
  },
  {
    metodo: 'PATCH',
    caminho: '/v1/clientes/{id}',
    descricao: 'Atualiza dados de um cliente. Mesmos campos do cadastro, todos opcionais (o plano muda só por /v1/planos/alteracoes).',
    campos: [
      { nome: 'razao_social', tipo: 'texto', obrigatorio: false },
      { nome: 'cnpj', tipo: 'documento', obrigatorio: false },
      { nome: 'email_cobranca', tipo: 'email', obrigatorio: false },
      { nome: 'prazo_pagamento_dias', tipo: 'numero', obrigatorio: false, descricao: '15, 30, 45 ou 60.' },
      { nome: 'responsavel_id', tipo: 'texto', obrigatorio: false },
    ],
  },
  { metodo: 'DELETE', caminho: '/v1/clientes/{id}', descricao: 'Exclui um cliente (desfaz um cadastro). Responde 204.' },
  { metodo: 'GET', caminho: '/v1/planos', descricao: 'Planos disponíveis: Básico, Pro e Premium, com o preço mensal.' },
  {
    metodo: 'POST',
    caminho: '/v1/planos/alteracoes',
    descricao:
      'Muda o plano de um cliente. "cliente" aceita o nome (sem acento e sem diferença de maiúsculas) ou o CNPJ. Erros: 404 cliente_nao_encontrado, 409 ambiguo (com "opcoes"), 409 mesmo_plano, 403 sem_permissao (só Gestor financeiro ou Administradores).',
    campos: [
      { nome: 'cliente', tipo: 'texto', obrigatorio: true, descricao: 'Nome ou CNPJ do cliente.' },
      { nome: 'plano', tipo: 'lista', obrigatorio: true, descricao: 'Básico, Pro ou Premium.' },
      { nome: 'a_partir_de', tipo: 'data', obrigatorio: false, descricao: 'Data em que o plano novo começa (AAAA-MM-DD). Padrão: hoje.' },
    ],
    idRetorno: 'id',
  },
  { metodo: 'DELETE', caminho: '/v1/planos/alteracoes/{id}', descricao: 'Desfaz uma alteração de plano: o cliente volta ao plano anterior. Responde 204.' },
  {
    metodo: 'POST',
    caminho: '/v1/relatorios/vendas',
    descricao:
      'Gera um relatório de vendas do período e devolve o link do arquivo (arquivo_url), a quantidade de linhas e o total vendido. Perfis Comercial, Financeiro, Gestor financeiro ou Administradores.',
    campos: [
      { nome: 'periodo_inicio', tipo: 'data', obrigatorio: true, descricao: 'Primeiro dia do período (AAAA-MM-DD).' },
      { nome: 'periodo_fim', tipo: 'data', obrigatorio: true, descricao: 'Último dia do período (AAAA-MM-DD).' },
      { nome: 'agrupar_por', tipo: 'lista', obrigatorio: true, descricao: 'vendedor, regiao ou produto.' },
      { nome: 'formato', tipo: 'lista', obrigatorio: true, descricao: 'pdf ou planilha (CSV).' },
    ],
    idRetorno: 'id',
  },
  { metodo: 'GET', caminho: '/v1/relatorios', descricao: 'Relatórios de vendas já gerados, do mais recente para o mais antigo.' },
  {
    metodo: 'POST',
    caminho: '/v1/chamados',
    descricao: 'Abre um chamado de suporte. Responde { id, numero }, por exemplo CH-2026-0153.',
    campos: [
      { nome: 'assunto', tipo: 'texto', obrigatorio: true, descricao: 'Resumo do problema em poucas palavras.' },
      { nome: 'cliente', tipo: 'texto', obrigatorio: true, descricao: 'Nome ou CNPJ do cliente.' },
      { nome: 'prioridade', tipo: 'lista', obrigatorio: true, descricao: 'Baixa, Média, Alta ou Urgente.' },
      { nome: 'descricao', tipo: 'texto', obrigatorio: true, descricao: 'O que está acontecendo, com pelo menos 10 caracteres.' },
    ],
    idRetorno: 'id',
  },
  { metodo: 'GET', caminho: '/v1/chamados', descricao: 'Chamados de suporte, do mais recente para o mais antigo.' },
  { metodo: 'GET', caminho: '/v1/chamados/{id}', descricao: 'Um chamado pelo ID ou pelo número (CH-2026-0153).' },
  { metodo: 'DELETE', caminho: '/v1/chamados/{id}', descricao: 'Exclui um chamado (desfaz a abertura). Responde 204.' },
];

interface Resposta {
  status: number;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

function corpoDe(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (b === undefined || b === null || b === '') return {};
  if (typeof b !== 'object' || Array.isArray(b)) {
    throw new ErroHorizonte(400, 'corpo_invalido', 'O corpo da requisição precisa ser um objeto JSON.');
  }
  return b as Record<string, unknown>;
}

function cabecalho(req: FastifyRequest, nome: string): string {
  const v = req.headers[nome];
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

export function registrarApi(app: FastifyInstance, o: OpcoesApi): void {
  const { hz } = o;
  const idempotencia = new Map<string, Resposta>();

  const exigirUsuario = (req: FastifyRequest): Usuario => {
    const id = cabecalho(req, 'x-usuario-id');
    if (!id) {
      throw new ErroHorizonte(400, 'usuario_obrigatorio', 'Informe a pessoa no cabeçalho X-Usuario-Id: o Horizonte aplica as permissões dela.');
    }
    const u = hz.usuario(id);
    if (!u) throw new ErroHorizonte(403, 'usuario_desconhecido', `A pessoa ${id} não existe no Horizonte.`);
    return u;
  };

  const urlBase = (req: FastifyRequest) => (o.urlPublica ?? `${req.protocol}://${req.host}`).replace(/\/$/, '');

  /** Envolve uma rota que grava: usuário, simulação, idempotência e erros de negócio. */
  const escrita =
    (handler: (req: FastifyRequest, ctx: { usuario: Usuario; simular: boolean }) => Resposta) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const usuario = exigirUsuario(req);
      const simular = ['1', 'true', 'sim'].includes(cabecalho(req, 'x-simulacao').toLowerCase());
      const chave = cabecalho(req, 'idempotency-key');
      const chaveCache = chave && !simular ? `${usuario.id} ${req.method} ${req.url} ${chave}` : null;
      const guardada = chaveCache ? idempotencia.get(chaveCache) : undefined;
      if (guardada) {
        reply.header('idempotent-replayed', 'true');
        return enviar(reply, guardada);
      }
      let r: Resposta;
      try {
        r = handler(req, { usuario, simular });
      } catch (e) {
        if (!(e instanceof ErroHorizonte)) throw e;
        r = { status: e.status, corpo: e.corpo() };
      }
      if (simular && r.status < 300) {
        reply.header('x-simulado', '1');
        r =
          r.status === 204 || r.corpo === undefined
            ? { status: 200, corpo: { ok: true, simulado: true } }
            : { ...r, corpo: { ...(r.corpo as Record<string, unknown>), simulado: true } };
      }
      if (chaveCache && r.status < 300) idempotencia.set(chaveCache, r);
      return enviar(reply, r);
    };

  const enviar = (reply: FastifyReply, r: Resposta) => {
    if (r.cabecalhos) for (const [k, v] of Object.entries(r.cabecalhos)) reply.header(k, v);
    reply.status(r.status);
    return r.corpo === undefined ? reply.send() : reply.send(r.corpo);
  };

  app.register(
    async (api) => {
      api.addHook('onRequest', async (req, reply) => {
        const caminho = req.url.split('?')[0];
        if (hz.estado.demo.api_instavel && caminho !== '/v1/sessoes') {
          reply.header('retry-after', '30');
          return reply.status(503).send({
            erro: 'indisponivel',
            mensagem: 'O Horizonte está fora do ar no momento. Tente de novo em alguns minutos.',
          });
        }
        const m = cabecalho(req, 'authorization').match(/^Bearer\s+(.+)$/i);
        if (!m || !segredosIguais(m[1].trim(), o.chaveServico)) {
          return reply.status(401).send({
            erro: 'nao_autenticado',
            mensagem: 'Chave de serviço ausente ou inválida. Envie Authorization: Bearer <chave de serviço>.',
          });
        }
      });

      api.get('/saude', async () => ({ ok: true, versao: o.versao }));

      api.get('/usuarios', async () => ({ itens: hz.usuarios() }));

      api.get<{ Params: { id: string } }>('/usuarios/:id', async (req, reply) => {
        const u = hz.usuario(req.params.id);
        if (!u) return reply.status(404).send({ erro: 'usuario_nao_encontrado', mensagem: `A pessoa ${req.params.id} não existe no Horizonte.` });
        return u;
      });

      api.get('/perfis', async () => ({ itens: PERFIS }));

      api.get('/rotas', async () => ({ itens: ROTAS }));

      api.post('/sessoes', async (req, reply) => {
        const corpo = corpoDe(req);
        const id = String(corpo.usuario_id ?? '').trim();
        if (!id) {
          return reply.status(422).send({ erro: 'validacao', mensagem: 'Informe usuario_id.', campos: { usuario_id: 'Informe usuario_id.' } });
        }
        const u = hz.usuario(id);
        if (!u) return reply.status(404).send({ erro: 'usuario_nao_encontrado', mensagem: `A pessoa ${id} não existe no Horizonte.` });
        const { valor, expiraEm } = criarSessao(u.id, o.segredoSessao, hz.agora());
        return reply.status(201).send({
          cookie: { name: COOKIE_SESSAO, value: valor },
          expira_em: expiraEm.toISOString(),
          usuario: { id: u.id, nome: u.nome },
        });
      });

      // ---------- Clientes ----------
      api.get<{ Querystring: { documento?: string; busca?: string } }>('/clientes', async (req) => ({
        itens: hz.listarClientes({ documento: req.query.documento, busca: req.query.busca }),
      }));

      api.get<{ Params: { id: string } }>('/clientes/:id', async (req, reply) => {
        const c = hz.cliente(req.params.id);
        if (!c) return reply.status(404).send({ erro: 'cliente_nao_encontrado', mensagem: `Não existe cliente com o código #${req.params.id}.` });
        return c;
      });

      api.post(
        '/clientes',
        escrita((req, { usuario, simular }) => {
          const c = hz.criarCliente(corpoDe(req), usuario, simular);
          return { status: 201, corpo: c, cabecalhos: { location: `/v1/clientes/${c.id}` } };
        }),
      );

      api.patch<{ Params: { id: string } }>(
        '/clientes/:id',
        escrita((req, { usuario, simular }) => ({
          status: 200,
          corpo: hz.atualizarCliente((req.params as { id: string }).id, corpoDe(req), usuario, simular),
        })),
      );

      api.delete<{ Params: { id: string } }>(
        '/clientes/:id',
        escrita((req, { usuario, simular }) => {
          hz.removerCliente((req.params as { id: string }).id, usuario, simular);
          return { status: 204 };
        }),
      );

      // ---------- Planos ----------
      api.get('/planos', async () => ({ itens: PLANOS, precos: PRECO_PLANO }));

      api.get<{ Querystring: { cliente_id?: string } }>('/planos/alteracoes', async (req) => ({
        itens: req.query.cliente_id
          ? hz.alteracoesDoCliente(req.query.cliente_id)
          : [...hz.estado.alteracoes_plano].sort((a, b) => b.criado_em.localeCompare(a.criado_em)),
      }));

      api.post(
        '/planos/alteracoes',
        escrita((req, { usuario, simular }) => {
          const a = hz.alterarPlano(corpoDe(req), usuario, simular);
          return {
            status: 201,
            corpo: {
              id: a.id,
              cliente_id: a.cliente_id,
              cliente_nome: a.cliente_nome,
              plano_anterior: a.plano_anterior,
              plano: a.plano,
              a_partir_de: a.a_partir_de,
              criado_em: a.criado_em,
            },
          };
        }),
      );

      api.delete<{ Params: { id: string } }>(
        '/planos/alteracoes/:id',
        escrita((req, { usuario, simular }) => {
          hz.desfazerAlteracao((req.params as { id: string }).id, usuario, simular);
          return { status: 204 };
        }),
      );

      // ---------- Relatórios ----------
      api.get('/relatorios', async (req) => ({
        itens: hz.relatorios().map((r) => ({
          ...r,
          arquivo_url: `${urlBase(req)}/arquivos/relatorios/${r.id}.${r.formato === 'pdf' ? 'pdf' : 'csv'}`,
        })),
      }));

      api.post(
        '/relatorios/vendas',
        escrita((req, { usuario, simular }) => {
          const { relatorio: r, resultado } = hz.gerarRelatorio(corpoDe(req), usuario, simular);
          const caminho = `/arquivos/relatorios/${r.id}.${r.formato === 'pdf' ? 'pdf' : 'csv'}`;
          return {
            status: 201,
            corpo: {
              id: r.id,
              numero: r.numero,
              arquivo_url: simular ? null : `${urlBase(req)}${caminho}`,
              arquivo_caminho: simular ? null : caminho,
              nome_arquivo: nomeArquivoRelatorio(r),
              linhas: r.linhas,
              total_vendas: r.total_vendas,
              quantidade_vendas: resultado.quantidade,
              periodo_inicio: r.periodo_inicio,
              periodo_fim: r.periodo_fim,
              agrupar_por: r.agrupar_por,
              formato: r.formato,
            },
          };
        }),
      );

      // ---------- Chamados ----------
      api.get('/chamados', async () => ({ itens: hz.chamados() }));

      api.get<{ Params: { id: string } }>('/chamados/:id', async (req, reply) => {
        const c = hz.chamado(req.params.id);
        if (!c) return reply.status(404).send({ erro: 'chamado_nao_encontrado', mensagem: `Não existe chamado com o número ${req.params.id}.` });
        return c;
      });

      api.post(
        '/chamados',
        escrita((req, { usuario, simular }) => ({ status: 201, corpo: hz.abrirChamado(corpoDe(req), usuario, simular) })),
      );

      api.delete<{ Params: { id: string } }>(
        '/chamados/:id',
        escrita((req, { usuario, simular }) => {
          hz.removerChamado((req.params as { id: string }).id, usuario, simular);
          return { status: 204 };
        }),
      );
    },
    { prefix: '/v1' },
  );
}


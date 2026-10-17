// Ajuda para testes do servidor: plataforma com bancos em memória, modelo simulado e uma empresa
// de demonstração cujo adaptador falso imita a API do Horizonte (sem rede).
import type { FastifyInstance } from 'fastify';
import type { PerfilEquipe, UsuarioSistema } from '@copiloto/shared';
import { cnpjValido, somenteDigitos } from '@copiloto/shared';
import { criarApp } from '../src/app.ts';
import { COOKIE_SESSAO } from '../src/auth/console.ts';
import { lerConfig, type Config } from '../src/config.ts';
import type { Contexto } from '../src/contexto.ts';
import { agoraIso } from '../src/db/banco.ts';
import type { Llm } from '../src/llm/tipos.ts';
import { LlmSimulado } from '../src/llm/simulado.ts';
import type { Navegador } from '../src/navegador/tipos.ts';
import type { AdaptadorSistema, ChamadaApi, RespostaApi, RotaApi, SessaoNavegador } from '../src/adaptadores/tipos.ts';
import { Plataforma } from '../src/plataforma/index.ts';
import { semearPlataforma, type ResumoSeed } from '../src/seed/index.ts';
import { novoId } from '../src/util/ids.ts';

export const USUARIOS_TESTE: UsuarioSistema[] = [
  { id: '101', nome: 'Ana Ribeiro', email: 'ana.ribeiro@horizonte.com.br', perfis: ['Atendimento', 'Comercial'] },
  { id: '102', nome: 'Marcos Teixeira', email: 'marcos.teixeira@horizonte.com.br', perfis: ['Financeiro'] },
  { id: '103', nome: 'Paula Nunes', email: 'paula.nunes@horizonte.com.br', perfis: ['Comercial'] },
  { id: '104', nome: 'Diego Alves', email: 'diego.alves@horizonte.com.br', perfis: ['Técnico', 'Atendimento'] },
  { id: '105', nome: 'Rafael Lima', email: 'rafael.lima@horizonte.com.br', perfis: ['Administradores', 'Gestor financeiro'] },
  { id: '106', nome: 'Júlia Martins', email: 'julia.martins@horizonte.com.br', perfis: ['Administradores'] },
  { id: '107', nome: 'Camila Souza', email: 'camila.souza@horizonte.com.br', perfis: ['Atendimento'] },
];

interface ClienteFalso {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string;
  email_cobranca: string;
  prazo_pagamento_dias: number;
  plano: string;
  responsavel_id: string;
  criado_em: string;
}

/** Imita a API do Horizonte em memória. `fora` simula o sistema fora do ar. */
export class AdaptadorFalso implements AdaptadorSistema {
  readonly nome = 'Horizonte';
  readonly urlBase = 'http://horizonte.teste';
  fora = false;
  chamadas: ChamadaApi[] = [];
  clientes: ClienteFalso[] = [
    {
      id: '3190',
      codigo: '#3190',
      razao_social: 'ACME Log Ltda',
      cnpj: '12345678000195',
      email_cobranca: 'contato@acmelog.com.br',
      prazo_pagamento_dias: 15,
      plano: 'Básico',
      responsavel_id: '105',
      criado_em: '2025-03-10T12:00:00.000Z',
    },
  ];
  private proximo = 4821;

  async verificarConexao() {
    return this.fora ? { ok: false, detalhe: 'Fora do ar' } : { ok: true, detalhe: 'API conectada · teste' };
  }
  async buscarUsuario(id: string) {
    return USUARIOS_TESTE.find((u) => u.id === id) ?? null;
  }
  async listarUsuarios() {
    return USUARIOS_TESTE;
  }
  async listarPerfis() {
    return ['Comercial', 'Financeiro', 'Atendimento', 'Técnico', 'Gestor financeiro', 'Administradores'];
  }
  async descreverApi(): Promise<RotaApi[]> {
    return [{ metodo: 'POST', caminho: '/v1/clientes', descricao: 'Cria um cliente', idRetorno: 'id' }];
  }
  async sessaoNavegador(_usuarioId: string): Promise<SessaoNavegador> {
    return { cookies: [{ name: 'hz_sessao', value: 'teste', url: this.urlBase }] };
  }

  async chamar(c: ChamadaApi): Promise<RespostaApi> {
    this.chamadas.push(c);
    const r = (status: number, corpo: unknown): RespostaApi => ({ status, corpo, duracaoMs: 5 });
    if (this.fora) return r(503, { erro: 'indisponivel', mensagem: 'Sistema fora do ar' });
    const usuario = USUARIOS_TESTE.find((u) => u.id === c.usuarioId);
    const [caminho, query] = c.caminho.split('?');
    const params = new URLSearchParams(query ?? '');
    if (c.metodo === 'GET' && caminho === '/v1/clientes') {
      const doc = somenteDigitos(params.get('documento') ?? '');
      return r(200, { itens: this.clientes.filter((x) => !doc || x.cnpj === doc) });
    }
    const m = caminho.match(/^\/v1\/clientes\/(\d+)$/);
    if (m && c.metodo === 'GET') {
      const cli = this.clientes.find((x) => x.id === m[1]);
      return cli ? r(200, cli) : r(404, { erro: 'nao_encontrado' });
    }
    if (m && c.metodo === 'DELETE') {
      if (!c.simulacao) this.clientes = this.clientes.filter((x) => x.id !== m[1]);
      return r(204, '');
    }
    if (c.metodo === 'POST' && caminho === '/v1/clientes') {
      const p = (c.corpo ?? {}) as Record<string, unknown>;
      if (!usuario?.perfis.some((x) => ['Comercial', 'Financeiro', 'Atendimento', 'Administradores'].includes(x))) {
        return r(403, { erro: 'sem_permissao', mensagem: 'Sem permissão', perfil_necessario: 'Comercial' });
      }
      const cnpj = somenteDigitos(String(p.cnpj ?? ''));
      if (!cnpjValido(cnpj)) return r(422, { erro: 'validacao', mensagem: 'CNPJ inválido', campos: { cnpj: 'inválido' } });
      const existente = this.clientes.find((x) => x.cnpj === cnpj);
      if (existente) return r(409, { erro: 'cnpj_duplicado', mensagem: 'CNPJ já cadastrado', existente });
      const id = String(this.proximo++);
      const novo: ClienteFalso = {
        id,
        codigo: `#${id}`,
        razao_social: String(p.razao_social),
        cnpj,
        email_cobranca: String(p.email_cobranca),
        prazo_pagamento_dias: Number(p.prazo_pagamento_dias),
        plano: 'Básico',
        responsavel_id: String(p.responsavel_id ?? c.usuarioId),
        criado_em: agoraIso(),
      };
      if (c.simulacao) return r(201, { ...novo, simulado: true });
      this.clientes.push(novo);
      return r(201, novo);
    }
    if (c.metodo === 'POST' && caminho === '/v1/planos/alteracoes') {
      const p = (c.corpo ?? {}) as Record<string, unknown>;
      if (!usuario?.perfis.some((x) => ['Gestor financeiro', 'Administradores'].includes(x))) {
        return r(403, { erro: 'sem_permissao', mensagem: 'Sem permissão', perfil_necessario: 'Gestor financeiro' });
      }
      const alvo = somenteDigitos(String(p.cliente ?? ''));
      const nome = String(p.cliente ?? '').toLowerCase();
      const cli = this.clientes.find((x) => (alvo.length === 14 && x.cnpj === alvo) || x.razao_social.toLowerCase().includes(nome));
      if (!cli) return r(404, { erro: 'cliente_nao_encontrado', mensagem: 'Cliente não encontrado' });
      if (cli.plano === p.plano) return r(409, { erro: 'mesmo_plano', mensagem: `O cliente já está no plano ${cli.plano}` });
      const alteracao = { id: String(this.proximo++), cliente_id: cli.id, cliente_nome: cli.razao_social, plano_anterior: cli.plano, plano: String(p.plano) };
      if (!c.simulacao) cli.plano = String(p.plano);
      return r(201, alteracao);
    }
    if (c.metodo === 'DELETE' && /^\/v1\/planos\/alteracoes\/\d+$/.test(caminho)) return r(204, '');
    return r(404, { erro: 'nao_encontrado', mensagem: `Rota falsa não implementada: ${c.metodo} ${caminho}` });
  }
}

export interface Ambiente {
  /** Contexto da empresa de demonstração (a que os testes usam). */
  ctx: Contexto;
  app: FastifyInstance;
  adaptador: AdaptadorFalso;
  config: Config;
  plataforma: Plataforma;
  /** Com `semear`: o que a semente da demonstração gravou. */
  seed?: ResumoSeed;
}

export interface OpcoesAmbiente {
  llm?: Llm;
  adaptador?: AdaptadorSistema;
  navegador?: Navegador;
  /** Pasta de dados da plataforma (cada empresa fica em empresas/<id>). */
  dirDados?: string;
  /** Cria a demonstração como no primeiro início (semente e contas da equipe com a senha padrão). */
  semear?: boolean;
}

/**
 * App completo com bancos em memória e modelo simulado. A empresa de demonstração usa o
 * adaptador falso; empresas criadas pelo cadastro nos testes usam os adaptadores de verdade.
 * Feche com `app.close()`.
 */
export async function criarAmbiente(opcoes: OpcoesAmbiente = {}): Promise<Ambiente> {
  const config: Config = { ...lerConfig(), llmSimulado: true, dirDados: opcoes.dirDados ?? '/tmp/copiloto-teste-inexistente' };
  const adaptador = (opcoes.adaptador as AdaptadorFalso | undefined) ?? new AdaptadorFalso();
  const plataforma = new Plataforma(config, {
    emMemoria: true,
    llm: (e) => (e.demo && opcoes.llm) || new LlmSimulado(),
    adaptador: (e) => (e.demo ? adaptador : undefined),
    navegador: (e) => (e.demo ? opcoes.navegador : undefined),
  });
  const seed = opcoes.semear ? semearPlataforma(plataforma) : undefined;
  const empresa =
    seed?.empresa ??
    plataforma.criarEmpresa({
      nome: 'Horizonte',
      demo: true,
      sistema: { nome: 'Horizonte', url: config.sistema.urlBase, conector: 'api', acesso: { modo: 'nenhum', urlLogin: '', usuario: '' }, perfis: [] },
    });
  const ctx = plataforma.contexto(empresa.id);
  const app = await criarApp(plataforma);
  app.addHook('onClose', async () => {
    for (const c of plataforma.abertos()) if (c !== ctx) await c.navegador.fechar().catch(() => {});
  });
  return { ctx, app, adaptador, config: ctx.config, plataforma, seed };
}

/**
 * Pessoa na equipe da empresa, com conta na plataforma e sessão aberta nessa empresa. Devolve o
 * cabeçalho de cookie para `app.inject`.
 */
export function entrarComo(
  ctx: Contexto,
  perfil: PerfilEquipe = 'admin',
  nome = 'Rafael Lima',
  email?: string,
): { cookie: string; membroId: string; email: string } {
  const id = novoId('mbr');
  const mail = email ?? `${id.toLowerCase()}@teste.com.br`;
  ctx.banco.inserir('equipe', { id, nome, email: mail, perfil, status: 'ativo', criado_em: agoraIso() });
  const { plataforma } = ctx;
  const conta = plataforma.conta(mail) ?? plataforma.criarConta({ email: mail, nome, senha: 'copiloto123' });
  plataforma.vincular(mail, ctx.empresa.id);
  const { token } = plataforma.criarSessao(conta.id, ctx.empresa.id);
  return { cookie: `${COOKIE_SESSAO}=${token}`, membroId: id, email: mail };
}

// Ajuda para testes do servidor: contexto com banco em memória, modelo simulado e um
// adaptador falso que imita a API do Horizonte (sem rede).
import type { FastifyInstance } from 'fastify';
import type { PerfilEquipe, UsuarioSistema } from '@copiloto/shared';
import { cnpjValido, somenteDigitos } from '@copiloto/shared';
import { criarApp } from '../src/app.ts';
import { COOKIE_SESSAO, criarSessao } from '../src/auth/console.ts';
import { hashSenha } from '../src/auth/senha.ts';
import { lerConfig, type Config } from '../src/config.ts';
import { criarContexto, type Contexto, type OpcoesContexto } from '../src/contexto.ts';
import { agoraIso } from '../src/db/banco.ts';
import { LlmSimulado } from '../src/llm/simulado.ts';
import type { AdaptadorSistema, ChamadaApi, RespostaApi, RotaApi, SessaoNavegador } from '../src/adaptadores/tipos.ts';
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
    return r(404, { erro: 'nao_encontrado', mensagem: `Rota falsa não implementada: ${c.metodo} ${caminho}` });
  }
}

export interface Ambiente {
  ctx: Contexto;
  app: FastifyInstance;
  adaptador: AdaptadorFalso;
  config: Config;
}

/** App completo com banco em memória, modelo simulado e adaptador falso. Feche com `app.close()`. */
export async function criarAmbiente(opcoes: OpcoesContexto = {}): Promise<Ambiente> {
  const config: Config = { ...lerConfig(), llmSimulado: true, dirDados: '/tmp/copiloto-teste-inexistente' };
  const adaptador = (opcoes.adaptador as AdaptadorFalso | undefined) ?? new AdaptadorFalso();
  const ctx = criarContexto(config, {
    arquivoBanco: ':memory:',
    llm: opcoes.llm ?? new LlmSimulado(),
    adaptador,
    navegador: opcoes.navegador,
  });
  const app = await criarApp(ctx);
  return { ctx, app, adaptador, config };
}

/** Cria um membro da equipe com sessão e devolve o cabeçalho de cookie para `app.inject`. */
export function entrarComo(ctx: Contexto, perfil: PerfilEquipe = 'admin', nome = 'Rafael Lima'): { cookie: string; membroId: string } {
  const id = novoId('mbr');
  ctx.banco.inserir('equipe', {
    id,
    nome,
    email: `${id.toLowerCase()}@teste.com.br`,
    perfil,
    status: 'ativo',
    senha_hash: hashSenha('copiloto123'),
    criado_em: agoraIso(),
  });
  const { token } = criarSessao(ctx.banco, id);
  return { cookie: `${COOKIE_SESSAO}=${token}`, membroId: id };
}

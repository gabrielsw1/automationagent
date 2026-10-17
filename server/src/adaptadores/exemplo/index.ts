// Adaptador do sistema de exemplo "Horizonte" (pasta sample-system). Fala com a API REST dele
// usando uma chave de serviço e o cabeçalho X-Usuario-Id: o Horizonte aplica as permissões
// dessa pessoa, então o copiloto nunca tem mais acesso que quem pediu.
//
// Para o seu sistema real, copie esta pasta, troque as chamadas e aponte ADAPTADOR=<pasta>.
import type { UsuarioSistema } from '@copiloto/shared';
import type { Config } from '../../config.ts';
import {
  ErroConexaoSistema,
  type AdaptadorSistema,
  type ChamadaApi,
  type RespostaApi,
  type RotaApi,
  type SessaoNavegador,
} from '../tipos.ts';

interface UsuarioHorizonte {
  id: string;
  nome: string;
  email: string;
  perfis: string[];
}

export class AdaptadorHorizonte implements AdaptadorSistema {
  readonly nome: string;
  readonly urlBase: string;
  private readonly urlApi: string;
  private readonly chave: string;
  private cacheUsuarios: { em: number; lista: UsuarioSistema[] } | null = null;

  constructor(config: Config) {
    this.nome = config.sistema.nome;
    this.urlBase = config.sistema.urlBase.replace(/\/$/, '');
    this.urlApi = config.sistema.urlApi.replace(/\/$/, '');
    this.chave = config.sistema.chaveServico;
  }

  async verificarConexao() {
    try {
      const r = await this.chamar({ metodo: 'GET', caminho: '/v1/saude', usuarioId: 'copiloto', tempoLimiteMs: 4000 });
      return r.status === 200
        ? { ok: true, detalhe: `API conectada · ${this.urlApi}` }
        : { ok: false, detalhe: `A API respondeu com erro ${r.status}.` };
    } catch {
      return { ok: false, detalhe: `Não consegui falar com ${this.urlApi}. O sistema está no ar?` };
    }
  }

  async buscarUsuario(id: string): Promise<UsuarioSistema | null> {
    const r = await this.chamar({ metodo: 'GET', caminho: `/v1/usuarios/${encodeURIComponent(id)}`, usuarioId: id });
    if (r.status === 404) return null;
    if (r.status !== 200) throw new ErroConexaoSistema(`Erro ${r.status} ao buscar o usuário.`);
    return paraUsuario(r.corpo as UsuarioHorizonte);
  }

  async listarUsuarios(): Promise<UsuarioSistema[]> {
    if (this.cacheUsuarios && Date.now() - this.cacheUsuarios.em < 60_000) return this.cacheUsuarios.lista;
    const r = await this.chamar({ metodo: 'GET', caminho: '/v1/usuarios', usuarioId: 'copiloto' });
    if (r.status !== 200) throw new ErroConexaoSistema(`Erro ${r.status} ao listar usuários.`);
    const lista = ((r.corpo as { itens: UsuarioHorizonte[] }).itens ?? []).map(paraUsuario);
    this.cacheUsuarios = { em: Date.now(), lista };
    return lista;
  }

  async listarPerfis(): Promise<string[]> {
    const r = await this.chamar({ metodo: 'GET', caminho: '/v1/perfis', usuarioId: 'copiloto' });
    if (r.status !== 200) throw new ErroConexaoSistema(`Erro ${r.status} ao listar perfis.`);
    return (r.corpo as { itens: string[] }).itens ?? [];
  }

  async descreverApi(): Promise<RotaApi[]> {
    const r = await this.chamar({ metodo: 'GET', caminho: '/v1/rotas', usuarioId: 'copiloto' });
    return r.status === 200 ? ((r.corpo as { itens: RotaApi[] }).itens ?? []) : [];
  }

  async sessaoNavegador(usuarioId: string): Promise<SessaoNavegador> {
    const r = await this.chamar({ metodo: 'POST', caminho: '/v1/sessoes', corpo: { usuario_id: usuarioId }, usuarioId });
    if (r.status !== 201 && r.status !== 200) {
      throw new ErroConexaoSistema(`Não consegui abrir uma sessão no ${this.nome} (erro ${r.status}).`);
    }
    const { cookie } = r.corpo as { cookie: { name: string; value: string } };
    return { cookies: [{ name: cookie.name, value: cookie.value, url: this.urlBase }] };
  }

  async chamar(c: ChamadaApi): Promise<RespostaApi> {
    const inicio = Date.now();
    const cabecalhos: Record<string, string> = {
      authorization: `Bearer ${this.chave}`,
      'x-usuario-id': c.usuarioId,
      accept: 'application/json',
    };
    if (c.corpo !== undefined) cabecalhos['content-type'] = 'application/json';
    if (c.idempotencia) cabecalhos['idempotency-key'] = c.idempotencia;
    if (c.simulacao) cabecalhos['x-simulacao'] = '1';
    let resposta: Response;
    try {
      resposta = await fetch(this.urlApi + c.caminho, {
        method: c.metodo,
        headers: cabecalhos,
        body: c.corpo === undefined ? undefined : JSON.stringify(c.corpo),
        signal: AbortSignal.timeout(c.tempoLimiteMs ?? 15_000),
      });
    } catch (e) {
      throw new ErroConexaoSistema(`Sem resposta de ${this.nome}.`, e);
    }
    const tipo = resposta.headers.get('content-type') ?? '';
    const texto = await resposta.text();
    let corpo: unknown = texto;
    if (tipo.includes('json') && texto) {
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpo = texto;
      }
    }
    const extras: Record<string, string> = {};
    for (const nome of ['content-type', 'location']) {
      const v = resposta.headers.get(nome);
      if (v) extras[nome] = v;
    }
    return { status: resposta.status, corpo, duracaoMs: Date.now() - inicio, cabecalhos: extras };
  }
}

function paraUsuario(u: UsuarioHorizonte): UsuarioSistema {
  return { id: String(u.id), nome: u.nome, email: u.email, perfis: u.perfis ?? [] };
}

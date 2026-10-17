// Conector só pela tela: o padrão das empresas clientes, que não abrem API para o copiloto.
// - Quem usa o widget chega pelo snippet assinado (ID, nome, e-mail e perfis). O copiloto guarda
//   essa pessoa no banco da empresa (tabela usuarios_sistema) e a reconhece nas próximas vezes.
// - Toda tarefa roda por fluxo gravado na tela. Se a empresa configurar uma conta de serviço,
//   o navegador do copiloto entra com ela antes de cada fluxo; a senha fica no cofre.
// - Não há chamadas de API: `chamar` responde 501 com uma explicação, sem tocar no sistema.
import type { UsuarioSistema } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import type { AdaptadorSistema, ChamadaApi, RespostaApi, RotaApi, SessaoNavegador } from './tipos.ts';

export interface OpcoesTela {
  nome: string;
  urlBase: string;
  /** Perfis cadastrados no console (Sistema). Os que chegam pelo snippet entram também. */
  perfis: string[];
  acesso: { modo: 'nenhum' | 'conta'; urlLogin: string; usuario: string };
  /** Lida só na hora de entrar no sistema. */
  senha: () => string | null;
}

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string | null;
  perfis: string;
}

function paraUsuario(l: LinhaUsuario): UsuarioSistema {
  return { id: l.id, nome: l.nome, email: l.email ?? '', perfis: json<string[]>(l.perfis, []) };
}

export class AdaptadorTela implements AdaptadorSistema {
  readonly nome: string;
  readonly urlBase: string;

  constructor(
    private readonly banco: Banco,
    private readonly opcoes: OpcoesTela,
  ) {
    this.nome = opcoes.nome;
    this.urlBase = opcoes.urlBase.replace(/\/+$/, '');
  }

  async verificarConexao() {
    if (!this.urlBase) return { ok: false, detalhe: 'Informe o endereço do sistema em Sistema, no console.' };
    try {
      const r = await fetch(this.urlBase, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      return r.status < 500
        ? { ok: true, detalhe: `Telas no ar · ${this.urlBase}` }
        : { ok: false, detalhe: `O ${this.nome} respondeu com erro ${r.status}.` };
    } catch {
      return { ok: false, detalhe: `Não consegui abrir ${this.urlBase}. O endereço está certo e o sistema está no ar?` };
    }
  }

  async buscarUsuario(id: string): Promise<UsuarioSistema | null> {
    const l = this.banco.um<LinhaUsuario>('SELECT id, nome, email, perfis FROM usuarios_sistema WHERE id = ?', id);
    return l ? paraUsuario(l) : null;
  }

  async listarUsuarios(): Promise<UsuarioSistema[]> {
    return this.banco.todos<LinhaUsuario>('SELECT id, nome, email, perfis FROM usuarios_sistema ORDER BY nome').map(paraUsuario);
  }

  async listarPerfis(): Promise<string[]> {
    const vistos = this.banco.todos<{ perfis: string }>('SELECT perfis FROM usuarios_sistema').flatMap((l) => json<string[]>(l.perfis, []));
    return [...new Set([...this.opcoes.perfis, ...vistos])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async aprenderUsuario(u: UsuarioSistema): Promise<void> {
    this.banco.executar(
      `INSERT INTO usuarios_sistema (id, nome, email, perfis, visto_em) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, email = excluded.email, perfis = excluded.perfis, visto_em = excluded.visto_em`,
      u.id,
      u.nome || u.id,
      u.email || null,
      JSON.stringify(u.perfis),
      agoraIso(),
    );
  }

  async chamar(_c: ChamadaApi): Promise<RespostaApi> {
    return {
      status: 501,
      corpo: {
        erro: 'sem_api',
        mensagem: `O ${this.nome} está ligado ao copiloto só pelas telas. Grave o fluxo desta tarefa em Aprender fluxo.`,
      },
      duracaoMs: 0,
    };
  }

  async descreverApi(): Promise<RotaApi[]> {
    return [];
  }

  async sessaoNavegador(_usuarioId: string): Promise<SessaoNavegador> {
    const { acesso } = this.opcoes;
    if (acesso.modo !== 'conta') return { cookies: [] };
    const senha = this.opcoes.senha();
    if (!acesso.urlLogin || !acesso.usuario || !senha) {
      throw new Error('A conta de serviço está incompleta: falta a página de login, o usuário ou a senha.');
    }
    return { cookies: [], login: { url: new URL(acesso.urlLogin, this.urlBase || undefined).toString(), usuario: acesso.usuario, senha } };
  }
}

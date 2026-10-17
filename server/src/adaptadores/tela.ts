// Conector só pela tela: o padrão das empresas clientes, que não abrem API para o copiloto.
// - Quem usa o widget chega pelo snippet assinado (ID, nome, e-mail e perfis). O copiloto guarda
//   essa pessoa no banco da empresa (tabela usuarios_sistema) e a reconhece nas próximas vezes.
// - Toda tarefa roda por fluxo gravado na tela. O navegador do copiloto entra no sistema de um
//   destes jeitos (modo de acesso):
//   - `sessao`: com a sessão de quem pede. O copiloto faz POST no endereço de sessão do sistema
//     com {usuario, ts} e o cabeçalho X-Copiloto-Assinatura (HMAC-SHA256 de "<usuario>.<ts>" com
//     o segredo do widget). O sistema responde {cookies: [...]} ou {url} (link de entrada única).
//   - `conta`: com uma conta de serviço, antes de cada fluxo; a senha fica no cofre.
//   - `nenhum`: as telas abrem sem login.
// - Não há chamadas de API: `chamar` responde 501 com uma explicação, sem tocar no sistema.
import crypto from 'node:crypto';
import type { ModoAcesso, UsuarioSistema } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import { ErroAcessoSistema, type AdaptadorSistema, type ChamadaApi, type CookieNavegador, type RespostaApi, type RotaApi, type SessaoNavegador } from './tipos.ts';

export interface OpcoesTela {
  nome: string;
  urlBase: string;
  /** Perfis cadastrados no console (Sistema). Os que chegam pelo snippet entram também. */
  perfis: string[];
  acesso: { modo: ModoAcesso; urlSessao: string; urlLogin: string; usuario: string };
  /** Lida só na hora de entrar no sistema. */
  senha: () => string | null;
  /** Segredo do widget: assina o pedido de sessão. */
  segredo: () => string;
}

/** Assinatura do pedido de sessão: HMAC-SHA256 (hex) de "<usuario>.<ts>" com o segredo do widget. */
export function assinarPedidoSessao(usuario: string, ts: number, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(`${usuario}.${ts}`).digest('hex');
}

const TEXTO_COOKIE = /^[^;\r\n]*$/;

/** Confere a resposta do endereço de sessão: cookies (nome e valor) ou um link http(s) de entrada. */
function lerRespostaSessao(corpo: unknown, urlBase: string): Pick<SessaoNavegador, 'cookies' | 'urlEntrada'> | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const { cookies, url } = corpo as { cookies?: unknown; url?: unknown };
  const lista: CookieNavegador[] = [];
  if (Array.isArray(cookies)) {
    for (const c of cookies.slice(0, 20)) {
      const { name, value, domain, path } = (c ?? {}) as Record<string, unknown>;
      if (typeof name !== 'string' || !name || typeof value !== 'string' || !TEXTO_COOKIE.test(name + value)) return null;
      lista.push({
        name,
        value,
        ...(typeof domain === 'string' && domain ? { domain } : { url: urlBase }),
        ...(typeof path === 'string' && path ? { path } : {}),
      });
    }
  }
  let urlEntrada: string | undefined;
  if (typeof url === 'string' && url) {
    try {
      const u = new URL(url, urlBase);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      urlEntrada = u.toString();
    } catch {
      return null;
    }
  }
  if (lista.length === 0 && !urlEntrada) return null;
  return { cookies: lista, urlEntrada };
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

  async sessaoNavegador(usuarioId: string): Promise<SessaoNavegador> {
    const { acesso } = this.opcoes;
    if (acesso.modo === 'sessao') return this.pedirSessao(usuarioId);
    if (acesso.modo !== 'conta') return { cookies: [] };
    const senha = this.opcoes.senha();
    if (!acesso.urlLogin || !acesso.usuario || !senha) {
      throw new ErroAcessoSistema('A conta de serviço está incompleta: falta a página de login, o usuário ou a senha.');
    }
    return { cookies: [], login: { url: new URL(acesso.urlLogin, this.urlBase || undefined).toString(), usuario: acesso.usuario, senha } };
  }

  /** Modo `sessao`: pede ao sistema uma sessão para a pessoa (cookies ou link de entrada única). */
  private async pedirSessao(usuarioId: string): Promise<SessaoNavegador> {
    const { urlSessao } = this.opcoes.acesso;
    if (!urlSessao) throw new ErroAcessoSistema(`Falta o endereço de sessão do ${this.nome}. Configure em Sistema, no console.`);
    if (!usuarioId) throw new ErroAcessoSistema('Para pedir a sessão, o copiloto precisa saber quem pediu.');
    const ts = Date.now();
    let r: Response;
    try {
      r = await fetch(new URL(urlSessao, this.urlBase || undefined), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-copiloto-assinatura': assinarPedidoSessao(usuarioId, ts, this.opcoes.segredo()) },
        body: JSON.stringify({ usuario: usuarioId, ts }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ErroAcessoSistema(`O ${this.nome} não respondeu ao pedido de sessão (${urlSessao}).`);
    }
    if (!r.ok) throw new ErroAcessoSistema(`O ${this.nome} recusou o pedido de sessão (erro ${r.status}).`);
    const lida = lerRespostaSessao(await r.json().catch(() => null), this.urlBase);
    if (!lida) throw new ErroAcessoSistema(`O ${this.nome} respondeu ao pedido de sessão sem cookies nem link de entrada.`);
    return lida;
  }
}

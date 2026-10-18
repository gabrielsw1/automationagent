// Conta da extensão: "Entrar com a conta do Copiloto" sem pedir senha aqui. O caminho (detalhes em
// shared/src/extensao.ts):
// 1. entrar(): gera `estado` e um verificador secreto, guarda os dois no storage.session e abre a
//    página /extensao/conectar do console com `estado` e o desafio (SHA-256 do verificador).
// 2. A página do console, depois de a pessoa escolher a empresa, manda `estado` + código pelo
//    content script. doConsole() só aceita da aba do console configurado e com o `estado` guardado.
// 3. O fundo troca código + verificador pelo token da extensão e guarda no storage.local.
// O token nunca sai do fundo: popup, páginas e console recebem só nome, empresa e perfil.
import {
  FONTE_EXTENSAO,
  type ConexaoExtensao,
  type GravacoesRecentes,
  type MensagemDaExtensao,
  type MensagemDoConsole,
  type SessaoExtensao,
  type TokenExtensao,
} from '@copiloto/shared';
import { ErroCliente, juntarUrl, pedirJson } from '@copiloto/widget/chat/api.ts';
import type { AvisoConta, EstadoConta, Recentes, Resultado, Saude } from '../comum/mensagens.ts';
import { origemDe, servidorConfigurado } from '../comum/servidor.ts';

const CHAVE_CONTA = 'conta';
const CHAVE_ENTRADA = 'entrada';
const CHAVE_CONSOLE = 'console';
/** Quanto tempo a página de entrada do console pode levar (a pessoa pode precisar digitar a senha). */
export const VALIDADE_ENTRADA_MS = 15 * 60_000;
/** O endereço do console (para reconhecer a aba dele) é conferido no servidor no máximo a cada minuto. */
const VALIDADE_CONSOLE_MS = 60_000;

interface ContaGuardada {
  token: string;
  servidor: string;
  sessao: SessaoExtensao;
}

interface EntradaPendente {
  estado: string;
  verificador: string;
  consoleOrigem: string;
  servidor: string;
  criadaEm: number;
}

export const TEXTOS_CONTA = {
  saiu: 'A extensão saiu da sua conta. Entre de novo para gravar.',
  servidorMudou: 'O servidor do copiloto mudou nas opções. Entre de novo com a sua conta.',
  entradaVencida: 'Este pedido de entrada venceu. Clique em Entrar com a conta do Copiloto de novo, no ícone do gravador.',
  outraAba: 'Esta página não é o console do Copiloto configurado na extensão.',
  semConsole: 'O copiloto não informou o endereço do console. Confira o servidor nas opções.',
  semConexao: 'Sem conexão com o copiloto agora. Tente de novo em instantes.',
};

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function aleatorio(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

/** SHA-256 do verificador em base64url (o mesmo cálculo do servidor). */
export async function desafioDe(verificador: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador));
  return base64url(new Uint8Array(h));
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function navegadorAtual(): string {
  return typeof navigator !== 'undefined' && /\bEdg\//.test(navigator.userAgent) ? 'Edge' : 'Chrome';
}

function conexaoDe(s: SessaoExtensao): ConexaoExtensao {
  return { empresa: { id: s.empresa.id, nome: s.empresa.nome }, pessoa: { nome: s.pessoa.nome, email: s.pessoa.email } };
}

/** Origem de quem mandou a mensagem (a aba do content script, só o quadro principal). */
function origemDoRemetente(r: chrome.runtime.MessageSender): string | null {
  if (r.frameId !== undefined && r.frameId !== 0) return null;
  return origemDe(r.origin) ?? origemDe(r.url) ?? origemDe(r.tab?.url);
}

export class Conta {
  constructor(
    /** /api/saude do servidor (o mesmo do fundo de gravações). */
    private readonly saude: (servidor?: string) => Promise<Saude>,
    private readonly versao: string,
  ) {}

  async guardada(): Promise<ContaGuardada | null> {
    try {
      const r = await chrome.storage.local.get(CHAVE_CONTA);
      const c = r[CHAVE_CONTA] as ContaGuardada | undefined;
      return c && typeof c.token === 'string' && c.sessao ? c : null;
    } catch {
      return null;
    }
  }

  private async salvar(c: ContaGuardada | null): Promise<void> {
    if (c) await chrome.storage.local.set({ [CHAVE_CONTA]: c });
    else await chrome.storage.local.remove(CHAVE_CONTA);
  }

  private avisar(): void {
    const aviso: AvisoConta = { tipo: 'contaMudou' };
    chrome.runtime.sendMessage(aviso).catch(() => {});
  }

  private pedir<T>(c: ContaGuardada, caminho: string, init: RequestInit = {}): Promise<T> {
    return pedirJson<T>(juntarUrl(c.servidor, caminho), {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${c.token}` },
    });
  }

  /** Para o popup: a conta e a empresa, conferidas no servidor (sem conexão, o que estava guardado). */
  async estado(): Promise<EstadoConta> {
    const c = await this.guardada();
    if (!c) return { conectada: false };
    if (c.servidor !== (await servidorConfigurado())) {
      await this.sair();
      return { conectada: false, aviso: TEXTOS_CONTA.servidorMudou };
    }
    try {
      const sessao = await this.pedir<SessaoExtensao>(c, '/api/extensao/sessao');
      await this.salvar({ ...c, sessao });
      return { conectada: true, sessao };
    } catch (e) {
      if (e instanceof ErroCliente && e.status === 401) {
        await this.salvar(null);
        return { conectada: false, aviso: e.message || TEXTOS_CONTA.saiu };
      }
      return { conectada: true, sessao: c.sessao, offline: true };
    }
  }

  /** "Entrar com a conta do Copiloto" (e "Trocar", com a empresa): abre a entrada no console. */
  async entrar(empresaId?: string): Promise<Resultado> {
    const servidor = await servidorConfigurado();
    const s = await this.saude(servidor);
    if (!s.ok) return { ok: false, mensagem: s.mensagem, semPermissao: s.semPermissao };
    const consoleOrigem = origemDe(s.urlConsole);
    if (!consoleOrigem) return { ok: false, mensagem: TEXTOS_CONTA.semConsole };
    const entrada: EntradaPendente = { estado: aleatorio(16), verificador: aleatorio(32), consoleOrigem, servidor, criadaEm: Date.now() };
    await chrome.storage.session.set({ [CHAVE_ENTRADA]: entrada, [CHAVE_CONSOLE]: { origem: consoleOrigem, em: Date.now() } });
    const busca = new URLSearchParams({ estado: entrada.estado, desafio: await desafioDe(entrada.verificador) });
    if (empresaId) busca.set('empresa', empresaId);
    await chrome.tabs.create({ url: `${s.urlConsole.replace(/\/+$/, '')}/extensao/conectar?${busca}` });
    return { ok: true };
  }

  /** "Sair": o token deixa de valer no servidor e some daqui. */
  async sair(): Promise<Resultado> {
    const c = await this.guardada();
    await this.salvar(null);
    if (c) await this.revogar(c);
    this.avisar();
    return { ok: true };
  }

  private async revogar(c: ContaGuardada): Promise<void> {
    await this.pedir(c, '/api/extensao/sair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  }

  /** "Gravações recentes" da pessoa na empresa da conta. */
  async recentes(): Promise<Recentes> {
    const c = await this.guardada();
    if (!c) return { ok: false, mensagem: TEXTOS_CONTA.saiu };
    try {
      const r = await this.pedir<GravacoesRecentes>(c, '/api/extensao/gravacoes');
      return { ok: true, gravacoes: r.gravacoes };
    } catch (e) {
      if (e instanceof ErroCliente && e.status === 401) {
        await this.salvar(null);
        this.avisar();
      }
      return { ok: false, mensagem: e instanceof Error && e.message ? e.message : TEXTOS_CONTA.semConexao };
    }
  }

  /** Origem do console configurado (guardada por um minuto; senão, pergunta ao servidor). */
  private async origemDoConsole(c: ContaGuardada | null): Promise<string | null> {
    if (c) return origemDe(c.sessao.urlConsole);
    const r = await chrome.storage.session.get(CHAVE_CONSOLE).catch(() => ({}) as Record<string, unknown>);
    const guardado = r[CHAVE_CONSOLE] as { origem: string; em: number } | undefined;
    if (guardado && Date.now() - guardado.em < VALIDADE_CONSOLE_MS) return guardado.origem;
    const s = await this.saude();
    const origem = s.ok ? origemDe(s.urlConsole) : null;
    if (origem) await chrome.storage.session.set({ [CHAVE_CONSOLE]: { origem, em: Date.now() } }).catch(() => {});
    return origem;
  }

  /**
   * Mensagem da página do console (pelo content script). Qualquer página pode perguntar se a
   * extensão está instalada (a versão já está no <html>); a conta e a entrada só valem na aba do
   * console configurado na extensão.
   */
  async doConsole(m: MensagemDoConsole, remetente: chrome.runtime.MessageSender): Promise<MensagemDaExtensao> {
    const origemAba = origemDoRemetente(remetente);
    if (m.tipo === 'extensao:estado') {
      const c = await this.guardada();
      const consoleOrigem = origemAba ? await this.origemDoConsole(c) : null;
      const ehConsole = !!origemAba && origemAba === consoleOrigem;
      return {
        fonte: FONTE_EXTENSAO,
        tipo: 'extensao:estado',
        id: m.id,
        versao: this.versao,
        consoleConfigurado: ehConsole,
        conexao: ehConsole && c ? conexaoDe(c.sessao) : null,
      };
    }

    const falha = (mensagem: string): MensagemDaExtensao => ({ fonte: FONTE_EXTENSAO, tipo: 'extensao:conectada', id: m.id, ok: false, mensagem });
    const r = await chrome.storage.session.get(CHAVE_ENTRADA);
    const pendente = r[CHAVE_ENTRADA] as EntradaPendente | undefined;
    if (!pendente || Date.now() - pendente.criadaEm > VALIDADE_ENTRADA_MS) return falha(TEXTOS_CONTA.entradaVencida);
    // Outra aba (ou outro site) não gasta a entrada pendente: só é recusada.
    if (!origemAba || origemAba !== pendente.consoleOrigem) return falha(TEXTOS_CONTA.outraAba);
    if (!iguais(m.estado, pendente.estado)) return falha(TEXTOS_CONTA.entradaVencida);
    await chrome.storage.session.remove(CHAVE_ENTRADA);
    try {
      const t = await pedirJson<TokenExtensao>(juntarUrl(pendente.servidor, '/api/extensao/trocar'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codigo: m.codigo, verificador: pendente.verificador, navegador: navegadorAtual() }),
      });
      const anterior = await this.guardada();
      await this.salvar({ token: t.token, servidor: pendente.servidor, sessao: t.sessao });
      // Trocou de empresa (ou de conta): o token anterior deixa de valer.
      if (anterior && anterior.token !== t.token) void this.revogar(anterior);
      this.avisar();
      return { fonte: FONTE_EXTENSAO, tipo: 'extensao:conectada', id: m.id, ok: true, conexao: conexaoDe(t.sessao) };
    } catch (e) {
      return falha(e instanceof Error && e.message ? e.message : TEXTOS_CONTA.semConexao);
    }
  }
}

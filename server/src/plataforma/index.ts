// Plataforma SaaS: várias empresas clientes no mesmo servidor, cada uma no próprio espaço.
//
// - Cada empresa tem um banco SQLite só dela (DATA_DIR/empresas/<id>/copiloto.db) e uma pasta
//   para prints, arquivos e anexos. O contexto dela (`Contexto`) é montado na primeira vez que
//   alguém precisa e reaproveitado depois. Nada de uma empresa passa pelo contexto de outra.
// - O banco da plataforma (DATA_DIR/plataforma.db) guarda só o que precisa ser achado antes de
//   saber a empresa: a lista de empresas, a chave pública do widget, as contas do console, as
//   sessões e o índice e-mail → empresas.
// - Tokens que chegam sem sessão (gravação de fluxo, convite) começam com o ID da empresa
//   (`<empresa>.<aleatório>`), e o token do widget leva a empresa assinada.
import fs from 'node:fs';
import path from 'node:path';
import type { ConectorSistema, FaixaUsuarios, ModoAcesso } from '@copiloto/shared';
import type { AdaptadorSistema } from '../adaptadores/tipos.ts';
import { hashSenha, verificarSenha } from '../auth/senha.ts';
import type { Config } from '../config.ts';
import { criarContexto, trocarSistema, type Contexto } from '../contexto.ts';
import { Banco, agoraIso, json } from '../db/banco.ts';
import type { Llm } from '../llm/tipos.ts';
import type { Navegador } from '../navegador/tipos.ts';
import { novoId, tokenAleatorio } from '../util/ids.ts';
import { Cofre } from './cofre.ts';
import { MIGRACOES_PLATAFORMA } from './esquema.ts';

/** Como o copiloto fala com o sistema da empresa (a senha da conta de serviço fica no cofre). */
export interface SistemaGuardado {
  nome: string;
  url: string;
  conector: ConectorSistema;
  acesso: { modo: ModoAcesso; urlSessao: string; urlLogin: string; usuario: string };
  perfis: string[];
}

/** Sistema de uma empresa recém-criada: só pela tela, sem endereço ainda (etapa 2 do cadastro). */
export function sistemaNovo(nome: string, url = ''): SistemaGuardado {
  return { nome, url, conector: 'tela', acesso: { modo: 'nenhum', urlSessao: '', urlLogin: '', usuario: '' }, perfis: [] };
}

export interface Empresa {
  id: string;
  slug: string;
  nome: string;
  status: 'ativa' | 'suspensa';
  demo: boolean;
  sistema: SistemaGuardado;
  chavePublica: string;
  dominios: string[];
  cnpj: string | null;
  faixaUsuarios: FaixaUsuarios | null;
  criadoPor: string | null;
  criadoEm: string;
}

export interface Conta {
  id: string;
  email: string;
  nome: string | null;
  ultimaEmpresaId: string | null;
}

export interface SessaoPlataforma {
  token: string;
  conta: Conta;
  empresaId: string;
}

interface CredenciaisGuardadas {
  senhaAcesso?: string;
}

export interface OpcoesPlataforma {
  /** Bancos em memória (testes). */
  emMemoria?: boolean;
  /** Trocas por empresa (testes): modelo simulado com regras, adaptador falso, navegador falso. */
  llm?: (empresa: Empresa) => Llm | undefined;
  adaptador?: (empresa: Empresa) => AdaptadorSistema | undefined;
  navegador?: (empresa: Empresa) => Navegador | undefined;
}

const DIAS_SESSAO = 7;

interface LinhaEmpresa {
  id: string;
  slug: string;
  nome: string;
  status: Empresa['status'];
  demo: number;
  sistema: string;
  chave_publica: string;
  segredo_widget: string;
  credenciais: string | null;
  dominios: string;
  cnpj: string | null;
  faixa_usuarios: FaixaUsuarios | null;
  criado_por: string | null;
  criado_em: string;
}

function lerSistema(l: LinhaEmpresa): SistemaGuardado {
  const padrao = sistemaNovo(l.nome);
  const lido = json<Partial<SistemaGuardado>>(l.sistema, {});
  return { ...padrao, ...lido, acesso: { ...padrao.acesso, ...lido.acesso } };
}

function deLinha(l: LinhaEmpresa): Empresa {
  return {
    id: l.id,
    slug: l.slug,
    nome: l.nome,
    status: l.status,
    demo: l.demo === 1,
    sistema: lerSistema(l),
    chavePublica: l.chave_publica,
    dominios: json<string[]>(l.dominios, []),
    cnpj: l.cnpj,
    faixaUsuarios: l.faixa_usuarios,
    criadoPor: l.criado_por,
    criadoEm: l.criado_em,
  };
}

/** Token que leva a empresa na frente, para achar o banco certo sem sessão. */
export function tokenDaEmpresa(empresaId: string, bytes = 24): string {
  return `${empresaId}.${tokenAleatorio(bytes)}`;
}

/** Empresa de um token de `tokenDaEmpresa`, ou null. Quem confere o token é o banco da empresa. */
export function empresaDoToken(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.indexOf('.');
  return i > 0 ? token.slice(0, i) : null;
}

/** "Padaria Estrela Ltda." → "padaria-estrela-ltda". */
export function slugDe(nome: string): string {
  const s = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'empresa';
}

export function hostDe(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export class Plataforma {
  readonly banco: Banco;
  readonly cofre: Cofre;
  private readonly contextos = new Map<string, Contexto>();
  private cacheDominios: Set<string> | null = null;

  constructor(
    readonly config: Config,
    private readonly opcoes: OpcoesPlataforma = {},
  ) {
    this.banco = new Banco(opcoes.emMemoria ? ':memory:' : path.join(config.dirDados, 'plataforma.db'), MIGRACOES_PLATAFORMA);
    this.cofre = new Cofre(config.chaveMestra);
  }

  // ---------------------------------------------------------------- empresas

  listarEmpresas(): Empresa[] {
    return this.banco.todos<LinhaEmpresa>('SELECT * FROM empresas ORDER BY demo DESC, nome').map(deLinha);
  }

  empresa(id: string): Empresa | undefined {
    const l = this.banco.um<LinhaEmpresa>('SELECT * FROM empresas WHERE id = ?', id);
    return l ? deLinha(l) : undefined;
  }

  empresaPorChave(chavePublica: string): Empresa | undefined {
    const l = this.banco.um<LinhaEmpresa>('SELECT * FROM empresas WHERE chave_publica = ?', chavePublica);
    return l ? deLinha(l) : undefined;
  }

  criarEmpresa(d: {
    nome: string;
    sistema: SistemaGuardado;
    demo?: boolean;
    chavePublica?: string;
    segredoWidget?: string;
    criadoPor?: string;
    cnpj?: string;
    faixaUsuarios?: FaixaUsuarios;
    termosAceitos?: boolean;
  }): Empresa {
    const id = novoId('emp');
    const host = hostDe(d.sistema.url);
    this.banco.inserir('empresas', {
      id,
      slug: this.slugLivre(slugDe(d.nome)),
      nome: d.nome.trim(),
      status: 'ativa',
      demo: d.demo ? 1 : 0,
      sistema: d.sistema,
      chave_publica: d.chavePublica ?? `pk_${tokenAleatorio(18)}`,
      segredo_widget: this.cofre.cifrar(d.segredoWidget ?? `sw_${tokenAleatorio(32)}`),
      credenciais: null,
      dominios: host ? [host] : [],
      cnpj: d.cnpj ?? null,
      faixa_usuarios: d.faixaUsuarios ?? null,
      termos_aceitos_em: d.termosAceitos ? agoraIso() : null,
      criado_por: d.criadoPor ?? null,
      criado_em: agoraIso(),
    });
    this.cacheDominios = null;
    return this.empresa(id)!;
  }

  private slugLivre(base: string): string {
    let slug = base;
    for (let n = 2; this.banco.um('SELECT 1 FROM empresas WHERE slug = ?', slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  /** Segredo que assina o usuário no snippet. A demonstração usa o WIDGET_SEGREDO, como o Horizonte. */
  segredoWidget(empresa: Empresa): string {
    if (empresa.demo) return this.config.segredoWidget;
    const l = this.banco.um<{ segredo_widget: string }>('SELECT segredo_widget FROM empresas WHERE id = ?', empresa.id)!;
    return this.cofre.decifrar(l.segredo_widget);
  }

  /** Gera um segredo novo: o snippet antigo para de abrir até o sistema usar o novo. */
  novoSegredoWidget(empresaId: string): string {
    const segredo = `sw_${tokenAleatorio(32)}`;
    this.banco.executar('UPDATE empresas SET segredo_widget = ? WHERE id = ?', this.cofre.cifrar(segredo), empresaId);
    const ctx = this.contextos.get(empresaId);
    if (ctx) ctx.config.segredoWidget = segredo;
    return segredo;
  }

  /** Senha da conta de serviço que o navegador do copiloto usa para entrar no sistema. */
  senhaAcesso(empresaId: string): string | null {
    const l = this.banco.um<{ credenciais: string | null }>('SELECT credenciais FROM empresas WHERE id = ?', empresaId);
    if (!l?.credenciais) return null;
    return json<CredenciaisGuardadas>(this.cofre.decifrar(l.credenciais), {}).senhaAcesso ?? null;
  }

  /**
   * Muda como o copiloto fala com o sistema da empresa. `senhaAcesso`: undefined mantém a
   * guardada, null apaga. O contexto aberto passa a usar o novo endereço na hora.
   */
  atualizarSistema(empresaId: string, sistema: SistemaGuardado, senhaAcesso?: string | null) {
    const atual = this.empresa(empresaId);
    if (!atual) throw new Error(`Empresa ${empresaId} não existe.`);
    const dados: Record<string, unknown> = { sistema };
    if (senhaAcesso !== undefined) {
      dados.credenciais = senhaAcesso === null ? null : this.cofre.cifrar(JSON.stringify({ senhaAcesso } satisfies CredenciaisGuardadas));
    }
    this.banco.atualizar('empresas', empresaId, dados);
    const ctx = this.contextos.get(empresaId);
    if (ctx) trocarSistema(ctx, this.empresa(empresaId)!, this);
  }

  /** Suspende ou reativa a empresa. Suspensa, ninguém entra no console nem no widget dela. */
  mudarStatus(empresaId: string, status: Empresa['status']) {
    this.banco.executar('UPDATE empresas SET status = ? WHERE id = ?', status, empresaId);
    if (status === 'suspensa') this.banco.executar('DELETE FROM sessoes WHERE empresa_id = ?', empresaId);
    this.cacheDominios = null;
  }

  /** Pode ver o painel da plataforma (COPILOTO_ADMINS). */
  adminDaPlataforma(email: string): boolean {
    return this.config.adminsPlataforma.includes(email.trim().toLowerCase());
  }

  /** Guarda os domínios do widget publicado (o CORS consulta antes de saber a empresa). */
  atualizarDominios(empresaId: string, dominios: string[]) {
    this.banco.executar('UPDATE empresas SET dominios = ? WHERE id = ?', JSON.stringify(dominios), empresaId);
    this.cacheDominios = null;
  }

  /** Algum widget publicado libera este domínio? (`host` com porta, `hostname` sem.) */
  dominioLiberado(host: string, hostname: string): boolean {
    if (!this.cacheDominios) {
      this.cacheDominios = new Set(
        this.banco.todos<{ dominios: string }>("SELECT dominios FROM empresas WHERE status = 'ativa'").flatMap((l) => json<string[]>(l.dominios, [])),
      );
    }
    return this.cacheDominios.has(host) || this.cacheDominios.has(hostname);
  }

  /** Pasta da empresa: banco, prints, arquivos gerados e anexos. */
  pastaDaEmpresa(empresaId: string): string {
    return path.join(this.config.dirDados, 'empresas', path.basename(empresaId));
  }

  /** Contexto da empresa (aberto na primeira vez). Lança erro se a empresa não existe. */
  contexto(empresaId: string): Contexto {
    const pronto = this.contextos.get(empresaId);
    if (pronto) return pronto;
    const empresa = this.empresa(empresaId);
    if (!empresa) throw new Error(`Empresa ${empresaId} não existe.`);
    const pasta = this.pastaDaEmpresa(empresa.id);
    const ctx = criarContexto(this.configDaEmpresa(empresa, pasta), {
      arquivoBanco: this.opcoes.emMemoria ? ':memory:' : path.join(pasta, 'copiloto.db'),
      llm: this.opcoes.llm?.(empresa),
      adaptador: this.opcoes.adaptador?.(empresa),
      navegador: this.opcoes.navegador?.(empresa),
      empresa,
      plataforma: this,
    });
    this.contextos.set(empresa.id, ctx);
    // Os domínios valem pelo widget publicado no banco da empresa (a semente e versões antigas gravam só lá).
    const publicados = ctx.configuracoes.ler('widget_publicado').dominios;
    if (JSON.stringify(publicados) !== JSON.stringify(empresa.dominios)) this.atualizarDominios(empresa.id, publicados);
    return ctx;
  }

  /** Contextos já abertos (para encerrar e para tarefas de fundo). */
  abertos(): Contexto[] {
    return [...this.contextos.values()];
  }

  /** Config do servidor com o que é da empresa: pasta, sistema e segredo do widget. */
  configDaEmpresa(empresa: Empresa, pasta = this.pastaDaEmpresa(empresa.id)): Config {
    const env = this.config.sistema;
    const sistema =
      empresa.sistema.conector === 'api'
        ? { nome: empresa.sistema.nome, urlBase: env.urlBase, urlApi: env.urlApi, chaveServico: env.chaveServico }
        : { nome: empresa.sistema.nome, urlBase: empresa.sistema.url.replace(/\/+$/, ''), urlApi: '', chaveServico: '' };
    return {
      ...this.config,
      dirDados: pasta,
      sistema,
      adaptador: empresa.sistema.conector === 'api' ? this.config.adaptador : 'tela',
      segredoWidget: this.segredoWidget(empresa),
    };
  }

  // ---------------------------------------------------------------- contas e vínculos

  conta(email: string): Conta | undefined {
    const l = this.banco.um<{ id: string; email: string; nome: string | null; ultima_empresa_id: string | null }>(
      'SELECT id, email, nome, ultima_empresa_id FROM contas WHERE email = ?',
      email.trim().toLowerCase(),
    );
    return l ? { id: l.id, email: l.email, nome: l.nome, ultimaEmpresaId: l.ultima_empresa_id } : undefined;
  }

  criarConta(d: { email: string; nome: string | null; senha: string }): Conta {
    const id = novoId('cta');
    this.banco.inserir('contas', {
      id,
      email: d.email.trim().toLowerCase(),
      nome: d.nome,
      senha_hash: hashSenha(d.senha),
      criado_em: agoraIso(),
    });
    return this.conta(d.email)!;
  }

  /** Conta com esta senha, ou null. */
  conferirSenha(email: string, senha: string): Conta | null {
    const l = this.banco.um<{ senha_hash: string }>('SELECT senha_hash FROM contas WHERE email = ?', email.trim().toLowerCase());
    if (!l || !verificarSenha(senha, l.senha_hash)) return null;
    return this.conta(email)!;
  }

  temContas(): boolean {
    return !!this.banco.um('SELECT 1 FROM contas LIMIT 1');
  }

  vincular(email: string, empresaId: string) {
    this.banco.executar(
      'INSERT INTO vinculos (email, empresa_id, criado_em) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      email.trim().toLowerCase(),
      empresaId,
      agoraIso(),
    );
  }

  /** Saiu da equipe: some do "Trocar de empresa" e as sessões abertas nessa empresa acabam. */
  desvincular(email: string, empresaId: string) {
    const e = email.trim().toLowerCase();
    this.banco.executar('DELETE FROM vinculos WHERE email = ? AND empresa_id = ?', e, empresaId);
    this.banco.executar(
      'DELETE FROM sessoes WHERE empresa_id = ? AND conta_id IN (SELECT id FROM contas WHERE email = ?)',
      empresaId,
      e,
    );
  }

  /** Empresas ativas em que o e-mail está na equipe, a demonstração por último. */
  empresasDe(email: string): Empresa[] {
    return this.banco
      .todos<LinhaEmpresa>(
        `SELECT e.* FROM vinculos v JOIN empresas e ON e.id = v.empresa_id
         WHERE v.email = ? AND e.status = 'ativa' ORDER BY e.demo, e.nome`,
        email.trim().toLowerCase(),
      )
      .map(deLinha);
  }

  // ---------------------------------------------------------------- sessões do console

  criarSessao(contaId: string, empresaId: string): { token: string; expira: Date } {
    const token = tokenAleatorio(32);
    const expira = new Date(Date.now() + DIAS_SESSAO * 86400_000);
    this.banco.inserir('sessoes', { token, conta_id: contaId, empresa_id: empresaId, criado_em: agoraIso(), expira_em: expira.toISOString() });
    this.banco.executar('UPDATE contas SET ultima_empresa_id = ?, ultimo_acesso = ? WHERE id = ?', empresaId, agoraIso(), contaId);
    return { token, expira };
  }

  lerSessao(token: string | undefined): SessaoPlataforma | undefined {
    if (!token) return undefined;
    const l = this.banco.um<{ conta_id: string; empresa_id: string; expira_em: string; email: string; nome: string | null; ultima_empresa_id: string | null }>(
      `SELECT s.conta_id, s.empresa_id, s.expira_em, c.email, c.nome, c.ultima_empresa_id
       FROM sessoes s JOIN contas c ON c.id = s.conta_id WHERE s.token = ?`,
      token,
    );
    if (!l || l.expira_em < agoraIso()) return undefined;
    return {
      token,
      conta: { id: l.conta_id, email: l.email, nome: l.nome, ultimaEmpresaId: l.ultima_empresa_id },
      empresaId: l.empresa_id,
    };
  }

  trocarEmpresa(token: string, contaId: string, empresaId: string) {
    this.banco.executar('UPDATE sessoes SET empresa_id = ? WHERE token = ?', empresaId, token);
    this.banco.executar('UPDATE contas SET ultima_empresa_id = ? WHERE id = ?', empresaId, contaId);
  }

  encerrarSessao(token: string | undefined) {
    if (token) this.banco.executar('DELETE FROM sessoes WHERE token = ?', token);
  }

  // ---------------------------------------------------------------- encerrar

  async fechar() {
    const lista = this.abertos();
    this.contextos.clear();
    for (const ctx of lista) {
      ctx.motor.parar();
      await ctx.navegador.fechar().catch(() => {});
      ctx.banco.fechar();
    }
    this.banco.fechar();
  }

  /** Apaga a pasta de dados inteira (seed do zero). Só com a plataforma fechada. */
  static apagarDados(dirDados: string) {
    // `copiloto.db`, `arquivos`, `anexos` e `prints` na raiz são da versão de uma empresa só.
    for (const banco of ['plataforma.db', 'copiloto.db']) {
      for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(path.join(dirDados, banco + sufixo), { force: true });
    }
    for (const pasta of ['empresas', 'arquivos', 'anexos', 'prints']) fs.rmSync(path.join(dirDados, pasta), { recursive: true, force: true });
  }
}

// Equipe da Starta: quem cuida das empresas clientes na Plataforma. Contas separadas das contas
// das empresas, com senha e verificação em duas etapas por aplicativo autenticador (TOTP), códigos
// de recuperação, "confiar neste aparelho por 30 dias" e o modo suporte (entrar no console de uma
// empresa com motivo, registro na auditoria dela e aviso aos Admins).
//
// Ninguém cria a própria conta: a primeira pessoa vem de COPILOTO_ADMINS (link de ativação no log
// e por e-mail) e as outras são convidadas por um Admin da plataforma, que também redefine o
// acesso de quem esqueceu a senha ou perdeu o aparelho.
import crypto from 'node:crypto';
import { hashSenha, verificarSenha } from '../auth/senha.ts';
import { conferirTotp, novoSegredoTotp, novosCodigosRecuperacao } from '../auth/totp.ts';
import { agoraIso, type Banco } from '../db/banco.ts';
import { novoId, tokenAleatorio } from '../util/ids.ts';
import type { Cofre } from './cofre.ts';

export const TENTATIVAS_ENTRADA_STARTA = 5;
export const MINUTOS_BLOQUEIO_STARTA = 15;
export const TENTATIVAS_CODIGO_STARTA = 5;
export const MINUTOS_ETAPA_CODIGO = 10;
export const HORAS_SESSAO_STARTA = 12;
export const DIAS_APARELHO_CONFIAVEL = 30;
export const DIAS_ATIVACAO_STARTA = 7;
export const MINUTOS_SUPORTE = 60;
export const CODIGOS_RECUPERACAO = 10;

export interface PessoaStarta {
  id: string;
  nome: string;
  email: string;
  ativa: boolean;
  /** Já criou senha e ligou o autenticador. */
  ativada: boolean;
  criadoEm: string;
  criadoPor: string | null;
  ultimoAcesso: string | null;
}

export interface SessaoStarta {
  pessoa: PessoaStarta;
  etapa: 'codigo' | 'completa';
  tentativasRestantes: number;
}

export interface AcessoSuporte {
  id: string;
  pessoaId: string;
  pessoaNome: string;
  empresaId: string;
  motivo: string;
  inicio: string;
  expiraEm: string;
  encerradoEm: string | null;
}

interface LinhaPessoa {
  id: string;
  nome: string;
  email: string;
  senha_hash: string | null;
  totp_segredo: string | null;
  totp_ultimo_passo: number | null;
  ativa: number;
  falhas_entrada: number;
  bloqueada_ate: string | null;
  criado_por: string | null;
  criado_em: string;
  ativado_em: string | null;
  ultimo_acesso: string | null;
}

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const depois = (ms: number) => new Date(Date.now() + ms).toISOString();
const normalizarCodigo = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

function deLinha(l: LinhaPessoa): PessoaStarta {
  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    ativa: l.ativa === 1,
    ativada: !!l.senha_hash && !!l.totp_segredo,
    criadoEm: l.criado_em,
    criadoPor: l.criado_por,
    ultimoAcesso: l.ultimo_acesso,
  };
}

export class EquipeStarta {
  constructor(
    private readonly banco: Banco,
    private readonly cofre: Cofre,
  ) {}

  // ---------------------------------------------------------------- pessoas

  listar(): PessoaStarta[] {
    return this.banco.todos<LinhaPessoa>('SELECT * FROM pessoas_starta ORDER BY nome').map(deLinha);
  }

  pessoa(id: string): PessoaStarta | undefined {
    const l = this.banco.um<LinhaPessoa>('SELECT * FROM pessoas_starta WHERE id = ?', id);
    return l ? deLinha(l) : undefined;
  }

  porEmail(email: string): PessoaStarta | undefined {
    const l = this.banco.um<LinhaPessoa>('SELECT * FROM pessoas_starta WHERE email = ?', email.trim().toLowerCase());
    return l ? deLinha(l) : undefined;
  }

  /** Pessoa nova, ainda sem senha: só entra depois de ativar pelo link. */
  criar(d: { nome: string; email: string; criadoPor?: string }): PessoaStarta {
    const id = novoId('stt');
    this.banco.inserir('pessoas_starta', {
      id,
      nome: d.nome.trim(),
      email: d.email.trim().toLowerCase(),
      ativa: 1,
      criado_por: d.criadoPor ?? null,
      criado_em: agoraIso(),
    });
    return this.pessoa(id)!;
  }

  desativar(id: string) {
    this.banco.executar('UPDATE pessoas_starta SET ativa = 0 WHERE id = ?', id);
    this.encerrarTudo(id);
  }

  reativar(id: string) {
    this.banco.executar('UPDATE pessoas_starta SET ativa = 1 WHERE id = ?', id);
  }

  /** Sessões, aparelhos confiáveis e acessos de suporte em aberto deixam de valer. */
  private encerrarTudo(id: string) {
    this.banco.executar('DELETE FROM sessoes_starta WHERE pessoa_id = ?', id);
    this.banco.executar('DELETE FROM aparelhos_starta WHERE pessoa_id = ?', id);
    this.banco.executar('UPDATE acessos_suporte SET encerrado_em = ? WHERE pessoa_id = ? AND encerrado_em IS NULL', agoraIso(), id);
  }

  // ---------------------------------------------------------------- ativação

  /** Link de ativação (convite ou "Redefinir acesso"). Os links anteriores da pessoa deixam de valer. */
  novaAtivacao(pessoaId: string): { token: string; expiraEm: string } {
    const token = tokenAleatorio(32);
    const expiraEm = depois(DIAS_ATIVACAO_STARTA * 86_400_000);
    this.banco.transacao(() => {
      this.banco.executar('UPDATE ativacoes_starta SET usado_em = ? WHERE pessoa_id = ? AND usado_em IS NULL', agoraIso(), pessoaId);
      this.banco.inserir('ativacoes_starta', {
        token_hash: hash(token),
        pessoa_id: pessoaId,
        segredo_pendente: this.cofre.cifrar(novoSegredoTotp()),
        expira_em: expiraEm,
        usado_em: null,
        criado_em: agoraIso(),
      });
    });
    return { token, expiraEm };
  }

  /** Link de ativação válido: a pessoa e o segredo que o QR code mostra. */
  ativacao(token: string): { pessoa: PessoaStarta; segredo: string; expiraEm: string } | undefined {
    const l = this.banco.um<{ pessoa_id: string; segredo_pendente: string; expira_em: string; usado_em: string | null }>(
      'SELECT pessoa_id, segredo_pendente, expira_em, usado_em FROM ativacoes_starta WHERE token_hash = ?',
      hash(token),
    );
    if (!l || l.usado_em || l.expira_em < agoraIso()) return undefined;
    const pessoa = this.pessoa(l.pessoa_id);
    if (!pessoa?.ativa) return undefined;
    return { pessoa, segredo: this.cofre.decifrar(l.segredo_pendente), expiraEm: l.expira_em };
  }

  /**
   * Conclui a ativação: confere um código do aplicativo (prova que o QR code foi lido), grava a
   * senha e o segredo e devolve os códigos de recuperação (mostrados uma vez só).
   */
  ativar(token: string, senha: string, codigo: string): { ok: true; pessoa: PessoaStarta; codigos: string[] } | { ok: false; motivo: 'link' | 'codigo' } {
    const a = this.ativacao(token);
    if (!a) return { ok: false, motivo: 'link' };
    const passo = conferirTotp(a.segredo, codigo);
    if (passo === null) return { ok: false, motivo: 'codigo' };
    const codigos = this.banco.transacao(() => {
      this.banco.executar(
        `UPDATE pessoas_starta SET senha_hash = ?, totp_segredo = ?, totp_ultimo_passo = ?, ativado_em = ?,
           falhas_entrada = 0, bloqueada_ate = NULL WHERE id = ?`,
        hashSenha(senha),
        this.cofre.cifrar(a.segredo),
        passo,
        agoraIso(),
        a.pessoa.id,
      );
      this.banco.executar('UPDATE ativacoes_starta SET usado_em = ? WHERE token_hash = ?', agoraIso(), hash(token));
      this.encerrarTudo(a.pessoa.id);
      return this.gravarCodigos(a.pessoa.id);
    });
    return { ok: true, pessoa: this.pessoa(a.pessoa.id)!, codigos };
  }

  /** "Peça a outro Admin da plataforma para redefinir o seu acesso": apaga senha e autenticador e manda link novo. */
  redefinir(pessoaId: string): { token: string; expiraEm: string } {
    this.banco.executar('UPDATE pessoas_starta SET senha_hash = NULL, totp_segredo = NULL, totp_ultimo_passo = NULL WHERE id = ?', pessoaId);
    this.banco.executar('DELETE FROM recuperacao_starta WHERE pessoa_id = ?', pessoaId);
    this.encerrarTudo(pessoaId);
    return this.novaAtivacao(pessoaId);
  }

  // ---------------------------------------------------------------- entrar (A7)

  /** Etapa 1: e-mail e senha, com o mesmo bloqueio do console (5 erros seguidos, 15 minutos). */
  conferirSenha(email: string, senha: string): { pessoa: PessoaStarta } | { pessoa: null; bloqueadaAte: string | null } {
    const l = this.banco.um<LinhaPessoa>('SELECT * FROM pessoas_starta WHERE email = ?', email.trim().toLowerCase());
    if (!l || l.ativa !== 1 || !l.senha_hash || !l.totp_segredo) {
      // Sem conta (ou ainda não ativada): mesmo custo de uma senha errada.
      verificarSenha(senha, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      return { pessoa: null, bloqueadaAte: null };
    }
    if (l.bloqueada_ate && l.bloqueada_ate > agoraIso()) return { pessoa: null, bloqueadaAte: l.bloqueada_ate };
    if (verificarSenha(senha, l.senha_hash)) {
      this.banco.executar('UPDATE pessoas_starta SET falhas_entrada = 0, bloqueada_ate = NULL WHERE id = ?', l.id);
      return { pessoa: deLinha(l) };
    }
    const falhas = (l.bloqueada_ate ? 0 : l.falhas_entrada) + 1;
    const bloqueadaAte = falhas >= TENTATIVAS_ENTRADA_STARTA ? depois(MINUTOS_BLOQUEIO_STARTA * 60_000) : null;
    this.banco.executar('UPDATE pessoas_starta SET falhas_entrada = ?, bloqueada_ate = ? WHERE id = ?', bloqueadaAte ? 0 : falhas, bloqueadaAte, l.id);
    return { pessoa: null, bloqueadaAte };
  }

  /** Sessão nova: na etapa do código, ou já completa (aparelho confiável). */
  criarSessao(pessoaId: string, etapa: SessaoStarta['etapa']): { token: string; expira: Date } {
    const token = tokenAleatorio(32);
    const expira = new Date(Date.now() + (etapa === 'codigo' ? MINUTOS_ETAPA_CODIGO * 60_000 : HORAS_SESSAO_STARTA * 3_600_000));
    this.banco.inserir('sessoes_starta', {
      token_hash: hash(token),
      pessoa_id: pessoaId,
      etapa,
      tentativas_restantes: TENTATIVAS_CODIGO_STARTA,
      criado_em: agoraIso(),
      expira_em: expira.toISOString(),
    });
    if (etapa === 'completa') this.marcarAcesso(pessoaId);
    return { token, expira };
  }

  lerSessao(token: string | undefined): SessaoStarta | undefined {
    if (!token) return undefined;
    const l = this.banco.um<{ pessoa_id: string; etapa: SessaoStarta['etapa']; tentativas_restantes: number; expira_em: string }>(
      'SELECT pessoa_id, etapa, tentativas_restantes, expira_em FROM sessoes_starta WHERE token_hash = ?',
      hash(token),
    );
    if (!l || l.expira_em < agoraIso()) return undefined;
    const pessoa = this.pessoa(l.pessoa_id);
    if (!pessoa?.ativa || !pessoa.ativada) return undefined;
    return { pessoa, etapa: l.etapa, tentativasRestantes: l.tentativas_restantes };
  }

  encerrarSessao(token: string | undefined) {
    if (token) this.banco.executar('DELETE FROM sessoes_starta WHERE token_hash = ?', hash(token));
  }

  /**
   * Etapa 2: código do aplicativo ou de recuperação. Certo, a sessão fica completa; errado, gasta
   * uma das 5 tentativas da sessão, e sem tentativas a pessoa recomeça pela senha.
   */
  conferirSegundaEtapa(
    token: string,
    codigo: string,
    tipo: 'aplicativo' | 'recuperacao',
  ): { ok: true; recuperacaoRestantes: number } | { ok: false; restantes: number } {
    const sessao = this.lerSessao(token);
    if (!sessao || sessao.etapa !== 'codigo') return { ok: false, restantes: 0 };
    const pessoaId = sessao.pessoa.id;
    const certo = tipo === 'aplicativo' ? this.conferirAplicativo(pessoaId, codigo) : this.usarRecuperacao(pessoaId, codigo);
    if (certo) {
      this.banco.executar(
        "UPDATE sessoes_starta SET etapa = 'completa', expira_em = ? WHERE token_hash = ?",
        depois(HORAS_SESSAO_STARTA * 3_600_000),
        hash(token),
      );
      this.marcarAcesso(pessoaId);
      return { ok: true, recuperacaoRestantes: this.codigosRestantes(pessoaId) };
    }
    const restantes = sessao.tentativasRestantes - 1;
    if (restantes <= 0) this.encerrarSessao(token);
    else this.banco.executar('UPDATE sessoes_starta SET tentativas_restantes = ? WHERE token_hash = ?', restantes, hash(token));
    return { ok: false, restantes: Math.max(0, restantes) };
  }

  /** Código do autenticador, sem aceitar de novo um código já usado. */
  conferirAplicativo(pessoaId: string, codigo: string): boolean {
    const l = this.banco.um<{ totp_segredo: string | null; totp_ultimo_passo: number | null }>(
      'SELECT totp_segredo, totp_ultimo_passo FROM pessoas_starta WHERE id = ?',
      pessoaId,
    );
    if (!l?.totp_segredo) return false;
    const passo = conferirTotp(this.cofre.decifrar(l.totp_segredo), codigo);
    if (passo === null || (l.totp_ultimo_passo !== null && passo <= l.totp_ultimo_passo)) return false;
    this.banco.executar('UPDATE pessoas_starta SET totp_ultimo_passo = ? WHERE id = ?', passo, pessoaId);
    return true;
  }

  private usarRecuperacao(pessoaId: string, codigo: string): boolean {
    const r = this.banco.executar(
      'UPDATE recuperacao_starta SET usado_em = ? WHERE pessoa_id = ? AND codigo_hash = ? AND usado_em IS NULL',
      agoraIso(),
      pessoaId,
      hash(normalizarCodigo(codigo)),
    );
    return Number(r.changes) > 0;
  }

  codigosRestantes(pessoaId: string): number {
    return this.banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM recuperacao_starta WHERE pessoa_id = ? AND usado_em IS NULL', pessoaId)?.n ?? 0;
  }

  /** Códigos de recuperação novos; os anteriores deixam de valer. */
  novosCodigos(pessoaId: string): string[] {
    return this.banco.transacao(() => this.gravarCodigos(pessoaId));
  }

  private gravarCodigos(pessoaId: string): string[] {
    this.banco.executar('DELETE FROM recuperacao_starta WHERE pessoa_id = ?', pessoaId);
    const codigos = novosCodigosRecuperacao(CODIGOS_RECUPERACAO);
    for (const c of codigos) this.banco.inserir('recuperacao_starta', { pessoa_id: pessoaId, codigo_hash: hash(normalizarCodigo(c)), usado_em: null });
    return codigos;
  }

  // ---------------------------------------------------------------- aparelho confiável

  confiarAparelho(pessoaId: string): { token: string; expira: Date } {
    const token = tokenAleatorio(32);
    const expira = new Date(Date.now() + DIAS_APARELHO_CONFIAVEL * 86_400_000);
    this.banco.inserir('aparelhos_starta', { token_hash: hash(token), pessoa_id: pessoaId, criado_em: agoraIso(), expira_em: expira.toISOString() });
    return { token, expira };
  }

  aparelhoConfiavel(pessoaId: string, token: string | undefined): boolean {
    if (!token) return false;
    const l = this.banco.um<{ expira_em: string }>('SELECT expira_em FROM aparelhos_starta WHERE token_hash = ? AND pessoa_id = ?', hash(token), pessoaId);
    return !!l && l.expira_em >= agoraIso();
  }

  private marcarAcesso(pessoaId: string) {
    this.banco.executar('UPDATE pessoas_starta SET ultimo_acesso = ? WHERE id = ?', agoraIso(), pessoaId);
  }

  // ---------------------------------------------------------------- modo suporte

  /** Abre um acesso de suporte de 60 minutos. O token vai no cookie do console como `sup.<token>`. */
  abrirSuporte(pessoaId: string, empresaId: string, motivo: string): { token: string; acesso: AcessoSuporte } {
    const token = tokenAleatorio(32);
    const id = novoId('sup');
    this.banco.inserir('acessos_suporte', {
      id,
      token_hash: hash(token),
      pessoa_id: pessoaId,
      empresa_id: empresaId,
      motivo: motivo.trim(),
      inicio: agoraIso(),
      expira_em: depois(MINUTOS_SUPORTE * 60_000),
      encerrado_em: null,
    });
    return { token, acesso: this.acessoSuporte(id)! };
  }

  acessoSuporte(id: string): AcessoSuporte | undefined {
    return this.acessosSuporte({ id })[0];
  }

  /** Acesso de suporte em aberto deste token (e da pessoa ainda ativa). */
  lerSuporte(token: string): { acesso: AcessoSuporte; pessoa: PessoaStarta } | undefined {
    const l = this.banco.um<{ id: string; expira_em: string; encerrado_em: string | null }>(
      'SELECT id, expira_em, encerrado_em FROM acessos_suporte WHERE token_hash = ?',
      hash(token),
    );
    if (!l || l.encerrado_em || l.expira_em < agoraIso()) return undefined;
    const acesso = this.acessoSuporte(l.id)!;
    const pessoa = this.pessoa(acesso.pessoaId);
    return pessoa?.ativa ? { acesso, pessoa } : undefined;
  }

  encerrarSuporte(token: string): AcessoSuporte | undefined {
    const l = this.banco.um<{ id: string }>('SELECT id FROM acessos_suporte WHERE token_hash = ? AND encerrado_em IS NULL', hash(token));
    if (!l) return undefined;
    this.banco.executar('UPDATE acessos_suporte SET encerrado_em = ? WHERE id = ?', agoraIso(), l.id);
    return this.acessoSuporte(l.id);
  }

  acessosSuporte(filtro: { id?: string; empresaId?: string; limite?: number } = {}): AcessoSuporte[] {
    const onde: string[] = [];
    const params: string[] = [];
    if (filtro.id) {
      onde.push('a.id = ?');
      params.push(filtro.id);
    }
    if (filtro.empresaId) {
      onde.push('a.empresa_id = ?');
      params.push(filtro.empresaId);
    }
    return this.banco
      .todos<{ id: string; pessoa_id: string; nome: string; empresa_id: string; motivo: string; inicio: string; expira_em: string; encerrado_em: string | null }>(
        `SELECT a.id, a.pessoa_id, p.nome, a.empresa_id, a.motivo, a.inicio, a.expira_em, a.encerrado_em
           FROM acessos_suporte a JOIN pessoas_starta p ON p.id = a.pessoa_id
          ${onde.length ? `WHERE ${onde.join(' AND ')}` : ''}
          ORDER BY a.inicio DESC LIMIT ${Math.max(1, Math.min(filtro.limite ?? 200, 1000))}`,
        ...params,
      )
      .map((l) => ({
        id: l.id,
        pessoaId: l.pessoa_id,
        pessoaNome: l.nome,
        empresaId: l.empresa_id,
        motivo: l.motivo,
        inicio: l.inicio,
        expiraEm: l.expira_em,
        encerradoEm: l.encerrado_em,
      }));
  }
}

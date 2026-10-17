// Acesso ao SQLite embutido no Node (node:sqlite). Sem dependência nativa para instalar.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRACOES } from './esquema.ts';

export type Valor = SQLInputValue;
export type Linha = Record<string, unknown>;

export class Banco {
  readonly db: DatabaseSync;

  constructor(arquivo: string) {
    if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    this.db = new DatabaseSync(arquivo);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrar();
  }

  private migrar() {
    this.db.exec('CREATE TABLE IF NOT EXISTS _migracoes (n INTEGER PRIMARY KEY, em TEXT NOT NULL)');
    const feitas = new Set(this.todos<{ n: number }>('SELECT n FROM _migracoes').map((r) => r.n));
    MIGRACOES.forEach((sql, i) => {
      if (feitas.has(i)) return;
      this.transacao(() => {
        this.db.exec(sql);
        this.executar('INSERT INTO _migracoes (n, em) VALUES (?, ?)', i, agoraIso());
      });
    });
  }

  todos<T = Linha>(sql: string, ...params: Valor[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  um<T = Linha>(sql: string, ...params: Valor[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  executar(sql: string, ...params: Valor[]) {
    return this.db.prepare(sql).run(...params);
  }

  /** Insere um objeto: as chaves viram colunas. Objetos e arrays viram JSON. */
  inserir(tabela: string, dados: Record<string, unknown>) {
    const cols = Object.keys(dados);
    const sql = `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    return this.executar(sql, ...cols.map((c) => paraSql(dados[c])));
  }

  /** Atualiza colunas de uma linha pela chave primária `id`. */
  atualizar(tabela: string, id: string, dados: Record<string, unknown>, colunaId = 'id') {
    const cols = Object.keys(dados);
    if (cols.length === 0) return;
    const sql = `UPDATE ${tabela} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${colunaId} = ?`;
    return this.executar(sql, ...cols.map((c) => paraSql(dados[c])), id);
  }

  private profundidade = 0;

  /** Transação síncrona. Chamadas aninhadas usam a transação de fora. */
  transacao<T>(fn: () => T): T {
    if (this.profundidade > 0) {
      this.profundidade++;
      try {
        return fn();
      } finally {
        this.profundidade--;
      }
    }
    this.db.exec('BEGIN');
    this.profundidade = 1;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.profundidade = 0;
    }
  }

  /** Próximo número de uma sequência (ex.: execuções EX-20431). */
  proximo(nome: string, inicial: number): number {
    return this.transacao(() => {
      const atual = this.um<{ valor: number }>('SELECT valor FROM sequencias WHERE nome = ?', nome);
      const valor = atual ? atual.valor + 1 : inicial;
      this.executar(
        'INSERT INTO sequencias (nome, valor) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET valor = excluded.valor',
        nome,
        valor,
      );
      return valor;
    });
  }

  fechar() {
    this.db.close();
  }
}

export function paraSql(v: unknown): Valor {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v as Valor;
}

/** Lê uma coluna JSON. */
export function json<T>(v: unknown, padrao: T): T {
  if (v === null || v === undefined || v === '') return padrao;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return padrao;
  }
}

export function agoraIso(): string {
  return new Date().toISOString();
}

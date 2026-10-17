// Catálogo de tarefas com versões. Cada publicação congela uma versão; o rascunho é editável.
// O agente usa sempre a versão publicada (ou o rascunho, no modo de teste do console).
import type { CasoDeTeste, StatusTarefa, TarefaDefinicao, UsuarioSistema } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import { novoId } from '../util/ids.ts';

export interface TarefaLinha {
  id: string;
  slug: string;
  status: StatusTarefa;
  versaoPublicada: number | null;
  criadoEm: string;
  atualizadoEm: string;
  atualizadoPor: string | null;
}

export interface VersaoLinha {
  tarefaId: string;
  versao: number;
  status: 'publicada' | 'rascunho' | 'arquivada';
  definicao: TarefaDefinicao;
  resumoMudancas: string | null;
  salvoEm: string;
  publicadoPor: string | null;
  publicadoEm: string | null;
}

/** Tarefa pronta para o agente usar: a versão certa da ficha. */
export interface TarefaEmUso {
  id: string;
  slug: string;
  versao: number;
  status: StatusTarefa;
  definicao: TarefaDefinicao;
}

export function slugDe(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

export class Catalogo {
  constructor(private readonly banco: Banco) {}

  listar(): TarefaLinha[] {
    return this.banco.todos<Record<string, unknown>>('SELECT * FROM tarefas ORDER BY criado_em').map(tarefaDe);
  }

  obter(id: string): TarefaLinha | null {
    const l = this.banco.um<Record<string, unknown>>('SELECT * FROM tarefas WHERE id = ?', id);
    return l ? tarefaDe(l) : null;
  }

  obterPorSlug(slug: string): TarefaLinha | null {
    const l = this.banco.um<Record<string, unknown>>('SELECT * FROM tarefas WHERE slug = ?', slug);
    return l ? tarefaDe(l) : null;
  }

  versoes(tarefaId: string): VersaoLinha[] {
    return this.banco
      .todos<Record<string, unknown>>('SELECT * FROM tarefa_versoes WHERE tarefa_id = ? ORDER BY versao DESC', tarefaId)
      .map(versaoDe);
  }

  versao(tarefaId: string, versao: number): VersaoLinha | null {
    const l = this.banco.um<Record<string, unknown>>(
      'SELECT * FROM tarefa_versoes WHERE tarefa_id = ? AND versao = ?',
      tarefaId,
      versao,
    );
    return l ? versaoDe(l) : null;
  }

  publicada(tarefaId: string): VersaoLinha | null {
    const t = this.obter(tarefaId);
    return t?.versaoPublicada ? this.versao(tarefaId, t.versaoPublicada) : null;
  }

  rascunho(tarefaId: string): VersaoLinha | null {
    const l = this.banco.um<Record<string, unknown>>(
      "SELECT * FROM tarefa_versoes WHERE tarefa_id = ? AND status = 'rascunho' ORDER BY versao DESC LIMIT 1",
      tarefaId,
    );
    return l ? versaoDe(l) : null;
  }

  /** Cria uma tarefa nova em rascunho (versão 1). */
  criar(definicao: TarefaDefinicao, por: string | null, slugDesejado?: string): TarefaLinha {
    const agora = agoraIso();
    let slug = slugDesejado ?? slugDe(definicao.nome);
    for (let i = 2; this.obterPorSlug(slug); i++) slug = `${slugDe(definicao.nome)}_${i}`;
    const id = novoId('tar');
    this.banco.transacao(() => {
      this.banco.inserir('tarefas', {
        id,
        slug,
        status: 'rascunho',
        versao_publicada: null,
        criado_em: agora,
        atualizado_em: agora,
        atualizado_por: por,
      });
      this.banco.inserir('tarefa_versoes', {
        tarefa_id: id,
        versao: 1,
        status: 'rascunho',
        definicao,
        salvo_em: agora,
      });
    });
    return this.obter(id)!;
  }

  /** Grava o rascunho (cria a próxima versão em rascunho se ainda não houver). */
  salvarRascunho(tarefaId: string, definicao: TarefaDefinicao, por: string | null): VersaoLinha {
    const agora = agoraIso();
    return this.banco.transacao(() => {
      const atual = this.rascunho(tarefaId);
      let versao: number;
      if (atual) {
        versao = atual.versao;
        this.banco.executar(
          'UPDATE tarefa_versoes SET definicao = ?, salvo_em = ? WHERE tarefa_id = ? AND versao = ?',
          JSON.stringify(definicao),
          agora,
          tarefaId,
          versao,
        );
      } else {
        versao =
          (this.banco.um<{ v: number | null }>('SELECT MAX(versao) AS v FROM tarefa_versoes WHERE tarefa_id = ?', tarefaId)
            ?.v ?? 0) + 1;
        this.banco.inserir('tarefa_versoes', {
          tarefa_id: tarefaId,
          versao,
          status: 'rascunho',
          definicao,
          salvo_em: agora,
        });
      }
      this.banco.atualizar('tarefas', tarefaId, { atualizado_em: agora, atualizado_por: por });
      return this.versao(tarefaId, versao)!;
    });
  }

  descartarRascunho(tarefaId: string) {
    this.banco.executar("DELETE FROM tarefa_versoes WHERE tarefa_id = ? AND status = 'rascunho'", tarefaId);
  }

  /** Publica o rascunho. A versão anterior fica arquivada (e pode ser restaurada como rascunho). */
  publicar(tarefaId: string, por: string, resumoMudancas: string | null): VersaoLinha {
    const agora = agoraIso();
    return this.banco.transacao(() => {
      const r = this.rascunho(tarefaId);
      if (!r) throw new Error('Não há rascunho para publicar.');
      this.banco.executar(
        "UPDATE tarefa_versoes SET status = 'arquivada' WHERE tarefa_id = ? AND status = 'publicada'",
        tarefaId,
      );
      this.banco.executar(
        "UPDATE tarefa_versoes SET status = 'publicada', publicado_por = ?, publicado_em = ?, resumo_mudancas = ? WHERE tarefa_id = ? AND versao = ?",
        por,
        agora,
        resumoMudancas,
        tarefaId,
        r.versao,
      );
      const t = this.obter(tarefaId)!;
      const status: StatusTarefa =
        t.status === 'rascunho' || t.status === 'inativa'
          ? r.definicao.liberadaPara && r.definicao.liberadaPara.length > 0
            ? 'teste'
            : 'ativa'
          : t.status;
      this.banco.atualizar('tarefas', tarefaId, {
        versao_publicada: r.versao,
        status,
        atualizado_em: agora,
        atualizado_por: por,
      });
      return this.versao(tarefaId, r.versao)!;
    });
  }

  definirStatus(tarefaId: string, status: StatusTarefa, por: string | null) {
    this.banco.atualizar('tarefas', tarefaId, { status, atualizado_em: agoraIso(), atualizado_por: por });
  }

  /**
   * Tarefas que o agente pode oferecer a este usuário. Inclui as que ele não tem permissão
   * (o agente explica e oferece pedir aprovação). Em teste, só para quem está liberado.
   */
  emUso(usuario: Pick<UsuarioSistema, 'id'>, usarRascunhos: boolean): TarefaEmUso[] {
    const lista: TarefaEmUso[] = [];
    for (const t of this.listar()) {
      if (t.status === 'inativa') continue;
      const v = usarRascunhos ? (this.rascunho(t.id) ?? this.publicada(t.id)) : this.publicada(t.id);
      if (!v) continue;
      if (!usarRascunhos) {
        if (t.status === 'rascunho') continue;
        if (t.status === 'teste') {
          const liberados = v.definicao.liberadaPara ?? [];
          if (liberados.length > 0 && !liberados.includes(usuario.id)) continue;
        }
      }
      lista.push({ id: t.id, slug: t.slug, versao: v.versao, status: t.status, definicao: v.definicao });
    }
    return lista;
  }

  testes(tarefaId: string): CasoDeTeste[] {
    return this.banco
      .todos<{ id: string; frase: string; esperado: string }>(
        'SELECT id, frase, esperado FROM tarefa_testes WHERE tarefa_id = ? ORDER BY ordem',
        tarefaId,
      )
      .map((l) => ({ id: l.id, frase: l.frase, esperado: json(l.esperado, { resultado: 'pergunta' as const }) }));
  }

  salvarTestes(tarefaId: string, casos: Omit<CasoDeTeste, 'id'>[] | CasoDeTeste[]) {
    this.banco.transacao(() => {
      this.banco.executar('DELETE FROM tarefa_testes WHERE tarefa_id = ?', tarefaId);
      casos.forEach((c, i) =>
        this.banco.inserir('tarefa_testes', {
          id: 'id' in c && c.id ? c.id : novoId('tst'),
          tarefa_id: tarefaId,
          frase: c.frase,
          esperado: c.esperado,
          ordem: i,
        }),
      );
    });
  }
}

/** Usuário pode executar a tarefa diretamente? (perfis do sistema) */
export function podeExecutar(definicao: TarefaDefinicao, perfis: string[]): boolean {
  if (definicao.perfisPermitidos.length === 0) return true;
  return perfis.some((p) => definicao.perfisPermitidos.includes(p));
}

function tarefaDe(l: Record<string, unknown>): TarefaLinha {
  return {
    id: String(l.id),
    slug: String(l.slug),
    status: l.status as StatusTarefa,
    versaoPublicada: (l.versao_publicada as number | null) ?? null,
    criadoEm: String(l.criado_em),
    atualizadoEm: String(l.atualizado_em),
    atualizadoPor: (l.atualizado_por as string | null) ?? null,
  };
}

function versaoDe(l: Record<string, unknown>): VersaoLinha {
  return {
    tarefaId: String(l.tarefa_id),
    versao: Number(l.versao),
    status: l.status as VersaoLinha['status'],
    definicao: json<TarefaDefinicao>(l.definicao, {} as TarefaDefinicao),
    resumoMudancas: (l.resumo_mudancas as string | null) ?? null,
    salvoEm: String(l.salvo_em),
    publicadoPor: (l.publicado_por as string | null) ?? null,
    publicadoEm: (l.publicado_em as string | null) ?? null,
  };
}

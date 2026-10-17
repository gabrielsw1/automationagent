// Conversas do widget: mensagens que a pessoa vê (tabela mensagens) e a transcrição enviada ao
// Claude (tabela transcricao, só acrescentada). Toda mudança é emitida para o widget por SSE.
import type { EstadoConversa, MensagemWidget, PaginaContexto } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import type { Eventos } from '../eventos.ts';
import type { MensagemLlm } from '../llm/tipos.ts';
import { novoId } from '../util/ids.ts';

export interface ConversaLinha {
  id: string;
  usuarioId: string;
  usuarioNome: string;
  canal: 'widget' | 'teste';
  usarRascunhos: boolean;
  contexto: PaginaContexto | null;
  estado: EstadoConversa;
  atendenteId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  encerradaEm: string | null;
}

interface LinhaDb {
  id: string;
  usuario_id: string;
  usuario_nome: string;
  canal: 'widget' | 'teste';
  usar_rascunhos: number;
  contexto: string | null;
  estado: string;
  atendente_id: string | null;
  criado_em: string;
  atualizado_em: string;
  encerrada_em: string | null;
}

type CorpoMensagem = Omit<MensagemWidget, 'id' | 'conversaId' | 'autor' | 'criadoEm'>;

export type NovaMensagem = Omit<MensagemWidget, 'id' | 'conversaId' | 'criadoEm' | 'blocos'> & {
  blocos?: MensagemWidget['blocos'];
  idCliente?: string;
};

export class Conversas {
  constructor(
    private readonly banco: Banco,
    private readonly eventos: Eventos,
  ) {}

  criar(p: {
    usuarioId: string;
    usuarioNome: string;
    canal: 'widget' | 'teste';
    usarRascunhos?: boolean;
    contexto?: PaginaContexto | null;
  }): ConversaLinha {
    const agora = agoraIso();
    const id = novoId('cv');
    this.banco.inserir('conversas', {
      id,
      usuario_id: p.usuarioId,
      usuario_nome: p.usuarioNome,
      canal: p.canal,
      usar_rascunhos: p.usarRascunhos ? 1 : 0,
      contexto: p.contexto ?? null,
      estado: { modo: 'copiloto' },
      criado_em: agora,
      atualizado_em: agora,
    });
    return this.buscar(id)!;
  }

  buscar(id: string): ConversaLinha | null {
    const l = this.banco.um<LinhaDb>('SELECT * FROM conversas WHERE id = ?', id);
    return l ? converter(l) : null;
  }

  /** Conversa recente ainda aberta do usuário (para retomar ao reabrir o widget). */
  emAberto(usuarioId: string, canal: 'widget' | 'teste' = 'widget', horas = 12): ConversaLinha | null {
    const desde = new Date(Date.now() - horas * 3600_000).toISOString();
    const l = this.banco.um<LinhaDb>(
      `SELECT * FROM conversas WHERE usuario_id = ? AND canal = ? AND encerrada_em IS NULL AND atualizado_em >= ?
       ORDER BY atualizado_em DESC LIMIT 1`,
      usuarioId,
      canal,
      desde,
    );
    return l ? converter(l) : null;
  }

  encerrar(id: string) {
    this.banco.atualizar('conversas', id, { encerrada_em: agoraIso() });
  }

  atualizarContexto(id: string, contexto: PaginaContexto | null | undefined) {
    if (contexto === undefined) return;
    this.banco.atualizar('conversas', id, { contexto, atualizado_em: agoraIso() });
  }

  mensagens(conversaId: string): MensagemWidget[] {
    return this.banco
      .todos<{ id: string; autor: MensagemWidget['autor']; corpo: string; criado_em: string }>(
        'SELECT id, autor, corpo, criado_em FROM mensagens WHERE conversa_id = ? ORDER BY seq',
        conversaId,
      )
      .map((l) => montar(conversaId, l));
  }

  mensagem(id: string): MensagemWidget | null {
    const l = this.banco.um<{ id: string; conversa_id: string; autor: MensagemWidget['autor']; corpo: string; criado_em: string }>(
      'SELECT id, conversa_id, autor, corpo, criado_em FROM mensagens WHERE id = ?',
      id,
    );
    return l ? montar(l.conversa_id, l) : null;
  }

  /** Mensagem já recebida com este id do cliente (reenvio depois de ficar offline). */
  porIdCliente(conversaId: string, idCliente: string): MensagemWidget | null {
    const l = this.banco.um<{ id: string }>(
      'SELECT id FROM mensagens WHERE conversa_id = ? AND id_cliente = ?',
      conversaId,
      idCliente,
    );
    return l ? this.mensagem(l.id) : null;
  }

  adicionar(conversaId: string, nova: NovaMensagem): MensagemWidget {
    const { idCliente, autor, ...resto } = nova;
    const corpo: CorpoMensagem = { ...resto, blocos: nova.blocos ?? [] };
    const id = novoId('msg');
    const criadoEm = agoraIso();
    this.banco.transacao(() => {
      const seq =
        (this.banco.um<{ s: number | null }>('SELECT MAX(seq) AS s FROM mensagens WHERE conversa_id = ?', conversaId)?.s ??
          0) + 1;
      this.banco.inserir('mensagens', {
        id,
        conversa_id: conversaId,
        seq,
        autor,
        corpo,
        id_cliente: idCliente ?? null,
        criado_em: criadoEm,
      });
      this.banco.atualizar('conversas', conversaId, { atualizado_em: criadoEm });
    });
    const mensagem = this.mensagem(id)!;
    this.eventos.emitirConversa(conversaId, { tipo: 'mensagem', mensagem });
    this.eventos.emitirConsole({ tipo: 'mensagem', conversaId, mensagemId: id });
    return mensagem;
  }

  /** Altera uma mensagem já enviada (ex.: cartão confirmado, progresso da execução). */
  atualizar(id: string, alterar: (m: MensagemWidget) => MensagemWidget | void): MensagemWidget | null {
    const atual = this.mensagem(id);
    if (!atual) return null;
    const copia = structuredClone(atual);
    const nova = alterar(copia) ?? copia;
    const { id: _i, conversaId: _c, autor: _a, criadoEm: _d, ...corpo } = nova;
    this.banco.atualizar('mensagens', id, { corpo });
    const mensagem = this.mensagem(id)!;
    this.eventos.emitirConversa(atual.conversaId, { tipo: 'mensagem_atualizada', mensagem });
    return mensagem;
  }

  /** Pedaço de texto chegando por streaming (não grava; a mensagem final é gravada depois). */
  delta(conversaId: string, mensagemId: string, texto: string) {
    this.eventos.emitirConversa(conversaId, { tipo: 'delta', mensagemId, texto });
  }

  digitando(conversaId: string, ativo: boolean, autor: 'copiloto' | 'pessoa' = 'copiloto') {
    this.eventos.emitirConversa(conversaId, { tipo: 'digitando', ativo, autor });
  }

  definirEstado(conversaId: string, estado: EstadoConversa, atendenteId?: string | null) {
    const dados: Record<string, unknown> = { estado, atualizado_em: agoraIso() };
    if (atendenteId !== undefined) dados.atendente_id = atendenteId;
    this.banco.atualizar('conversas', conversaId, dados);
    this.eventos.emitirConversa(conversaId, { tipo: 'estado', estado });
    this.eventos.emitirConsole({ tipo: 'conversa', conversaId, estado: estado.modo });
  }

  /**
   * Nota para o agente sobre algo que aconteceu fora da conversa com o Claude (ex.: a pessoa confirmou
   * o cartão, a execução terminou, alguém do suporte respondeu). Entra no começo da próxima mensagem.
   */
  anotar(conversaId: string, nota: string) {
    this.banco.transacao(() => {
      const atual = this.banco.um<{ notas: string }>('SELECT notas FROM conversas WHERE id = ?', conversaId);
      if (!atual) return;
      const notas = json<string[]>(atual.notas, []);
      notas.push(nota);
      this.banco.atualizar('conversas', conversaId, { notas: notas.slice(-20) });
    });
  }

  /** Devolve e limpa as notas pendentes. */
  retirarNotas(conversaId: string): string[] {
    return this.banco.transacao(() => {
      const atual = this.banco.um<{ notas: string }>('SELECT notas FROM conversas WHERE id = ?', conversaId);
      const notas = json<string[]>(atual?.notas, []);
      if (notas.length) this.banco.atualizar('conversas', conversaId, { notas: [] });
      return notas;
    });
  }

  transcricao(conversaId: string): MensagemLlm[] {
    return this.banco
      .todos<{ papel: 'user' | 'assistant'; conteudo: string }>(
        'SELECT papel, conteudo FROM transcricao WHERE conversa_id = ? ORDER BY seq',
        conversaId,
      )
      .map((l) => ({ role: l.papel, content: JSON.parse(l.conteudo) }));
  }

  /** Acrescenta ao fim da transcrição. Nunca edite nem apague entradas anteriores. */
  acrescentarTranscricao(conversaId: string, papel: 'user' | 'assistant', conteudo: MensagemLlm['content']) {
    const blocos = typeof conteudo === 'string' ? [{ type: 'text', text: conteudo }] : conteudo;
    this.banco.transacao(() => {
      const seq =
        (this.banco.um<{ s: number | null }>('SELECT MAX(seq) AS s FROM transcricao WHERE conversa_id = ?', conversaId)
          ?.s ?? 0) + 1;
      this.banco.inserir('transcricao', {
        conversa_id: conversaId,
        seq,
        papel,
        conteudo: JSON.stringify(blocos),
        criado_em: agoraIso(),
      });
    });
  }
}

function montar(
  conversaId: string,
  l: { id: string; autor: MensagemWidget['autor']; corpo: string; criado_em: string },
): MensagemWidget {
  const corpo = json<CorpoMensagem>(l.corpo, { blocos: [] });
  return { ...corpo, id: l.id, conversaId, autor: l.autor, criadoEm: l.criado_em, blocos: corpo.blocos ?? [] };
}

function converter(l: LinhaDb): ConversaLinha {
  return {
    id: l.id,
    usuarioId: l.usuario_id,
    usuarioNome: l.usuario_nome,
    canal: l.canal,
    usarRascunhos: l.usar_rascunhos === 1,
    contexto: json<PaginaContexto | null>(l.contexto, null),
    estado: json<EstadoConversa>(l.estado, { modo: 'copiloto' }),
    atendenteId: l.atendente_id,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    encerradaEm: l.encerrada_em,
  };
}

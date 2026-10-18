// Fluxos gravados guardados na tabela `fluxos`: leitura, criação, gravação de eventos e mudanças.
// O motor de execução pode usar `lerFluxo(banco, id)` para pegar os passos de um fluxo.
import type { Campo, EtapaFluxo, EventoGravado, Fluxo, PassoFluxo } from '@copiloto/shared';
import { agoraIso, json, type Banco } from '../db/banco.ts';
import { novoId, tokenAleatorio } from '../util/ids.ts';

export interface LinhaFluxo extends Fluxo {
  eventosGravados: EventoGravado[];
  tokenGravacao: string | null;
  criadoEm: string;
}

function deLinha(l: Record<string, unknown>): LinhaFluxo {
  return {
    id: String(l.id),
    nome: String(l.nome),
    tarefaId: (l.tarefa_id as string | null) ?? null,
    etapa: l.etapa as EtapaFluxo,
    status: l.status as Fluxo['status'],
    versao: Number(l.versao ?? 1),
    passos: json<PassoFluxo[]>(l.passos, []),
    camposSugeridos: json<Campo[]>(l.campos_sugeridos, []),
    gravadoPor: (l.gravado_por as string | null) ?? null,
    gravadoEm: (l.gravado_em as string | null) ?? null,
    duracaoGravacaoMs: (l.duracao_gravacao_ms as number | null) ?? null,
    urlInicial: (l.url_inicial as string | null) ?? null,
    resultado: json<Fluxo['resultado']>(l.resultado, null),
    ultimoTeste: json<Fluxo['ultimoTeste']>(l.ultimo_teste, null),
    salvoEm: String(l.salvo_em),
    eventosGravados: json<EventoGravado[]>(l.eventos_gravados, []),
    tokenGravacao: (l.token_gravacao as string | null) ?? null,
    criadoEm: String(l.criado_em),
  };
}

/** Só o que vai para o console (sem os eventos brutos nem o token). */
export function publico(f: LinhaFluxo): Fluxo {
  const { eventosGravados: _e, tokenGravacao: _t, criadoEm: _c, ...fluxo } = f;
  return fluxo;
}

export function lerFluxo(banco: Banco, id: string): LinhaFluxo | null {
  const l = banco.um<Record<string, unknown>>('SELECT * FROM fluxos WHERE id = ?', id);
  return l ? deLinha(l) : null;
}

export class Fluxos {
  /**
   * `empresaId`: os tokens de gravação começam com ele (`<empresa>.<aleatório>`), para a rota de
   * gravação achar o banco certo sem sessão. Sem ele, o fluxo só serve para ler e mudar.
   */
  constructor(
    private readonly banco: Banco,
    private readonly empresaId?: string,
  ) {}

  private novoToken(): string {
    if (!this.empresaId) throw new Error('Para gravar, crie Fluxos com o ID da empresa.');
    return `${this.empresaId}.${tokenAleatorio(24)}`;
  }

  listar(): LinhaFluxo[] {
    return this.banco.todos<Record<string, unknown>>('SELECT * FROM fluxos ORDER BY salvo_em DESC').map(deLinha);
  }

  obter(id: string): LinhaFluxo | null {
    return lerFluxo(this.banco, id);
  }

  porToken(token: string): LinhaFluxo | null {
    if (!token) return null;
    const l = this.banco.um<Record<string, unknown>>('SELECT * FROM fluxos WHERE token_gravacao = ?', token);
    return l ? deLinha(l) : null;
  }

  /** Fluxo novo, já em gravação, com um token secreto para o gravador do widget. */
  criar(dados: { nome: string; tarefaId: string | null; urlInicial: string; por: string }): LinhaFluxo {
    const id = novoId('flx');
    const agora = agoraIso();
    this.banco.inserir('fluxos', {
      id,
      nome: dados.nome,
      tarefa_id: dados.tarefaId,
      etapa: 'gravar',
      status: 'gravando',
      versao: 1,
      passos: [],
      campos_sugeridos: [],
      eventos_gravados: [],
      token_gravacao: this.novoToken(),
      gravado_por: dados.por,
      gravado_em: null,
      duracao_gravacao_ms: null,
      url_inicial: dados.urlInicial,
      ultimo_teste: null,
      criado_em: agora,
      salvo_em: agora,
    });
    return this.obter(id)!;
  }

  /** Nova versão em rascunho a partir de um fluxo publicado (o publicado continua valendo). */
  novaVersao(origem: LinhaFluxo, por: string): LinhaFluxo {
    const id = novoId('flx');
    const agora = agoraIso();
    const maior =
      this.banco.um<{ v: number | null }>(
        'SELECT MAX(versao) AS v FROM fluxos WHERE nome = ? AND COALESCE(tarefa_id, \'\') = COALESCE(?, \'\')',
        origem.nome,
        origem.tarefaId,
      )?.v ?? origem.versao;
    this.banco.inserir('fluxos', {
      id,
      nome: origem.nome,
      tarefa_id: origem.tarefaId,
      etapa: 'revisar',
      status: 'rascunho',
      versao: maior + 1,
      passos: origem.passos.map(({ printId: _p, ...p }) => p),
      campos_sugeridos: origem.camposSugeridos,
      eventos_gravados: origem.eventosGravados,
      token_gravacao: null,
      gravado_por: por,
      gravado_em: origem.gravadoEm,
      duracao_gravacao_ms: origem.duracaoGravacaoMs,
      url_inicial: origem.urlInicial,
      resultado: origem.resultado ?? null,
      ultimo_teste: null,
      criado_em: agora,
      salvo_em: agora,
    });
    return this.obter(id)!;
  }

  /** Recomeça a gravação (novo token; os eventos anteriores são descartados). */
  regravar(id: string, por: string, urlInicial?: string): LinhaFluxo {
    this.banco.atualizar('fluxos', id, {
      etapa: 'gravar',
      status: 'gravando',
      eventos_gravados: [],
      passos: [],
      token_gravacao: this.novoToken(),
      gravado_por: por,
      gravado_em: null,
      duracao_gravacao_ms: null,
      ultimo_teste: null,
      ...(urlInicial ? { url_inicial: urlInicial } : {}),
      salvo_em: agoraIso(),
    });
    return this.obter(id)!;
  }

  /** Acrescenta eventos do gravador e guarda os passos provisórios (por regras). */
  acrescentarEventos(id: string, eventos: EventoGravado[], passos: PassoFluxo[]): LinhaFluxo {
    const atual = this.obter(id)!;
    this.banco.atualizar('fluxos', id, {
      eventos_gravados: [...atual.eventosGravados, ...eventos],
      passos,
      salvo_em: agoraIso(),
    });
    return this.obter(id)!;
  }

  atualizar(id: string, campos: Partial<Record<string, unknown>>): LinhaFluxo {
    this.banco.atualizar('fluxos', id, { ...campos, salvo_em: agoraIso() });
    return this.obter(id)!;
  }

  apagar(id: string) {
    this.banco.executar('DELETE FROM fluxos WHERE id = ?', id);
  }
}

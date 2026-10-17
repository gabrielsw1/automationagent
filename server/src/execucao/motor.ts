// Motor de execução: cria execuções a partir do agente, espera o "confirmo" da pessoa,
// executa pela API do sistema (ou pelo navegador) e registra cada passo na linha do tempo.
//
// Regras que valem aqui:
// - Nada grava sem a confirmação da pessoa (ou a aprovação de quem tem o perfil).
// - O sistema é chamado sempre em nome de quem pediu (ou do aprovador), com chave de idempotência.
// - Falha do sistema: tenta mais 2 vezes; se a tarefa permitir, segue pelo fluxo gravado na tela.
// - No modo de teste do console nada é gravado: a API valida com x-simulacao e o navegador é simulado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  creditosDaExecucao,
  fmt,
  validarTarefa,
  type AcaoBloco,
  type Bloco,
  type Caminho,
  type CampoExibido,
  type EtapaProgresso,
  type Fluxo,
  type MensagemWidget,
  type RegistroLido,
  type StatusExecucao,
  type TarefaDefinicao,
  type UsuarioSistema,
} from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import { agoraIso, json } from '../db/banco.ts';
import { ErroConexaoSistema, type ChamadaApi, type RespostaApi } from '../adaptadores/tipos.ts';
import type { EventoNavegador } from '../navegador/tipos.ts';
import { numeroParaRecibo } from '../navegador/registro.ts';
import type { ConversaLinha, NovaMensagem } from '../servicos/conversas.ts';
import type { TarefaEmUso } from '../servicos/catalogo.ts';
import { ErroHttp, conflito, naoEncontrado, semPermissao } from '../util/erros.ts';
import { codigoRef, novoId } from '../util/ids.ts';
import {
  camposDoRegistro,
  codigoDoRegistro,
  diferencas,
  escalares,
  existenteDe,
  montarCorpo,
  preencherCaminho,
  tituloDoRegistro,
} from './api.ts';
import {
  atualizarExecucao,
  execucoesDaConversa,
  lerExecucao,
  proximoIdExecucao,
  registrarEvento,
  type Diagnostico,
  type Execucao,
  type InternoExecucao,
  type ResultadoExecucao,
} from './registro.ts';

/** Quem fez a ação: a pessoa no widget, alguém da equipe no console ou o próprio sistema. */
export interface Ator {
  tipo: 'usuario' | 'membro' | 'sistema';
  id: string;
  nome: string;
}

type BlocoConfirmacao = Extract<Bloco, { tipo: 'confirmacao' }>;
type BlocoAprovacao = Extract<Bloco, { tipo: 'aprovacao' }>;
type BlocoProgresso = Extract<Bloco, { tipo: 'progresso' }>;

const ESTIMATIVA_ETAPA_MS = { api: 1200, navegador: 5000 };

function primeiraMinuscula(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** "Criando o cadastro" → "criar o cadastro" (para "Não consegui criar o cadastro"). */
function infinitivo(gerundio: string | undefined): string {
  if (!gerundio) return 'concluir o pedido';
  const [verbo, ...resto] = gerundio.trim().split(/\s+/);
  const inf = verbo.replace(/ando$/i, 'ar').replace(/endo$/i, 'er').replace(/indo$/i, 'ir');
  if (inf === verbo) return 'concluir o pedido';
  return [primeiraMinuscula(inf), ...resto].join(' ');
}

function rotuloGerado(chave: string): string {
  const especiais: Record<string, string> = {
    linha_digitavel: 'Linha digitável',
    protocolo: 'Protocolo',
    numero_boleto: 'Número do boleto',
    numero: 'Número',
  };
  if (especiais[chave]) return especiais[chave];
  const t = chave.replace(/_/g, ' ');
  return t[0].toUpperCase() + t.slice(1);
}

/** Campos do cartão: valores formatados, documento com selo de válido, padrão editável. */
export function camposExibidos(def: TarefaDefinicao, valores: Record<string, string>): CampoExibido[] {
  const lista: CampoExibido[] = [];
  for (const campo of def.campos) {
    const v = valores[campo.chave];
    if (!v) continue;
    const exibido: CampoExibido = { rotulo: campo.rotulo, valor: fmt.valorCampo(campo, v) };
    if (campo.tipo === 'documento') exibido.selo = 'valido';
    if (campo.perguntar === false) exibido.editavel = true;
    lista.push(exibido);
  }
  return lista;
}

function etapa(titulo: string, detalhe?: string): EtapaProgresso {
  return { titulo, detalhe, estado: 'pendente' };
}

class Progresso {
  constructor(
    private readonly motor: Motor,
    readonly execucaoId: string,
    readonly mensagemId: string | null,
    public bloco: BlocoProgresso,
  ) {}

  private salvar() {
    const feitas = this.bloco.etapas.filter((e) => e.estado === 'feita').length;
    const total = this.bloco.etapas.length || 1;
    this.bloco.percentual = Math.round((feitas / total) * 100);
    const faltam = total - feitas;
    const ms = faltam * ESTIMATIVA_ETAPA_MS[this.bloco.caminho];
    this.bloco.restante =
      this.bloco.status === 'em_andamento' && faltam > 0 ? `Faltam cerca de ${fmt.duracao(ms)}` : undefined;
    this.motor.atualizarBloco(this.mensagemId, (b) => (b.tipo === 'progresso' && b.execucaoId === this.execucaoId ? this.bloco : b));
  }

  iniciar(i: number, detalhe?: string) {
    const e = this.bloco.etapas[i];
    if (!e) return;
    e.estado = 'ativa';
    if (detalhe !== undefined) e.detalhe = detalhe;
    this.salvar();
  }

  concluir(i: number, detalhe?: string) {
    const e = this.bloco.etapas[i];
    if (!e) return;
    e.estado = 'feita';
    if (detalhe !== undefined) e.detalhe = detalhe;
    this.salvar();
  }

  detalhe(i: number, detalhe: string) {
    const e = this.bloco.etapas[i];
    if (!e) return;
    e.detalhe = detalhe;
    this.salvar();
  }

  falhar(i: number, detalhe?: string) {
    const e = this.bloco.etapas[i];
    if (e) {
      e.estado = 'falhou';
      if (detalhe !== undefined) e.detalhe = detalhe;
    }
    this.bloco.podeCancelar = false;
    this.salvar();
  }

  semCancelar() {
    this.bloco.podeCancelar = false;
    this.salvar();
  }

  finalizar(status: StatusExecucao) {
    this.bloco.status = status;
    this.bloco.podeCancelar = false;
    if (status === 'concluida') for (const e of this.bloco.etapas) e.estado = 'feita';
    if (status === 'cancelada') for (const e of this.bloco.etapas) if (e.estado === 'ativa') e.estado = 'pendente';
    this.salvar();
  }
}

/** Fim de execução tratado (a mensagem para a pessoa já foi enviada). */
class Encerrada extends Error {}

export class Motor {
  /** Esperas entre as tentativas quando o sistema não responde (2 tentativas extras). */
  esperasRetentativaMs = [1000, 3000];
  /** De quanto em quanto tempo conferir se o sistema voltou, depois de uma falha. */
  intervaloVoltaMs = 30_000;
  /** Atraso entre etapas do navegador simulado (modo de teste). */
  atrasoSimuladoMs = 250;

  private readonly controles = new Map<string, AbortController>();
  private readonly vigias = new Map<string, NodeJS.Timeout>();
  private readonly emCurso = new Set<Promise<void>>();

  constructor(protected readonly ctx: Contexto) {}

  // ---------------------------------------------------------------- consultas

  obter(id: string): Execucao {
    const e = lerExecucao(this.ctx.banco, id);
    if (!e) throw naoEncontrado('Execução');
    return e;
  }

  definicaoDe(e: Execucao): TarefaDefinicao {
    const v = e.tarefaId && e.tarefaVersao ? this.ctx.catalogo.versao(e.tarefaId, e.tarefaVersao) : null;
    if (!v) throw new ErroHttp(409, 'tarefa_indisponivel', 'A tarefa desta execução não existe mais.');
    return v.definicao;
  }

  /** Espera todas as execuções em segundo plano (testes e desligamento). */
  async ocioso(): Promise<void> {
    while (this.emCurso.size) await Promise.allSettled([...this.emCurso]);
  }

  parar() {
    for (const t of this.vigias.values()) clearInterval(t);
    this.vigias.clear();
    for (const c of this.controles.values()) c.abort();
  }

  // ---------------------------------------------------------------- mensagens no widget

  private postar(conversaId: string | null, nova: NovaMensagem): MensagemWidget | null {
    if (!conversaId || !this.ctx.conversas.buscar(conversaId)) return null;
    return this.ctx.conversas.adicionar(conversaId, nova);
  }

  atualizarBloco(mensagemId: string | null, fn: (b: Bloco) => Bloco) {
    if (!mensagemId) return;
    this.ctx.conversas.atualizar(mensagemId, (m) => {
      m.blocos = m.blocos.map(fn);
    });
  }

  private anotar(e: Execucao, nota: string) {
    if (e.conversaId) this.ctx.conversas.anotar(e.conversaId, nota);
  }

  private avisarConsole(e: Execucao, status?: StatusExecucao) {
    this.ctx.eventos.emitirConsole({ tipo: 'execucao', execucaoId: e.id, status: status ?? e.status });
  }

  private definirStatus(e: Execucao, status: StatusExecucao, extras: Record<string, unknown> = {}) {
    atualizarExecucao(this.ctx.banco, e.id, { status, ...extras });
    e.status = status;
    this.avisarConsole(e, status);
  }

  // ---------------------------------------------------------------- criação (agente)

  private inserir(p: {
    conversa: ConversaLinha;
    usuario: UsuarioSistema;
    tarefa: Pick<TarefaEmUso, 'id' | 'versao' | 'definicao'>;
    valores: Record<string, string>;
    pedido: string;
    interno?: InternoExecucao;
  }): Execucao {
    const id = proximoIdExecucao(this.ctx.banco);
    const def = p.tarefa.definicao;
    this.ctx.banco.inserir('execucoes', {
      id,
      conversa_id: p.conversa.id,
      usuario_id: p.usuario.id,
      usuario_nome: p.usuario.nome,
      tarefa_id: p.tarefa.id,
      tarefa_nome: def.nome,
      tarefa_versao: p.tarefa.versao,
      pedido: p.pedido.slice(0, 500),
      caminho: def.caminho === 'api' && def.api ? 'api' : 'navegador',
      status: 'aguardando_confirmacao',
      canal: p.conversa.canal,
      dados: p.valores,
      interno: p.interno ?? {},
      criado_em: agoraIso(),
    });
    const e = this.obter(id);
    registrarEvento(this.ctx.banco, id, {
      tipo: 'pedido',
      titulo: 'Pedido recebido',
      detalhe: `“${p.pedido.slice(0, 280)}”`,
      estado: 'info',
      dados: camposExibidos(def, p.valores).map((c) => ({ rotulo: c.rotulo, valor: c.valor })),
    });
    this.avisarConsole(e);
    return e;
  }

  /** Cartões ainda pendentes nesta conversa ficam como "substituído" quando surge um novo. */
  substituirPendentes(conversaId: string) {
    for (const e of execucoesDaConversa(this.ctx.banco, conversaId)) {
      if (e.status !== 'aguardando_confirmacao') continue;
      this.definirStatus(e, 'cancelada', { erro: 'substituida' });
      this.atualizarBloco(e.mensagemCartaoId, (b) => {
        if (b.tipo === 'confirmacao' && b.execucaoId === e.id) return { ...b, estado: 'substituido' };
        if (b.tipo === 'aprovacao' && b.execucaoId === e.id) return { ...b, estado: 'cancelada' };
        return b;
      });
      this.ctx.banco.executar("UPDATE aprovacoes SET estado = 'cancelada' WHERE execucao_id = ? AND estado = 'rascunho'", e.id);
    }
  }

  /** Dados completos e permitidos: cria a execução e devolve o cartão de confirmação (W3). */
  criarCartao(p: {
    conversa: ConversaLinha;
    usuario: UsuarioSistema;
    tarefa: Pick<TarefaEmUso, 'id' | 'versao' | 'definicao'>;
    valores: Record<string, string>;
    pedido: string;
  }): { execucao: Execucao; bloco: BlocoConfirmacao } {
    this.substituirPendentes(p.conversa.id);
    const e = this.inserir(p);
    return { execucao: e, bloco: this.cartaoDe(e, p.tarefa.definicao) };
  }

  private cartaoDe(e: Execucao, def: TarefaDefinicao, extras: Partial<BlocoConfirmacao> = {}): BlocoConfirmacao {
    const caminho: Caminho = e.caminho ?? 'api';
    return {
      tipo: 'confirmacao',
      execucaoId: e.id,
      tarefa: def.nome,
      titulo: def.tituloConfirmacao,
      campos: camposExibidos(def, e.dados),
      caminho,
      tempoEstimado: def.tempoEstimado ?? (caminho === 'api' ? 'cerca de 5 s' : 'cerca de 40 s'),
      desfazerMinutos: e.canal === 'teste' || !def.api?.desfazer || caminho !== 'api' ? 0 : def.desfazerMinutos,
      estado: 'pendente',
      ...extras,
    };
  }

  /** A pessoa não tem o perfil: cria a execução e o pedido de aprovação em rascunho (W7). */
  async criarAprovacao(p: {
    conversa: ConversaLinha;
    usuario: UsuarioSistema;
    tarefa: Pick<TarefaEmUso, 'id' | 'versao' | 'definicao'>;
    valores: Record<string, string>;
    pedido: string;
  }): Promise<{ execucao: Execucao; bloco: BlocoAprovacao; perfilNecessario: string } | null> {
    const def = p.tarefa.definicao;
    const perfil = def.perfilAprovador ?? def.perfisPermitidos[0];
    if (!perfil) return null;
    const usuarios = await this.ctx.adaptador.listarUsuarios().catch(() => [] as UsuarioSistema[]);
    const aprovador = usuarios.find((u) => u.id !== p.usuario.id && u.perfis.includes(perfil)) ?? null;
    if (!aprovador) return null;
    this.substituirPendentes(p.conversa.id);
    const e = this.inserir(p);
    const aprovacaoId = novoId('apr');
    this.ctx.banco.inserir('aprovacoes', {
      id: aprovacaoId,
      execucao_id: e.id,
      solicitante_id: p.usuario.id,
      solicitante_nome: p.usuario.nome,
      aprovador_id: aprovador.id,
      aprovador_nome: aprovador.nome,
      perfil_necessario: def.perfisPermitidos.find((x) => !p.usuario.perfis.includes(x)) ?? perfil,
      estado: 'rascunho',
      criado_em: agoraIso(),
    });
    atualizarExecucao(this.ctx.banco, e.id, { interno: { ...e.interno, aprovacaoId } });
    const bloco: BlocoAprovacao = {
      tipo: 'aprovacao',
      aprovacaoId,
      execucaoId: e.id,
      campos: [{ rotulo: 'Pedido', valor: def.nome }, ...camposExibidos(def, p.valores)],
      aprovador: { id: aprovador.id, nome: aprovador.nome },
      estado: 'rascunho',
    };
    return { execucao: this.obter(e.id), bloco, perfilNecessario: perfil };
  }

  /** O agente gravou a mensagem do turno: liga cartões e aprovações a ela. */
  ligarMensagem(execucaoIds: string[], mensagemId: string) {
    for (const id of execucaoIds) {
      atualizarExecucao(this.ctx.banco, id, { mensagem_cartao_id: mensagemId });
      this.ctx.banco.executar('UPDATE aprovacoes SET mensagem_id = ? WHERE execucao_id = ?', mensagemId, id);
    }
  }

  // ---------------------------------------------------------------- ações da pessoa

  /** A pessoa tocou "Confirmar e executar" no cartão. */
  async confirmar(execucaoId: string, usuarioId: string, ip?: string): Promise<void> {
    const e = this.obter(execucaoId);
    if (e.usuarioId !== usuarioId) throw semPermissao('Este cartão é de outra pessoa.');
    if (e.status !== 'aguardando_confirmacao') {
      if (e.confirmadoEm) return; // toque repetido
      throw conflito('Este cartão não pode mais ser confirmado.');
    }
    if (e.interno.aprovacaoId) throw conflito('Este pedido precisa de aprovação.');
    const def = this.definicaoDe(e);
    const agora = agoraIso();

    if (e.canal !== 'teste') {
      const limite = this.ctx.gastos.verificar(e.usuarioId, e.caminho ?? 'api');
      if (!limite.permitido) {
        this.definirStatus(e, 'cancelada', { erro: 'limite' });
        this.atualizarBloco(e.mensagemCartaoId, (b) =>
          b.tipo === 'confirmacao' && b.execucaoId === e.id ? { ...b, estado: 'cancelado' } : b,
        );
        registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: 'Limite de gasto atingido', detalhe: limite.mensagem, estado: 'aviso' });
        this.postar(e.conversaId, {
          autor: 'copiloto',
          texto: `${limite.mensagem} Nada foi gravado.`,
          blocos: [
            {
              tipo: 'erro',
              execucaoId: e.id,
              titulo: 'Não posso executar agora',
              detalhe: 'Se for urgente, uma pessoa da equipe pode fazer por você.',
              acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
            },
          ],
        });
        return;
      }
    }

    const usuario = this.ctx.conversas.buscar(e.conversaId ?? '')?.usuarioNome ?? e.usuarioNome;
    this.atualizarBloco(e.mensagemCartaoId, (b) =>
      b.tipo === 'confirmacao' && b.execucaoId === e.id ? { ...b, estado: 'confirmado', confirmadoEm: agora } : b,
    );
    this.definirStatus(e, 'em_andamento', {
      confirmado_por: usuario,
      confirmado_em: agora,
      iniciado_em: agora,
      ip: ip ?? null,
    });
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'confirmacao',
      titulo: `Confirmado por ${usuario}`,
      detalhe: 'Tocou em “Confirmar e executar” no cartão',
      estado: 'ok',
    });
    const objeto = def.tituloConfirmacao.match(/^confirme\s+(.+)$/i)?.[1] ?? 'o pedido';
    this.postar(e.conversaId, {
      autor: 'sistema',
      texto: `Você confirmou ${primeiraMinuscula(objeto)} às ${fmt.hora(agora)}`,
      icone: 'check',
    });
    this.anotar(e, `A pessoa confirmou o cartão ${e.id} (${def.nome}). A execução começou; o resultado aparece para ela no chat.`);
    this.emSegundoPlano(e.id);
  }

  /** A pessoa tocou "Corrigir": o cartão fica marcado e o copiloto pergunta o que mudar. */
  async corrigir(execucaoId: string, usuarioId: string): Promise<void> {
    const e = this.obter(execucaoId);
    if (e.usuarioId !== usuarioId) throw semPermissao('Este cartão é de outra pessoa.');
    if (e.status !== 'aguardando_confirmacao') throw conflito('Este cartão não pode mais ser corrigido.');
    const def = this.definicaoDe(e);
    this.definirStatus(e, 'cancelada', { erro: 'corrigir' });
    this.atualizarBloco(e.mensagemCartaoId, (b) =>
      b.tipo === 'confirmacao' && b.execucaoId === e.id ? { ...b, estado: 'corrigir' } : b,
    );
    registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: 'A pessoa pediu para corrigir', estado: 'info' });
    this.postar(e.conversaId, {
      autor: 'copiloto',
      texto: 'Claro. O que você quer mudar? Pode escrever só o dado novo, por exemplo “o prazo é 45 dias”.',
    });
    this.anotar(
      e,
      `A pessoa tocou em “Corrigir” no cartão ${e.id} (${def.nome}) e o copiloto perguntou o que mudar. ` +
        `Dados do cartão: ${JSON.stringify(e.dados)}. Quando ela disser a correção, chame a ferramenta da tarefa de novo com todos os dados, já corrigidos.`,
    );
  }

  /** Cancela antes de executar (cartão ou aprovação) ou durante (entre etapas). */
  async cancelar(execucaoId: string, por: Ator): Promise<void> {
    const e = this.obter(execucaoId);
    if (por.tipo === 'usuario' && e.usuarioId !== por.id) throw semPermissao('Este pedido é de outra pessoa.');
    if (e.status === 'aguardando_confirmacao' || e.status === 'aguardando_aprovacao') {
      this.definirStatus(e, 'cancelada', { erro: 'cancelada' });
      this.ctx.banco.executar(
        "UPDATE aprovacoes SET estado = 'cancelada', decidido_em = ? WHERE execucao_id = ? AND estado IN ('rascunho','enviada')",
        agoraIso(),
        e.id,
      );
      this.atualizarBloco(e.mensagemCartaoId, (b) => {
        if (b.tipo === 'confirmacao' && b.execucaoId === e.id) return { ...b, estado: 'cancelado' };
        if (b.tipo === 'aprovacao' && b.execucaoId === e.id) return { ...b, estado: 'cancelada' };
        return b;
      });
      registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: `Cancelado por ${por.nome}`, estado: 'info' });
      this.postar(e.conversaId, { autor: 'copiloto', texto: 'Tudo bem, cancelei. Nada foi gravado.' });
      this.anotar(e, `O pedido ${e.id} (${e.tarefaNome}) foi cancelado antes de executar. Nada foi gravado.`);
      return;
    }
    if (e.status === 'em_andamento') {
      atualizarExecucao(this.ctx.banco, e.id, { cancelar: 1 });
      this.controles.get(e.id)?.abort();
      registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: `${por.nome} pediu para cancelar`, estado: 'aviso' });
      return;
    }
    throw conflito('Esta execução já terminou. Se já gravou, use Desfazer no recibo.');
  }

  /** Desfaz pelo recibo (dentro da janela) ou pelo console (Admin, a qualquer momento). */
  async desfazer(execucaoId: string, por: Ator): Promise<void> {
    const e = this.obter(execucaoId);
    if (por.tipo === 'usuario' && e.usuarioId !== por.id) throw semPermissao('Este pedido é de outra pessoa.');
    if (e.status === 'desfeita') return;
    if (e.status !== 'concluida') throw conflito('Só dá para desfazer uma execução concluída.');
    const def = this.definicaoDe(e);
    const desfazer = def.api?.desfazer;
    const id = e.resultado?.id;
    if (!desfazer || !id || e.interno.atualizarId || e.resultado?.simulado) {
      throw conflito('Esta tarefa não pode ser desfeita pelo copiloto. Peça a uma pessoa do suporte.');
    }
    if (por.tipo === 'usuario' && (!e.desfazerAte || e.desfazerAte < agoraIso())) {
      throw conflito('O prazo para desfazer acabou. Uma pessoa do suporte pode ajudar.');
    }
    const caminho = preencherCaminho(desfazer.caminho, def, e.dados, { id });
    let r: RespostaApi;
    try {
      r = await this.ctx.adaptador.chamar({
        metodo: desfazer.metodo,
        caminho,
        usuarioId: e.interno.executarComo ?? e.usuarioId,
        idempotencia: `${e.id}-desfazer`,
      });
    } catch {
      throw new ErroHttp(502, 'sistema_indisponivel', `O ${this.ctx.adaptador.nome} não respondeu. Tente desfazer de novo em instantes.`);
    }
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'api',
      titulo: 'Chamada para desfazer',
      estado: r.status < 300 ? 'ok' : 'falhou',
      dados: [
        { rotulo: 'Chamada', valor: `${desfazer.metodo} ${caminho}` },
        { rotulo: 'Resposta', valor: `${r.status} em ${r.duracaoMs} ms` },
      ],
    });
    if (r.status >= 300) {
      throw new ErroHttp(502, 'desfazer_recusado', `O ${this.ctx.adaptador.nome} não aceitou desfazer (erro ${r.status}). Peça a uma pessoa do suporte.`);
    }
    this.definirStatus(e, 'desfeita', { desfazer_ate: null });
    const titulo = e.resultado?.titulo ?? e.tarefaNome;
    registrarEvento(this.ctx.banco, e.id, { tipo: 'desfeito', titulo: `Desfeito por ${por.nome}`, detalhe: titulo, estado: 'info' });
    this.ctx.banco
      .todos<{ id: string }>("SELECT id FROM mensagens WHERE conversa_id = ? AND corpo LIKE '%\"recibo\"%'", e.conversaId ?? '')
      .forEach((m) =>
        this.atualizarBloco(m.id, (b) => (b.tipo === 'recibo' && b.execucaoId === e.id ? { ...b, desfeito: true, desfazerAte: undefined } : b)),
      );
    this.postar(e.conversaId, {
      autor: 'sistema',
      texto: por.tipo === 'usuario' ? `Você desfez: ${titulo}` : `${por.nome} desfez: ${titulo}`,
      icone: 'check',
    });
    this.anotar(e, `A execução ${e.id} (${titulo}) foi desfeita por ${por.nome}. O registro foi removido do sistema.`);
  }

  /** Tenta de novo uma execução que falhou. Devolve o id da nova execução. */
  async reexecutar(execucaoId: string, por: Ator): Promise<string> {
    const e = this.obter(execucaoId);
    if (por.tipo === 'usuario' && e.usuarioId !== por.id) throw semPermissao('Este pedido é de outra pessoa.');
    if (!['falhou', 'cancelada'].includes(e.status) || !e.confirmadoEm) {
      throw conflito('Só dá para tentar de novo uma execução confirmada que falhou ou foi cancelada no meio.');
    }
    const def = this.definicaoDe(e);
    if (e.canal !== 'teste') {
      const limite = this.ctx.gastos.verificar(e.usuarioId, e.caminho ?? 'api');
      if (!limite.permitido) throw new ErroHttp(429, 'limite', limite.mensagem);
    }
    const id = proximoIdExecucao(this.ctx.banco);
    const agora = agoraIso();
    const { aprovacaoId: _a, ...interno } = e.interno;
    this.ctx.banco.inserir('execucoes', {
      id,
      conversa_id: e.conversaId,
      usuario_id: e.usuarioId,
      usuario_nome: e.usuarioNome,
      tarefa_id: e.tarefaId,
      tarefa_nome: e.tarefaNome,
      tarefa_versao: e.tarefaVersao,
      pedido: e.pedido,
      caminho: def.caminho === 'api' && def.api ? 'api' : 'navegador',
      status: 'em_andamento',
      canal: e.canal,
      dados: e.dados,
      interno: { ...interno, reserva: false, origem: e.id },
      criado_em: agora,
      iniciado_em: agora,
      confirmado_por: e.confirmadoPor,
      confirmado_em: e.confirmadoEm,
    });
    registrarEvento(this.ctx.banco, id, {
      tipo: 'pedido',
      titulo: `Nova tentativa de ${e.id}`,
      detalhe: `Pedida por ${por.nome}. Mesmos dados confirmados antes.`,
      estado: 'info',
      dados: camposExibidos(def, e.dados).map((c) => ({ rotulo: c.rotulo, valor: c.valor })),
    });
    registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: `Nova tentativa: ${id}`, detalhe: `Pedida por ${por.nome}`, estado: 'info' });
    const nova = this.obter(id);
    this.avisarConsole(nova);
    this.emSegundoPlano(id, por.tipo === 'usuario' ? 'Combinado, vou tentar de novo' : `${por.nome}, da equipe, pediu para tentar de novo`);
    return id;
  }

  /** Marca como concluída à mão (caso resolvido por uma pessoa fora do copiloto). */
  async concluirManual(execucaoId: string, por: Ator, nota?: string): Promise<void> {
    const e = this.obter(execucaoId);
    if (['concluida', 'desfeita'].includes(e.status)) throw conflito('Esta execução já está concluída.');
    const agora = agoraIso();
    const diagnostico: Diagnostico = {
      titulo: 'Concluída por uma pessoa da equipe',
      detalhe: `${por.nome} marcou como concluída${nota ? `: ${nota}` : '.'}`,
      tom: 'sucesso',
    };
    this.definirStatus(e, 'concluida', { concluido_em: agora, diagnostico });
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'conclusao',
      titulo: `Marcada como concluída por ${por.nome}`,
      detalhe: nota,
      estado: 'ok',
    });
    this.postar(e.conversaId, {
      autor: 'sistema',
      texto: `${por.nome} concluiu seu pedido: ${e.tarefaNome}`,
      icone: 'check',
    });
    this.anotar(e, `${por.nome}, da equipe, marcou o pedido ${e.id} (${e.tarefaNome}) como concluído${nota ? `: ${nota}` : ''}.`);
  }

  /** Conflito: "Atualizar o existente com os dados novos" (nova confirmação). */
  async atualizarExistente(execucaoId: string, usuarioId: string): Promise<void> {
    const e = this.obter(execucaoId);
    if (e.usuarioId !== usuarioId) throw semPermissao('Este pedido é de outra pessoa.');
    const existente = e.interno.existente;
    if (!existente || existente.id === undefined) throw conflito('Não há cadastro existente para atualizar.');
    const def = this.definicaoDe(e);
    const conversa = e.conversaId ? this.ctx.conversas.buscar(e.conversaId) : null;
    if (!conversa) throw naoEncontrado('Conversa');
    const usuarios = await this.ctx.adaptador.listarUsuarios().catch(() => [] as UsuarioSistema[]);
    const muda = diferencas(def, existente, e.dados, usuarios);
    const titulo = tituloDoRegistro(existente);
    const codigo = codigoDoRegistro(existente) ?? '';
    if (muda.length === 0) {
      this.postar(conversa.id, {
        autor: 'copiloto',
        texto: `O cadastro ${titulo} (${codigo}) já tem esses dados. Não há nada para atualizar.`,
      });
      return;
    }
    const usuario = (await this.ctx.adaptador.buscarUsuario(usuarioId).catch(() => null)) ?? {
      id: usuarioId,
      nome: e.usuarioNome,
      email: '',
      perfis: [],
    };
    this.substituirPendentes(conversa.id);
    const valores: Record<string, string> = {};
    for (const d of muda) valores[d.campo.chave] = d.depois;
    const nova = this.inserir({
      conversa,
      usuario,
      tarefa: { id: e.tarefaId!, versao: e.tarefaVersao!, definicao: def },
      valores: { ...e.dados },
      pedido: `Atualizar ${titulo} (${codigo}) com os dados novos`,
      interno: { atualizarId: String(existente.id), existente, origem: e.id },
    });
    const bloco = this.cartaoDe(nova, def, {
      titulo: 'Confirme a atualização',
      tarefa: `Atualizar ${titulo} (${codigo})`,
      campos: muda.map((d) => ({ rotulo: d.campo.rotulo, valor: `${d.depois} (antes: ${d.antes || 'vazio'})` })),
      desfazerMinutos: 0,
      tempoEstimado: 'cerca de 3 s',
    });
    const msg = this.postar(conversa.id, {
      autor: 'copiloto',
      texto: `Certo. Isto é o que muda no cadastro ${codigo}. Confira antes de eu gravar:`,
      blocos: [bloco],
      nota: 'Só gravo depois que você confirmar.',
    });
    if (msg) this.ligarMensagem([nova.id], msg.id);
  }

  /** Envia o pedido de aprovação ao aprovador (W7). */
  async enviarAprovacao(aprovacaoId: string, usuarioId: string): Promise<void> {
    const a = this.aprovacao(aprovacaoId);
    if (a.solicitante_id !== usuarioId) throw semPermissao('Este pedido é de outra pessoa.');
    if (a.estado === 'enviada') return;
    if (a.estado !== 'rascunho') throw conflito('Este pedido de aprovação não pode mais ser enviado.');
    const e = this.obter(a.execucao_id);
    const agora = agoraIso();
    this.ctx.banco.atualizar('aprovacoes', aprovacaoId, { estado: 'enviada', criado_em: agora });
    this.definirStatus(e, 'aguardando_aprovacao');
    this.atualizarBloco(a.mensagem_id, (b) => (b.tipo === 'aprovacao' && b.aprovacaoId === aprovacaoId ? { ...b, estado: 'enviada' } : b));
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'aviso',
      titulo: `Aprovação pedida a ${a.aprovador_nome}`,
      detalhe: `${a.solicitante_nome} não tem o perfil ${a.perfil_necessario}.`,
      estado: 'aviso',
    });
    this.ctx.eventos.emitirConsole({ tipo: 'aprovacao', aprovacaoId, estado: 'enviada' });
    this.postar(e.conversaId, { autor: 'sistema', texto: 'Aguardando aprovação', icone: 'relogio' });
    this.postar(e.conversaId, {
      autor: 'copiloto',
      texto: `Pedido de aprovação enviado a ${a.aprovador_nome}. Aviso você aqui quando ${a.aprovador_nome?.split(' ')[0] ?? 'a pessoa'} responder.`,
      nota: 'Nada muda até lá.',
    });
    this.anotar(e, `A pessoa enviou o pedido de aprovação ${e.id} a ${a.aprovador_nome}. Ainda não foi decidido.`);
  }

  /** Aprovador decide (pelo console). Aprovado: executa com a permissão do aprovador. */
  async decidirAprovacao(aprovacaoId: string, por: Ator, aprovado: boolean, motivo?: string): Promise<void> {
    const a = this.aprovacao(aprovacaoId);
    if (a.estado !== 'enviada') throw conflito('Este pedido de aprovação já foi decidido ou cancelado.');
    const e = this.obter(a.execucao_id);
    const agora = agoraIso();
    this.ctx.banco.atualizar('aprovacoes', aprovacaoId, {
      estado: aprovado ? 'aprovada' : 'recusada',
      motivo: motivo ?? null,
      decidido_em: agora,
      decidido_por: por.nome,
    });
    this.atualizarBloco(a.mensagem_id, (b) =>
      b.tipo === 'aprovacao' && b.aprovacaoId === aprovacaoId
        ? { ...b, estado: aprovado ? 'aprovada' : 'recusada', motivoRecusa: aprovado ? undefined : motivo }
        : b,
    );
    this.ctx.eventos.emitirConsole({ tipo: 'aprovacao', aprovacaoId, estado: aprovado ? 'aprovada' : 'recusada' });
    if (!aprovado) {
      this.definirStatus(e, 'cancelada', {
        erro: 'recusada',
        diagnostico: { titulo: 'Aprovação recusada', detalhe: `${por.nome} recusou${motivo ? `: ${motivo}` : '.'}`, tom: 'info' },
      });
      registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: `Recusado por ${por.nome}`, detalhe: motivo, estado: 'info' });
      this.postar(e.conversaId, {
        autor: 'copiloto',
        texto: `${por.nome} recusou o pedido${motivo ? `: “${motivo}”` : '.'} Nada foi alterado.`,
      });
      this.anotar(e, `${por.nome} recusou o pedido de aprovação ${e.id}${motivo ? ` (motivo: ${motivo})` : ''}. Nada foi alterado.`);
      return;
    }
    atualizarExecucao(this.ctx.banco, e.id, {
      interno: { ...e.interno, executarComo: a.aprovador_id ?? undefined },
      confirmado_por: a.solicitante_nome,
      confirmado_em: agora,
      iniciado_em: agora,
    });
    this.definirStatus(e, 'em_andamento');
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'confirmacao',
      titulo: `Aprovado por ${por.nome}`,
      detalhe: `Executado com a permissão de ${a.aprovador_nome}`,
      estado: 'ok',
    });
    this.postar(e.conversaId, { autor: 'sistema', texto: `${por.nome} aprovou seu pedido`, icone: 'check' });
    this.anotar(e, `${por.nome} aprovou o pedido ${e.id}; a execução começou.`);
    this.emSegundoPlano(e.id, 'Aprovado! Vou fazer agora');
  }

  private aprovacao(id: string) {
    const a = this.ctx.banco.um<{
      id: string;
      execucao_id: string;
      solicitante_id: string;
      solicitante_nome: string;
      aprovador_id: string | null;
      aprovador_nome: string | null;
      perfil_necessario: string | null;
      estado: string;
      mensagem_id: string | null;
    }>('SELECT * FROM aprovacoes WHERE id = ?', id);
    if (!a) throw naoEncontrado('Pedido de aprovação');
    return a;
  }

  // ---------------------------------------------------------------- execução

  private emSegundoPlano(id: string, abertura?: string) {
    const p = this.executar(id, abertura).finally(() => this.emCurso.delete(p));
    this.emCurso.add(p);
  }

  private async executar(id: string, abertura?: string): Promise<void> {
    const e = this.obter(id);
    const controle = new AbortController();
    this.controles.set(id, controle);
    try {
      const def = this.definicaoDe(e);
      if (e.caminho === 'api' && def.api) await this.executarApi(e, def, abertura);
      else await this.executarNavegador(e, def, abertura);
    } catch (erro) {
      if (!(erro instanceof Encerrada)) this.falhaInesperada(e, erro);
    } finally {
      this.controles.delete(id);
    }
  }

  private cancelada(e: Execucao): boolean {
    return this.ctx.banco.um<{ c: number }>('SELECT cancelar AS c FROM execucoes WHERE id = ?', e.id)?.c === 1;
  }

  private sistema() {
    return this.ctx.adaptador.nome;
  }

  /** Mensagem "Combinado..." com o cartão de progresso (W4). */
  private iniciarProgresso(e: Execucao, def: TarefaDefinicao, caminho: Caminho, etapas: EtapaProgresso[], abertura?: string): Progresso {
    const titulo = fmt.preencherModelo(def.tituloProgresso ?? def.nome, e.dados);
    const bloco: BlocoProgresso = {
      tipo: 'progresso',
      execucaoId: e.id,
      titulo: e.interno.atualizarId ? `Atualizando ${tituloDoRegistro(e.interno.existente ?? {})}` : titulo,
      caminho,
      etapas,
      percentual: 0,
      podeCancelar: true,
      status: 'em_andamento',
    };
    const via = caminho === 'api' ? `pela API do ${this.sistema()}` : `pela tela do ${this.sistema()}`;
    if (e.mensagemProgressoId) {
      const p = new Progresso(this, e.id, e.mensagemProgressoId, bloco);
      p.detalhe(0, etapas[0]?.detalhe ?? '');
      return p;
    }
    const acao = def.tituloProgresso ? `Estou ${primeiraMinuscula(titulo)} ${via}.` : `Estou cuidando disso ${via}.`;
    const texto = abertura ? `${abertura}. ${acao}` : `Combinado. ${acao}`;
    const msg = this.postar(e.conversaId, {
      autor: 'copiloto',
      texto,
      blocos: [bloco],
      nota: 'Pode fechar esta janela. Eu aviso quando terminar.',
    });
    if (msg) {
      atualizarExecucao(this.ctx.banco, e.id, { mensagem_progresso_id: msg.id });
      e.mensagemProgressoId = msg.id;
    }
    const p = new Progresso(this, e.id, msg?.id ?? null, bloco);
    return p;
  }

  /** Chamada ao sistema com 2 tentativas extras quando ele não responde. null = sistema fora. */
  private async chamarComRetentativa(
    e: Execucao,
    chamada: ChamadaApi,
    progresso: Progresso,
    etapaIdx: number,
  ): Promise<RespostaApi | null> {
    const total = 1 + this.esperasRetentativaMs.length;
    for (let tentativa = 1; tentativa <= total; tentativa++) {
      let r: RespostaApi | null = null;
      let motivo = '';
      try {
        r = await this.ctx.adaptador.chamar(chamada);
        if (r.status < 500) return r;
        motivo = `erro ${r.status}`;
      } catch (erro) {
        motivo = erro instanceof ErroConexaoSistema ? 'sem resposta' : 'falha de rede';
      }
      registrarEvento(this.ctx.banco, e.id, {
        tipo: 'api',
        titulo: `${this.sistema()} não respondeu (${motivo})`,
        detalhe: `Tentativa ${tentativa} de ${total}`,
        estado: 'falhou',
        dados: [{ rotulo: 'Chamada', valor: `${chamada.metodo} ${chamada.caminho}` }],
      });
      if (tentativa < total) {
        progresso.detalhe(etapaIdx, `O ${this.sistema()} não respondeu. Tentando de novo (${tentativa + 1} de ${total})…`);
        await new Promise((r) => setTimeout(r, this.esperasRetentativaMs[tentativa - 1]));
      }
    }
    return null;
  }

  private async executarApi(e: Execucao, def: TarefaDefinicao, abertura?: string): Promise<void> {
    const api = def.api!;
    const teste = e.canal === 'teste';
    const atualizarId = e.interno.atualizarId;
    const comoUsuario = e.interno.executarComo ?? e.usuarioId;
    const usuarios = await this.ctx.adaptador.listarUsuarios().catch(() => [] as UsuarioSistema[]);
    const conferidos = def.campos.filter((c) => ['documento', 'email'].includes(c.tipo) && e.dados[c.chave]);

    const etapas: EtapaProgresso[] = [etapa('Validando dados')];
    const idxVerificar = api.verificarAntes && !atualizarId ? etapas.push(etapa(api.verificarAntes.descricao)) - 1 : -1;
    const idxGravar =
      etapas.push(
        etapa(atualizarId ? 'Atualizando o cadastro' : (api.rotuloExecucao ?? `Gravando no ${this.sistema()}`), `Enviando para o ${this.sistema()}`),
      ) - 1;
    const idxConferir = api.conferirDepois && !teste ? etapas.push(etapa(api.conferirDepois.descricao, 'Vou abrir o registro e checar os dados')) - 1 : -1;
    const progresso = this.iniciarProgresso(e, def, 'api', etapas, abertura);

    // 1. Validar de novo (a ficha pode ter mudado).
    progresso.iniciar(0);
    const solicitante = { id: e.usuarioId, nome: e.usuarioNome };
    const v = validarTarefa(def.campos, e.dados, solicitante);
    if (!v.completo) {
      const problema = v.invalidos[0]?.erro ?? `Falta ${v.faltando[0]?.rotulo.toLowerCase()}.`;
      progresso.falhar(0, problema);
      this.falhar(e, progresso, {
        erro: 'validacao',
        titulo: 'Os dados não passaram na validação',
        detalhe: `${problema} Nada foi gravado.`,
        diagnostico: { titulo: 'Dados inválidos', detalhe: problema, tom: 'erro' },
        acoes: [{ rotulo: 'Corrigir os dados', acao: 'mensagem', mensagem: 'Quero corrigir os dados', estilo: 'primario' }],
      });
      return;
    }
    progresso.concluir(
      0,
      conferidos.length ? `${conferidos.map((c) => c.rotulo).join(' e ')} conferidos` : 'Dados conferidos',
    );

    // 2. Já existe?
    if (idxVerificar >= 0 && api.verificarAntes) {
      progresso.iniciar(idxVerificar);
      const caminho = preencherCaminho(api.verificarAntes.caminho, def, e.dados);
      const r = await this.chamarComRetentativa(e, { metodo: 'GET', caminho, usuarioId: comoUsuario }, progresso, idxVerificar);
      if (!r) return this.sistemaFora(e, def, progresso, idxVerificar);
      registrarEvento(this.ctx.banco, e.id, {
        tipo: 'api',
        titulo: api.verificarAntes.descricao,
        estado: 'ok',
        dados: [
          { rotulo: 'Chamada', valor: `GET ${caminho}` },
          { rotulo: 'Resposta', valor: `${r.status} em ${r.duracaoMs} ms` },
        ],
      });
      const existente = existenteDe(r.status, r.corpo);
      if (existente) return this.conflito(e, def, existente, progresso, idxVerificar, usuarios);
      progresso.concluir(idxVerificar, api.verificarAntes.detalheOk);
    }

    // 3. Gravar.
    if (this.cancelada(e)) return this.encerrarCancelada(e, progresso);
    progresso.iniciar(idxGravar);
    progresso.semCancelar();
    const somente = atualizarId ? diferencas(def, e.interno.existente ?? {}, e.dados, usuarios).map((d) => d.campo.chave) : undefined;
    const corpo = montarCorpo(def, e.dados, usuarios, somente);
    const chamada: ChamadaApi = {
      metodo: atualizarId ? 'PATCH' : api.metodo,
      caminho: atualizarId
        ? `${preencherCaminho(api.caminho, def, e.dados).replace(/\/$/, '')}/${encodeURIComponent(atualizarId)}`
        : preencherCaminho(api.caminho, def, e.dados),
      corpo,
      usuarioId: comoUsuario,
      idempotencia: e.id,
      simulacao: teste,
    };
    const r = await this.chamarComRetentativa(e, chamada, progresso, idxGravar);
    if (!r) {
      if (def.usarFluxoSeApiFalhar && def.fluxoId && !atualizarId) {
        registrarEvento(this.ctx.banco, e.id, {
          tipo: 'aviso',
          titulo: 'A API não respondeu; seguindo pelo fluxo gravado na tela',
          estado: 'aviso',
        });
        progresso.falhar(idxGravar, `A API não respondeu. Vou pela tela do ${this.sistema()}.`);
        atualizarExecucao(this.ctx.banco, e.id, { caminho: 'navegador', interno: { ...e.interno, reserva: true } });
        e.caminho = 'navegador';
        e.interno.reserva = true;
        e.mensagemProgressoId = null;
        return this.executarNavegador(e, def, 'A API não respondeu, então');
      }
      return this.sistemaFora(e, def, progresso, idxGravar);
    }
    const corpoResposta = (r.corpo ?? {}) as Record<string, unknown>;
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'api',
      titulo: etapas[idxGravar].titulo,
      estado: r.status < 300 ? 'ok' : 'falhou',
      dados: [
        { rotulo: 'Chamada', valor: `${chamada.metodo} ${chamada.caminho}` },
        { rotulo: 'Resposta', valor: `${r.status} em ${r.duracaoMs} ms` },
        ...(teste ? [{ rotulo: 'Modo de teste', valor: 'validado, nada gravado' }] : []),
      ],
    });
    if (r.status === 409 && corpoResposta.existente && typeof corpoResposta.existente === 'object') {
      return this.conflito(e, def, corpoResposta.existente as Record<string, unknown>, progresso, idxGravar, usuarios);
    }
    if (r.status === 403) {
      const perfil = typeof corpoResposta.perfil_necessario === 'string' ? corpoResposta.perfil_necessario : null;
      progresso.falhar(idxGravar, 'Acesso recusado');
      return this.falhar(e, progresso, {
        erro: 'sem_permissao',
        titulo: `O ${this.sistema()} recusou por falta de permissão`,
        detalhe: `${perfil ? `É preciso o perfil ${perfil}. ` : ''}Nada foi gravado.`,
        diagnostico: {
          titulo: 'Sem permissão no sistema',
          detalhe: `O ${this.sistema()} respondeu 403${perfil ? ` (perfil necessário: ${perfil})` : ''}.`,
          tom: 'erro',
        },
        acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
      });
    }
    if (r.status === 422 || r.status === 400) {
      const campos = (corpoResposta.campos ?? {}) as Record<string, string>;
      const lista = Object.entries(campos).map(([k, msg]) => {
        const m = api.mapeamento.find((x) => x.destino === k);
        const campo = def.campos.find((c) => c.chave === (m?.campo ?? k));
        return `${campo?.rotulo ?? k}: ${msg}`;
      });
      const detalhe = lista.length ? lista.join('; ') : String(corpoResposta.mensagem ?? 'dados recusados');
      progresso.falhar(idxGravar, 'Dados recusados');
      return this.falhar(e, progresso, {
        erro: 'validacao_sistema',
        titulo: `O ${this.sistema()} recusou alguns dados`,
        detalhe: `${detalhe}. Nada foi gravado.`,
        diagnostico: { titulo: 'Dados recusados pelo sistema', detalhe, tom: 'erro' },
        acoes: [
          { rotulo: 'Corrigir os dados', acao: 'mensagem', mensagem: 'Quero corrigir os dados', estilo: 'primario' },
          { rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'fantasma' },
        ],
      });
    }
    if (r.status >= 300) {
      progresso.falhar(idxGravar, `Erro ${r.status}`);
      return this.falhar(e, progresso, {
        erro: `http_${r.status}`,
        titulo: `O ${this.sistema()} não aceitou o pedido`,
        detalhe: `${String(corpoResposta.mensagem ?? `Erro ${r.status}`)}. Nada foi gravado.`,
        diagnostico: { titulo: `Erro ${r.status} do sistema`, detalhe: String(corpoResposta.mensagem ?? ''), tom: 'erro' },
        acoes: [
          { rotulo: 'Tentar de novo', acao: 'tentar', estilo: 'primario' },
          { rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'fantasma' },
        ],
      });
    }
    const idCriado = atualizarId ?? (api.idRetorno && corpoResposta[api.idRetorno] !== undefined ? String(corpoResposta[api.idRetorno]) : undefined);
    progresso.concluir(idxGravar, teste ? `Validado pelo ${this.sistema()}; nada gravado (modo de teste)` : `Gravado no ${this.sistema()}`);

    // 4. Conferir.
    if (idxConferir >= 0 && api.conferirDepois) {
      progresso.iniciar(idxConferir);
      const caminho = preencherCaminho(api.conferirDepois.caminho, def, e.dados, { id: idCriado ?? '' });
      let ok = false;
      try {
        const r2 = await this.ctx.adaptador.chamar({ metodo: 'GET', caminho, usuarioId: comoUsuario });
        ok = r2.status === 200;
        registrarEvento(this.ctx.banco, e.id, {
          tipo: 'api',
          titulo: api.conferirDepois.descricao,
          estado: ok ? 'ok' : 'aviso',
          dados: [
            { rotulo: 'Chamada', valor: `GET ${caminho}` },
            { rotulo: 'Resposta', valor: `${r2.status} em ${r2.duracaoMs} ms` },
          ],
        });
      } catch {
        ok = false;
      }
      progresso.concluir(idxConferir, ok ? (api.conferirDepois.detalheOk ?? 'Tudo certo') : 'Não consegui conferir agora, mas a gravação foi aceita');
    }

    const arquivos = teste ? [] : await this.baixarArquivos(e, corpoResposta, comoUsuario);
    await this.concluir(e, def, progresso, {
      id: idCriado,
      resposta: escalares(corpoResposta),
      arquivos,
      simulado: teste,
      caminho: 'api',
    });
  }

  /** Arquivos que a API devolveu como link (campos *_url): o copiloto baixa e entrega por um link assinado. */
  private async baixarArquivos(
    e: Execucao,
    corpo: Record<string, unknown>,
    usuarioId: string,
  ): Promise<{ nome: string; tipo: string; rotulo?: string }[]> {
    const adaptador = this.ctx.adaptador;
    if (!adaptador.baixarArquivo) return [];
    const saida: { nome: string; tipo: string; rotulo?: string }[] = [];
    for (const [chave, valor] of Object.entries(corpo)) {
      if (!/(^|_)url$/.test(chave) || typeof valor !== 'string' || !valor) continue;
      const a = await adaptador.baixarArquivo(valor, usuarioId).catch(() => null);
      if (!a) continue;
      const nome = path.basename(a.nome).replace(/[^\w.\- ]+/g, '_') || 'arquivo';
      const dir = path.join(this.ctx.config.dirDados, 'arquivos', path.basename(e.id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, nome), a.conteudo);
      const ext = path.extname(nome).toLowerCase();
      saida.push({ nome, tipo: a.tipo, rotulo: ext === '.pdf' ? 'PDF' : ext === '.csv' || ext === '.xlsx' ? 'planilha' : nome });
    }
    return saida;
  }

  private async conflito(
    e: Execucao,
    def: TarefaDefinicao,
    existente: Record<string, unknown>,
    progresso: Progresso,
    idx: number,
    usuarios: UsuarioSistema[],
  ): Promise<void> {
    const campoChave = def.campos.find((c) => c.verificarExistente) ?? def.campos.find((c) => c.tipo === 'documento');
    const valorChave = campoChave ? fmt.valorCampo(campoChave, e.dados[campoChave.chave] ?? '') : '';
    const titulo = tituloDoRegistro(existente);
    const codigo = codigoDoRegistro(existente);
    const url =
      def.api?.linkResultado && existente.id !== undefined
        ? this.urlSistema(fmt.preencherModelo(def.api.linkResultado, { ...e.dados, id: String(existente.id) }))
        : undefined;
    progresso.falhar(idx, campoChave ? `Já existe um cadastro com este ${campoChave.rotulo}` : 'Já existe um cadastro igual');
    progresso.finalizar('falhou');
    const motivo = campoChave
      ? `já existe um cadastro com o ${campoChave.rotulo} ${valorChave}`
      : 'já existe um cadastro com esses dados';
    const diagnostico: Diagnostico = {
      titulo: 'Cadastro já existia',
      detalhe: `O ${this.sistema()} recusou porque ${motivo} (${titulo}${codigo ? ` ${codigo}` : ''}). Nada novo foi gravado.`,
      tom: 'aviso',
    };
    atualizarExecucao(this.ctx.banco, e.id, {
      status: 'falhou',
      erro: 'conflito',
      diagnostico,
      concluido_em: agoraIso(),
      duracao_ms: e.iniciadoEm ? Date.now() - Date.parse(e.iniciadoEm) : null,
      interno: { ...e.interno, existente },
      resultado: { existente: { titulo, codigo } } satisfies ResultadoExecucao,
    });
    this.avisarConsole(e, 'falhou');
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'falha',
      titulo: 'Recusado: cadastro já existe',
      detalhe: diagnostico.detalhe,
      estado: 'aviso',
    });
    const podeAtualizar = def.api?.metodo === 'POST' && existente.id !== undefined;
    const acoes: AcaoBloco[] = [];
    if (url) acoes.push({ rotulo: 'Abrir cadastro existente', acao: 'abrir', url, estilo: 'secundario' });
    if (podeAtualizar) acoes.push({ rotulo: 'Atualizar o existente com os dados novos', acao: 'atualizar', estilo: 'primario' });
    acoes.push({ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'fantasma' });
    this.postar(e.conversaId, {
      autor: 'copiloto',
      // A pergunta "Como prefere seguir?" fica no cartão de conflito, embaixo das opções (W6).
      texto: `Não consegui ${infinitivo(def.api?.rotuloExecucao)}. O ${this.sistema()} recusou porque **${motivo}**. Nada novo foi gravado.`,
      blocos: [
        {
          tipo: 'conflito',
          execucaoId: e.id,
          existente: { titulo, codigo, campos: camposDoRegistro(def, existente, usuarios), url },
          acoes,
        },
      ],
      nota: e.id,
    });
    this.anotar(
      e,
      `A execução ${e.id} (${def.nome}) foi recusada pelo sistema: ${motivo} (${titulo} ${codigo ?? ''}). Nada foi gravado. ` +
        'A pessoa recebeu as opções: abrir o existente, atualizar o existente com os dados novos ou falar com uma pessoa.',
    );
  }

  private sistemaFora(e: Execucao, def: TarefaDefinicao, progresso: Progresso, idx: number): void {
    progresso.falhar(idx, `O ${this.sistema()} não respondeu`);
    const ref = codigoRef();
    this.falhar(e, progresso, {
      erro: 'sistema_indisponivel',
      titulo: `O ${this.sistema()} não respondeu`,
      detalhe: 'Tentei 3 vezes e nada foi gravado. Aviso você aqui quando ele voltar.',
      codigo: ref,
      diagnostico: {
        titulo: `${this.sistema()} fora do ar`,
        detalhe: `A API não respondeu em 3 tentativas (${def.usarFluxoSeApiFalhar && def.fluxoId ? 'e a tarefa não pôde seguir pela tela' : 'a tarefa não tem caminho reserva pela tela'}). Nada foi gravado.`,
        tom: 'erro',
      },
      acoes: [
        { rotulo: 'Tentar de novo', acao: 'tentar', estilo: 'primario' },
        { rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'fantasma' },
      ],
    });
    this.vigiarVolta(e);
  }

  /** "Tenta 2 vezes e avisa quando voltar": confere o sistema de tempos em tempos por até 30 min. */
  private vigiarVolta(e: Execucao) {
    if (!e.conversaId || this.vigias.has(e.conversaId)) return;
    const conversaId = e.conversaId;
    let rodadas = 0;
    const max = Math.max(1, Math.round(30 * 60_000 / this.intervaloVoltaMs));
    const t = setInterval(async () => {
      rodadas++;
      const r = await this.ctx.adaptador.verificarConexao().catch(() => ({ ok: false, detalhe: '' }));
      if (r.ok) {
        clearInterval(t);
        this.vigias.delete(conversaId);
        this.postar(conversaId, {
          autor: 'copiloto',
          texto: `O ${this.sistema()} voltou a responder. Se quiser, toque em “Tentar de novo” no aviso acima.`,
        });
      } else if (rodadas >= max) {
        clearInterval(t);
        this.vigias.delete(conversaId);
      }
    }, this.intervaloVoltaMs);
    t.unref();
    this.vigias.set(conversaId, t);
  }

  private falhar(
    e: Execucao,
    progresso: Progresso | null,
    p: {
      erro: string;
      titulo: string;
      detalhe: string;
      diagnostico: Diagnostico;
      acoes: AcaoBloco[];
      codigo?: string;
      texto?: string;
    },
  ): void {
    progresso?.finalizar('falhou');
    atualizarExecucao(this.ctx.banco, e.id, {
      status: 'falhou',
      erro: p.erro,
      diagnostico: p.diagnostico,
      concluido_em: agoraIso(),
      duracao_ms: e.iniciadoEm ? Date.now() - Date.parse(e.iniciadoEm) : null,
      custo_modelo: this.custoModelo(e),
    });
    this.avisarConsole(e, 'falhou');
    registrarEvento(this.ctx.banco, e.id, { tipo: 'falha', titulo: p.diagnostico.titulo, detalhe: p.diagnostico.detalhe, estado: 'falhou' });
    this.postar(e.conversaId, {
      autor: 'copiloto',
      texto: p.texto,
      blocos: [{ tipo: 'erro', execucaoId: e.id, titulo: p.titulo, detalhe: p.detalhe, codigo: p.codigo, acoes: p.acoes }],
      nota: e.id,
    });
    this.anotar(e, `A execução ${e.id} (${e.tarefaNome}) falhou: ${p.titulo}. ${p.detalhe}`);
  }

  private falhaInesperada(e: Execucao, erro: unknown) {
    const ref = codigoRef();
    console.error(`[${ref}] falha na execução ${e.id}:`, erro);
    try {
      const atual = this.obter(e.id);
      if (atual.status !== 'em_andamento') return;
      const prog = atual.mensagemProgressoId
        ? new Progresso(this, e.id, atual.mensagemProgressoId, this.blocoProgresso(atual.mensagemProgressoId, e.id))
        : null;
      this.falhar(atual, prog?.bloco ? prog : null, {
        erro: 'interno',
        titulo: 'Algo deu errado do nosso lado',
        detalhe: 'Parei antes de terminar. Informe o código ao suporte se precisar.',
        codigo: ref,
        diagnostico: { titulo: 'Erro interno do copiloto', detalhe: `Código ${ref}. ${erro instanceof Error ? erro.message : ''}`, tom: 'erro' },
        acoes: [
          { rotulo: 'Tentar de novo', acao: 'tentar', estilo: 'primario' },
          { rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'fantasma' },
        ],
      });
    } catch (e2) {
      console.error(`[${ref}] também falhou ao registrar a falha:`, e2);
    }
  }

  private blocoProgresso(mensagemId: string, execucaoId: string): BlocoProgresso {
    const m = this.ctx.conversas.mensagem(mensagemId);
    const b = m?.blocos.find((x) => x.tipo === 'progresso' && x.execucaoId === execucaoId) as BlocoProgresso | undefined;
    return b ?? { tipo: 'progresso', execucaoId, titulo: '', caminho: 'api', etapas: [], percentual: 0, podeCancelar: false, status: 'em_andamento' };
  }

  private encerrarCancelada(e: Execucao, progresso: Progresso): void {
    progresso.finalizar('cancelada');
    this.definirStatus(e, 'cancelada', { erro: 'cancelada', concluido_em: agoraIso() });
    registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: 'Cancelada antes de gravar', estado: 'info' });
    this.postar(e.conversaId, { autor: 'copiloto', texto: 'Cancelei antes de gravar. Nada foi salvo.' });
    this.anotar(e, `A execução ${e.id} foi cancelada pela pessoa antes de gravar.`);
  }

  private lerFluxo(id: string): Fluxo | null {
    const l = this.ctx.banco.um<Record<string, unknown>>('SELECT * FROM fluxos WHERE id = ?', id);
    if (!l) return null;
    return {
      id: String(l.id),
      nome: String(l.nome),
      tarefaId: (l.tarefa_id as string | null) ?? null,
      etapa: l.etapa as Fluxo['etapa'],
      status: l.status as Fluxo['status'],
      versao: Number(l.versao),
      passos: json(l.passos, []),
      camposSugeridos: json(l.campos_sugeridos, []),
      gravadoPor: (l.gravado_por as string | null) ?? null,
      gravadoEm: (l.gravado_em as string | null) ?? null,
      duracaoGravacaoMs: (l.duracao_gravacao_ms as number | null) ?? null,
      urlInicial: (l.url_inicial as string | null) ?? null,
      resultado: json(l.resultado, null),
      ultimoTeste: json(l.ultimo_teste, null),
      salvoEm: String(l.salvo_em),
    };
  }

  private async executarNavegador(e: Execucao, def: TarefaDefinicao, abertura?: string): Promise<void> {
    const teste = e.canal === 'teste';
    const fluxo = def.fluxoId ? this.lerFluxo(def.fluxoId) : null;
    const primeiro = e.usuarioNome.split(' ')[0];
    if (!fluxo || (!teste && fluxo.status !== 'publicado') || fluxo.passos.length === 0) {
      return this.falhar(e, null, {
        erro: 'fluxo_indisponivel',
        titulo: 'Esta tarefa ainda não está pronta para rodar pela tela',
        detalhe: 'O fluxo gravado não está publicado. Nada foi gravado.',
        diagnostico: { titulo: 'Fluxo não publicado', detalhe: 'A tarefa usa o caminho navegador, mas o fluxo dela não está publicado.', tom: 'erro' },
        acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
      });
    }
    const visiveis = fluxo.passos.filter((p) => p.tipo !== 'esperar');
    const indice = new Map<number, number>();
    visiveis.forEach((p, i) => indice.set(p.n, i + 1));
    const etapas = [etapa(`Entrando no ${this.sistema()} como ${primeiro}`), ...visiveis.map((p) => etapa(p.titulo))];
    const progresso = this.iniciarProgresso(e, def, 'navegador', etapas, abertura);

    if (teste) {
      // Modo de teste: o navegador não abre (nada pode ser gravado); as etapas são simuladas.
      for (let i = 0; i < etapas.length; i++) {
        if (this.cancelada(e)) return this.encerrarCancelada(e, progresso);
        progresso.iniciar(i);
        await new Promise((r) => setTimeout(r, this.atrasoSimuladoMs));
        progresso.concluir(i, i === 0 ? 'Simulado (modo de teste)' : undefined);
      }
      registrarEvento(this.ctx.banco, e.id, { tipo: 'passo', titulo: 'Fluxo simulado no modo de teste', estado: 'info' });
      return this.concluir(e, def, progresso, { simulado: true, caminho: 'navegador' });
    }

    const controle = this.controles.get(e.id) ?? new AbortController();
    const seguranca = this.ctx.configuracoes.ler('seguranca');
    const inicio = Date.now();
    const aoEvento = (ev: EventoNavegador) => {
      const i = ev.passo !== undefined ? (indice.get(ev.passo) ?? -1) : -1;
      switch (ev.tipo) {
        case 'login':
          progresso.concluir(0, ev.detalhe);
          registrarEvento(this.ctx.banco, e.id, { tipo: 'login', titulo: ev.titulo, detalhe: ev.detalhe, estado: 'ok', printId: ev.printId });
          break;
        case 'passo_inicio':
          if (i >= 0) progresso.iniciar(i);
          break;
        case 'passo_ok':
          if (i >= 0) progresso.concluir(i, ev.detalhe);
          registrarEvento(this.ctx.banco, e.id, { tipo: 'passo', titulo: ev.titulo, detalhe: ev.detalhe, estado: 'ok', printId: ev.printId });
          break;
        case 'passo_falhou':
          if (i >= 0) progresso.falhar(i, ev.detalhe);
          registrarEvento(this.ctx.banco, e.id, {
            tipo: 'falha',
            titulo: ev.titulo,
            detalhe: ev.detalhe,
            estado: 'falhou',
            printId: ev.printId,
            candidato: ev.candidato,
          });
          break;
        case 'recuperacao':
          if (i >= 0) progresso.detalhe(i, 'A tela mudou. Estou tentando outro caminho…');
          registrarEvento(this.ctx.banco, e.id, {
            tipo: 'recuperacao',
            titulo: ev.titulo,
            detalhe: ev.detalhe,
            estado: 'aviso',
            printId: ev.printId,
            candidato: ev.candidato,
          });
          break;
        case 'aviso':
          registrarEvento(this.ctx.banco, e.id, { tipo: 'aviso', titulo: ev.titulo, detalhe: ev.detalhe, estado: 'aviso', printId: ev.printId });
          break;
      }
    };
    progresso.iniciar(0);
    const res = await this.ctx.navegador.executar({
      execucaoId: e.id,
      fluxo,
      valores: e.dados,
      usuarioId: e.interno.executarComo ?? e.usuarioId,
      confiancaMinima: def.confiancaMinima,
      mascararPrints: seguranca.mascararPrints,
      aoEvento,
      sinal: controle.signal,
    });
    atualizarExecucao(this.ctx.banco, e.id, { custo_navegador: this.ctx.gastos.custoNavegador(res.duracaoMs ?? Date.now() - inicio) });

    if (res.ok) {
      return this.concluir(e, def, progresso, {
        recuperacoes: res.recuperacoes,
        gerados: res.gerados,
        arquivos: res.arquivos.map((a) => ({ nome: path.basename(a.caminho), tipo: a.tipo, rotulo: a.nome })),
        registro: res.registro ?? null,
        caminho: 'navegador',
        simulado: false,
      });
    }
    if (res.motivo === 'cancelado') return this.encerrarCancelada(e, progresso);
    const passo = res.passo ? fluxo.passos.find((p) => p.n === res.passo) : undefined;
    if (res.motivo === 'elemento_nao_encontrado') {
      const cand = res.candidato
        ? ` O mais parecido foi “${res.candidato.texto}”, com ${Math.round(res.candidato.confianca * 100)}% de confiança (mínimo ${Math.round(def.confiancaMinima * 100)}%).`
        : '';
      this.falhar(e, progresso, {
        erro: 'tela_mudou',
        titulo: 'Não consegui concluir pela tela',
        detalhe: `A tela do ${this.sistema()} mudou e não tive certeza de onde clicar. Nada foi gravado. Chamei uma pessoa do suporte.`,
        diagnostico: {
          titulo: 'A tela mudou e nada foi gravado.',
          detalhe: diagnosticoTelaMudou(passo, res.mensagem, res.candidato?.texto, cand),
          tom: 'erro',
        },
        acoes: [{ rotulo: 'Tentar de novo', acao: 'tentar', estilo: 'secundario' }],
      });
      if (e.conversaId) {
        await this.ctx.atendimento.pedirPessoa(e.conversaId, `A tela mudou durante ${e.tarefaNome} (${e.id})`).catch(() => {});
      }
      return;
    }
    const titulos: Record<string, string> = {
      sessao_expirada: `Não consegui entrar no ${this.sistema()} como ${primeiro}`,
      tempo_esgotado: `O ${this.sistema()} demorou demais para responder`,
      navegador_indisponivel: 'O navegador do copiloto não está disponível agora',
      erro: 'Não consegui concluir pela tela',
    };
    this.falhar(e, progresso, {
      erro: res.motivo,
      titulo: titulos[res.motivo] ?? 'Não consegui concluir pela tela',
      detalhe: `${res.mensagem}. Nada foi gravado.`,
      codigo: codigoRef(),
      diagnostico: { titulo: titulos[res.motivo] ?? 'Falha no navegador', detalhe: `${passo ? `Passo ${passo.n} (“${passo.titulo}”): ` : ''}${res.mensagem}`, tom: 'erro' },
      acoes: [
        { rotulo: 'Tentar de novo', acao: 'tentar', estilo: 'primario' },
        { rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'fantasma' },
      ],
    });
  }

  private urlSistema(caminho: string): string {
    if (/^https?:\/\//.test(caminho)) return caminho;
    return `${this.ctx.adaptador.urlBase}${caminho.startsWith('/') ? '' : '/'}${caminho}`;
  }

  /** Link assinado para baixar um arquivo gerado pela execução (abre direto do recibo). */
  linkArquivo(execucaoId: string, nome: string): string {
    const empresa = this.ctx.empresa.id;
    const chave = assinarArquivo(empresa, execucaoId, nome, this.ctx.config.segredoSessao);
    return `${this.ctx.config.urlPublica}/api/widget/execucoes/${encodeURIComponent(execucaoId)}/arquivos/${encodeURIComponent(nome)}?e=${encodeURIComponent(empresa)}&chave=${chave}`;
  }

  /** Custo do Claude atribuído à execução: o turno que montou o cartão e o que for da própria execução. */
  private custoModelo(e: Execucao): number {
    const proprio = this.ctx.banco.um<{ t: number | null }>('SELECT SUM(custo_usd) AS t FROM uso_llm WHERE execucao_id = ?', e.id)?.t ?? 0;
    let daConversa = 0;
    if (e.conversaId) {
      const anterior = this.ctx.banco.um<{ c: string | null }>(
        'SELECT MAX(criado_em) AS c FROM execucoes WHERE conversa_id = ? AND criado_em < ?',
        e.conversaId,
        e.criadoEm,
      )?.c;
      daConversa =
        this.ctx.banco.um<{ t: number | null }>(
          'SELECT SUM(custo_usd) AS t FROM uso_llm WHERE conversa_id = ? AND execucao_id IS NULL AND criado_em > ? AND criado_em <= ?',
          e.conversaId,
          anterior ?? '',
          e.criadoEm,
        )?.t ?? 0;
    }
    return Math.round(this.ctx.gastos.emReais(proprio + daConversa) * 10000) / 10000;
  }

  private async concluir(
    e: Execucao,
    def: TarefaDefinicao,
    progresso: Progresso,
    r: {
      id?: string;
      resposta?: Record<string, string>;
      gerados?: Record<string, string>;
      arquivos?: { nome: string; tipo: string; rotulo?: string }[];
      simulado: boolean;
      caminho: Caminho;
      /** Passos que a recuperação visual consertou (a tela tinha mudado). */
      recuperacoes?: number;
      /** Número do registro criado, lido da tela no fim do fluxo. */
      registro?: RegistroLido | null;
    },
  ): Promise<void> {
    const agora = agoraIso();
    const duracao = e.iniciadoEm ? Date.now() - Date.parse(e.iniciadoEm) : 0;
    const atualizar = e.interno.atualizarId;
    const existente = e.interno.existente ?? {};
    const registro = r.simulado ? null : (r.registro ?? null);
    // Um passo de leitura que pegou o mesmo número do registro não se repete no recibo.
    const gerados = registro
      ? Object.fromEntries(Object.entries(r.gerados ?? {}).filter(([, v]) => v.replace(/^#\s?/, '') !== registro.numero))
      : r.gerados;
    const valoresTitulo: Record<string, string> = { ...(r.resposta ?? {}), ...(r.gerados ?? {}), ...e.dados };
    if (r.id) valoresTitulo.id = r.id;
    if (registro && !valoresTitulo.registro) valoresTitulo.registro = numeroParaRecibo(registro.numero);
    const codigo = atualizar
      ? codigoDoRegistro(existente)
      : r.resposta?.codigo ?? (r.id ? `#${r.id}` : registro ? numeroParaRecibo(registro.numero) : undefined);
    let titulo = atualizar
      ? `Cadastro ${tituloDoRegistro(existente)} (${codigo ?? ''}) atualizado`
      : fmt.preencherModelo(def.tituloRecibo, valoresTitulo).replace(/\(\s*#?\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    if (r.simulado) titulo = `Teste: ${titulo}`;

    let link: { rotulo: string; url: string } | undefined;
    if (r.arquivos?.length) {
      const a = r.arquivos[0];
      link = { rotulo: `Baixar ${a.rotulo ?? a.nome}`, url: this.linkArquivo(e.id, a.nome) };
    } else if (!r.simulado && def.api?.linkResultado && (r.id || atualizar)) {
      link = {
        rotulo: `Abrir no ${this.sistema()}`,
        url: this.urlSistema(fmt.preencherModelo(def.api.linkResultado, { ...e.dados, id: r.id ?? atualizar ?? '' })),
      };
    } else if (registro?.url) {
      // O sistema mostrou um link para o registro criado ("Abrir o chamado").
      link = {
        rotulo: registro.nome ? `Abrir ${registro.artigo ?? 'o'} ${registro.nome.toLowerCase()}` : `Abrir no ${this.sistema()}`,
        url: this.urlSistema(registro.url),
      };
    }
    const podeDesfazer = !r.simulado && !atualizar && r.caminho === 'api' && !!def.api?.desfazer && !!r.id && def.desfazerMinutos > 0;
    const desfazerAte = podeDesfazer ? new Date(Date.now() + def.desfazerMinutos * 60_000).toISOString() : undefined;

    // Campos do recibo: tudo menos o que já está no título (e, com o número do registro, o que
    // foi para a linha "Chamado #1287 · Padaria Estrela · Prioridade alta").
    let campos = camposExibidos(def, e.dados).filter((c) => !titulo.includes(c.valor));
    const linhaRegistro = registro ? montarLinhaRegistro(def, e.dados, registro, campos) : null;
    if (linhaRegistro) campos = campos.filter((c) => !linhaRegistro.usados.has(c.rotulo));
    for (const [k, v] of Object.entries(gerados ?? {})) campos.push({ rotulo: rotuloGerado(k), valor: v });
    const via = r.caminho === 'api' ? 'via API' : 'pela tela';
    // O código da execução vai à parte (execucaoId); quem mostra o recibo o põe depois do resumo.
    const resumo = r.simulado
      ? `Modo de teste: validado ${via} em ${fmt.duracao(duracao)}, nada foi gravado`
      : `Feito ${via} em ${fmt.duracao(duracao)}`;

    const resultado: ResultadoExecucao = {
      titulo,
      id: r.id ?? atualizar,
      codigo,
      link: link?.url,
      gerados,
      arquivos: r.arquivos?.map((a) => ({ nome: a.nome, tipo: a.tipo })),
      simulado: r.simulado || undefined,
      resposta: r.resposta,
    };
    progresso.finalizar('concluida');
    atualizarExecucao(this.ctx.banco, e.id, {
      status: 'concluida',
      concluido_em: agora,
      duracao_ms: duracao,
      resultado,
      desfazer_ate: desfazerAte ?? null,
      erro: null,
      diagnostico: e.interno.reserva
        ? {
            titulo: 'Concluída pelo caminho reserva',
            detalhe: `A API do ${this.sistema()} não respondeu e o copiloto concluiu pelo fluxo gravado na tela.`,
            tom: 'aviso',
          }
        : null,
      custo_modelo: this.custoModelo(e),
      recuperacoes: r.recuperacoes ?? 0,
      creditos: creditosDaExecucao(r),
    });
    this.avisarConsole(e, 'concluida');
    registrarEvento(this.ctx.banco, e.id, { tipo: 'conclusao', titulo: 'Concluída', detalhe: `${titulo}. ${resumo}`, estado: 'ok' });

    this.postar(e.conversaId, {
      autor: 'copiloto',
      blocos: [
        {
          tipo: 'recibo',
          execucaoId: e.id,
          titulo,
          ...(linhaRegistro ? { registro: linhaRegistro.registro } : {}),
          campos,
          resumo,
          link,
          desfazerAte,
        },
      ],
    });
    const principal = def.campos.find((c) => c.tipo === 'texto' && e.dados[c.chave]);
    const proximos = def.proximosPassos.map((p) => fmt.preencherModelo(p, valoresTitulo)).filter(Boolean);
    this.postar(e.conversaId, {
      autor: 'copiloto',
      texto: proximos.length
        ? `Quer seguir${principal ? ` com ${e.dados[principal.chave]}` : ''}?`
        : 'Precisa de mais alguma coisa?',
      blocos: [
        ...(proximos.length ? [{ tipo: 'sugestoes' as const, itens: proximos.map((p) => ({ rotulo: p, mensagem: p })) }] : []),
        { tipo: 'avaliacao' as const },
      ],
    });
    this.anotar(
      e,
      `A execução ${e.id} terminou: ${titulo}${r.simulado ? ' (modo de teste, nada gravado)' : ''}. ` +
        `${linhaRegistro ? `O ${this.sistema()} mostrou o número ${linhaRegistro.registro.numero} (${linhaRegistro.registro.nome}). ` : ''}` +
        `${r.gerados && Object.keys(r.gerados).length ? `Dados gerados: ${JSON.stringify(r.gerados)}. ` : ''}` +
        `${desfazerAte ? `A pessoa pode desfazer pelo recibo até ${fmt.hora(desfazerAte)}.` : ''}`,
    );
  }
}

/**
 * Linha do registro no topo do recibo: "Chamado #1287 · Padaria Estrela · Prioridade alta".
 * Depois do número entram até dois dados curtos da tarefa (opções de lista viram "Prioridade
 * alta"; textos curtos, menos o primeiro, que costuma ser o assunto, entram só com o valor). O
 * resto continua na lista de campos.
 */
export function montarLinhaRegistro(
  def: TarefaDefinicao,
  valores: Record<string, string>,
  registro: RegistroLido,
  campos: CampoExibido[],
): { registro: { nome: string; numero: string; detalhes: string[] }; usados: Set<string> } {
  const detalhes: string[] = [];
  const usados = new Set<string>();
  const exibidos = new Map(campos.map((c) => [c.rotulo, c.valor]));
  def.campos.forEach((campo, i) => {
    if (detalhes.length >= 2) return;
    const valor = exibidos.get(campo.rotulo);
    if (!valor || !valores[campo.chave]) return;
    if (campo.tipo === 'lista') {
      detalhes.push(`${campo.rotulo} ${/^\p{Lu}\p{Ll}/u.test(valor) ? valor.charAt(0).toLowerCase() + valor.slice(1) : valor}`);
      usados.add(campo.rotulo);
    } else if (campo.tipo === 'texto' && i > 0 && valor.length <= 30 && valor.trim().split(/\s+/).length <= 3) {
      detalhes.push(valor);
      usados.add(campo.rotulo);
    }
  });
  return { registro: { nome: registro.nome ?? 'Registro', numero: numeroParaRecibo(registro.numero), detalhes }, usados };
}

/** Assinatura do link de um arquivo gerado (vale sem sessão, só para esta empresa, execução e arquivo). */
export function assinarArquivo(empresaId: string, execucaoId: string, nome: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(`arquivo.${empresaId}.${execucaoId}.${nome}`).digest('base64url').slice(0, 32);
}

/** Caminho do arquivo gerado no disco, ou null se não existir. */
export function caminhoArquivo(dirDados: string, execucaoId: string, nome: string): string | null {
  const seguro = path.basename(nome);
  const arquivo = path.join(dirDados, 'arquivos', path.basename(execucaoId), seguro);
  return fs.existsSync(arquivo) ? arquivo : null;
}

/** "No passo 6 (“Clicar em Agendar visita”), a tela mudou e não achei o botão… Atualize o fluxo gravado…" */
function diagnosticoTelaMudou(passo: { n: number; titulo: string } | undefined, mensagem: string, candidato: string | undefined, cand: string): string {
  const msg = mensagem.trim().replace(/[.\s]+$/, '');
  const corpo = passo ? `No passo ${passo.n} (“${passo.titulo}”), ${msg.charAt(0).toLowerCase()}${msg.slice(1)}` : msg;
  // A mensagem do navegador às vezes já cita o candidato; aí não repete.
  const extra = candidato && !msg.includes(candidato) ? cand : '';
  return `${corpo}.${extra} Atualize o fluxo gravado para que as próximas execuções rodem sem ajuda.`;
}

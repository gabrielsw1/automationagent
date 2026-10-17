// Passagem para uma pessoa (W8) e respostas da equipe de suporte pelo console.
// Enquanto uma pessoa atende, o copiloto não responde na conversa; ao encerrar, ele volta.
import { ROTULO_PERFIL, fmt, type Bloco } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import type { MembroLogado } from '../auth/console.ts';
import { agoraIso } from '../db/banco.ts';
import { atualizarExecucao, execucoesDaConversa, lerExecucao, registrarEvento } from '../execucao/registro.ts';
import { conflito, naoEncontrado } from '../util/erros.ts';

export class Atendimento {
  constructor(protected readonly ctx: Contexto) {}

  private conversa(id: string) {
    const c = this.ctx.conversas.buscar(id);
    if (!c) throw naoEncontrado('Conversa');
    return c;
  }

  /** A pessoa pediu (ou o agente sugeriu) falar com alguém. Monta o resumo para o suporte. */
  async pedirPessoa(conversaId: string, motivo: string): Promise<void> {
    const c = this.conversa(conversaId);
    const horario = this.ctx.configuracoes.ler('widget_publicado').atendimentoHumano.horario;
    if (c.estado.modo !== 'copiloto') {
      this.ctx.conversas.adicionar(conversaId, {
        autor: 'copiloto',
        texto:
          c.estado.modo === 'pessoa'
            ? `${c.estado.atendente.nome} já está acompanhando esta conversa.`
            : 'Já chamei uma pessoa do suporte. Ela responde aqui mesmo.',
      });
      return;
    }
    const itens = this.resumo(conversaId, motivo);
    this.ctx.conversas.definirEstado(conversaId, { modo: 'aguardando_pessoa', resumoEnviado: true });
    for (const e of execucoesDaConversa(this.ctx.banco, conversaId)) {
      if (e.status === 'falhou' && !e.transferidaPara) {
        registrarEvento(this.ctx.banco, e.id, { tipo: 'transferencia', titulo: 'Conversa passada para o suporte', detalhe: motivo, estado: 'aviso' });
      }
    }
    this.ctx.conversas.adicionar(conversaId, {
      autor: 'copiloto',
      texto: 'Chamei uma pessoa do suporte e mandei um resumo, para você não precisar explicar tudo de novo.',
      blocos: [{ tipo: 'resumo_humano', para: 'a equipe de suporte', itens }],
      nota: `Atendimento por pessoas: ${horario}`,
    });
    this.ctx.conversas.anotar(conversaId, `A conversa foi passada para a equipe de suporte (motivo: ${motivo}).`);
  }

  /** Itens do resumo: o que a pessoa pediu, o que já foi tentado e a execução. */
  private resumo(conversaId: string, motivo: string): { rotulo: string; valor: string }[] {
    const execucoes = execucoesDaConversa(this.ctx.banco, conversaId);
    const ultima = execucoes[execucoes.length - 1];
    const ultimaMsg = this.ctx.conversas
      .mensagens(conversaId)
      .filter((m) => m.autor === 'usuario' && m.texto)
      .pop();
    const itens: { rotulo: string; valor: string }[] = [];
    if (ultima) {
      const principal = Object.values(ultima.dados)[0];
      itens.push({ rotulo: 'Pedido', valor: `${ultima.tarefaNome}${principal ? ` ${principal}` : ''}` });
      if (ultima.diagnostico) itens.push({ rotulo: 'Já tentado', valor: ultima.diagnostico.detalhe });
      else if (ultima.status !== 'concluida') itens.push({ rotulo: 'Situação', valor: rotuloStatus(ultima.status) });
      itens.push({ rotulo: 'Execução', valor: ultima.id });
    } else if (ultimaMsg?.texto) {
      itens.push({ rotulo: 'Pedido', valor: ultimaMsg.texto.slice(0, 200) });
    }
    if (motivo && !itens.some((i) => i.valor === motivo)) itens.push({ rotulo: 'Motivo', valor: motivo });
    const c = this.ctx.conversas.buscar(conversaId);
    if (c?.contexto?.secao) itens.push({ rotulo: 'Página', valor: c.contexto.secao });
    return itens;
  }

  /** Alguém do suporte assume a conversa pelo console. */
  assumir(conversaId: string, membro: MembroLogado): void {
    const c = this.conversa(conversaId);
    if (c.estado.modo === 'pessoa' && c.atendenteId === membro.id) return;
    const papel = ROTULO_PERFIL[membro.perfil] ?? 'Suporte';
    this.ctx.conversas.definirEstado(
      conversaId,
      { modo: 'pessoa', atendente: { nome: membro.nome, iniciais: fmt.iniciais(membro.nome), papel } },
      membro.id,
    );
    // O resumo passa a mostrar para quem foi entregue.
    const comResumo = this.ctx.conversas
      .mensagens(conversaId)
      .filter((m) => m.blocos.some((b) => b.tipo === 'resumo_humano'))
      .pop();
    if (comResumo) {
      this.ctx.conversas.atualizar(comResumo.id, (m) => {
        m.blocos = m.blocos.map((b): Bloco => (b.tipo === 'resumo_humano' ? { ...b, para: fmt.primeiroNome(membro.nome) } : b));
      });
    }
    const agora = agoraIso();
    for (const e of execucoesDaConversa(this.ctx.banco, conversaId)) {
      if (e.transferidaPara || !['falhou', 'aguardando_aprovacao', 'em_andamento'].includes(e.status)) continue;
      atualizarExecucao(this.ctx.banco, e.id, { transferida_para: membro.nome, transferida_em: agora });
      registrarEvento(this.ctx.banco, e.id, { tipo: 'transferencia', titulo: `Transferida para ${membro.nome}`, estado: 'info' });
      this.ctx.eventos.emitirConsole({ tipo: 'execucao', execucaoId: e.id, status: e.status });
    }
    this.ctx.conversas.adicionar(conversaId, {
      autor: 'sistema',
      texto: `${membro.nome}, ${membro.perfil === 'suporte' ? 'do suporte' : 'da equipe'}, entrou na conversa`,
      icone: 'pessoa',
    });
    this.ctx.auditoria.registrar(membro.nome, 'assumiu a conversa', conversaId);
  }

  /** Mensagem do suporte para a pessoa, no widget. */
  responder(conversaId: string, membro: MembroLogado, texto: string): void {
    const c = this.conversa(conversaId);
    if (c.estado.modo !== 'pessoa' || c.atendenteId !== membro.id) this.assumir(conversaId, membro);
    this.ctx.conversas.adicionar(conversaId, {
      autor: 'pessoa',
      autorNome: membro.nome,
      autorIniciais: fmt.iniciais(membro.nome),
      texto,
    });
    this.ctx.conversas.anotar(conversaId, `${membro.nome}, do suporte, escreveu para a pessoa: “${texto.slice(0, 500)}”`);
  }

  /** Encerra o atendimento e devolve a conversa ao copiloto. */
  encerrar(conversaId: string, membro: MembroLogado): void {
    const c = this.conversa(conversaId);
    if (c.estado.modo === 'copiloto') return;
    this.ctx.conversas.definirEstado(conversaId, { modo: 'copiloto' }, null);
    this.ctx.conversas.adicionar(conversaId, {
      autor: 'sistema',
      texto: `${membro.nome} encerrou o atendimento. O copiloto voltou a responder.`,
      icone: 'info',
    });
    this.ctx.conversas.anotar(conversaId, `${membro.nome} encerrou o atendimento humano; o copiloto voltou a responder.`);
    this.ctx.auditoria.registrar(membro.nome, 'encerrou o atendimento', conversaId);
  }

  /** "Avisar o usuário" no detalhe de uma execução. */
  avisarUsuario(execucaoId: string, membro: MembroLogado, texto: string): void {
    const e = lerExecucao(this.ctx.banco, execucaoId);
    if (!e) throw naoEncontrado('Execução');
    if (!e.conversaId || !this.ctx.conversas.buscar(e.conversaId)) {
      throw conflito('Esta execução não tem conversa no widget para avisar o usuário.');
    }
    this.ctx.conversas.adicionar(e.conversaId, {
      autor: 'pessoa',
      autorNome: membro.nome,
      autorIniciais: fmt.iniciais(membro.nome),
      texto,
    });
    registrarEvento(this.ctx.banco, e.id, {
      tipo: 'aviso',
      titulo: `${e.usuarioNome} avisado por ${membro.nome}`,
      detalhe: texto.slice(0, 280),
      estado: 'info',
    });
    this.ctx.conversas.anotar(e.conversaId, `${membro.nome}, do suporte, avisou a pessoa sobre ${e.id}: “${texto.slice(0, 500)}”`);
    this.ctx.auditoria.registrar(membro.nome, 'avisou o usuário', execucaoId, texto.slice(0, 140));
  }
}

function rotuloStatus(s: string): string {
  const r: Record<string, string> = {
    aguardando_confirmacao: 'Aguardando confirmação',
    aguardando_aprovacao: 'Aguardando aprovação',
    em_andamento: 'Em andamento',
    cancelada: 'Cancelada',
    desfeita: 'Desfeita',
    falhou: 'Falhou',
  };
  return r[s] ?? s;
}

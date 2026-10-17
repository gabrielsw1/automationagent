// Agente do copiloto: conversa com a pessoa, escolhe a tarefa, coleta e valida os dados,
// mostra o cartão de confirmação e responde dúvidas pela base de conhecimento.
//
// Cada mensagem da pessoa vira um turno: o Claude (Opus) recebe a transcrição completa (só
// acrescentada, para o cache e os blocos de raciocínio ficarem intactos) e as ferramentas
// (uma por tarefa + conhecimento + pessoa). O que o modelo extrai passa sempre pela validação
// determinística; o cartão e os botões são montados aqui, não pelo modelo. Em paralelo, o
// Haiku classifica o pedido (alimenta "pedidos sem tarefa" no console).
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  fmt,
  validarTarefa,
  type Bloco,
  type Campo,
  type CasoDeTeste,
  type ResultadoTeste,
  type RodadaTestes,
  type TarefaDefinicao,
  type UsuarioSistema,
} from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import { agoraIso } from '../db/banco.ts';
import { camposExibidos } from '../execucao/motor.ts';
import { RecusaDoModelo, SemChaveClaude, type BlocoResposta, type MensagemLlm } from '../llm/tipos.ts';
import { paraSearchResults } from '../conhecimento/citacoes.ts';
import { podeExecutar, type TarefaEmUso } from '../servicos/catalogo.ts';
import type { ConversaLinha } from '../servicos/conversas.ts';
import { ErroHttp, naoEncontrado } from '../util/erros.ts';
import { codigoRef, novoId } from '../util/ids.ts';
import { normalizar, pontuarTarefa, temaDoPedido, pareceDuvida, pedePessoa, saudacao, agradecimento } from './extracao.ts';
import {
  FERRAMENTA_CONHECIMENTO,
  FERRAMENTA_PESSOA,
  PREFIXO_TAREFA,
  ferramentasDe,
  nomeFerramenta,
  type ResultadoFerramenta,
  type ResultadoTarefa,
} from './ferramentas.ts';
import { promptSistema } from './prompt.ts';
import { coletaAtiva, simularAgente, textoDaPessoa } from './simulacao.ts';

type BlocoEntrada = Anthropic.Beta.BetaContentBlockParam;
type ResultadoBloco = Anthropic.Beta.BetaToolResultBlockParam;
type UsoFerramenta = Extract<BlocoResposta, { type: 'tool_use' }>;

const MAX_ITERACOES = 6;

const Classificacao = z.object({
  tipo: z.enum(['tarefa', 'duvida', 'sem_tarefa', 'conversa', 'humano', 'nao_entendi']),
  tarefa: z.string().nullable(),
  tema: z.string().nullable(),
});
type Classificacao = z.infer<typeof Classificacao>;

interface TurnoAtual {
  conversa: ConversaLinha;
  usuario: UsuarioSistema;
  tarefas: TarefaEmUso[];
  textoPessoa: string;
  mensagemId: string | null;
  texto: string;
  blocos: Bloco[];
  execucoes: string[];
  consultas: { pergunta: string; inicio: number; total: number }[];
  parar: boolean;
  usouFerramenta: boolean;
  nota?: string;
}

/** Junta mensagens seguidas do mesmo papel (ex.: resultados de ferramenta + nova mensagem da pessoa). */
export function normalizarTranscricao(mensagens: MensagemLlm[]): MensagemLlm[] {
  const saida: MensagemLlm[] = [];
  for (const m of mensagens) {
    const conteudo = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === m.role) {
      (ultima.content as BlocoEntrada[]).push(...(conteudo as BlocoEntrada[]));
    } else {
      saida.push({ role: m.role, content: [...(conteudo as BlocoEntrada[])] });
    }
  }
  return saida;
}

/** Lista, em ordem, dos blocos search_result enviados ao modelo (as citações apontam para esse índice). */
function resultadosBusca(mensagens: MensagemLlm[]): { title: string; source: string }[] {
  const lista: { title: string; source: string }[] = [];
  for (const m of mensagens) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content as BlocoEntrada[]) {
      if (b.type === 'search_result') lista.push({ title: b.title, source: b.source });
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        for (const c of b.content) if (c.type === 'search_result') lista.push({ title: c.title, source: c.source });
      }
    }
  }
  return lista;
}

function separarLocal(titulo: string): { titulo: string; local?: string } {
  const m = titulo.match(/^(.*)\s+\(([^()]+)\)$/);
  return m ? { titulo: m[1], local: m[2] } : { titulo };
}

function cabecalhoData(agora = new Date()): string {
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(agora);
  return `[Hoje: ${dia}, ${fmt.hora(agora)} (horário de Brasília)]`;
}

/** Pergunta do campo, com {campo} preenchido; sem valor para o modelo, uma pergunta genérica. */
export function perguntaDe(campo: Campo, valores: Record<string, string>): string {
  const base = campo.pergunta || `Qual ${campo.rotulo.toLowerCase()}?`;
  const faltaValor = [...base.matchAll(/\{(\w+)\}/g)].some((m) => !valores[m[1]]);
  return faltaValor ? `Qual ${campo.rotulo.toLowerCase()}?` : fmt.preencherModelo(base, valores);
}

export class Agente {
  private readonly filas = new Map<string, Promise<void>>();
  private readonly usuarios = new Map<string, { em: number; usuario: UsuarioSistema }>();
  /** Primeira frase do pedido em coleta, por conversa e tarefa (vira o "pedido" da execução). */
  private readonly pedidos = new Map<string, string>();

  constructor(protected readonly ctx: Contexto) {}

  /** Nova mensagem da pessoa: roda um turno do agente (respostas chegam por SSE). Turnos da mesma conversa vão em fila. */
  async aoMensagem(conversaId: string, texto: string, extras: { anexos?: string[] } = {}): Promise<void> {
    const anterior = this.filas.get(conversaId) ?? Promise.resolve();
    const atual = anterior.then(() => this.turno(conversaId, texto, extras)).catch((e) => {
      console.error('Falha no turno do agente:', e);
    });
    this.filas.set(conversaId, atual);
    await atual;
    if (this.filas.get(conversaId) === atual) this.filas.delete(conversaId);
  }

  /** Espera os turnos em andamento (testes e desligamento). */
  async ocioso(): Promise<void> {
    while (this.filas.size) await Promise.allSettled([...this.filas.values()]);
  }

  private async usuarioDe(conversa: ConversaLinha): Promise<UsuarioSistema> {
    const c = this.usuarios.get(conversa.usuarioId);
    if (c && Date.now() - c.em < 60_000) return c.usuario;
    const u = await this.ctx.adaptador.buscarUsuario(conversa.usuarioId).catch(() => null);
    const usuario = u ?? { id: conversa.usuarioId, nome: conversa.usuarioNome, email: '', perfis: [] };
    this.usuarios.set(conversa.usuarioId, { em: Date.now(), usuario });
    return usuario;
  }

  private sistema(conversa?: ConversaLinha): string {
    const cfg = this.ctx.configuracoes.ler(conversa?.canal === 'teste' ? 'widget_rascunho' : 'widget_publicado');
    return promptSistema({ nomeCopiloto: cfg.nome || 'Copiloto', sistema: this.ctx.adaptador.nome });
  }

  private async turno(conversaId: string, texto: string, extras: { anexos?: string[] }): Promise<void> {
    const conversa = this.ctx.conversas.buscar(conversaId);
    if (!conversa || conversa.estado.modo !== 'copiloto') return;
    const usuario = await this.usuarioDe(conversa);
    const tarefas = this.ctx.catalogo.emUso(usuario, conversa.usarRascunhos);
    const historico = this.ctx.conversas.transcricao(conversaId);

    // Mensagem da pessoa com o contexto do momento (só acrescentada à transcrição).
    const linhas = [cabecalhoData()];
    if (historico.length === 0) {
      linhas.push(`[Pessoa: ${usuario.nome} · perfis no ${this.ctx.adaptador.nome}: ${usuario.perfis.join(', ') || 'nenhum'}]`);
      if (conversa.canal === 'teste') linhas.push('[Modo de teste do console: nada é gravado no sistema]');
    }
    if (conversa.contexto?.secao) linhas.push(`[Página aberta no ${this.ctx.adaptador.nome}: ${conversa.contexto.secao}]`);
    for (const n of this.ctx.conversas.retirarNotas(conversaId)) linhas.push(`[Nota do sistema: ${n}]`);
    if (extras.anexos?.length) linhas.push(`[A pessoa anexou: ${extras.anexos.join(', ')}]`);
    this.ctx.conversas.acrescentarTranscricao(conversaId, 'user', [{ type: 'text', text: `${linhas.join('\n')}\n\n${texto}` }]);

    const turno: TurnoAtual = {
      conversa,
      usuario,
      tarefas,
      textoPessoa: texto,
      mensagemId: null,
      texto: '',
      blocos: [],
      execucoes: [],
      consultas: [],
      parar: false,
      usouFerramenta: false,
    };
    const classificar = coletaAtiva(normalizarTranscricao(this.ctx.conversas.transcricao(conversaId)))
      ? Promise.resolve(null)
      : this.classificar(conversa, usuario, tarefas, texto).catch(() => null);

    this.ctx.conversas.digitando(conversaId, true);
    try {
      await this.loop(turno);
    } catch (erro) {
      this.falhaDoTurno(turno, erro);
    } finally {
      this.ctx.conversas.digitando(conversaId, false);
    }
    const classe = await classificar;
    this.finalizar(turno, classe);
  }

  private abrirMensagem(t: TurnoAtual): string {
    if (!t.mensagemId) {
      const m = this.ctx.conversas.adicionar(t.conversa.id, { autor: 'copiloto', texto: '', emAndamento: true });
      t.mensagemId = m.id;
    }
    return t.mensagemId;
  }

  private async loop(t: TurnoAtual): Promise<void> {
    const conversaId = t.conversa.id;
    const ferramentas = ferramentasDe(t.tarefas);
    const sistema = this.sistema(t.conversa);
    const pessoas = (await this.ctx.adaptador.listarUsuarios().catch(() => [] as UsuarioSistema[])).map((u) => u.nome);
    const simulacao = simularAgente({
      primeiroNome: fmt.primeiroNome(t.usuario.nome),
      sistema: this.ctx.adaptador.nome,
      tarefas: t.tarefas,
      pessoas,
    });

    for (let i = 0; i < MAX_ITERACOES; i++) {
      const mensagens = normalizarTranscricao(this.ctx.conversas.transcricao(conversaId));
      let primeiro = true;
      const resposta = await this.ctx.llm.turno({
        finalidade: 'agente',
        conversaId,
        sistema,
        ferramentas,
        mensagens,
        esforco: this.ctx.config.esforco,
        maxTokens: 16_000,
        simulacao,
        aoTexto: (d) => {
          const id = this.abrirMensagem(t);
          if (primeiro && t.texto) this.ctx.conversas.delta(conversaId, id, '\n\n');
          primeiro = false;
          this.ctx.conversas.delta(conversaId, id, d);
        },
      });
      this.ctx.conversas.acrescentarTranscricao(conversaId, 'assistant', resposta.conteudo as BlocoEntrada[]);
      this.juntarTexto(t, resposta.conteudo, mensagens);

      const usos = resposta.conteudo.filter((b): b is UsoFerramenta => b.type === 'tool_use');
      if (resposta.parada !== 'tool_use' || usos.length === 0) {
        // Resposta cortada no meio de uma chamada: fecha a chamada para a transcrição continuar válida.
        if (usos.length) {
          this.ctx.conversas.acrescentarTranscricao(
            conversaId,
            'user',
            usos.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'Não executado: a resposta foi interrompida.', is_error: true })),
          );
        }
        break;
      }
      t.usouFerramenta = true;
      const resultados: ResultadoBloco[] = [];
      for (const u of usos) resultados.push(await this.executarFerramenta(t, u));
      this.ctx.conversas.acrescentarTranscricao(conversaId, 'user', resultados);
      if (t.parar) break;
    }
  }

  /** Junta o texto da resposta (com marcadores [n] nas frases citadas) e monta o bloco de fontes. */
  private juntarTexto(t: TurnoAtual, conteudo: BlocoResposta[], enviadas: MensagemLlm[]) {
    const busca = resultadosBusca(enviadas);
    let texto = '';
    for (const b of conteudo) {
      if (b.type !== 'text') continue;
      texto += b.text;
      const indices = [...new Set((b.citations ?? []).filter((c) => c.type === 'search_result_location').map((c) => c.search_result_index))];
      if (!indices.length) continue;
      const fontes = this.blocoFontes(t);
      const nums: number[] = [];
      for (const i of indices) {
        const r = busca[i];
        if (!r) continue;
        const { titulo, local } = separarLocal(r.title);
        let item = fontes.itens.find((x) => x.titulo === titulo && x.local === local);
        if (!item) {
          item = { n: fontes.itens.length + 1, titulo, local, url: /^https?:\/\//.test(r.source) ? r.source : undefined };
          fontes.itens.push(item);
        }
        nums.push(item.n);
        const ultima = t.consultas[t.consultas.length - 1];
        if (ultima && i === ultima.inicio && fontes.confianca !== 'alta') fontes.confianca = 'alta';
      }
      if (nums.length) texto = texto.replace(/\s*$/, '') + nums.map((n) => ` [${n}]`).join('') + (/\s$/.test(b.text) ? ' ' : '');
    }
    texto = texto.trim();
    if (!texto) return;
    t.texto = t.texto ? `${t.texto}\n\n${texto}` : texto;
  }

  private blocoFontes(t: TurnoAtual): Extract<Bloco, { tipo: 'fontes' }> {
    let f = t.blocos.find((b): b is Extract<Bloco, { tipo: 'fontes' }> => b.tipo === 'fontes');
    if (!f) {
      f = { tipo: 'fontes', itens: [], confianca: 'media' };
      t.blocos.push(f);
    }
    return f;
  }

  private async executarFerramenta(t: TurnoAtual, u: UsoFerramenta): Promise<ResultadoBloco> {
    const responder = (r: ResultadoFerramenta, erro = false): ResultadoBloco => ({
      type: 'tool_result',
      tool_use_id: u.id,
      content: JSON.stringify(r),
      ...(erro ? { is_error: true } : {}),
    });
    const entrada = (u.input && typeof u.input === 'object' ? u.input : {}) as Record<string, unknown>;
    try {
      if (u.name === FERRAMENTA_CONHECIMENTO) {
        const pergunta = String(entrada.pergunta ?? t.textoPessoa).slice(0, 500);
        const trechos = this.ctx.conhecimento.buscar(pergunta, 5);
        if (!trechos.length) {
          this.ctx.conhecimento.registrarSemResposta(pergunta, 'sem_fonte');
          return responder({
            situacao: 'sem_resultado',
            instrucao: 'Nada nas fontes responde a isso. Diga que não encontrou essa informação e ofereça chamar uma pessoa. Não invente.',
            resposta_sugerida: `Não encontrei isso nas fontes que tenho sobre o ${this.ctx.adaptador.nome}. Deixei a pergunta registrada para a equipe. Quer que eu chame uma pessoa?`,
          });
        }
        const enviadas = resultadosBusca(normalizarTranscricao(this.ctx.conversas.transcricao(t.conversa.id)));
        t.consultas.push({ pergunta, inicio: enviadas.length, total: trechos.length });
        return { type: 'tool_result', tool_use_id: u.id, content: paraSearchResults(trechos) };
      }
      if (u.name === FERRAMENTA_PESSOA) {
        t.parar = true;
        await this.ctx.atendimento.pedirPessoa(t.conversa.id, String(entrada.motivo ?? 'A pessoa pediu para falar com alguém.'));
        return responder({
          situacao: 'pessoa_chamada',
          instrucao: 'A pessoa já foi avisada de que alguém do suporte vai responder. Não escreva mais nada.',
          resposta_sugerida: '',
        });
      }
      if (u.name.startsWith(PREFIXO_TAREFA)) {
        const tarefa = t.tarefas.find((x) => nomeFerramenta(x.slug) === u.name);
        if (!tarefa) {
          return responder({
            situacao: 'indisponivel',
            tarefa: u.name,
            instrucao: 'Esta tarefa não está disponível agora. Diga isso e ofereça chamar uma pessoa.',
            resposta_sugerida: 'Essa tarefa não está disponível agora. Quer que eu chame uma pessoa?',
          });
        }
        return responder(await this.executarTarefa(t, tarefa, entrada));
      }
      return responder({ situacao: 'erro', instrucao: 'Ferramenta desconhecida.', resposta_sugerida: '' }, true);
    } catch (erro) {
      const ref = codigoRef();
      console.error(`[${ref}] erro na ferramenta ${u.name}:`, erro);
      return responder(
        {
          situacao: 'erro',
          instrucao: `Algo falhou do lado do copiloto (código ${ref}). Peça desculpas em uma frase e ofereça chamar uma pessoa.`,
          resposta_sugerida: `Tive um problema do meu lado (código ${ref}). Quer que eu chame uma pessoa?`,
        },
        true,
      );
    }
  }

  /** Valida os dados da tarefa e decide: perguntar, explicar o erro, pedir aprovação ou mostrar o cartão. */
  private async executarTarefa(t: TurnoAtual, tarefa: TarefaEmUso, entrada: Record<string, unknown>): Promise<ResultadoTarefa> {
    const def = tarefa.definicao;
    const nome = fmt.primeiroNome(t.usuario.nome);
    const chavePedido = `${t.conversa.id}:${tarefa.slug}`;
    if (!this.pedidos.has(chavePedido)) this.pedidos.set(chavePedido, t.textoPessoa);
    // Só campos da ficha, sempre como texto (a entrada do modelo pode vir incompleta ou com tipos trocados).
    const valoresBrutos: Record<string, string> = {};
    for (const c of def.campos) {
      const v = entrada[c.chave];
      if (typeof v === 'string' || typeof v === 'number') valoresBrutos[c.chave] = String(v).trim();
    }

    const pausa = this.ctx.gastos.pausaAtiva();
    if (t.conversa.canal !== 'teste' && pausa && (pausa.tipo === 'tudo' || (def.caminho === 'navegador' && pausa.tipo === 'navegador'))) {
      t.blocos.push({
        tipo: 'erro',
        titulo: 'Não posso fazer esta tarefa agora',
        detalhe: pausa.mensagem,
        acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
      });
      return {
        situacao: 'pausado',
        tarefa: def.nome,
        instrucao: 'O limite de gasto do mês foi atingido e esta tarefa está pausada. Explique de forma neutra; o botão para falar com uma pessoa já aparece.',
        resposta_sugerida: `${pausa.mensagem} Se for urgente, uma pessoa da equipe pode fazer por você.`,
      };
    }

    const v = validarTarefa(def.campos, valoresBrutos, { id: t.usuario.id, nome: t.usuario.nome });
    const jaTenho: Record<string, string> = {};
    const itensOk: { rotulo: string; valor?: string; ok: boolean }[] = [];
    for (const c of def.campos) {
      const valor = v.valores[c.chave];
      if (!valor || c.perguntar === false || c.padrao === 'solicitante') continue;
      const exibido = fmt.valorCampo(c, valor);
      jaTenho[c.rotulo] = exibido;
      itensOk.push({ rotulo: c.rotulo, valor: exibido, ok: true });
    }

    if (v.invalidos.length) {
      const inv = v.invalidos[0];
      t.blocos.push({
        tipo: 'coleta',
        itens: [...itensOk, { rotulo: inv.campo.rotulo, valor: valoresBrutos[inv.campo.chave], ok: false }],
        pergunta: inv.erro,
      });
      return {
        situacao: 'dados_invalidos',
        tarefa: def.nome,
        ja_tenho: jaTenho,
        erros: v.invalidos.map((x) => ({ campo: x.campo.chave, rotulo: x.campo.rotulo, erro: x.erro })),
        instrucao:
          'Um dado não passou na validação. A lista do que já está certo e a explicação do erro aparecem abaixo do seu texto. Escreva só uma frase curta de abertura, sem repetir os dados.',
        resposta_sugerida: `Quase lá, ${nome}. Um dado precisa de ajuste:`,
      };
    }

    if (v.faltando.length) {
      const falta = v.faltando[0];
      const pergunta = perguntaDe(falta, v.valores);
      if (itensOk.length) {
        t.blocos.push({ tipo: 'coleta', itens: [...itensOk, { rotulo: falta.rotulo, ok: false }], pergunta });
      }
      return {
        situacao: 'faltam_dados',
        tarefa: def.nome,
        ja_tenho: jaTenho,
        faltam: v.faltando.map((c) => ({ campo: c.chave, rotulo: c.rotulo, pergunta: perguntaDe(c, v.valores) })),
        instrucao: itensOk.length
          ? 'Falta dado. A lista do que já foi entendido e a pergunta do primeiro dado que falta aparecem abaixo do seu texto. Escreva só uma frase curta de abertura, sem repetir os dados nem a pergunta.'
          : 'Falta dado. Pergunte só o primeiro dado que falta, com a pergunta sugerida.',
        resposta_sugerida: itensOk.length ? `Certo, ${nome}. Já tenho estes dados:` : pergunta,
      };
    }

    // Dados completos.
    const pedido = this.pedidos.get(chavePedido) ?? t.textoPessoa;
    if (!podeExecutar(def, t.usuario.perfis)) {
      const r = await this.ctx.motor.criarAprovacao({ conversa: t.conversa, usuario: t.usuario, tarefa, valores: v.valores, pedido });
      const perfil = def.perfilAprovador ?? def.perfisPermitidos[0] ?? '';
      const exigido = def.perfisPermitidos.join(' ou ') || perfil;
      if (!r) {
        t.blocos.push({
          tipo: 'erro',
          titulo: 'Sem permissão para esta tarefa',
          detalhe: `${def.nome} exige o perfil ${exigido}.`,
          acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
        });
        return {
          situacao: 'sem_permissao',
          tarefa: def.nome,
          perfil_necessario: exigido,
          instrucao: 'A pessoa não tem o perfil e não há quem aprove. Explique em uma frase; o botão para falar com uma pessoa já aparece.',
          resposta_sugerida: `Seu acesso não permite essa mudança: ${def.nome} exige o perfil ${exigido}.`,
        };
      }
      this.pedidos.delete(chavePedido);
      t.blocos.push(r.bloco);
      t.execucoes.push(r.execucao.id);
      return {
        situacao: 'precisa_aprovacao',
        tarefa: def.nome,
        perfil_necessario: exigido,
        aprovador: r.bloco.aprovador?.nome,
        instrucao:
          'A pessoa não tem o perfil. O cartão para pedir aprovação (com o botão "Pedir aprovação") já aparece abaixo. Explique em uma frase qual perfil a tarefa exige.',
        resposta_sugerida: `Seu acesso não permite essa mudança: ${def.nome} exige o perfil ${exigido}.`,
      };
    }

    if (t.conversa.canal !== 'teste') {
      const limite = this.ctx.gastos.verificar(t.usuario.id, def.caminho === 'api' && def.api ? 'api' : 'navegador');
      if (!limite.permitido) {
        t.blocos.push({
          tipo: 'erro',
          titulo: 'Não posso executar agora',
          detalhe: limite.mensagem,
          acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
        });
        return {
          situacao: 'pausado',
          tarefa: def.nome,
          instrucao: 'Um limite de uso foi atingido. Explique de forma neutra; o botão para falar com uma pessoa já aparece.',
          resposta_sugerida: `${limite.mensagem} Se for urgente, uma pessoa da equipe pode fazer por você.`,
        };
      }
    }

    const r = this.ctx.motor.criarCartao({ conversa: t.conversa, usuario: t.usuario, tarefa, valores: v.valores, pedido });
    this.pedidos.delete(chavePedido);
    t.blocos = t.blocos.filter((b) => b.tipo !== 'coleta');
    t.blocos.push(r.bloco);
    t.execucoes.push(r.execucao.id);
    t.nota = 'Só gravo depois que você confirmar.';
    return {
      situacao: 'cartao_mostrado',
      tarefa: def.nome,
      execucao: r.execucao.id,
      instrucao:
        'O cartão de confirmação com todos os dados já aparece abaixo do seu texto. Escreva só uma frase curta pedindo para conferir. Não repita os dados e não diga que já fez.',
      resposta_sugerida: `Tenho tudo. Confira antes de eu gravar: nada foi salvo no ${this.ctx.adaptador.nome} ainda.`,
    };
  }

  private finalizar(t: TurnoAtual, classe: Classificacao | null) {
    if (t.consultas.length) {
      const fontes = t.blocos.find((b) => b.tipo === 'fontes');
      if (!fontes) {
        for (const c of t.consultas) this.ctx.conhecimento.registrarSemResposta(c.pergunta, 'sem_citacao');
      }
      t.blocos.push({ tipo: 'avaliacao' });
    }
    if (!t.usouFerramenta && classe?.tipo === 'nao_entendi' && t.tarefas.length) {
      t.blocos.push({
        tipo: 'sugestoes',
        titulo: 'Posso ajudar com',
        itens: t.tarefas.slice(0, 3).map((x) => ({ rotulo: x.definicao.nome, mensagem: x.definicao.nome })),
      });
    }
    // Ordem dos blocos: coleta/cartões primeiro, fontes e avaliação no fim.
    const ordem: Record<string, number> = { fontes: 8, avaliacao: 9, sugestoes: 7 };
    t.blocos.sort((a, b) => (ordem[a.tipo] ?? 0) - (ordem[b.tipo] ?? 0));
    if (!t.mensagemId && !t.texto && t.blocos.length === 0) return;
    const id = this.abrirMensagem(t);
    this.ctx.conversas.atualizar(id, (m) => {
      m.texto = t.texto || undefined;
      m.blocos = t.blocos;
      m.emAndamento = false;
      if (t.nota) m.nota = t.nota;
    });
    if (t.execucoes.length) this.ctx.motor.ligarMensagem(t.execucoes, id);
  }

  private falhaDoTurno(t: TurnoAtual, erro: unknown) {
    const conversaId = t.conversa.id;
    if (erro instanceof RecusaDoModelo) {
      this.ctx.conversas.acrescentarTranscricao(conversaId, 'assistant', [
        { type: 'text', text: 'Não posso ajudar com esse pedido.' },
      ]);
      t.texto = 'Não posso ajudar com esse pedido por aqui. Se precisar, posso chamar uma pessoa da equipe.';
      t.blocos = [{ tipo: 'sugestoes', itens: [{ rotulo: 'Falar com uma pessoa', mensagem: 'Quero falar com uma pessoa' }] }];
      return;
    }
    if (erro instanceof SemChaveClaude) {
      // Sem a chave, nada é inventado: a pessoa sabe que o assistente não está ligado e pode chamar alguém.
      t.blocos = [
        {
          tipo: 'erro',
          titulo: 'O assistente ainda não está ligado',
          detalhe: `A equipe da ${this.ctx.empresa.nome} está terminando de configurar o copiloto. Enquanto isso, uma pessoa da equipe pode ajudar.`,
          acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
        },
      ];
      return;
    }
    const ref = codigoRef();
    console.error(`[${ref}] falha no turno do agente:`, erro);
    t.blocos = [
      {
        tipo: 'erro',
        titulo: 'Não consegui responder agora',
        detalhe: 'Tente de novo em instantes. Se continuar, uma pessoa da equipe pode ajudar.',
        codigo: ref,
        acoes: [{ rotulo: 'Falar com uma pessoa', acao: 'humano', estilo: 'primario' }],
      },
    ];
  }

  // ---------------------------------------------------------------- classificação (Haiku)

  private async classificar(
    conversa: ConversaLinha,
    usuario: UsuarioSistema,
    tarefas: TarefaEmUso[],
    texto: string,
  ): Promise<Classificacao | null> {
    const catalogo = tarefas.map((x) => `- ${x.slug}: ${x.definicao.nome}. ${x.definicao.descricao}`).join('\n');
    const { dados } = await this.ctx.llm.estruturado({
      modelo: 'rapido',
      finalidade: 'classificacao',
      conversaId: conversa.id,
      esforco: 'low',
      maxTokens: 300,
      sistema:
        `Classifique a mensagem de uma pessoa que usa o sistema ${this.ctx.adaptador.nome}.\n` +
        'Tipos: tarefa (pede uma das tarefas abaixo), duvida (pergunta como usar o sistema, regras, prazos, preços), ' +
        'sem_tarefa (pede uma ação no sistema que nenhuma tarefa abaixo faz), humano (quer falar com uma pessoa), ' +
        'conversa (cumprimento, agradecimento, conversa), nao_entendi (não dá para saber o que a pessoa quer).\n' +
        'tarefa: o identificador da tarefa (só para o tipo tarefa), senão null. tema: para sem_tarefa, de 2 a 4 palavras em ' +
        'minúsculas com o verbo no infinitivo, como "cancelar assinatura"; senão null.\n\nTarefas:\n' +
        (catalogo || '(nenhuma)'),
      mensagens: [{ role: 'user', content: texto.slice(0, 2000) }],
      esquema: Classificacao,
      simulacao: () => classificarPorRegras(tarefas, texto),
    });
    if (conversa.canal === 'widget') {
      this.ctx.banco.inserir('pedidos', {
        id: novoId('ped'),
        conversa_id: conversa.id,
        usuario_id: usuario.id,
        texto: texto.slice(0, 500),
        tipo: dados.tipo,
        tarefa_slug: dados.tipo === 'tarefa' ? dados.tarefa : null,
        tema: dados.tipo === 'sem_tarefa' ? (dados.tema ?? temaDoPedido(texto) ?? 'outros') : null,
        criado_em: agoraIso(),
      });
    }
    return dados;
  }

  // ---------------------------------------------------------------- testes de tarefa

  /** Ficha usada no teste: a do rascunho ou a publicada. */
  definicaoParaTeste(tarefaId: string, usarRascunho: boolean): TarefaDefinicao | null {
    const v = usarRascunho
      ? (this.ctx.catalogo.rascunho(tarefaId) ?? this.ctx.catalogo.publicada(tarefaId))
      : (this.ctx.catalogo.publicada(tarefaId) ?? this.ctx.catalogo.rascunho(tarefaId));
    return v?.definicao ?? null;
  }

  /** Roda os casos de teste de uma tarefa (só o primeiro turno do agente; nada é gravado) e guarda a rodada. */
  async rodarTestes(tarefaId: string, opcoes: { usarRascunho: boolean }): Promise<RodadaTestes> {
    const linha = this.ctx.catalogo.obter(tarefaId);
    if (!linha) throw naoEncontrado('Tarefa');
    const v = opcoes.usarRascunho
      ? (this.ctx.catalogo.rascunho(tarefaId) ?? this.ctx.catalogo.publicada(tarefaId))
      : (this.ctx.catalogo.publicada(tarefaId) ?? this.ctx.catalogo.rascunho(tarefaId));
    if (!v) throw new ErroHttp(409, 'sem_versao', 'Esta tarefa ainda não tem ficha salva.');
    const def = v.definicao;
    const casos = this.ctx.catalogo.testes(tarefaId);
    const usuarios = await this.ctx.adaptador.listarUsuarios().catch(() => [] as UsuarioSistema[]);
    const usuario =
      usuarios.find((u) => podeExecutar(def, u.perfis)) ??
      usuarios[0] ?? { id: 'teste', nome: 'Pessoa de teste', email: '', perfis: def.perfisPermitidos };
    const alvo: TarefaEmUso = { id: tarefaId, slug: linha.slug, versao: v.versao, status: linha.status, definicao: def };
    const outras = this.ctx.catalogo.emUso(usuario, false).filter((x) => x.id !== tarefaId);
    const tarefas = [alvo, ...outras];
    const resultados: ResultadoTeste[] = [];
    for (const caso of casos) resultados.push(await this.rodarCaso(caso, alvo, tarefas, usuario, usuarios));
    const rodada: RodadaTestes = {
      id: novoId('rod'),
      tarefaId,
      versao: v.versao,
      aprovados: resultados.filter((r) => r.aprovado).length,
      total: resultados.length,
      resultados,
      criadoEm: agoraIso(),
    };
    this.ctx.banco.inserir('testes_rodadas', {
      id: rodada.id,
      tarefa_id: tarefaId,
      versao: rodada.versao,
      aprovados: rodada.aprovados,
      total: rodada.total,
      resultados: rodada.resultados,
      criado_em: rodada.criadoEm,
    });
    return rodada;
  }

  private async rodarCaso(
    caso: CasoDeTeste,
    alvo: TarefaEmUso,
    tarefas: TarefaEmUso[],
    usuario: UsuarioSistema,
    usuarios: UsuarioSistema[],
  ): Promise<ResultadoTeste> {
    const def = alvo.definicao;
    const mensagens: MensagemLlm[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${cabecalhoData()}\n[Pessoa: ${usuario.nome} · perfis no ${this.ctx.adaptador.nome}: ${usuario.perfis.join(', ')}]\n[Modo de teste do console: nada é gravado no sistema]\n\n${caso.frase}`,
          },
        ],
      },
    ];
    const resposta = await this.ctx.llm.turno({
      finalidade: 'teste',
      sistema: this.sistema(),
      ferramentas: ferramentasDe(tarefas),
      mensagens,
      esforco: this.ctx.config.esforco,
      maxTokens: 8_000,
      simulacao: simularAgente({
        primeiroNome: fmt.primeiroNome(usuario.nome),
        sistema: this.ctx.adaptador.nome,
        tarefas,
        pessoas: usuarios.map((u) => u.nome),
      }),
    });
    const uso = resposta.conteudo.find(
      (b): b is UsoFerramenta => b.type === 'tool_use' && b.name === nomeFerramenta(alvo.slug),
    );
    const outra = resposta.conteudo.find((b): b is UsoFerramenta => b.type === 'tool_use' && b.name !== nomeFerramenta(alvo.slug));
    const textoResposta = resposta.conteudo
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ')
      .trim();

    let obtido: { resultado: 'pergunta' | 'confirmacao' | 'recusa'; campo?: string; valores?: Record<string, string>; resumo: string };
    if (!uso) {
      obtido = {
        resultado: 'recusa',
        resumo: outra
          ? `Não usou esta tarefa (escolheu ${outra.name === FERRAMENTA_CONHECIMENTO ? 'responder pela base de conhecimento' : outra.name.startsWith(PREFIXO_TAREFA) ? 'outra tarefa' : 'chamar uma pessoa'}).`
          : `Não usou esta tarefa. Respondeu: “${textoResposta.slice(0, 160)}”`,
      };
    } else {
      const entrada = (uso.input ?? {}) as Record<string, unknown>;
      const brutos: Record<string, string> = {};
      for (const c of def.campos) if (typeof entrada[c.chave] === 'string' || typeof entrada[c.chave] === 'number') brutos[c.chave] = String(entrada[c.chave]);
      const v = validarTarefa(def.campos, brutos, { id: usuario.id, nome: usuario.nome });
      if (v.invalidos.length) {
        obtido = { resultado: 'pergunta', campo: v.invalidos[0].campo.chave, resumo: `Pediu para corrigir ${v.invalidos[0].campo.rotulo.toLowerCase()}: ${v.invalidos[0].erro}` };
      } else if (v.faltando.length) {
        obtido = { resultado: 'pergunta', campo: v.faltando[0].chave, resumo: `Perguntou ${v.faltando[0].rotulo.toLowerCase()}.` };
      } else {
        const exib = camposExibidos(def, v.valores);
        obtido = {
          resultado: 'confirmacao',
          valores: v.valores,
          resumo: `Mostrou o cartão: ${exib.map((c) => `${c.rotulo} ${c.valor}`).join(' · ')}`,
        };
      }
    }

    const esp = caso.esperado;
    let aprovado = obtido.resultado === esp.resultado;
    const problemas: string[] = [];
    if (aprovado && esp.resultado === 'pergunta' && esp.campoPerguntado && obtido.campo !== esp.campoPerguntado) {
      aprovado = false;
      const c = def.campos.find((x) => x.chave === esp.campoPerguntado);
      problemas.push(`perguntar ${c?.rotulo.toLowerCase() ?? esp.campoPerguntado}`);
    }
    if (aprovado && esp.resultado === 'confirmacao' && esp.campos) {
      for (const [chave, esperado] of Object.entries(esp.campos)) {
        const campo = def.campos.find((x) => x.chave === chave);
        const valor = obtido.valores?.[chave] ?? '';
        if (!campo || !valoresIguais(campo, valor, esperado)) {
          aprovado = false;
          problemas.push(`${campo?.rotulo ?? chave} = ${esperado}`);
        }
      }
    }
    const esperadoTexto =
      esp.resultado === 'recusa'
        ? 'Não usar esta tarefa.'
        : esp.resultado === 'pergunta'
          ? `Perguntar ${problemas[0]?.replace(/^perguntar /, '') ?? def.campos.find((x) => x.chave === esp.campoPerguntado)?.rotulo.toLowerCase() ?? 'o dado que falta'}.`
          : `Mostrar o cartão com ${problemas.length ? problemas.join(', ') : Object.entries(esp.campos ?? {}).map(([k, val]) => `${k} = ${val}`).join(', ') || 'os dados completos'}.`;
    return { casoId: caso.id, frase: caso.frase, aprovado, obtido: obtido.resumo, esperado: aprovado ? undefined : esperadoTexto };
  }
}

function valoresIguais(campo: Campo, obtido: string, esperado: string): boolean {
  if (!obtido) return false;
  const a = normalizar(obtido);
  const b = normalizar(esperado);
  if (a === b) return true;
  if (normalizar(fmt.valorCampo(campo, obtido)) === b) return true;
  if (campo.tipo === 'documento' || campo.tipo === 'telefone') return a.replace(/\D/g, '') === b.replace(/\D/g, '');
  if (campo.tipo === 'lista') return a.replace(/\D/g, '') !== '' && a.replace(/\D/g, '') === b.replace(/\D/g, '');
  return false;
}

/** Classificação por regras (modelo simulado). */
export function classificarPorRegras(tarefas: TarefaEmUso[], texto: string): Classificacao {
  if (pedePessoa(texto)) return { tipo: 'humano', tarefa: null, tema: null };
  const duvida = pareceDuvida(texto);
  let melhor: { slug: string; p: number } | null = null;
  for (const x of tarefas) {
    const p = pontuarTarefa(x.definicao, texto);
    if (!melhor || p > melhor.p) melhor = { slug: x.slug, p };
  }
  if (melhor && melhor.p >= 3 && !duvida.forte) return { tipo: 'tarefa', tarefa: melhor.slug, tema: null };
  if (duvida.fraca) return { tipo: 'duvida', tarefa: null, tema: null };
  if (melhor && melhor.p >= 2) return { tipo: 'tarefa', tarefa: melhor.slug, tema: null };
  if (saudacao(texto) || agradecimento(texto)) return { tipo: 'conversa', tarefa: null, tema: null };
  const tema = temaDoPedido(texto);
  if (tema) return { tipo: 'sem_tarefa', tarefa: null, tema };
  return { tipo: 'nao_entendi', tarefa: null, tema: null };
}

export { textoDaPessoa };

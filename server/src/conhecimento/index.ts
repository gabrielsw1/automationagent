// Base de conhecimento do copiloto: fontes (site, arquivo, vídeo, respostas prontas) divididas em
// trechos no SQLite (FTS5), busca para o agente, perguntas sem resposta e o "Testar uma pergunta".
//
// A ingestão roda em segundo plano dentro do processo: cada fonte tem no máximo um trabalho por vez,
// com status e progresso gravados em conhecimento_fontes e avisos ao console (evento "fonte").
// Numa nova sincronização de uma fonte que já tem trechos, os novos são gravados à parte e trocados
// no fim, então a versão anterior continua valendo até a nova ficar pronta.
import fs from 'node:fs';
import path from 'node:path';
import type { FonteConhecimento, PerguntaSemResposta, RespostaTeste } from '@copiloto/shared';
import { agoraIso, type Banco } from '../db/banco.ts';
import type { Eventos } from '../eventos.ts';
import type { Llm } from '../llm/tipos.ts';
import { conflito, naoEncontrado } from '../util/erros.ts';
import { novoId } from '../util/ids.ts';
import { comoErroFonte } from './extratores.ts';
import { ErroFonte, errosFonte, LIMITE_ARQUIVO_MB } from './erros.ts';
import { contarTrechos, metaDe, paraFonte, type LinhaFonte, type MetaFonte, type RespostaPronta } from './fontes.ts';
import {
  caminhoAbsoluto,
  formatoDoArquivo,
  LIMITE_PAGINAS_MAX,
  LIMITE_PAGINAS_PADRAO,
  lerFonte,
  trechoDaResposta,
} from './ingestao.ts';
import { normalizarUrl } from './rastreador.ts';
import { gerarResposta } from './resposta.ts';
import { cobertura, consultaFts, normalizarChave, semelhancaDeChaves, termosDaPergunta } from './texto.ts';
import type { TrechoNovo } from './trechos.ts';
import type { BaseConhecimento, Trecho } from './tipos.ts';

export * from './tipos.ts';
export { consultaFts, normalizarChave } from './texto.ts';
export { ErroFonte } from './erros.ts';

/** Status cujos trechos o copiloto usa. "indexando": o que já foi lido pode ser citado. */
const FILTRO_STATUS = `(f.status IN ('indexado', 'indexando')
  OR (f.status = 'erro' AND json_extract(f.meta, '$.usaVersaoAnterior') = 1))`;

const SUFIXO_NOVA_VERSAO = '~nova';
const NOME_RESPOSTAS = 'Respostas prontas da equipe';

export interface OpcoesConhecimento {
  /** Para avisar o console (evento "fonte"). */
  eventos?: Eventos;
  /** DATA_DIR: os arquivos enviados ficam em DATA_DIR/conhecimento/<fonte>/. */
  dirDados?: string;
}

interface Trabalho {
  controle: AbortController;
  promessa: Promise<void>;
}

export class Conhecimento implements BaseConhecimento {
  private eventos?: Eventos;
  private dirDados?: string;
  private readonly trabalhos = new Map<string, Trabalho>();
  private readonly ultimoAviso = new Map<string, number>();

  constructor(
    private readonly banco: Banco,
    private readonly llm: Llm,
    opcoes: OpcoesConhecimento = {},
  ) {
    this.ligar(opcoes);
  }

  /** Liga as peças que o contexto não passa no construtor (as rotas do console chamam ao registrar). */
  ligar(opcoes: OpcoesConhecimento) {
    if (opcoes.eventos) this.eventos = opcoes.eventos;
    if (opcoes.dirDados) this.dirDados = opcoes.dirDados;
  }

  private get pastaDados(): string {
    return this.dirDados ?? path.resolve(process.env.DATA_DIR || 'data');
  }

  // ---------------------------------------------------------------- busca

  buscar(pergunta: string, limite = 5): Trecho[] {
    const grupos = termosDaPergunta(pergunta);
    const q = consultaFts(pergunta);
    if (!q || grupos.length === 0) return [];
    let linhas: { fonte_id: string; titulo: string; local: string | null; url: string | null; texto: string; rank: number }[];
    try {
      linhas = this.banco.todos(
        `SELECT t.fonte_id, t.titulo, t.local, t.url, t.texto,
                bm25(conhecimento_trechos, 0, 2.0, 0, 0, 1.0) AS rank
         FROM conhecimento_trechos t JOIN conhecimento_fontes f ON f.id = t.fonte_id
         WHERE conhecimento_trechos MATCH ? AND ${FILTRO_STATUS}
         ORDER BY rank LIMIT ?`,
        q,
        Math.max(limite * 6, 30),
      );
    } catch {
      return [];
    }
    if (!linhas.length) return [];
    const melhorBm25 = Math.max(...linhas.map((l) => -l.rank), 1e-9);
    const vistos = new Set<string>();
    return linhas
      .map((l) => {
        // Cobertura dos termos (no trecho todo e só no texto) pesa mais que o bm25, que favorece
        // trechos curtos.
        const cob = cobertura(grupos, `${l.titulo} ${l.local ?? ''} ${l.texto}`);
        const cobTexto = cobertura(grupos, l.texto);
        const bm = Math.max(0, -l.rank) / melhorBm25;
        return { l, cob, pontuacao: Math.round((0.5 * cob + 0.2 * cobTexto + 0.3 * bm) * 1000) / 1000 };
      })
      .filter((x) => x.cob >= 0.25)
      .sort((a, b) => b.pontuacao - a.pontuacao)
      .filter((x) => {
        const chave = x.l.texto.slice(0, 200);
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      })
      .slice(0, limite)
      .map(({ l, pontuacao }) => ({
        fonteId: l.fonte_id,
        titulo: l.titulo,
        local: l.local ?? undefined,
        url: l.url ?? undefined,
        texto: l.texto,
        pontuacao,
      }));
  }

  // ---------------------------------------------------------------- perguntas sem resposta

  /** Causa provável quando nada foi encontrado (mostrada em "Perguntas sem resposta"). */
  causaProvavel(): string {
    const indexando = this.banco.um<{ nome: string }>(
      "SELECT nome FROM conhecimento_fontes WHERE status = 'indexando' ORDER BY criado_em LIMIT 1",
    );
    if (indexando) return `Pode estar em “${indexando.nome}”, que ainda está indexando`;
    const comErro = this.banco.um<{ nome: string }>(
      "SELECT nome FROM conhecimento_fontes WHERE status = 'erro' AND COALESCE(json_extract(meta, '$.usaVersaoAnterior'), 0) = 0 ORDER BY criado_em LIMIT 1",
    );
    if (comErro) return `Provável causa: “${comErro.nome}” não foi lida`;
    return 'Nenhuma fonte fala disso';
  }

  /** Causa em português para a tela (o agente e o widget mandam códigos curtos). */
  private causaLegivel(causa: string | null | undefined): string {
    const c = (causa ?? '').trim();
    if (!c || c === 'sem_fonte' || c === 'sem_trechos') return this.causaProvavel();
    const CODIGOS: Record<string, string> = {
      sem_citacao: 'O copiloto respondeu sem citar nenhuma fonte',
      resposta_nao_ajudou: 'A pessoa marcou que a resposta não ajudou',
      nao_ajudou: 'A pessoa marcou que a resposta não ajudou',
    };
    return CODIGOS[c] ?? (/^[a-z]+(_[a-z]+)+$/.test(c) ? this.causaProvavel() : c);
  }

  registrarSemResposta(pergunta: string, causa: string) {
    const texto = pergunta.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!texto) return;
    const chave = normalizarChave(texto);
    const causaFinal = this.causaLegivel(causa);
    const agora = agoraIso();
    let alvo = this.banco.um<{ id: string }>('SELECT id FROM perguntas_sem_resposta WHERE chave = ?', chave);
    if (!alvo) {
      // Pergunta parecida (mesmos radicais, com uma ou outra palavra a mais) entra no mesmo grupo.
      const candidatas = this.banco.todos<{ id: string; chave: string }>(
        'SELECT id, chave FROM perguntas_sem_resposta ORDER BY resolvida, ultima_em DESC LIMIT 1000',
      );
      let melhor = { id: '', nota: 0 };
      for (const c of candidatas) {
        const nota = semelhancaDeChaves(chave, c.chave);
        if (nota > melhor.nota) melhor = { id: c.id, nota };
      }
      if (melhor.nota >= 0.6) alvo = { id: melhor.id };
    }
    if (alvo) {
      // Respondida e perguntada de novo sem resposta: volta para a lista. Ignorada continua ignorada.
      this.banco.executar(
        `UPDATE perguntas_sem_resposta SET vezes = vezes + 1, ultima_em = ?, causa = ?,
         resolvida = CASE WHEN resolvida = 2 THEN 2 ELSE 0 END WHERE id = ?`,
        agora,
        causaFinal,
        alvo.id,
      );
      return;
    }
    this.banco.inserir('perguntas_sem_resposta', {
      id: novoId('psr'),
      pergunta: texto,
      chave,
      causa: causaFinal,
      vezes: 1,
      ultima_em: agora,
      resolvida: 0,
    });
  }

  /** Perguntas sem resposta dos últimos 30 dias, das mais repetidas para as menos. */
  listarSemResposta(dias = 30): PerguntaSemResposta[] {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    return this.banco
      .todos<{ id: string; pergunta: string; causa: string; vezes: number; ultima_em: string }>(
        `SELECT id, pergunta, causa, vezes, ultima_em FROM perguntas_sem_resposta
         WHERE resolvida = 0 AND ultima_em >= ? ORDER BY vezes DESC, ultima_em DESC LIMIT 50`,
        desde,
      )
      .map((l) => ({ id: l.id, pergunta: l.pergunta, causa: l.causa, vezes: l.vezes, ultimaEm: l.ultima_em }));
  }

  /** Pergunta ainda na lista (404 se não existe, 409 se já foi respondida ou ignorada). */
  perguntaAberta(id: string) {
    const l = this.banco.um<{ id: string; pergunta: string; resolvida: number }>(
      'SELECT id, pergunta, resolvida FROM perguntas_sem_resposta WHERE id = ?',
      id,
    );
    if (!l) throw naoEncontrado('Pergunta');
    if (l.resolvida !== 0) throw conflito('Esta pergunta já foi respondida ou ignorada.');
    return l;
  }

  /** "Responder": cria uma resposta pronta com o texto da equipe e tira a pergunta da lista. */
  responderSemResposta(id: string, resposta: string, autor: string | null, pergunta?: string): FonteConhecimento {
    const l = this.perguntaAberta(id);
    const fonte = this.adicionarResposta({ pergunta: pergunta?.trim() || l.pergunta, resposta, autor });
    this.banco.executar('UPDATE perguntas_sem_resposta SET resolvida = 1, resposta = ? WHERE id = ?', resposta.trim(), id);
    return fonte;
  }

  ignorarSemResposta(id: string) {
    this.perguntaAberta(id);
    this.banco.executar('UPDATE perguntas_sem_resposta SET resolvida = 2 WHERE id = ?', id);
  }

  // ---------------------------------------------------------------- resposta completa

  async responder(pergunta: string): Promise<RespostaTeste> {
    const inicio = Date.now();
    const texto = pergunta.replace(/\s+/g, ' ').trim();
    const trechos = this.buscar(texto, 5);
    if (trechos.length === 0) {
      this.registrarSemResposta(texto, this.causaProvavel());
      return {
        texto: 'Não encontrei isso nas fontes cadastradas.',
        citacoes: [],
        confianca: 'baixa',
        duracaoMs: Date.now() - inicio,
      };
    }
    const r = await gerarResposta(this.llm, texto, trechos);
    if (r.semResposta) this.registrarSemResposta(texto, 'As fontes encontradas não respondem a isso');
    return { ...r.resposta, duracaoMs: Date.now() - inicio };
  }

  // ---------------------------------------------------------------- fontes

  private linha(id: string): LinhaFonte | undefined {
    return this.banco.um<LinhaFonte>('SELECT * FROM conhecimento_fontes WHERE id = ?', id);
  }

  private linhaOuErro(id: string): LinhaFonte {
    const l = this.linha(id);
    if (!l) throw naoEncontrado('Fonte');
    return l;
  }

  listarFontes(): FonteConhecimento[] {
    const contagem = contarTrechos(this.banco);
    return this.banco
      .todos<LinhaFonte>('SELECT * FROM conhecimento_fontes ORDER BY criado_em, rowid')
      .map((l) => paraFonte(l, contagem.get(l.id) ?? 0));
  }

  fonte(id: string): FonteConhecimento {
    const l = this.linhaOuErro(id);
    const n = this.banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM conhecimento_trechos WHERE fonte_id = ?', id)?.n ?? 0;
    return paraFonte(l, n);
  }

  /** Primeiros trechos de uma fonte ("Ver trechos" no console). */
  trechosDaFonte(id: string, limite = 50): { titulo: string; local: string | null; url: string | null; texto: string }[] {
    this.linhaOuErro(id);
    return this.banco.todos(
      'SELECT titulo, local, url, texto FROM conhecimento_trechos WHERE fonte_id = ? ORDER BY rowid LIMIT ?',
      id,
      limite,
    );
  }

  private avisar(id: string, status: string, forcar = true) {
    if (!this.eventos) return;
    const agora = Date.now();
    if (!forcar && agora - (this.ultimoAviso.get(id) ?? 0) < 300) return;
    this.ultimoAviso.set(id, agora);
    this.eventos.emitirConsole({ tipo: 'fonte', fonteId: id, status });
  }

  private pastaDaFonte(id: string): string {
    return path.join(this.pastaDados, 'conhecimento', id);
  }

  /** Grava o arquivo enviado em DATA_DIR/conhecimento/<fonte>/ e devolve o caminho relativo a DATA_DIR. */
  private guardarArquivo(id: string, nome: string, dados: Buffer): string {
    const pasta = this.pastaDaFonte(id);
    fs.rmSync(pasta, { recursive: true, force: true });
    fs.mkdirSync(pasta, { recursive: true });
    const seguro = nomeSeguro(nome);
    fs.writeFileSync(path.join(pasta, seguro), dados);
    return path.join('conhecimento', id, seguro);
  }

  adicionarSite(p: { url: string; limitePaginas?: number; nome?: string; enviadoPor?: string | null }): FonteConhecimento {
    let url: URL;
    try {
      url = new URL(p.url.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      throw errosFonte.urlInvalida();
    }
    const origem = normalizarUrl(url);
    const existente = this.banco
      .todos<{ id: string; origem: string }>("SELECT id, origem FROM conhecimento_fontes WHERE tipo = 'site'")
      .find((f) => {
        try {
          return normalizarUrl(new URL(f.origem)) === origem;
        } catch {
          return false;
        }
      });
    if (existente) throw conflito('Este site já está nas fontes. Use "Sincronizar" no cartão dele para ler de novo.');
    const limite = Math.max(1, Math.min(Math.round(p.limitePaginas ?? LIMITE_PAGINAS_PADRAO), LIMITE_PAGINAS_MAX));
    const id = novoId('fnt');
    const nomeAutomatico = !p.nome?.trim();
    this.banco.inserir('conhecimento_fontes', {
      id,
      tipo: 'site',
      nome: p.nome?.trim() || `${url.host}${url.pathname === '/' ? '' : url.pathname}`,
      origem,
      status: 'indexando',
      meta: { limitePaginas: limite, nomeAutomatico } satisfies MetaFonte,
      progresso_feitos: 0,
      progresso_total: null,
      enviado_por: p.enviadoPor ?? null,
      criado_em: agoraIso(),
    });
    this.iniciar(id);
    return this.fonte(id);
  }

  adicionarArquivo(p: { nomeArquivo: string; dados: Buffer; enviadoPor?: string | null; substituir?: string }): FonteConhecimento {
    const nomeArquivo = path.basename(p.nomeArquivo.replace(/\\/g, '/')).trim() || 'arquivo';
    const formato = formatoDoArquivo(nomeArquivo);
    if (!formato || formato === 'vtt' || formato === 'srt') throw errosFonte.tipoNaoAceito(path.extname(nomeArquivo).slice(1).toLowerCase());
    if (p.dados.length > LIMITE_ARQUIVO_MB * 1024 * 1024) throw errosFonte.arquivoGrande();
    if (p.dados.length === 0) throw errosFonte.arquivoVazio();

    const meta: MetaFonte = { formato, tamanho: p.dados.length, nomeArquivo };
    if (p.substituir) {
      const atual = this.linhaOuErro(p.substituir);
      if (atual.tipo !== 'arquivo') throw conflito('Só dá para trocar o arquivo de uma fonte do tipo arquivo.');
      this.parar(atual.id);
      const arquivo = this.guardarArquivo(atual.id, nomeArquivo, p.dados);
      this.banco.atualizar('conhecimento_fontes', atual.id, {
        nome: nomeArquivo,
        origem: nomeArquivo,
        status: 'indexando',
        erro: null,
        como_resolver: null,
        meta,
        progresso_feitos: 0,
        progresso_total: null,
        arquivo,
        enviado_por: p.enviadoPor ?? atual.enviado_por,
      });
      this.iniciar(atual.id);
      return this.fonte(atual.id);
    }
    const id = novoId('fnt');
    const arquivo = this.guardarArquivo(id, nomeArquivo, p.dados);
    this.banco.inserir('conhecimento_fontes', {
      id,
      tipo: 'arquivo',
      nome: nomeArquivo,
      origem: nomeArquivo,
      status: 'indexando',
      meta,
      progresso_feitos: 0,
      progresso_total: null,
      arquivo,
      enviado_por: p.enviadoPor ?? null,
      criado_em: agoraIso(),
    });
    this.iniciar(id);
    return this.fonte(id);
  }

  adicionarVideo(p: {
    nome?: string;
    texto?: string;
    arquivo?: { nome: string; dados: Buffer };
    url?: string;
    enviadoPor?: string | null;
  }): FonteConhecimento {
    let dados: Buffer;
    let formato: MetaFonte['formato'];
    let nomeArquivo: string;
    if (p.arquivo) {
      nomeArquivo = path.basename(p.arquivo.nome.replace(/\\/g, '/')) || 'transcricao.txt';
      const f = formatoDoArquivo(nomeArquivo);
      if (f !== 'vtt' && f !== 'srt' && f !== 'txt') {
        throw new ErroFonte(
          'tipo_nao_aceito',
          'Para vídeos, envie a transcrição em .vtt, .srt ou .txt.',
          'Baixe a legenda do vídeo (nas opções do player ou da plataforma) ou cole o texto da transcrição no campo de texto.',
        );
      }
      formato = f;
      dados = p.arquivo.dados;
    } else {
      const texto = (p.texto ?? '').trim();
      if (!texto) throw errosFonte.transcricaoVazia();
      formato = 'texto';
      nomeArquivo = 'transcricao.txt';
      dados = Buffer.from(texto, 'utf8');
    }
    if (dados.length === 0) throw errosFonte.transcricaoVazia();
    if (dados.length > LIMITE_ARQUIVO_MB * 1024 * 1024) throw errosFonte.arquivoGrande();
    let url: string | undefined;
    if (p.url?.trim()) {
      try {
        const u = new URL(p.url.trim());
        if (!/^https?:$/.test(u.protocol)) throw new Error();
        url = u.toString();
      } catch {
        throw errosFonte.urlInvalida();
      }
    }
    const id = novoId('fnt');
    const arquivo = this.guardarArquivo(id, nomeArquivo, dados);
    const nome = p.nome?.trim() || (p.arquivo ? nomeArquivo.replace(/\.[^.]+$/, '') : 'Vídeo sem título');
    this.banco.inserir('conhecimento_fontes', {
      id,
      tipo: 'video',
      nome,
      origem: url ?? (p.arquivo ? nomeArquivo : 'Transcrição colada'),
      status: 'indexando',
      meta: { formato, url, nomeArquivo: p.arquivo ? nomeArquivo : undefined } satisfies MetaFonte,
      progresso_feitos: 0,
      progresso_total: null,
      arquivo,
      enviado_por: p.enviadoPor ?? null,
      criado_em: agoraIso(),
    });
    this.iniciar(id);
    return this.fonte(id);
  }

  /** Acrescenta uma resposta pronta (pergunta + resposta) à fonte "Respostas prontas da equipe". */
  adicionarResposta(p: { pergunta: string; resposta: string; autor?: string | null }): FonteConhecimento {
    const pergunta = p.pergunta.replace(/\s+/g, ' ').trim();
    const resposta = p.resposta.trim();
    let l = this.banco.um<LinhaFonte>("SELECT * FROM conhecimento_fontes WHERE tipo = 'respostas' ORDER BY criado_em LIMIT 1");
    const agora = agoraIso();
    if (!l) {
      const id = novoId('fnt');
      this.banco.inserir('conhecimento_fontes', {
        id,
        tipo: 'respostas',
        nome: NOME_RESPOSTAS,
        origem: 'Escritas pela equipe no console',
        status: 'indexado',
        meta: { itens: [] } satisfies MetaFonte,
        enviado_por: p.autor ?? null,
        criado_em: agora,
        sincronizado_em: agora,
      });
      l = this.linhaOuErro(id);
    }
    const meta = metaDe(l);
    // Fonte criada por fora (seed) sem a lista: recupera as respostas a partir dos trechos.
    const itens: RespostaPronta[] =
      meta.itens ??
      this.banco
        .todos<{ titulo: string; texto: string }>('SELECT titulo, texto FROM conhecimento_trechos WHERE fonte_id = ? ORDER BY rowid', l.id)
        .map((t) => ({
          id: novoId('rsp'),
          pergunta: t.titulo,
          resposta: t.texto.startsWith(t.titulo) ? t.texto.slice(t.titulo.length).trim() : t.texto,
          autor: null,
          em: l!.criado_em,
        }));
    itens.push({ id: novoId('rsp'), pergunta, resposta, autor: p.autor ?? null, em: agora });
    const id = l.id;
    this.banco.transacao(() => {
      this.inserirTrechos(id, [trechoDaResposta({ pergunta, resposta })]);
      this.banco.atualizar('conhecimento_fontes', id, {
        meta: { ...meta, itens },
        sincronizado_em: agora,
        ...(l!.status === 'erro' ? { status: 'indexado', erro: null, como_resolver: null } : {}),
      });
    });
    this.avisar(id, this.linhaOuErro(id).status);
    return this.fonte(id);
  }

  sincronizar(id: string): FonteConhecimento {
    const l = this.linhaOuErro(id);
    if (this.trabalhos.has(id)) return this.fonte(id);
    this.banco.atualizar('conhecimento_fontes', l.id, {
      status: 'indexando',
      erro: null,
      como_resolver: null,
      progresso_feitos: 0,
      progresso_total: null,
    });
    this.iniciar(id);
    return this.fonte(id);
  }

  /** Pausa a indexação (ou o uso) da fonte: o copiloto deixa de usá-la até sincronizar de novo. */
  pausar(id: string): FonteConhecimento {
    const l = this.linhaOuErro(id);
    if (l.status !== 'pausado') {
      this.banco.atualizar('conhecimento_fontes', id, { status: 'pausado' });
      this.parar(id);
      this.avisar(id, 'pausado');
    }
    return this.fonte(id);
  }

  /** Remove a fonte, os trechos e os arquivos guardados. */
  remover(id: string) {
    this.linhaOuErro(id);
    this.parar(id);
    this.banco.transacao(() => {
      this.banco.executar('DELETE FROM conhecimento_trechos WHERE fonte_id IN (?, ?)', id, id + SUFIXO_NOVA_VERSAO);
      this.banco.executar('DELETE FROM conhecimento_fontes WHERE id = ?', id);
    });
    fs.rmSync(this.pastaDaFonte(id), { recursive: true, force: true });
    this.avisar(id, 'removido');
  }

  /** Retoma indexações que ficaram pela metade (chamado ao iniciar o servidor). */
  retomar() {
    const pendentes = this.banco.todos<LinhaFonte>("SELECT * FROM conhecimento_fontes WHERE status = 'indexando'");
    for (const l of pendentes) {
      const meta = metaDe(l);
      if (meta.exemplo) continue; // demonstração do seed: fica "indexando" de propósito
      if ((l.tipo === 'arquivo' || l.tipo === 'video') && !l.arquivo) continue;
      this.iniciar(l.id);
    }
  }

  /** Espera os trabalhos em andamento terminarem (testes e encerramento). */
  async aguardar(id?: string): Promise<void> {
    for (;;) {
      const lista = id ? [this.trabalhos.get(id)].filter(Boolean) : [...this.trabalhos.values()];
      if (!lista.length) return;
      await Promise.allSettled(lista.map((t) => t!.promessa));
    }
  }

  /** Interrompe todos os trabalhos (ao fechar o servidor). */
  parar(id?: string) {
    const ids = id ? [id] : [...this.trabalhos.keys()];
    for (const i of ids) this.trabalhos.get(i)?.controle.abort(new Error('interrompido'));
  }

  emAndamento(id: string): boolean {
    return this.trabalhos.has(id);
  }

  // ---------------------------------------------------------------- indexação

  private inserirTrechos(fonteId: string, trechos: TrechoNovo[]) {
    for (const t of trechos) {
      if (!t.texto.trim()) continue;
      this.banco.executar(
        'INSERT INTO conhecimento_trechos (fonte_id, titulo, local, url, texto) VALUES (?, ?, ?, ?, ?)',
        fonteId,
        t.titulo,
        t.local ?? null,
        t.url ?? null,
        t.texto,
      );
    }
  }

  private iniciar(id: string) {
    const anterior = this.trabalhos.get(id);
    if (anterior) anterior.controle.abort(new Error('reiniciado'));
    const controle = new AbortController();
    const trabalho: Trabalho = {
      controle,
      promessa: (async () => {
        if (anterior) await anterior.promessa.catch(() => {});
        await this.processar(id, controle.signal);
      })()
        .catch((e) => {
          if (!controle.signal.aborted) console.error(`[conhecimento] falha inesperada na fonte ${id}:`, e);
        })
        .finally(() => {
          if (this.trabalhos.get(id) === trabalho) this.trabalhos.delete(id);
        }),
    };
    this.trabalhos.set(id, trabalho);
  }

  private async processar(id: string, sinal: AbortSignal): Promise<void> {
    const l = this.linha(id);
    if (!l || sinal.aborted) return;
    const contagem = this.banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM conhecimento_trechos WHERE fonte_id = ?', id)?.n ?? 0;
    // Primeira leitura: grava direto (o que já foi lido pode ser citado). Nova sincronização: grava
    // à parte e troca no fim, para a versão anterior valer até a nova ficar pronta.
    const direto = contagem === 0;
    const destino = direto ? id : id + SUFIXO_NOVA_VERSAO;
    this.banco.executar('DELETE FROM conhecimento_trechos WHERE fonte_id = ?', id + SUFIXO_NOVA_VERSAO);
    this.banco.atualizar('conhecimento_fontes', id, {
      status: 'indexando',
      erro: null,
      como_resolver: null,
      progresso_feitos: 0,
      progresso_total: l.progresso_total ?? null,
    });
    this.avisar(id, 'indexando');

    let tituloSite: string | undefined;
    try {
      const novoMeta = await lerFonte(l, {
        dirDados: this.pastaDados,
        sinal,
        gravar: (trechos) => {
          if (sinal.aborted || !trechos.length) return;
          if (!tituloSite) tituloSite = trechos[0].titulo;
          this.banco.transacao(() => this.inserirTrechos(destino, trechos));
        },
        progresso: (feitos, total) => {
          if (sinal.aborted) return;
          this.banco.atualizar('conhecimento_fontes', id, { progresso_feitos: feitos, progresso_total: total });
          this.avisar(id, 'indexando', false);
        },
      });
      if (sinal.aborted) throw sinal.reason;
      const atual = this.linha(id);
      if (!atual) return;
      const meta: MetaFonte = { ...metaDe(atual), ...novoMeta };
      delete meta.usaVersaoAnterior;
      const nome = atual.tipo === 'site' && meta.nomeAutomatico && tituloSite ? tituloSite : atual.nome;
      if (nome !== atual.nome) meta.nomeAutomatico = false;
      // Respostas prontas criadas por fora (sem a lista): os trechos atuais continuam.
      const semLista = atual.tipo === 'respostas' && !metaDe(atual).itens;
      this.banco.transacao(() => {
        if (!direto && !semLista) {
          this.banco.executar('DELETE FROM conhecimento_trechos WHERE fonte_id = ?', id);
          this.banco.executar('UPDATE conhecimento_trechos SET fonte_id = ? WHERE fonte_id = ?', id, destino);
        }
        this.banco.atualizar('conhecimento_fontes', id, {
          nome,
          status: 'indexado',
          erro: null,
          como_resolver: null,
          meta,
          progresso_feitos: null,
          progresso_total: null,
          sincronizado_em: agoraIso(),
        });
      });
      this.avisar(id, 'indexado');
    } catch (e) {
      if (sinal.aborted) {
        // Pausada, removida, reiniciada ou servidor fechando: quem interrompeu já cuidou do status.
        try {
          if (!direto) this.banco.executar('DELETE FROM conhecimento_trechos WHERE fonte_id = ?', destino);
        } catch {
          /* banco já fechado */
        }
        return;
      }
      if (!direto) this.banco.executar('DELETE FROM conhecimento_trechos WHERE fonte_id = ?', destino);
      const erro = comoErroFonte(e);
      if (!(e instanceof ErroFonte)) console.error(`[conhecimento] falha ao ler a fonte ${id}:`, e);
      const atual = this.linha(id);
      if (!atual) return;
      const meta = metaDe(atual);
      const manter = !direto && !!atual.sincronizado_em;
      if (direto) this.banco.executar('DELETE FROM conhecimento_trechos WHERE fonte_id = ?', id);
      this.banco.atualizar('conhecimento_fontes', id, {
        status: 'erro',
        erro: manter
          ? `${erro.message} O copiloto continua usando a versão lida em ${dataCurta(atual.sincronizado_em!)}.`
          : erro.message,
        como_resolver: erro.comoResolver,
        meta: { ...meta, usaVersaoAnterior: manter || undefined },
        progresso_feitos: null,
        progresso_total: null,
      });
      this.avisar(id, 'erro');
    }
  }
}

function dataCurta(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso),
  );
}

/** Nome de arquivo seguro para o disco (sem pastas, sem caracteres estranhos). */
export function nomeSeguro(nome: string): string {
  const base = path.basename(nome.replace(/\\/g, '/'));
  const limpo = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-120);
  return limpo || 'arquivo';
}

export { caminhoAbsoluto };

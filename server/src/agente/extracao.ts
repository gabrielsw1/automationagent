// Extração de dados por regras (sem modelo): usada pelo agente simulado, pelos testes e pela
// classificação simulada. Com o Claude, quem extrai os dados é o modelo; a validação é sempre
// determinística (validarTarefa).
import type { Campo, TarefaDefinicao } from '@copiloto/shared';

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/** Data de hoje no fuso de São Paulo. */
export function hojeSp(agora = new Date()): { ano: number; mes: number; dia: number; semana: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'));
  return { ano: Number(v('year')), mes: Number(v('month')), dia: Number(v('day')), semana };
}

function iso(ano: number, mes: number, dia: number): string {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.toISOString().slice(0, 10);
}

function somarDias(base: { ano: number; mes: number; dia: number }, n: number): string {
  const d = new Date(Date.UTC(base.ano, base.mes - 1, base.dia + n));
  return d.toISOString().slice(0, 10);
}

function ultimoDia(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Tira do texto o que confunde as datas (documentos, e-mails, telefones). */
function semDocumentos(texto: string): string {
  return texto
    .replace(/[^\s@,;]+@[^\s@,;]+/g, ' ')
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, ' ')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, ' ');
}

/** "amanhã", "sexta", "22/10", "dia 22", "22 de outubro" → AAAA-MM-DD. */
export function dataMencionada(texto: string, agora = new Date()): string | null {
  const t = normalizar(semDocumentos(texto));
  const hoje = hojeSp(agora);
  if (/\bdepois de amanha\b/.test(t)) return somarDias(hoje, 2);
  if (/\bamanha\b/.test(t)) return somarDias(hoje, 1);
  if (/\bhoje\b/.test(t)) return somarDias(hoje, 0);
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
    let ano = m[3] ? +m[3] : hoje.ano;
    if (ano < 100) ano += 2000;
    if (!m[3] && (+m[2] < hoje.mes || (+m[2] === hoje.mes && +m[1] < hoje.dia))) ano += 1;
    return iso(ano, +m[2], +m[1]);
  }
  m = t.match(new RegExp(`\\b(\\d{1,2}) de (${MESES.join('|')})(?: de (\\d{4}))?\\b`));
  if (m) {
    const mes = MESES.indexOf(m[2]) + 1;
    let ano = m[3] ? +m[3] : hoje.ano;
    if (!m[3] && (mes < hoje.mes || (mes === hoje.mes && +m[1] < hoje.dia))) ano += 1;
    return iso(ano, mes, +m[1]);
  }
  m = t.match(/\bdia (\d{1,2})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    let { ano, mes } = hoje;
    if (+m[1] < hoje.dia) {
      mes += 1;
      if (mes > 12) {
        mes = 1;
        ano += 1;
      }
    }
    return iso(ano, mes, Math.min(+m[1], ultimoDia(ano, mes)));
  }
  m = t.match(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\b/);
  if (m) {
    const alvo = DIAS_SEMANA.indexOf(m[1]);
    let dif = (alvo - hoje.semana + 7) % 7;
    if (dif === 0) dif = 7;
    return somarDias(hoje, dif);
  }
  return null;
}

/** Mês citado ("setembro", "mês passado", "este mês") → primeiro e último dia. */
export function mesMencionado(texto: string, agora = new Date()): { inicio: string; fim: string; mes: number; ano: number } | null {
  const t = normalizar(texto);
  const hoje = hojeSp(agora);
  let mes: number | null = null;
  let ano = hoje.ano;
  if (/\b(mes passado|ultimo mes)\b/.test(t)) {
    mes = hoje.mes - 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  } else if (/\b(este mes|deste mes|mes atual|esse mes|desse mes)\b/.test(t)) {
    mes = hoje.mes;
  } else {
    const m = t.match(new RegExp(`\\b(${MESES.join('|')})(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`));
    if (m) {
      mes = MESES.indexOf(m[1]) + 1;
      if (m[2]) ano = +m[2];
      else if (mes > hoje.mes) ano -= 1;
    } else {
      const c = t.match(/\b(\d{1,2})\/(\d{4})\b/);
      if (c && +c[1] >= 1 && +c[1] <= 12) {
        mes = +c[1];
        ano = +c[2];
      }
    }
  }
  if (!mes) return null;
  return { inicio: iso(ano, mes, 1), fim: iso(ano, mes, ultimoDia(ano, mes)), mes, ano };
}

/** "14h", "às 9h30", "14:00", "às 14" → HH:MM. */
export function horaMencionada(texto: string): string | null {
  const t = normalizar(semDocumentos(texto));
  let m = t.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(?:h|hs|horas)?\b/);
  if (!m) m = t.match(/\bas (\d{1,2})(?!\s*(?:dias|de|\/|\d))\b/);
  if (!m) return null;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const SINONIMOS: Record<string, string[]> = {
  planilha: ['planilha', 'excel', 'xlsx', 'csv'],
  pdf: ['pdf'],
  'primeiro disponivel': ['primeiro disponivel', 'qualquer tecnico', 'qualquer um', 'tanto faz'],
  urgente: ['urgente', 'urgencia'],
};

/** Opção da lista citada no texto (palavra inteira, número com a unidade ou sinônimo). */
export function opcaoMencionada(campo: Campo, texto: string): string | null {
  const opcoes = campo.opcoes ?? [];
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  const achadas = opcoes.filter((o) => {
    const n = normalizar(o).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const sin = SINONIMOS[n] ?? [n];
    return sin.some((s) => t.includes(` ${s} `));
  });
  if (achadas.length >= 1) return achadas.sort((a, b) => b.length - a.length)[0];
  // "prazo de 30" / "30 dias" / "30d".
  const palavra = normalizar(campo.rotulo).split(' ')[0];
  for (const o of opcoes) {
    const d = o.match(/\d+/)?.[0];
    if (!d) continue;
    const unidade = normalizar(o).replace(d, '').trim().split(' ')[0];
    const perto = new RegExp(`\\b${palavra}\\D{0,15}\\b${d}\\b|\\b${d}\\s*${unidade ? `(?:${unidade}|d)\\b` : ''}`);
    if (unidade && perto.test(t)) return o;
  }
  return null;
}

const PARADA_NOME = new Set([
  'cnpj', 'cpf', 'e-mail', 'email', 'prazo', 'plano', 'para', 'pra', 'com', 'no', 'na', 'em', 'dia', 'amanha', 'amanhã',
  'hoje', 'as', 'às', 'que', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'por', 'pelo', 'pela', 'sobre', 'responsavel',
  'responsável', 'agora', 'urgente', 'boleto', 'visita', 'relatorio', 'relatório',
]);
const CONECTORES = new Set(['de', 'da', 'do', 'dos', 'das', 'e', '&']);
const NAO_NOMES = new Set([...MESES, ...DIAS_SEMANA, 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira']);

function maiuscula(token: string): boolean {
  return /^[\p{Lu}\d]/u.test(token);
}

/** Nome de empresa ou cliente: "cliente ACME Logística", "da Padaria Estrela", "na Transportes Vale". */
export function nomeMencionado(texto: string, excluir: string[] = []): string | null {
  const excl = new Set(excluir.map(normalizar));
  const tokens = texto.match(/[\p{L}\p{N}&'.-]+|[,;:!?()]/gu) ?? [];
  const candidatos: { nome: string; prioridade: number; pos: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = normalizar(tokens[i]);
    let inicio = -1;
    let prioridade = 0;
    if (['cliente', 'empresa'].includes(tk)) {
      inicio = i + 1;
      prioridade = 3;
    } else if (tk === 'razao' && normalizar(tokens[i + 1] ?? '') === 'social') {
      inicio = i + 2;
      prioridade = 3;
    } else if (['da', 'do', 'na', 'no', 'pra', 'para', 'cliente:'].includes(tk)) {
      inicio = i + 1;
      prioridade = 1;
      if (['a', 'o'].includes(normalizar(tokens[inicio] ?? '')) && tk === 'para') inicio++;
    }
    if (inicio < 0) continue;
    while (['é', 'e', ':', 'o', 'a', 'chamado', 'chamada'].includes((tokens[inicio] ?? '').toLowerCase()) && prioridade === 3) inicio++;
    const partes: string[] = [];
    const comMaiuscula = maiuscula(tokens[inicio] ?? '');
    if (!comMaiuscula && prioridade < 3) continue;
    for (let j = inicio; j < tokens.length && partes.length < 6; j++) {
      const t = tokens[j];
      const n = normalizar(t);
      if (/^[,;:!?()]$/.test(t)) break;
      if (/^\d{2}\.?\d{3}/.test(t) || t.includes('@')) break;
      if (comMaiuscula) {
        if (maiuscula(t) && !NAO_NOMES.has(n)) partes.push(t);
        else if (CONECTORES.has(n) && maiuscula(tokens[j + 1] ?? '') && partes.length) partes.push(t);
        else break;
      } else {
        if (PARADA_NOME.has(n) || NAO_NOMES.has(n)) break;
        partes.push(t);
      }
    }
    const nome = partes.join(' ').replace(/[.'-]+$/, '').trim();
    if (nome.length >= 2 && !excl.has(normalizar(nome))) candidatos.push({ nome, prioridade, pos: i });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.prioridade - a.prioridade || a.pos - b.pos);
  return candidatos[0].nome;
}

const REGEX_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
const REGEX_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const REGEX_EMAIL = /[^\s@,;:<>()]+@[^\s@,;:<>()]+\.[^\s@,;:<>()]+/;
const REGEX_TELEFONE = /\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/;

function ehCampoDeNome(c: Campo): boolean {
  const k = normalizar(`${c.chave} ${c.rotulo}`);
  return c.tipo === 'texto' && /(nome|empresa|cliente|razao)/.test(k);
}

/**
 * Valores que dá para tirar do texto com segurança, por campo. Não inventa: campo sem pista fica de fora.
 * `pessoas` são os nomes dos usuários do sistema (para campos do tipo pessoa).
 */
export function extrairCampos(
  campos: Campo[],
  texto: string,
  opcoes: { agora?: Date; pessoas?: string[] } = {},
): Record<string, string> {
  const agora = opcoes.agora ?? new Date();
  const r: Record<string, string> = {};
  const opcoesDeListas = campos.flatMap((c) => c.opcoes ?? []);
  const datas = campos.filter((c) => c.tipo === 'data');
  const periodo = datas.length >= 2 ? mesMencionado(texto, agora) : null;
  for (const c of campos) {
    const k = normalizar(`${c.chave} ${c.rotulo}`);
    switch (c.tipo) {
      case 'documento': {
        const m = texto.match(REGEX_CNPJ) ?? texto.match(REGEX_CPF);
        if (m) r[c.chave] = m[0];
        break;
      }
      case 'email': {
        const m = texto.match(REGEX_EMAIL);
        if (m) r[c.chave] = m[0].replace(/[.]+$/, '');
        break;
      }
      case 'telefone': {
        const m = semDocumentos(texto).match(REGEX_TELEFONE);
        if (m) r[c.chave] = m[0];
        break;
      }
      case 'data': {
        if (periodo && /(inicio|de$|desde)/.test(k)) r[c.chave] = periodo.inicio;
        else if (periodo && /(fim|final|ate)/.test(k)) r[c.chave] = periodo.fim;
        else {
          const d = dataMencionada(texto, agora);
          if (d) r[c.chave] = d;
        }
        break;
      }
      case 'hora': {
        const h = horaMencionada(texto);
        if (h) r[c.chave] = h;
        break;
      }
      case 'lista': {
        const o = opcaoMencionada(c, texto);
        if (o) r[c.chave] = o;
        break;
      }
      case 'pessoa': {
        const t = normalizar(texto);
        const p = (opcoes.pessoas ?? []).find((nome) => t.includes(normalizar(nome)));
        if (p) r[c.chave] = p;
        break;
      }
      case 'texto': {
        if (/competencia/.test(k)) {
          const m = mesMencionado(texto, agora);
          if (m) r[c.chave] = `${String(m.mes).padStart(2, '0')}/${m.ano}`;
        } else if (ehCampoDeNome(c)) {
          const n = nomeMencionado(texto, opcoesDeListas);
          if (n) r[c.chave] = n;
        } else if (/assunto/.test(k)) {
          const m = texto.match(/\b(?:sobre|assunto:?)\s+([^,.;]+)/i);
          if (m) r[c.chave] = m[1].trim();
        }
        break;
      }
      case 'numero':
      case 'moeda': {
        const palavra = normalizar(c.rotulo).split(' ')[0];
        const m = normalizar(texto).match(new RegExp(`\\b${palavra}\\D{0,12}(r\\$\\s*)?(\\d[\\d.,]*)`));
        if (m) r[c.chave] = m[2];
        break;
      }
    }
  }
  return r;
}

/** Valor que a pessoa deu em resposta a uma pergunta sobre um campo (o texto todo, limpo). */
export function respostaDireta(campo: Campo, texto: string, agora = new Date()): string {
  const extraido = extrairCampos([campo], texto, { agora })[campo.chave];
  if (extraido) return extraido;
  return texto
    .replace(/^\[[^\]]*\]\s*/gm, '')
    .replace(/^(é|e|eh|seria|o|a|:)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim();
}

const PALAVRAS_VAZIAS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'no', 'na', 'em', 'e', 'que',
  'por', 'ou', 'se', 'eu', 'me', 'meu', 'minha', 'voce', 'quero', 'preciso', 'pode', 'favor', 'quando', 'nao', 'use',
  'pessoa', 'pede', 'pedir', 'pedido', 'ja', 'mais', 'outro', 'outra', 'esse', 'essa', 'este', 'esta', 'isso',
]);

function radicais(texto: string, soMinusculas = false): string[] {
  const palavras = texto.match(/[\p{L}\p{N}]+/gu) ?? [];
  return palavras
    .filter((p) => !soMinusculas || !/^\p{Lu}/u.test(p))
    .map((p) => normalizar(p))
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p) && !/^\d+$/.test(p))
    .map((p) => p.slice(0, 5));
}

/** Quão bem o texto combina com a tarefa (nome vale o dobro). Usado pela simulação e pela classificação simulada. */
export function pontuarTarefa(def: TarefaDefinicao, texto: string): number {
  const doNome = new Set(radicais(def.nome));
  const quando = def.quandoUsar.split(/n[ãa]o use/i)[0];
  const outras = new Set(radicais([def.descricao, quando, ...def.exemplos].join(' '), true));
  const vistos = new Set<string>();
  let pontos = 0;
  for (const r of radicais(texto)) {
    if (vistos.has(r)) continue;
    vistos.add(r);
    if (doNome.has(r)) pontos += 2;
    else if (outras.has(r)) pontos += 1;
  }
  return pontos;
}

const VERBOS_ACAO: [RegExp, string][] = [
  [/\bcancel/, 'cancelar'],
  [/\b(exclu|apag|delet|remov)/, 'excluir'],
  [/\b(alter|mud|troc|atualiz|edit)/, 'alterar'],
  [/\b(envi|mand)/, 'enviar'],
  [/\b(emit|ger)/, 'emitir'],
  [/\b(cri|cadastr|inclu|registr)/, 'cadastrar'],
  [/\b(transfer)/, 'transferir'],
  [/\b(reembols|estorn|devolv)/, 'estornar'],
  [/\b(bloque)/, 'bloquear'],
  [/\b(desbloque|reativ)/, 'reativar'],
  [/\b(renov)/, 'renovar'],
  [/\b(agend|marc)/, 'agendar'],
  [/\b(aprov)/, 'aprovar'],
];

/** "cancela a assinatura do cliente X" → "cancelar assinatura". null quando não parece um pedido de ação. */
export function temaDoPedido(texto: string): string | null {
  const t = normalizar(texto);
  for (const [re, verbo] of VERBOS_ACAO) {
    const m = t.match(re);
    if (!m || m.index === undefined) continue;
    const depois = t
      .slice(m.index)
      .split(' ')
      .slice(1)
      .filter((p) => !PALAVRAS_VAZIAS.has(p) && !/^\d/.test(p) && p.length > 2);
    return depois[0] ? `${verbo} ${depois[0].replace(/[^\p{L}]/gu, '')}` : verbo;
  }
  return null;
}

const INICIO_PERGUNTA = /^(como|qual|quais|quando|onde|quanto|quantos|quantas|o que|oque|por que|porque|pq|existe|tem como|e possivel|da pra|da para|quem)\b/;

export function pareceDuvida(texto: string): { forte: boolean; fraca: boolean } {
  const t = normalizar(texto.replace(/^\[[^\]]*\]\s*/gm, ''));
  const forte = INICIO_PERGUNTA.test(t);
  return { forte, fraca: forte || t.endsWith('?') || /^(posso|pode|preciso|devo|consigo)\b/.test(t) };
}

export function pedePessoa(texto: string): boolean {
  const t = normalizar(texto);
  return (
    /\b(falar|conversar|chamar|chama|quero|preciso|transferir|passar)\b.{0,30}\b(pessoa|atendente|humano|alguem|suporte|gente de verdade)\b/.test(t) ||
    /^(atendente|humano|suporte)\b/.test(t)
  );
}

export function saudacao(texto: string): boolean {
  return /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|hey|tudo bem)\b[\s!.,?]*\w{0,12}[\s!.,?]*$/.test(normalizar(texto));
}

export function agradecimento(texto: string): boolean {
  return /^(obrigad[oa]|valeu|brigad[oa]|show|perfeito|otimo|beleza|ok|certo)\b/.test(normalizar(texto));
}

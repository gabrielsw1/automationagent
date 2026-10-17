// "Descrever a tarefa" (C2): a pessoa escreve em português o que a tarefa faz e o Claude monta a
// ficha completa (campos, perguntas, chamada certa da API, perfis). Sem ANTHROPIC_API_KEY, uma
// heurística monta uma ficha razoável a partir do texto e das rotas que o sistema descreve.
import { z } from 'zod';
import type {
  Campo,
  ExecucaoApi,
  MapeamentoCampo,
  MetodoHttp,
  TarefaDefinicao,
  TipoCampo,
  Transformacao,
} from '@copiloto/shared';
import type { RotaApi } from '../adaptadores/tipos.ts';
import type { Contexto } from '../contexto.ts';
import { lerDefinicao, METODOS, TIPOS_CAMPO, TRANSFORMACOES } from './definicao.ts';

export interface EntradaDescricao {
  descricao: string;
  rotas: RotaApi[];
  perfis: string[];
  nomeSistema: string;
  /** Nomes das tarefas que já existem (para não repetir). */
  tarefasExistentes: string[];
}

// ---------- Formato pedido ao Claude ----------

const CampoProposto = z.object({
  chave: z.string().describe('snake_case, ex.: email_cobranca'),
  rotulo: z.string(),
  tipo: z.enum(TIPOS_CAMPO),
  obrigatorio: z.boolean(),
  pergunta: z.string().describe('Pergunta curta que o agente faz quando o dado falta'),
  opcoes: z.array(z.string()).nullable().describe('Só para tipo lista'),
  padrao: z.string().nullable().describe('"solicitante" para tipo pessoa preenchido com quem pediu'),
  perguntar: z.boolean().describe('false quando o valor vem do padrão e só aparece no cartão'),
  verificarExistente: z.boolean(),
  ajuda: z.string().nullable(),
});

const ChamadaAuxiliarProposta = z.object({
  caminho: z.string(),
  descricao: z.string(),
  detalheOk: z.string().nullable(),
});

export const FichaProposta = z.object({
  nome: z.string().describe('Verbo no infinitivo + objeto, ex.: "Abrir chamado de suporte"'),
  descricao: z.string().describe('Uma linha para o catálogo'),
  quandoUsar: z.string().describe('Instrução ao agente: quando usar e quando não usar'),
  exemplos: z.array(z.string()).describe('4 a 6 frases do jeito que a equipe escreve, com abreviações'),
  campos: z.array(CampoProposto),
  caminho: z.enum(['api', 'navegador']),
  api: z
    .object({
      metodo: z.enum(METODOS),
      caminho: z.string(),
      mapeamento: z.array(
        z.object({ campo: z.string(), destino: z.string(), transformacao: z.enum(TRANSFORMACOES) }),
      ),
      idRetorno: z.string().nullable(),
      verificarAntes: ChamadaAuxiliarProposta.nullable(),
      desfazer: z.object({ metodo: z.enum(METODOS), caminho: z.string() }).nullable(),
      rotuloExecucao: z.string().nullable(),
    })
    .nullable(),
  desfazerMinutos: z.union([z.literal(0), z.literal(2), z.literal(5), z.literal(15)]),
  perfisPermitidos: z.array(z.string()),
  perfilAprovador: z.string().nullable(),
  tituloConfirmacao: z.string(),
  tituloRecibo: z.string(),
  tituloProgresso: z.string().nullable().describe('Gerúndio, aceita {campo}, ex.: "Cadastrando {nome_empresa}"'),
  proximosPassos: z.array(z.string()),
  contextos: z.array(z.string()),
  sugestaoProativa: z.string().nullable(),
  tempoEstimado: z.string().nullable(),
});
export type FichaProposta = z.infer<typeof FichaProposta>;

const SISTEMA = `Você monta fichas de tarefas para o Copiloto, um assistente que executa tarefas dentro do sistema de uma empresa.
A pessoa do time descreve em português o que a tarefa faz. Você devolve a ficha completa, pronta para revisar:

- nome: verbo no infinitivo + objeto, curto (ex.: "Cadastrar cliente", "Abrir chamado de suporte").
- descricao: uma linha para o catálogo, em linguagem de negócio.
- quandoUsar: instrução para o agente, como explicaria a um colega novo: quando usar, quando NÃO usar e o que fazer nesse caso. Sem siglas internas.
- exemplos: 4 a 6 frases do jeito que a equipe escreve no chat (com abreviações e erros comuns, alguns com dados no meio).
- campos: só os dados que a pessoa precisa informar. chave em snake_case. Tipos: texto, documento (CPF/CNPJ), email, telefone, lista (com opcoes), data, hora, numero, moeda, pessoa (usuário do sistema; use padrao "solicitante" e perguntar false quando o padrão for quem pediu). Cada campo obrigatório que o agente pergunta tem uma pergunta curta e educada.
- caminho: "api" quando alguma rota da API faz a tarefa; "navegador" quando nenhuma rota serve (a equipe vai gravar o fluxo na tela).
- api: escolha a rota certa da lista recebida (método e caminho exatamente como aparecem). mapeamento liga cada campo da ficha ao campo do corpo da chamada; use transformacao somente_digitos para documento, numero para números e listas numéricas, id_usuario para pessoa, data_iso para datas. idRetorno é o campo do retorno com o identificador criado. Se existir uma rota DELETE para o registro criado, preencha desfazer (aceita {id}). Se existir um GET para checar duplicidade pelo documento, preencha verificarAntes (aceita {campo}).
- desfazerMinutos: 5 quando há como desfazer pela API; senão 0.
- perfisPermitidos: só perfis da lista recebida. Vazio quando o texto não restringe quem pode. perfilAprovador quando o texto pede aprovação.
- tituloConfirmacao (ex.: "Confirme o cadastro"), tituloProgresso no gerúndio (aceita {campo}, ex.: "Cadastrando {nome_empresa}") e tituloRecibo (aceita {campo} e {id}, ex.: "Chamado #{id} aberto").
- contextos: seções do sistema onde sugerir a tarefa (ex.: "Clientes"). tempoEstimado: "cerca de 5 s" pela API, "cerca de 1 min" pela tela.
A confirmação antes de gravar é sempre obrigatória; não há campo para desligá-la. Tudo em português do Brasil.`;

// ---------- Utilidades de texto ----------

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function norm(s: string): string {
  return semAcento(s).toLowerCase();
}

const PARADAS = new Set(
  'para pelo pela pelos pelas como quando onde quero queria preciso precisa copiloto sistema tarefa deve devem pode podem fazer cada todo toda todos todas esse essa este esta isso aqui depois antes entao sempre nunca mais menos muito pouco ainda tambem quem qual quais seja sejam fica ficar usar usando informando informar dados campos campo com sem uma umas uns dos das nos nas que por'.split(
    ' ',
  ),
);

function palavras(s: string): string[] {
  return (norm(s).match(/[a-z0-9]{3,}/g) ?? []).filter((p) => !PARADAS.has(p));
}

function radical(p: string): string {
  return p.slice(0, 5);
}

const ACENTOS: Record<string, string> = {
  razao: 'razão',
  numero: 'número',
  descricao: 'descrição',
  periodo: 'período',
  inicio: 'início',
  cobranca: 'cobrança',
  responsavel: 'responsável',
  observacoes: 'observações',
  observacao: 'observação',
  horario: 'horário',
  tecnico: 'técnico',
  relatorio: 'relatório',
  relatorios: 'relatórios',
  codigo: 'código',
  endereco: 'endereço',
  municipio: 'município',
  titulo: 'título',
  mes: 'mês',
  preco: 'preço',
  servico: 'serviço',
  situacao: 'situação',
  competencia: 'competência',
  alteracoes: 'alterações',
  alteracao: 'alteração',
  usuario: 'usuário',
  prazo: 'prazo',
  email: 'e-mail',
};
const SIGLAS = new Set(['cnpj', 'cpf', 'cep', 'id', 'url', 'pdf', 'rg']);

/** "email_cobranca" → "E-mail de cobrança" (rótulo legível a partir de um nome técnico). */
export function rotuloDe(nome: string): string {
  const partes = nome
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter((p) => p && p !== 'id');
  if (partes.length === 0) return nome;
  const conectores: Record<string, string> = { email: 'de', prazo: 'de', data: 'da', valor: 'do', numero: 'do', nome: 'da' };
  const saida: string[] = [];
  partes.forEach((p, i) => {
    const w = SIGLAS.has(p) ? p.toUpperCase() : (ACENTOS[p] ?? p);
    saida.push(w);
    const prox = partes[i + 1];
    if (prox && conectores[p] && !['de', 'da', 'do', 'dos', 'das'].includes(prox)) saida.push(conectores[p]);
  });
  const t = saida.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function chaveDe(texto: string): string {
  const c = norm(texto)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return /^[a-z]/.test(c) ? c : `campo_${c || 'novo'}`;
}

function minusculoRotulo(r: string): string {
  return r.length > 1 && r[1] === r[1].toLowerCase() ? r.charAt(0).toLowerCase() + r.slice(1) : r;
}

function feminino(rotulo: string): boolean {
  const primeira = norm(rotulo).split(/\s+/)[0] ?? '';
  if (['data', 'hora', 'razao', 'descricao', 'observacao', 'observacoes', 'quantidade', 'prioridade', 'competencia', 'categoria', 'cidade'].includes(primeira)) return true;
  return /(a|cao|sao|dade)$/.test(primeira) && !['dia', 'tema', 'sistema', 'problema', 'prazo'].includes(primeira);
}

function listaEmTexto(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} ou ${itens[itens.length - 1]}`;
}

/** Pergunta educada para um campo. */
export function perguntaDe(rotulo: string, tipo: TipoCampo, opcoes?: string[]): string {
  const art = feminino(rotulo) ? 'a' : 'o';
  const r = minusculoRotulo(rotulo);
  if (tipo === 'lista' && opcoes && opcoes.length > 0) {
    const unidade = opcoes.every((o) => /^\d+\s+\S+$/.test(o)) ? opcoes[0].split(/\s+/)[1] : null;
    const itens = unidade ? opcoes.map((o) => o.split(/\s+/)[0]) : opcoes;
    return `Qual ${art} ${r}: ${listaEmTexto(itens)}${unidade ? ` ${unidade}` : ''}?`;
  }
  if (tipo === 'data') return `Qual é ${art} ${r}? Pode ser no formato dia/mês, como 22/10.`;
  return `Qual é ${art} ${r}?`;
}

/** Opções escritas num texto: "Baixa|Média|Alta", "uma de: A, B ou C", "15, 30, 45 ou 60 dias". */
export function opcoesDe(texto: string | undefined): string[] | null {
  if (!texto) return null;
  const limpar = (itens: string[]) => {
    let lista = itens.map((s) => s.trim().replace(/^["'“]|["'”.]$/g, '').trim()).filter(Boolean);
    // "15, 30, 45 ou 60 dias" → "15 dias", "30 dias"...
    const ultimo = lista[lista.length - 1]?.match(/^(\d+)\s+([a-zà-ú]+)$/i);
    if (ultimo && lista.slice(0, -1).every((s) => /^\d+$/.test(s))) {
      lista = lista.map((s) => (/^\d+$/.test(s) ? `${s} ${ultimo[2]}` : s));
    }
    return lista.length >= 2 && lista.length <= 15 && lista.every((s) => s.length <= 40) ? lista : null;
  };
  if (texto.includes('|')) return limpar(texto.replace(/^[^(]*\(|\)[^)]*$/g, '').split('|'));
  const m =
    texto.match(/(?:op[çc][õo]es|valores|uma de|entre|aceita|pode ser)\s*:?\s*([^.;()]+)/i) ??
    texto.match(/\(([^)]+)\)/) ??
    texto.match(/:\s*([^.;]+)/);
  if (!m) return null;
  return limpar(m[1].split(/\s*,\s*|\s+ou\s+|\s+e\s+/));
}

// ---------- Heurística (modo simulado) ----------

interface RotaPontuada {
  rota: RotaApi;
  pontos: number;
}

const INTENCOES: { re: RegExp; metodos: MetodoHttp[] }[] = [
  { re: /\b(cadastr|cri|inclu|abr|abri|registr|nov|emit|ger|agend|envi|lanc)/, metodos: ['POST'] },
  { re: /\b(alter|mud|troc|atualiz|edit|corrig)/, metodos: ['PATCH', 'PUT', 'POST'] },
  { re: /\b(exclu|apag|remov|cancel|encerr|delet)/, metodos: ['DELETE', 'POST'] },
];

function caminhoBase(caminho: string): string {
  return caminho.split('?')[0].replace(/:([a-z_]+)/gi, '{$1}');
}

export function escolherRota(descricao: string, rotas: RotaApi[]): RotaApi | null {
  const termos = palavras(descricao).filter((p) => !/^(abr|cri|cad|inc|reg|nov|emi|ger|alt|mud|tro|atu|exc|apa|rem)/.test(p) || p.length > 7);
  const radicais = new Set(termos.map(radical));
  const texto = norm(descricao);
  const intencao = INTENCOES.find((i) => i.re.test(texto));
  let melhor: RotaPontuada | null = null;
  for (const rota of rotas) {
    if (rota.metodo === 'GET') continue;
    // O recurso (descrição e caminho) decide; os nomes dos campos só desempatam.
    const recurso = new Set(palavras(`${rota.descricao} ${rota.caminho.replace(/[/_{}:-]/g, ' ')}`).map(radical));
    const doCorpo = new Set(palavras((rota.campos ?? []).map((c) => c.nome.replace(/_/g, ' ')).join(' ')).map(radical));
    let pontos = 0;
    for (const r of radicais) if (recurso.has(r)) pontos += 1;
    if (pontos === 0) continue;
    for (const r of radicais) if (!recurso.has(r) && doCorpo.has(r)) pontos += 0.25;
    if (intencao?.metodos.includes(rota.metodo)) pontos += intencao.metodos[0] === rota.metodo ? 1 : 0.5;
    if (rota.metodo === 'DELETE' && !intencao?.metodos.includes('DELETE')) pontos -= 2;
    if (!melhor || pontos > melhor.pontos) melhor = { rota, pontos };
  }
  return melhor && melhor.pontos >= 1 ? melhor.rota : null;
}

function tipoDoCampo(nome: string, tipo: string, descricao: string, opcoes: string[] | null): TipoCampo {
  const n = norm(nome);
  const tudo = norm(`${nome} ${tipo} ${descricao}`);
  if (/cnpj|cpf|documento/.test(n)) return 'documento';
  if (/e_?mail/.test(n) || tipo === 'email') return 'email';
  if (/telefone|celular|whatsapp/.test(n)) return 'telefone';
  if (/(responsavel|usuario|vendedor|solicitante|atendente)(_id)?$/.test(n)) return 'pessoa';
  if (opcoes) return 'lista';
  if (/(^|_)(data|dt)(_|$)|_em$|^inicio|_inicio$|_fim$|^fim|vencimento|nascimento/.test(n) || /\bdate\b|\bdata\b/.test(norm(tipo))) return 'data';
  if (/hora|horario/.test(n)) return 'hora';
  if (/valor|preco|montante|total/.test(n) || /moeda|money|reais/.test(tudo)) return 'moeda';
  if (/^(number|integer|int|numero|float|decimal)$/.test(norm(tipo))) return 'numero';
  return 'texto';
}

function transformacaoDe(tipo: TipoCampo, opcoes?: string[]): Transformacao {
  if (tipo === 'documento') return 'somente_digitos';
  if (tipo === 'pessoa') return 'id_usuario';
  if (tipo === 'data') return 'data_iso';
  if (tipo === 'numero') return 'numero';
  if (tipo === 'lista' && opcoes && opcoes.every((o) => /^\d+(\s|$)/.test(o))) return 'numero';
  return 'nenhuma';
}

function campoDaRota(c: NonNullable<RotaApi['campos']>[number], gravaNovo: boolean): Campo {
  let opcoes = opcoesDe(c.tipo.includes('|') ? c.tipo : undefined) ?? opcoesDe(c.descricao);
  // "prazo_pagamento_dias" com opções 15, 30, 45 → "Prazo de pagamento" com "15 dias", "30 dias"...
  const unidade = c.nome.match(/_(dias|meses|horas|anos)$/)?.[1] ?? null;
  if (unidade && opcoes?.every((o) => /^\d+$/.test(o))) opcoes = opcoes.map((o) => `${o} ${unidade}`);
  const tipo = tipoDoCampo(c.nome, c.tipo, c.descricao ?? '', opcoes);
  const curta = c.descricao && c.descricao.length <= 40 && !/[.:(|]/.test(c.descricao) ? c.descricao : null;
  const rotulo = curta ? curta.charAt(0).toUpperCase() + curta.slice(1) : rotuloDe(unidade ? c.nome.replace(/_(dias|meses|horas|anos)$/, '') : c.nome);
  if (tipo === 'pessoa') {
    return {
      chave: chaveDe(c.nome.replace(/_id$/, '')),
      rotulo: rotuloDe(c.nome),
      tipo,
      obrigatorio: false,
      pergunta: '',
      padrao: 'solicitante',
      perguntar: false,
      ajuda: 'Não pergunta. Mostra no cartão de confirmação para a pessoa trocar se quiser.',
    };
  }
  const campo: Campo = {
    chave: chaveDe(c.nome),
    rotulo,
    tipo,
    obrigatorio: c.obrigatorio,
    pergunta: perguntaDe(rotulo, tipo, opcoes ?? undefined),
  };
  if (opcoes) campo.opcoes = opcoes;
  if (tipo === 'texto' && /nome|razao/.test(norm(c.nome))) campo.minimo = 3;
  if (tipo === 'documento' && gravaNovo) campo.verificarExistente = true;
  return campo;
}

interface Conceito {
  re: RegExp;
  campo: Omit<Campo, 'pergunta'> & { pergunta?: string };
}

const CONCEITOS: Conceito[] = [
  { re: /razao social|nome da empresa|nome do cliente|nome fantasia/, campo: { chave: 'nome_empresa', rotulo: 'Nome da empresa', tipo: 'texto', obrigatorio: true, minimo: 3 } },
  { re: /\bcnpj\b/, campo: { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', obrigatorio: true } },
  { re: /\bcpf\b/, campo: { chave: 'cpf', rotulo: 'CPF', tipo: 'documento', obrigatorio: true } },
  { re: /e-?mail/, campo: { chave: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true } },
  { re: /telefone|celular|whatsapp/, campo: { chave: 'telefone', rotulo: 'Telefone', tipo: 'telefone', obrigatorio: true } },
  { re: /\bassunto\b/, campo: { chave: 'assunto', rotulo: 'Assunto', tipo: 'texto', obrigatorio: true, minimo: 3 } },
  { re: /\bcliente\b/, campo: { chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true } },
  { re: /\bperiodo\b/, campo: { chave: 'periodo_inicio', rotulo: 'Início do período', tipo: 'data', obrigatorio: true } },
  { re: /\bperiodo\b/, campo: { chave: 'periodo_fim', rotulo: 'Fim do período', tipo: 'data', obrigatorio: true } },
  { re: /\bdata\b/, campo: { chave: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true } },
  { re: /horario|\bhora\b/, campo: { chave: 'horario', rotulo: 'Horário', tipo: 'hora', obrigatorio: true } },
  { re: /\bvalor\b|\bpreco\b/, campo: { chave: 'valor', rotulo: 'Valor', tipo: 'moeda', obrigatorio: true } },
  { re: /quantidade/, campo: { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'numero', obrigatorio: true, minimo: 1 } },
  { re: /prioridade/, campo: { chave: 'prioridade', rotulo: 'Prioridade', tipo: 'lista', obrigatorio: true, opcoes: ['Baixa', 'Média', 'Alta', 'Urgente'] } },
  { re: /\bplano\b/, campo: { chave: 'plano', rotulo: 'Plano', tipo: 'texto', obrigatorio: true } },
  { re: /tecnico/, campo: { chave: 'tecnico', rotulo: 'Técnico', tipo: 'texto', obrigatorio: false } },
  { re: /descricao|detalhes|\bmotivo\b/, campo: { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, minimo: 10 } },
  { re: /observac/, campo: { chave: 'observacoes', rotulo: 'Observações', tipo: 'texto', obrigatorio: false } },
  { re: /responsavel/, campo: { chave: 'responsavel', rotulo: 'Responsável', tipo: 'pessoa', obrigatorio: false, padrao: 'solicitante', perguntar: false, ajuda: 'Não pergunta. Mostra no cartão de confirmação para a pessoa trocar se quiser.' } },
];

function camposDoTexto(descricao: string): Campo[] {
  const texto = norm(descricao);
  const campos: Campo[] = [];
  const add = (c: Omit<Campo, 'pergunta'> & { pergunta?: string }) => {
    if (campos.some((x) => x.chave === c.chave)) return;
    campos.push({ ...c, pergunta: c.pergunta ?? (c.perguntar === false ? '' : perguntaDe(c.rotulo, c.tipo, c.opcoes)) });
  };
  for (const { re, campo } of CONCEITOS) if (re.test(texto)) add(campo);
  // "com assunto, cliente e prioridade": itens soltos que nenhum conceito cobriu viram campos de texto.
  const lista = norm(descricao).match(/\b(?:com|informando|pedindo|contendo)\s+(?:o |a |os |as )?([a-z0-9 ,-]+?)(?:[.;:\n]|$| para | quando | e depois)/);
  if (lista) {
    for (const item of lista[1].split(/\s*,\s*|\s+e\s+/)) {
      const t = item.replace(/^(o|a|os|as|um|uma|seu|sua)\s+/, '').trim();
      if (!t || t.split(/\s+/).length > 4 || t.length < 3) continue;
      if (CONCEITOS.some(({ re }) => re.test(t))) continue;
      const rotulo = t.charAt(0).toUpperCase() + t.slice(1);
      add({ chave: chaveDe(t), rotulo, tipo: 'texto', obrigatorio: true });
    }
  }
  return campos;
}

const VERBOS: Record<string, string> = {
  abre: 'abrir',
  abra: 'abrir',
  cadastra: 'cadastrar',
  cadastre: 'cadastrar',
  cria: 'criar',
  crie: 'criar',
  emite: 'emitir',
  emita: 'emitir',
  gera: 'gerar',
  gere: 'gerar',
  altera: 'alterar',
  altere: 'alterar',
  agenda: 'agendar',
  agende: 'agendar',
  cancela: 'cancelar',
  cancele: 'cancelar',
  envia: 'enviar',
  envie: 'enviar',
  atualiza: 'atualizar',
  atualize: 'atualizar',
  registra: 'registrar',
  registre: 'registrar',
  exclui: 'excluir',
  exclua: 'excluir',
  inclui: 'incluir',
  inclua: 'incluir',
  troca: 'trocar',
  troque: 'trocar',
  muda: 'mudar',
  mude: 'mudar',
};

/** Nome da tarefa a partir do texto: "Quero que o copiloto abra chamados..." → "Abrir chamados de suporte". */
export function nomeDe(descricao: string, rota: RotaApi | null): string {
  let t = descricao.trim().replace(/\s+/g, ' ');
  t = t.replace(
    /^(eu\s+)?(quero|queria|preciso|gostaria)( que)?( o copiloto| ele| voc[eê])?( possa| consiga)?\s+/i,
    '',
  );
  t = t.replace(/^(o copiloto|ele)\s+(deve|vai|precisa|pode|tem que)\s+/i, '');
  t = t.replace(/^(uma\s+)?tarefa\s+(para|de|que)\s+/i, '');
  t = t.replace(/^(permitir|poder|conseguir|ajudar a)\s+/i, '');
  t = t.split(/[,.;:\n(]| com | quando | usando | pela | pelo | no sistema| informando | a partir | e depois | para | numa | num | em um | em uma | sempre que | toda vez /i)[0] ?? t;
  let ws = t
    .split(' ')
    .filter(Boolean)
    .filter((w, i) => !(i > 0 && /^(um|uma|o|a|os|as)$/i.test(w)));
  if (ws.length > 0) {
    const v = norm(ws[0]);
    ws[0] = VERBOS[v] ?? ws[0].toLowerCase();
  }
  ws = ws.slice(0, 6);
  let nome = ws.join(' ').trim();
  if (nome.length < 4 && rota) nome = rota.descricao.split(/[,.(]/)[0];
  if (!nome) nome = 'Nova tarefa';
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function exemplosDe(nome: string): string[] {
  const n = minusculoRotulo(nome);
  const [verbo, ...resto] = n.split(' ');
  const objeto = resto.join(' ');
  const imperativo = verbo.replace(/ar$/, 'a').replace(/[ei]r$/, 'e');
  const lista = [
    `${imperativo} ${objeto}`.trim(),
    `preciso ${n}`,
    `pode ${n} pra mim?`,
    `${verbo === imperativo ? n : `${imperativo} ${objeto}`} agora, por favor`.trim(),
  ];
  return [...new Set(lista.filter((e) => e.length > 4))];
}

/** "Abrir chamado de suporte" → "Abrindo chamado de suporte". */
export function gerundioDe(nome: string): string {
  const [verbo, ...resto] = nome.split(' ');
  const v = verbo.toLowerCase();
  const g = /ar$/.test(v) ? v.replace(/ar$/, 'ando') : /er$/.test(v) ? v.replace(/er$/, 'endo') : /ir$/.test(v) ? v.replace(/ir$/, 'indo') : null;
  if (!g) return nome;
  const t = [g, ...resto].join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function contextoDe(caminho: string): string[] {
  const seg = caminho
    .split('?')[0]
    .split('/')
    .filter((s) => s && !/^v\d+$/.test(s) && !s.startsWith('{') && !s.startsWith(':'))[0];
  if (!seg) return [];
  const r = ACENTOS[seg] ?? seg;
  return [r.charAt(0).toUpperCase() + r.slice(1)];
}

function perfisDoTexto(descricao: string, perfis: string[]): { permitidos: string[]; aprovador: string | null } {
  let texto = norm(descricao);
  const achados: { perfil: string; pos: number }[] = [];
  for (const p of [...perfis].sort((a, b) => b.length - a.length)) {
    const alvo = norm(p);
    const pos = texto.indexOf(alvo);
    if (pos >= 0) {
      achados.push({ perfil: p, pos });
      texto = texto.slice(0, pos) + ' '.repeat(alvo.length) + texto.slice(pos + alvo.length);
    }
  }
  const posAprov = norm(descricao).search(/aprova|aprovacao|autoriza/);
  let aprovador: string | null = null;
  if (posAprov >= 0) {
    // O perfil mais perto de "aprova" ("o Gestor financeiro aprova" ou "aprovação do Gestor financeiro").
    const perto = achados
      .map((a) => ({ ...a, dist: Math.abs(a.pos - posAprov) }))
      .filter((a) => a.dist <= 60)
      .sort((a, b) => a.dist - b.dist)[0];
    aprovador = perto?.perfil ?? null;
  }
  const permitidos = achados.sort((a, b) => a.pos - b.pos).map((a) => a.perfil);
  return { permitidos, aprovador };
}

/** Ficha por heurística, sem chamar o Claude. Usada pelo modelo simulado e nos testes. */
export function fichaPorHeuristica(e: EntradaDescricao): FichaProposta {
  const rota = escolherRota(e.descricao, e.rotas);
  const nome = nomeDe(e.descricao, rota);
  const gravaNovo = rota?.metodo === 'POST';
  let campos: Campo[] = rota?.campos?.length ? rota.campos.map((c) => campoDaRota(c, gravaNovo)) : camposDoTexto(e.descricao);
  // Chaves únicas.
  const vistas = new Set<string>();
  campos = campos.map((c) => {
    let k = c.chave;
    for (let i = 2; vistas.has(k); i++) k = `${c.chave}_${i}`;
    vistas.add(k);
    return { ...c, chave: k };
  });

  let api: FichaProposta['api'] = null;
  let desfazerMinutos: FichaProposta['desfazerMinutos'] = 0;
  if (rota) {
    const base = caminhoBase(rota.caminho);
    const mapeamento: MapeamentoCampo[] = rota.campos?.length
      ? rota.campos.map((c, i) => ({
          campo: campos[i].chave,
          destino: c.nome,
          transformacao: transformacaoDe(campos[i].tipo, campos[i].opcoes),
        }))
      : campos.map((c) => ({ campo: c.chave, destino: c.chave, transformacao: transformacaoDe(c.tipo, c.opcoes) }));
    const rotaDesfazer = e.rotas.find((r) => {
      if (r.metodo !== 'DELETE') return false;
      const c = caminhoBase(r.caminho);
      return c.startsWith(`${base}/{`) && c.split('/').length === base.split('/').length + 1;
    });
    const doc = campos.find((c) => c.tipo === 'documento' && c.verificarExistente);
    const rotaBusca = doc ? e.rotas.find((r) => r.metodo === 'GET' && caminhoBase(r.caminho) === base) : undefined;
    api = {
      metodo: rota.metodo,
      caminho: base,
      mapeamento: mapeamento.map((m) => ({ ...m, transformacao: m.transformacao ?? 'nenhuma' })),
      idRetorno: rota.idRetorno ?? null,
      verificarAntes:
        doc && rotaBusca
          ? {
              caminho: `${base}?documento={${doc.chave}}`,
              descricao: `Verificando se o ${doc.rotulo} já está cadastrado`,
              detalheOk: `Nenhum cadastro com este ${doc.rotulo}`,
            }
          : null,
      desfazer: rotaDesfazer ? { metodo: 'DELETE', caminho: caminhoBase(rotaDesfazer.caminho).replace(/\{[a-z_]+\}/i, '{id}') } : null,
      rotuloExecucao: `Enviando para o ${e.nomeSistema}`,
    };
    if (rotaDesfazer) desfazerMinutos = 5;
  }

  const { permitidos, aprovador } = perfisDoTexto(e.descricao, e.perfis);
  const perfisPermitidos = aprovador && !permitidos.includes(aprovador) ? [...permitidos, aprovador] : permitidos;
  const primeiraFrase = e.descricao.trim().split(/(?<=[.!?])\s/)[0].replace(/\s+/g, ' ');
  const descricao = (rota?.descricao && rota.descricao.length > 8 ? rota.descricao : primeiraFrase).slice(0, 200);
  const nomeMin = minusculoRotulo(nome);

  return {
    nome,
    descricao: descricao.endsWith('.') ? descricao : `${descricao}.`,
    quandoUsar:
      `Use quando a pessoa quiser ${nomeMin}. O que a equipe pediu: "${e.descricao.trim().replace(/\s+/g, ' ').slice(0, 600)}". ` +
      'Pergunte um dado de cada vez só quando faltar algo obrigatório. ' +
      'Não use para pedidos parecidos que esta tarefa não cobre: explique o que ela faz e ofereça falar com uma pessoa.',
    exemplos: exemplosDe(nome),
    campos: campos.map((c) => ({
      chave: c.chave,
      rotulo: c.rotulo,
      tipo: c.tipo,
      obrigatorio: c.obrigatorio,
      pergunta: c.pergunta,
      opcoes: c.opcoes ?? null,
      padrao: c.padrao ?? null,
      perguntar: c.perguntar ?? true,
      verificarExistente: c.verificarExistente ?? false,
      ajuda: c.ajuda ?? null,
    })),
    caminho: rota ? 'api' : 'navegador',
    api,
    desfazerMinutos,
    perfisPermitidos,
    perfilAprovador: aprovador,
    tituloConfirmacao: 'Confirme os dados',
    tituloRecibo: api?.idRetorno ? `${nome}: feito (#{id})` : `${nome}: feito`,
    tituloProgresso: gerundioDe(nome),
    proximosPassos: [],
    contextos: rota ? contextoDe(rota.caminho) : [],
    sugestaoProativa: null,
    tempoEstimado: rota ? 'cerca de 5 s' : 'cerca de 1 min',
  };
}

// ---------- Proposta → ficha ----------

/** Converte a proposta (do Claude ou da heurística) numa ficha válida, com chaves e perfis conferidos. */
export function propostaParaDefinicao(p: FichaProposta, e: Pick<EntradaDescricao, 'perfis'>): TarefaDefinicao {
  const vistas = new Set<string>();
  const renomear = new Map<string, string>();
  const campos: Campo[] = p.campos.map((c) => {
    let chave = chaveDe(c.chave || c.rotulo);
    const base = chave;
    for (let i = 2; vistas.has(chave); i++) chave = `${base}_${i}`;
    vistas.add(chave);
    renomear.set(c.chave, chave);
    const campo: Campo = {
      chave,
      rotulo: c.rotulo.trim() || rotuloDe(chave),
      tipo: c.tipo,
      obrigatorio: c.obrigatorio,
      pergunta: c.pergunta.trim(),
    };
    if (c.tipo === 'lista' && c.opcoes?.length) campo.opcoes = c.opcoes;
    if (c.padrao) campo.padrao = c.padrao;
    if (!c.perguntar) campo.perguntar = false;
    if (c.verificarExistente) campo.verificarExistente = true;
    if (c.ajuda) campo.ajuda = c.ajuda;
    return campo;
  });
  const conhecidos = new Set(e.perfis);
  const filtrar = (lista: string[]) => (e.perfis.length ? lista.filter((x) => conhecidos.has(x)) : lista);
  let api: ExecucaoApi | undefined;
  if (p.caminho === 'api' && p.api) {
    api = {
      metodo: p.api.metodo,
      caminho: p.api.caminho,
      mapeamento: p.api.mapeamento
        .filter((m) => renomear.has(m.campo) || vistas.has(m.campo))
        .map((m) => ({ campo: renomear.get(m.campo) ?? m.campo, destino: m.destino, transformacao: m.transformacao })),
    };
    if (p.api.idRetorno) api.idRetorno = p.api.idRetorno;
    if (p.api.verificarAntes) {
      api.verificarAntes = { caminho: p.api.verificarAntes.caminho, descricao: p.api.verificarAntes.descricao };
      if (p.api.verificarAntes.detalheOk) api.verificarAntes.detalheOk = p.api.verificarAntes.detalheOk;
    }
    if (p.api.desfazer) api.desfazer = p.api.desfazer;
    if (p.api.rotuloExecucao) api.rotuloExecucao = p.api.rotuloExecucao;
  }
  const perfilAprovador = p.perfilAprovador && (!e.perfis.length || conhecidos.has(p.perfilAprovador)) ? p.perfilAprovador : undefined;
  const bruto: TarefaDefinicao = {
    nome: p.nome.trim().slice(0, 80) || 'Nova tarefa',
    descricao: p.descricao.trim().slice(0, 240),
    quandoUsar: p.quandoUsar.trim(),
    exemplos: p.exemplos.map((x) => x.trim()).filter(Boolean).slice(0, 12),
    campos,
    caminho: p.caminho === 'api' && api ? 'api' : 'navegador',
    api,
    fluxoId: null,
    usarFluxoSeApiFalhar: false,
    confirmacao: true,
    desfazerMinutos: api?.desfazer ? p.desfazerMinutos : 0,
    perfisPermitidos: filtrar(p.perfisPermitidos),
    perfilAprovador,
    tituloRecibo: p.tituloRecibo,
    tituloConfirmacao: p.tituloConfirmacao,
    tituloProgresso: p.tituloProgresso ?? undefined,
    proximosPassos: p.proximosPassos.slice(0, 5),
    contextos: p.contextos.slice(0, 5),
    sugestaoProativa: p.sugestaoProativa ?? undefined,
    confiancaMinima: 0.8,
    tempoEstimado: p.tempoEstimado ?? undefined,
  };
  const r = lerDefinicao(bruto);
  if (!r.ok) throw new Error(r.mensagem);
  return r.definicao;
}

/** Monta a ficha a partir da descrição: Claude (modelo principal) com a heurística como simulação. */
export async function descreverTarefa(ctx: Contexto, descricao: string): Promise<TarefaDefinicao> {
  const [rotas, perfis] = await Promise.all([
    ctx.adaptador.descreverApi().catch(() => [] as RotaApi[]),
    ctx.adaptador.listarPerfis().catch(() => [] as string[]),
  ]);
  const tarefasExistentes = ctx.catalogo
    .listar()
    .map((t) => (ctx.catalogo.publicada(t.id) ?? ctx.catalogo.rascunho(t.id))?.definicao.nome)
    .filter((n): n is string => !!n);
  const entrada: EntradaDescricao = { descricao, rotas, perfis, nomeSistema: ctx.adaptador.nome, tarefasExistentes };
  const { dados } = await ctx.llm.estruturado({
    modelo: 'principal',
    finalidade: 'montar_ficha',
    sistema: SISTEMA,
    esforco: 'medium',
    maxTokens: 16000,
    mensagens: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Sistema da empresa: ${entrada.nomeSistema}\n\n` +
              `Rotas da API (JSON):\n${JSON.stringify(rotas)}\n\n` +
              `Perfis de acesso do sistema: ${perfis.length ? perfis.join(', ') : '(nenhum informado)'}\n` +
              `Tarefas que já existem: ${tarefasExistentes.length ? tarefasExistentes.join(', ') : '(nenhuma)'}`,
          },
          { type: 'text', text: `Descrição da tarefa escrita pela equipe:\n<descricao>\n${descricao}\n</descricao>` },
        ],
      },
    ],
    esquema: FichaProposta,
    simulacao: () => fichaPorHeuristica(entrada),
  });
  return propostaParaDefinicao(dados, entrada);
}

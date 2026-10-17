// Ficha da tarefa (TarefaDefinicao): validação de entrada, valores padrão, conferência antes de
// publicar e contagem de alterações entre o rascunho e a versão publicada.
import { z } from 'zod';
import type { Campo, TarefaDefinicao } from '@copiloto/shared';

export const TIPOS_CAMPO = [
  'texto',
  'documento',
  'email',
  'telefone',
  'lista',
  'data',
  'hora',
  'numero',
  'moeda',
  'pessoa',
] as const;
export const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const TRANSFORMACOES = ['nenhuma', 'somente_digitos', 'numero', 'id_usuario', 'data_iso'] as const;

const texto = (max: number) => z.string().trim().max(max);
const opcional = <T extends z.ZodType>(t: T) => t.optional().nullable().transform((v) => v ?? undefined);

export const EsquemaCampo = z.object({
  chave: z
    .string()
    .trim()
    .min(1, 'Todo campo precisa de uma chave.')
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'A chave do campo usa só letras minúsculas, números e _ (ex.: email_cobranca).'),
  rotulo: texto(80).min(1, 'Todo campo precisa de um nome.'),
  tipo: z.enum(TIPOS_CAMPO),
  obrigatorio: z.boolean(),
  pergunta: texto(300).default(''),
  opcoes: opcional(z.array(texto(120).min(1)).max(60)),
  minimo: opcional(z.number()),
  maximo: opcional(z.number()),
  padrao: opcional(texto(200)),
  perguntar: opcional(z.boolean()),
  verificarExistente: opcional(z.boolean()),
  ajuda: opcional(texto(300)),
});

const EsquemaChamadaAuxiliar = z.object({
  caminho: texto(300).min(1),
  descricao: texto(200).min(1),
  detalheOk: opcional(texto(200)),
});

export const EsquemaExecucaoApi = z.object({
  metodo: z.enum(METODOS),
  caminho: texto(300),
  mapeamento: z
    .array(
      z.object({
        campo: texto(60).min(1),
        destino: texto(120).min(1),
        transformacao: opcional(z.enum(TRANSFORMACOES)),
      }),
    )
    .max(60)
    .default([]),
  idRetorno: opcional(texto(120)),
  verificarAntes: opcional(EsquemaChamadaAuxiliar),
  conferirDepois: opcional(EsquemaChamadaAuxiliar),
  desfazer: opcional(z.object({ metodo: z.enum(METODOS), caminho: texto(300).min(1) })),
  rotuloExecucao: opcional(texto(120)),
  linkResultado: opcional(texto(300)),
  testadaEm: opcional(z.string()),
});

/** Ficha recebida do console. Rascunhos podem estar incompletos; `paraPublicar` diz o que falta. */
export const EsquemaDefinicao = z
  .object({
    nome: texto(80).min(2, 'Dê um nome à tarefa, com pelo menos 2 letras.'),
    descricao: texto(240).default(''),
    quandoUsar: texto(3000).default(''),
    exemplos: z.array(texto(300).min(1)).max(40).default([]),
    campos: z.array(EsquemaCampo).max(40).default([]),
    caminho: z.enum(['api', 'navegador']),
    api: opcional(EsquemaExecucaoApi),
    fluxoId: z.string().nullable().optional(),
    usarFluxoSeApiFalhar: z.boolean().default(false),
    // Travado: nada grava sem o "confirmo" da pessoa, seja o que for enviado.
    confirmacao: z.unknown().transform(() => true as const),
    desfazerMinutos: z.union([z.literal(0), z.literal(2), z.literal(5), z.literal(15)]).default(0),
    perfisPermitidos: z.array(texto(80).min(1)).max(50).default([]),
    perfilAprovador: opcional(texto(80)),
    tituloRecibo: texto(200).default(''),
    tituloConfirmacao: texto(200).default(''),
    tituloProgresso: opcional(texto(200)),
    proximosPassos: z.array(texto(200).min(1)).max(10).default([]),
    contextos: z.array(texto(80).min(1)).max(20).default([]),
    sugestaoProativa: opcional(texto(300)),
    confiancaMinima: z.number().min(0).max(1).default(0.8),
    tempoEstimado: opcional(texto(60)),
    liberadaPara: opcional(z.array(z.string().min(1)).max(500)),
  })
  .superRefine((d, ctx) => {
    const vistas = new Set<string>();
    d.campos.forEach((c, i) => {
      if (vistas.has(c.chave)) {
        ctx.addIssue({
          code: 'custom',
          path: ['campos', i, 'chave'],
          message: `Há dois campos com a chave "${c.chave}". Cada campo precisa de uma chave diferente.`,
        });
      }
      vistas.add(c.chave);
    });
  });

/** Valida e normaliza a ficha. Lança a primeira mensagem de erro em português. */
export function lerDefinicao(bruto: unknown): { ok: true; definicao: TarefaDefinicao } | { ok: false; mensagem: string } {
  const r = EsquemaDefinicao.safeParse(bruto);
  if (!r.success) {
    const p = r.error.issues[0];
    const onde = p?.path?.length ? ` (${p.path.join('.')})` : '';
    const msg = p?.message && !p.message.startsWith('Invalid') && !p.message.startsWith('Expected') ? p.message : `Ficha da tarefa em formato inválido${onde}.`;
    return { ok: false, mensagem: msg };
  }
  return { ok: true, definicao: normalizarDefinicao(r.data as TarefaDefinicao) };
}

/** Preenche os padrões que a pessoa não precisa escrever. */
export function normalizarDefinicao(d: TarefaDefinicao): TarefaDefinicao {
  const nome = d.nome.trim();
  const def: TarefaDefinicao = {
    ...d,
    nome,
    confirmacao: true,
    tituloConfirmacao: d.tituloConfirmacao?.trim() || 'Confirme os dados',
    tituloRecibo: d.tituloRecibo?.trim() || (d.api?.idRetorno ? `${nome}: feito (#{id})` : `${nome}: feito`),
    exemplos: [...new Set(d.exemplos.map((e) => e.trim()).filter(Boolean))],
    perfisPermitidos: [...new Set(d.perfisPermitidos)],
    confiancaMinima: d.confiancaMinima ?? 0.8,
    fluxoId: d.fluxoId ?? null,
    campos: d.campos.map(limparCampo),
  };
  if (!def.perfilAprovador) delete def.perfilAprovador;
  if (!def.tituloProgresso?.trim()) delete def.tituloProgresso;
  if (def.caminho === 'navegador' && def.usarFluxoSeApiFalhar) def.usarFluxoSeApiFalhar = false;
  return def;
}

function limparCampo(c: Campo): Campo {
  const r: Campo = { ...c };
  if (r.tipo !== 'lista') delete r.opcoes;
  else r.opcoes = [...new Set((r.opcoes ?? []).map((o) => o.trim()).filter(Boolean))];
  for (const k of Object.keys(r) as (keyof Campo)[]) if (r[k] === undefined) delete r[k];
  return r;
}

/** Ficha em branco (ex.: "Criar tarefa" a partir de pedidos sem tarefa). */
export function definicaoInicial(nome: string, caminho: 'api' | 'navegador' = 'api'): TarefaDefinicao {
  return normalizarDefinicao({
    nome,
    descricao: '',
    quandoUsar: '',
    exemplos: [],
    campos: [],
    caminho,
    api: caminho === 'api' ? { metodo: 'POST', caminho: '', mapeamento: [] } : undefined,
    fluxoId: null,
    usarFluxoSeApiFalhar: false,
    confirmacao: true,
    desfazerMinutos: 0,
    perfisPermitidos: [],
    tituloRecibo: '',
    tituloConfirmacao: '',
    proximosPassos: [],
    contextos: [],
    confiancaMinima: 0.8,
  });
}

/** O que impede a publicação, em frases que dizem como resolver. Vazio = pode publicar. */
export function pendenciasParaPublicar(d: TarefaDefinicao): string[] {
  const p: string[] = [];
  if (!d.nome.trim()) p.push('Dê um nome à tarefa.');
  if (d.quandoUsar.trim().length < 20) {
    p.push('Escreva em "Quando usar" em que situação o copiloto deve usar esta tarefa (pelo menos uma frase).');
  }
  for (const c of d.campos) {
    if (c.obrigatorio && c.perguntar !== false && !c.pergunta.trim()) {
      p.push(`Escreva a pergunta que o agente faz para o campo "${c.rotulo}".`);
    }
    if (c.tipo === 'lista' && (c.opcoes ?? []).length === 0) {
      p.push(`O campo "${c.rotulo}" é uma lista: informe as opções aceitas.`);
    }
    if (c.obrigatorio && c.perguntar === false && !c.padrao) {
      p.push(`O campo "${c.rotulo}" não é perguntado: dê um valor padrão ou deixe o agente perguntar.`);
    }
  }
  if (d.caminho === 'api') {
    if (!d.api || !d.api.caminho.trim()) p.push('Informe a chamada da API: método e caminho (ex.: POST /v1/clientes).');
    else {
      const chaves = new Set(d.campos.map((c) => c.chave));
      for (const m of d.api.mapeamento) {
        if (!chaves.has(m.campo)) p.push(`O mapeamento usa o campo "${m.campo}", que não existe na ficha.`);
      }
    }
    if (d.usarFluxoSeApiFalhar && !d.fluxoId) {
      p.push('Para usar o fluxo gravado quando a API falhar, escolha qual fluxo.');
    }
  } else if (!d.fluxoId) {
    p.push('Escolha o fluxo gravado que o copiloto vai seguir na tela, ou grave um novo.');
  }
  if (d.perfilAprovador && d.perfisPermitidos.length > 0 && !d.perfisPermitidos.includes(d.perfilAprovador)) {
    p.push(`O aprovador (${d.perfilAprovador}) precisa estar entre os perfis que podem executar.`);
  }
  return p;
}

// ---------- Diferenças entre versões ----------

const ROTULOS: Partial<Record<keyof TarefaDefinicao, string>> = {
  nome: 'nome',
  descricao: 'descrição',
  quandoUsar: 'quando usar',
  caminho: 'caminho de execução',
  api: 'chamada da API',
  fluxoId: 'fluxo gravado',
  usarFluxoSeApiFalhar: 'reserva pelo fluxo',
  desfazerMinutos: 'tempo para desfazer',
  perfisPermitidos: 'quem pode executar',
  perfilAprovador: 'aprovador',
  tituloRecibo: 'título do recibo',
  tituloConfirmacao: 'título da confirmação',
  tituloProgresso: 'título do progresso',
  proximosPassos: 'próximos passos',
  contextos: 'páginas onde sugerir',
  sugestaoProativa: 'sugestão proativa',
  confiancaMinima: 'confiança mínima',
  tempoEstimado: 'tempo estimado',
  liberadaPara: 'quem está liberado no teste',
};

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function semTeste(api: TarefaDefinicao['api']) {
  if (!api) return api;
  const { testadaEm: _t, ...resto } = api;
  return resto;
}

interface Diferenca {
  n: number;
  frases: string[];
}

function diferencas(antes: TarefaDefinicao, depois: TarefaDefinicao): Diferenca {
  let n = 0;
  const frases: string[] = [];
  const porChave = new Map(antes.campos.map((c) => [c.chave, c]));
  const novasChaves = new Set(depois.campos.map((c) => c.chave));
  for (const c of depois.campos) {
    const velho = porChave.get(c.chave);
    if (!velho) {
      n++;
      frases.push(`campo "${c.rotulo}" incluído`);
    } else if (!igual(velho, c)) {
      n++;
      frases.push(`campo "${c.rotulo}" alterado`);
    }
  }
  for (const c of antes.campos) {
    if (!novasChaves.has(c.chave)) {
      n++;
      frases.push(`campo "${c.rotulo}" removido`);
    }
  }
  const exAntes = new Set(antes.exemplos);
  const exDepois = new Set(depois.exemplos);
  const exNovos = depois.exemplos.filter((e) => !exAntes.has(e)).length;
  const exFora = antes.exemplos.filter((e) => !exDepois.has(e)).length;
  if (exNovos + exFora > 0) {
    n += exNovos + exFora;
    const partes = [];
    if (exNovos) partes.push(exNovos === 1 ? '1 frase de exemplo nova' : `${exNovos} frases de exemplo novas`);
    if (exFora) partes.push(exFora === 1 ? '1 frase de exemplo removida' : `${exFora} frases de exemplo removidas`);
    frases.push(partes.join(' e '));
  }
  for (const chave of Object.keys(ROTULOS) as (keyof TarefaDefinicao)[]) {
    const a = chave === 'api' ? semTeste(antes.api) : antes[chave];
    const b = chave === 'api' ? semTeste(depois.api) : depois[chave];
    if (!igual(a, b)) {
      n++;
      frases.push(`${ROTULOS[chave]} alterado`);
    }
  }
  return { n, frases };
}

/** Quantas alterações o rascunho tem em relação à versão publicada (sem publicada: 0). */
export function contarAlteracoes(publicada: TarefaDefinicao | null, rascunho: TarefaDefinicao): number {
  return publicada ? diferencas(publicada, rascunho).n : 0;
}

/** Resumo curto das mudanças, para o histórico quando quem publica não escreve um. */
export function resumirAlteracoes(publicada: TarefaDefinicao | null, rascunho: TarefaDefinicao): string {
  if (!publicada) return 'Primeira versão.';
  const { frases } = diferencas(publicada, rascunho);
  if (frases.length === 0) return 'Publicada sem mudanças na ficha.';
  const texto = frases.slice(0, 4).join('; ') + (frases.length > 4 ? `; e mais ${frases.length - 4}` : '');
  return texto.charAt(0).toUpperCase() + texto.slice(1) + '.';
}

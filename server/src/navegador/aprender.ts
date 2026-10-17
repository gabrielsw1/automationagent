// Aprender fluxo: transforma os eventos gravados na tela (sem valores digitados) em passos com
// seletores candidatos e sugere os campos da tarefa. O Claude organiza e dá nomes simples; sem
// chave, a conversão por regras (determinística) faz o trabalho sozinha.
import { z } from 'zod';
import type { Campo, EventoGravado, PassoFluxo, SeletorCandidato, TipoCampo, TipoPasso } from '@copiloto/shared';
import type { Llm } from '../llm/tipos.ts';
import { candidatosDe, dataCampoDe, ehCampoDeDigitar, ehClicavel, nomeVisivel, opcoesDoContexto } from './seletores.ts';
import {
  caminhoDe,
  chaveDe,
  encurtar,
  humanizar,
  maiusculaInicial,
  melhorSimilaridade,
  minusculaInicial,
  normalizar,
  perguntaPara,
} from './texto.ts';

type ElementoGravado = NonNullable<EventoGravado['elemento']>;

export interface ResultadoAprendizado {
  passos: PassoFluxo[];
  camposSugeridos: Campo[];
}

/** Passo em construção, com o elemento gravado ao lado (para sugerir o campo). */
interface Rascunho {
  passo: PassoFluxo;
  elemento?: ElementoGravado;
  chaveElemento?: string;
  ts: number;
  opcaoTexto?: string;
}

const PALAVRAS_TELA_NOVA = new Set(['novo', 'nova', 'criar', 'cadastrar', 'adicionar', 'editar', 'incluir']);

/** Nome da tela pelo caminho: "/agenda/nova-visita" → "nova visita"; "/clientes/novo" → "novo cliente". */
export function nomeDaTela(url: string, tituloPagina?: string): string {
  const caminho = caminhoDe(url).split('?')[0];
  const partes = caminho.split('/').filter((p) => p && !/^\d+$/.test(p) && !/^[0-9a-f-]{16,}$/i.test(p));
  const ultima = partes[partes.length - 1];
  if (!ultima) {
    const t = (tituloPagina ?? '').split(/\s[·|–—-]\s/)[0]?.trim();
    return t || 'início';
  }
  const penultima = partes[partes.length - 2];
  if (PALAVRAS_TELA_NOVA.has(ultima.toLowerCase()) && penultima) {
    const singular = penultima.replace(/s$/, '');
    return `${ultima} ${humanizar(singular)}`.toLowerCase();
  }
  return humanizar(ultima).toLowerCase();
}

function chaveDoElemento(el: ElementoGravado): string {
  return el.name || el.id || el.css;
}

function rotuloDoCampo(el: ElementoGravado): string {
  return encurtar(el.rotulo || el.ariaLabel || el.placeholder || (el.name ? maiusculaInicial(humanizar(el.name)) : '') || el.texto || 'campo', 80);
}

/** Converte a gravação em passos por regras fixas (também é a simulação do Claude). */
export function converterPorRegras(eventos: EventoGravado[], camposTarefa: Campo[] = []): ResultadoAprendizado {
  const ordenados = [...eventos].sort((a, b) => a.ts - b.ts);
  const lista: Rascunho[] = [];
  let paginaAtual: string | null = null;
  let ultimoCliqueTs = -Infinity;

  const novo = (tipo: TipoPasso, titulo: string, ev: EventoGravado, extra: Partial<PassoFluxo> = {}): Rascunho => {
    const el = ev.elemento;
    const r: Rascunho = {
      passo: {
        n: 0,
        tipo,
        titulo,
        url: caminhoDe(ev.url),
        seletores: el ? candidatosDe(el, tipo) : [],
        seletorEscolhido: 0,
        ...extra,
      },
      elemento: el,
      chaveElemento: el ? chaveDoElemento(el) : undefined,
      ts: ev.ts,
    };
    lista.push(r);
    return r;
  };

  for (const ev of ordenados) {
    const el = ev.elemento;
    const ultimo = lista[lista.length - 1];
    switch (ev.tipo) {
      case 'navegar': {
        const caminho = caminhoDe(ev.url);
        const semBusca = caminho.split('?')[0];
        const causadaPorClique = ev.ts - ultimoCliqueTs < 5_000;
        if (lista.length === 0 || (!causadaPorClique && semBusca !== paginaAtual)) {
          const tela = nomeDaTela(ev.url, ev.tituloPagina);
          novo('navegar', `Abrir a tela de ${tela}`, ev, { url: caminho, rotuloElemento: maiusculaInicial(tela), seletores: [] });
        }
        paginaAtual = semBusca;
        break;
      }
      case 'clique': {
        if (!el) break;
        // Clique para pôr o cursor num campo (ou no rótulo) não é um passo: o preencher já cobre.
        const tag = el.tag.toLowerCase();
        if (ehCampoDeDigitar(el) || tag === 'select' || tag === 'option' || tag === 'label' || tag === 'textarea') break;
        if (!ehClicavel(el) && !el.texto) break;
        ultimoCliqueTs = ev.ts;
        if (paginaAtual === null) paginaAtual = caminhoDe(ev.url).split('?')[0];
        const nome = nomeVisivel(el) || 'elemento';
        novo('clique', `Clicar em ${nome}`, ev, { rotuloElemento: nome });
        break;
      }
      case 'preencher': {
        if (!el) break;
        if (paginaAtual === null) paginaAtual = caminhoDe(ev.url).split('?')[0];
        const chave = chaveDoElemento(el);
        if (ultimo && ultimo.passo.tipo === 'preencher' && ultimo.chaveElemento === chave) {
          if (ev.formatoValor !== undefined) ultimo.passo.formatoGravado = ev.formatoValor;
          ultimo.ts = ev.ts;
          break;
        }
        const rotulo = rotuloDoCampo(el);
        novo('preencher', `Preencher ${minusculaInicial(rotulo)}`, ev, { rotuloElemento: rotulo, formatoGravado: ev.formatoValor });
        break;
      }
      case 'selecionar': {
        if (!el) break;
        if (paginaAtual === null) paginaAtual = caminhoDe(ev.url).split('?')[0];
        const chave = chaveDoElemento(el);
        const rotulo = rotuloDoCampo(el);
        const formato = ev.opcaoTexto ? ev.opcaoTexto.replace(/\d/g, '9') : undefined;
        if (ultimo && ultimo.passo.tipo === 'selecionar' && ultimo.chaveElemento === chave) {
          ultimo.opcaoTexto = ev.opcaoTexto;
          ultimo.passo.formatoGravado = formato;
          break;
        }
        const r = novo('selecionar', `Selecionar ${minusculaInicial(rotulo)}`, ev, { rotuloElemento: rotulo, formatoGravado: formato });
        r.opcaoTexto = ev.opcaoTexto;
        break;
      }
      case 'download': {
        // O download costuma vir logo depois do clique que o disparou: vira um passo só.
        const clique = [...lista].reverse().find((r) => r.passo.tipo === 'clique');
        const mesmo =
          clique &&
          (lista[lista.length - 1] === clique || (el && clique.chaveElemento === chaveDoElemento(el))) &&
          ev.ts - clique.ts < 15_000;
        const pdf = /pdf/i.test([el?.href, el?.texto, ev.url].join(' '));
        if (mesmo && clique) {
          clique.passo.tipo = 'download';
          clique.passo.titulo = `Baixar ${pdf ? 'o PDF' : 'o arquivo'} em ${clique.passo.rotuloElemento ?? 'botão'}`;
          clique.passo.seletores = clique.elemento ? candidatosDe(clique.elemento, 'download') : clique.passo.seletores;
          break;
        }
        const nome = el ? nomeVisivel(el) : '';
        novo('download', `Baixar ${pdf ? 'o PDF' : 'o arquivo'}${nome ? ` em ${nome}` : ''}`, ev, {
          rotuloElemento: nome || undefined,
          pendencia: el ? undefined : 'Marque o botão que baixa o arquivo.',
        });
        break;
      }
      case 'leitura': {
        if (!el) break;
        const dataCampo = dataCampoDe(el);
        const rotulo = encurtar(el.rotulo || (dataCampo ? humanizar(dataCampo) : '') || el.ariaLabel || el.texto || 'dado da tela', 60);
        const gera = dataCampo ? chaveDe(dataCampo) : chaveDe(el.rotulo || el.name || el.id || rotulo);
        novo('leitura', `Ler ${minusculaInicial(rotulo)}`, ev, { rotuloElemento: rotulo, gera });
        break;
      }
    }
  }

  lista.forEach((r, i) => (r.passo.n = i + 1));
  const camposSugeridos = sugerirCampos(lista);
  mapearValores(lista, camposSugeridos, camposTarefa);
  return { passos: lista.map((r) => r.passo), camposSugeridos };
}

/** Tipo do campo pelo que se sabe do elemento e do formato digitado. */
export function tipoDoCampo(el: ElementoGravado | undefined, formato: string | undefined, rotulo: string, opcoes: string[]): TipoCampo {
  const tag = el?.tag.toLowerCase() ?? '';
  const tipo = (el?.type ?? '').toLowerCase();
  const pistas = normalizar([el?.name, el?.id, rotulo, el?.placeholder].join(' '));
  const f = formato ?? '';
  if (tag === 'select') return opcoes.length ? 'lista' : 'texto';
  if (tipo === 'email' || /\be ?mail\b/.test(pistas)) return 'email';
  if (/\b(cpf|cnpj|documento|doc)\b/.test(pistas) || /^9{3}\.?9{3}\.?9{3}-?9{2}$|^9{2}\.?9{3}\.?9{3}\/?9{4}-?9{2}$/.test(f)) return 'documento';
  if (tipo === 'date' || /^9{4}-9{2}-9{2}$|^9{2}\/9{2}\/9{4}$/.test(f) || /\b(data|dt)\b/.test(pistas)) return 'data';
  if (tipo === 'time' || /\b(hora|horario)\b/.test(pistas)) return 'hora';
  if (tipo === 'tel' || /\b(telefone|celular|fone|whatsapp)\b/.test(pistas)) return 'telefone';
  if (/\b(valor|preco|total)\b/.test(pistas) && /9/.test(f)) return 'moeda';
  if (tipo === 'number') return 'numero';
  return 'texto';
}

function sugerirCampos(lista: Rascunho[]): Campo[] {
  const campos: Campo[] = [];
  for (const r of lista) {
    if (r.passo.tipo !== 'preencher' && r.passo.tipo !== 'selecionar') continue;
    const rotulo = r.passo.rotuloElemento ?? 'Campo';
    const opcoes = opcoesDoContexto(r.elemento?.contexto);
    const tipo = tipoDoCampo(r.elemento, r.passo.formatoGravado, rotulo, opcoes);
    let chave = chaveDe(rotulo);
    for (let i = 2; campos.some((c) => c.chave === chave); i++) chave = `${chaveDe(rotulo)}_${i}`;
    const campo: Campo = { chave, rotulo, tipo, obrigatorio: true, pergunta: perguntaPara(rotulo) };
    if (tipo === 'lista') {
      campo.opcoes = opcoes;
      // Com poucas opções, a pergunta já diz quais são: "Qual é a prioridade: Baixa, Média, Alta ou Urgente?"
      if (opcoes.length >= 2 && opcoes.length <= 6) {
        campo.pergunta = `${campo.pergunta.replace(/\?$/, '')}: ${opcoes.slice(0, -1).join(', ')} ou ${opcoes[opcoes.length - 1]}?`;
      }
    }
    if (tipo === 'documento') campo.pergunta = `Qual é o CPF ou CNPJ${/pagador/i.test(rotulo) ? ' de quem paga' : ''}?`;
    campos.push(campo);
  }
  return campos;
}

/** Liga cada passo de preencher/selecionar a um campo: da tarefa (se houver) ou sugerido. */
function mapearValores(lista: Rascunho[], sugeridos: Campo[], camposTarefa: Campo[]) {
  const usados = new Set<string>();
  let iSugerido = 0;
  for (const r of lista) {
    const p = r.passo;
    if (p.tipo !== 'preencher' && p.tipo !== 'selecionar') continue;
    const sugerido = sugeridos[iSugerido++];
    if (camposTarefa.length === 0) {
      if (sugerido) p.valor = { origem: 'campo', campo: sugerido.chave };
      continue;
    }
    const campo = melhorCampo(r, camposTarefa, usados);
    if (campo) {
      usados.add(campo.chave);
      p.valor = { origem: 'campo', campo: campo.chave };
    } else if (p.tipo === 'selecionar' && r.opcaoTexto) {
      p.valor = { origem: 'fixo', valor: r.opcaoTexto };
      p.pendencia = 'Usa sempre a opção escolhida na gravação. Confira ou ligue a um dado da tarefa.';
    } else {
      p.pendencia = 'falta mapear';
    }
  }
}

function melhorCampo(r: Rascunho, campos: Campo[], usados: Set<string>): Campo | null {
  const el = r.elemento;
  const textosPasso = [r.passo.rotuloElemento, el?.name ? humanizar(el.name) : null, el?.id ? humanizar(el.id) : null, el?.placeholder];
  const tipoPasso = tipoDoCampo(el, r.passo.formatoGravado, r.passo.rotuloElemento ?? '', opcoesDoContexto(el?.contexto));
  let melhor: { campo: Campo; nota: number } | null = null;
  for (const c of campos) {
    if (usados.has(c.chave)) continue;
    let nota = melhorSimilaridade(textosPasso, [c.rotulo, humanizar(c.chave)]);
    if (c.tipo === tipoPasso && tipoPasso !== 'texto') nota += 0.25;
    if (!melhor || nota > melhor.nota) melhor = { campo: c, nota };
  }
  return melhor && melhor.nota >= 0.5 ? melhor.campo : null;
}

// ---------- Com o Claude ----------

const TIPOS_PASSO = ['navegar', 'clique', 'preencher', 'selecionar', 'leitura', 'download', 'esperar'] as const;
const TIPOS_CAMPO = ['texto', 'documento', 'email', 'telefone', 'lista', 'data', 'hora', 'numero', 'moeda', 'pessoa'] as const;

const EsquemaAprendizado = z.object({
  passos: z.array(
    z.object({
      tipo: z.enum(TIPOS_PASSO),
      titulo: z.string().describe('Verbo simples no infinitivo para quem não é técnico. Ex.: "Preencher CPF/CNPJ".'),
      rotuloElemento: z.string().nullable(),
      url: z.string().nullable(),
      seletores: z.array(
        z.object({
          seletor: z.string(),
          estabilidade: z.enum(['estavel', 'fragil']),
          motivo: z.string().describe('Explicação leiga de por que o seletor é estável ou frágil.'),
        }),
      ),
      seletorEscolhido: z.number().int(),
      campo: z.string().nullable().describe('Chave do campo (da tarefa ou sugerido) que dá o valor, para preencher e selecionar.'),
      valorFixo: z.string().nullable(),
      formatoGravado: z.string().nullable(),
      gera: z.string().nullable().describe('Para leitura e download: nome do dado gerado, em snake_case.'),
      pendencia: z.string().nullable(),
    }),
  ),
  camposSugeridos: z.array(
    z.object({
      chave: z.string(),
      rotulo: z.string(),
      tipo: z.enum(TIPOS_CAMPO),
      obrigatorio: z.boolean(),
      pergunta: z.string(),
      opcoes: z.array(z.string()).nullable(),
    }),
  ),
});

type SaidaAprendizado = z.infer<typeof EsquemaAprendizado>;

const SISTEMA_APRENDER = `Você é o Copiloto aprendendo um fluxo que um administrador fez uma vez na tela do sistema da empresa.
Você recebe os eventos gravados (cliques, campos preenchidos, listas escolhidas, downloads e leituras), um rascunho de passos
montado por regras e, quando existe, a lista de campos da tarefa que vai usar este fluxo.

Devolva os passos que um robô de navegador deve repetir e os campos que a tarefa precisa. Regras:
- Os valores digitados NUNCA foram gravados, só o formato (9 = dígito, a = letra). Não invente valores.
- Tire passos inúteis (cliques para pôr o cursor num campo, cliques repetidos, navegações causadas por um clique).
- Cada passo tem um título curto com verbo no infinitivo, sem jargão: "Abrir a tela de segunda via", "Preencher CPF/CNPJ",
  "Selecionar competência", "Clicar em Buscar boletos", "Ler a linha digitável", "Baixar o PDF".
- Seletores no formato do Playwright, do mais estável ao mais frágil: name, id, data-testid, data-campo, rótulo (label=...),
  papel e nome (role=button[name="..."]), e só no fim CSS frágil. Use os candidatos do rascunho; não invente atributos que não
  aparecem nos eventos. O motivo de cada um é uma frase para leigos (ex.: "usa o nome interno do campo, que quase nunca muda").
  Texto de botão é frágil: se o texto mudar, o seletor quebra.
- Para preencher e selecionar, ligue o passo a um campo: use a chave de um campo da tarefa quando houver um que corresponda;
  senão, a chave de um campo sugerido. Sem correspondência, deixe campo null e pendencia "falta mapear".
- Leituras geram um dado com nome em snake_case (ex.: "protocolo", "linha_digitavel").
- Campos sugeridos: chave em snake_case, rótulo como aparece na tela, tipo (documento para CPF/CNPJ, data, hora, email,
  lista com as opções quando for uma lista), obrigatorio, e a pergunta que o assistente faz quando falta o dado.`;

function paraSaida(r: ResultadoAprendizado): SaidaAprendizado {
  return {
    passos: r.passos.map((p) => ({
      tipo: p.tipo,
      titulo: p.titulo,
      rotuloElemento: p.rotuloElemento ?? null,
      url: p.url ?? null,
      seletores: p.seletores,
      seletorEscolhido: p.seletorEscolhido,
      campo: p.valor?.origem === 'campo' ? p.valor.campo : null,
      valorFixo: p.valor?.origem === 'fixo' ? p.valor.valor : null,
      formatoGravado: p.formatoGravado ?? null,
      gera: p.gera ?? null,
      pendencia: p.pendencia ?? null,
    })),
    camposSugeridos: r.camposSugeridos.map((c) => ({
      chave: c.chave,
      rotulo: c.rotulo,
      tipo: c.tipo,
      obrigatorio: c.obrigatorio,
      pergunta: c.pergunta,
      opcoes: c.opcoes ?? null,
    })),
  };
}

/** Normaliza a saída do Claude: numera, garante índices válidos e confere os campos citados. */
function deSaida(s: SaidaAprendizado, camposTarefa: Campo[]): ResultadoAprendizado {
  const camposSugeridos: Campo[] = [];
  for (const c of s.camposSugeridos) {
    const chave = chaveDe(c.chave);
    if (camposSugeridos.some((x) => x.chave === chave)) continue;
    const campo: Campo = { chave, rotulo: c.rotulo.trim() || chave, tipo: c.tipo, obrigatorio: c.obrigatorio, pergunta: c.pergunta.trim() || perguntaPara(c.rotulo) };
    if (c.tipo === 'lista') campo.opcoes = (c.opcoes ?? []).filter(Boolean);
    camposSugeridos.push(campo);
  }
  const chavesValidas = new Set([...(camposTarefa.length ? camposTarefa : camposSugeridos).map((c) => c.chave)]);
  const passos: PassoFluxo[] = s.passos.map((p, i) => {
    const seletores: SeletorCandidato[] = p.seletores.filter((x) => x.seletor.trim());
    const passo: PassoFluxo = {
      n: i + 1,
      tipo: p.tipo,
      titulo: p.titulo.trim() || p.tipo,
      seletores,
      seletorEscolhido: seletores.length ? Math.min(Math.max(0, p.seletorEscolhido), seletores.length - 1) : 0,
    };
    if (p.rotuloElemento) passo.rotuloElemento = p.rotuloElemento;
    if (p.url) passo.url = caminhoDe(p.url);
    if (p.formatoGravado) passo.formatoGravado = p.formatoGravado;
    if (p.gera) passo.gera = chaveDe(p.gera);
    if (p.tipo === 'preencher' || p.tipo === 'selecionar') {
      if (p.campo && chavesValidas.has(p.campo)) passo.valor = { origem: 'campo', campo: p.campo };
      else if (p.valorFixo) passo.valor = { origem: 'fixo', valor: p.valorFixo };
    }
    const pendencia = p.pendencia?.trim() || pendenciaDe(passo);
    if (pendencia) passo.pendencia = pendencia;
    return passo;
  });
  return { passos, camposSugeridos };
}

/** Pendência calculada do passo (o que falta para o fluxo rodar). */
export function pendenciaDe(p: PassoFluxo): string | undefined {
  if ((p.tipo === 'preencher' || p.tipo === 'selecionar') && !p.valor) return 'falta mapear';
  if (p.tipo !== 'navegar' && p.tipo !== 'esperar' && p.seletores.length === 0) return 'Marque o elemento da tela deste passo.';
  return undefined;
}

/** Eventos sem o HTML longo de contexto, para caber na conversa com o Claude. */
function eventosParaPrompt(eventos: EventoGravado[]) {
  return eventos.map((e) => ({
    ...e,
    url: caminhoDe(e.url),
    elemento: e.elemento ? { ...e.elemento, contexto: e.elemento.contexto ? encurtar(e.elemento.contexto, 600) : undefined } : undefined,
  }));
}

/**
 * Aprende o fluxo com o Claude (modelo principal). A simulação devolve a conversão por regras.
 * `camposTarefa`: campos da tarefa ligada ao fluxo, para mapear os valores.
 */
export async function aprenderFluxo(
  llm: Llm,
  eventos: EventoGravado[],
  camposTarefa: Campo[] = [],
): Promise<ResultadoAprendizado> {
  const porRegras = converterPorRegras(eventos, camposTarefa);
  if (eventos.length === 0) return porRegras;
  const texto = [
    `Eventos gravados (${eventos.length}):\n${JSON.stringify(eventosParaPrompt(eventos))}`,
    `Rascunho por regras:\n${JSON.stringify(paraSaida(porRegras))}`,
    camposTarefa.length
      ? `Campos da tarefa (use estas chaves no campo de cada passo):\n${JSON.stringify(camposTarefa.map((c) => ({ chave: c.chave, rotulo: c.rotulo, tipo: c.tipo, opcoes: c.opcoes })))}`
      : 'A tarefa ainda não existe: sugira os campos e ligue cada passo de preencher/selecionar a um campo sugerido.',
  ].join('\n\n');
  const { dados } = await llm.estruturado({
    modelo: 'principal',
    finalidade: 'aprender_fluxo',
    sistema: SISTEMA_APRENDER,
    mensagens: [{ role: 'user', content: texto }],
    esquema: EsquemaAprendizado,
    maxTokens: 16000,
    simulacao: () => paraSaida(porRegras),
  });
  const resultado = deSaida(dados, camposTarefa);
  // Nunca devolve menos do que as regras conseguiram (resposta vazia ou truncada).
  return resultado.passos.length === 0 && porRegras.passos.length > 0 ? porRegras : resultado;
}

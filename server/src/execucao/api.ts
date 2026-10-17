// Monta as chamadas à API do sistema a partir da ficha da tarefa: corpo (mapeamento de campos com
// transformações), caminhos com {campo} e {id}, e leitura do registro existente num conflito.
import {
  casarOpcao,
  formatarCnpj,
  formatarCpf,
  somenteDigitos,
  type Campo,
  type CampoExibido,
  type MapeamentoCampo,
  type TarefaDefinicao,
  type Transformacao,
  type UsuarioSistema,
} from '@copiloto/shared';

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Valor do campo no formato que a API espera. */
export function transformar(
  valor: string,
  transformacao: Transformacao | undefined,
  campo: Campo | undefined,
  usuarios: UsuarioSistema[],
): string | number {
  const t = transformacao ?? (campo?.tipo === 'documento' ? 'somente_digitos' : 'nenhuma');
  switch (t) {
    case 'somente_digitos':
      return somenteDigitos(valor);
    case 'numero': {
      const m = valor.replace(',', '.').match(/-?\d+(\.\d+)?/);
      return m ? Number(m[0]) : valor;
    }
    case 'id_usuario': {
      const alvo = normalizar(valor);
      const u = usuarios.find((x) => x.id === valor || normalizar(x.nome) === alvo || normalizar(x.email) === alvo);
      return u ? u.id : valor;
    }
    case 'data_iso':
    case 'nenhuma':
    default:
      return valor;
  }
}

/** Corpo da chamada: cada campo mapeado vai para o nome que a API espera. */
export function montarCorpo(
  def: TarefaDefinicao,
  valores: Record<string, string>,
  usuarios: UsuarioSistema[],
  somente?: string[],
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  for (const m of def.api?.mapeamento ?? []) {
    if (somente && !somente.includes(m.campo)) continue;
    const v = valores[m.campo];
    if (v === undefined || v === '') continue;
    const campo = def.campos.find((c) => c.chave === m.campo);
    corpo[m.destino] = transformar(v, m.transformacao, campo, usuarios);
  }
  return corpo;
}

/** Troca {campo} e {id} no caminho. Documentos vão só com dígitos. */
export function preencherCaminho(
  caminho: string,
  def: TarefaDefinicao,
  valores: Record<string, string>,
  extras: Record<string, string> = {},
): string {
  return caminho.replace(/\{(\w+)\}/g, (_, chave: string) => {
    if (extras[chave] !== undefined) return encodeURIComponent(extras[chave]);
    const v = valores[chave];
    if (v === undefined) return '';
    const campo = def.campos.find((c) => c.chave === chave);
    const m = def.api?.mapeamento.find((x) => x.campo === chave);
    return encodeURIComponent(String(transformar(v, m?.transformacao, campo, [])));
  });
}

/** Registro encontrado por uma verificação "já existe?" (lista em `itens` ou objeto com id). */
export function existenteDe(status: number, corpo: unknown): Record<string, unknown> | null {
  if (status !== 200 || !corpo || typeof corpo !== 'object') return null;
  const c = corpo as Record<string, unknown>;
  if (Array.isArray(c.itens)) return (c.itens[0] as Record<string, unknown> | undefined) ?? null;
  if (Array.isArray(corpo)) return ((corpo as unknown[])[0] as Record<string, unknown> | undefined) ?? null;
  return c.id !== undefined ? c : null;
}

export function tituloDoRegistro(r: Record<string, unknown>): string {
  for (const k of ['razao_social', 'nome', 'titulo', 'assunto', 'cliente_nome']) {
    if (typeof r[k] === 'string' && r[k]) return r[k] as string;
  }
  return r.id !== undefined ? `Registro ${String(r.id)}` : 'Registro existente';
}

export function codigoDoRegistro(r: Record<string, unknown>): string | undefined {
  if (typeof r.codigo === 'string' && r.codigo) return r.codigo;
  if (typeof r.numero === 'string' && r.numero) return r.numero;
  return r.id !== undefined ? `#${String(r.id)}` : undefined;
}

/** Valor que a API devolveu, no formato que a pessoa entende (lista, documento, pessoa). */
export function valorDaApi(v: unknown, campo: Campo, usuarios: UsuarioSistema[]): string {
  if (v === null || v === undefined) return '';
  const texto = String(v);
  if (campo.tipo === 'documento') {
    const d = somenteDigitos(texto);
    return d.length === 14 ? formatarCnpj(d) : d.length === 11 ? formatarCpf(d) : texto;
  }
  if (campo.tipo === 'lista' && campo.opcoes?.length) return casarOpcao(texto, campo.opcoes) ?? texto;
  if (campo.tipo === 'pessoa') return usuarios.find((u) => u.id === texto)?.nome ?? texto;
  return texto;
}

/** Campos de um registro existente, com os rótulos da tarefa (para o cartão de conflito). */
export function camposDoRegistro(
  def: TarefaDefinicao,
  registro: Record<string, unknown>,
  usuarios: UsuarioSistema[],
  pularTitulo = true,
): CampoExibido[] {
  const titulo = tituloDoRegistro(registro);
  const lista: CampoExibido[] = [];
  for (const m of def.api?.mapeamento ?? []) {
    const campo = def.campos.find((c) => c.chave === m.campo);
    if (!campo) continue;
    const v = valorDaApi(registro[m.destino], campo, usuarios);
    if (!v || (pularTitulo && v === titulo)) continue;
    lista.push({ rotulo: campo.rotulo, valor: v });
  }
  return lista;
}

/** Campos que mudam ao atualizar um registro existente com os dados novos. */
export function diferencas(
  def: TarefaDefinicao,
  registro: Record<string, unknown>,
  valores: Record<string, string>,
  usuarios: UsuarioSistema[],
): { mapeamento: MapeamentoCampo; campo: Campo; antes: string; depois: string }[] {
  const saida: { mapeamento: MapeamentoCampo; campo: Campo; antes: string; depois: string }[] = [];
  for (const m of def.api?.mapeamento ?? []) {
    const campo = def.campos.find((c) => c.chave === m.campo);
    if (!campo || campo.verificarExistente) continue;
    const depois = valores[m.campo];
    if (!depois) continue;
    const antes = valorDaApi(registro[m.destino], campo, usuarios);
    if (normalizar(antes) === normalizar(depois)) continue;
    // Nome diferente do mesmo registro (ex.: "ACME Logística" x "ACME Log Ltda") não troca a razão social.
    if (campo.tipo === 'texto' && m.destino === 'razao_social') continue;
    saida.push({ mapeamento: m, campo, antes, depois });
  }
  return saida;
}

/** Campos simples da resposta (texto e número), para os títulos com {campo}. */
export function escalares(corpo: unknown): Record<string, string> {
  const r: Record<string, string> = {};
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return r;
  for (const [k, v] of Object.entries(corpo as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') r[k] = String(v);
  }
  return r;
}

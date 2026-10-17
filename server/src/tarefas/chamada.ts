// "Testar a chamada" da ficha (C3): chama a API do sistema em modo de simulação (nada é gravado)
// com dados de exemplo e explica o resultado em linguagem de negócio.
import type { Campo, TarefaDefinicao, Transformacao, UsuarioSistema } from '@copiloto/shared';
import { formatarCnpj, somenteDigitos } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';
import { podeExecutar } from '../servicos/catalogo.ts';

export interface ResultadoChamada {
  ok: boolean;
  status: number;
  duracaoMs: number;
  mensagem: string;
}

/** CNPJ válido e aleatório, para não cair em "já cadastrado" no teste. */
export function cnpjAleatorio(): string {
  const n = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (base: number[]) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = base.reduce((a, x, i) => a + x * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  n.push(dv(n));
  n.push(dv(n));
  return formatarCnpj(n.join(''));
}

/** Valor de exemplo para um campo, já no formato que a pessoa digitaria. */
export function valorExemplo(campo: Campo, usuario: UsuarioSistema | null): string {
  if (campo.padrao && campo.padrao !== 'solicitante') return campo.padrao;
  switch (campo.tipo) {
    case 'documento':
      return /cpf/i.test(campo.chave) ? '529.982.247-25' : cnpjAleatorio();
    case 'email':
      return 'teste.copiloto@exemplo.com.br';
    case 'telefone':
      return '(51) 99999-0000';
    case 'lista':
      return campo.opcoes?.[0] ?? '';
    case 'data': {
      const d = new Date(Date.now() + 7 * 86400_000);
      return d.toISOString().slice(0, 10);
    }
    case 'hora':
      return '14:00';
    case 'numero':
      return String(campo.minimo ?? 1);
    case 'moeda':
      return '100.00';
    case 'pessoa':
      return usuario?.id ?? '';
    default:
      return /nome|razao|empresa|cliente/i.test(campo.chave) ? 'Empresa Teste do Copiloto Ltda' : 'Teste do copiloto';
  }
}

export function transformar(valor: string, t: Transformacao | undefined, usuario: UsuarioSistema | null): unknown {
  switch (t) {
    case 'somente_digitos':
      return somenteDigitos(valor);
    case 'numero': {
      const primeiro = (valor.trim().split(/\s+/)[0] ?? '').replace(',', '.');
      const n = Number(primeiro);
      if (primeiro && Number.isFinite(n)) return n;
      const d = somenteDigitos(valor);
      return d ? Number(d) : valor;
    }
    case 'id_usuario':
      return valor || usuario?.id || '';
    default:
      return valor;
  }
}

function mensagemDe(corpo: unknown): string | null {
  if (corpo && typeof corpo === 'object' && 'mensagem' in corpo) {
    const m = (corpo as { mensagem?: unknown }).mensagem;
    return typeof m === 'string' && m.trim() ? m.trim() : null;
  }
  return null;
}

/** Escolhe quem "faz" o teste: alguém com permissão para a tarefa, de preferência. */
async function usuarioDeTeste(ctx: Contexto, def: TarefaDefinicao): Promise<UsuarioSistema | null> {
  try {
    const usuarios = await ctx.adaptador.listarUsuarios();
    return usuarios.find((u) => podeExecutar(def, u.perfis)) ?? usuarios[0] ?? null;
  } catch {
    return null;
  }
}

export async function testarChamada(ctx: Contexto, def: TarefaDefinicao): Promise<ResultadoChamada> {
  const api = def.api;
  if (!api || !api.caminho.trim()) {
    return { ok: false, status: 0, duracaoMs: 0, mensagem: 'Informe o método e o caminho da chamada antes de testar.' };
  }
  const usuario = await usuarioDeTeste(ctx, def);
  const valores = new Map(def.campos.map((c) => [c.chave, valorExemplo(c, usuario)]));
  const corpo: Record<string, unknown> = {};
  for (const m of api.mapeamento) {
    const campo = def.campos.find((c) => c.chave === m.campo);
    if (!campo) continue;
    corpo[m.destino] = transformar(valores.get(m.campo) ?? '', m.transformacao, usuario);
  }
  const caminho = api.caminho.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(valores.get(k) ?? '1')));
  const inicio = Date.now();
  try {
    const r = await ctx.adaptador.chamar({
      metodo: api.metodo,
      caminho,
      corpo: api.metodo === 'GET' || api.metodo === 'DELETE' ? undefined : corpo,
      usuarioId: usuario?.id ?? 'copiloto',
      simulacao: true,
      tempoLimiteMs: 15_000,
    });
    const ms = r.duracaoMs || Date.now() - inicio;
    const doSistema = mensagemDe(r.corpo);
    const sistema = ctx.adaptador.nome;
    if (r.status >= 200 && r.status < 300) {
      return {
        ok: true,
        status: r.status,
        duracaoMs: ms,
        mensagem: `A chamada funcionou: o ${sistema} aceitou os dados de exemplo em ${ms} ms. Nada foi gravado.`,
      };
    }
    if (r.status === 409) {
      return {
        ok: true,
        status: r.status,
        duracaoMs: ms,
        mensagem: `A chamada chegou ao ${sistema}, que avisou que o registro de exemplo já existe${doSistema ? ` (“${doSistema}”)` : ''}. A rota e o mapeamento estão certos.`,
      };
    }
    const porStatus: Record<number, string> = {
      400: `O ${sistema} não entendeu os dados enviados. Confira o mapeamento dos campos.`,
      401: `O ${sistema} recusou a chave de serviço do copiloto. Confira a conexão com o sistema.`,
      403: `O usuário de teste${usuario ? ` (${usuario.nome})` : ''} não tem permissão para isso no ${sistema}. Confira os perfis em "Quem pode executar".`,
      404: `Não achei esta rota no ${sistema}. Confira o método e o caminho da chamada.`,
      405: `O ${sistema} não aceita o método ${api.metodo} neste caminho.`,
      422: `O ${sistema} recusou os dados de exemplo. Confira o mapeamento e as validações dos campos.`,
    };
    const base = porStatus[r.status] ?? `O ${sistema} respondeu com erro ${r.status}. Tente de novo em instantes.`;
    return {
      ok: false,
      status: r.status,
      duracaoMs: ms,
      mensagem: doSistema && r.status !== 404 ? `${base} Resposta do sistema: “${doSistema}”.` : base,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      duracaoMs: Date.now() - inicio,
      mensagem: `Não consegui falar com o ${ctx.adaptador.nome}. Confira se o sistema está no ar e tente de novo.`,
    };
  }
}

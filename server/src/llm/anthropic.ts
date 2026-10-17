// Claude pelo SDK oficial (@anthropic-ai/sdk). A chave vem de ANTHROPIC_API_KEY (o SDK lê sozinho).
//
// Escolhas, seguindo a documentação da API:
// - Modelo principal com thinking adaptativo (sempre ligado no Opus 5.5) e esforço explícito.
// - Streaming em todo turno do agente; max_tokens com folga para o thinking.
// - Histórico só cresce e os blocos de thinking voltam sem alteração. Mesmo assim pedimos
//   prefix_mismatch_behavior "drop_block": se algum dia o prefixo mudar, o bloco é descartado em vez de dar erro.
// - fallbacks "default": se o modelo principal recusar por política, a API refaz o pedido no modelo reserva.
// - Ferramentas com eager_input_streaming; a entrada é validada pelo agente antes de executar.
// - Cache de prompt no sistema + ferramentas (estáveis) e no fim do histórico.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { custoUsd } from './precos.ts';
import {
  ErroLlm,
  RecusaDoModelo,
  type BlocoResposta,
  type Esforco,
  type Llm,
  type MotivoParada,
  type PedidoEstruturado,
  type PedidoTurno,
  type RegistrarUso,
  type RespostaTurno,
  type UsoLlm,
} from './tipos.ts';

const BETAS_PRINCIPAL: Anthropic.Beta.AnthropicBeta[] = [
  'thinking-binding-controls-2026-08-01',
  'server-side-fallback-2026-07-01',
];

export interface OpcoesClaude {
  modeloPrincipal: string;
  modeloRapido: string;
  esforco: Esforco;
  registrarUso: RegistrarUso;
}

export class LlmClaude implements Llm {
  readonly simulado = false;
  readonly modeloPrincipal: string;
  private readonly client: Anthropic;

  constructor(private readonly opcoes: OpcoesClaude) {
    this.modeloPrincipal = opcoes.modeloPrincipal;
    this.client = new Anthropic({ maxRetries: 3 });
  }

  async turno(pedido: PedidoTurno): Promise<RespostaTurno> {
    let tentativasJson = 0;
    for (;;) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.opcoes.modeloPrincipal,
          max_tokens: pedido.maxTokens ?? 64000,
          betas: BETAS_PRINCIPAL,
          fallbacks: 'default',
          thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
          output_config: { effort: pedido.esforco ?? this.opcoes.esforco },
          system: [{ type: 'text', text: pedido.sistema, cache_control: { type: 'ephemeral' } }],
          // tool_choice só vai com ferramentas (sem elas a API recusa o pedido).
          ...(pedido.ferramentas.length
            ? { tools: pedido.ferramentas.map((f) => ({ ...f, eager_input_streaming: true })), tool_choice: { type: 'auto' as const } }
            : {}),
          cache_control: { type: 'ephemeral' },
          messages: pedido.mensagens,
        },
        { signal: pedido.sinal },
      );
      if (pedido.aoTexto) stream.on('text', pedido.aoTexto);

      let mensagem: Anthropic.Beta.BetaMessage;
      try {
        mensagem = await stream.finalMessage();
      } catch (e) {
        // Com eager_input_streaming, uma entrada de ferramenta que não é JSON válido rejeita o turno.
        // Só esse caso é refeito; erros da API seguem para o tratamento abaixo.
        if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIUserAbortError || tentativasJson++ >= 2) {
          throw traduzirErro(e);
        }
        continue;
      }

      const uso = this.usoDe(mensagem.model, mensagem.usage);
      this.opcoes.registrarUso(uso, pedido);
      const usouReserva = (mensagem.usage.iterations ?? []).some((it) => it.type === 'fallback_message');

      if (mensagem.stop_reason === 'refusal') {
        throw new RecusaDoModelo(mensagem.stop_details?.category ?? null);
      }
      return {
        conteudo: limparDepoisDeReserva(mensagem.content),
        parada: paradaDe(mensagem.stop_reason),
        uso,
        usouReserva,
      };
    }
  }

  async estruturado<T>(pedido: PedidoEstruturado<T>): Promise<{ dados: T; uso: UsoLlm }> {
    try {
      if (pedido.modelo === 'rapido') {
        // Haiku: classificação barata, sem thinking e com esforço baixo. Não tem modelo reserva.
        const r = await this.client.messages.parse({
          model: this.opcoes.modeloRapido,
          max_tokens: pedido.maxTokens ?? 2000,
          thinking: { type: 'disabled' },
          output_config: { effort: pedido.esforco ?? 'low', format: zodOutputFormat(pedido.esquema) },
          system: [{ type: 'text', text: pedido.sistema, cache_control: { type: 'ephemeral' } }],
          messages: pedido.mensagens as Anthropic.MessageParam[],
        });
        const uso = this.usoDe(r.model, r.usage);
        this.opcoes.registrarUso(uso, pedido);
        if (r.stop_reason === 'refusal') throw new RecusaDoModelo(r.stop_details?.category ?? null);
        if (r.parsed_output == null) throw new ErroLlm('Resposta fora do formato esperado.', 'resposta_invalida');
        return { dados: r.parsed_output as T, uso };
      }

      const r = await this.client.beta.messages.parse({
        model: this.opcoes.modeloPrincipal,
        max_tokens: pedido.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: pedido.esforco ?? this.opcoes.esforco, format: betaZodOutputFormat(pedido.esquema) },
        system: [{ type: 'text', text: pedido.sistema, cache_control: { type: 'ephemeral' } }],
        messages: pedido.mensagens,
      });
      const uso = this.usoDe(r.model, r.usage);
      this.opcoes.registrarUso(uso, pedido);
      if (r.stop_reason === 'refusal') throw new RecusaDoModelo(r.stop_details?.category ?? null);
      if (r.parsed_output == null) throw new ErroLlm('Resposta fora do formato esperado.', 'resposta_invalida');
      return { dados: r.parsed_output as T, uso };
    } catch (e) {
      throw traduzirErro(e);
    }
  }

  private usoDe(
    modelo: string,
    u: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    },
  ): UsoLlm {
    const tokens = {
      entrada: u.input_tokens,
      saida: u.output_tokens,
      cacheLeitura: u.cache_read_input_tokens ?? 0,
      cacheEscrita: u.cache_creation_input_tokens ?? 0,
    };
    return { modelo, ...tokens, custoUsd: custoUsd(modelo, tokens) };
  }
}

function paradaDe(s: string | null | undefined): MotivoParada {
  switch (s) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
    case 'pause_turn':
    case 'stop_sequence':
      return s;
    default:
      return 'outro';
  }
}

/**
 * Depois de uma troca para o modelo reserva no meio da resposta, os blocos de thinking e de
 * ferramenta anteriores ao último bloco "fallback" não devem voltar no histórico.
 */
export function limparDepoisDeReserva(conteudo: BlocoResposta[]): BlocoResposta[] {
  let ultimo = -1;
  conteudo.forEach((b, i) => {
    if (b.type === 'fallback') ultimo = i;
  });
  if (ultimo < 0) return conteudo;
  const pareados = new Set(
    conteudo.flatMap((b) => ('tool_use_id' in b && typeof b.tool_use_id === 'string' ? [b.tool_use_id] : [])),
  );
  return conteudo.filter((b, i) => {
    if (i >= ultimo) return true;
    if (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use') return false;
    if (b.type === 'server_tool_use') return pareados.has(b.id);
    return b.type === 'text' || 'tool_use_id' in b;
  });
}

function traduzirErro(e: unknown): Error {
  if (e instanceof RecusaDoModelo || e instanceof ErroLlm) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErroLlm('A chave da API do Claude foi recusada. Confira ANTHROPIC_API_KEY.', 'autenticacao', e);
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ErroLlm('Muitos pedidos ao Claude ao mesmo tempo. Tente de novo em instantes.', 'limite', e);
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new ErroLlm('O pedido ao Claude foi recusado por formato inválido.', 'pedido_invalido', e);
  }
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) {
    return new ErroLlm('Não foi possível falar com o Claude agora.', 'indisponivel', e);
  }
  if (e instanceof Anthropic.APIError) {
    return new ErroLlm(`Erro na API do Claude (${e.status ?? 'sem status'}).`, 'outro', e);
  }
  return e instanceof Error ? e : new Error(String(e));
}

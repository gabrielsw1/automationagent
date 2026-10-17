// Envio dos eventos gravados em lotes (POST /api/gravacao/:token/eventos).
// O que ainda não foi enviado fica no sessionStorage, para sobreviver à troca de página.
import type { EventoGravado, GravacaoEstado } from '@copiloto/shared';
import { juntarUrl, pedirJson } from '../chat/api.ts';
import { armazenamento, type Armazenamento } from '../chat/util.ts';

export class ApiGravacao {
  private readonly base: string;

  constructor(servidor: string, token: string) {
    this.base = juntarUrl(servidor.replace(/\/+$/, ''), `/api/gravacao/${encodeURIComponent(token)}`);
  }

  estado() {
    return pedirJson<GravacaoEstado>(this.base, { method: 'GET' });
  }

  eventos(eventos: EventoGravado[]) {
    return pedirJson<{ passos: number }>(`${this.base}/eventos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventos }),
      // Continua mesmo se a página trocar logo depois do clique.
      keepalive: true,
    });
  }

  concluir() {
    return pedirJson<{ ok: boolean; fluxoId: string }>(`${this.base}/concluir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  }

  cancelar() {
    return pedirJson<{ ok: boolean }>(`${this.base}/cancelar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  }
}

export interface OpcoesEnvio {
  api: Pick<ApiGravacao, 'eventos'>;
  chavePendentes: string;
  aoPassos?: (passos: number) => void;
  aoFalha?: (erro: unknown) => void;
  tamanhoLote?: number;
  esperaMs?: number;
  guarda?: Armazenamento;
}

export class EnvioLotes {
  private pendentes: EventoGravado[] = [];
  private enviando: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private falhas = 0;
  private readonly opcoes: OpcoesEnvio;
  private readonly guarda: Armazenamento;

  constructor(opcoes: OpcoesEnvio) {
    this.opcoes = opcoes;
    this.guarda = opcoes.guarda ?? armazenamento('sessao');
    const salvos = this.guarda.ler(opcoes.chavePendentes);
    if (salvos) {
      try {
        const lista = JSON.parse(salvos) as EventoGravado[];
        if (Array.isArray(lista)) this.pendentes = lista;
      } catch {
        /* ignora lixo */
      }
      this.guarda.remover(opcoes.chavePendentes);
    }
  }

  get quantidadePendente(): number {
    return this.pendentes.length;
  }

  adicionar(evento: EventoGravado): void {
    this.pendentes.push(evento);
    this.salvar();
    if (this.pendentes.length >= (this.opcoes.tamanhoLote ?? 10)) this.descarregar().catch(() => {});
    else this.agendar(this.opcoes.esperaMs ?? 1200);
  }

  /** Guarda o que falta enviar (chamado ao sair da página). */
  salvar(): void {
    if (this.pendentes.length) this.guarda.gravar(this.opcoes.chavePendentes, JSON.stringify(this.pendentes));
    else this.guarda.remover(this.opcoes.chavePendentes);
  }

  limpar(): void {
    this.pendentes = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.guarda.remover(this.opcoes.chavePendentes);
  }

  private agendar(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.descarregar().catch(() => {});
    }, ms);
  }

  /** Envia tudo que está pendente. Rejeita se o servidor não aceitar (para o "Concluir" avisar). */
  async descarregar(): Promise<void> {
    if (this.enviando) {
      await this.enviando.catch(() => {});
      if (!this.pendentes.length) return;
    }
    if (!this.pendentes.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const lote = this.pendentes.slice();
    const p = (async () => {
      const r = await this.opcoes.api.eventos(lote);
      // Só tira da fila o que foi aceito (eventos novos podem ter chegado enquanto enviava).
      this.pendentes = this.pendentes.slice(lote.length);
      this.salvar();
      this.falhas = 0;
      if (r && typeof r.passos === 'number') this.opcoes.aoPassos?.(r.passos);
    })();
    this.enviando = p;
    try {
      await p;
    } catch (e) {
      this.falhas += 1;
      this.opcoes.aoFalha?.(e);
      this.agendar(Math.min(2000 * 2 ** (this.falhas - 1), 20000));
      throw e;
    } finally {
      this.enviando = null;
    }
    if (this.pendentes.length) await this.descarregar();
  }
}

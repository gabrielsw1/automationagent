// Cliente da API do Asaas (gateway de pagamento): clientes, cobranças (boleto, cartão ou a escolha de
// quem paga), cobrança no cartão guardado (creditCardToken) e nota fiscal de serviço. Só é usado com
// ASAAS_API_KEY; sem ela a cobrança é manual (cobranca/faturas.ts). O `fetch` é injetável para os
// testes, que não falam com o Asaas de verdade.
//
// Documentação: https://docs.asaas.com (v3). Cabeçalhos: access_token (a chave), User-Agent
// (obrigatório em contas novas) e Content-Type. Erros vêm como HTTP 400 com errors[].description.
import type { ConfigAsaas } from '../config.ts';

export const URL_ASAAS = { sandbox: 'https://api-sandbox.asaas.com/v3', producao: 'https://api.asaas.com/v3' } as const;

export type Busca = typeof fetch;

/** Erro devolvido pelo Asaas (cartão recusado, CPF/CNPJ inválido...), com a mensagem dele em português. */
export class ErroAsaas extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly codigo: string | null = null,
  ) {
    super(mensagem);
    this.name = 'ErroAsaas';
  }
}

export interface ClienteAsaas {
  name: string;
  cpfCnpj: string;
  email?: string;
  postalCode?: string;
  addressNumber?: string;
  externalReference?: string;
  /** O Asaas avisa a empresa por e-mail das cobranças (padrão do Asaas). */
  notificationDisabled?: boolean;
}

export type FormaAsaas = 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED';

export interface NovaCobrancaAsaas {
  customer: string;
  billingType: FormaAsaas;
  /** Em reais (o Asaas usa decimal). */
  value: number;
  /** "2026-11-10" */
  dueDate: string;
  description: string;
  externalReference: string;
  /** Cobrança no cartão guardado: token do Asaas e o IP de quem cadastrou o cartão. */
  creditCardToken?: string;
  remoteIp?: string;
}

/** Os campos da cobrança que o copiloto usa. */
export interface CobrancaAsaas {
  id: string;
  status: string;
  value?: number;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  billingType?: string;
  creditCard?: { creditCardNumber?: string | null; creditCardBrand?: string | null; creditCardToken?: string | null } | null;
}

export interface NotaFiscalAsaas {
  payment: string;
  serviceDescription: string;
  observations: string;
  value: number;
  deductions: number;
  effectiveDate: string;
  municipalServiceId?: string;
  municipalServiceCode?: string;
  municipalServiceName: string;
  taxes: { retainIss: boolean; iss: number; pis: number; cofins: number; csll: number; inss: number; ir: number };
}

export class Asaas {
  private readonly base: string;

  constructor(
    private readonly config: ConfigAsaas,
    private readonly busca: Busca = fetch,
  ) {
    this.base = URL_ASAAS[config.ambiente];
  }

  private async pedir<T>(metodo: 'GET' | 'POST' | 'PUT', caminho: string, corpo?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await this.busca(`${this.base}${caminho}`, {
        method: metodo,
        headers: { access_token: this.config.chave, 'User-Agent': 'CopilotoStarta', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ErroAsaas(0, `O Asaas não respondeu (${e instanceof Error ? e.message : String(e)}).`);
    }
    const texto = await r.text();
    let dados: unknown = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = null;
    }
    if (!r.ok) {
      const erros = (dados as { errors?: { code?: string; description?: string }[] } | null)?.errors;
      const primeiro = erros?.[0];
      const mensagem =
        primeiro?.description ??
        (r.status === 401 ? 'A chave do Asaas (ASAAS_API_KEY) não foi aceita.' : `O Asaas recusou o pedido (HTTP ${r.status}).`);
      throw new ErroAsaas(r.status, mensagem, primeiro?.code ?? null);
    }
    return dados as T;
  }

  criarCliente(c: ClienteAsaas): Promise<{ id: string }> {
    return this.pedir('POST', '/customers', c);
  }

  atualizarCliente(id: string, c: Partial<ClienteAsaas>): Promise<{ id: string }> {
    return this.pedir('PUT', `/customers/${encodeURIComponent(id)}`, c);
  }

  criarCobranca(c: NovaCobrancaAsaas): Promise<CobrancaAsaas> {
    return this.pedir('POST', '/payments', c);
  }

  cobranca(id: string): Promise<CobrancaAsaas> {
    return this.pedir('GET', `/payments/${encodeURIComponent(id)}`);
  }

  agendarNotaFiscal(n: NotaFiscalAsaas): Promise<{ id: string; status: string; pdfUrl?: string | null }> {
    return this.pedir('POST', '/invoices', n);
  }
}

/** Cobrança paga no Asaas (recebida ou confirmada no cartão). */
export function cobrancaPaga(status: string): boolean {
  return status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH';
}

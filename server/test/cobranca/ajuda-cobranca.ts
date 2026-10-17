// Peças dos testes de cobrança: uma empresa cliente com plano, execuções que gastam créditos e um
// Asaas falso (nenhum teste fala com o Asaas de verdade).
import type { ConfigAsaas } from '../../src/config.ts';
import type { Contexto } from '../../src/contexto.ts';
import { sistemaNovo } from '../../src/plataforma/index.ts';
import { novoId } from '../../src/util/ids.ts';
import { entrarComo, type Ambiente } from '../ajuda.ts';

export const SEM_ASAAS: ConfigAsaas = { chave: '', ambiente: 'sandbox', tokenWebhook: '', notaFiscal: null };
export const COM_ASAAS: ConfigAsaas = { chave: '$aact_hmlg_chave-de-teste', ambiente: 'sandbox', tokenWebhook: 'token-do-webhook-de-teste', notaFiscal: null };

/** Empresa cliente (fora da demonstração) no plano Piloto, com um Admin logado. */
export function empresaCliente(
  a: Ambiente,
  o: { incluidos?: number | null; mensal?: number | null; taxa?: number | null; credito?: number | null; cobrancaDesde?: string } = {},
) {
  const empresa = a.plataforma.criarEmpresa({ nome: 'Clínica Mais Agenda', sistema: sistemaNovo('Agenda', 'https://agenda.clinicamais.com.br'), cnpj: '11222333000181', faixaUsuarios: 'ate_200' });
  a.plataforma.acompanhar(empresa.id, { planoId: 'piloto' });
  a.plataforma.atualizarPrecosPlano('piloto', {
    precoMensalCentavos: o.mensal ?? null,
    taxaImplantacaoCentavos: o.taxa ?? null,
    precoCreditoExtraCentavos: o.credito ?? null,
  });
  if (o.incluidos !== undefined) a.plataforma.banco.executar('UPDATE planos SET creditos_incluidos = ? WHERE id = ?', o.incluidos, 'piloto');
  if (o.cobrancaDesde) a.plataforma.banco.executar('UPDATE empresas SET cobranca_desde = ? WHERE id = ?', o.cobrancaDesde, empresa.id);
  const ctx = a.plataforma.contexto(empresa.id);
  const admin = entrarComo(ctx, 'admin', 'Patrícia Nunes', 'patricia@clinicamais.com.br');
  return { empresa, ctx, admin };
}

/** Uma execução concluída, como o motor grava: 1 crédito pelo roteiro, 5 com conserto visual. */
export function gastar(
  ctx: Contexto,
  quando: Date,
  o: { creditos?: number; conserto?: boolean; tarefaId?: string; nome?: string; usuario?: string; canal?: 'widget' | 'teste' } = {},
): string {
  const id = novoId('ex');
  const conserto = o.conserto ?? false;
  ctx.banco.inserir('execucoes', {
    id,
    usuario_id: o.usuario ?? '1',
    usuario_nome: 'Cliente',
    tarefa_id: o.tarefaId ?? 'trf_chamado',
    tarefa_nome: o.nome ?? 'Abrir chamado',
    pedido: 'pedido',
    status: 'concluida',
    canal: o.canal ?? 'widget',
    criado_em: quando.toISOString(),
    concluido_em: quando.toISOString(),
    creditos: o.creditos ?? (conserto ? 5 : 1),
    recuperacoes: conserto ? 1 : 0,
    exemplo: 0,
  });
  return id;
}

export interface PedidoAsaas {
  url: string;
  metodo: string;
  corpo: Record<string, unknown> | undefined;
  cabecalhos: Record<string, string>;
}

/** Asaas falso: clientes e cobranças em memória. `cartao`: o que acontece ao cobrar o cartão guardado. */
export function asaasFalso() {
  const pedidos: PedidoAsaas[] = [];
  const estado = { cartao: 'aprova' as 'aprova' | 'pendente' | 'recusa', n: 0 };
  const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  const busca = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    pedidos.push({ url, metodo: init?.method ?? 'GET', corpo, cabecalhos: (init?.headers ?? {}) as Record<string, string> });
    if (url.endsWith('/customers') && init?.method === 'POST') return resposta(200, { id: 'cus_000001', name: corpo?.name });
    if (/\/customers\/[^/]+$/.test(url) && init?.method === 'PUT') return resposta(200, { id: url.split('/').pop() });
    if (url.endsWith('/payments') && init?.method === 'POST') {
      estado.n++;
      const id = `pay_${estado.n}`;
      if (corpo?.creditCardToken) {
        if (estado.cartao === 'recusa') return resposta(400, { errors: [{ code: 'invalid_creditCard', description: 'Transação não autorizada. Verifique os dados do cartão.' }] });
        return resposta(200, {
          id,
          status: estado.cartao === 'aprova' ? 'CONFIRMED' : 'PENDING',
          value: corpo.value,
          externalReference: corpo.externalReference,
          invoiceUrl: `https://sandbox.asaas.com/i/${id}`,
          creditCard: { creditCardNumber: '4417', creditCardBrand: 'VISA', creditCardToken: corpo.creditCardToken },
        });
      }
      return resposta(200, {
        id,
        status: 'PENDING',
        value: corpo?.value,
        externalReference: corpo?.externalReference,
        invoiceUrl: `https://sandbox.asaas.com/i/${id}`,
        bankSlipUrl: corpo?.billingType === 'BOLETO' ? `https://sandbox.asaas.com/b/pdf/${id}` : null,
      });
    }
    if (url.endsWith('/invoices') && init?.method === 'POST') return resposta(200, { id: 'inv_000001', status: 'SCHEDULED', pdfUrl: null });
    return resposta(404, { errors: [{ code: 'not_found', description: 'Não encontrado.' }] });
  }) as typeof fetch;
  return { busca, pedidos, estado };
}

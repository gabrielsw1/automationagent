// Faturas das empresas clientes (banco da plataforma): fechamento do mês, pacotes de créditos,
// recarga automática, dados de cobrança e o aviso de pagamento do Asaas.
//
// - Fechamento: no início e de hora em hora, cada empresa com plano (fora da demonstração) ganha a
//   fatura do mês anterior: assinatura, taxa de implantação (na primeira, quando o plano tem) e os
//   créditos extras. Uma por empresa e mês (índice único), então rodar de novo não repete. Falta
//   um preço necessário: não fatura, avisa no log e a Plataforma mostra "preço não definido".
// - Com ASAAS_API_KEY, a cobrança sai pelo Asaas (boleto, cartão ou cartão guardado) e o webhook
//   marca como paga. Sem ela, a cobrança é manual: a equipe Starta recebe um e-mail (EMAIL_VENDAS),
//   cobra a empresa e marca como paga na Plataforma.
// - Créditos de um pacote contam no ciclo em que o pagamento foi confirmado.
import {
  formatarCnpj,
  ITEM_EXTRAS,
  ITEM_IMPLANTACAO,
  resumoFatura,
  nomeCompetencia,
  precoEmReais,
  somenteDigitos,
  type CartaoGuardado,
  type DadosCobranca,
  type DadosCobrancaPedido,
  type Fatura,
  type FaturaAberta,
  type GatewayFatura,
  type ItemFatura,
  type MetodoPagamento,
  type PacoteComprado,
  type Plano,
  type RecargaAutomatica,
  type StatusFatura,
} from '@copiloto/shared';
import { agoraIso, json } from '../db/banco.ts';
import { emailFaturaManual } from '../email/modelos.ts';
import type { Empresa, Plataforma } from '../plataforma/index.ts';
import { conflito, ErroHttp, naoEncontrado, pedidoInvalido } from '../util/erros.ts';
import { novoId } from '../util/ids.ts';
import { Asaas, cobrancaPaga, ErroAsaas, type Busca, type CobrancaAsaas, type FormaAsaas } from './asaas.ts';
import { cicloDe, competenciaDe, deslocarCompetencia, diaDe, somarDias } from './ciclo.ts';

/** O boleto chega 10 dias antes do vencimento (a fatura mensal vence 10 dias depois de fechada). */
export const DIAS_VENCIMENTO_MENSAL = 10;
export const DIAS_VENCIMENTO_PACOTE = 3;
const UMA_HORA = 3_600_000;

interface LinhaFatura {
  id: string;
  empresa_id: string;
  competencia: string | null;
  tipo: Fatura['tipo'];
  itens: string;
  total_centavos: number | null;
  status: StatusFatura;
  vencimento: string | null;
  criado_em: string;
  atualizado_em: string;
  pago_em: string | null;
  gateway: GatewayFatura;
  gateway_id: string | null;
  url_pagamento: string | null;
  url_boleto: string | null;
  nota_fiscal_id: string | null;
  url_nota_fiscal: string | null;
  creditos: number | null;
  automatica: number;
  exemplo: number;
}

function deFatura(l: LinhaFatura): Fatura {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    competencia: l.competencia,
    tipo: l.tipo,
    itens: json<ItemFatura[]>(l.itens, []),
    totalCentavos: l.total_centavos,
    status: l.status,
    vencimento: l.vencimento,
    criadoEm: l.criado_em,
    pagoEm: l.pago_em,
    gateway: l.gateway,
    urlPagamento: l.url_pagamento,
    urlBoleto: l.url_boleto,
    urlNotaFiscal: l.url_nota_fiscal,
    creditos: l.creditos,
    automatica: l.automatica === 1,
    exemplo: l.exemplo === 1,
  };
}

/** Colunas de cobrança da tabela empresas (migração 5 da plataforma). */
interface LinhaCobranca {
  nome: string;
  cnpj: string | null;
  razao_social: string | null;
  email_cobranca: string | null;
  cep: string | null;
  endereco_numero: string | null;
  metodo_pagamento: MetodoPagamento;
  gateway_cliente_id: string | null;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  cartao_validade: string | null;
  cartao_token: string | null;
  cartao_ip: string | null;
  recarga_automatica: number;
  recarga_limite: number | null;
  implantacao_faturada: number;
  cobranca_desde: string | null;
}

export { ITEM_EXTRAS, ITEM_IMPLANTACAO };

/** Itens da fatura do mês, ou o preço que falta para fechar. */
export type PlanoMensal = { itens: ItemFatura[]; totalCentavos: number; implantacao: boolean } | { falta: string };

/** Monta os itens da fatura mensal com os preços atuais do plano. */
export function itensMensais(plano: Plano, extras: number, cobrarImplantacao: boolean): PlanoMensal {
  if (plano.precoMensalCentavos === null) return { falta: `mensalidade do plano ${plano.nome}` };
  const itens: ItemFatura[] = [
    { descricao: `Assinatura ${plano.nome}`, quantidade: 1, unitarioCentavos: plano.precoMensalCentavos, totalCentavos: plano.precoMensalCentavos },
  ];
  let implantacao = false;
  if (cobrarImplantacao) {
    // A taxa entra na primeira fatura. Sem valor, só falta preço quando o plano cita a taxa no site.
    if (plano.taxaImplantacaoCentavos === null) {
      if (plano.notaPreco.includes('{implantacao}')) return { falta: `taxa de implantação do plano ${plano.nome}` };
    } else if (plano.taxaImplantacaoCentavos > 0) {
      itens.unshift({ descricao: ITEM_IMPLANTACAO, quantidade: 1, unitarioCentavos: plano.taxaImplantacaoCentavos, totalCentavos: plano.taxaImplantacaoCentavos });
      implantacao = true;
    }
  }
  if (extras > 0) {
    if (plano.precoCreditoExtraCentavos === null) return { falta: `preço do crédito extra do plano ${plano.nome}` };
    itens.push({ descricao: ITEM_EXTRAS, quantidade: extras, unitarioCentavos: plano.precoCreditoExtraCentavos, totalCentavos: extras * plano.precoCreditoExtraCentavos });
  }
  return { itens, totalCentavos: itens.reduce((s, i) => s + (i.totalCentavos ?? 0), 0), implantacao };
}

/** "Assinatura Piloto + 180 créditos extras" */
export const resumoItens = resumoFatura;

export class Faturas {
  private readonly asaas: Asaas | null;
  /** Último erro do Asaas por fatura que ficou "aberta" (a Plataforma mostra). */
  private readonly errosGateway = new Map<string, string>();
  /** Pendências já avisadas no log (o fechamento roda de hora em hora). */
  private readonly avisadas = new Set<string>();
  private relogio: NodeJS.Timeout | null = null;

  constructor(
    private readonly plataforma: Plataforma,
    busca?: Busca,
  ) {
    const cfg = plataforma.config.asaas;
    this.asaas = cfg.chave ? new Asaas(cfg, busca) : null;
  }

  private get banco() {
    return this.plataforma.banco;
  }

  get modo(): GatewayFatura {
    return this.asaas ? 'asaas' : 'manual';
  }

  get notaFiscal(): boolean {
    return !!this.asaas && !!this.plataforma.config.asaas.notaFiscal;
  }

  // ---------------------------------------------------------------- leitura

  listar(empresaId: string): Fatura[] {
    return this.banco
      .todos<LinhaFatura>(
        `SELECT * FROM faturas WHERE empresa_id = ?
          ORDER BY COALESCE(competencia || '-99', substr(criado_em, 1, 10)) DESC, criado_em DESC`,
        empresaId,
      )
      .map(deFatura);
  }

  obter(id: string): Fatura | undefined {
    const l = this.banco.um<LinhaFatura>('SELECT * FROM faturas WHERE id = ?', id);
    return l ? deFatura(l) : undefined;
  }

  private cobrancaLinha(empresaId: string): LinhaCobranca {
    const l = this.banco.um<LinhaCobranca>('SELECT * FROM empresas WHERE id = ?', empresaId);
    if (!l) throw naoEncontrado('Empresa');
    return l;
  }

  dadosCobranca(empresaId: string): DadosCobranca {
    const l = this.cobrancaLinha(empresaId);
    const cartao: CartaoGuardado | null = l.cartao_final ? { final: l.cartao_final, bandeira: l.cartao_bandeira, validade: l.cartao_validade } : null;
    return {
      razaoSocial: l.razao_social,
      cnpj: l.cnpj ? formatarCnpj(l.cnpj) : null,
      emailCobranca: l.email_cobranca,
      cep: l.cep,
      numero: l.endereco_numero,
      metodo: l.metodo_pagamento,
      cartao,
    };
  }

  recarga(empresaId: string): RecargaAutomatica {
    const l = this.cobrancaLinha(empresaId);
    return { ligada: l.recarga_automatica === 1, limite: l.recarga_limite };
  }

  /** Há um cartão guardado no Asaas para cobrar sem a pessoa digitar (recarga automática). */
  temCartaoGuardado(empresaId: string): boolean {
    return !!this.asaas && !!this.cobrancaLinha(empresaId).cartao_token;
  }

  /** Créditos de pacotes pagos entre duas datas (contam no ciclo em que o pagamento foi confirmado). */
  creditosPagos(empresaId: string, inicio: Date, fim: Date): number {
    return (
      this.banco.um<{ n: number | null }>(
        `SELECT SUM(creditos) AS n FROM faturas
          WHERE empresa_id = ? AND tipo = 'pacote' AND status = 'paga' AND pago_em >= ? AND pago_em < ?`,
        empresaId,
        inicio.toISOString(),
        fim.toISOString(),
      )?.n ?? 0
    );
  }

  /** Pacote comprado e ainda não pago (o mais recente). */
  pacotePendente(empresaId: string): Fatura | null {
    const l = this.banco.um<LinhaFatura>(
      `SELECT * FROM faturas WHERE empresa_id = ? AND tipo = 'pacote' AND status IN ('aberta', 'emitida', 'vencida')
        ORDER BY criado_em DESC LIMIT 1`,
      empresaId,
    );
    return l ? deFatura(l) : null;
  }

  /** A fatura do mês corrente, ao vivo: o que ela teria se o mês fechasse agora. */
  faturaAberta(empresa: Empresa, agora = new Date()): FaturaAberta | null {
    if (!empresa.planoId) return null;
    const plano = this.plataforma.plano(empresa.planoId);
    if (!plano) return null;
    const competencia = competenciaDe(agora);
    const { fim } = cicloDe(competencia);
    const extras = empresa.demo ? 0 : this.plataforma.contexto(empresa.id).creditos.ciclo(agora, competencia, plano).extras;
    const l = this.cobrancaLinha(empresa.id);
    const primeira = !empresa.demo && l.implantacao_faturada === 0 && !this.temMensal(empresa.id);
    const plan = itensMensais(plano, extras, primeira);
    let itens: ItemFatura[];
    let totalCentavos: number | null;
    if ('falta' in plan) {
      // Sem um preço: mostra os itens com valor "Sob consulta" em vez de inventar um número.
      itens = [
        ...(primeira && plano.notaPreco.includes('{implantacao}')
          ? [{ descricao: ITEM_IMPLANTACAO, quantidade: 1, unitarioCentavos: plano.taxaImplantacaoCentavos, totalCentavos: plano.taxaImplantacaoCentavos }]
          : []),
        { descricao: `Assinatura ${plano.nome}`, quantidade: 1, unitarioCentavos: plano.precoMensalCentavos, totalCentavos: plano.precoMensalCentavos },
        ...(extras > 0
          ? [{ descricao: ITEM_EXTRAS, quantidade: extras, unitarioCentavos: plano.precoCreditoExtraCentavos, totalCentavos: plano.precoCreditoExtraCentavos === null ? null : extras * plano.precoCreditoExtraCentavos }]
          : []),
      ];
      totalCentavos = null;
    } else {
      itens = plan.itens;
      totalCentavos = plan.totalCentavos;
    }
    return { competencia, itens, totalCentavos, fechaEm: new Date(fim.getTime() - 1).toISOString(), disponivelEm: fim.toISOString() };
  }

  private temMensal(empresaId: string): boolean {
    return !!this.banco.um("SELECT 1 FROM faturas WHERE empresa_id = ? AND tipo = 'mensal' AND exemplo = 0 AND status <> 'cancelada'", empresaId);
  }

  // ---------------------------------------------------------------- fechamento do mês

  /** Empresas que pagam a competência: com plano, fora da demonstração, com plano desde antes do fim do mês. */
  private elegiveis(competencia: string): Empresa[] {
    const { fim } = cicloDe(competencia);
    return this.plataforma
      .listarEmpresas()
      .filter((e) => !e.demo && e.planoId)
      .filter((e) => {
        const desde = this.cobrancaLinha(e.id).cobranca_desde;
        return !!desde && desde < fim.toISOString();
      });
  }

  /** O que impede de fechar a fatura da competência (preço não definido), ou null. */
  private planejar(empresa: Empresa, competencia: string): PlanoMensal | { falta: string } {
    const plano = this.plataforma.plano(empresa.planoId!);
    if (!plano) return { falta: 'plano não encontrado' };
    const { fim } = cicloDe(competencia);
    const extras = this.plataforma.contexto(empresa.id).creditos.ciclo(fim, competencia, plano).extras;
    const l = this.cobrancaLinha(empresa.id);
    return itensMensais(plano, extras, l.implantacao_faturada === 0);
  }

  /**
   * Fecha a fatura do mês anterior de cada empresa que ainda não tem, e reenvia ao Asaas as que
   * ficaram abertas. Idempotente: pode rodar quantas vezes quiser.
   */
  async fecharMes(agora = new Date()): Promise<{ criadas: Fatura[]; puladas: { empresaId: string; motivo: string }[] }> {
    const competencia = deslocarCompetencia(competenciaDe(agora), -1);
    const criadas: Fatura[] = [];
    const puladas: { empresaId: string; motivo: string }[] = [];
    for (const empresa of this.elegiveis(competencia)) {
      if (this.banco.um("SELECT 1 FROM faturas WHERE empresa_id = ? AND competencia = ? AND tipo = 'mensal'", empresa.id, competencia)) continue;
      const plan = this.planejar(empresa, competencia);
      if ('falta' in plan) {
        const motivo = `preço não definido: ${plan.falta}`;
        puladas.push({ empresaId: empresa.id, motivo });
        const chave = `${empresa.id}:${competencia}:${plan.falta}`;
        if (!this.avisadas.has(chave)) {
          this.avisadas.add(chave);
          console.warn(`[cobrança] Fatura de ${nomeCompetencia(competencia)} de ${empresa.nome} não saiu: ${motivo}. Defina em Plataforma › Configurações › Planos e preços.`);
        }
        continue;
      }
      const id = novoId('fat');
      const criado = agoraIso();
      try {
        this.banco.transacao(() => {
          this.banco.inserir('faturas', {
            id,
            empresa_id: empresa.id,
            competencia,
            tipo: 'mensal',
            itens: plan.itens,
            total_centavos: plan.totalCentavos,
            status: 'aberta',
            vencimento: somarDias(diaDe(agora), DIAS_VENCIMENTO_MENSAL),
            criado_em: criado,
            atualizado_em: criado,
            gateway: this.modo,
          });
          if (plan.implantacao) this.banco.executar('UPDATE empresas SET implantacao_faturada = 1 WHERE id = ?', empresa.id);
        });
      } catch (e) {
        // Outra rodada criou a mesma fatura ao mesmo tempo (índice único): segue.
        if (String(e).includes('UNIQUE')) continue;
        throw e;
      }
      await this.emitir(id);
      criadas.push(this.obter(id)!);
    }
    // Faturas que o Asaas não aceitou da última vez.
    for (const l of this.banco.todos<{ id: string }>("SELECT id FROM faturas WHERE status = 'aberta' AND exemplo = 0 AND gateway = 'asaas' AND gateway_id IS NULL")) {
      if (!criadas.some((f) => f.id === l.id)) await this.emitir(l.id);
    }
    // Na cobrança manual ninguém avisa o atraso (no Asaas, vem pelo webhook): passou do vencimento sem pagamento, fica Vencida.
    this.banco.executar(
      "UPDATE faturas SET status = 'vencida', atualizado_em = ? WHERE gateway = 'manual' AND status = 'emitida' AND exemplo = 0 AND vencimento < ?",
      agoraIso(),
      diaDe(agora),
    );
    return { criadas, puladas };
  }

  /** Por que faturas desta empresa não saíram (a Plataforma mostra no painel da empresa). */
  pendencias(empresaId: string, agora = new Date()): string[] {
    const empresa = this.plataforma.empresa(empresaId);
    const saida: string[] = [];
    if (!empresa) return saida;
    const competencia = deslocarCompetencia(competenciaDe(agora), -1);
    if (
      this.elegiveis(competencia).some((e) => e.id === empresaId) &&
      !this.banco.um("SELECT 1 FROM faturas WHERE empresa_id = ? AND competencia = ? AND tipo = 'mensal'", empresaId, competencia)
    ) {
      const plan = this.planejar(empresa, competencia);
      if ('falta' in plan) saida.push(`A fatura de ${nomeCompetencia(competencia)} não saiu: preço não definido (${plan.falta}).`);
    }
    for (const l of this.banco.todos<LinhaFatura>("SELECT * FROM faturas WHERE empresa_id = ? AND status = 'aberta' AND exemplo = 0", empresaId)) {
      const erro = this.errosGateway.get(l.id);
      saida.push(`${rotuloFatura(deFatura(l))} ainda não foi enviada ao Asaas${erro ? `: ${erro}` : '.'} O copiloto tenta de novo a cada hora.`);
    }
    return saida;
  }

  /** Começa o fechamento: agora e de hora em hora (não segura o processo aberto). */
  iniciarFechamento() {
    if (this.relogio) return;
    const rodar = () => {
      this.fecharMes().catch((e) => console.error('[cobrança] Fechamento do mês falhou:', e));
    };
    rodar();
    this.relogio = setInterval(rodar, UMA_HORA);
    this.relogio.unref();
  }

  pararFechamento() {
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
  }

  // ---------------------------------------------------------------- envio da cobrança

  /**
   * Manda a cobrança da fatura: pelo Asaas (cartão guardado, boleto ou página de pagamento) ou, no
   * modo manual, por e-mail para a equipe Starta. Se o Asaas falhar, a fatura fica "aberta" e o
   * fechamento tenta de novo na hora seguinte.
   */
  private async emitir(faturaId: string, ip?: string | null): Promise<{ pagaNoCartao: boolean; recusa: string | null }> {
    const f = this.obter(faturaId)!;
    const empresa = this.plataforma.empresa(f.empresaId)!;
    if (!this.asaas || f.gateway === 'manual') {
      this.banco.atualizar('faturas', f.id, { status: 'emitida', atualizado_em: agoraIso() });
      const para = this.plataforma.config.emailVendas;
      if (para) {
        const c = this.dadosCobranca(empresa.id);
        await this.plataforma.correio
          .enviar(emailFaturaManual({ para, empresa: empresa.nome, cobranca: c, fatura: this.obter(f.id)!, linkPlataforma: this.linkPlataforma(empresa.id) }))
          .catch((e) => console.error('[cobrança] E-mail da fatura não saiu:', e));
      }
      return { pagaNoCartao: false, recusa: null };
    }
    try {
      const cliente = await this.garantirCliente(empresa.id);
      const l = this.cobrancaLinha(empresa.id);
      const descricao = `Copiloto Starta · ${f.tipo === 'mensal' && f.competencia ? `${resumoItens(f)} (${nomeCompetencia(f.competencia)})` : resumoItens(f)}`.slice(0, 500);
      const base = {
        customer: cliente,
        value: (f.totalCentavos ?? 0) / 100,
        dueDate: f.vencimento ?? somarDias(diaDe(new Date()), DIAS_VENCIMENTO_PACOTE),
        description: descricao,
        externalReference: f.id,
      };
      let cobranca: CobrancaAsaas | null = null;
      let recusa: string | null = null;
      const token = l.metodo_pagamento === 'cartao' && l.cartao_token ? this.plataforma.cofre.decifrar(l.cartao_token) : null;
      const remoteIp = ip ?? l.cartao_ip;
      if (token && remoteIp) {
        try {
          cobranca = await this.asaas.criarCobranca({ ...base, billingType: 'CREDIT_CARD', creditCardToken: token, remoteIp });
        } catch (e) {
          // Cartão recusado: a fatura sai com a página de pagamento, para pagar de outro jeito.
          if (!(e instanceof ErroAsaas) || e.status !== 400) throw e;
          recusa = e.message;
        }
      }
      if (!cobranca) {
        const forma: FormaAsaas = l.metodo_pagamento === 'boleto' ? 'BOLETO' : 'CREDIT_CARD';
        cobranca = await this.asaas.criarCobranca({ ...base, billingType: recusa ? 'UNDEFINED' : forma });
      }
      this.errosGateway.delete(f.id);
      this.banco.atualizar('faturas', f.id, {
        status: 'emitida',
        gateway: 'asaas',
        gateway_id: cobranca.id,
        url_pagamento: cobranca.invoiceUrl ?? null,
        url_boleto: cobranca.bankSlipUrl ?? null,
        atualizado_em: agoraIso(),
      });
      if (cobrancaPaga(cobranca.status)) {
        await this.marcarPagaInterno(f.id, cobranca);
        return { pagaNoCartao: true, recusa: null };
      }
      return { pagaNoCartao: false, recusa };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errosGateway.set(f.id, msg);
      console.error(`[cobrança] Fatura ${f.id} de ${empresa.nome} não foi para o Asaas: ${msg}`);
      return { pagaNoCartao: false, recusa: null };
    }
  }

  private linkPlataforma(empresaId: string): string {
    return `${this.plataforma.config.urlConsole.replace(/\/+$/, '')}/plataforma?empresa=${encodeURIComponent(empresaId)}`;
  }

  /** Cliente da empresa no Asaas (cria na primeira cobrança). */
  private async garantirCliente(empresaId: string): Promise<string> {
    const l = this.cobrancaLinha(empresaId);
    if (l.gateway_cliente_id) return l.gateway_cliente_id;
    if (!this.asaas) throw new Error('Asaas desligado.');
    if (!l.cnpj) throw pedidoInvalido('Preencha o CNPJ em "Alterar dados de cobrança" antes de pagar pelo Asaas.');
    const c = await this.asaas.criarCliente({
      name: l.razao_social ?? l.nome,
      cpfCnpj: somenteDigitos(l.cnpj),
      email: l.email_cobranca ?? undefined,
      postalCode: l.cep ?? undefined,
      addressNumber: l.endereco_numero ?? undefined,
      externalReference: empresaId,
    });
    this.banco.executar('UPDATE empresas SET gateway_cliente_id = ? WHERE id = ?', c.id, empresaId);
    return c.id;
  }

  // ---------------------------------------------------------------- dados de cobrança e recarga

  /** Guarda os dados de cobrança (e o CNPJ da empresa). Com o Asaas, atualiza o cliente lá também. */
  async salvarCobranca(empresaId: string, d: DadosCobrancaPedido): Promise<DadosCobranca> {
    const cnpj = somenteDigitos(d.cnpj);
    this.banco.atualizar('empresas', empresaId, {
      razao_social: d.razaoSocial.trim(),
      cnpj,
      email_cobranca: d.emailCobranca.trim().toLowerCase(),
      cep: d.cep ? somenteDigitos(d.cep) || null : null,
      endereco_numero: d.numero?.trim() || null,
      metodo_pagamento: d.metodo,
    });
    if (this.asaas) {
      const l = this.cobrancaLinha(empresaId);
      try {
        if (l.gateway_cliente_id) {
          await this.asaas.atualizarCliente(l.gateway_cliente_id, {
            name: d.razaoSocial.trim(),
            cpfCnpj: cnpj,
            email: d.emailCobranca.trim().toLowerCase(),
            postalCode: l.cep ?? undefined,
            addressNumber: l.endereco_numero ?? undefined,
          });
        } else {
          await this.garantirCliente(empresaId);
        }
      } catch (e) {
        if (e instanceof ErroAsaas) throw new ErroHttp(400, 'asaas', `Os dados foram salvos, mas o Asaas recusou: ${e.message}`);
        throw e;
      }
    }
    return this.dadosCobranca(empresaId);
  }

  /** Liga ou desliga a recarga automática. Ligar exige cartão guardado e preço do crédito. */
  definirRecarga(empresaId: string, r: RecargaAutomatica, ip?: string | null): RecargaAutomatica {
    if (r.ligada) {
      if (!this.temCartaoGuardado(empresaId)) {
        throw pedidoInvalido(
          this.asaas
            ? 'A recarga automática precisa de um cartão salvo. Escolha cartão de crédito e pague uma fatura com ele: o cartão fica guardado no Asaas.'
            : 'A recarga automática precisa de cobrança por cartão, que a Starta ainda não ligou. Por enquanto, compre pacotes quando precisar.',
        );
      }
      if (!r.limite || r.limite < 1) throw pedidoInvalido('Diga com quantos créditos restantes a recarga compra um pacote.');
    }
    this.banco.atualizar('empresas', empresaId, {
      recarga_automatica: r.ligada ? 1 : 0,
      recarga_limite: r.limite ?? null,
      // O Asaas pede o IP de quem paga ao cobrar o cartão guardado: o do Admin que ligou a recarga.
      ...(r.ligada && ip ? { cartao_ip: ip } : {}),
    });
    return this.recarga(empresaId);
  }

  // ---------------------------------------------------------------- pacotes

  /**
   * Compra um pacote de créditos ao preço do crédito extra. Os créditos entram quando o pagamento é
   * confirmado (na hora, no cartão guardado). `automatica`: pela recarga (no máximo uma pendente).
   */
  async comprarPacote(empresaId: string, o: { automatica?: boolean; ip?: string | null } = {}): Promise<PacoteComprado> {
    const empresa = this.plataforma.empresa(empresaId);
    if (!empresa) throw naoEncontrado('Empresa');
    if (empresa.demo) throw pedidoInvalido('Na demonstração, compras e cobrança ficam desligadas.');
    const plano = empresa.planoId ? this.plataforma.plano(empresa.planoId) : undefined;
    if (!plano) throw pedidoInvalido('A empresa ainda não tem plano. A Starta define o plano junto com vocês.');
    const preco = plano.precoCreditoExtraCentavos;
    if (preco === null) throw pedidoInvalido('A Starta ainda não definiu o preço do crédito do seu plano. Fale com a Starta para comprar créditos.');
    const pendente = this.pacotePendente(empresaId);
    if (pendente) {
      throw conflito(
        `Já há um pacote de ${(pendente.creditos ?? 0).toLocaleString('pt-BR')} créditos aguardando pagamento. Os créditos entram quando ele for pago.`,
      );
    }
    if (this.asaas && !this.cobrancaLinha(empresaId).cnpj) throw pedidoInvalido('Preencha o CNPJ em "Alterar dados de cobrança" antes de comprar.');
    if (!o.automatica && o.ip) this.banco.executar('UPDATE empresas SET cartao_ip = ? WHERE id = ?', o.ip, empresaId);
    const id = novoId('fat');
    const agora = agoraIso();
    const creditos = plano.pacoteCreditos;
    const total = creditos * preco;
    this.banco.inserir('faturas', {
      id,
      empresa_id: empresaId,
      competencia: null,
      tipo: 'pacote',
      itens: [{ descricao: `Pacote de créditos (${plano.nome})`, quantidade: creditos, unitarioCentavos: preco, totalCentavos: total }],
      total_centavos: total,
      status: 'aberta',
      vencimento: somarDias(diaDe(new Date()), DIAS_VENCIMENTO_PACOTE),
      criado_em: agora,
      atualizado_em: agora,
      gateway: this.modo,
      creditos,
      automatica: o.automatica ? 1 : 0,
    });
    const r = await this.emitir(id, o.ip);
    const fatura = this.obter(id)!;
    const qtd = creditos.toLocaleString('pt-BR');
    const valor = precoEmReais(total);
    let mensagem: string;
    if (fatura.gateway === 'manual') {
      const email = this.cobrancaLinha(empresaId).email_cobranca;
      mensagem = `Pedido registrado. A equipe Starta envia a cobrança de ${valor}${email ? ` para ${email}` : ''}, e os ${qtd} créditos entram assim que o pagamento for confirmado.`;
    } else if (r.pagaNoCartao) {
      const final = this.cobrancaLinha(empresaId).cartao_final;
      mensagem = `Pagamento de ${valor} aprovado${final ? ` no cartão final ${final}` : ''}. Os ${qtd} créditos já estão disponíveis.`;
    } else if (fatura.status === 'aberta') {
      mensagem = `O pedido foi registrado, mas o Asaas não respondeu agora. O copiloto tenta de novo a cada hora; os ${qtd} créditos entram quando o pagamento for confirmado.`;
    } else if (r.recusa) {
      mensagem = `O cartão foi recusado (${r.recusa}). A cobrança de ${valor} ficou disponível para pagar por boleto, Pix ou outro cartão; os créditos entram quando o pagamento for confirmado.`;
    } else if (fatura.urlBoleto) {
      mensagem = `Boleto de ${valor} gerado. Os ${qtd} créditos entram assim que o pagamento for confirmado (boletos levam até 3 dias úteis).`;
    } else {
      mensagem = `Cobrança de ${valor} criada. Pague pelo link da fatura; os ${qtd} créditos entram assim que o pagamento for confirmado.`;
    }
    return { fatura, mensagem };
  }

  /**
   * Recarga automática: com a recarga ligada, cartão guardado e menos créditos que o limite, compra
   * um pacote. No máximo um pacote automático pendente por vez.
   */
  async verificarRecarga(empresaId: string): Promise<Fatura | null> {
    const empresa = this.plataforma.empresa(empresaId);
    if (!empresa || empresa.demo || !empresa.planoId) return null;
    const l = this.cobrancaLinha(empresaId);
    if (l.recarga_automatica !== 1 || !l.recarga_limite || !this.temCartaoGuardado(empresaId)) return null;
    const plano = this.plataforma.plano(empresa.planoId);
    if (!plano || plano.precoCreditoExtraCentavos === null || plano.creditosIncluidos === null) return null;
    const ciclo = this.plataforma.contexto(empresaId).creditos.ciclo(new Date(), undefined, plano);
    if (ciclo.restantes === null || ciclo.restantes >= l.recarga_limite) return null;
    if (this.pacotePendente(empresaId)) return null;
    const r = await this.comprarPacote(empresaId, { automatica: true, ip: l.cartao_ip });
    this.plataforma.contexto(empresaId).auditoria.registrar('Recarga automática', 'Comprou um pacote de créditos', `${r.fatura.creditos} créditos`, r.mensagem);
    return r.fatura;
  }

  // ---------------------------------------------------------------- pagamento

  private async marcarPagaInterno(faturaId: string, cobranca?: CobrancaAsaas) {
    const f = this.obter(faturaId);
    if (!f || f.status === 'paga') return;
    const agora = agoraIso();
    this.banco.atualizar('faturas', f.id, { status: 'paga', pago_em: agora, atualizado_em: agora });
    const cartao = cobranca?.creditCard;
    if (cartao?.creditCardNumber) {
      this.banco.atualizar('empresas', f.empresaId, {
        cartao_final: String(cartao.creditCardNumber).slice(-4),
        cartao_bandeira: cartao.creditCardBrand ? nomeBandeira(cartao.creditCardBrand) : null,
        ...(cartao.creditCardToken ? { cartao_token: this.plataforma.cofre.cifrar(cartao.creditCardToken) } : {}),
      });
    }
    if (this.notaFiscal && f.gateway === 'asaas' && f.totalCentavos) await this.agendarNotaFiscal(f.id);
  }

  /** Nota fiscal de serviço da fatura paga, pelo Asaas (ASAAS_NOTA_FISCAL=1). O link chega pelo webhook. */
  private async agendarNotaFiscal(faturaId: string) {
    const nf = this.plataforma.config.asaas.notaFiscal;
    const f = this.obter(faturaId);
    if (!nf || !this.asaas || !f?.totalCentavos) return;
    const l = this.banco.um<LinhaFatura>('SELECT * FROM faturas WHERE id = ?', faturaId)!;
    if (!l.gateway_id || l.nota_fiscal_id) return;
    try {
      const r = await this.asaas.agendarNotaFiscal({
        payment: l.gateway_id,
        serviceDescription: `Copiloto Starta: ${resumoItens(f)}${f.competencia ? ` (${nomeCompetencia(f.competencia)})` : ''}`,
        observations: `Fatura ${f.id}`,
        value: f.totalCentavos / 100,
        deductions: 0,
        effectiveDate: diaDe(new Date()),
        ...(nf.servicoId ? { municipalServiceId: nf.servicoId } : { municipalServiceCode: nf.servicoCodigo }),
        municipalServiceName: nf.servicoNome,
        taxes: nf.impostos,
      });
      this.banco.atualizar('faturas', f.id, { nota_fiscal_id: r.id, url_nota_fiscal: r.pdfUrl ?? null, atualizado_em: agoraIso() });
    } catch (e) {
      console.error(`[cobrança] Nota fiscal da fatura ${f.id} não foi agendada:`, e instanceof Error ? e.message : e);
    }
  }

  /** A equipe Starta confirmou o pagamento (cobrança manual). Créditos de pacote entram agora. */
  async marcarPaga(empresaId: string, faturaId: string): Promise<Fatura> {
    const f = this.daEmpresa(empresaId, faturaId);
    if (f.gateway !== 'manual') throw pedidoInvalido('Esta fatura é cobrada pelo Asaas: ela fica paga quando o Asaas confirma o pagamento.');
    if (f.status === 'paga') return f;
    if (f.status === 'cancelada') throw pedidoInvalido('A fatura foi cancelada.');
    await this.marcarPagaInterno(f.id);
    return this.obter(f.id)!;
  }

  /** Cancela uma fatura manual que não será cobrada. A taxa de implantação volta para a próxima fatura. */
  cancelar(empresaId: string, faturaId: string): Fatura {
    const f = this.daEmpresa(empresaId, faturaId);
    if (f.gateway !== 'manual') throw pedidoInvalido('Esta fatura é cobrada pelo Asaas: cancele por lá.');
    if (f.status === 'paga') throw pedidoInvalido('A fatura já foi paga.');
    if (f.status === 'cancelada') return f;
    this.banco.transacao(() => {
      this.banco.atualizar('faturas', f.id, { status: 'cancelada', atualizado_em: agoraIso() });
      if (f.itens.some((i) => i.descricao === ITEM_IMPLANTACAO)) this.banco.executar('UPDATE empresas SET implantacao_faturada = 0 WHERE id = ?', empresaId);
    });
    return this.obter(f.id)!;
  }

  private daEmpresa(empresaId: string, faturaId: string): Fatura {
    const f = this.obter(faturaId);
    if (!f || f.empresaId !== empresaId) throw naoEncontrado('Fatura');
    if (f.exemplo) throw pedidoInvalido('Fatura de exemplo da demonstração.');
    return f;
  }

  /**
   * Aviso do Asaas (POST /api/pagamentos/asaas). Cada evento é tratado uma vez só (o Asaas reenvia
   * até receber 200). Devolve o que foi feito, para o log.
   */
  async webhook(evento: AvisoAsaas): Promise<'repetido' | 'ignorado' | 'tratado'> {
    const idEvento = evento.id ?? `${evento.event}:${evento.payment?.id ?? evento.invoice?.id ?? ''}:${evento.dateCreated ?? ''}`;
    const novo = this.banco.executar(
      'INSERT INTO eventos_pagamento (id, evento, recebido_em) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING',
      idEvento,
      evento.event,
      agoraIso(),
    );
    if (Number(novo.changes) === 0) return 'repetido';
    try {
      return await this.tratar(evento);
    } catch (e) {
      // Deu errado: esquece o evento para o Asaas reenviar.
      this.banco.executar('DELETE FROM eventos_pagamento WHERE id = ?', idEvento);
      throw e;
    }
  }

  private async tratar(evento: AvisoAsaas): Promise<'ignorado' | 'tratado'> {
    if (evento.event === 'INVOICE_AUTHORIZED' && evento.invoice) {
      const nf = evento.invoice;
      const l = this.banco.um<{ id: string }>(
        'SELECT id FROM faturas WHERE nota_fiscal_id = ? OR (gateway_id IS NOT NULL AND gateway_id = ?)',
        nf.id,
        nf.payment ?? '',
      );
      if (!l) return 'ignorado';
      this.banco.atualizar('faturas', l.id, { nota_fiscal_id: nf.id, url_nota_fiscal: nf.pdfUrl ?? null, atualizado_em: agoraIso() });
      return 'tratado';
    }
    const p = evento.payment;
    if (!p?.id) return 'ignorado';
    const l =
      this.banco.um<{ id: string }>('SELECT id FROM faturas WHERE gateway_id = ?', p.id) ??
      (p.externalReference ? this.banco.um<{ id: string }>("SELECT id FROM faturas WHERE id = ? AND gateway = 'asaas'", p.externalReference) : undefined);
    if (!l) return 'ignorado';
    const f = this.obter(l.id)!;
    switch (evento.event) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED':
        // A resposta da criação pode não ter chegado (rede): o aviso traz o id da cobrança.
        if (!this.banco.um('SELECT 1 FROM faturas WHERE id = ? AND gateway_id IS NOT NULL', f.id)) {
          this.banco.atualizar('faturas', f.id, { gateway_id: p.id, url_pagamento: p.invoiceUrl ?? null, url_boleto: p.bankSlipUrl ?? null });
        }
        await this.marcarPagaInterno(f.id, p);
        return 'tratado';
      case 'PAYMENT_OVERDUE':
        if (f.status === 'emitida' || f.status === 'aberta') this.banco.atualizar('faturas', f.id, { status: 'vencida', atualizado_em: agoraIso() });
        return 'tratado';
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_DELETED':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
        // Estornada ou apagada: os créditos do pacote deixam de contar.
        this.banco.atualizar('faturas', f.id, { status: 'cancelada', atualizado_em: agoraIso() });
        return 'tratado';
      default:
        return 'ignorado';
    }
  }
}

/** Corpo do webhook do Asaas (só o que o copiloto lê). */
export interface AvisoAsaas {
  id?: string;
  event: string;
  dateCreated?: string;
  payment?: CobrancaAsaas;
  invoice?: { id: string; status?: string; payment?: string | null; pdfUrl?: string | null };
}

const BANDEIRAS: Record<string, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  ELO: 'Elo',
  AMEX: 'American Express',
  HIPERCARD: 'Hipercard',
  DINERS: 'Diners',
  DISCOVER: 'Discover',
  JCB: 'JCB',
  CABAL: 'Cabal',
};

function nomeBandeira(b: string): string {
  return BANDEIRAS[b.toUpperCase()] ?? b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
}

/** "Fatura de setembro de 2026" ou "Pacote de 1.000 créditos de 17/10". */
export function rotuloFatura(f: Fatura): string {
  if (f.tipo === 'mensal' && f.competencia) return `A fatura de ${nomeCompetencia(f.competencia)}`;
  return `O pacote de ${(f.creditos ?? 0).toLocaleString('pt-BR')} créditos`;
}

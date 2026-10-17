// Regras de negócio do Horizonte, usadas tanto pela API (/v1) quanto pelas telas HTML.
// Toda operação que grava recebe `simular`: valida tudo (permissões e duplicidade inclusive)
// e devolve o que seria gravado, sem gravar.
import { idAleatorio } from './util/aleatorio.ts';
import {
  centavos,
  dataSP,
  diferencaDias,
  fimDeSemana,
  fmtData,
  horaSP,
  interpretarData,
  proximoDiaUtil,
  somarDias,
  ultimasCompetencias,
} from './util/datas.ts';
import {
  cnpjValido,
  cpfValido,
  emailValido,
  formatarCnpj,
  listaHumana,
  normalizar,
  somenteDigitos,
} from './util/texto.ts';
import { estadoInicial, gerarBoletos } from './dados/semente.ts';
import {
  PLANOS,
  PRAZOS,
  PRIMEIRO_DISPONIVEL,
  PRIORIDADES,
  TECNICOS,
  VERSAO_ESTADO,
  type AgruparPor,
  type AlteracaoPlano,
  type Boleto,
  type Chamado,
  type Cliente,
  type Estado,
  type EstadoDemo,
  type FormatoRelatorio,
  type Plano,
  type Prioridade,
  type Relatorio,
  type Usuario,
  type Visita,
} from './dados/tipos.ts';
import { PERMISSOES, USUARIOS, mensagemSemPermissao, nomeUsuario, pode, usuarioPorId, type Area } from './dados/usuarios.ts';
import { calcularRelatorio, csvRelatorio, nomeArquivoRelatorio, pdfRelatorio, type ResultadoRelatorio } from './relatorios.ts';
import { codigoBarras, linhaDigitavel, pdfSegundaVia, situacaoBoleto, type ViaCalculada } from './boletos.ts';

export class ErroHorizonte extends Error {
  constructor(
    readonly status: number,
    readonly erro: string,
    mensagem: string,
    readonly extras: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = 'ErroHorizonte';
  }

  corpo(): Record<string, unknown> {
    return { erro: this.erro, mensagem: this.message, ...this.extras };
  }

  /** Mensagens por campo (erro 422). */
  get campos(): Record<string, string> {
    return (this.extras.campos as Record<string, string> | undefined) ?? {};
  }
}

function erroValidacao(campos: Record<string, string>, rotulos: Record<string, string>): ErroHorizonte {
  const chaves = Object.keys(campos);
  const mensagem =
    chaves.length === 1
      ? campos[chaves[0]]
      : `Confira ${chaves.length} campos: ${listaHumana(chaves.map((c) => rotulos[c] ?? c))}.`;
  return new ErroHorizonte(422, 'validacao', mensagem, { campos });
}

/** Valor de entrada como texto aparado ("" quando ausente). */
export function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function presente(dados: Record<string, unknown>, chave: string): boolean {
  return dados[chave] !== undefined;
}

const ROTULOS_CLIENTE: Record<string, string> = {
  razao_social: 'Razão social',
  cnpj: 'CNPJ',
  email_cobranca: 'E-mail de cobrança',
  prazo_pagamento_dias: 'Prazo de pagamento',
  responsavel_id: 'Responsável',
  plano: 'Plano',
};

const ROTULOS_PLANO: Record<string, string> = { cliente: 'Cliente', plano: 'Plano', a_partir_de: 'A partir de' };

const ROTULOS_RELATORIO: Record<string, string> = {
  periodo_inicio: 'Início do período',
  periodo_fim: 'Fim do período',
  agrupar_por: 'Agrupar por',
  formato: 'Formato',
};

const ROTULOS_CHAMADO: Record<string, string> = {
  assunto: 'Assunto',
  cliente: 'Cliente',
  prioridade: 'Prioridade',
  descricao: 'Descrição',
};

const ROTULOS_VISITA: Record<string, string> = {
  cliente: 'Cliente',
  data: 'Data da visita',
  horario: 'Horário',
  tecnico: 'Técnico',
  observacoes: 'Observações',
};

const ROTULOS_BOLETO: Record<string, string> = { doc_pagador: 'CPF/CNPJ do pagador', competencia: 'Competência' };

export const HORARIOS = Array.from({ length: 10 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);

export function casarPlano(valor: string): Plano | null {
  const n = normalizar(valor).replace(/^plano /, '');
  return PLANOS.find((p) => normalizar(p) === n) ?? null;
}

function casarAgrupamento(valor: string): AgruparPor | null {
  const n = normalizar(valor);
  if (['vendedor', 'vendedores', 'por vendedor'].includes(n)) return 'vendedor';
  if (['regiao', 'regioes', 'por regiao'].includes(n)) return 'regiao';
  if (['produto', 'produtos', 'por produto'].includes(n)) return 'produto';
  return null;
}

function casarFormato(valor: string): FormatoRelatorio | null {
  const n = normalizar(valor);
  if (n === 'pdf') return 'pdf';
  if (['planilha', 'csv', 'excel', 'xlsx', 'xls'].includes(n)) return 'planilha';
  return null;
}

function casarPrioridade(valor: string): Prioridade | null {
  const n = normalizar(valor);
  return PRIORIDADES.find((p) => normalizar(p) === n) ?? null;
}

function casarTecnico(valor: string): string | null {
  const n = normalizar(valor);
  if (!n || n === normalizar(PRIMEIRO_DISPONIVEL)) return PRIMEIRO_DISPONIVEL;
  return TECNICOS.find((t) => normalizar(t) === n) ?? null;
}

function semSufixo(n: string): string {
  return n
    .replace(/\b(ltda|s a|sa|me|epp|eireli)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resumoCliente(c: Cliente) {
  return { id: c.id, codigo: c.codigo, razao_social: c.razao_social, cnpj: c.cnpj, plano: c.plano };
}

export interface OpcoesHorizonte {
  agora: () => Date;
  /** Dados para "Restaurar dados iniciais" (padrão: os dados de exemplo). */
  estadoInicial?: Estado;
  /** Estado carregado de um arquivo (continua de onde parou). */
  estadoAtual?: Estado;
  /** Chamado depois de cada gravação (persistência). */
  aoAlterar?: (estado: Estado) => void;
}

export class Horizonte {
  estado: Estado;

  constructor(private readonly o: OpcoesHorizonte) {
    const atual = o.estadoAtual && o.estadoAtual.versao === VERSAO_ESTADO ? o.estadoAtual : null;
    this.estado = structuredClone(atual ?? this.base());
    // Dados gravados num mês anterior: refaz os boletos para existir "o boleto deste mês".
    if (atual && atual.gerado_em.slice(0, 7) !== this.hoje().slice(0, 7)) {
      this.estado.boletos = gerarBoletos(this.hoje(), this.estado.clientes);
      this.estado.gerado_em = this.hoje();
    }
  }

  private base(): Estado {
    return structuredClone(this.o.estadoInicial ?? estadoInicial(this.o.agora()));
  }

  private alterou(): void {
    this.o.aoAlterar?.(this.estado);
  }

  agora(): Date {
    return this.o.agora();
  }

  agoraIso(): string {
    return this.o.agora().toISOString();
  }

  hoje(): string {
    return dataSP(this.o.agora());
  }

  competencias(): string[] {
    return ultimasCompetencias(this.hoje(), 12);
  }

  restaurar(): void {
    this.estado = this.base();
    this.alterou();
  }

  // ---------------- Demonstração ----------------

  definirDemo(parcial: Partial<EstadoDemo>): EstadoDemo {
    if (typeof parcial.api_instavel === 'boolean') this.estado.demo.api_instavel = parcial.api_instavel;
    if (typeof parcial.tela_agendamento_v2 === 'boolean') this.estado.demo.tela_agendamento_v2 = parcial.tela_agendamento_v2;
    this.alterou();
    return { ...this.estado.demo };
  }

  // ---------------- Usuários e permissões ----------------

  usuarios(): Usuario[] {
    return USUARIOS;
  }

  usuario(id: string | undefined | null): Usuario | undefined {
    return usuarioPorId(id);
  }

  pode(usuario: Usuario, area: Area): boolean {
    return pode(usuario, area);
  }

  exigir(usuario: Usuario, area: Area): void {
    if (pode(usuario, area)) return;
    throw new ErroHorizonte(403, 'sem_permissao', mensagemSemPermissao(area), {
      perfil_necessario: PERMISSOES[area].necessario,
      perfis_aceitos: PERMISSOES[area].perfis,
    });
  }

  // ---------------- Clientes ----------------

  listarClientes(filtro: { documento?: string; busca?: string } = {}): Cliente[] {
    let lista = this.estado.clientes;
    const documento = texto(filtro.documento);
    if (documento) {
      const d = somenteDigitos(documento);
      lista = lista.filter((c) => somenteDigitos(c.cnpj) === d);
    }
    const busca = texto(filtro.busca);
    if (busca) {
      const n = normalizar(busca);
      lista = lista.filter(
        (c) => normalizar(c.razao_social).includes(n) || c.codigo === busca || c.id === busca.replace('#', ''),
      );
    }
    return [...lista].sort((a, b) => a.razao_social.localeCompare(b.razao_social, 'pt-BR'));
  }

  cliente(id: string): Cliente | undefined {
    return this.estado.clientes.find((c) => c.id === String(id).replace('#', ''));
  }

  private clienteOu404(id: string): Cliente {
    const c = this.cliente(id);
    if (!c) throw new ErroHorizonte(404, 'cliente_nao_encontrado', `Não existe cliente com o código #${String(id).replace('#', '')}.`);
    return c;
  }

  private clientePorCnpj(cnpj: string): Cliente | undefined {
    const d = somenteDigitos(cnpj);
    return this.estado.clientes.find((c) => somenteDigitos(c.cnpj) === d);
  }

  private validarCliente(dados: Record<string, unknown>, parcial: boolean) {
    const campos: Record<string, string> = {};
    const valores: Partial<Pick<Cliente, 'razao_social' | 'cnpj' | 'email_cobranca' | 'prazo_pagamento_dias' | 'responsavel_id'>> = {};
    if (!parcial || presente(dados, 'razao_social')) {
      const v = texto(dados.razao_social).replace(/\s+/g, ' ');
      if (!v) campos.razao_social = 'Informe a razão social.';
      else if (v.replace(/[^\p{L}\p{N}]/gu, '').length < 2) campos.razao_social = 'A razão social precisa ter pelo menos 2 letras.';
      else if (v.length > 120) campos.razao_social = 'A razão social pode ter no máximo 120 caracteres.';
      else valores.razao_social = v;
    }
    if (!parcial || presente(dados, 'cnpj')) {
      const v = texto(dados.cnpj);
      const d = somenteDigitos(v);
      if (!v) campos.cnpj = 'Informe o CNPJ.';
      else if (d.length === 11) campos.cnpj = 'Isso parece um CPF. Clientes do Horizonte são empresas: informe o CNPJ (14 números).';
      else if (d.length !== 14) campos.cnpj = 'O CNPJ precisa ter 14 números, por exemplo 12.345.678/0001-95.';
      else if (!cnpjValido(d)) campos.cnpj = 'Esse CNPJ não é válido. Confira os números.';
      else valores.cnpj = formatarCnpj(d);
    }
    if (!parcial || presente(dados, 'email_cobranca')) {
      const v = texto(dados.email_cobranca).toLowerCase();
      if (!v) campos.email_cobranca = 'Informe o e-mail de cobrança.';
      else if (!emailValido(v)) campos.email_cobranca = 'Digite um e-mail completo, por exemplo financeiro@empresa.com.br.';
      else valores.email_cobranca = v;
    }
    if (!parcial || presente(dados, 'prazo_pagamento_dias')) {
      const bruto = dados.prazo_pagamento_dias;
      const t = texto(bruto);
      const numero = typeof bruto === 'number' ? bruto : Number(t.match(/^\d+/)?.[0] ?? NaN);
      if (!t) campos.prazo_pagamento_dias = 'Escolha o prazo de pagamento: 15, 30, 45 ou 60 dias.';
      else if (!(PRAZOS as readonly number[]).includes(numero))
        campos.prazo_pagamento_dias = 'O prazo de pagamento precisa ser 15, 30, 45 ou 60 dias.';
      else valores.prazo_pagamento_dias = numero;
    }
    if (!parcial || presente(dados, 'responsavel_id')) {
      const v = texto(dados.responsavel_id);
      const u = usuarioPorId(v) ?? USUARIOS.find((x) => normalizar(x.nome) === normalizar(v));
      if (!v) campos.responsavel_id = 'Escolha o responsável pelo cliente.';
      else if (!u) campos.responsavel_id = 'Responsável não encontrado. Escolha uma pessoa da lista.';
      else valores.responsavel_id = u.id;
    }
    if (parcial && presente(dados, 'plano')) {
      campos.plano = 'O plano não muda por aqui. Use a alteração de plano, que exige o perfil Gestor financeiro.';
    }
    return { campos, valores };
  }

  criarCliente(dados: Record<string, unknown>, usuario: Usuario, simular = false): Cliente {
    this.exigir(usuario, 'clientes');
    const { campos, valores } = this.validarCliente(dados, false);
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_CLIENTE);
    const existente = this.clientePorCnpj(valores.cnpj!);
    if (existente) {
      throw new ErroHorizonte(
        409,
        'cnpj_duplicado',
        `Já existe um cliente com o CNPJ ${existente.cnpj}: ${existente.razao_social} (${existente.codigo}).`,
        { existente: structuredClone(existente) },
      );
    }
    const id = String(this.estado.sequencias.cliente);
    const cliente: Cliente = {
      id,
      codigo: `#${id}`,
      razao_social: valores.razao_social!,
      cnpj: valores.cnpj!,
      email_cobranca: valores.email_cobranca!,
      prazo_pagamento_dias: valores.prazo_pagamento_dias!,
      plano: 'Básico',
      responsavel_id: valores.responsavel_id!,
      criado_em: this.agoraIso(),
    };
    if (!simular) {
      this.estado.sequencias.cliente += 1;
      this.estado.clientes.push(cliente);
      this.alterou();
    }
    return structuredClone(cliente);
  }

  atualizarCliente(id: string, dados: Record<string, unknown>, usuario: Usuario, simular = false): Cliente {
    this.exigir(usuario, 'clientes');
    const cliente = this.clienteOu404(id);
    const { campos, valores } = this.validarCliente(dados, true);
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_CLIENTE);
    if (Object.keys(valores).length === 0) {
      throw new ErroHorizonte(422, 'validacao', 'Nada para alterar: envie pelo menos um campo.', { campos: {} });
    }
    if (valores.cnpj) {
      const outro = this.clientePorCnpj(valores.cnpj);
      if (outro && outro.id !== cliente.id) {
        throw new ErroHorizonte(
          409,
          'cnpj_duplicado',
          `Já existe um cliente com o CNPJ ${outro.cnpj}: ${outro.razao_social} (${outro.codigo}).`,
          { existente: structuredClone(outro) },
        );
      }
    }
    const atualizado = { ...cliente, ...valores };
    if (!simular) {
      Object.assign(cliente, valores);
      this.alterou();
    }
    return structuredClone(atualizado);
  }

  removerCliente(id: string, usuario: Usuario, simular = false): Cliente {
    this.exigir(usuario, 'clientes');
    const cliente = this.clienteOu404(id);
    if (!simular) {
      this.estado.clientes = this.estado.clientes.filter((c) => c.id !== cliente.id);
      this.alterou();
    }
    return structuredClone(cliente);
  }

  /** Clientes que correspondem ao texto (código, CNPJ ou nome sem acento e sem caixa). */
  procurarClientes(entrada: string): Cliente[] {
    const t = entrada.trim();
    const clientes = this.estado.clientes;
    if (!t) return [];
    if (/^#?\d{1,6}$/.test(t)) {
      const c = this.cliente(t);
      if (c) return [c];
    }
    const d = somenteDigitos(t);
    if (d.length === 14 && /^[\d.\-/\s]+$/.test(t)) return clientes.filter((c) => somenteDigitos(c.cnpj) === d);
    const n = normalizar(t);
    const exato = clientes.filter((c) => normalizar(c.razao_social) === n);
    if (exato.length) return exato;
    const base = semSufixo(n);
    if (!base) return [];
    const semSufixoIgual = clientes.filter((c) => semSufixo(normalizar(c.razao_social)) === base);
    if (semSufixoIgual.length) return semSufixoIgual;
    const palavras = base.split(' ');
    const porPalavras = clientes.filter((c) => {
      const doNome = normalizar(c.razao_social).split(' ');
      return palavras.every((p) => doNome.includes(p));
    });
    if (porPalavras.length) return porPalavras;
    return clientes.filter((c) => normalizar(c.razao_social).includes(base));
  }

  /** Um cliente pelo texto; 404 se nenhum, 409 "ambiguo" com as opções se mais de um. */
  resolverCliente(entrada: unknown): Cliente {
    const t = texto(entrada);
    if (!t) throw erroValidacao({ cliente: 'Informe o cliente (nome ou CNPJ).' }, { cliente: 'Cliente' });
    const achados = this.procurarClientes(t);
    if (achados.length === 1) return achados[0];
    if (achados.length === 0) {
      throw new ErroHorizonte(404, 'cliente_nao_encontrado', `Não encontrei nenhum cliente com "${t}". Confira o nome ou informe o CNPJ.`);
    }
    throw new ErroHorizonte(
      409,
      'ambiguo',
      `Encontrei ${achados.length} clientes para "${t}": ${listaHumana(achados.map((c) => `${c.razao_social} (${c.codigo})`))}. Qual deles?`,
      { opcoes: achados.map(resumoCliente) },
    );
  }

  boletosEmAtraso(clienteId: string): Boleto[] {
    const hoje = this.hoje();
    return this.estado.boletos.filter((b) => b.cliente_id === clienteId && situacaoBoleto(b, hoje) === 'Vencido');
  }

  // ---------------- Planos ----------------

  alteracoesDoCliente(clienteId: string): AlteracaoPlano[] {
    return this.estado.alteracoes_plano
      .filter((a) => a.cliente_id === clienteId)
      .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  }

  alterarPlano(dados: Record<string, unknown>, usuario: Usuario, simular = false): AlteracaoPlano {
    this.exigir(usuario, 'planos');
    const campos: Record<string, string> = {};
    const hoje = this.hoje();
    if (!texto(dados.cliente)) campos.cliente = 'Informe o cliente (nome ou CNPJ).';
    const planoTexto = texto(dados.plano);
    const plano = casarPlano(planoTexto);
    if (!planoTexto) campos.plano = 'Informe o plano novo: Básico, Pro ou Premium.';
    else if (!plano) campos.plano = 'Plano desconhecido. Use Básico, Pro ou Premium.';
    let aPartirDe = hoje;
    if (texto(dados.a_partir_de)) {
      const d = interpretarData(texto(dados.a_partir_de));
      if (!d) campos.a_partir_de = 'Data inválida. Use o formato 22/10/2026 ou 2026-10-22.';
      else if (d < hoje) campos.a_partir_de = 'A mudança de plano vale a partir de hoje ou de uma data futura.';
      else if (d > somarDias(hoje, 366)) campos.a_partir_de = 'Agende a mudança com no máximo um ano de antecedência.';
      else aPartirDe = d;
    }
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_PLANO);
    const cliente = this.resolverCliente(dados.cliente);
    if (cliente.plano === plano) {
      throw new ErroHorizonte(409, 'mesmo_plano', `${cliente.razao_social} (${cliente.codigo}) já está no plano ${plano}.`, {
        cliente: structuredClone(cliente),
      });
    }
    const id = String(this.estado.sequencias.alteracao);
    const alteracao: AlteracaoPlano = {
      id,
      cliente_id: cliente.id,
      cliente_nome: cliente.razao_social,
      plano_anterior: cliente.plano,
      plano: plano!,
      a_partir_de: aPartirDe,
      criado_em: this.agoraIso(),
      criado_por: usuario.id,
      desfeita_em: null,
    };
    if (!simular) {
      this.estado.sequencias.alteracao += 1;
      this.estado.alteracoes_plano.push(alteracao);
      cliente.plano = plano!;
      this.alterou();
    }
    return structuredClone(alteracao);
  }

  desfazerAlteracao(id: string, usuario: Usuario, simular = false): AlteracaoPlano {
    this.exigir(usuario, 'planos');
    const alteracao = this.estado.alteracoes_plano.find((a) => a.id === id);
    if (!alteracao) throw new ErroHorizonte(404, 'alteracao_nao_encontrada', `Não existe alteração de plano com o número ${id}.`);
    if (alteracao.desfeita_em) {
      throw new ErroHorizonte(409, 'ja_desfeita', `Essa alteração de plano já foi desfeita em ${fmtData(dataSP(new Date(alteracao.desfeita_em)))}.`);
    }
    const cliente = this.cliente(alteracao.cliente_id);
    if (!cliente) throw new ErroHorizonte(404, 'cliente_nao_encontrado', 'O cliente desta alteração não existe mais.');
    if (cliente.plano !== alteracao.plano) {
      throw new ErroHorizonte(
        409,
        'plano_alterado_depois',
        `O plano de ${cliente.razao_social} mudou de novo depois desta alteração (hoje é ${cliente.plano}). Nada foi desfeito.`,
      );
    }
    if (!simular) {
      cliente.plano = alteracao.plano_anterior;
      alteracao.desfeita_em = this.agoraIso();
      this.alterou();
    }
    return structuredClone(alteracao);
  }

  // ---------------- Relatórios ----------------

  gerarRelatorio(dados: Record<string, unknown>, usuario: Usuario, simular = false): { relatorio: Relatorio; resultado: ResultadoRelatorio } {
    this.exigir(usuario, 'relatorios');
    const campos: Record<string, string> = {};
    const inicio = interpretarData(texto(dados.periodo_inicio));
    const fim = interpretarData(texto(dados.periodo_fim));
    if (!texto(dados.periodo_inicio)) campos.periodo_inicio = 'Informe o início do período.';
    else if (!inicio) campos.periodo_inicio = 'Data de início inválida. Use o formato 01/09/2026 ou 2026-09-01.';
    if (!texto(dados.periodo_fim)) campos.periodo_fim = 'Informe o fim do período.';
    else if (!fim) campos.periodo_fim = 'Data de fim inválida. Use o formato 30/09/2026 ou 2026-09-30.';
    if (inicio && fim && inicio > fim) campos.periodo_fim = 'O fim do período precisa ser igual ou depois do início.';
    else if (inicio && fim && diferencaDias(inicio, fim) > 731) campos.periodo_fim = 'O período pode ter no máximo 2 anos.';
    const agrupar = casarAgrupamento(texto(dados.agrupar_por));
    if (!agrupar) {
      campos.agrupar_por = texto(dados.agrupar_por)
        ? 'Agrupe por vendedor, região ou produto.'
        : 'Escolha como agrupar: vendedor, região ou produto.';
    }
    const formato = casarFormato(texto(dados.formato));
    if (!formato) campos.formato = texto(dados.formato) ? 'Formato desconhecido. Use PDF ou planilha.' : 'Escolha o formato: PDF ou planilha.';
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_RELATORIO);
    const resultado = calcularRelatorio(inicio!, fim!, agrupar!, this.hoje());
    const relatorio: Relatorio = {
      id: idAleatorio(12),
      numero: this.estado.sequencias.relatorio,
      periodo_inicio: inicio!,
      periodo_fim: fim!,
      agrupar_por: agrupar!,
      formato: formato!,
      linhas: resultado.linhas.length,
      total_vendas: resultado.total,
      criado_em: this.agoraIso(),
      criado_por: usuario.id,
    };
    if (!simular) {
      this.estado.sequencias.relatorio += 1;
      this.estado.relatorios.push(relatorio);
      this.alterou();
    }
    return { relatorio: structuredClone(relatorio), resultado };
  }

  relatorios(): Relatorio[] {
    return [...this.estado.relatorios].sort((a, b) => b.numero - a.numero);
  }

  relatorio(id: string): Relatorio | undefined {
    return this.estado.relatorios.find((r) => r.id === id);
  }

  /** Arquivo do relatório, recalculado com as vendas até o dia em que foi gerado. */
  arquivoRelatorio(id: string): { conteudo: Buffer; tipo: string; nome: string; extensao: 'pdf' | 'csv' } | null {
    const r = this.relatorio(id);
    if (!r) return null;
    const res = calcularRelatorio(r.periodo_inicio, r.periodo_fim, r.agrupar_por, dataSP(new Date(r.criado_em)));
    const nome = nomeArquivoRelatorio(r);
    if (r.formato === 'pdf') {
      return { conteudo: pdfRelatorio(r, res, nomeUsuario(r.criado_por)), tipo: 'application/pdf', nome, extensao: 'pdf' };
    }
    return { conteudo: csvRelatorio(r, res), tipo: 'text/csv; charset=utf-8', nome, extensao: 'csv' };
  }

  // ---------------- Chamados ----------------

  chamados(): Chamado[] {
    return [...this.estado.chamados].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  }

  chamado(id: string): Chamado | undefined {
    return this.estado.chamados.find((c) => c.id === id || c.numero === id);
  }

  abrirChamado(dados: Record<string, unknown>, usuario: Usuario, simular = false): Chamado {
    this.exigir(usuario, 'chamados');
    const campos: Record<string, string> = {};
    const assunto = texto(dados.assunto).replace(/\s+/g, ' ');
    if (!assunto) campos.assunto = 'Informe o assunto do chamado.';
    else if (assunto.length < 3) campos.assunto = 'O assunto precisa ter pelo menos 3 letras.';
    else if (assunto.length > 120) campos.assunto = 'O assunto pode ter no máximo 120 caracteres.';
    if (!texto(dados.cliente)) campos.cliente = 'Informe o cliente do chamado.';
    const prioridade = casarPrioridade(texto(dados.prioridade));
    if (!prioridade) campos.prioridade = 'Escolha a prioridade: Baixa, Média, Alta ou Urgente.';
    const descricao = texto(dados.descricao);
    if (!descricao) campos.descricao = 'Descreva o problema.';
    else if (descricao.length < 10) campos.descricao = 'Descreva o problema com pelo menos 10 caracteres.';
    else if (descricao.length > 2000) campos.descricao = 'A descrição pode ter no máximo 2.000 caracteres.';
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_CHAMADO);
    let cliente: Cliente | null = null;
    try {
      cliente = this.resolverCliente(dados.cliente);
    } catch (e) {
      // Cliente que não está cadastrado fica registrado só pelo nome; ambiguidade precisa ser resolvida.
      if (!(e instanceof ErroHorizonte && e.status === 404)) throw e;
    }
    const id = String(this.estado.sequencias.chamado);
    const chamado: Chamado = {
      id,
      numero: `CH-${this.hoje().slice(0, 4)}-${id.padStart(4, '0')}`,
      assunto,
      cliente_id: cliente?.id ?? null,
      cliente_nome: cliente?.razao_social ?? texto(dados.cliente),
      prioridade: prioridade!,
      descricao,
      status: 'Aberto',
      criado_em: this.agoraIso(),
      criado_por: usuario.id,
    };
    if (!simular) {
      this.estado.sequencias.chamado += 1;
      this.estado.chamados.push(chamado);
      this.alterou();
    }
    return structuredClone(chamado);
  }

  removerChamado(id: string, usuario: Usuario, simular = false): Chamado {
    this.exigir(usuario, 'chamados');
    const chamado = this.chamado(id);
    if (!chamado) throw new ErroHorizonte(404, 'chamado_nao_encontrado', `Não existe chamado com o número ${id}.`);
    const podeExcluir =
      chamado.criado_por === usuario.id || usuario.perfis.some((p) => p === 'Atendimento' || p === 'Administradores');
    if (!podeExcluir) {
      throw new ErroHorizonte(403, 'sem_permissao', 'Só quem abriu o chamado, o Atendimento ou os Administradores podem excluí-lo.', {
        perfil_necessario: 'Atendimento',
        perfis_aceitos: ['Atendimento', 'Administradores'],
      });
    }
    if (!simular) {
      this.estado.chamados = this.estado.chamados.filter((c) => c.id !== chamado.id);
      this.alterou();
    }
    return structuredClone(chamado);
  }

  // ---------------- Boletos ----------------

  buscarBoletos(dados: { doc_pagador?: unknown; competencia?: unknown }, usuario: Usuario): Boleto[] {
    this.exigir(usuario, 'boletos');
    const campos: Record<string, string> = {};
    const doc = texto(dados.doc_pagador);
    const d = somenteDigitos(doc);
    if (!doc) campos.doc_pagador = 'Informe o CPF ou CNPJ do pagador.';
    else if (d.length !== 11 && d.length !== 14) campos.doc_pagador = 'Digite um CPF (11 números) ou CNPJ (14 números).';
    else if (d.length === 11 ? !cpfValido(d) : !cnpjValido(d)) campos.doc_pagador = `Esse ${d.length === 11 ? 'CPF' : 'CNPJ'} não é válido. Confira os números.`;
    const competencia = texto(dados.competencia);
    if (!competencia) campos.competencia = 'Escolha a competência.';
    else if (!this.competencias().includes(competencia)) campos.competencia = 'Escolha uma competência dos últimos 12 meses.';
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_BOLETO);
    return this.estado.boletos.filter((b) => somenteDigitos(b.pagador_doc) === d && b.competencia === competencia);
  }

  boleto(numero: string): Boleto | undefined {
    return this.estado.boletos.find((b) => b.numero === numero);
  }

  /** Vencimento, valor e linha digitável da segunda via (boleto vencido ganha novo vencimento, multa e juros). */
  calcularVia(b: Boleto): ViaCalculada {
    const hoje = this.hoje();
    const situacao = situacaoBoleto(b, hoje);
    let vencimento = b.vencimento;
    let multa = 0;
    let juros = 0;
    if (situacao === 'Vencido') {
      vencimento = proximoDiaUtil(somarDias(hoje, 3));
      const dias = diferencaDias(b.vencimento, vencimento);
      multa = centavos(b.valor * 0.02);
      juros = centavos(((b.valor * 0.01) / 30) * dias);
    }
    const valor = centavos(b.valor + multa + juros);
    const dados = { nossoNumero: b.nosso_numero, vencimento, valor };
    return {
      situacao,
      vencimento,
      valor,
      valor_original: b.valor,
      multa,
      juros,
      linha_digitavel: linhaDigitavel(dados),
      codigo_barras: codigoBarras(dados),
    };
  }

  /** Gera (e registra) a segunda via. */
  gerarSegundaVia(numero: string, usuario: Usuario): { boleto: Boleto; via: ViaCalculada } {
    this.exigir(usuario, 'boletos');
    const boleto = this.boleto(numero);
    if (!boleto) throw new ErroHorizonte(404, 'boleto_nao_encontrado', `Não existe boleto com o número ${numero}.`);
    const via = this.calcularVia(boleto);
    boleto.segundas_vias.push({ em: this.agoraIso(), por: usuario.id, vencimento: via.vencimento, valor: via.valor });
    this.alterou();
    return { boleto: structuredClone(boleto), via };
  }

  pdfBoleto(numero: string, usuario: Usuario): Buffer {
    this.exigir(usuario, 'boletos');
    const boleto = this.boleto(numero);
    if (!boleto) throw new ErroHorizonte(404, 'boleto_nao_encontrado', `Não existe boleto com o número ${numero}.`);
    return pdfSegundaVia({ boleto, via: this.calcularVia(boleto), geradoEm: this.agora(), geradoPor: usuario.nome });
  }

  // ---------------- Agenda ----------------

  visitas(): Visita[] {
    return [...this.estado.visitas].sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  }

  visita(id: string): Visita | undefined {
    return this.estado.visitas.find((v) => v.id === id || v.protocolo === id);
  }

  private tecnicoOcupado(tecnico: string, data: string, horario: string): boolean {
    return this.estado.visitas.some((v) => v.status === 'Agendada' && v.tecnico === tecnico && v.data === data && v.horario === horario);
  }

  /** Campos: cliente, data, horario, tecnico, observacoes. Erros de validação vêm com essas chaves. */
  agendarVisita(dados: Record<string, unknown>, usuario: Usuario): Visita {
    this.exigir(usuario, 'agenda');
    const campos: Record<string, string> = {};
    const hoje = this.hoje();
    let cliente: Cliente | null = null;
    const clienteTexto = texto(dados.cliente);
    if (!clienteTexto) campos.cliente = 'Informe o cliente. Comece a digitar e escolha da lista.';
    else {
      try {
        cliente = this.resolverCliente(clienteTexto);
      } catch (e) {
        if (!(e instanceof ErroHorizonte)) throw e;
        campos.cliente =
          e.erro === 'ambiguo'
            ? `Mais de um cliente com esse nome: ${listaHumana((e.extras.opcoes as { razao_social: string }[]).map((o) => o.razao_social))}. Escolha um da lista.`
            : 'Cliente não encontrado. Comece a digitar e escolha um cliente da lista.';
      }
    }
    const dataTexto = texto(dados.data);
    const data = interpretarData(dataTexto);
    if (!dataTexto) campos.data = 'Informe a data da visita.';
    else if (!data) campos.data = 'Data inválida. Use o formato dd/mm/aaaa.';
    else if (data < hoje) campos.data = 'A data da visita não pode estar no passado.';
    else if (fimDeSemana(data)) campos.data = 'Não fazemos visitas aos sábados e domingos. Escolha um dia de segunda a sexta.';
    else if (data > somarDias(hoje, 180)) campos.data = 'Agende com no máximo 6 meses de antecedência.';
    const horario = texto(dados.horario).replace(/^(\d):/, '0$1:');
    if (!horario) campos.horario = 'Escolha o horário da visita.';
    else if (!HORARIOS.includes(horario)) campos.horario = 'Escolha um horário entre 08:00 e 17:00.';
    else if (data === hoje && horario <= horaSP(this.agora())) {
      campos.horario = 'Esse horário já passou. Escolha um horário mais tarde ou outro dia.';
    }
    let tecnico = casarTecnico(texto(dados.tecnico));
    if (!tecnico) campos.tecnico = 'Escolha um técnico da lista ou "Primeiro disponível".';
    const observacoes = texto(dados.observacoes);
    if (observacoes.length > 500) campos.observacoes = 'As observações podem ter no máximo 500 caracteres.';
    if (Object.keys(campos).length === 0 && data && tecnico) {
      if (tecnico === PRIMEIRO_DISPONIVEL) {
        const doDia = (t: string) => this.estado.visitas.filter((v) => v.status === 'Agendada' && v.tecnico === t && v.data === data).length;
        const livres = TECNICOS.filter((t) => !this.tecnicoOcupado(t, data, horario)).sort((a, b) => doDia(a) - doDia(b));
        if (livres.length === 0) campos.horario = `Nenhum técnico está livre em ${fmtData(data)} às ${horario}. Escolha outro horário.`;
        else tecnico = livres[0];
      } else if (this.tecnicoOcupado(tecnico, data, horario)) {
        campos.horario = `${tecnico} já tem uma visita em ${fmtData(data)} às ${horario}. Escolha outro horário, outro técnico ou "Primeiro disponível".`;
      }
    }
    if (Object.keys(campos).length) throw erroValidacao(campos, ROTULOS_VISITA);
    const id = String(this.estado.sequencias.visita);
    const visita: Visita = {
      id,
      protocolo: `VT-${hoje.slice(0, 4)}-${id.padStart(4, '0')}`,
      cliente_id: cliente!.id,
      cliente_nome: cliente!.razao_social,
      data: data!,
      horario,
      tecnico: tecnico!,
      observacoes,
      status: 'Agendada',
      criado_em: this.agoraIso(),
      criado_por: usuario.id,
    };
    this.estado.sequencias.visita += 1;
    this.estado.visitas.push(visita);
    this.alterou();
    return structuredClone(visita);
  }

  cancelarVisita(id: string, usuario: Usuario): Visita {
    this.exigir(usuario, 'agenda');
    const visita = this.visita(id);
    if (!visita) throw new ErroHorizonte(404, 'visita_nao_encontrada', `Não existe visita com o número ${id}.`);
    if (visita.status !== 'Agendada') throw new ErroHorizonte(409, 'visita_nao_agendada', `Esta visita está ${visita.status.toLowerCase()} e não pode ser cancelada.`);
    visita.status = 'Cancelada';
    this.alterou();
    return structuredClone(visita);
  }
}

export { situacaoBoleto };

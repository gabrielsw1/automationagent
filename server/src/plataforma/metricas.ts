// Números da Plataforma Starta (S7), lidos do banco de cada empresa: execuções, créditos, sucesso,
// tarefas e consertos visuais. Nunca conversas, prints ou dados dos clientes.
import {
  CONSERTOS_PARA_QUEBRADO,
  CREDITOS_COM_CONSERTO,
  type DetalheEmpresaStarta,
  type EtapaImplantacao,
  type FluxoComConserto,
  type LinhaEmpresaStarta,
  type ResumoPlataforma,
  type SaudeFluxo,
  type SituacaoEmpresa,
  type UsoEmpresa,
  type UsoPlataforma,
  fmt,
} from '@copiloto/shared';
import { iniciais } from '../auth/console.ts';
import { resumoStarta } from '../auth/starta.ts';
import type { Banco } from '../db/banco.ts';
import { agoraIso } from '../db/banco.ts';
import type { Empresa, Plataforma } from './index.ts';

const DIA = 86_400_000;

/** "A", "A e B", "A, B e C". */
function listaE(itens: string[]): string {
  return itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

export const desde30d = (agora = Date.now()) => new Date(agora - 30 * DIA).toISOString();

export function situacaoDe(e: Empresa): SituacaoEmpresa {
  return e.status === 'suspensa' ? 'pausado' : e.fase;
}

function contar(banco: Banco, sql: string, ...params: (string | number)[]): number {
  return banco.um<{ n: number | null }>(sql, ...params)?.n ?? 0;
}

/** Tarefas com conserto visual nos últimos 30 dias, a que mais consertou primeiro. */
export function fluxosComConserto(banco: Banco, desde = desde30d()): FluxoComConserto[] {
  return banco
    .todos<{ tarefa_id: string; nome: string; n: number; ultimo: string }>(
      `SELECT tarefa_id, MAX(tarefa_nome) AS nome, COUNT(*) AS n, MAX(criado_em) AS ultimo
         FROM execucoes
        WHERE recuperacoes > 0 AND criado_em >= ? AND tarefa_id IS NOT NULL
        GROUP BY tarefa_id ORDER BY n DESC, nome`,
      desde,
    )
    .map((l) => {
      const evento = banco.um<{ titulo: string; detalhe: string | null }>(
        `SELECT ev.titulo, ev.detalhe FROM execucao_eventos ev JOIN execucoes e ON e.id = ev.execucao_id
          WHERE e.tarefa_id = ? AND ev.tipo = 'recuperacao' ORDER BY ev.ts DESC LIMIT 1`,
        l.tarefa_id,
      );
      return {
        tarefaId: l.tarefa_id,
        nome: l.nome,
        consertos30d: l.n,
        quebrado: l.n > CONSERTOS_PARA_QUEBRADO,
        ultimoConserto: l.ultimo,
        detalhe: evento ? [evento.titulo, evento.detalhe].filter(Boolean).join(' · ') : null,
      };
    });
}

export function linhaEmpresa(plataforma: Plataforma, e: Empresa, desde = desde30d()): LinhaEmpresaStarta {
  const { banco } = plataforma.contexto(e.id);
  const exec = banco.um<{ total: number; ok: number | null; falhas: number | null; creditos: number | null }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN status = 'falhou' THEN 1 ELSE 0 END) AS falhas,
            SUM(creditos) AS creditos
       FROM execucoes WHERE criado_em >= ? AND canal != 'teste'`,
    desde,
  ) ?? { total: 0, ok: 0, falhas: 0, creditos: 0 };
  const terminadas = (exec.ok ?? 0) + (exec.falhas ?? 0);
  const tarefas = (status: string) => contar(banco, 'SELECT COUNT(*) AS n FROM tarefas WHERE status = ?', status);
  const responsavel = e.responsavelStarta ? plataforma.starta.pessoa(e.responsavelStarta) : undefined;
  const plano = e.planoId ? plataforma.plano(e.planoId) : undefined;
  return {
    id: e.id,
    nome: e.nome,
    iniciais: iniciais(e.nome),
    demo: e.demo,
    situacao: situacaoDe(e),
    fase: e.fase,
    faseDesde: e.faseDesde,
    suspensaEm: e.suspensaEm,
    plano: plano ? { id: plano.id, nome: plano.nome } : null,
    usuarios: contar(banco, "SELECT COUNT(DISTINCT usuario_id) AS n FROM conversas WHERE canal = 'widget' AND criado_em >= ?", desde),
    tarefasAtivas: tarefas('ativa'),
    tarefasEmTeste: tarefas('teste'),
    tarefasPausadas: tarefas('inativa'),
    execucoes30d: exec.total ?? 0,
    sucesso30d: terminadas > 0 ? (exec.ok ?? 0) / terminadas : null,
    creditos30d: exec.creditos ?? 0,
    fluxosQuebrados: fluxosComConserto(banco, desde).filter((f) => f.quebrado).length,
    responsavel: responsavel ? resumoStarta(responsavel) : null,
  };
}

/**
 * Margem por crédito nos últimos 30 dias: o que os créditos renderam (cada empresa pelo preço do
 * crédito do plano dela) menos o custo de IA e navegador, dividido pelos créditos. null quando
 * alguma empresa que gastou créditos não tem plano com preço, ou ninguém gastou.
 */
function margemPorCredito(plataforma: Plataforma, empresas: Empresa[], desde: string): number | null {
  let receita = 0;
  let custo = 0;
  let creditos = 0;
  for (const e of empresas) {
    const l = plataforma.contexto(e.id).banco.um<{ custo: number | null; creditos: number | null }>(
      `SELECT SUM(COALESCE(custo_modelo, 0) + COALESCE(custo_navegador, 0)) AS custo, SUM(creditos) AS creditos
         FROM execucoes WHERE criado_em >= ? AND creditos > 0`,
      desde,
    );
    const n = l?.creditos ?? 0;
    if (n === 0) continue;
    const preco = plataforma.precoCredito(e.planoId);
    if (preco === null) return null;
    receita += n * preco;
    custo += l?.custo ?? 0;
    creditos += n;
  }
  return creditos > 0 ? Math.round(((receita - custo) / creditos) * 100) / 100 : null;
}

export function painelEmpresas(plataforma: Plataforma): { resumo: ResumoPlataforma; empresas: LinhaEmpresaStarta[] } {
  const desde = desde30d();
  const todas = plataforma.listarEmpresas();
  const linhas = todas.map((e) => linhaEmpresa(plataforma, e, desde));
  const emUso = linhas.filter((l) => l.situacao === 'ativo' || l.situacao === 'piloto');
  const piloto = linhas.filter((l) => l.situacao === 'piloto');
  return {
    resumo: {
      ativas: emUso.length,
      emImplantacao: linhas.filter((l) => l.situacao === 'implantacao').length,
      pausadas: linhas.filter((l) => l.situacao === 'pausado').length,
      emPiloto: { total: piloto.length, nomes: piloto.map((l) => l.nome) },
      execucoes30d: emUso.reduce((s, l) => s + l.execucoes30d, 0),
      margemPorCredito: margemPorCredito(plataforma, todas.filter((e) => e.status === 'ativa'), desde),
      ate: agoraIso(),
    },
    empresas: linhas,
  };
}

/** As 5 etapas da implantação, com a data em que cada uma ficou pronta. */
function implantacao(plataforma: Plataforma, e: Empresa, linha: LinhaEmpresaStarta): EtapaImplantacao[] {
  const { banco } = plataforma.contexto(e.id);
  const primeira = (acao: string) => banco.um<{ ts: string | null }>('SELECT MIN(ts) AS ts FROM auditoria WHERE acao = ?', acao)?.ts ?? null;
  const termos = plataforma.banco.um<{ t: string | null }>('SELECT termos_aceitos_em AS t FROM empresas WHERE id = ?', e.id)?.t ?? null;
  const sistemaLigado = !!e.sistema.url;
  const widget = primeira('publicou a configuração do widget');
  const acesso =
    e.sistema.conector === 'api'
      ? 'pela API do sistema'
      : e.sistema.acesso.modo === 'sessao'
        ? 'widget assinado pelo sistema'
        : e.sistema.acesso.modo === 'conta'
          ? 'conta de serviço do copiloto'
          : 'falta definir como o copiloto entra';
  const meta = e.metaTarefas;
  const { catalogo } = plataforma.contexto(e.id);
  const faltam =
    meta && linha.tarefasAtivas < meta
      ? banco
          .todos<{ id: string }>("SELECT id FROM tarefas WHERE status IN ('teste', 'rascunho') ORDER BY atualizado_em DESC LIMIT ?", meta - linha.tarefasAtivas)
          .map((t) => (catalogo.rascunho(t.id) ?? catalogo.publicada(t.id))?.definicao.nome ?? t.id)
      : [];
  const ultimaPublicada = banco.um<{ ts: string | null }>("SELECT MAX(ts) AS ts FROM auditoria WHERE acao LIKE 'publicou a versão % da tarefa'")?.ts ?? null;
  const avaliacao = e.avaliacaoPilotoEm;
  return [
    { chave: 'contrato', titulo: 'Contrato e LGPD assinados', feita: !!termos || e.demo, quando: termos ?? (e.demo ? e.criadoEm : null), detalhe: null },
    {
      chave: 'sistema',
      titulo: 'Sistema conectado',
      feita: sistemaLigado,
      quando: sistemaLigado ? (primeira('alterou o sistema') ?? e.criadoEm) : null,
      detalhe: sistemaLigado ? acesso : 'O endereço do sistema ainda não foi informado.',
    },
    {
      chave: 'marca',
      titulo: 'Marca e widget no ar',
      feita: !!widget || e.demo,
      quando: widget ?? (e.demo ? e.criadoEm : null),
      detalhe: widget || e.demo ? null : 'A empresa ainda não publicou o widget em Canais e widget.',
    },
    {
      chave: 'tarefas',
      titulo: meta ? `Tarefas publicadas: ${linha.tarefasAtivas} de ${meta}` : `Tarefas publicadas: ${linha.tarefasAtivas}`,
      feita: meta ? linha.tarefasAtivas >= meta : linha.tarefasAtivas > 0,
      quando: ultimaPublicada,
      detalhe: faltam.length ? `Faltam ${listaE(faltam)}` : meta ? null : 'Sem meta combinada para a implantação.',
    },
    {
      chave: 'avaliacao',
      titulo: 'Avaliação do piloto',
      feita: !!avaliacao && avaliacao <= agoraIso(),
      quando: avaliacao,
      detalhe: avaliacao ? `Reunião em ${fmt.data(avaliacao)} com a empresa` : 'Ainda sem data marcada.',
    },
  ];
}

export function detalheEmpresa(plataforma: Plataforma, e: Empresa): DetalheEmpresaStarta {
  const desde = desde30d();
  const linha = linhaEmpresa(plataforma, e, desde);
  const { banco } = plataforma.contexto(e.id);
  const admin = banco.um<{ nome: string | null; email: string }>(
    "SELECT nome, email FROM equipe WHERE perfil = 'admin' AND status = 'ativo' ORDER BY criado_em LIMIT 1",
  );
  const plano = e.planoId ? plataforma.plano(e.planoId) : undefined;
  return {
    ...linha,
    dominio: e.dominios[0] ?? null,
    cnpj: e.cnpj,
    faixaUsuarios: e.faixaUsuarios,
    limiteUsuarios: plano?.usuariosMax ?? null,
    acesso: e.sistema.acesso.modo,
    adminEmpresa: admin ? { nome: admin.nome ?? admin.email, email: admin.email } : null,
    criadoEm: e.criadoEm,
    metaTarefas: e.metaTarefas,
    avaliacaoPilotoEm: e.avaliacaoPilotoEm,
    implantacao: implantacao(plataforma, e, linha),
    fluxosComConserto: fluxosComConserto(banco, desde).slice(0, 5),
    acessosSuporte: plataforma.starta.acessosSuporte({ empresaId: e.id, limite: 5 }).map((a) => ({ ...a, pessoa: a.pessoaNome, empresa: e.nome })),
  };
}

/** Uso e custos de cada empresa num período (padrão: 30 dias). */
export function usoPlataforma(plataforma: Plataforma, desde = desde30d()): UsoPlataforma {
  const empresas: UsoEmpresa[] = plataforma.listarEmpresas().map((e) => {
    const ctx = plataforma.contexto(e.id);
    const l = ctx.banco.um<{ execucoes: number; creditos: number | null; conserto: number | null; nav: number | null }>(
      `SELECT COUNT(*) AS execucoes, SUM(creditos) AS creditos,
              SUM(CASE WHEN creditos = ? THEN creditos ELSE 0 END) AS conserto,
              SUM(COALESCE(custo_navegador, 0)) AS nav
         FROM execucoes WHERE criado_em >= ? AND canal != 'teste'`,
      String(CREDITOS_COM_CONSERTO),
      desde,
    );
    const ia = ctx.banco.um<{ usd: number | null }>('SELECT SUM(custo_usd) AS usd FROM uso_llm WHERE criado_em >= ?', desde)?.usd ?? 0;
    const creditos = l?.creditos ?? 0;
    const preco = plataforma.precoCredito(e.planoId);
    return {
      empresaId: e.id,
      nome: e.nome,
      execucoes: l?.execucoes ?? 0,
      creditos,
      creditosConserto: l?.conserto ?? 0,
      creditosRoteiro: creditos - (l?.conserto ?? 0),
      custoIa: Math.round(ctx.gastos.emReais(ia) * 100) / 100,
      custoNavegador: Math.round((l?.nav ?? 0) * 100) / 100,
      receitaCreditos: preco === null ? null : Math.round(creditos * preco * 100) / 100,
    };
  });
  const soma = (k: 'execucoes' | 'creditos' | 'creditosRoteiro' | 'creditosConserto' | 'custoIa' | 'custoNavegador') =>
    Math.round(empresas.reduce((s, x) => s + x[k], 0) * 100) / 100;
  const receitas = empresas.map((x) => x.receitaCreditos);
  return {
    desde,
    ate: agoraIso(),
    empresas,
    total: {
      execucoes: soma('execucoes'),
      creditos: soma('creditos'),
      creditosRoteiro: soma('creditosRoteiro'),
      creditosConserto: soma('creditosConserto'),
      custoIa: soma('custoIa'),
      custoNavegador: soma('custoNavegador'),
      receitaCreditos: receitas.some((r) => r === null) ? null : Math.round(receitas.reduce<number>((s, r) => s + (r ?? 0), 0) * 100) / 100,
    },
  };
}

/** Saúde dos fluxos: tarefas com conserto visual em todas as empresas ativas. */
export function saudeFluxos(plataforma: Plataforma): SaudeFluxo[] {
  const desde = desde30d();
  return plataforma
    .listarEmpresas()
    .filter((e) => e.status === 'ativa')
    .flatMap((e) => {
      const { banco } = plataforma.contexto(e.id);
      return fluxosComConserto(banco, desde).map((f) => {
        const n = banco.um<{ total: number; falhas: number | null }>(
          "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'falhou' THEN 1 ELSE 0 END) AS falhas FROM execucoes WHERE tarefa_id = ? AND criado_em >= ? AND canal != 'teste'",
          f.tarefaId,
          desde,
        );
        return { ...f, empresaId: e.id, empresa: e.nome, execucoes30d: n?.total ?? 0, falhas30d: n?.falhas ?? 0 };
      });
    })
    .sort((a, b) => Number(b.quebrado) - Number(a.quebrado) || b.consertos30d - a.consertos30d);
}

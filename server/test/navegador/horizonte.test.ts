// Fluxos do seed contra o sistema de exemplo de verdade (opcional).
// Rode com o Horizonte no ar:
//   cd sample-system && PORT=4401 npx tsx src/index.ts
//   cd server && HORIZONTE_URL=http://localhost:4401 npx vitest run test/navegador/horizonte.test.ts
// Sem HORIZONTE_URL, os testes são pulados.
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fluxo } from '@copiloto/shared';
import { lerConfig, type Config } from '../../src/config.ts';
import { Banco } from '../../src/db/banco.ts';
import { LlmSimulado } from '../../src/llm/simulado.ts';
import { AdaptadorHorizonte } from '../../src/adaptadores/exemplo/index.ts';
import { NavegadorPlaywright } from '../../src/navegador/executor.ts';
import type { EventoNavegador, PedidoExecucaoNavegador } from '../../src/navegador/tipos.ts';
import { fluxosExemplo, type ChaveFluxoExemplo } from '../../src/seed/fluxos.ts';
import { pastaTemporaria } from './ajuda-navegador.ts';

const URL_HORIZONTE = process.env.HORIZONTE_URL?.replace(/\/$/, '');
const CHAVE = process.env.SISTEMA_CHAVE_SERVICO ?? 'chave-servico-local';

let navegador: NavegadorPlaywright;
let banco: Banco;
let adaptador: AdaptadorHorizonte;
let contador = 0;

function fluxo(chave: ChaveFluxoExemplo): Fluxo {
  return { id: `flx_${chave}`, tarefaId: null, ...fluxosExemplo()![chave] };
}

function pedido(chave: ChaveFluxoExemplo, valores: Record<string, string>, extra: Partial<PedidoExecucaoNavegador> = {}) {
  const eventos: EventoNavegador[] = [];
  const p: PedidoExecucaoNavegador = {
    execucaoId: `HZ-${Date.now()}-${++contador}`,
    fluxo: fluxo(chave),
    valores,
    usuarioId: '105',
    confiancaMinima: 0.85,
    mascararPrints: true,
    aoEvento: (e) => eventos.push(e),
    sinal: new AbortController().signal,
    ...extra,
  };
  return { p, eventos };
}

async function demo(estado: { tela_agendamento_v2: boolean }) {
  const r = await fetch(`${URL_HORIZONTE}/_demo/estado`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ api_instavel: false, ...estado }),
  });
  expect(r.ok).toBe(true);
}

async function api(metodo: string, caminho: string) {
  return fetch(`${URL_HORIZONTE}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${CHAVE}`, 'x-usuario-id': '105', accept: 'application/json' },
  });
}

/** CNPJ válido e diferente a cada execução (o Horizonte recusa CNPJ repetido). */
function cnpjNovo(): string {
  const base = `${String(Date.now()).slice(-8)}0001`.split('').map(Number);
  const dv = (nums: number[]) => {
    const pesos = nums.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = nums.reduce((s, n, i) => s + n * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  const n = [...base, d1, d2].join('');
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

/** Próximo dia útil a pelo menos `dias` dias de hoje, em dd/mm/aaaa (como a pessoa diria). */
function diaUtil(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function competenciaAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

describe.skipIf(!URL_HORIZONTE)('fluxos do seed no Horizonte de verdade', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const config: Config = {
      ...lerConfig(),
      dirDados: pastaTemporaria('copiloto-hz-'),
      navegadorVisivel: false,
      sistema: { nome: 'Horizonte', urlBase: URL_HORIZONTE!, urlApi: URL_HORIZONTE!, chaveServico: CHAVE },
    };
    banco = new Banco(':memory:');
    adaptador = new AdaptadorHorizonte(config);
    navegador = new NavegadorPlaywright({ config, banco, adaptador, llm: new LlmSimulado() }, { tempoElementoMs: 4_000 });
    await demo({ tela_agendamento_v2: false });
  });

  afterAll(async () => {
    if (URL_HORIZONTE) await demo({ tela_agendamento_v2: false }).catch(() => undefined);
    await navegador?.fechar();
    banco?.fechar();
  });

  it('cadastra um cliente pela tela e lê o código', async () => {
    const { p, eventos } = pedido('cadastro_cliente_tela', {
      nome_empresa: 'Padaria Teste do Copiloto Ltda',
      cnpj: cnpjNovo(),
      email_cobranca: 'financeiro@padariateste.com.br',
      prazo_pagamento: '30',
      responsavel: 'Ana Ribeiro',
    });
    const r = await navegador.executar(p);
    expect(r, JSON.stringify(eventos.slice(-3))).toMatchObject({ ok: true, recuperacoes: 0 });
    if (!r.ok) return;
    expect(r.gerados.codigo).toMatch(/^#\d+$/);
    expect(eventos.filter((e) => e.tipo === 'passo_ok').map((e) => e.titulo)).toContain('Selecionou prazo de pagamento');
    // desfaz o cadastro
    const apagar = await api('DELETE', `/v1/clientes/${r.gerados.codigo.slice(1)}`);
    expect(apagar.status).toBe(204);
  });

  it('gera a segunda via, baixa o PDF e lê a linha digitável', async () => {
    const { p } = pedido('segunda_via_boleto', { documento_pagador: '12.345.678/0001-95', competencia: competenciaAnterior() });
    const r = await navegador.executar(p);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.gerados.linha_digitavel).toMatch(/^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
    expect(r.arquivos).toHaveLength(1);
    expect(r.arquivos[0].tipo).toBe('application/pdf');
    expect(fs.readFileSync(r.arquivos[0].caminho).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('agenda a visita (tela antiga) e lê o protocolo', async () => {
    await demo({ tela_agendamento_v2: false });
    const { p } = pedido('agendar_visita', { cliente: 'ACME Log Ltda', data: diaUtil(9), horario: '15:00', tecnico: 'Primeiro disponível' });
    const r = await navegador.executar(p);
    expect(r).toMatchObject({ ok: true, recuperacoes: 0 });
    if (!r.ok) return;
    expect(r.gerados.protocolo).toMatch(/^VT-\d{4}-\d{4}$/);
  });

  it('com a tela nova: acha o campo de data, mas para no botão que mudou de nome', async () => {
    await demo({ tela_agendamento_v2: true });
    const { p, eventos } = pedido('agendar_visita', { cliente: 'ACME Log Ltda', data: diaUtil(10), horario: '14:00', tecnico: 'Primeiro disponível' });
    const r = await navegador.executar(p);
    expect(r).toMatchObject({ ok: false, motivo: 'elemento_nao_encontrado', passo: 6 });
    if (r.ok) return;
    expect(r.candidato?.texto).toMatch(/Confirmar agendamento/);
    expect(r.candidato!.confianca).toBeLessThan(0.85);
    expect(r.printId).toBeTruthy();
    const rec = eventos.filter((e) => e.tipo === 'recuperacao');
    expect(rec).toHaveLength(1);
    expect(rec[0].passo).toBe(3);
  });

  it('com a tela nova e confiança mínima menor: segue sozinho e agenda', async () => {
    await demo({ tela_agendamento_v2: true });
    const { p } = pedido(
      'agendar_visita',
      { cliente: 'ACME Log Ltda', data: diaUtil(11), horario: '11:00', tecnico: 'Primeiro disponível' },
      { confiancaMinima: 0.5 },
    );
    const r = await navegador.executar(p);
    expect(r).toMatchObject({ ok: true, recuperacoes: 2 });
    if (!r.ok) return;
    expect(r.gerados.protocolo).toMatch(/^VT-\d{4}-\d{4}$/);
  });
});

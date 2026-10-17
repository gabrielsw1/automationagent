// Dados de exemplo: números do painel e da lista de tarefas iguais aos do design, e a numeração
// das execuções reais continuando depois das de exemplo.
import { afterEach, describe, expect, it } from 'vitest';
import { semear } from '../../src/seed/index.ts';
import { criarAmbiente, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

async function entrar(a: Ambiente): Promise<string> {
  const r = await a.app.inject({
    method: 'POST',
    url: '/api/console/auth/entrar',
    payload: { email: 'rafael.lima@seusistema.com.br', senha: 'copiloto123' },
  });
  expect(r.statusCode).toBe(200);
  return String(r.headers['set-cookie']).split(';')[0];
}

describe('seed', () => {
  it('grava 1.284 execuções com as taxas do design e o login de exemplo funciona', async () => {
    amb = await criarAmbiente();
    const r = semear(amb.ctx);
    expect(r.tarefas).toBe(6);
    const cookie = await entrar(amb);

    const painel = (await amb.app.inject({ method: 'GET', url: '/api/console/painel?periodo=30d', headers: { cookie } })).json();
    expect(painel.executadas).toBe(1284);
    expect(Math.round(painel.taxaSucesso * 1000) / 10).toBe(96.2);
    // "+12% vs. período anterior", como no design.
    expect(Math.round(painel.variacao * 100)).toBe(12);

    const lista = (await amb.app.inject({ method: 'GET', url: '/api/console/tarefas', headers: { cookie } })).json();
    const porSlug = Object.fromEntries(lista.tarefas.map((t: { slug: string }) => [t.slug, t]));
    expect(porSlug.cadastrar_cliente.execucoes30d).toBe(412);
    expect(Math.round(porSlug.cadastrar_cliente.sucesso30d * 1000) / 10).toBe(98.1);
    expect(Math.round(porSlug.agendar_visita.sucesso30d * 1000) / 10).toBe(88.2);
    expect(porSlug.agendar_visita.falhasHoje).toBe(2);
    expect(lista.contagem).toMatchObject({ todas: 6, ativa: 4, teste: 1, rascunho: 1 });
    expect(lista.semTarefa[0]).toMatchObject({ tema: 'cancelar assinatura', quantidade: 14 });

    const detalhe = (await amb.app.inject({ method: 'GET', url: '/api/console/execucoes/EX-20417', headers: { cookie } })).json();
    expect(detalhe.diagnostico.titulo).toBe('A tela de agendamento mudou e nada foi gravado.');
    expect(detalhe.linha.transferidaPara).toBe('Camila Souza');
    expect(detalhe.conversa.length).toBeGreaterThanOrEqual(4);

    expect(amb.ctx.banco.proximo('execucao', 1)).toBe(20432);
  });
});

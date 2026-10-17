import { afterEach, describe, expect, it } from 'vitest';
import type { Canais, ConfigWidget } from '@copiloto/shared';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

async function pedir(a: Ambiente, cookie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  return a.app.inject({ method, url: `/api/console${url}`, headers: { cookie }, payload: payload as object });
}

describe('canais e widget', () => {
  it('mostra a configuração publicada, o rascunho, a chave e o endereço do script', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'leitor');
    const r = await pedir(amb, cookie, 'GET', '/canais');
    expect(r.statusCode).toBe(200);
    const c = r.json<Canais>();
    expect(c.temAlteracoes).toBe(false);
    expect(c.publicada).toEqual(c.rascunho);
    expect(c.publicada.nome).toBe('Copiloto');
    expect(c.chavePublica).toBe(amb.ctx.configuracoes.ler('widget_chave_publica'));
    expect(c.urlScript).toBe(`${amb.config.urlPublica}/copiloto.js`);
    expect(c.instalacao).toBeNull();

    amb.ctx.configuracoes.gravar('widget_instalacao', { origem: 'app.horizonte.com.br', vistoEm: '2026-10-17T13:00:00.000Z' }, null);
    const depois = (await pedir(amb, cookie, 'GET', '/canais')).json<Canais>();
    expect(depois.instalacao).toEqual({ origem: 'app.horizonte.com.br', vistoEm: '2026-10-17T13:00:00.000Z' });
  });

  it('só quem edita salva o rascunho; publicar e descartar', async () => {
    amb = await criarAmbiente();
    const leitor = entrarComo(amb.ctx, 'leitor');
    const suporte = entrarComo(amb.ctx, 'suporte');
    const { cookie } = entrarComo(amb.ctx, 'editor', 'Júlia Martins');
    const atual = (await pedir(amb, cookie, 'GET', '/canais')).json<Canais>();
    const nova: ConfigWidget = {
      ...atual.rascunho,
      nome: 'Assistente Horizonte',
      sugestoes: ['Cadastrar cliente'],
      dominios: ['https://App.Horizonte.com.br/clientes', 'app.horizonte.com.br', 'localhost:4000'],
    };
    expect((await pedir(amb, leitor.cookie, 'PUT', '/canais/rascunho', { config: nova })).statusCode).toBe(403);
    expect((await pedir(amb, suporte.cookie, 'PUT', '/canais/rascunho', { config: nova })).statusCode).toBe(403);

    const salvo = await pedir(amb, cookie, 'PUT', '/canais/rascunho', { config: nova });
    expect(salvo.statusCode).toBe(200);
    const c = salvo.json<Canais>();
    expect(c.temAlteracoes).toBe(true);
    expect(c.rascunho.nome).toBe('Assistente Horizonte');
    expect(c.rascunho.dominios).toEqual(['app.horizonte.com.br', 'localhost:4000']);
    expect(c.publicada.nome).toBe('Copiloto');

    // Salvar de novo enquanto digita não enche o registro de auditoria.
    await pedir(amb, cookie, 'PUT', '/canais/rascunho', { config: { ...nova, nome: 'Assistente' } });
    const registros = amb.ctx.auditoria.listar().filter((a) => a.acao === 'editou o rascunho do widget');
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ ator: 'Júlia Martins', detalhe: 'Mudou nome, sugestões, domínios' });

    const pub = (await pedir(amb, cookie, 'POST', '/canais/publicar')).json<Canais>();
    expect(pub.temAlteracoes).toBe(false);
    expect(pub.publicada.nome).toBe('Assistente');
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'publicou a configuração do widget' });

    await pedir(amb, cookie, 'PUT', '/canais/rascunho', { config: { ...pub.rascunho, cor: '#123456' } });
    const desc = (await pedir(amb, cookie, 'POST', '/canais/descartar')).json<Canais>();
    expect(desc.temAlteracoes).toBe(false);
    expect(desc.rascunho.cor).toBe(pub.publicada.cor);
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'descartou as alterações do widget' });
    expect((await pedir(amb, leitor.cookie, 'POST', '/canais/publicar')).statusCode).toBe(403);
  });

  it('valida a configuração com mensagens em português', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const base = (await pedir(amb, cookie, 'GET', '/canais')).json<Canais>().rascunho;
    const erro = async (config: unknown) => {
      const r = await pedir(amb!, cookie, 'PUT', '/canais/rascunho', { config });
      expect(r.statusCode).toBe(400);
      return r.json().mensagem as string;
    };
    expect(await erro({ ...base, boasVindas: 'a'.repeat(281) })).toBe('A mensagem de boas-vindas pode ter até 280 caracteres.');
    expect(await erro({ ...base, sugestoes: ['a', 'b', 'c', 'd', 'e'] })).toBe('Use no máximo 4 sugestões.');
    expect(await erro({ ...base, cor: 'rosa' })).toBe('Use a cor no formato #RRGGBB.');
    expect(await erro({ ...base, nome: '  ' })).toBe('Dê um nome ao assistente.');
    expect(await erro({ ...base, dominios: ['não é domínio'] })).toContain('não parece um domínio');
    expect(await erro({ ...base, proativa: { ativa: true, segundosParado: 20 } })).toBeTruthy();
  });
});

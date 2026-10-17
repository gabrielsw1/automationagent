import { afterEach, describe, expect, it } from 'vitest';
import { criarAmbiente, entrarComo, type Ambiente } from './ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

describe('servidor', () => {
  it('responde a saúde em modo simulado', async () => {
    amb = await criarAmbiente();
    const r = await amb.app.inject({ method: 'GET', url: '/api/saude' });
    expect(r.statusCode).toBe(200);
    // urlConsole: a extensão do navegador abre o "Aprender fluxo" por aqui.
    expect(r.json()).toMatchObject({ ok: true, modoSimulado: true, sistema: 'Copiloto', urlConsole: amb.config.urlConsole });
  });

  it('exige sessão no console e devolve o resumo para quem entrou', async () => {
    amb = await criarAmbiente();
    const sem = await amb.app.inject({ method: 'GET', url: '/api/console/resumo' });
    expect(sem.statusCode).toBe(401);
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const com = await amb.app.inject({ method: 'GET', url: '/api/console/resumo', headers: { cookie } });
    expect(com.statusCode).toBe(200);
    expect(com.json()).toMatchObject({ eu: { perfil: 'admin' }, modoSimulado: true, nomeSistema: 'Horizonte' });
  });

  it('entra com e-mail e senha', async () => {
    amb = await criarAmbiente();
    entrarComo(amb.ctx, 'editor');
    const email = amb.ctx.banco.um<{ email: string }>('SELECT email FROM equipe')!.email;
    const errado = await amb.app.inject({ method: 'POST', url: '/api/console/auth/entrar', payload: { email, senha: 'x' } });
    expect(errado.statusCode).toBe(401);
    const certo = await amb.app.inject({
      method: 'POST',
      url: '/api/console/auth/entrar',
      payload: { email, senha: 'copiloto123' },
    });
    expect(certo.statusCode).toBe(200);
    expect(certo.headers['set-cookie']).toContain('copiloto_sessao=');
  });
});

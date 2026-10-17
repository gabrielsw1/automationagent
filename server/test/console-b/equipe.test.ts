import { afterEach, describe, expect, it } from 'vitest';
import type { Limites, MembroEquipe, RegistroAuditoria, Seguranca } from '@copiloto/shared';
import { criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';
import { criarExecucao } from './dados.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

async function pedir(
  a: Ambiente,
  cookie: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return a.app.inject({ method, url: `/api/console${url}`, headers: { cookie }, payload: payload as object });
}

describe('equipe', () => {
  it('lista a equipe para qualquer perfil, admins primeiro e convites no fim', async () => {
    amb = await criarAmbiente();
    const leitor = entrarComo(amb.ctx, 'leitor', 'Bruno Costa');
    entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const admin = entrarComo(amb.ctx, 'admin', 'Júlia Martins');
    await pedir(amb, admin.cookie, 'POST', '/equipe/convites', { email: 'leticia.prado@seusistema.com.br', perfil: 'suporte' });
    const r = await pedir(amb, leitor.cookie, 'GET', '/equipe');
    expect(r.statusCode).toBe(200);
    const lista = r.json<MembroEquipe[]>();
    expect(lista.map((m) => m.nome ?? m.email)).toEqual([
      'Rafael Lima',
      'Júlia Martins',
      'Bruno Costa',
      'leticia.prado@seusistema.com.br',
    ]);
    expect(lista[3]).toMatchObject({ status: 'convidado', perfil: 'suporte' });
    expect(lista[3].conviteExpiraEm).toBeTruthy();
    expect(lista[0].conviteExpiraEm).toBeUndefined();
  });

  it('convida com link de 7 dias que funciona na tela de convite', async () => {
    amb = await criarAmbiente();
    const suporte = entrarComo(amb.ctx, 'suporte');
    const { cookie } = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const corpo = { email: '  Leticia.Prado@SeuSistema.com.br ', perfil: 'suporte' };
    expect((await pedir(amb, suporte.cookie, 'POST', '/equipe/convites', corpo)).statusCode).toBe(403);
    const ruim = await pedir(amb, cookie, 'POST', '/equipe/convites', { email: 'leticia@', perfil: 'suporte' });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().mensagem).toBe('Digite um e-mail válido, por exemplo nome@empresa.com.br.');
    expect((await pedir(amb, cookie, 'POST', '/equipe/convites', { email: 'a@b.com', perfil: 'chefe' })).statusCode).toBe(400);

    const r = await pedir(amb, cookie, 'POST', '/equipe/convites', corpo);
    expect(r.statusCode).toBe(200);
    const { membro, linkConvite } = r.json<{ membro: MembroEquipe; linkConvite: string }>();
    expect(membro).toMatchObject({ email: 'leticia.prado@seusistema.com.br', status: 'convidado', perfil: 'suporte', nome: null });
    expect(linkConvite.startsWith(`${amb.config.urlConsole}/convite/`)).toBe(true);
    const dias = (Date.parse(membro.conviteExpiraEm!) - Date.parse(membro.conviteEnviadoEm!)) / 86400_000;
    expect(dias).toBeCloseTo(7, 5);
    const token = linkConvite.split('/convite/')[1];
    const aberto = await amb.app.inject({ method: 'GET', url: `/api/console/auth/convite/${token}` });
    expect(aberto.statusCode).toBe(200);
    expect(aberto.json()).toEqual({ email: 'leticia.prado@seusistema.com.br', perfil: 'suporte', empresa: 'Horizonte', contaExistente: false });
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Rafael Lima', acao: 'convidou', alvo: 'leticia.prado@seusistema.com.br', detalhe: 'Perfil Suporte' });

    // Repetido: convite pendente ou pessoa já na equipe.
    expect((await pedir(amb, cookie, 'POST', '/equipe/convites', corpo)).statusCode).toBe(409);
    const email = amb.ctx.banco.um<{ email: string }>("SELECT email FROM equipe WHERE perfil = 'suporte' AND status = 'ativo'")!.email;
    const ja = await pedir(amb, cookie, 'POST', '/equipe/convites', { email, perfil: 'leitor' });
    expect(ja.statusCode).toBe(409);
    expect(ja.json().mensagem).toContain('já está na equipe');
  });

  it('reenviar gera link novo e invalida o anterior', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'admin');
    const primeiro = (await pedir(amb, cookie, 'POST', '/equipe/convites', { email: 'x@empresa.com.br', perfil: 'leitor' })).json();
    const r = await pedir(amb, cookie, 'POST', `/equipe/${primeiro.membro.id}/reenviar`);
    expect(r.statusCode).toBe(200);
    expect(r.json().linkConvite).not.toBe(primeiro.linkConvite);
    const antigo = primeiro.linkConvite.split('/convite/')[1];
    expect((await amb.app.inject({ method: 'GET', url: `/api/console/auth/convite/${antigo}` })).statusCode).toBe(404);
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'reenviou o convite' });
    const ativo = entrarComo(amb.ctx, 'leitor');
    expect((await pedir(amb, cookie, 'POST', `/equipe/${ativo.membroId}/reenviar`)).statusCode).toBe(409);
    expect((await pedir(amb, cookie, 'POST', '/equipe/mbr_x/reenviar')).statusCode).toBe(404);
  });

  it('protege o único admin e permite trocar perfis', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const julia = entrarComo(amb.ctx, 'editor', 'Júlia Martins');
    // Convite de admin não conta como admin.
    await pedir(amb, rafael.cookie, 'POST', '/equipe/convites', { email: 'novo@empresa.com.br', perfil: 'admin' });

    const rebaixar = await pedir(amb, rafael.cookie, 'PUT', `/equipe/${rafael.membroId}/perfil`, { perfil: 'editor' });
    expect(rebaixar.statusCode).toBe(409);
    expect(rebaixar.json().mensagem).toContain('único admin');

    const promover = await pedir(amb, rafael.cookie, 'PUT', `/equipe/${julia.membroId}/perfil`, { perfil: 'admin' });
    expect(promover.statusCode).toBe(200);
    expect(promover.json()).toMatchObject({ perfil: 'admin', nome: 'Júlia Martins' });
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'mudou o perfil', alvo: 'Júlia Martins', detalhe: 'De Editor de tarefas para Admin' });

    // Com dois admins, um pode ser rebaixado.
    const agora = await pedir(amb, julia.cookie, 'PUT', `/equipe/${rafael.membroId}/perfil`, { perfil: 'suporte' });
    expect(agora.statusCode).toBe(200);
    // Rafael (agora suporte) não administra mais.
    expect((await pedir(amb, rafael.cookie, 'PUT', `/equipe/${julia.membroId}/perfil`, { perfil: 'leitor' })).statusCode).toBe(403);
    expect((await pedir(amb, julia.cookie, 'PUT', `/equipe/${julia.membroId}/perfil`, { perfil: 'leitor' })).statusCode).toBe(409);
  });

  it('remove membros e cancela convites, mas não o único admin nem a si mesmo', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const bruno = entrarComo(amb.ctx, 'leitor', 'Bruno Costa');
    const convite = (await pedir(amb, rafael.cookie, 'POST', '/equipe/convites', { email: 'c@empresa.com.br', perfil: 'suporte' })).json();

    expect((await pedir(amb, bruno.cookie, 'DELETE', `/equipe/${rafael.membroId}`)).statusCode).toBe(403);
    const si = await pedir(amb, rafael.cookie, 'DELETE', `/equipe/${rafael.membroId}`);
    expect(si.statusCode).toBe(409);

    const outroAdmin = entrarComo(amb.ctx, 'admin', 'Júlia Martins');
    // Rafael é removido por Júlia; depois Júlia é a única admin e não pode ser removida.
    expect((await pedir(amb, outroAdmin.cookie, 'DELETE', `/equipe/${rafael.membroId}`)).statusCode).toBe(200);
    const unico = entrarComo(amb.ctx, 'admin', 'Outro Admin');
    amb.ctx.banco.executar("UPDATE equipe SET perfil = 'leitor' WHERE id = ?", unico.membroId);
    const r = await pedir(amb, outroAdmin.cookie, 'DELETE', `/equipe/${outroAdmin.membroId}`);
    expect(r.statusCode).toBe(409);

    expect((await pedir(amb, outroAdmin.cookie, 'DELETE', `/equipe/${bruno.membroId}`)).statusCode).toBe(200);
    expect((await pedir(amb, outroAdmin.cookie, 'DELETE', `/equipe/${convite.membro.id}`)).statusCode).toBe(200);
    const restantes = (await pedir(amb, outroAdmin.cookie, 'GET', '/equipe')).json<MembroEquipe[]>().map((m) => m.nome);
    expect(restantes).toEqual(['Júlia Martins', 'Outro Admin']);
    const acoes = amb.ctx.auditoria.listar().map((a) => a.acao);
    expect(acoes.slice(0, 3)).toEqual(['cancelou o convite', 'removeu da equipe', 'removeu da equipe']);
    // Sessão do removido deixa de valer.
    expect((await pedir(amb, bruno.cookie, 'GET', '/equipe')).statusCode).toBe(401);
  });
});

describe('limites de gasto', () => {
  it('só Admin vê e muda, com validação e registro', async () => {
    amb = await criarAmbiente();
    const editor = entrarComo(amb.ctx, 'editor');
    const { cookie } = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    criarExecucao(amb.ctx, { custo_navegador: 12.5, custo_modelo: 0 });
    expect((await pedir(amb, editor.cookie, 'GET', '/limites')).statusCode).toBe(403);
    const r = await pedir(amb, cookie, 'GET', '/limites');
    expect(r.statusCode).toBe(200);
    const l = r.json<Limites>();
    expect(l).toMatchObject({ mensal: 1500, porUsuarioDia: 50, alerta80: true, aoAtingir: 'pausar_navegador', usoMes: 12.5 });
    expect(l.previsaoMes).toBeGreaterThanOrEqual(12.5);
    expect(Date.parse(l.renovaEm)).toBeGreaterThan(Date.now());

    const novo = { mensal: 2000, porUsuarioDia: 30, alerta80: false, aoAtingir: 'pausar_tudo' };
    expect((await pedir(amb, editor.cookie, 'PUT', '/limites', novo)).statusCode).toBe(403);
    const ruins = [
      { ...novo, mensal: -1 },
      { ...novo, porUsuarioDia: 0 },
      { ...novo, porUsuarioDia: 2.5 },
      { ...novo, aoAtingir: 'nada' },
      { ...novo, mensal: '2000' },
    ];
    for (const ruim of ruins) expect((await pedir(amb, cookie, 'PUT', '/limites', ruim)).statusCode).toBe(400);
    const salvo = await pedir(amb, cookie, 'PUT', '/limites', novo);
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json<Limites>()).toMatchObject({ ...novo, atualizadoPor: 'Rafael Lima' });
    const reg = amb.ctx.auditoria.listar()[0];
    expect(reg).toMatchObject({ acao: 'alterou os limites de gasto' });
    expect(reg.detalhe).toContain('Limite mensal de R$');
    expect(reg.detalhe).toContain('pausar tudo');
  });
});

describe('segurança e dados', () => {
  it('lê, valida e grava com registro', async () => {
    amb = await criarAmbiente();
    const leitor = entrarComo(amb.ctx, 'leitor');
    const { cookie } = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const s = (await pedir(amb, leitor.cookie, 'GET', '/seguranca')).json<Seguranca>();
    expect(s).toEqual({ mascararPrints: true, retencaoPrintsDias: 90, retencaoConversasMeses: 12, atualizadoPor: null, atualizadoEm: null });
    const novo = { mascararPrints: false, retencaoPrintsDias: 30, retencaoConversasMeses: 24 };
    expect((await pedir(amb, leitor.cookie, 'PUT', '/seguranca', novo)).statusCode).toBe(403);
    expect((await pedir(amb, cookie, 'PUT', '/seguranca', { ...novo, retencaoPrintsDias: 45 })).statusCode).toBe(400);
    const r = await pedir(amb, cookie, 'PUT', '/seguranca', novo);
    expect(r.statusCode).toBe(200);
    expect(r.json<Seguranca>()).toMatchObject({ ...novo, atualizadoPor: 'Rafael Lima' });
    expect(amb.ctx.auditoria.listar()[0].detalhe).toBe(
      'Desligou a máscara de dados nos prints; Prints guardados por 30 dias (antes 90); Conversas guardadas por 24 meses (antes 12)',
    );
  });
});

describe('registro de auditoria', () => {
  it('só Admin vê, do mais novo para o mais antigo, com paginação por data', async () => {
    amb = await criarAmbiente();
    const editor = entrarComo(amb.ctx, 'editor');
    const { cookie } = entrarComo(amb.ctx, 'admin');
    for (let i = 0; i < 60; i++) {
      amb.ctx.banco.inserir('auditoria', {
        id: `aud_${i}`,
        ts: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
        ator: 'Rafael Lima',
        acao: 'testou',
        alvo: `item ${i}`,
      });
    }
    expect((await pedir(amb, editor.cookie, 'GET', '/auditoria')).statusCode).toBe(403);
    const p1 = (await pedir(amb, cookie, 'GET', '/auditoria')).json<RegistroAuditoria[]>();
    expect(p1).toHaveLength(50);
    expect(p1[0].alvo).toBe('item 59');
    const p2 = (await pedir(amb, cookie, 'GET', `/auditoria?antes=${encodeURIComponent(p1[49].ts)}`)).json<RegistroAuditoria[]>();
    expect(p2.map((a) => a.alvo)).toEqual(Array.from({ length: 10 }, (_, i) => `item ${9 - i}`));
  });
});

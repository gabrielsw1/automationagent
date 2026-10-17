// Fluxos de acesso das telas A1 a A6: entrar (com bloqueio), escolher a empresa, confirmar o e-mail
// do cadastro com o código, senha nova pelo link e aceitar convite. Os e-mails ficam na caixa em
// memória do ambiente de teste.
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfirmacaoEmail, ConviteAberto, Entrada, Eu, LinkSenhaAberto, PedidoSenhaNova } from '@copiloto/shared';
import { codigoEnviado, criarAmbiente, entrarComo, ultimoEmail, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

const LUANA = { nome: 'Luana Freitas', email: 'luana@pedrabranca.com.br', senha: 'senha-forte-1' };
const CADASTRO = {
  empresa: { nome: 'Pedra Branca Distribuidora' },
  pessoa: LUANA,
  aceites: { termos: true, dados: true },
};

function cookieDe(r: { headers: Record<string, unknown> }): string {
  return String(r.headers['set-cookie']).split(';')[0];
}

function api(a: Ambiente, metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, cookie?: string) {
  return a.app.inject({ method: metodo, url: `/api/console${url}`, payload, headers: cookie ? { cookie } : {} });
}

const entrar = (a: Ambiente, email: string, senha: string) => api(a, 'POST', '/auth/entrar', { email, senha });

describe('confirmar o e-mail do cadastro (A5)', () => {
  it('o cadastro manda o código; até confirmar, o console só abre as rotas de acesso', async () => {
    amb = await criarAmbiente();
    const r = await api(amb, 'POST', '/auth/cadastro', CADASTRO);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Eu>()).toMatchObject({ emailConfirmado: false, perfil: 'admin' });
    const cookie = cookieDe(r);

    const email = ultimoEmail(amb, LUANA.email)!;
    expect(email.assunto).toBe('Seu código do Copiloto Starta');
    expect(email.texto).toContain('Olá, Luana.');
    expect(email.texto).toContain('Ele vale por 10 minutos.');
    const codigo = codigoEnviado(amb, LUANA.email)!;
    expect(codigo).toMatch(/^\d{6}$/);

    // Sem confirmar, nada do console responde.
    const bloqueado = await api(amb, 'GET', '/fluxos', undefined, cookie);
    expect(bloqueado.statusCode).toBe(403);
    expect(bloqueado.json()).toMatchObject({ erro: 'email_nao_confirmado' });

    const tela = (await api(amb, 'GET', '/auth/email', undefined, cookie)).json<ConfirmacaoEmail>();
    expect(tela).toMatchObject({ email: LUANA.email, envio: 'caixa_local' });
    expect(tela.reenviarEmS).toBeGreaterThan(40);
    expect(Date.parse(tela.expiraEm!) - Date.now()).toBeGreaterThan(9 * 60_000);

    // Código errado: diz quantas tentativas restam.
    const errado = await api(amb, 'POST', '/auth/email/confirmar', { codigo: codigo === '000000' ? '111111' : '000000' }, cookie);
    expect(errado.statusCode).toBe(400);
    expect(errado.json()).toEqual({ erro: 'codigo_incorreto', mensagem: 'Código incorreto. Restam 4 tentativas.', restantes: 4 });
    expect((await api(amb, 'POST', '/auth/email/confirmar', { codigo: '12a' }, cookie)).statusCode).toBe(400);

    // Reenviar só depois de 45 s.
    const cedo = await api(amb, 'POST', '/auth/email/reenviar', undefined, cookie);
    expect(cedo.statusCode).toBe(429);
    expect(cedo.json().aguardarS).toBeGreaterThan(0);

    const certo = await api(amb, 'POST', '/auth/email/confirmar', { codigo }, cookie);
    expect(certo.statusCode, certo.body).toBe(200);
    expect(certo.json<Eu>()).toMatchObject({ emailConfirmado: true, empresa: { nome: 'Pedra Branca Distribuidora' } });
    expect((await api(amb, 'GET', '/fluxos', undefined, cookie)).statusCode).toBe(200);
    // O mesmo código não vale de novo, mas a conta já confirmada segue em frente.
    expect((await api(amb, 'POST', '/auth/email/confirmar', { codigo }, cookie)).statusCode).toBe(200);
  });

  it('5 códigos errados ou o prazo vencido pedem outro; "Trocar e-mail" corrige o endereço', async () => {
    amb = await criarAmbiente();
    const cookie = cookieDe(await api(amb, 'POST', '/auth/cadastro', CADASTRO));
    const conta = amb.plataforma.conta(LUANA.email)!;
    const certo = codigoEnviado(amb, LUANA.email)!;
    const errado = certo === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 1; i--) {
      const r = await api(amb, 'POST', '/auth/email/confirmar', { codigo: errado }, cookie);
      expect(r.json().restantes).toBe(i);
    }
    expect((await api(amb, 'POST', '/auth/email/confirmar', { codigo: errado }, cookie)).json().erro).toBe('codigo_expirado');
    expect((await api(amb, 'POST', '/auth/email/confirmar', { codigo: certo }, cookie)).statusCode).toBe(410);

    // Passados os 45 s, outro código sai e o anterior deixa de valer.
    amb.plataforma.banco.executar('UPDATE codigos_email SET enviado_em = ? WHERE conta_id = ?', new Date(Date.now() - 60_000).toISOString(), conta.id);
    const reenvio = await api(amb, 'POST', '/auth/email/reenviar', undefined, cookie);
    expect(reenvio.statusCode, reenvio.body).toBe(200);
    expect(amb.correio.enviados.filter((e) => e.para === LUANA.email)).toHaveLength(2);
    amb.plataforma.banco.executar('UPDATE codigos_email SET expira_em = ? WHERE conta_id = ?', new Date(Date.now() - 1000).toISOString(), conta.id);
    const vencido = await api(amb, 'POST', '/auth/email/confirmar', { codigo: codigoEnviado(amb, LUANA.email) }, cookie);
    expect(vencido.statusCode).toBe(410);
    expect(vencido.json().mensagem).toBe('Este código expirou. Cada código vale por 10 minutos. Peça outro e use o mais recente.');

    // E-mail digitado errado: troca, chega um código no novo, e a conta passa a ser dele.
    expect((await api(amb, 'POST', '/auth/email/trocar', { email: 'luana@gmail.com' }, cookie)).statusCode).toBe(400);
    entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    expect((await api(amb, 'POST', '/auth/email/trocar', { email: 'rafael@horizonte.com.br' }, cookie)).statusCode).toBe(409);
    const trocado = await api(amb, 'POST', '/auth/email/trocar', { email: 'luana.freitas@pedrabranca.com.br' }, cookie);
    expect(trocado.statusCode, trocado.body).toBe(200);
    expect(trocado.json<ConfirmacaoEmail>().email).toBe('luana.freitas@pedrabranca.com.br');
    const novo = codigoEnviado(amb, 'luana.freitas@pedrabranca.com.br')!;
    const ok = await api(amb, 'POST', '/auth/email/confirmar', { codigo: novo }, cookie);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<Eu>()).toMatchObject({ email: 'luana.freitas@pedrabranca.com.br', emailConfirmado: true, perfil: 'admin' });
    expect(amb.plataforma.conta(LUANA.email)).toBeUndefined();
    expect((await entrar(amb, 'luana.freitas@pedrabranca.com.br', LUANA.senha)).json<Entrada>().eu?.empresa.nome).toBe('Pedra Branca Distribuidora');
  });
});

describe('entrar (A1) e escolher a empresa (A2)', () => {
  it('5 senhas erradas seguidas bloqueiam por 15 minutos, mesmo com a senha certa', async () => {
    amb = await criarAmbiente();
    const { email } = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    for (let i = 0; i < 4; i++) {
      const r = await entrar(amb, email, 'errada-123');
      expect(r.statusCode).toBe(401);
      expect(r.json().mensagem).toBe('E-mail ou senha incorretos. Confira e tente de novo.');
    }
    const quinta = await entrar(amb, email, 'errada-123');
    expect(quinta.statusCode).toBe(423);
    expect(quinta.json().mensagem).toBe('Por segurança, o acesso ficou bloqueado por 15 minutos.');
    const minutos = (Date.parse(quinta.json().ate) - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);
    expect((await entrar(amb, email, 'copiloto123')).statusCode).toBe(423);
    // E-mail sem conta responde igual a senha errada.
    expect((await entrar(amb, 'ninguem@horizonte.com.br', 'copiloto123')).statusCode).toBe(401);

    // Passado o bloqueio, a senha certa entra e zera a contagem.
    amb.plataforma.banco.executar('UPDATE contas SET bloqueada_ate = ? WHERE email = ?', new Date(Date.now() - 1000).toISOString(), email);
    const certo = await entrar(amb, email, 'copiloto123');
    expect(certo.statusCode).toBe(200);
    expect(certo.json<Entrada>().eu?.empresa.nome).toBe('Horizonte');
    expect((await entrar(amb, email, 'errada-123')).statusCode).toBe(401);
  });

  it('com várias empresas, abre a última usada e lista as outras; avisa quando o acesso foi removido', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const cadastro = await api(amb, 'POST', '/auth/cadastro', { empresa: { nome: 'Pedra Branca' }, aceites: CADASTRO.aceites }, rafael.cookie);
    expect(cadastro.statusCode, cadastro.body).toBe(200);
    const pedraId = cadastro.json<Eu>().empresa.id;

    const entrada = (await entrar(amb, rafael.email, 'copiloto123')).json<Entrada>();
    expect(entrada.eu?.empresa.id).toBe(pedraId);
    expect(entrada.empresas.map((e) => [e.nome, e.perfil, e.iniciais, e.demo])).toEqual([
      ['Pedra Branca', 'admin', 'PB', false],
      ['Horizonte', 'admin', 'H', true],
    ]);
    expect(entrada.empresas.every((e) => e.ultimoAcesso)).toBe(true);
    expect(entrada.avisos).toEqual([]);

    // Outro Admin do Horizonte tira o Rafael da equipe: na próxima entrada, o aviso aparece uma vez.
    const julia = entrarComo(amb.ctx, 'admin', 'Júlia Martins');
    const membro = amb.ctx.banco.um<{ id: string }>('SELECT id FROM equipe WHERE email = ?', rafael.email)!;
    expect((await api(amb, 'DELETE', `/equipe/${membro.id}`, undefined, julia.cookie)).statusCode).toBe(200);
    const depois = (await entrar(amb, rafael.email, 'copiloto123')).json<Entrada>();
    expect(depois.empresas.map((e) => e.nome)).toEqual(['Pedra Branca']);
    expect(depois.avisos).toEqual(['Seu acesso à Horizonte foi removido por um Admin dessa empresa.']);
    const login = await entrar(amb, rafael.email, 'copiloto123');
    expect((await api(amb, 'GET', '/auth/empresas', undefined, cookieDe(login))).json()).toEqual({ empresas: depois.empresas.map((e) => ({ ...e, ultimoAcesso: expect.any(String) })), avisos: [] });
  });

  it('conta sem nenhuma empresa ativa confere a senha mas não abre sessão', async () => {
    amb = await criarAmbiente();
    amb.plataforma.criarConta({ email: 'solta@empresa.com.br', nome: 'Pessoa Solta', senha: 'senha-forte-1' });
    const r = await entrar(amb, 'solta@empresa.com.br', 'senha-forte-1');
    expect(r.statusCode).toBe(200);
    expect(r.json<Entrada>()).toEqual({ eu: null, empresas: [], avisos: [] });
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});

describe('senha nova (A3 e A4)', () => {
  it('o link chega por e-mail, vale uma vez, troca a senha, destrava e pode encerrar as outras sessões', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');

    // Mesmo retorno com ou sem conta, para ninguém descobrir quem tem acesso.
    const semConta = await api(amb, 'POST', '/auth/senha/esqueci', { email: 'ninguem@horizonte.com.br' });
    expect(semConta.json<PedidoSenhaNova>()).toEqual({ ok: true, reenviarEmS: 60, envio: 'caixa_local' });
    expect(ultimoEmail(amb, 'ninguem@horizonte.com.br')).toBeUndefined();
    const pedido = await api(amb, 'POST', '/auth/senha/esqueci', { email: 'Rafael@Horizonte.com.br ' });
    expect(pedido.json<PedidoSenhaNova>()).toEqual({ ok: true, reenviarEmS: 60, envio: 'caixa_local' });
    const email = ultimoEmail(amb, rafael.email)!;
    expect(email.assunto).toBe('Crie uma senha nova no Copiloto Starta');
    const link = email.texto.match(/https?:\/\/\S+\/senha-nova\/(\S+)/)!;
    expect(link[0].startsWith(`${amb.config.urlConsole}/senha-nova/`)).toBe(true);
    const token = link[1];

    // Pedir de novo antes de 60 s não manda outro e diz quanto falta.
    const cedo = (await api(amb, 'POST', '/auth/senha/esqueci', { email: rafael.email })).json<PedidoSenhaNova>();
    expect(cedo.reenviarEmS).toBeLessThanOrEqual(60);
    expect(amb.correio.enviados.filter((e) => e.para === rafael.email)).toHaveLength(1);

    const aberto = await api(amb, 'GET', `/auth/senha/${token}`);
    expect(aberto.json<LinkSenhaAberto>().email).toBe(rafael.email);
    expect((await api(amb, 'GET', '/auth/senha/token-inventado')).statusCode).toBe(410);

    // Bloqueado por senhas erradas: o link destrava.
    for (let i = 0; i < 5; i++) await entrar(amb, rafael.email, 'errada-123');
    expect((await entrar(amb, rafael.email, 'copiloto123')).statusCode).toBe(423);

    expect((await api(amb, 'POST', `/auth/senha/${token}`, { senha: 'curta' })).json().mensagem).toBe('A senha precisa de pelo menos 8 caracteres.');
    const salvo = await api(amb, 'POST', `/auth/senha/${token}`, { senha: 'nova-senha-2026', sairDosOutros: true });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(salvo.json<Entrada>().eu).toMatchObject({ email: rafael.email, empresa: { nome: 'Horizonte' } });
    expect((await api(amb, 'GET', '/auth/eu', undefined, cookieDe(salvo))).statusCode).toBe(200);
    // A sessão antiga caiu; o link não vale de novo; só a senha nova entra.
    expect((await api(amb, 'GET', '/auth/eu', undefined, rafael.cookie)).statusCode).toBe(401);
    const usado = await api(amb, 'POST', `/auth/senha/${token}`, { senha: 'outra-senha-9' });
    expect(usado.statusCode).toBe(410);
    expect(usado.json().mensagem).toBe('Este link expirou ou já foi usado.');
    expect((await entrar(amb, rafael.email, 'copiloto123')).statusCode).toBe(401);
    expect((await entrar(amb, rafael.email, 'nova-senha-2026')).statusCode).toBe(200);
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'criou uma senha nova', detalhe: 'Saiu dos outros aparelhos' });
  });

  it('link vencido não abre, e sem "sair dos outros" as sessões continuam', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    await api(amb, 'POST', '/auth/senha/esqueci', { email: rafael.email });
    const token = ultimoEmail(amb, rafael.email)!.texto.match(/\/senha-nova\/(\S+)/)![1];
    amb.plataforma.banco.executar('UPDATE links_senha SET expira_em = ?', new Date(Date.now() - 1000).toISOString());
    expect((await api(amb, 'GET', `/auth/senha/${token}`)).statusCode).toBe(410);

    amb.plataforma.banco.executar('UPDATE links_senha SET criado_em = ?', new Date(Date.now() - 120_000).toISOString());
    await api(amb, 'POST', '/auth/senha/esqueci', { email: rafael.email });
    const outro = ultimoEmail(amb, rafael.email)!.texto.match(/\/senha-nova\/(\S+)/)![1];
    expect(outro).not.toBe(token);
    const salvo = await api(amb, 'POST', `/auth/senha/${outro}`, { senha: 'nova-senha-2026', sairDosOutros: false });
    expect(salvo.statusCode).toBe(200);
    expect((await api(amb, 'GET', '/auth/eu', undefined, rafael.cookie)).statusCode).toBe(200);
  });
});

describe('aceitar convite (A6)', () => {
  it('e-mail novo cria a conta já confirmada; vencido diz quem pode reenviar', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const { linkConvite } = (await api(amb, 'POST', '/equipe/convites', { email: 'ana@horizonte.com.br', perfil: 'editor' }, rafael.cookie)).json();
    const token = linkConvite.split('/convite/')[1];
    const aberto = (await api(amb, 'GET', `/auth/convite/${token}`)).json<ConviteAberto>();
    expect(aberto).toMatchObject({ email: 'ana@horizonte.com.br', perfil: 'editor', empresa: 'Horizonte', contaExistente: false, convidadoPor: { nome: 'Rafael Lima', perfil: 'admin' } });

    expect((await api(amb, 'POST', `/auth/convite/${token}`, { nome: 'Ana Ribeiro', senha: 'curta' })).statusCode).toBe(400);
    const aceito = await api(amb, 'POST', `/auth/convite/${token}`, { nome: 'Ana Ribeiro', senha: 'senha-da-ana-1' });
    expect(aceito.statusCode, aceito.body).toBe(200);
    expect(aceito.json<Eu>()).toMatchObject({ nome: 'Ana Ribeiro', perfil: 'editor', emailConfirmado: true });
    expect((await api(amb, 'GET', '/fluxos', undefined, cookieDe(aceito))).statusCode).toBe(200);
    expect((await api(amb, 'GET', `/auth/convite/${token}`)).statusCode).toBe(404);

    // Convite vencido: a mensagem nomeia quem convidou.
    const outro = (await api(amb, 'POST', '/equipe/convites', { email: 'bia@horizonte.com.br', perfil: 'leitor' }, rafael.cookie)).json();
    amb.ctx.banco.executar("UPDATE equipe SET convite_expira_em = ? WHERE email = 'bia@horizonte.com.br'", new Date(Date.now() - 1000).toISOString());
    const vencido = await api(amb, 'GET', `/auth/convite/${outro.linkConvite.split('/convite/')[1]}`);
    expect(vencido.statusCode).toBe(410);
    expect(vencido.json()).toMatchObject({
      mensagem: 'Este convite expirou. Peça ao Rafael Lima para reenviar em Equipe e limites.',
      email: 'bia@horizonte.com.br',
    });
  });

  it('quem já tem conta entra e aceita; o convite de outro e-mail não serve', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const { linkConvite } = (await api(amb, 'POST', '/equipe/convites', { email: LUANA.email, perfil: 'leitor' }, rafael.cookie)).json();
    const token = linkConvite.split('/convite/')[1];
    // Luana tem conta pela Pedra Branca.
    const cadastro = await api(amb, 'POST', '/auth/cadastro', CADASTRO);
    await api(amb, 'POST', '/auth/email/confirmar', { codigo: codigoEnviado(amb, LUANA.email) }, cookieDe(cadastro));
    expect((await api(amb, 'GET', `/auth/convite/${token}`)).json<ConviteAberto>().contaExistente).toBe(true);

    // Sem sessão não aceita; com a sessão de outra pessoa também não.
    expect((await api(amb, 'POST', `/auth/convite/${token}/aceitar`)).statusCode).toBe(401);
    const outra = await api(amb, 'POST', `/auth/convite/${token}/aceitar`, undefined, rafael.cookie);
    expect(outra.statusCode).toBe(403);
    expect(outra.json().mensagem).toBe(`Este convite é para ${LUANA.email}. Entre com esse e-mail para aceitar.`);

    const login = await entrar(amb, LUANA.email, LUANA.senha);
    const aceito = await api(amb, 'POST', `/auth/convite/${token}/aceitar`, undefined, cookieDe(login));
    expect(aceito.statusCode, aceito.body).toBe(200);
    expect(aceito.json<Eu>()).toMatchObject({ perfil: 'leitor', empresa: { nome: 'Horizonte' } });
    expect(aceito.json<Eu>().empresas).toHaveLength(2);
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Luana Freitas', acao: 'aceitou o convite' });
  });

  it('entrar com o convite aceita na mesma entrada, mesmo para quem não está em nenhuma empresa', async () => {
    amb = await criarAmbiente();
    const rafael = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    // Conta que saiu de todas as empresas.
    amb.plataforma.criarConta({ email: 'caio@horizonte.com.br', nome: 'Caio Prado', senha: 'senha-do-caio-1' });
    const { linkConvite } = (await api(amb, 'POST', '/equipe/convites', { email: 'caio@horizonte.com.br', perfil: 'editor' }, rafael.cookie)).json();
    const token = linkConvite.split('/convite/')[1];

    // Outro e-mail: recusa antes de conferir a senha, sem abrir sessão.
    const outro = await api(amb, 'POST', '/auth/entrar', { email: 'rafael@horizonte.com.br', senha: 'copiloto123', convite: token });
    expect(outro.statusCode).toBe(403);
    expect(outro.json().erro).toBe('outro_email');
    expect(outro.headers['set-cookie']).toBeUndefined();
    expect((await api(amb, 'POST', '/auth/entrar', { email: 'caio@horizonte.com.br', senha: 'errada-123', convite: token })).statusCode).toBe(401);

    const r = await api(amb, 'POST', '/auth/entrar', { email: 'caio@horizonte.com.br', senha: 'senha-do-caio-1', convite: token });
    expect(r.statusCode, r.body).toBe(200);
    const entrada = r.json<Entrada>();
    expect(entrada.eu).toMatchObject({ nome: 'Caio Prado', perfil: 'editor', empresa: { nome: 'Horizonte' } });
    expect(entrada.empresas.map((e) => e.nome)).toEqual(['Horizonte']);
    expect((await api(amb, 'GET', '/fluxos', undefined, cookieDe(r))).statusCode).toBe(200);
    expect((await api(amb, 'POST', '/auth/entrar', { email: 'caio@horizonte.com.br', senha: 'senha-do-caio-1', convite: token })).statusCode).toBe(404);
  });
});

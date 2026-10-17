// Várias empresas no mesmo servidor: cadastro, contas com mais de uma empresa, isolamento dos
// dados (console, widget, gravação, links de arquivo, CORS) e o segredo do widget de cada uma.
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Canais, EmpresaPlataforma, Entrada, Eu, SistemaEmpresa } from '@copiloto/shared';
import { textoAssinado } from '@copiloto/shared';
import { assinarArquivo } from '../../src/execucao/motor.ts';
import { assinarUsuario } from '../../src/auth/widget.ts';
import { Cofre } from '../../src/plataforma/cofre.ts';
import { empresaDoToken, slugDe, tokenDaEmpresa } from '../../src/plataforma/index.ts';
import { codigoEnviado, criarAmbiente, entrarComo, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
});

const CADASTRO = {
  empresa: { nome: 'Pedra Branca Distribuidora', cnpj: '11.222.333/0001-81', faixaUsuarios: 'ate_200' },
  pessoa: { nome: 'Luana Freitas', email: 'luana@pedrabranca.com.br', senha: 'senha-forte-1' },
  aceites: { termos: true, dados: true },
};
const ACEITES = CADASTRO.aceites;

/** Etapa 2 do cadastro: o endereço do sistema e como o copiloto entra. */
const SISTEMA = {
  nome: 'ERP Pedra Branca',
  url: 'https://erp.pedrabranca.com.br/',
  acesso: { modo: 'sessao', urlSessao: '', urlLogin: '', usuario: '' },
  perfis: [],
};

function cookieDe(r: { headers: Record<string, unknown> }): string {
  return String(r.headers['set-cookie']).split(';')[0];
}

/** Etapa 1 do cadastro. Conta nova já confirma o e-mail com o código que chegou (os testes de acesso cobrem o código). */
async function cadastrar(a: Ambiente, corpo: object = CADASTRO, cookie?: string) {
  const r = await a.app.inject({ method: 'POST', url: '/api/console/auth/cadastro', payload: corpo, headers: cookie ? { cookie } : {} });
  const email = (corpo as { pessoa?: { email: string } }).pessoa?.email;
  const codigo = email && !cookie && r.statusCode === 200 ? codigoEnviado(a, email) : undefined;
  if (codigo && !r.json<Eu>().emailConfirmado) {
    const c = await a.app.inject({ method: 'POST', url: '/api/console/auth/email/confirmar', headers: { cookie: cookieDe(r) }, payload: { codigo } });
    expect(c.statusCode, c.body).toBe(200);
  }
  return r;
}

/** Etapas 1 e 2: cria o espaço e liga o sistema. Devolve o cookie e o "Eu". */
async function cadastrarComSistema(a: Ambiente) {
  const r = await cadastrar(a);
  expect(r.statusCode, r.body).toBe(200);
  const cookie = cookieDe(r);
  const s = await pedir(a, cookie, 'PUT', '/sistema/config', SISTEMA);
  expect(s.statusCode, s.body).toBe(200);
  return { cookie, eu: r.json<Eu>() };
}

function pedir(a: Ambiente, cookie: string, metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return a.app.inject({ method: metodo, url: `/api/console${url}`, headers: { cookie }, payload });
}

describe('peças da plataforma', () => {
  it('tokens levam a empresa na frente, e o slug sai do nome', () => {
    const t = tokenDaEmpresa('emp_abc123');
    expect(t.startsWith('emp_abc123.')).toBe(true);
    expect(empresaDoToken(t)).toBe('emp_abc123');
    expect(empresaDoToken('sem-ponto')).toBeNull();
    expect(empresaDoToken(undefined)).toBeNull();
    expect(slugDe('Pedra Branca Distribuidora Ltda.')).toBe('pedra-branca-distribuidora-ltda');
  });

  it('o cofre cifra com AES-GCM e recusa texto adulterado ou de outra chave', () => {
    const cofre = new Cofre('chave-mestra-de-teste');
    const cifrado = cofre.cifrar('senha secreta');
    expect(cifrado).not.toContain('senha secreta');
    expect(cofre.decifrar(cifrado)).toBe('senha secreta');
    expect(() => new Cofre('outra-chave').decifrar(cifrado)).toThrow();
    const partes = cifrado.split('.');
    partes[3] = Buffer.from('outro corpo').toString('base64url');
    expect(() => cofre.decifrar(partes.join('.'))).toThrow();
  });
});

describe('cadastro de empresa', () => {
  it('etapa 1 cria o espaço e a conta Admin; a 2 liga o sistema e libera o domínio; a 3 dá a marca', async () => {
    amb = await criarAmbiente();
    const r = await cadastrar(amb);
    expect(r.statusCode, r.body).toBe(200);
    const eu = r.json<Eu>();
    expect(eu).toMatchObject({ nome: 'Luana Freitas', email: 'luana@pedrabranca.com.br', perfil: 'admin', empresa: { nome: 'Pedra Branca Distribuidora', demo: false } });
    expect(eu.empresas.map((e) => e.nome)).toEqual(['Pedra Branca Distribuidora']);
    const cookie = cookieDe(r);

    const empresa = amb.plataforma.empresa(eu.empresa.id)!;
    expect(empresa).toMatchObject({ cnpj: '11222333000181', faixaUsuarios: 'ate_200', criadoPor: 'luana@pedrabranca.com.br' });
    expect(empresa.sistema).toMatchObject({ nome: 'Pedra Branca Distribuidora', url: '', conector: 'tela', acesso: { modo: 'nenhum' } });
    expect(empresa.chavePublica).toMatch(/^pk_/);
    expect(empresa.chavePublica).not.toBe(amb.ctx.empresa.chavePublica);
    const termos = amb.plataforma.banco.um<{ t: string | null }>('SELECT termos_aceitos_em AS t FROM empresas WHERE id = ?', empresa.id)!;
    expect(termos.t).toBeTruthy();
    expect(amb.plataforma.contexto(empresa.id).auditoria.listar()[0]).toMatchObject({ ator: 'Luana Freitas', acao: 'criou o espaço da empresa' });

    // Etapa 2: endereço verificado e salvo; o widget passa a valer no domínio do sistema.
    const verificado = (await pedir(amb, cookie, 'POST', '/sistema/verificar', { url: 'http://127.0.0.1:1' })).json();
    expect(verificado.ok).toBe(false);
    const ligado = await pedir(amb, cookie, 'PUT', '/sistema/config', SISTEMA);
    expect(ligado.statusCode, ligado.body).toBe(200);
    expect(ligado.json<SistemaEmpresa>()).toMatchObject({
      nome: 'ERP Pedra Branca',
      url: 'https://erp.pedrabranca.com.br',
      conector: 'tela',
      editavel: true,
      acesso: { modo: 'sessao', urlSessao: '', temSenha: false },
    });
    const canais = (await pedir(amb, cookie, 'GET', '/canais')).json<Canais>();
    expect(canais).toMatchObject({ chavePublica: empresa.chavePublica, conector: 'tela' });
    expect(canais.publicada.dominios).toEqual(['erp.pedrabranca.com.br']);
    expect(canais.rascunho.dominios).toEqual(['erp.pedrabranca.com.br']);
    expect(amb.plataforma.dominioLiberado('erp.pedrabranca.com.br', 'erp.pedrabranca.com.br')).toBe(true);
    // Widget de empresa cliente: boas-vindas genéricas, sem as sugestões da demonstração.
    expect(canais.publicada.sugestoes).toEqual([]);

    // Etapa 3: a marca vai para a configuração do widget.
    const marca = { ...canais.rascunho, nome: 'Assistente Pedra Branca', cor: '#E12360', boasVindas: 'Oi! Eu emito pedidos e segundas vias para você.' };
    expect((await pedir(amb, cookie, 'PUT', '/canais/rascunho', { config: marca })).statusCode).toBe(200);
    const publicado = (await pedir(amb, cookie, 'POST', '/canais/publicar')).json<Canais>();
    expect(publicado.publicada).toMatchObject({ nome: 'Assistente Pedra Branca', cor: '#E12360' });
    expect(publicado.publicada.dominios).toEqual(['erp.pedrabranca.com.br']);
  });

  it('valida os dados, recusa e-mail com conta e senha errada, e respeita o cadastro fechado', async () => {
    amb = await criarAmbiente();
    const erro = async (mudanca: Record<string, unknown>) => {
      const r = await cadastrar(amb!, { ...CADASTRO, ...mudanca });
      expect(r.statusCode).toBe(400);
      return r.json().mensagem as string;
    };
    expect(await erro({ pessoa: { ...CADASTRO.pessoa, senha: 'curta1' } })).toBe('A senha precisa de pelo menos 8 caracteres.');
    expect(await erro({ pessoa: { ...CADASTRO.pessoa, senha: 'so-letras-aqui' } })).toBe('Use letras e números na senha.');
    expect(await erro({ pessoa: { ...CADASTRO.pessoa, senha: 'Pedra Branca Distribuidora 1' } })).toBe('A senha precisa ser diferente do nome da empresa.');
    expect(await erro({ pessoa: { ...CADASTRO.pessoa, email: 'luana@gmail.com' } })).toBe('Use o e-mail da empresa, por exemplo nome@suaempresa.com.br.');
    expect(await erro({ empresa: { ...CADASTRO.empresa, cnpj: '11.222.333/0001-80' } })).toBe('CNPJ inválido. Confira os números.');
    expect(await erro({ aceites: { termos: true, dados: false } })).toContain('contrato de tratamento de dados (LGPD)');

    expect((await cadastrar(amb)).statusCode).toBe(200);
    const outra = { ...CADASTRO, empresa: { nome: 'Pedra Branca Filial' } };
    const errada = await cadastrar(amb, { ...outra, pessoa: { ...CADASTRO.pessoa, senha: 'outra-senha-9' } });
    expect(errada.statusCode).toBe(409);
    expect(errada.json().erro).toBe('conta_existente');
    // Com a senha certa, a mesma conta fica com as duas empresas.
    const certa = await cadastrar(amb, outra);
    expect(certa.statusCode).toBe(200);
    expect(certa.json<Eu>().empresas.map((e) => e.nome).sort()).toEqual(['Pedra Branca Distribuidora', 'Pedra Branca Filial']);

    amb.plataforma.config.cadastroAberto = false;
    const fechado = await cadastrar(amb, { ...CADASTRO, pessoa: { ...CADASTRO.pessoa, email: 'novo@pedrabranca.com.br' } });
    expect(fechado.statusCode).toBe(403);
    expect(fechado.json().erro).toBe('cadastro_fechado');
    const acesso = (await amb.app.inject({ method: 'GET', url: '/api/console/auth/primeiro-acesso' })).json();
    expect(acesso).toMatchObject({ precisaCriarAdmin: false, cadastroAberto: false });
  });

  it('logado, cria outra empresa para a mesma conta e a sessão passa para ela', async () => {
    amb = await criarAmbiente();
    const { cookie } = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    const r = await cadastrar(amb, { empresa: CADASTRO.empresa, aceites: ACEITES }, cookie);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Eu>()).toMatchObject({ email: 'rafael@horizonte.com.br', perfil: 'admin', empresa: { nome: 'Pedra Branca Distribuidora' } });
    const eu = (await pedir(amb, cookie, 'GET', '/auth/eu')).json<Eu>();
    expect(eu.empresa.nome).toBe('Pedra Branca Distribuidora');
    expect(eu.empresas).toHaveLength(2);
  });
});

describe('isolamento entre empresas', () => {
  it('o console de uma empresa não vê nem mexe nos dados da outra', async () => {
    amb = await criarAmbiente();
    const horizonte = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    // Um fluxo e um convite na demonstração.
    const fluxo = (await pedir(amb, horizonte.cookie, 'POST', '/fluxos', { nome: 'Abrir chamado', urlInicial: '/chamados' })).json();
    expect(fluxo.fluxo.id).toBeTruthy();
    expect(empresaDoToken(fluxo.token)).toBe(amb.ctx.empresa.id);
    await pedir(amb, horizonte.cookie, 'POST', '/equipe/convites', { email: 'nova@horizonte.com.br', perfil: 'leitor' });

    const r = await cadastrar(amb);
    const pedra = cookieDe(r);
    expect((await pedir(amb, pedra, 'GET', '/fluxos')).json()).toEqual([]);
    expect((await pedir(amb, pedra, 'GET', `/fluxos/${fluxo.fluxo.id}`)).statusCode).toBe(404);
    expect((await pedir(amb, pedra, 'DELETE', `/fluxos/${fluxo.fluxo.id}`)).statusCode).toBe(404);
    const equipe = (await pedir(amb, pedra, 'GET', '/equipe')).json<{ email: string }[]>();
    expect(equipe.map((m) => m.email)).toEqual(['luana@pedrabranca.com.br']);
    expect((await pedir(amb, pedra, 'GET', '/auditoria')).json().map((x: { acao: string }) => x.acao)).toEqual(['criou o espaço da empresa']);
    // A demonstração continua com o fluxo dela.
    expect((await pedir(amb, horizonte.cookie, 'GET', '/fluxos')).json()).toHaveLength(1);
  });

  it('convite com conta existente: a mesma pessoa fica nas duas empresas e troca entre elas', async () => {
    amb = await criarAmbiente();
    const admin = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const r = await cadastrar(amb);
    const luana = cookieDe(r);
    const pedraId = r.json<Eu>().empresa.id;

    // Rafael (Horizonte) convida a Luana, que já tem conta pela Pedra Branca.
    const { linkConvite } = (await pedir(amb, admin.cookie, 'POST', '/equipe/convites', { email: 'luana@pedrabranca.com.br', perfil: 'editor' })).json();
    const token = linkConvite.split('/convite/')[1];
    expect(empresaDoToken(token)).toBe(amb.ctx.empresa.id);
    const aberto = (await amb.app.inject({ method: 'GET', url: `/api/console/auth/convite/${token}` })).json();
    expect(aberto).toMatchObject({ email: 'luana@pedrabranca.com.br', perfil: 'editor', empresa: 'Horizonte', contaExistente: true });
    // Quem já tem conta não cria outra pelo convite: entra e aceita.
    const criar = await amb.app.inject({ method: 'POST', url: `/api/console/auth/convite/${token}`, payload: { nome: 'Luana', senha: 'outra-senha-9' } });
    expect(criar.statusCode).toBe(409);
    expect(criar.json()).toMatchObject({ erro: 'conta_existente', mensagem: 'Você já tem conta com este e-mail. Entre para aceitar o convite.' });
    const aceito = await pedir(amb, luana, 'POST', `/auth/convite/${token}/aceitar`);
    expect(aceito.statusCode, aceito.body).toBe(200);
    expect(aceito.json<Eu>()).toMatchObject({ perfil: 'editor', empresa: { id: amb.ctx.empresa.id } });
    expect(aceito.json<Eu>().empresas).toHaveLength(2);

    // A sessão antiga (Pedra Branca) troca para o Horizonte e volta.
    const troca = await pedir(amb, luana, 'POST', '/auth/empresa', { empresaId: amb.ctx.empresa.id });
    expect(troca.statusCode).toBe(200);
    expect(troca.json<Eu>()).toMatchObject({ perfil: 'editor', empresa: { nome: 'Horizonte' } });
    expect((await pedir(amb, luana, 'GET', '/equipe')).json()).toHaveLength(2);
    // Editor no Horizonte não convida; Admin na Pedra Branca convida.
    expect((await pedir(amb, luana, 'POST', '/equipe/convites', { email: 'x@x.com.br', perfil: 'leitor' })).statusCode).toBe(403);
    await pedir(amb, luana, 'POST', '/auth/empresa', { empresaId: pedraId });
    expect((await pedir(amb, luana, 'POST', '/equipe/convites', { email: 'x@x.com.br', perfil: 'leitor' })).statusCode).toBe(200);

    // Empresa em que não está: 404, a sessão continua onde estava.
    const outra = amb.plataforma.criarEmpresa({ nome: 'Outra', sistema: { ...amb.plataforma.empresa(pedraId)!.sistema } });
    expect((await pedir(amb, luana, 'POST', '/auth/empresa', { empresaId: outra.id })).statusCode).toBe(404);
    expect((await pedir(amb, luana, 'GET', '/auth/eu')).json<Eu>().empresa.id).toBe(pedraId);

    // Entrar de novo volta para a última empresa aberta, e a lista vem com ela primeiro.
    const login = await amb.app.inject({ method: 'POST', url: '/api/console/auth/entrar', payload: { email: 'luana@pedrabranca.com.br', senha: CADASTRO.pessoa.senha } });
    const entrada = login.json<Entrada>();
    expect(entrada.eu?.empresa.id).toBe(pedraId);
    expect(entrada.empresas.map((e) => e.nome)).toEqual(['Pedra Branca Distribuidora', 'Horizonte']);
    expect(entrada.empresas[1]).toMatchObject({ perfil: 'editor', demo: true });
  });

  it('quem sai da equipe perde o acesso àquela empresa na hora, e só a ela', async () => {
    amb = await criarAmbiente();
    const admin = entrarComo(amb.ctx, 'admin', 'Rafael Lima');
    const r = await cadastrar(amb);
    const luana = cookieDe(r);
    const { linkConvite } = (await pedir(amb, admin.cookie, 'POST', '/equipe/convites', { email: CADASTRO.pessoa.email, perfil: 'leitor' })).json();
    const login = await amb.app.inject({ method: 'POST', url: '/api/console/auth/entrar', payload: { email: CADASTRO.pessoa.email, senha: CADASTRO.pessoa.senha } });
    const sessaoHorizonte = cookieDe(login);
    expect((await pedir(amb, sessaoHorizonte, 'POST', `/auth/convite/${linkConvite.split('/convite/')[1]}/aceitar`)).statusCode).toBe(200);
    expect((await pedir(amb, sessaoHorizonte, 'GET', '/auth/eu')).statusCode).toBe(200);

    const membro = amb.ctx.banco.um<{ id: string }>('SELECT id FROM equipe WHERE email = ?', CADASTRO.pessoa.email)!;
    expect((await pedir(amb, admin.cookie, 'DELETE', `/equipe/${membro.id}`)).statusCode).toBe(200);
    expect((await pedir(amb, sessaoHorizonte, 'GET', '/auth/eu')).statusCode).toBe(401);
    // A sessão na Pedra Branca continua, e o menu não mostra mais o Horizonte.
    const eu = (await pedir(amb, luana, 'GET', '/auth/eu')).json<Eu>();
    expect(eu.empresas.map((e) => e.nome)).toEqual(['Pedra Branca Distribuidora']);
  });

  it('empresa suspensa: ninguém entra no console nem no widget dela', async () => {
    amb = await criarAmbiente();
    const r = await cadastrar(amb);
    const cookie = cookieDe(r);
    const empresa = amb.plataforma.empresa(r.json<Eu>().empresa.id)!;
    amb.plataforma.banco.executar("UPDATE empresas SET status = 'suspensa' WHERE id = ?", empresa.id);
    expect((await pedir(amb, cookie, 'GET', '/auth/eu')).statusCode).toBe(401);
    const login = await amb.app.inject({ method: 'POST', url: '/api/console/auth/entrar', payload: { email: CADASTRO.pessoa.email, senha: CADASTRO.pessoa.senha } });
    // A senha confere, mas não há empresa ativa para abrir: nenhuma sessão.
    expect(login.statusCode).toBe(200);
    expect(login.json<Entrada>()).toMatchObject({ eu: null, empresas: [] });
    expect(login.headers['set-cookie']).toBeUndefined();
    const segredo = amb.plataforma.segredoWidget(empresa);
    const widget = await amb.app.inject({
      method: 'POST',
      url: '/api/widget/iniciar',
      payload: { chave: empresa.chavePublica, usuario: '1', assinatura: assinarUsuario('1', segredo) },
    });
    expect(widget.statusCode).toBe(403);
  });
});

describe('widget de cada empresa', () => {
  async function comPedraBranca() {
    const a = await criarAmbiente();
    const { cookie, eu } = await cadastrarComSistema(a);
    const empresa = a.plataforma.empresa(eu.empresa.id)!;
    return { a, cookie, empresa, ctx: a.plataforma.contexto(empresa.id) };
  }

  it('a chave abre o widget da empresa certa e o snippet assinado ensina quem é a pessoa', async () => {
    const { a, cookie, empresa } = await comPedraBranca();
    amb = a;
    const { segredo } = (await pedir(a, cookie, 'GET', '/canais/segredo')).json();
    expect(segredo).toMatch(/^sw_/);
    expect(segredo).toBe(a.plataforma.segredoWidget(empresa));
    // O segredo fica cifrado no banco da plataforma.
    const guardado = a.plataforma.banco.um<{ segredo_widget: string }>('SELECT segredo_widget FROM empresas WHERE id = ?', empresa.id)!;
    expect(guardado.segredo_widget).not.toContain(segredo);

    const identidade = { nome: 'Joana Prado', email: 'joana@pedrabranca.com.br', perfis: ['Vendas', 'Financeiro'] };
    const assinatura = assinarUsuario(textoAssinado('u-77', identidade), segredo);
    const r = await a.app.inject({
      method: 'POST',
      url: '/api/widget/iniciar',
      headers: { origin: 'https://erp.pedrabranca.com.br' },
      payload: { chave: empresa.chavePublica, usuario: 'u-77', assinatura, ...identidade },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().usuario).toMatchObject({ id: 'u-77', nome: 'Joana Prado' });
    expect(r.headers['access-control-allow-origin']).toBe('https://erp.pedrabranca.com.br');

    // O console da empresa passa a conhecer a pessoa e os perfis dela.
    expect((await pedir(a, cookie, 'GET', '/sistema/usuarios')).json()).toEqual([
      { id: 'u-77', nome: 'Joana Prado', email: 'joana@pedrabranca.com.br', perfis: ['Vendas', 'Financeiro'] },
    ]);
    expect((await pedir(a, cookie, 'GET', '/sistema/perfis')).json()).toEqual(['Financeiro', 'Vendas']);

    // Mexer no nome sem refazer a assinatura não passa.
    const adulterado = await a.app.inject({
      method: 'POST',
      url: '/api/widget/iniciar',
      payload: { chave: empresa.chavePublica, usuario: 'u-77', assinatura, ...identidade, perfis: ['Administradores'] },
    });
    expect(adulterado.statusCode).toBe(401);
  });

  it('assinatura com o segredo de outra empresa, ou sem assinatura, não abre (nem com WIDGET_EXIGIR_ASSINATURA=0)', async () => {
    const { a, empresa, ctx } = await comPedraBranca();
    amb = a;
    const comDemo = await a.app.inject({
      method: 'POST',
      url: '/api/widget/iniciar',
      payload: { chave: empresa.chavePublica, usuario: '101', assinatura: assinarUsuario('101', a.config.segredoWidget) },
    });
    expect(comDemo.statusCode).toBe(401);
    expect(comDemo.json().erro).toBe('assinatura_invalida');
    ctx.config.exigirAssinatura = false;
    const sem = await a.app.inject({ method: 'POST', url: '/api/widget/iniciar', payload: { chave: empresa.chavePublica, usuario: '101' } });
    expect(sem.statusCode).toBe(401);
    const chaveErrada = await a.app.inject({ method: 'POST', url: '/api/widget/iniciar', payload: { chave: 'pk_nao_existe', usuario: '1' } });
    expect(chaveErrada.json().erro).toBe('chave_invalida');
  });

  it('gerar um segredo novo derruba o antigo; a demonstração usa o WIDGET_SEGREDO', async () => {
    const { a, cookie, empresa } = await comPedraBranca();
    amb = a;
    const antigo = a.plataforma.segredoWidget(empresa);
    const { segredo } = (await pedir(a, cookie, 'POST', '/canais/segredo/novo')).json();
    expect(segredo).not.toBe(antigo);
    const iniciar = (s: string) =>
      a.app.inject({ method: 'POST', url: '/api/widget/iniciar', payload: { chave: empresa.chavePublica, usuario: 'u-1', assinatura: assinarUsuario('u-1', s) } });
    expect((await iniciar(antigo)).statusCode).toBe(401);
    expect((await iniciar(segredo)).statusCode).toBe(200);

    const demo = entrarComo(a.ctx, 'admin');
    const r = await pedir(a, demo.cookie, 'GET', '/canais/segredo');
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('segredo_do_ambiente');
    // Só Admin vê o segredo.
    const leitor = entrarComo(a.plataforma.contexto(empresa.id), 'leitor', 'Leo Leitor');
    expect((await pedir(a, leitor.cookie, 'GET', '/canais/segredo')).statusCode).toBe(403);
  });

  it('o token do widget só vale na empresa que o emitiu', async () => {
    const { a, empresa, ctx } = await comPedraBranca();
    amb = a;
    const segredo = a.plataforma.segredoWidget(empresa);
    const pedra = (
      await a.app.inject({ method: 'POST', url: '/api/widget/iniciar', payload: { chave: empresa.chavePublica, usuario: 'u-1', assinatura: assinarUsuario('u-1', segredo) } })
    ).json();
    const horizonte = (
      await a.app.inject({
        method: 'POST',
        url: '/api/widget/iniciar',
        payload: { chave: a.ctx.empresa.chavePublica, usuario: '101', assinatura: assinarUsuario('101', a.config.segredoWidget) },
      })
    ).json();
    const conversa = ctx.conversas.criar({ usuarioId: 'u-1', usuarioNome: 'u-1', canal: 'widget' });
    const ver = (token: string) =>
      a.app.inject({ method: 'GET', url: `/api/widget/conversas/${conversa.id}`, headers: { authorization: `Bearer ${token}` } });
    expect((await ver(pedra.token)).statusCode).toBe(200);
    expect((await ver(horizonte.token)).statusCode).toBe(404);
  });

  it('CORS libera os domínios publicados de qualquer empresa e só eles', async () => {
    const { a, cookie } = await comPedraBranca();
    amb = a;
    const origem = (o: string) => a.app.inject({ method: 'GET', url: '/api/saude', headers: { origin: o } });
    expect((await origem('https://erp.pedrabranca.com.br')).headers['access-control-allow-origin']).toBe('https://erp.pedrabranca.com.br');
    expect((await origem('https://intruso.com')).headers['access-control-allow-origin']).toBeUndefined();

    const canais = (await pedir(a, cookie, 'GET', '/canais')).json<Canais>();
    await pedir(a, cookie, 'PUT', '/canais/rascunho', { config: { ...canais.rascunho, dominios: ['portal.pedrabranca.com.br'] } });
    await pedir(a, cookie, 'POST', '/canais/publicar');
    expect((await origem('https://portal.pedrabranca.com.br')).headers['access-control-allow-origin']).toBe('https://portal.pedrabranca.com.br');
    expect((await origem('https://erp.pedrabranca.com.br')).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('link de arquivo assinado para uma empresa não abre na outra', async () => {
    const { a, empresa } = await comPedraBranca();
    amb = a;
    const execucao = 'EX-1';
    const chave = assinarArquivo(a.ctx.empresa.id, execucao, 'boleto.pdf', a.config.segredoSessao);
    const r = await a.app.inject({ method: 'GET', url: `/api/widget/execucoes/${execucao}/arquivos/boleto.pdf?e=${empresa.id}&chave=${chave}` });
    expect(r.statusCode).toBe(404);
    expect(assinarArquivo(empresa.id, execucao, 'boleto.pdf', a.config.segredoSessao)).not.toBe(chave);
  });
});

describe('gravação de fluxo', () => {
  it('o token de gravação leva à empresa certa; trocar a empresa do token não acha nada', async () => {
    amb = await criarAmbiente();
    const r = await cadastrar(amb);
    const cookie = cookieDe(r);
    const pedraId = r.json<Eu>().empresa.id;
    const { token } = (await pedir(amb, cookie, 'POST', '/fluxos', { nome: 'Emitir pedido', urlInicial: '/pedidos/novo' })).json();
    expect(empresaDoToken(token)).toBe(pedraId);
    expect((await amb.app.inject({ method: 'GET', url: `/api/gravacao/${token}` })).statusCode).toBe(200);
    const trocado = `${amb.ctx.empresa.id}.${token.split('.')[1]}`;
    expect((await amb.app.inject({ method: 'GET', url: `/api/gravacao/${trocado}` })).statusCode).toBe(404);
    expect((await amb.app.inject({ method: 'GET', url: `/api/gravacao/${crypto.randomUUID()}` })).statusCode).toBe(404);
  });
});

describe('sistema da empresa', () => {
  it('guarda a conta de serviço com a senha cifrada e nunca devolve a senha', async () => {
    amb = await criarAmbiente();
    const r = await cadastrar(amb);
    const cookie = cookieDe(r);
    const empresaId = r.json<Eu>().empresa.id;
    const base = { nome: 'ERP Pedra Branca', url: 'https://erp.pedrabranca.com.br', perfis: ['Vendas', 'Vendas', 'Financeiro'] };

    const semSenha = await pedir(amb, cookie, 'PUT', '/sistema/config', { ...base, acesso: { modo: 'conta', urlSessao: '', urlLogin: '/login', usuario: 'copiloto' } });
    expect(semSenha.statusCode).toBe(400);
    const salvo = await pedir(amb, cookie, 'PUT', '/sistema/config', {
      ...base,
      acesso: { modo: 'conta', urlSessao: '', urlLogin: '/login', usuario: 'copiloto', senha: 'S3nha-do-robo' },
    });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(salvo.json<SistemaEmpresa>()).toMatchObject({ acesso: { modo: 'conta', usuario: 'copiloto', temSenha: true }, perfis: ['Vendas', 'Financeiro'] });
    expect(salvo.body).not.toContain('S3nha-do-robo');
    const linha = amb.plataforma.banco.um<{ credenciais: string; sistema: string }>('SELECT credenciais, sistema FROM empresas WHERE id = ?', empresaId)!;
    expect(linha.credenciais).not.toContain('S3nha-do-robo');
    expect(linha.sistema).not.toContain('S3nha-do-robo');
    expect(amb.plataforma.senhaAcesso(empresaId)).toBe('S3nha-do-robo');

    // Sem mandar a senha de novo, a guardada continua; o adaptador já usa o login novo.
    await pedir(amb, cookie, 'PUT', '/sistema/config', { ...base, acesso: { modo: 'conta', urlSessao: '', urlLogin: '/entrar', usuario: 'copiloto2' } });
    expect(amb.plataforma.senhaAcesso(empresaId)).toBe('S3nha-do-robo');
    const sessao = await amb.plataforma.contexto(empresaId).adaptador.sessaoNavegador('qualquer');
    expect(sessao.login).toEqual({ url: 'https://erp.pedrabranca.com.br/entrar', usuario: 'copiloto2', senha: 'S3nha-do-robo' });

    // Voltar para "sem login" apaga a senha.
    await pedir(amb, cookie, 'PUT', '/sistema/config', { ...base, acesso: { modo: 'nenhum', urlSessao: '', urlLogin: '', usuario: '' } });
    expect(amb.plataforma.senhaAcesso(empresaId)).toBeNull();
    expect(amb.ctx.auditoria.listar().some((x) => x.acao === 'alterou o sistema')).toBe(false);
    expect(amb.plataforma.contexto(empresaId).auditoria.listar()[0]).toMatchObject({ acao: 'alterou o sistema' });
  });

  it('a demonstração não muda o sistema pelo console, e só Admin muda', async () => {
    amb = await criarAmbiente();
    const demo = entrarComo(amb.ctx, 'admin');
    const sistema = (await pedir(amb, demo.cookie, 'GET', '/sistema/config')).json<SistemaEmpresa>();
    expect(sistema).toMatchObject({ conector: 'api', editavel: false });
    const r = await pedir(amb, demo.cookie, 'PUT', '/sistema/config', SISTEMA);
    expect(r.statusCode).toBe(409);
    const editor = entrarComo(amb.ctx, 'editor', 'Júlia Martins');
    expect((await pedir(amb, editor.cookie, 'PUT', '/sistema/config', {})).statusCode).toBe(403);
  });

  it('sem API: a tarefa não tem rotas e a chamada responde que é só pela tela', async () => {
    amb = await criarAmbiente();
    const r = await cadastrar(amb);
    const ctx = amb.plataforma.contexto(r.json<Eu>().empresa.id);
    expect(await ctx.adaptador.descreverApi()).toEqual([]);
    const chamada = await ctx.adaptador.chamar({ metodo: 'GET', caminho: '/v1/x', usuarioId: '1' });
    expect(chamada).toMatchObject({ status: 501, corpo: { erro: 'sem_api' } });
  });
});

describe('painel da plataforma', () => {
  it('só quem está em COPILOTO_ADMINS vê as empresas, com métricas e sem conteúdo, e pode suspender', async () => {
    amb = await criarAmbiente({ semear: true });
    const { cookie: luana } = await cadastrarComSistema(amb);
    const gabriel = entrarComo(amb.ctx, 'admin', 'Gabriel Moreno', 'gabriel@starta.com.br');
    expect((await pedir(amb, gabriel.cookie, 'GET', '/plataforma/empresas')).statusCode).toBe(403);
    expect((await pedir(amb, gabriel.cookie, 'GET', '/auth/eu')).json<Eu>().adminPlataforma).toBe(false);

    amb.plataforma.config.adminsPlataforma = ['gabriel@starta.com.br'];
    expect((await pedir(amb, gabriel.cookie, 'GET', '/auth/eu')).json<Eu>().adminPlataforma).toBe(true);
    const lista = (await pedir(amb, gabriel.cookie, 'GET', '/plataforma/empresas')).json<EmpresaPlataforma[]>();
    expect(lista.map((e) => e.nome)).toEqual(['Horizonte', 'Pedra Branca Distribuidora']);
    const [horizonte, pedra] = lista;
    expect(horizonte).toMatchObject({ demo: true, status: 'ativa', sistema: { conector: 'api' }, tarefasAtivas: 4 });
    expect(horizonte.execucoes30d).toBeGreaterThan(1000);
    expect(horizonte.sucesso30d).toBeGreaterThan(0.9);
    expect(pedra).toMatchObject({
      demo: false,
      equipe: 1,
      usuarios: 0,
      execucoes30d: 0,
      sucesso30d: null,
      cnpj: '11222333000181',
      faixaUsuarios: 'ate_200',
      criadoPor: 'luana@pedrabranca.com.br',
      sistema: { nome: 'ERP Pedra Branca', url: 'https://erp.pedrabranca.com.br', conector: 'tela', acesso: 'sessao' },
    });
    expect(JSON.stringify(lista)).not.toMatch(/conversa|mensagens|segredo|sw_/);

    // Suspender derruba as sessões da empresa; reativar devolve o acesso (entrando de novo).
    const suspensa = await pedir(amb, gabriel.cookie, 'PUT', `/plataforma/empresas/${pedra.id}/status`, { status: 'suspensa' });
    expect(suspensa.json<EmpresaPlataforma>().status).toBe('suspensa');
    expect((await pedir(amb, luana, 'GET', '/auth/eu')).statusCode).toBe(401);
    await pedir(amb, gabriel.cookie, 'PUT', `/plataforma/empresas/${pedra.id}/status`, { status: 'ativa' });
    const login = await amb.app.inject({ method: 'POST', url: '/api/console/auth/entrar', payload: { email: CADASTRO.pessoa.email, senha: CADASTRO.pessoa.senha } });
    expect(login.statusCode).toBe(200);
    const auditoria = amb.plataforma.contexto(pedra.id).auditoria.listar();
    expect(auditoria.slice(0, 2).map((x) => x.acao)).toEqual(['reativou a empresa', 'suspendeu a empresa']);
    expect(auditoria[0].ator).toBe('Gabriel Moreno (plataforma)');
  });
});

describe('dados da demonstração', () => {
  it('a semente cria o Horizonte com a chave local e as contas da equipe', async () => {
    amb = await criarAmbiente({ semear: true });
    expect(amb.ctx.empresa).toMatchObject({ nome: 'Horizonte', demo: true, chavePublica: process.env.WIDGET_CHAVE_PUBLICA || 'pk_local_horizonte' });
    expect(amb.plataforma.conta('rafael.lima@seusistema.com.br')).toBeTruthy();
    expect(amb.plataforma.conta('leticia.prado@seusistema.com.br')).toBeUndefined();
    const convite = amb.ctx.banco.um<{ convite_token: string }>("SELECT convite_token FROM equipe WHERE status = 'convidado'")!;
    expect(empresaDoToken(convite.convite_token)).toBe(amb.ctx.empresa.id);
    // Sem senha guardada no banco da empresa: a senha é da conta, na plataforma.
    expect(amb.ctx.banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM equipe WHERE senha_hash IS NOT NULL')!.n).toBe(0);
    const primeiro = (await amb.app.inject({ method: 'GET', url: '/api/console/auth/primeiro-acesso' })).json();
    expect(primeiro).toMatchObject({ precisaCriarAdmin: false, demo: true });
  });
});

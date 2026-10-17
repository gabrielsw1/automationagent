// Plataforma Starta (A7 e S7): contas da equipe separadas das empresas, duas etapas com o
// autenticador, códigos de recuperação, aparelho confiável, painel das empresas sem conteúdo,
// "Nova empresa", pausar, sugerir regravação e o modo suporte no console da empresa.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AtivacaoStarta,
  DetalheEmpresaStarta,
  EntradaStarta,
  Eu,
  EuStarta,
  LinkAtivacao,
  MembroStarta,
  NovaEmpresaStarta,
  PainelEmpresas,
  SaudeFluxo,
  SuporteAberto,
  UsoPlataforma,
} from '@copiloto/shared';
import { codigoTotp, conferirTotp, novoSegredoTotp } from '../../src/auth/totp.ts';
import { agoraIso } from '../../src/db/banco.ts';
import { novoId } from '../../src/util/ids.ts';
import { codigoEnviado, criarAmbiente, entrarComo, entrarNaPlataforma, ultimoEmail, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await amb?.app.close();
  amb = undefined;
});

function cookieDe(r: { headers: Record<string, unknown> }, nome = 'starta_sessao'): string {
  const lista = ([] as string[]).concat(r.headers['set-cookie'] as string | string[]);
  return lista.find((c) => c.startsWith(`${nome}=`))!.split(';')[0];
}

function api(a: Ambiente, metodo: 'GET' | 'POST' | 'PUT', url: string, payload?: object, cookie?: string) {
  return a.app.inject({ method: metodo, url: `/api/plataforma${url}`, payload, headers: cookie ? { cookie } : {} });
}

/** Avança o relógio (só Date): códigos do autenticador de outro intervalo de 30 s, bloqueios vencidos. */
function avancar(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
}

/** Uma execução no banco da empresa, como o motor grava ao concluir. */
function execucao(a: Ambiente, empresaId: string, d: { tarefaId: string; nome: string; status?: string; creditos?: number; recuperacoes?: number; dias?: number }) {
  const ctx = a.plataforma.contexto(empresaId);
  const quando = new Date(Date.now() - (d.dias ?? 1) * 86_400_000).toISOString();
  ctx.banco.inserir('execucoes', {
    id: novoId('ex'),
    usuario_id: '1',
    usuario_nome: 'Cliente',
    tarefa_id: d.tarefaId,
    tarefa_nome: d.nome,
    pedido: 'pedido',
    status: d.status ?? 'concluida',
    canal: 'widget',
    criado_em: quando,
    custo_modelo: 0.05,
    custo_navegador: 0.1,
    creditos: d.creditos ?? 1,
    recuperacoes: d.recuperacoes ?? 0,
  });
}

describe('autenticador (TOTP)', () => {
  it('segue a RFC 6238 e aceita o intervalo vizinho', () => {
    // Vetor de teste da RFC 6238 (SHA1, segredo "12345678901234567890"), 6 últimos dígitos.
    const segredo = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(codigoTotp(segredo, 59_000)).toBe('287082');
    expect(codigoTotp(segredo, 1_111_111_109_000)).toBe('081804');
    expect(codigoTotp(segredo, 1_234_567_890_000)).toBe('005924');
    const novo = novoSegredoTotp();
    expect(novo).toMatch(/^[A-Z2-7]{32}$/);
    const agora = Date.now();
    expect(conferirTotp(novo, codigoTotp(novo, agora - 30_000), agora)).not.toBeNull();
    expect(conferirTotp(novo, codigoTotp(novo, agora - 90_000), agora)).toBeNull();
    expect(conferirTotp(novo, '12345', agora)).toBeNull();
  });
});

describe('entrar na plataforma (A7)', () => {
  it('COPILOTO_ADMINS recebe o link; a ativação liga o autenticador e mostra os códigos de recuperação', async () => {
    amb = await criarAmbiente();
    amb.plataforma.config.adminsPlataforma = ['gabriel.moreno@startaideia.com.br'];
    const [criado] = amb.plataforma.prepararEquipeStarta();
    expect(criado).toMatchObject({ nome: 'Gabriel Moreno', email: 'gabriel.moreno@startaideia.com.br' });
    expect(amb.plataforma.prepararEquipeStarta()).toEqual([]);
    const token = criado.link.split('/plataforma/ativar/')[1];

    const aberta = (await api(amb, 'GET', `/auth/ativar/${token}`)).json<AtivacaoStarta>();
    expect(aberta).toMatchObject({ nome: 'Gabriel Moreno', email: 'gabriel.moreno@startaideia.com.br' });
    expect(aberta.qrSvg).toMatch(/^<svg/);
    expect(aberta.uri).toContain(`secret=${aberta.segredo}`);
    expect(aberta.uri).toContain('issuer=Copiloto+Starta');

    expect((await api(amb, 'POST', `/auth/ativar/${token}`, { senha: 'curta', codigo: codigoTotp(aberta.segredo) })).statusCode).toBe(400);
    const errado = await api(amb, 'POST', `/auth/ativar/${token}`, { senha: 'senha-da-starta-1', codigo: '000000' });
    expect(errado.json().erro).toBe('codigo_incorreto');
    const ok = await api(amb, 'POST', `/auth/ativar/${token}`, { senha: 'senha-da-starta-1', codigo: codigoTotp(aberta.segredo) });
    expect(ok.statusCode, ok.body).toBe(200);
    const { eu, codigosRecuperacao } = ok.json<{ eu: EuStarta; codigosRecuperacao: string[] }>();
    expect(eu).toMatchObject({ nome: 'Gabriel Moreno', iniciais: 'GM', codigosRecuperacao: 10 });
    expect(codigosRecuperacao).toHaveLength(10);
    expect(codigosRecuperacao[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await api(amb, 'GET', '/empresas', undefined, cookieDe(ok))).statusCode).toBe(200);
    // O link vale uma vez só; o segredo fica cifrado no banco.
    expect((await api(amb, 'GET', `/auth/ativar/${token}`)).statusCode).toBe(410);
    const guardado = amb.plataforma.banco.um<{ s: string }>('SELECT totp_segredo AS s FROM pessoas_starta')!.s;
    expect(guardado).not.toContain(aberta.segredo);
  });

  it('senha, depois código; 5 códigos errados recomeçam; o mesmo código não entra duas vezes', async () => {
    amb = await criarAmbiente();
    const g = await entrarNaPlataforma(amb);
    const email = 'gabriel@starta.com.br';

    expect((await api(amb, 'POST', '/auth/entrar', { email, senha: 'errada-123' })).statusCode).toBe(401);
    // Conta de empresa não entra na Plataforma.
    entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    expect((await api(amb, 'POST', '/auth/entrar', { email: 'rafael@horizonte.com.br', senha: 'copiloto123' })).statusCode).toBe(401);

    const etapa1 = await api(amb, 'POST', '/auth/entrar', { email, senha: g.senha });
    expect(etapa1.json<EntradaStarta>()).toEqual({ etapa: 'codigo', pessoa: { nome: 'Gabriel Moreno', iniciais: 'GM' } });
    const meio = cookieDe(etapa1);
    expect((await api(amb, 'GET', '/empresas', undefined, meio)).statusCode).toBe(401);

    const errado = await api(amb, 'POST', '/auth/codigo', { codigo: '000000' }, meio);
    expect(errado.json()).toEqual({ erro: 'codigo_incorreto', mensagem: 'Código incorreto. Restam 4 tentativas.', restantes: 4 });
    // O código usado na ativação (mesmo intervalo de 30 s) não vale de novo.
    expect((await api(amb, 'POST', '/auth/codigo', { codigo: codigoTotp(g.segredo) }, meio)).statusCode).toBe(400);
    avancar(31_000);
    const certo = await api(amb, 'POST', '/auth/codigo', { codigo: codigoTotp(g.segredo), confiarAparelho: false }, meio);
    expect(certo.statusCode, certo.body).toBe(200);
    expect(certo.json<EuStarta>().email).toBe(email);
    expect((await api(amb, 'GET', '/empresas', undefined, meio)).statusCode).toBe(200);

    // Outra entrada: 5 códigos errados derrubam a etapa e pedem a senha de novo.
    const outra = cookieDe(await api(amb, 'POST', '/auth/entrar', { email, senha: g.senha }));
    for (let i = 0; i < 4; i++) await api(amb, 'POST', '/auth/codigo', { codigo: '000000' }, outra);
    const quinto = await api(amb, 'POST', '/auth/codigo', { codigo: '000000' }, outra);
    expect(quinto.json()).toMatchObject({ erro: 'recomecar' });
    avancar(31_000);
    expect((await api(amb, 'POST', '/auth/codigo', { codigo: codigoTotp(g.segredo) }, outra)).statusCode).toBe(401);
  });

  it('código de recuperação vale uma vez; aparelho confiável pula o código por 30 dias', async () => {
    amb = await criarAmbiente();
    const g = await entrarNaPlataforma(amb);
    const email = 'gabriel@starta.com.br';
    const s1 = cookieDe(await api(amb, 'POST', '/auth/entrar', { email, senha: g.senha }));
    const rec = await api(amb, 'POST', '/auth/codigo', { codigo: g.codigos[0].toLowerCase(), tipo: 'recuperacao', confiarAparelho: true }, s1);
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.json<EuStarta>().codigosRecuperacao).toBe(9);
    const aparelho = cookieDe(rec, 'starta_aparelho');

    const s2 = cookieDe(await api(amb, 'POST', '/auth/entrar', { email, senha: g.senha }));
    const repetido = await api(amb, 'POST', '/auth/codigo', { codigo: g.codigos[0], tipo: 'recuperacao' }, s2);
    expect(repetido.json().mensagem).toBe('Código de recuperação incorreto ou já usado. Restam 4 tentativas.');

    // Com o cookie do aparelho, a senha basta.
    const direto = await amb.app.inject({ method: 'POST', url: '/api/plataforma/auth/entrar', payload: { email, senha: g.senha }, headers: { cookie: aparelho } });
    expect(direto.json<EntradaStarta>()).toMatchObject({ etapa: 'completa', eu: { email } });
    // Gerar códigos novos pede um código do aplicativo.
    const sessao = cookieDe(direto);
    expect((await api(amb, 'POST', '/auth/codigos-recuperacao', { codigo: '000000' }, sessao)).statusCode).toBe(400);
    avancar(31_000);
    const novos = await api(amb, 'POST', '/auth/codigos-recuperacao', { codigo: codigoTotp(g.segredo) }, sessao);
    expect(novos.json().codigosRecuperacao).toHaveLength(10);
    expect((await api(amb, 'GET', '/auth/eu', undefined, sessao)).json<EuStarta>().codigosRecuperacao).toBe(10);

    // Depois de 30 dias, o aparelho volta a pedir o código.
    avancar(31 * 86_400_000);
    const vencido = await amb.app.inject({ method: 'POST', url: '/api/plataforma/auth/entrar', payload: { email, senha: g.senha }, headers: { cookie: aparelho } });
    expect(vencido.json<EntradaStarta>().etapa).toBe('codigo');
  });

  it('5 senhas erradas bloqueiam por 15 minutos', async () => {
    amb = await criarAmbiente();
    const g = await entrarNaPlataforma(amb);
    for (let i = 0; i < 4; i++) expect((await api(amb, 'POST', '/auth/entrar', { email: 'gabriel@starta.com.br', senha: 'errada-1' })).statusCode).toBe(401);
    const bloqueio = await api(amb, 'POST', '/auth/entrar', { email: 'gabriel@starta.com.br', senha: 'errada-1' });
    expect(bloqueio.statusCode).toBe(423);
    expect((await api(amb, 'POST', '/auth/entrar', { email: 'gabriel@starta.com.br', senha: g.senha })).statusCode).toBe(423);
    avancar(16 * 60_000);
    expect((await api(amb, 'POST', '/auth/entrar', { email: 'gabriel@starta.com.br', senha: g.senha })).statusCode).toBe(200);
  });
});

describe('equipe Starta (Configurações)', () => {
  it('convida, redefine o acesso de outra pessoa e desativa; ninguém mexe no próprio acesso', async () => {
    amb = await criarAmbiente();
    const g = await entrarNaPlataforma(amb);
    const convite = await api(amb, 'POST', '/equipe', { nome: 'Milena Teodoro', email: 'milena@starta.com.br' }, g.cookie);
    expect(convite.statusCode, convite.body).toBe(200);
    const link = convite.json<LinkAtivacao>();
    expect(link).toMatchObject({ membro: { nome: 'Milena Teodoro', ativa: true, ativada: false }, envio: 'caixa_local' });
    const email = ultimoEmail(amb, 'milena@starta.com.br')!;
    expect(email.assunto).toBe('Ative o seu acesso à Plataforma Starta');
    expect(email.texto).toContain(link.link);
    expect((await api(amb, 'POST', '/equipe', { nome: 'Milena', email: 'milena@starta.com.br' }, g.cookie)).statusCode).toBe(409);

    const milena = await entrarNaPlataforma(amb, 'Milena Teodoro', 'milena@starta.com.br');
    expect((await api(amb, 'POST', `/equipe/${g.pessoaId}/redefinir`, undefined, g.cookie)).statusCode).toBe(409);
    // Milena redefine o acesso do Gabriel: a senha antiga e as sessões dele param na hora.
    const redefinido = await api(amb, 'POST', `/equipe/${g.pessoaId}/redefinir`, undefined, milena.cookie);
    expect(redefinido.json<LinkAtivacao>().membro).toMatchObject({ ativada: false });
    expect(ultimoEmail(amb, 'gabriel@starta.com.br')!.assunto).toBe('Redefina o seu acesso à Plataforma Starta');
    expect((await api(amb, 'GET', '/empresas', undefined, g.cookie)).statusCode).toBe(401);
    expect((await api(amb, 'POST', '/auth/entrar', { email: 'gabriel@starta.com.br', senha: g.senha })).statusCode).toBe(401);

    expect((await api(amb, 'POST', `/equipe/${milena.pessoaId}/desativar`, undefined, milena.cookie)).statusCode).toBe(409);
    const lista = (await api(amb, 'GET', '/equipe', undefined, milena.cookie)).json<MembroStarta[]>();
    expect(lista.map((m) => [m.nome, m.ativada])).toEqual([
      ['Gabriel Moreno', false],
      ['Milena Teodoro', true],
    ]);
  });
});

describe('empresas clientes (S7)', () => {
  async function comEmpresas(a: Ambiente) {
    const g = await entrarNaPlataforma(a);
    // Uma empresa cliente pelo cadastro, com o sistema e o widget no ar.
    const cadastro = await a.app.inject({
      method: 'POST',
      url: '/api/console/auth/cadastro',
      payload: {
        empresa: { nome: 'Clínica Mais Agenda', cnpj: '11.222.333/0001-81', faixaUsuarios: 'ate_200' },
        pessoa: { nome: 'Patrícia Nunes', email: 'patricia@clinicamais.com.br', senha: 'senha-forte-1' },
        aceites: { termos: true, dados: true },
      },
    });
    const luana = String(cadastro.headers['set-cookie']).split(';')[0];
    await a.app.inject({ method: 'POST', url: '/api/console/auth/email/confirmar', headers: { cookie: luana }, payload: { codigo: codigoEnviado(a, 'patricia@clinicamais.com.br') } });
    const empresaId = cadastro.json<Eu>().empresa.id;
    await a.app.inject({
      method: 'PUT',
      url: '/api/console/sistema/config',
      headers: { cookie: luana },
      payload: { nome: 'Agenda', url: 'https://agenda.clinicamais.com.br', acesso: { modo: 'sessao', urlSessao: '', urlLogin: '', usuario: '' }, perfis: [] },
    });
    // 30 dias de uso: "Remarcar consulta" consertou 12 vezes (quebrado), "Confirmar presença" 3.
    for (let i = 0; i < 20; i++) execucao(a, empresaId, { tarefaId: 'trf_remarcar', nome: 'Remarcar consulta', creditos: i < 12 ? 5 : 1, recuperacoes: i < 12 ? 1 : 0 });
    for (let i = 0; i < 10; i++) execucao(a, empresaId, { tarefaId: 'trf_confirmar', nome: 'Confirmar presença', creditos: i < 3 ? 5 : 1, recuperacoes: i < 3 ? 1 : 0 });
    execucao(a, empresaId, { tarefaId: 'trf_confirmar', nome: 'Confirmar presença', status: 'falhou', creditos: 0 });
    execucao(a, empresaId, { tarefaId: 'trf_confirmar', nome: 'Confirmar presença', creditos: 1, dias: 40 });
    return { g, empresaId, patricia: luana };
  }

  it('lista com métricas e nunca o conteúdo; o painel da empresa mostra a implantação', async () => {
    amb = await criarAmbiente({ semear: true });
    const { g, empresaId } = await comEmpresas(amb);
    const painel = (await api(amb, 'GET', '/empresas', undefined, g.cookie)).json<PainelEmpresas>();
    expect(painel.empresas.map((e) => [e.nome, e.situacao])).toEqual([
      ['Horizonte', 'ativo'],
      ['Clínica Mais Agenda', 'implantacao'],
    ]);
    const clinica = painel.empresas[1];
    expect(clinica).toMatchObject({ iniciais: 'CM', execucoes30d: 31, creditos30d: 12 * 5 + 8 + 3 * 5 + 7, fluxosQuebrados: 1, plano: null, responsavel: null });
    expect(clinica.sucesso30d).toBeCloseTo(30 / 31, 5);
    expect(painel.resumo).toMatchObject({ ativas: 1, emImplantacao: 1, pausadas: 0, emPiloto: { total: 0, nomes: [] } });
    expect(JSON.stringify(painel)).not.toMatch(/pedido|mensagens|conversa|segredo|sw_/);
    // Sem preço do crédito definido, a margem fica em aberto.
    expect(painel.resumo.margemPorCredito).toBeNull();

    // A Starta acompanha: piloto no plano Piloto, com responsável, meta de 3 tarefas e reunião marcada.
    const acompanhado = await api(
      amb,
      'PUT',
      `/empresas/${empresaId}`,
      { fase: 'piloto', planoId: 'piloto', responsavelStarta: g.pessoaId, metaTarefas: 3, avaliacaoPilotoEm: '2026-10-22' },
      g.cookie,
    );
    expect(acompanhado.statusCode, acompanhado.body).toBe(200);
    const detalhe = acompanhado.json<DetalheEmpresaStarta>();
    expect(detalhe).toMatchObject({
      situacao: 'piloto',
      plano: { id: 'piloto', nome: 'Piloto' },
      limiteUsuarios: 200,
      responsavel: { nome: 'Gabriel Moreno' },
      dominio: 'agenda.clinicamais.com.br',
      acesso: 'sessao',
      adminEmpresa: { nome: 'Patrícia Nunes', email: 'patricia@clinicamais.com.br' },
    });
    expect(detalhe.implantacao.map((e) => [e.chave, e.titulo, e.feita])).toEqual([
      ['contrato', 'Contrato e LGPD assinados', true],
      ['sistema', 'Sistema conectado', true],
      ['marca', 'Marca e widget no ar', false],
      ['tarefas', 'Tarefas publicadas: 0 de 3', false],
      ['avaliacao', 'Avaliação do piloto', false],
    ]);
    expect(detalhe.implantacao[1].detalhe).toBe('widget assinado pelo sistema');
    expect(detalhe.implantacao[4].detalhe).toBe('Reunião em 22/10/2026 com a empresa');
    expect(detalhe.fluxosComConserto.map((f) => [f.nome, f.consertos30d, f.quebrado])).toEqual([
      ['Remarcar consulta', 12, true],
      ['Confirmar presença', 3, false],
    ]);
    expect(amb.plataforma.contexto(empresaId).auditoria.listar()[0]).toMatchObject({ ator: 'Gabriel Moreno (Starta)', acao: 'mudou o plano da empresa', detalhe: 'Plano Piloto' });

    // Com o preço do crédito, a margem sai do custo real (IA + navegador) por crédito.
    expect((await api(amb, 'PUT', '/planos/piloto', { precoCreditoExtraCentavos: 40 }, g.cookie)).statusCode).toBe(200);
    const resumo = (await api(amb, 'GET', '/empresas', undefined, g.cookie)).json<PainelEmpresas>().resumo;
    expect(resumo.emPiloto).toEqual({ total: 1, nomes: ['Clínica Mais Agenda'] });
    // A demonstração gastou créditos sem plano: a margem fica em aberto até ela ter plano com preço.
    expect(resumo.margemPorCredito).toBeNull();
    await api(amb, 'PUT', `/empresas/${amb.ctx.empresa.id}`, { planoId: 'piloto' }, g.cookie);
    const margem = (await api(amb, 'GET', '/empresas', undefined, g.cookie)).json<PainelEmpresas>().resumo.margemPorCredito;
    expect(margem).not.toBeNull();
    expect(margem!).toBeLessThan(0.4);

    const uso = (await api(amb, 'GET', '/uso', undefined, g.cookie)).json<UsoPlataforma>();
    const usoClinica = uso.empresas.find((e) => e.empresaId === empresaId)!;
    expect(usoClinica).toMatchObject({ execucoes: 31, creditos: 90, creditosConserto: 75, creditosRoteiro: 15, custoNavegador: 3.1, receitaCreditos: 36 });
    const saude = (await api(amb, 'GET', '/saude', undefined, g.cookie)).json<SaudeFluxo[]>();
    expect(saude[0]).toMatchObject({ empresa: 'Clínica Mais Agenda', nome: 'Remarcar consulta', quebrado: true, execucoes30d: 20 });
    expect((await api(amb, 'GET', '/implantacoes', undefined, g.cookie)).json<DetalheEmpresaStarta[]>().map((e) => e.nome)).toEqual(['Clínica Mais Agenda']);
  });

  it('sugerir regravação avisa os Admins; pausar derruba o acesso e fica na auditoria', async () => {
    amb = await criarAmbiente();
    const { g, empresaId, patricia } = await comEmpresas(amb);
    const r = await api(amb, 'POST', `/empresas/${empresaId}/regravar`, { tarefaId: 'trf_remarcar' }, g.cookie);
    expect(r.json()).toEqual({ enviadosPara: 1, envio: 'caixa_local' });
    const email = ultimoEmail(amb, 'patricia@clinicamais.com.br')!;
    expect(email.assunto).toBe('Sugestão da Starta: regravar o fluxo “Remarcar consulta”');
    expect(email.texto).toContain('/tarefas/trf_remarcar');

    const pausada = await api(amb, 'PUT', `/empresas/${empresaId}/status`, { status: 'suspensa' }, g.cookie);
    expect(pausada.json<DetalheEmpresaStarta>()).toMatchObject({ situacao: 'pausado' });
    expect(pausada.json<DetalheEmpresaStarta>().suspensaEm).toBeTruthy();
    expect((await amb.app.inject({ method: 'GET', url: '/api/console/auth/eu', headers: { cookie: patricia } })).statusCode).toBe(401);
    expect((await api(amb, 'POST', `/empresas/${empresaId}/suporte`, { motivo: 'Diagnóstico do fluxo de remarcação' }, g.cookie)).statusCode).toBe(409);
    await api(amb, 'PUT', `/empresas/${empresaId}/status`, { status: 'ativa' }, g.cookie);
    expect(amb.plataforma.contexto(empresaId).auditoria.listar().slice(0, 3).map((x) => x.acao)).toEqual([
      'reativou a empresa',
      'pausou a empresa',
      'sugeriu regravar o fluxo',
    ]);
  });

  it('nova empresa: a Starta cria o espaço e o primeiro Admin entra pelo convite', async () => {
    amb = await criarAmbiente();
    const g = await entrarNaPlataforma(amb);
    expect((await api(amb, 'POST', '/empresas', { nome: 'RotaCerta', cnpj: '11.222.333/0001-80', admin: { email: 'ti@rotacerta.com.br' } }, g.cookie)).statusCode).toBe(400);
    const r = await api(amb, 'POST', '/empresas', { nome: 'RotaCerta Logística', planoId: 'crescimento', admin: { email: 'ti@rotacerta.com.br' } }, g.cookie);
    expect(r.statusCode, r.body).toBe(200);
    const nova = r.json<NovaEmpresaStarta>();
    expect(nova.empresa).toMatchObject({ situacao: 'implantacao', plano: { nome: 'Crescimento' }, responsavel: { nome: 'Gabriel Moreno' } });
    expect(nova.empresa.implantacao[0]).toMatchObject({ chave: 'contrato', feita: false });
    expect(ultimoEmail(amb, 'ti@rotacerta.com.br')!.texto).toContain(nova.linkConvite);

    const token = nova.linkConvite.split('/convite/')[1];
    const aceito = await amb.app.inject({ method: 'POST', url: `/api/console/auth/convite/${token}`, payload: { nome: 'Talita Inácio', senha: 'senha-forte-1' } });
    expect(aceito.statusCode, aceito.body).toBe(200);
    expect(aceito.json<Eu>()).toMatchObject({ perfil: 'admin', empresa: { nome: 'RotaCerta Logística' } });

    // Contrato assinado fora do cadastro: a Starta registra a data.
    const assinado = await api(amb, 'PUT', `/empresas/${nova.empresa.id}`, { contratoAssinadoEm: '2026-10-15' }, g.cookie);
    expect(assinado.json<DetalheEmpresaStarta>().implantacao[0]).toMatchObject({ feita: true, quando: '2026-10-15T12:00:00.000Z' });
  });
});

describe('modo suporte', () => {
  it('entra com motivo e perfil Suporte, avisa os Admins, fica na auditoria e sai na hora', async () => {
    amb = await criarAmbiente();
    const g = await entrarNaPlataforma(amb);
    const admin = entrarComo(amb.ctx, 'admin', 'Rafael Lima', 'rafael@horizonte.com.br');
    expect((await api(amb, 'POST', `/empresas/${amb.ctx.empresa.id}/suporte`, { motivo: 'curto' }, g.cookie)).statusCode).toBe(400);
    const r = await api(amb, 'POST', `/empresas/${amb.ctx.empresa.id}/suporte`, { motivo: 'A empresa pediu ajuda com o fluxo de chamados' }, g.cookie);
    expect(r.statusCode, r.body).toBe(200);
    const aberto = r.json<SuporteAberto>();
    expect(aberto.acesso).toMatchObject({ pessoa: 'Gabriel Moreno', empresa: 'Horizonte', motivo: 'A empresa pediu ajuda com o fluxo de chamados' });
    const suporte = cookieDe(r, 'copiloto_sessao');
    expect(suporte).toMatch(/^copiloto_sessao=sup\./);

    const eu = (await amb.app.inject({ method: 'GET', url: '/api/console/auth/eu', headers: { cookie: suporte } })).json<Eu>();
    expect(eu).toMatchObject({ nome: 'Gabriel Moreno (Starta)', perfil: 'suporte', empresa: { nome: 'Horizonte' }, modoSuporte: { pessoa: 'Gabriel Moreno' } });
    expect(eu.empresas).toHaveLength(1);
    // Perfil Suporte: vê e opera, não edita nem administra.
    expect((await amb.app.inject({ method: 'GET', url: '/api/console/execucoes', headers: { cookie: suporte } })).statusCode).toBe(200);
    expect((await amb.app.inject({ method: 'POST', url: '/api/console/equipe/convites', headers: { cookie: suporte }, payload: { email: 'x@x.com.br', perfil: 'leitor' } })).statusCode).toBe(403);
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ ator: 'Gabriel Moreno (Starta)', acao: 'entrou como suporte', detalhe: 'Motivo: A empresa pediu ajuda com o fluxo de chamados' });
    const aviso = ultimoEmail(amb, admin.email)!;
    expect(aviso.assunto).toBe('A equipe Starta entrou no Copiloto da Horizonte como suporte');
    expect(aviso.texto).toContain('Motivo informado: A empresa pediu ajuda com o fluxo de chamados');

    expect((await amb.app.inject({ method: 'POST', url: '/api/console/auth/sair', headers: { cookie: suporte } })).statusCode).toBe(200);
    expect((await amb.app.inject({ method: 'GET', url: '/api/console/auth/eu', headers: { cookie: suporte } })).statusCode).toBe(401);
    expect(amb.ctx.auditoria.listar()[0]).toMatchObject({ acao: 'saiu do modo suporte' });

    // O acesso vence sozinho em 60 minutos.
    const outro = cookieDe(await api(amb, 'POST', `/empresas/${amb.ctx.empresa.id}/suporte`, { motivo: 'Diagnóstico de um fluxo que falhou' }, g.cookie), 'copiloto_sessao');
    avancar(61 * 60_000);
    expect((await amb.app.inject({ method: 'GET', url: '/api/console/auth/eu', headers: { cookie: outro } })).statusCode).toBe(401);
    const lista = (await api(amb, 'GET', '/suporte', undefined, cookieDe(await api(amb, 'POST', '/auth/entrar', { email: 'gabriel@starta.com.br', senha: g.senha }))));
    expect(lista.statusCode).toBe(401);
    void agoraIso;
  });
});

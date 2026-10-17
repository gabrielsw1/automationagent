import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ARTIGOS } from '../src/ajuda/artigos.ts';
import { enviarForm, entrar, json, novoApp, pdfValido, snippetEsperado, tela } from './apoio.ts';

let app: FastifyInstance;

beforeEach(() => {
  app = novoApp();
});

afterEach(async () => {
  await app.close();
});

/** Confere que existe <label for="id">rótulo</label> e um campo com esse id e name. */
function temCampo(html: string, rotulo: string, name: string, tag = 'input', id = name): void {
  expect(html, `rótulo ${rotulo}`).toContain(`<label for="${id}">${rotulo}</label>`);
  expect(html, `campo ${name}`).toMatch(new RegExp(`<${tag} id="${id}" name="${name}"`));
}

describe('login de demonstração e layout', () => {
  it('mostra a lista de pessoas em /entrar, sem o snippet', async () => {
    const r = await tela(app, '/entrar');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<body data-pagina="Entrar">');
    for (const id of ['101', '102', '103', '104', '105', '106', '107']) expect(r.body).toContain(`name="usuario_id" value="${id}"`);
    expect(r.body).not.toContain('copiloto.js');
  });

  it('redireciona para /entrar guardando o endereço e volta depois do login', async () => {
    const r = await tela(app, '/clientes/novo?copiloto_gravacao=abc');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/entrar?voltar=%2Fclientes%2Fnovo%3Fcopiloto_gravacao%3Dabc');
    const login = await enviarForm(app, '/entrar', { usuario_id: '101', voltar: '/clientes/novo?copiloto_gravacao=abc' });
    expect(login.statusCode).toBe(303);
    expect(login.headers.location).toBe('/clientes/novo?copiloto_gravacao=abc');
    expect(login.cookies.find((c) => c.name === 'hz_sessao')?.httpOnly).toBe(true);
    const externo = await enviarForm(app, '/entrar', { usuario_id: '101', voltar: '//exemplo.com' });
    expect(externo.headers.location).toBe('/clientes');
  });

  it('inclui cabeçalho com a pessoa, "Trocar usuário" e o snippet assinado', async () => {
    for (const id of ['101', '105']) {
      const cookie = await entrar(app, id);
      const r = await tela(app, '/clientes', cookie);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<body data-pagina="Clientes">');
      expect(r.body).toContain('Trocar usuário');
      expect(r.body).toContain(snippetEsperado(id));
      expect(r.body.trimEnd().endsWith(`${snippetEsperado(id)}\n</body>\n</html>`)).toBe(true);
    }
    const sair = await tela(app, '/sair', await entrar(app, '101'));
    expect(sair.headers.location).toBe('/entrar');
  });

  it('usa COPILOTO_URL, COPILOTO_CHAVE e WIDGET_SEGREDO configurados', async () => {
    const outro = novoApp({ copilotoUrl: 'https://copiloto.exemplo.com/', copilotoChave: 'pk_teste', widgetSegredo: 'outro-segredo' });
    const cookie = await entrar(outro, '103');
    const r = await tela(outro, '/clientes', cookie);
    const crypto = await import('node:crypto');
    const ass = crypto.createHmac('sha256', 'outro-segredo').update('103').digest('hex');
    expect(r.body).toContain(
      `<script src="https://copiloto.exemplo.com/copiloto.js" data-chave="pk_teste" data-usuario="103" data-assinatura="${ass}" async></script>`,
    );
    await outro.close();
  });

  it('todas as páginas principais têm data-pagina e o snippet', async () => {
    const cookie = await entrar(app, '105');
    const paginas: [string, string][] = [
      ['/clientes', 'Clientes'],
      ['/clientes/3190', 'Clientes'],
      ['/clientes/novo', 'Clientes'],
      ['/clientes/3190/editar', 'Clientes'],
      ['/financeiro/segunda-via', 'Financeiro'],
      ['/agenda', 'Agenda'],
      ['/agenda/nova-visita', 'Agenda'],
      ['/agenda/visitas/400', 'Agenda'],
      ['/relatorios', 'Relatórios'],
      ['/chamados', 'Chamados'],
      ['/chamados/150', 'Chamados'],
      ['/ajuda', 'Ajuda'],
      [`/ajuda/${ARTIGOS[0].slug}`, 'Ajuda'],
    ];
    for (const [url, secao] of paginas) {
      const r = await tela(app, url, cookie);
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toContain(`<body data-pagina="${secao}">`);
      expect(r.body, url).toContain(snippetEsperado('105'));
    }
    const naoExiste = await tela(app, '/clientes/1', cookie);
    expect(naoExiste.statusCode).toBe(404);
  });
});

describe('clientes', () => {
  it('formulário de novo cliente com rótulos e names estáveis', async () => {
    const cookie = await entrar(app, '101');
    const r = await tela(app, '/clientes/novo', cookie);
    temCampo(r.body, 'Razão social', 'razao_social');
    temCampo(r.body, 'CNPJ', 'cnpj');
    temCampo(r.body, 'E-mail de cobrança', 'email_cobranca');
    temCampo(r.body, 'Prazo de pagamento', 'prazo_pagamento_dias', 'select');
    temCampo(r.body, 'Responsável', 'responsavel_id', 'select');
    for (const p of [15, 30, 45, 60]) expect(r.body).toContain(`<option value="${p}">${p} dias</option>`);
    expect(r.body).toContain('<option value="101" selected>Ana Ribeiro</option>');
    expect(r.body).toContain('<button type="submit" class="btn">Salvar cliente</button>');
  });

  it('mostra os erros de validação na própria tela', async () => {
    const cookie = await entrar(app, '101');
    const r = await enviarForm(app, '/clientes/novo', { razao_social: '', cnpj: '123', email_cobranca: 'x', prazo_pagamento_dias: '', responsavel_id: '101' }, cookie);
    expect(r.statusCode).toBe(422);
    expect(r.body).toContain('Informe a razão social.');
    expect(r.body).toContain('O CNPJ precisa ter 14 números');
    expect(r.body).toContain('Digite um e-mail completo');
    expect(r.body).toContain('Escolha o prazo de pagamento');
    expect(r.body).toContain('aria-invalid="true"');
    expect(r.body).toContain('value="123"');
  });

  it('avisa CNPJ já cadastrado com link para o cliente existente', async () => {
    const cookie = await entrar(app, '101');
    const r = await enviarForm(
      app,
      '/clientes/novo',
      { razao_social: 'ACME Logística', cnpj: '12.345.678/0001-95', email_cobranca: 'financeiro@acmelog.com.br', prazo_pagamento_dias: '30', responsavel_id: '101' },
      cookie,
    );
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('href="/clientes/3190"');
    expect(r.body).toContain('Já existe um cliente com o CNPJ 12.345.678/0001-95');
  });

  it('cadastra e abre a ficha com o código', async () => {
    const cookie = await entrar(app, '101');
    const r = await enviarForm(
      app,
      '/clientes/novo',
      { razao_social: 'ACME Logística', cnpj: '11.222.333/0001-81', email_cobranca: 'financeiro@acmelog.com.br', prazo_pagamento_dias: '30', responsavel_id: '101' },
      cookie,
    );
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('/clientes/4821?criado=1');
    const ficha = await tela(app, '/clientes/4821?criado=1', cookie);
    expect(ficha.body).toContain('<span class="codigo" data-campo="codigo">#4821</span>');
    expect(ficha.body.match(/data-campo="codigo"/g)).toHaveLength(1);
    expect(ficha.body).toContain('Cliente cadastrado com o código');
    expect(ficha.body).toContain('<dd data-campo="razao_social">ACME Logística</dd>');
  });

  it('nega o cadastro a quem não tem perfil, na tela', async () => {
    const cookie = await entrar(app, '102');
    const form = await tela(app, '/clientes/novo', cookie);
    expect(form.body).toContain('Seu perfil não permite cadastrar ou alterar clientes');
    const r = await enviarForm(
      app,
      '/clientes/novo',
      { razao_social: 'ACME Logística', cnpj: '11.222.333/0001-81', email_cobranca: 'financeiro@acmelog.com.br', prazo_pagamento_dias: '30', responsavel_id: '102' },
      cookie,
    );
    expect(r.statusCode).toBe(403);
    expect(r.body).toContain('Seu perfil não permite cadastrar ou alterar clientes');
  });

  it('altera e desfaz o plano pela ficha (Gestor financeiro)', async () => {
    const cookie = await entrar(app, '105');
    const r = await enviarForm(app, '/clientes/3190/plano', { plano: 'Premium', a_partir_de: '2026-10-16' }, cookie);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Plano alterado de Básico para <strong>Premium</strong>');
    const desfazer = r.body.match(/action="(\/clientes\/3190\/plano\/\d+\/desfazer)"/);
    expect(desfazer).not.toBeNull();
    const d = await enviarForm(app, desfazer![1], {}, cookie);
    expect(d.body).toContain('o plano voltou para <strong>Básico</strong>');
    const ana = await tela(app, '/clientes/3190', await entrar(app, '101'));
    expect(ana.body).toContain('Alterar o plano exige o perfil Gestor financeiro ou Administradores');
    expect(ana.body).not.toContain('action="/clientes/3190/plano"');
  });
});

describe('financeiro › segunda via de boletos', () => {
  it('tem o formulário com doc_pagador e as últimas 12 competências', async () => {
    const cookie = await entrar(app, '102');
    const r = await tela(app, '/financeiro/segunda-via', cookie);
    expect(r.body).toContain('<body data-pagina="Financeiro">');
    temCampo(r.body, 'CPF/CNPJ do pagador', 'doc_pagador');
    temCampo(r.body, 'Competência', 'competencia', 'select');
    const opcoes = [...r.body.matchAll(/<option value="(\d{2}\/\d{4})"/g)].map((m) => m[1]);
    expect(opcoes).toHaveLength(12);
    expect(opcoes.slice(0, 3)).toEqual(['10/2026', '09/2026', '08/2026']);
    expect(opcoes[11]).toBe('11/2025');
    expect(r.body).toContain('<option value="10/2026" selected>');
    expect(r.body).toContain('>Buscar boletos</button>');
    expect(r.body).toContain('<a href="/financeiro/segunda-via">Boletos</a>');
  });

  it('busca boletos de Transportes Vale e da Clínica Bem Viver', async () => {
    const cookie = await entrar(app, '102');
    for (const [doc, nome] of [
      ['18.473.629/0001-14', 'Transportes Vale Ltda'],
      ['21950378000126', 'Clínica Bem Viver Ltda'],
    ]) {
      for (const competencia of ['10/2026', '09/2026', '08/2026']) {
        const r = await enviarForm(app, '/financeiro/segunda-via', { doc_pagador: doc, competencia }, cookie);
        expect(r.statusCode).toBe(200);
        expect(r.body, `${nome} ${competencia}`).toContain(nome);
        expect(r.body.match(/>Gerar 2ª via<\/button>/g), `${nome} ${competencia}`).toHaveLength(1);
      }
    }
  });

  it('mostra a mensagem de nenhum boleto e erros de documento', async () => {
    const cookie = await entrar(app, '102');
    const nada = await enviarForm(app, '/financeiro/segunda-via', { doc_pagador: '11.222.333/0001-81', competencia: '10/2026' }, cookie);
    expect(nada.body).toContain('Nenhum boleto encontrado para este pagador e competência.');
    const invalido = await enviarForm(app, '/financeiro/segunda-via', { doc_pagador: '123.456.789-00', competencia: '10/2026' }, cookie);
    expect(invalido.statusCode).toBe(422);
    expect(invalido.body).toContain('Esse CPF não é válido');
    const cpf = await enviarForm(app, '/financeiro/segunda-via', { doc_pagador: '384.915.276-64', competencia: '10/2026' }, cookie);
    expect(cpf.body).toContain('Mariana Couto Ferreira');
  });

  it('gera a 2ª via: linha digitável e PDF boleto-<numero>.pdf', async () => {
    const cookie = await entrar(app, '102');
    const busca = await enviarForm(app, '/financeiro/segunda-via', { doc_pagador: '18473629000114', competencia: '09/2026' }, cookie);
    const numero = busca.body.match(/name="gerar" value="(\d+)"/)![1];
    const r = await app.inject({ method: 'POST', url: `/financeiro/boletos/${numero}/segunda-via`, headers: { cookie, accept: 'application/json' } });
    expect(r.statusCode).toBe(200);
    const via = json<{ linha_digitavel: string; url: string; nome_arquivo: string; html: string; situacao: string; valor: number }>(r);
    expect(via.linha_digitavel.replace(/\D/g, '')).toHaveLength(47);
    expect(via.situacao).toBe('Vencido');
    expect(via.valor).toBeGreaterThan(389.9);
    expect(via.nome_arquivo).toBe(`boleto-${numero}.pdf`);
    expect(via.html).toContain(`<code class="linha-digitavel" data-campo="linha_digitavel">${via.linha_digitavel}</code>`);
    expect(via.html).toContain(`data-campo="numero_boleto">${numero}<`);

    const pdf = await tela(app, via.url, cookie);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="boleto-${numero}.pdf"`);
    expect(pdfValido(pdf.rawPayload)).toBe(true);
    const texto = pdf.rawPayload.toString('latin1');
    expect(texto).toContain('Transportes Vale Ltda');
    expect(texto).toContain(via.linha_digitavel);

    // Sem JavaScript: o mesmo botão (formulário) mostra o resultado na página.
    const semJs = await enviarForm(app, '/financeiro/segunda-via', { gerar: numero, filtro_doc: '18473629000114', filtro_competencia: '09/2026' }, cookie);
    expect(semJs.body).toContain('data-campo="linha_digitavel"');
    expect(semJs.body).toContain(`href="/financeiro/boletos/${numero}/segunda-via.pdf"`);
  });

  it('nega a segunda via a quem não tem perfil', async () => {
    const cookie = await entrar(app, '103');
    const r = await tela(app, '/financeiro/segunda-via', cookie);
    expect(r.body).toContain('Seu perfil não permite emitir segunda via de boletos');
    const busca = await enviarForm(app, '/financeiro/segunda-via', { doc_pagador: '18473629000114', competencia: '10/2026' }, cookie);
    expect(busca.statusCode).toBe(403);
  });
});

describe('agenda', () => {
  it('tela de nova visita com os campos do fluxo gravado', async () => {
    const cookie = await entrar(app, '101');
    const r = await tela(app, '/agenda/nova-visita', cookie);
    expect(r.body).toContain('<body data-pagina="Agenda">');
    temCampo(r.body, 'Cliente', 'cliente');
    expect(r.body).toMatch(/<input id="cliente" name="cliente" type="text" value="" list="lista-clientes"/);
    expect(r.body).toContain('<option value="ACME Log Ltda">');
    temCampo(r.body, 'Data da visita', 'data_visita');
    expect(r.body).toContain('name="data_visita" type="date"');
    temCampo(r.body, 'Horário', 'horario', 'select');
    for (const h of ['08:00', '12:00', '17:00']) expect(r.body).toContain(`<option value="${h}">${h}</option>`);
    expect(r.body).not.toContain('<option value="18:00">');
    temCampo(r.body, 'Técnico', 'tecnico', 'select');
    for (const t of ['Carlos Mendes', 'Fernanda Lopes', 'João Pereira', 'Primeiro disponível']) expect(r.body).toContain(`<option value="${t}"`);
    temCampo(r.body, 'Observações', 'observacoes', 'textarea');
    expect(r.body).toContain('<button type="submit" class="btn">Agendar visita</button>');
  });

  it('agenda a visita e mostra o protocolo', async () => {
    const cookie = await entrar(app, '101');
    const r = await enviarForm(
      app,
      '/agenda/nova-visita',
      { cliente: 'ACME Log Ltda', data_visita: '2026-10-22', horario: '14:00', tecnico: 'Primeiro disponível', observacoes: 'Implantação' },
      cookie,
    );
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('/agenda/visitas/412?agendada=1');
    const v = await tela(app, '/agenda/visitas/412', cookie);
    expect(v.body).toContain('<dd class="codigo" data-campo="protocolo">VT-2026-0412</dd>');
    expect(v.body.match(/data-campo="protocolo"/g)).toHaveLength(1);
  });

  it('mostra erros de data, cliente e técnico ocupado na tela', async () => {
    const cookie = await entrar(app, '104');
    const fimDeSemana = await enviarForm(app, '/agenda/nova-visita', { cliente: 'Loja Aurora', data_visita: '2026-10-24', horario: '09:00', tecnico: 'Carlos Mendes' }, cookie);
    expect(fimDeSemana.statusCode).toBe(422);
    expect(fimDeSemana.body).toContain('Não fazemos visitas aos sábados e domingos');
    const passado = await enviarForm(app, '/agenda/nova-visita', { cliente: 'Nome que não existe', data_visita: '2026-10-01', horario: '09:00' }, cookie);
    expect(passado.body).toContain('A data da visita não pode estar no passado.');
    expect(passado.body).toContain('Cliente não encontrado');
    const ambiguo = await enviarForm(app, '/agenda/nova-visita', { cliente: 'Transportes', data_visita: '2026-10-21', horario: '09:00' }, cookie);
    expect(ambiguo.body).toContain('Mais de um cliente com esse nome');
    const dados = { cliente: 'Loja Aurora', data_visita: '2026-10-27', horario: '10:00', tecnico: 'Carlos Mendes' };
    expect((await enviarForm(app, '/agenda/nova-visita', dados, cookie)).statusCode).toBe(303);
    const ocupado = await enviarForm(app, '/agenda/nova-visita', { ...dados, cliente: 'Pólen Café' }, cookie);
    expect(ocupado.statusCode).toBe(422);
    expect(ocupado.body).toContain('Carlos Mendes já tem uma visita em 27/10/2026 às 10:00');
  });

  it('com a tela nova (tela_agendamento_v2) muda o rótulo, o name e o botão', async () => {
    await app.inject({ method: 'POST', url: '/_demo/estado', payload: { tela_agendamento_v2: true } });
    const cookie = await entrar(app, '101');
    const r = await tela(app, '/agenda/nova-visita', cookie);
    temCampo(r.body, 'Data', 'dt_visita');
    expect(r.body).not.toContain('name="data_visita"');
    expect(r.body).not.toContain('Data da visita');
    expect(r.body).toContain('>Confirmar agendamento</button>');
    expect(r.body).not.toContain('>Agendar visita</button>');
    const ok = await enviarForm(app, '/agenda/nova-visita', { cliente: 'Farmácia Central Ltda', dt_visita: '2026-10-23', horario: '11:00', tecnico: 'Fernanda Lopes' }, cookie);
    expect(ok.statusCode).toBe(303);
    const erro = await enviarForm(app, '/agenda/nova-visita', { cliente: 'Farmácia Central Ltda', dt_visita: '', horario: '11:00' }, cookie);
    expect(erro.body).toContain('id="erro-dt_visita"');
    // Pela página do painel (formulário), volta à tela antiga.
    const desliga = await enviarForm(app, '/_demo/estado', { tela_agendamento_v2: '0' });
    expect(desliga.statusCode).toBe(303);
    expect((await tela(app, '/agenda/nova-visita', cookie)).body).toContain('name="data_visita"');
  });
});

describe('relatórios, chamados, ajuda e demonstração', () => {
  it('gera relatório pela tela', async () => {
    const cookie = await entrar(app, '103');
    const r = await enviarForm(app, '/relatorios', { periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31', agrupar_por: 'produto', formato: 'pdf' }, cookie);
    expect(r.statusCode).toBe(303);
    const pagina = await tela(app, r.headers.location as string, cookie);
    expect(pagina.body).toContain('data-campo="arquivo_relatorio"');
    const invalido = await enviarForm(app, '/relatorios', { periodo_inicio: '', periodo_fim: '2026-08-31', agrupar_por: 'produto', formato: 'pdf' }, cookie);
    expect(invalido.statusCode).toBe(422);
    expect(invalido.body).toContain('Informe o início do período.');
  });

  it('abre chamado pela tela', async () => {
    const cookie = await entrar(app, '107');
    const r = await enviarForm(app, '/chamados', { assunto: 'Nobreak apitando', cliente: 'Escola Raízes', prioridade: 'Alta', descricao: 'O nobreak da secretaria apita sem parar.' }, cookie);
    expect(r.statusCode).toBe(303);
    const pagina = await tela(app, r.headers.location as string, cookie);
    expect(pagina.body).toContain('data-campo="numero_chamado">CH-2026-0153<');
  });

  it('central de ajuda é pública, com 8 a 10 artigos e sem artigo de cancelamento', async () => {
    expect(ARTIGOS.length).toBeGreaterThanOrEqual(8);
    expect(ARTIGOS.length).toBeLessThanOrEqual(10);
    const titulos = ARTIGOS.map((a) => a.titulo);
    for (const t of [
      'Como emitir a segunda via de um boleto',
      'Como cadastrar um cliente',
      'Prazos de pagamento aceitos',
      'Como alterar o plano de um cliente',
      'Planos e preços',
      'Como agendar uma visita técnica',
      'Como abrir um chamado de suporte',
      'Relatórios de vendas',
      'Perfis de acesso',
    ]) {
      expect(titulos).toContain(t);
    }
    for (const a of ARTIGOS) {
      expect(`${a.titulo} ${a.corpo}`.toLowerCase()).not.toMatch(/cancel\w* (d[ae] )?(assinatura|contrato|plano)/);
    }
    const indice = await tela(app, '/ajuda');
    expect(indice.statusCode).toBe(200);
    expect(indice.body).toContain('<body data-pagina="Ajuda">');
    expect(indice.body).not.toContain('copiloto.js');
    for (const a of ARTIGOS) {
      expect(indice.body).toContain(`href="/ajuda/${a.slug}"`);
      const r = await tela(app, `/ajuda/${a.slug}`);
      expect(r.statusCode, a.slug).toBe(200);
      expect(r.body).toContain(`<h1>${a.titulo}</h1>`);
    }
    expect((await tela(app, '/ajuda/como-cancelar-a-assinatura')).statusCode).toBe(404);
    const prazos = await tela(app, '/ajuda/prazos-de-pagamento-aceitos');
    expect(prazos.body).toContain('15, 30, 45 ou 60 dias');
  });

  it('painel /_demo com interruptores e restauração', async () => {
    const r = await tela(app, '/_demo');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('API instável');
    expect(r.body).toContain('Tela de agendamento nova');
    expect(r.body).toContain('Restaurar dados iniciais');
    const liga = await enviarForm(app, '/_demo/estado', { api_instavel: '1' });
    expect(liga.statusCode).toBe(303);
    expect(json(await tela(app, '/_demo/estado'))).toEqual({ api_instavel: true, tela_agendamento_v2: false });
    const restaura = await enviarForm(app, '/_demo/restaurar', {});
    expect(restaura.headers.location).toBe('/_demo?ok=restaurado');
    expect(json(await tela(app, '/_demo/estado'))).toEqual({ api_instavel: false, tela_agendamento_v2: false });
  });

  it('CSS e ícone são servidos', async () => {
    const css = await tela(app, '/estatico/horizonte.css');
    expect(css.headers['content-type']).toContain('text/css');
    expect((await tela(app, '/estatico/icone.svg')).headers['content-type']).toContain('image/svg+xml');
  });
});

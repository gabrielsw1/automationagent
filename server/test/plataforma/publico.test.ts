// Rotas públicas do site (/api/publico): planos lidos da tabela (com e sem preço), pedido de contato
// (guardado, e-mail para vendas só com EMAIL_VENDAS, validação e limite por IP) e textos jurídicos
// (minutas de docs/legal ou os aprovados de TEXTOS_LEGAIS_DIR).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { precoEmReais, type ContatoPedido, type PlanosPublicos, type TextoLegal } from '@copiloto/shared';
import { versaoDosTermos } from '../../src/plataforma/textos.ts';
import { criarAmbiente, type Ambiente } from '../ajuda.ts';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.app.close();
  amb = undefined;
  vi.unstubAllEnvs();
});

const get = (a: Ambiente, url: string) => a.app.inject({ method: 'GET', url: `/api/publico${url}` });
const contato = (a: Ambiente, payload: object, ip = '200.10.20.30') =>
  a.app.inject({ method: 'POST', url: '/api/publico/contato', payload, remoteAddress: ip });

const PEDIDO: ContatoPedido = {
  nome: 'Luana Freitas',
  email: 'Luana@PedraBranca.com.br',
  empresa: 'Pedra Branca Distribuidora',
  telefone: '(51) 99999-0000',
  faixa: 'ate_1000',
  mensagem: 'Queremos testar com 50 clientes.',
  origem: 'demonstracao',
};

describe('planos do site', () => {
  it('vêm da tabela, na ordem do design, com os preços ainda não definidos', async () => {
    amb = await criarAmbiente();
    const r = await get(amb, '/planos');
    expect(r.statusCode).toBe(200);
    const { planos, valoresDeExemplo, cadastroAberto } = r.json<PlanosPublicos>();
    expect(valoresDeExemplo).toBe(true);
    expect(cadastroAberto).toBe(true);
    expect(planos.map((p) => [p.id, p.nome, p.usuariosMin, p.usuariosMax, p.creditosIncluidos, p.botao])).toEqual([
      ['piloto', 'Piloto', 1, 200, 3000, 'cadastro'],
      ['crescimento', 'Crescimento', 201, 1000, 15000, 'demonstracao'],
      ['escala', 'Escala', 1001, null, null, 'vendas'],
    ]);
    for (const p of planos) {
      expect([p.precoMensalCentavos, p.taxaImplantacaoCentavos, p.precoCreditoExtraCentavos]).toEqual([null, null, null]);
    }
    expect(planos[0]).toMatchObject({
      descricao: 'Para validar com um grupo de clientes, com a Starta ao seu lado.',
      notaPreco: 'mais taxa de implantação {implantacao}, cobrada uma vez',
      destaques: ['Implantação assistida: gravamos as primeiras tarefas com você', 'Assistente no seu sistema, com a sua marca'],
    });
    expect(planos[2].destaques).toEqual(['Vários sistemas no mesmo espaço', 'Acordo de nível de serviço e contato dedicado']);
  });

  it('com os preços definidos, o site deixa de dizer que os valores são de exemplo', async () => {
    amb = await criarAmbiente();
    const { plataforma } = amb;
    const antes = plataforma.plano('piloto')!.atualizadoEm;
    await new Promise((ok) => setTimeout(ok, 5));
    const piloto = plataforma.atualizarPrecosPlano('piloto', {
      precoMensalCentavos: 199_000,
      taxaImplantacaoCentavos: 450_000,
      precoCreditoExtraCentavos: 45,
    });
    expect(piloto).toMatchObject({ precoMensalCentavos: 199_000, taxaImplantacaoCentavos: 450_000, precoCreditoExtraCentavos: 45 });
    expect(piloto.atualizadoEm > antes).toBe(true);
    plataforma.atualizarPrecosPlano('crescimento', { precoMensalCentavos: 690_000, precoCreditoExtraCentavos: 40 });
    expect((await get(amb, '/planos')).json<PlanosPublicos>().valoresDeExemplo).toBe(true);

    // A taxa de implantação do Escala não aparece no cartão ("proposta conforme volume"): não conta.
    plataforma.atualizarPrecosPlano('escala', { precoMensalCentavos: 1_500_000, precoCreditoExtraCentavos: 35 });
    const r = (await get(amb, '/planos')).json<PlanosPublicos>();
    expect(r.valoresDeExemplo).toBe(false);
    expect(r.planos.map((p) => precoEmReais(p.precoMensalCentavos))).toEqual(['R$ 1.990', 'R$ 6.900', 'R$ 15.000']);
    expect(precoEmReais(45)).toBe('R$ 0,45');
    expect(precoEmReais(null)).toBeNull();

    // O que não vem fica como está; null volta a "Sob consulta".
    const so = plataforma.atualizarPrecosPlano('piloto', { precoCreditoExtraCentavos: null });
    expect(so).toMatchObject({ precoMensalCentavos: 199_000, taxaImplantacaoCentavos: 450_000, precoCreditoExtraCentavos: null });
    expect((await get(amb, '/planos')).json<PlanosPublicos>().valoresDeExemplo).toBe(true);

    expect(() => plataforma.atualizarPrecosPlano('piloto', { precoMensalCentavos: 19.9 })).toThrow(/centavos/);
    expect(() => plataforma.atualizarPrecosPlano('piloto', { precoMensalCentavos: -1 })).toThrow(/centavos/);
    expect(() => plataforma.atualizarPrecosPlano('ouro', { precoMensalCentavos: 1 })).toThrow(/não existe/);
  });

  it('com o cadastro fechado, o site fica sabendo', async () => {
    vi.stubEnv('COPILOTO_CADASTRO', 'fechado');
    amb = await criarAmbiente();
    expect((await get(amb, '/planos')).json<PlanosPublicos>().cadastroAberto).toBe(false);
  });
});

describe('pedido de contato', () => {
  it('fica guardado no banco da plataforma; sem EMAIL_VENDAS, nenhum e-mail sai', async () => {
    amb = await criarAmbiente();
    const r = await contato(amb, PEDIDO);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const [guardado] = amb.plataforma.contatos();
    expect(guardado).toMatchObject({
      nome: 'Luana Freitas',
      email: 'luana@pedrabranca.com.br',
      empresa: 'Pedra Branca Distribuidora',
      telefone: '(51) 99999-0000',
      faixa: 'ate_1000',
      mensagem: 'Queremos testar com 50 clientes.',
      origem: 'demonstracao',
      ip: '200.10.20.30',
    });
    expect(guardado.id).toMatch(/^ctt_/);
    expect(amb.correio.enviados).toEqual([]);

    // Opcionais em branco viram null; a lista vem com o mais novo primeiro.
    await contato(amb, { ...PEDIDO, empresa: 'Vetor CRM', telefone: '', mensagem: '  ', origem: 'vendas' });
    const lista = amb.plataforma.contatos();
    expect(lista.map((c) => c.empresa)).toEqual(['Vetor CRM', 'Pedra Branca Distribuidora']);
    expect(lista[0]).toMatchObject({ telefone: null, mensagem: null, origem: 'vendas' });
  });

  it('com EMAIL_VENDAS, avisa a equipe de vendas, com o "Responder" para quem pediu', async () => {
    vi.stubEnv('EMAIL_VENDAS', 'vendas@starta.site');
    amb = await criarAmbiente();
    expect((await contato(amb, PEDIDO)).statusCode).toBe(200);
    expect(amb.correio.enviados).toHaveLength(1);
    const email = amb.correio.enviados[0];
    expect(email).toMatchObject({
      para: 'vendas@starta.site',
      responderPara: 'luana@pedrabranca.com.br',
      assunto: 'Pedido de demonstração: Pedra Branca Distribuidora',
    });
    expect(email.texto).toContain('Nome: Luana Freitas');
    expect(email.texto).toContain('Telefone: (51) 99999-0000');
    expect(email.texto).toContain('Usuários do sistema: De 201 a 1.000 pessoas');
    expect(email.texto).toContain('Mensagem:\nQueremos testar com 50 clientes.');

    await contato(amb, { ...PEDIDO, origem: 'vendas', telefone: undefined, mensagem: undefined });
    expect(amb.correio.enviados[1].assunto).toBe('Contato com vendas: Pedra Branca Distribuidora');
    expect(amb.correio.enviados[1].texto).toContain('Telefone: não informado');
    expect(amb.correio.enviados[1].texto).toContain('Sem mensagem.');
  });

  it('se o e-mail falhar, o pedido continua guardado e a pessoa vê o sucesso', async () => {
    vi.stubEnv('EMAIL_VENDAS', 'vendas@starta.site');
    amb = await criarAmbiente();
    vi.spyOn(amb.plataforma.correio, 'enviar').mockRejectedValue(new Error('SMTP fora do ar'));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await contato(amb, PEDIDO)).statusCode).toBe(200);
    expect(amb.plataforma.contatos()).toHaveLength(1);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('valida os campos com mensagens em português', async () => {
    amb = await criarAmbiente();
    const casos: [object, string][] = [
      [{ ...PEDIDO, nome: ' ' }, 'Diga seu nome.'],
      [{ ...PEDIDO, email: 'luana@' }, 'Digite um e-mail completo, por exemplo nome@suaempresa.com.br'],
      [{ ...PEDIDO, empresa: undefined }, 'Diga o nome da empresa.'],
      [{ ...PEDIDO, empresa: 'Pedra\nBranca' }, 'Use uma linha só.'],
      [{ ...PEDIDO, telefone: '9999-0000' }, 'Digite o telefone com DDD, por exemplo (51) 99999-0000.'],
      [{ ...PEDIDO, faixa: 'muitos' }, 'Escolha quantos usuários o seu sistema tem.'],
      [{ ...PEDIDO, mensagem: 'x'.repeat(2001) }, 'A mensagem pode ter até 2.000 caracteres.'],
    ];
    for (const [payload, mensagem] of casos) {
      const r = await contato(amb, payload);
      expect(r.statusCode, mensagem).toBe(400);
      expect(r.json()).toEqual({ erro: 'pedido_invalido', mensagem });
    }
    expect((await contato(amb, { ...PEDIDO, origem: 'outro' })).statusCode).toBe(400);
    expect(amb.plataforma.contatos()).toEqual([]);
  });

  it('aceita 5 pedidos por hora de cada IP; o sexto recebe 429', async () => {
    amb = await criarAmbiente();
    // Pedidos inválidos não contam.
    expect((await contato(amb, { ...PEDIDO, nome: '' })).statusCode).toBe(400);
    for (let i = 0; i < 5; i++) expect((await contato(amb, { ...PEDIDO, empresa: `Empresa ${i}` })).statusCode).toBe(200);
    const r = await contato(amb, PEDIDO);
    expect(r.statusCode).toBe(429);
    const corpo = r.json();
    expect(corpo).toMatchObject({
      erro: 'muitos_pedidos',
      mensagem: 'Recebemos muitos pedidos deste endereço na última hora. Tente de novo em 60 min.',
    });
    expect(corpo.aguardarS).toBeGreaterThan(3500);
    expect(amb.plataforma.contatos()).toHaveLength(5);

    // Outro endereço segue livre.
    expect((await contato(amb, PEDIDO, '187.4.5.6')).statusCode).toBe(200);
  });
});

describe('textos jurídicos', () => {
  it('sem TEXTOS_LEGAIS_DIR, servem as minutas de docs/legal, com a versão do cabeçalho', async () => {
    amb = await criarAmbiente();
    for (const [documento, titulo] of [
      ['termos', '# Termos de uso'],
      ['privacidade', '# Política de privacidade'],
      ['contrato-lgpd', '# Contrato de tratamento de dados (LGPD)'],
    ]) {
      const r = await get(amb, `/textos/${documento}`);
      expect(r.statusCode).toBe(200);
      const texto = r.json<TextoLegal>();
      expect(texto).toMatchObject({ documento, fonte: 'minuta', versao: '2026-10-17' });
      // O cabeçalho (versão e o aviso de minuta) não vai para a página.
      expect(texto.markdown.startsWith(titulo)).toBe(true);
      expect(texto.markdown).not.toContain('versao:');
    }
    expect(versaoDosTermos(amb.plataforma.config)).toBe('termos@2026-10-17 contrato-lgpd@2026-10-17');
  });

  it('com TEXTOS_LEGAIS_DIR, servem os aprovados; sem versão no arquivo, vale um hash do texto', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'textos-legais-'));
    fs.writeFileSync(path.join(pasta, 'termos.md'), '# Termos de uso\n\nTexto aprovado pelo jurídico.\n');
    fs.writeFileSync(path.join(pasta, 'contrato-lgpd.md'), '---\nversao: 2026-11-03\n---\n# Contrato\r\n\r\nAprovado.\r\n');
    vi.stubEnv('TEXTOS_LEGAIS_DIR', pasta);
    amb = await criarAmbiente();

    const termos = (await get(amb, '/textos/termos')).json<TextoLegal>();
    expect(termos).toMatchObject({ fonte: 'aprovado', markdown: '# Termos de uso\n\nTexto aprovado pelo jurídico.' });
    expect(termos.versao).toMatch(/^[0-9a-f]{12}$/);
    const contrato = (await get(amb, '/textos/contrato-lgpd')).json<TextoLegal>();
    expect(contrato).toMatchObject({ fonte: 'aprovado', versao: '2026-11-03', markdown: '# Contrato\n\nAprovado.' });
    // Documento que o jurídico ainda não mandou: continua a minuta.
    expect((await get(amb, '/textos/privacidade')).json<TextoLegal>().fonte).toBe('minuta');

    // O cadastro guarda a versão aceita junto com a data.
    const r = await amb.app.inject({
      method: 'POST',
      url: '/api/console/auth/cadastro',
      payload: {
        empresa: { nome: 'Pedra Branca Distribuidora' },
        pessoa: { nome: 'Luana Freitas', email: 'luana@pedrabranca.com.br', senha: 'senha-forte-1' },
        aceites: { termos: true, dados: true },
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    const linha = amb.plataforma.banco.um<{ termos_versao: string; termos_aceitos_em: string }>(
      "SELECT termos_versao, termos_aceitos_em FROM empresas WHERE nome = 'Pedra Branca Distribuidora'",
    )!;
    expect(linha.termos_versao).toBe(`termos@${termos.versao} contrato-lgpd@2026-11-03`);
    expect(linha.termos_aceitos_em).toBeTruthy();
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it('documento desconhecido: 404', async () => {
    amb = await criarAmbiente();
    for (const url of ['/textos/contrato', '/textos/..%2F..%2Fpackage', '/textos/TERMOS']) {
      const r = await get(amb, url);
      expect(r.statusCode, url).toBe(404);
      expect(r.json()).toEqual({ erro: 'nao_encontrado', mensagem: 'Texto não encontrado.' });
    }
  });
});

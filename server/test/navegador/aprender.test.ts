import { describe, expect, it } from 'vitest';
import type { Campo, EventoGravado } from '@copiloto/shared';
import { aprenderFluxo, converterPorRegras } from '../../src/navegador/aprender.ts';
import { candidatosDe } from '../../src/navegador/seletores.ts';
import { noPassado, perguntaPara, similaridade } from '../../src/navegador/texto.ts';
import { LlmSimulado } from '../../src/llm/simulado.ts';
import { fluxosExemplo } from '../../src/seed/fluxos.ts';
import { eventosBoleto } from './ajuda-navegador.ts';

describe('conversão da gravação em passos (regras)', () => {
  it('transforma a gravação da segunda via em passos limpos', () => {
    const { passos, camposSugeridos } = converterPorRegras(eventosBoleto());
    expect(passos.map((p) => p.tipo)).toEqual(['navegar', 'preencher', 'selecionar', 'clique', 'download', 'leitura']);
    expect(passos.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(passos.map((p) => p.titulo)).toEqual([
      'Abrir a tela de segunda via',
      'Preencher CPF/CNPJ do pagador',
      'Selecionar competência',
      'Clicar em Buscar boletos',
      'Baixar o PDF em Gerar 2ª via',
      'Ler linha digitavel',
    ]);
    // navegar: caminho sem o token do gravador
    expect(passos[0].url).toBe('/financeiro/segunda-via');
    // preencher: os dois eventos do mesmo campo viram um passo, com o último formato
    expect(passos[1].formatoGravado).toBe('99.999.999/9999-99');
    expect(passos[1].seletores[passos[1].seletorEscolhido]).toMatchObject({ seletor: 'input[name="doc_pagador"]', estabilidade: 'estavel' });
    expect(passos[1].seletores[0].motivo).toMatch(/nome interno/);
    // ordem: estáveis antes dos frágeis; CSS por último
    const estab = passos[1].seletores.map((s) => s.estabilidade);
    expect(estab.indexOf('fragil')).toBeGreaterThan(estab.lastIndexOf('estavel'));
    expect(passos[1].seletores.at(-1)!.seletor).toBe('main form > p:nth-of-type(1) > input');
    // botão: papel+nome (frágil, depende do texto) antes do CSS
    expect(passos[3].seletores[0]).toMatchObject({ seletor: 'role=button[name="Buscar boletos"]', estabilidade: 'fragil' });
    // download junta o clique e o download; usa o endereço do link
    expect(passos[4].seletores[0].seletor).toBe('a[href="/arquivos/boleto-123.pdf"]');
    // leitura gera o dado pela marca data-campo
    expect(passos[5]).toMatchObject({ gera: 'linha_digitavel' });
    expect(passos[5].seletores[0]).toMatchObject({ seletor: '[data-campo="linha_digitavel"]', estabilidade: 'estavel' });
    expect(passos[5].seletores.some((s) => s.seletor.startsWith('text='))).toBe(false);

    // campos sugeridos, ligados aos passos
    expect(camposSugeridos).toEqual([
      expect.objectContaining({ chave: 'cpf_cnpj_pagador', tipo: 'documento', obrigatorio: true, pergunta: 'Qual é o CPF ou CNPJ de quem paga?' }),
      expect.objectContaining({ chave: 'competencia', tipo: 'lista', opcoes: ['10/2026', '09/2026'], pergunta: 'Qual é a competência: 10/2026 ou 09/2026?' }),
    ]);
    expect(passos[1].valor).toEqual({ origem: 'campo', campo: 'cpf_cnpj_pagador' });
    expect(passos[2].valor).toEqual({ origem: 'campo', campo: 'competencia' });
    expect(passos.every((p) => !p.pendencia)).toBe(true);
  });

  it('liga os passos aos campos da tarefa quando ela existe, e marca o que falta mapear', () => {
    const campos: Campo[] = [
      { chave: 'documento_pagador', rotulo: 'CPF/CNPJ do pagador', tipo: 'documento', obrigatorio: true, pergunta: 'Qual o documento?' },
      { chave: 'email_cliente', rotulo: 'E-mail do cliente', tipo: 'email', obrigatorio: false, pergunta: 'Qual o e-mail?' },
    ];
    const { passos } = converterPorRegras(eventosBoleto(), campos);
    expect(passos[1].valor).toEqual({ origem: 'campo', campo: 'documento_pagador' });
    // competência não existe na tarefa: usa a opção da gravação como valor fixo e avisa
    expect(passos[2].valor).toEqual({ origem: 'fixo', valor: '10/2026' });
    expect(passos[2].pendencia).toMatch(/opção escolhida na gravação/);
  });

  it('ignora cliques de foco e navegações causadas por clique; nunca guarda valores', () => {
    const eventos: EventoGravado[] = [
      { tipo: 'navegar', ts: 1, url: 'http://h/clientes/novo' },
      { tipo: 'clique', ts: 2, url: 'http://h/clientes/novo', elemento: { tag: 'label', texto: 'CNPJ', css: 'label' } },
      { tipo: 'preencher', ts: 3, url: 'http://h/clientes/novo', elemento: { tag: 'input', name: 'cnpj', rotulo: 'CNPJ', css: '#x' }, formatoValor: '99999999999999' },
      { tipo: 'clique', ts: 4, url: 'http://h/clientes/novo', elemento: { tag: 'button', texto: 'Salvar cliente', type: 'submit', css: 'form button' } },
      { tipo: 'navegar', ts: 900, url: 'http://h/clientes/4821' },
      { tipo: 'leitura', ts: 1500, url: 'http://h/clientes/4821', elemento: { tag: 'span', texto: '#4821', css: 'span[data-campo="codigo"]' } },
      // navegação digitada pela pessoa (sem clique antes) vira passo
      { tipo: 'navegar', ts: 20_000, url: 'http://h/agenda/nova-visita' },
    ];
    const { passos, camposSugeridos } = converterPorRegras(eventos);
    expect(passos.map((p) => `${p.tipo}:${p.titulo}`)).toEqual([
      'navegar:Abrir a tela de novo cliente',
      'preencher:Preencher CNPJ',
      'clique:Clicar em Salvar cliente',
      'leitura:Ler codigo',
      'navegar:Abrir a tela de nova visita',
    ]);
    expect(camposSugeridos[0]).toMatchObject({ chave: 'cnpj', tipo: 'documento' });
    expect(JSON.stringify(passos)).not.toMatch(/12345678/);
  });

  it('aprenderFluxo usa a regra simulada e devolve o mesmo formato', async () => {
    const r = await aprenderFluxo(new LlmSimulado(), eventosBoleto());
    expect(r.passos).toHaveLength(6);
    expect(r.camposSugeridos.map((c) => c.chave)).toEqual(['cpf_cnpj_pagador', 'competencia']);
    expect(r.passos[1].valor).toEqual({ origem: 'campo', campo: 'cpf_cnpj_pagador' });
  });
});

describe('seletores e textos', () => {
  it('não usa id gerado automaticamente como seletor estável', () => {
    const c = candidatosDe({ tag: 'input', id: 'campo-83920', name: 'cnpj', rotulo: 'CNPJ', css: 'div > input' }, 'preencher');
    expect(c.map((x) => x.seletor)).toEqual(['input[name="cnpj"]', 'label="CNPJ"', 'div > input']);
  });

  it('textos de negócio', () => {
    expect(noPassado('Preencher CPF/CNPJ')).toBe('Preencheu CPF/CNPJ');
    expect(noPassado('Abrir a tela de segunda via')).toBe('Abriu a tela de segunda via');
    expect(noPassado('Ler a linha digitável')).toBe('Leu a linha digitável');
    expect(noPassado('Clicar em Salvar')).toBe('Clicou em Salvar');
    expect(perguntaPara('Data da visita')).toBe('Qual é a data da visita?');
    expect(perguntaPara('Horário')).toBe('Qual é o horário?');
    expect(similaridade('Data da visita', 'Data')).toBeGreaterThan(0.8);
    expect(similaridade('Agendar visita', 'Confirmar agendamento')).toBeLessThan(0.6);
  });
});

describe('fluxos de exemplo do seed', () => {
  it('têm os três fluxos publicados, numerados e ligados aos campos das tarefas', () => {
    const f = fluxosExemplo()!;
    expect(Object.keys(f).sort()).toEqual(['agendar_visita', 'cadastro_cliente_tela', 'segunda_via_boleto']);
    for (const fluxo of Object.values(f)) {
      expect(fluxo.status).toBe('publicado');
      fluxo.passos.forEach((p, i) => {
        expect(p.n).toBe(i + 1);
        if (p.tipo !== 'navegar') expect(p.seletores.length).toBeGreaterThan(0);
      });
    }
    const campos = (k: keyof typeof f) => f[k].passos.flatMap((p) => (p.valor?.origem === 'campo' ? [p.valor.campo] : []));
    expect(campos('cadastro_cliente_tela')).toEqual(['nome_empresa', 'cnpj', 'email_cobranca', 'prazo_pagamento', 'responsavel']);
    expect(campos('agendar_visita')).toEqual(['cliente', 'data', 'horario', 'tecnico']);
    expect(campos('segunda_via_boleto')).toEqual(['documento_pagador', 'competencia']);
    expect(f.agendar_visita.passos.some((p) => p.gera === 'protocolo')).toBe(true);
    expect(f.segunda_via_boleto.passos.some((p) => p.gera === 'linha_digitavel')).toBe(true);
    expect(f.segunda_via_boleto.passos.some((p) => p.tipo === 'download')).toBe(true);
  });
});

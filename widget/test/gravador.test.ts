// Gravador de fluxos: captura sem valores digitados, nada de senha, envio em lotes e a barra.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoGravado } from '@copiloto/shared';
import { Captura } from '../src/gravador/captura.ts';
import { caminhoCss, descreverElemento } from '../src/gravador/descrever.ts';
import { EnvioLotes } from '../src/gravador/envio.ts';
import { BarraGravacao } from '../src/gravador/barra.ts';
import { detectarTokenGravacao, iniciarGravador, tokenParaGravar } from '../src/gravador/index.ts';
import { esperarPromessas, servidorFalso } from './apoio.ts';

const CNPJ = '12.345.678/0001-95';
const EMAIL = 'financeiro@acmelog.com.br';
const SENHA = 'segredo-super-123';

function montarFormulario() {
  document.title = 'Novo cliente · Horizonte';
  document.body.setAttribute('data-pagina', 'Clientes');
  document.body.innerHTML = `
    <main>
      <h1>Novo cliente</h1>
      <form id="form-cliente" action="#" onsubmit="return false">
        <div class="field">
          <label for="cnpj">CNPJ</label>
          <input id="cnpj" name="cnpj" placeholder="00.000.000/0000-00" value="${CNPJ}" data-testid="campo-cnpj">
        </div>
        <label>E-mail de cobrança <input name="email_cobranca" type="email"></label>
        <div class="field">
          <label for="prazo">Prazo de pagamento</label>
          <select id="prazo" name="prazo_pagamento_dias">
            <option value="15">15 dias</option>
            <option value="30">30 dias</option>
          </select>
        </div>
        <div class="field">
          <label for="senha">Senha do certificado</label>
          <input id="senha" name="senha" type="password">
        </div>
        <textarea name="observacoes" aria-label="Observações"></textarea>
        <button type="submit" class="btn">Salvar cliente</button>
        <a href="/arquivos/relatorios/77.pdf" download>Baixar PDF</a>
      </form>
    </main>`;
}

function preencher(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  el.value = valor;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('captura do gravador', () => {
  let eventos: EventoGravado[];
  let captura: Captura;

  beforeEach(() => {
    montarFormulario();
    eventos = [];
    captura = new Captura({ aoEvento: (e) => eventos.push(e) });
    captura.iniciar();
  });

  afterEach(() => {
    captura.parar();
    document.body.innerHTML = '';
  });

  it('registra a navegação inicial com URL e título', () => {
    expect(eventos[0]).toMatchObject({ tipo: 'navegar', url: location.href, tituloPagina: 'Novo cliente · Horizonte' });
  });

  it('grava o formato do valor, nunca o valor', () => {
    const cnpj = document.getElementById('cnpj') as HTMLInputElement;
    preencher(cnpj, CNPJ);
    const email = document.querySelector('[name="email_cobranca"]') as HTMLInputElement;
    preencher(email, EMAIL);
    const obs = document.querySelector('textarea') as HTMLTextAreaElement;
    preencher(obs, 'Cliente pediu boleto no dia 10');

    const preenchimentos = eventos.filter((e) => e.tipo === 'preencher');
    expect(preenchimentos).toHaveLength(3);
    expect(preenchimentos[0].formatoValor).toBe('99.999.999/9999-99');
    expect(preenchimentos[1].formatoValor).toBe('aaaaaaaaaa@aaaaaaa.aaa.aa');
    expect(preenchimentos[0].elemento).toMatchObject({
      tag: 'input',
      id: 'cnpj',
      name: 'cnpj',
      rotulo: 'CNPJ',
      placeholder: '00.000.000/0000-00',
      testId: 'campo-cnpj',
      role: 'textbox',
    });
    expect(preenchimentos[1].elemento?.rotulo).toBe('E-mail de cobrança');
    expect(preenchimentos[2].elemento?.ariaLabel).toBe('Observações');
    expect(preenchimentos[0].elemento?.css).toBe('html > body > main > form > div:nth-of-type(1) > input');
    // Nem o valor digitado nem o atributo value do HTML aparecem em lugar nenhum do evento.
    const tudo = JSON.stringify(eventos);
    expect(tudo).not.toContain(CNPJ);
    expect(tudo).not.toContain('12.345');
    expect(tudo).not.toContain(EMAIL);
    expect(tudo).not.toContain('boleto no dia 10');
    expect(preenchimentos[0].elemento?.contexto).toContain('data-copiloto-alvo');
    expect(preenchimentos[0].elemento?.contexto).toContain('<label for="cnpj">CNPJ</label>');
  });

  it('não repete o preenchimento quando o valor não mudou', () => {
    const cnpj = document.getElementById('cnpj') as HTMLInputElement;
    preencher(cnpj, CNPJ);
    cnpj.dispatchEvent(new Event('change', { bubbles: true }));
    expect(eventos.filter((e) => e.tipo === 'preencher')).toHaveLength(1);
  });

  it('campo de senha nunca gera preenchimento nem clique', () => {
    const senha = document.getElementById('senha') as HTMLInputElement;
    senha.click();
    preencher(senha, SENHA);
    (document.getElementById('form-cliente') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(eventos.some((e) => e.elemento?.name === 'senha')).toBe(false);
    expect(JSON.stringify(eventos)).not.toContain(SENHA);
  });

  it('seleção grava o texto da opção', () => {
    const prazo = document.getElementById('prazo') as HTMLSelectElement;
    prazo.value = '30';
    prazo.dispatchEvent(new Event('change', { bubbles: true }));
    const sel = eventos.find((e) => e.tipo === 'selecionar');
    expect(sel?.opcaoTexto).toBe('30 dias');
    expect(sel?.elemento).toMatchObject({ tag: 'select', name: 'prazo_pagamento_dias', rotulo: 'Prazo de pagamento', role: 'combobox' });
    expect(sel?.elemento?.contexto).not.toContain('selected');
  });

  it('clique em botão grava o texto visível; clique para focar um campo não vira passo', () => {
    (document.getElementById('cnpj') as HTMLInputElement).click();
    document.querySelector<HTMLLabelElement>('label[for="cnpj"]')!.click();
    (document.querySelector('button') as HTMLButtonElement).click();
    const cliques = eventos.filter((e) => e.tipo === 'clique');
    expect(cliques).toHaveLength(1);
    expect(cliques[0].elemento).toMatchObject({ tag: 'button', type: 'submit', texto: 'Salvar cliente', role: 'button' });
  });

  it('clique em texto solto não é passo; elemento com cursor de mãozinha é', () => {
    document.querySelector('h1')!.click();
    const cartao = document.createElement('div');
    cartao.style.cursor = 'pointer';
    cartao.innerHTML = '<span>Plano Anual</span>';
    document.querySelector('main')!.appendChild(cartao);
    cartao.querySelector('span')!.click();
    const cliques = eventos.filter((e) => e.tipo === 'clique');
    expect(cliques).toHaveLength(1);
    expect(cliques[0].elemento).toMatchObject({ tag: 'div', texto: 'Plano Anual' });
  });

  it('enviar o formulário com Enter garante o preenchimento antes', () => {
    const email = document.querySelector('[name="email_cobranca"]') as HTMLInputElement;
    email.value = EMAIL;
    (document.getElementById('form-cliente') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const p = eventos.find((e) => e.tipo === 'preencher' && e.elemento?.name === 'email_cobranca');
    expect(p?.formatoValor).toBe('aaaaaaaaaa@aaaaaaa.aaa.aa');
  });

  it('download por link e por script', () => {
    const link = document.querySelector('a[download]') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    const solto = document.createElement('a');
    solto.href = '/arquivos/boleto-123.pdf';
    solto.download = 'boleto-123.pdf';
    solto.addEventListener('click', (e) => e.preventDefault());
    solto.click();
    const downloads = eventos.filter((e) => e.tipo === 'download');
    expect(downloads).toHaveLength(2);
    expect(downloads[0].elemento).toMatchObject({ tag: 'a', texto: 'Baixar PDF' });
    expect(downloads[0].elemento?.href).toContain('/arquivos/relatorios/77.pdf');
    expect(downloads[1].elemento?.href).toContain('boleto-123.pdf');
  });

  it('navegação de página única (pushState) vira evento', () => {
    history.pushState({}, '', '/clientes/4821');
    expect(eventos.filter((e) => e.tipo === 'navegar').map((e) => new URL(e.url).pathname)).toContain('/clientes/4821');
    history.pushState({}, '', '/');
  });

  it('ignora a interface do próprio copiloto', () => {
    captura.parar();
    const hospedeiro = document.createElement('copiloto-widget');
    const botao = document.createElement('button');
    botao.textContent = 'Concluir';
    hospedeiro.appendChild(botao);
    document.body.appendChild(hospedeiro);
    eventos = [];
    captura = new Captura({ aoEvento: (e) => eventos.push(e), ignorar: (a) => a instanceof Node && hospedeiro.contains(a) });
    captura.iniciar();
    botao.click();
    expect(eventos.filter((e) => e.tipo === 'clique')).toHaveLength(0);
  });
});

describe('descrição do elemento', () => {
  it('caminho CSS completo e contexto sem valores', () => {
    document.body.innerHTML = `<ul><li>a</li><li><input name="x" value="valor-secreto"><textarea>texto-secreto</textarea></li></ul>`;
    const input = document.querySelector('input')!;
    expect(caminhoCss(input)).toBe('html > body > ul > li:nth-of-type(2) > input');
    const d = descreverElemento(input);
    expect(d.contexto).toBeTruthy();
    expect(d.contexto).not.toContain('valor-secreto');
    expect(d.contexto).not.toContain('texto-secreto');
    expect(d.texto).toBeUndefined();
  });
});

describe('envio em lotes', () => {
  it('junta eventos e envia num POST só; guarda o que falta ao sair da página', async () => {
    const enviados: EventoGravado[][] = [];
    const envio = new EnvioLotes({
      api: { eventos: async (lista) => (enviados.push(lista), { passos: lista.length }) },
      chavePendentes: 'pendentes-teste',
      tamanhoLote: 3,
      esperaMs: 50,
    });
    const ev = (n: number): EventoGravado => ({ tipo: 'clique', ts: n, url: 'http://localhost/' });
    envio.adicionar(ev(1));
    envio.adicionar(ev(2));
    envio.salvar();
    expect(JSON.parse(sessionStorage.getItem('pendentes-teste')!)).toHaveLength(2);
    envio.adicionar(ev(3));
    await esperarPromessas();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].map((e) => e.ts)).toEqual([1, 2, 3]);
    expect(sessionStorage.getItem('pendentes-teste')).toBeNull();
  });
});

describe('modo gravação completo', () => {
  beforeEach(() => {
    montarFormulario();
    history.replaceState({}, '', '/clientes/novo?copiloto_gravacao=tok123');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
  });

  it('detecta o token, mostra a barra, envia eventos e conclui', async () => {
    const srv = servidorFalso({
      'GET /api/gravacao/tok123': () => ({ fluxoId: 'f1', nome: 'Cadastro de cliente', ativa: true, passos: 0 }),
      'POST /api/gravacao/tok123/eventos': (c) => ({ passos: (c.corpo as { eventos: unknown[] }).eventos.length }),
      'POST /api/gravacao/tok123/concluir': () => ({ ok: true, fluxoId: 'f1' }),
    });
    const token = detectarTokenGravacao();
    expect(token).toBe('tok123');
    expect(location.search).toBe('');
    expect(sessionStorage.getItem('copiloto_gravacao')).toBe('tok123');

    const raiz = document.createElement('div');
    document.body.appendChild(raiz);
    const g = iniciarGravador({ servidor: 'http://localhost:3000', token: token!, raiz, hospedeiro: raiz });
    await esperarPromessas();
    expect(raiz.textContent).toContain('Gravando');
    expect(raiz.textContent).toContain('Cadastro de cliente');

    preencher(document.getElementById('cnpj') as HTMLInputElement, CNPJ);
    (raiz.querySelector('button.btn-primary') as HTMLButtonElement).click(); // Concluir
    await vi.waitFor(() => expect(raiz.textContent).toContain('Gravação enviada. Volte ao console para revisar.'));

    const enviados = srv.de('POST', '/api/gravacao/tok123/eventos').flatMap((c) => (c.corpo as { eventos: EventoGravado[] }).eventos);
    expect(enviados.map((e) => e.tipo)).toEqual(['navegar', 'preencher']);
    expect(enviados[0].url).not.toContain('copiloto_gravacao');
    expect(JSON.stringify(enviados)).not.toContain(CNPJ);
    expect(srv.de('POST', '/api/gravacao/tok123/concluir')).toHaveLength(1);
    expect(sessionStorage.getItem('copiloto_gravacao')).toBeNull();
    // Depois de concluir, nada mais é capturado.
    (document.querySelector('form button') as HTMLButtonElement).click();
    await esperarPromessas();
    expect(srv.de('POST', '/api/gravacao/tok123/eventos').flatMap((c) => (c.corpo as { eventos: EventoGravado[] }).eventos)).toHaveLength(2);
    g.parar();
  });

  it('cancelar pede confirmação e descarta', async () => {
    const srv = servidorFalso({
      'GET /api/gravacao/tok123': () => ({ fluxoId: 'f1', nome: 'Fluxo', ativa: true, passos: 0 }),
      'POST /api/gravacao/tok123/eventos': () => ({ passos: 1 }),
      'POST /api/gravacao/tok123/cancelar': () => ({ ok: true }),
    });
    const raiz = document.createElement('div');
    document.body.appendChild(raiz);
    iniciarGravador({ servidor: 'http://localhost:3000', token: detectarTokenGravacao()!, raiz, hospedeiro: raiz });
    const botoes = () => Array.from(raiz.querySelectorAll('button'));
    botoes().find((b) => b.textContent === 'Cancelar')!.click();
    expect(raiz.textContent).toContain('Descartar a gravação?');
    botoes().find((b) => b.textContent === 'Descartar')!.click();
    await vi.waitFor(() => expect(raiz.textContent).toContain('Gravação descartada'));
    expect(srv.de('POST', '/api/gravacao/tok123/cancelar')).toHaveLength(1);
    expect(sessionStorage.getItem('copiloto_gravacao')).toBeNull();
  });
});

describe('com a extensão do copiloto na página', () => {
  beforeEach(() => {
    montarFormulario();
    history.replaceState({}, '', '/clientes/novo?copiloto_gravacao=tok123&copiloto_api=http%3A%2F%2Flocalhost%3A3000');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-copiloto-extensao');
    document.querySelectorAll('copiloto-widget').forEach((n) => n.remove());
    delete window.__copilotoCarregado;
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
  });

  it('sem a extensão, o widget grava como sempre (e tira o copiloto_api da barra de endereço)', () => {
    expect(tokenParaGravar()).toBe('tok123');
    expect(location.search).toBe('');
    expect(sessionStorage.getItem('copiloto_gravacao')).toBe('tok123');
  });

  it('com a marca da extensão no <html>, o widget não grava e esquece o token', () => {
    document.documentElement.setAttribute('data-copiloto-extensao', '0.1.0');
    sessionStorage.setItem('copiloto_gravacao_pendentes', '[]');
    expect(tokenParaGravar()).toBeNull();
    expect(location.search).toBe('');
    expect(sessionStorage.getItem('copiloto_gravacao')).toBeNull();
    expect(sessionStorage.getItem('copiloto_gravacao_pendentes')).toBeNull();
  });

  it('copiloto.js: com a extensão, não monta a barra nem envia nada; sem ela, monta e envia', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const srv = servidorFalso({
      'GET /api/gravacao/tok123': () => ({ fluxoId: 'f1', nome: 'Fluxo', ativa: true, passos: 0 }),
      'POST /api/gravacao/tok123/eventos': () => ({ passos: 1 }),
    });
    document.documentElement.setAttribute('data-copiloto-extensao', '0.1.0');
    vi.resetModules();
    await import('../src/main.ts');
    await esperarPromessas();
    preencher(document.getElementById('cnpj') as HTMLInputElement, CNPJ);
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector('copiloto-widget')).toBeNull();
    expect(srv.chamadas.filter((c) => c.caminho.startsWith('/api/gravacao'))).toHaveLength(0);

    // Mesma página sem a extensão: o gravador do widget liga.
    document.documentElement.removeAttribute('data-copiloto-extensao');
    delete window.__copilotoCarregado;
    history.replaceState({}, '', '/clientes/novo?copiloto_gravacao=tok123');
    vi.resetModules();
    await import('../src/main.ts');
    await vi.waitFor(() => expect(srv.de('GET', '/api/gravacao/tok123')).toHaveLength(1));
    expect(document.querySelector('copiloto-widget')).not.toBeNull();
  });
});

describe('barra de gravação', () => {
  it('aviso de erro com botão de ação (usado pela extensão)', () => {
    const raiz = document.createElement('div');
    const barra = new BarraGravacao(raiz, { concluir: async () => {}, cancelar: async () => {}, fechar: () => {} });
    const aoClicar = vi.fn();
    barra.mostrarErro('O servidor do copiloto ainda não foi liberado.', { rotulo: 'Abrir as opções', aoClicar });
    expect(raiz.querySelector('[role="alert"]')?.textContent).toBe('O servidor do copiloto ainda não foi liberado.');
    const botoes = Array.from(raiz.querySelectorAll('button'));
    botoes.find((b) => b.textContent === 'Abrir as opções')!.click();
    expect(aoClicar).toHaveBeenCalledOnce();
    barra.mostrarErro(null);
    expect(raiz.textContent).not.toContain('Abrir as opções');
  });
});

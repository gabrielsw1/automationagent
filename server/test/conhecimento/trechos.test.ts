// Divisão em trechos de cada formato: página HTML, PDF, DOCX, Markdown, TXT e transcrições.
import { describe, expect, it } from 'vitest';
import {
  lerDocx,
  lerMarkdown,
  lerPaginaHtml,
  lerPdf,
  lerTranscricao,
  lerTxt,
  paragrafosDoTexto,
} from '../../src/conhecimento/extratores.ts';
import { ErroFonte } from '../../src/conhecimento/erros.ts';
import { cortarParagrafo, dividirEmTrechos, formatarTempo, TAMANHO_MAX } from '../../src/conhecimento/trechos.ts';
import { gerarDocx, gerarPdf } from './arquivos.ts';

const frase = (n: number, tema = 'boleto') =>
  Array.from({ length: n }, (_, i) => `Esta é a frase ${i + 1} sobre ${tema}, com detalhes suficientes para ocupar espaço.`).join(' ');

describe('dividirEmTrechos', () => {
  it('respeita o tamanho máximo, junta seções curtas e dá o local da primeira seção', () => {
    const trechos = dividirEmTrechos(
      [
        { paragrafos: ['Introdução curta.'] },
        { cabecalho: 'Boletos', local: 'seção Boletos', paragrafos: [frase(12), frase(10)] },
        { cabecalho: 'Prazos', local: 'seção Prazos', paragrafos: ['Aceitamos 15, 30, 45 ou 60 dias.'] },
      ],
      { titulo: 'Financeiro', url: 'http://x/ajuda/financeiro' },
    );
    expect(trechos.length).toBeGreaterThanOrEqual(2);
    for (const t of trechos) {
      expect(t.texto.length).toBeLessThanOrEqual(TAMANHO_MAX * 1.25);
      expect(t.titulo).toBe('Financeiro');
      expect(t.url).toBe('http://x/ajuda/financeiro');
    }
    // A introdução curta fica junto da seção seguinte, que dá o local.
    expect(trechos[0].texto.startsWith('Introdução curta.\nBoletos\n')).toBe(true);
    expect(trechos[0].local).toBe('seção Boletos');
    // O título de uma seção nunca fica sozinho no fim de um trecho.
    expect(trechos.some((t) => t.texto.includes('Prazos\nAceitamos 15, 30, 45 ou 60 dias.'))).toBe(true);
  });

  it('corta parágrafos gigantes por frases e por palavras', () => {
    const partes = cortarParagrafo(frase(40));
    expect(partes.length).toBeGreaterThan(3);
    expect(partes.every((p) => p.length <= 700)).toBe(true);
    const semPonto = cortarParagrafo('palavra '.repeat(400));
    expect(semPonto.every((p) => p.length <= 700)).toBe(true);
  });

  it('junta páginas curtas de PDF com o local "páginas N–M" e mantém páginas grandes separadas', () => {
    const trechos = dividirEmTrechos(
      [
        { pagina: 3, paragrafos: ['Texto curto da página três.'] },
        { pagina: 4, paragrafos: ['Texto curto da página quatro.'] },
        { pagina: 5, paragrafos: [frase(3)] },
        { pagina: 9, paragrafos: [frase(10)] },
        { pagina: 10, paragrafos: ['Rodapé curto da página dez.'] },
      ],
      { titulo: 'Manual.pdf' },
      { fecharNaSecao: 150 },
    );
    expect(trechos.map((t) => t.local)).toEqual(['páginas 3–5', 'página 9', 'página 10']);
  });

  it('formata tempos', () => {
    expect(formatarTempo(134)).toBe('02:14');
    expect(formatarTempo(3725)).toBe('1:02:05');
  });
});

describe('páginas HTML', () => {
  it('ignora menus, cabeçalho e rodapé e divide por h2', () => {
    const html = `<!doctype html><html><head><title>Boletos · Ajuda · Horizonte</title></head><body>
      <header><nav><a href="/ajuda">Menu principal</a> <a href="/sair">Sair</a></nav></header>
      <aside class="sidebar">Artigos relacionados</aside>
      <main><article>
        <h1>Segunda via de boleto</h1>
        <p>Para emitir a <strong>segunda via</strong>, acesse Financeiro.</p>
        <h2>Passo a passo</h2>
        <ol><li>Informe o CPF/CNPJ do pagador.</li><li>Clique em <a href="#">Buscar boletos</a>.</li></ol>
        <h2>Boletos vencidos</h2>
        <p>Multa de 2% e juros de 1% ao mês.</p>
        <table><tr><th>Prazo</th><th>Juros</th></tr><tr><td>30 dias</td><td>1%</td></tr></table>
        <script>console.log('não entra')</script>
      </article></main>
      <footer>© 2026 Horizonte · Política de privacidade</footer>
      <script src="/copiloto.js"></script>
    </body></html>`;
    const p = lerPaginaHtml(html);
    expect(p.titulo).toBe('Segunda via de boleto');
    const texto = p.secoes.flatMap((s) => [s.cabecalho ?? '', ...s.paragrafos.map((x) => (typeof x === 'string' ? x : x.texto))]).join('\n');
    expect(texto).toContain('Para emitir a segunda via, acesse Financeiro.');
    expect(texto).toContain('• Informe o CPF/CNPJ do pagador.');
    expect(texto).toContain('Prazo | Juros');
    expect(texto).not.toContain('Menu principal');
    expect(texto).not.toContain('Política de privacidade');
    expect(texto).not.toContain('Artigos relacionados');
    expect(texto).not.toContain('console.log');
    expect(p.secoes.map((s) => s.local)).toEqual([undefined, 'seção Passo a passo', 'seção Boletos vencidos']);
    expect(p.links).toContain('/ajuda');
    const trechos = dividirEmTrechos(p.secoes, { titulo: p.titulo, url: 'http://x/ajuda/boletos' });
    expect(trechos.length).toBe(1);
    expect(trechos[0].local).toBe('seções Passo a passo e Boletos vencidos');
  });

  it('itens com link e descrição ficam separados; listas só de links e trilhas saem', () => {
    const p = lerPaginaHtml(`<html><body><main>
      <div class="trilha"><a href="/ajuda">Central de ajuda</a> › Financeiro</div>
      <h1>Central de ajuda</h1>
      <p class="meta">Atualizado em 22/09/2026</p>
      <ul><li><a href="/ajuda/boleto">Segunda via</a><p>Gere o PDF do boleto.</p></li></ul>
      <h2>Veja também</h2>
      <ul><li><a href="/ajuda/prazos">Prazos de pagamento</a></li></ul>
    </main></body></html>`);
    const texto = p.secoes.flatMap((s) => s.paragrafos.map((x) => (typeof x === 'string' ? x : x.texto))).join('\n');
    expect(texto).toBe('• Segunda via — Gere o PDF do boleto.');
    expect(p.secoes.map((s) => s.cabecalho)).toEqual([undefined]);
    expect(p.links).toContain('/ajuda/prazos');
  });

  it('percebe página de login', () => {
    const p = lerPaginaHtml('<html><body><form><input name="email"><input type="password" name="senha"></form></body></html>');
    expect(p.pedeLogin).toBe(true);
  });
});

describe('PDF', () => {
  it('lê por página, com acentos, e o local vira "página N"', async () => {
    const pdf = gerarPdf([
      ['Manual do financeiro', 'Visão geral do módulo de cobrança.'],
      [frase(8, 'conciliação bancária')],
      [],
      ['Segunda via: multa de 2% e juros de 1% ao mês.', 'A nova data de vencimento é de 3 dias úteis.'],
    ]);
    const progresso: number[] = [];
    const lido = await lerPdf(new Uint8Array(pdf), (feitas) => {
      progresso.push(feitas);
    });
    expect(lido.paginas).toBe(4);
    expect(progresso).toEqual([1, 2, 3, 4]);
    expect(lido.secoes.map((s) => s.pagina)).toEqual([1, 2, 4]);
    const trechos = dividirEmTrechos(lido.secoes, { titulo: 'Manual do financeiro.pdf' }, { fecharNaSecao: 150 });
    expect(trechos.map((t) => t.local)).toEqual(['páginas 1–2', 'página 4']);
    expect(trechos.find((t) => t.local === 'página 4')!.texto).toContain('juros de 1% ao mês');
    expect(trechos.some((t) => t.texto.includes('cobrança'))).toBe(true);
  });

  it('PDF escaneado (sem texto) dá erro com como resolver', async () => {
    const pdf = gerarPdf([[], [], []]);
    const e = await lerPdf(new Uint8Array(pdf)).catch((x) => x);
    expect(e).toBeInstanceOf(ErroFonte);
    expect(e.codigo).toBe('pdf_escaneado');
    expect(e.comoResolver).toMatch(/OCR/);
  });

  it('arquivo que não é PDF dá erro de PDF inválido', async () => {
    const e = await lerPdf(new Uint8Array(Buffer.from('isto não é um pdf'))).catch((x) => x);
    expect(e).toBeInstanceOf(ErroFonte);
    expect(e.codigo).toBe('pdf_invalido');
  });

  it('junta linhas quebradas do PDF em parágrafos', () => {
    expect(paragrafosDoTexto('A segunda via mantém\no número do boleto.\nDepois disso, pague.', true)).toEqual([
      'A segunda via mantém o número do boleto.',
      'Depois disso, pague.',
    ]);
  });
});

describe('DOCX', () => {
  it('usa os títulos do Word como seções', async () => {
    const docx = gerarDocx([
      { titulo: 'Política de cobrança' },
      { paragrafo: 'Este documento explica a cobrança.' },
      { titulo: 'Boletos', nivel: 2 },
      { paragrafo: 'Os boletos vencem conforme o prazo do cliente.' },
      { titulo: 'Negociação', nivel: 2 },
      { paragrafo: frase(14, 'negociação') },
    ]);
    const { titulo, secoes } = await lerDocx(docx);
    expect(titulo).toBe('Política de cobrança');
    expect(secoes.map((s) => s.local)).toEqual([undefined, 'seção Boletos', 'seção Negociação']);
    const trechos = dividirEmTrechos(secoes, { titulo: 'Política.docx' });
    expect(trechos[0].local).toBe('seções Boletos e Negociação');
    expect(trechos.some((t) => t.local === 'seção Negociação')).toBe(true);
  });

  it('DOCX protegido por senha e arquivo corrompido', async () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from('EncryptedPackage')]);
    await expect(lerDocx(ole)).rejects.toMatchObject({ codigo: 'docx_senha' });
    await expect(lerDocx(Buffer.from('qualquer coisa'))).rejects.toMatchObject({ codigo: 'docx_invalido' });
  });
});

describe('Markdown e TXT', () => {
  it('Markdown: # é o título, ## viram seções e listas viram itens', () => {
    const md = `# Guia rápido\n\nIntrodução ao **guia**.\n\n## Boletos\n\n- Acesse [Financeiro](http://x)\n- Clique em Buscar\n\n## Prazos\n\nAceitamos 15, 30, 45 ou 60 dias.\n`;
    const { titulo, secoes } = lerMarkdown(md);
    expect(titulo).toBe('Guia rápido');
    expect(secoes.map((s) => s.local)).toEqual([undefined, 'seção Boletos', 'seção Prazos']);
    expect(secoes[1].paragrafos).toEqual(['• Acesse Financeiro', '• Clique em Buscar']);
    expect(secoes[0].paragrafos).toEqual(['Introdução ao guia.']);
  });

  it('TXT: parágrafos e títulos em maiúsculas', () => {
    const { secoes } = lerTxt('Texto inicial.\n\nBOLETOS\nO boleto vence no dia 10.\n\nOutro parágrafo.');
    expect(secoes.map((s) => s.local)).toEqual([undefined, 'seção Boletos']);
    expect(secoes[1].paragrafos).toEqual(['O boleto vence no dia 10.', 'Outro parágrafo.']);
  });
});

describe('transcrições', () => {
  it('WEBVTT: tempos "mm:ss", sem tags e sem repetições', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Fernanda>Oi, pessoal!

00:00:04.000 --> 00:00:08.000
Hoje vamos agendar uma visita.

00:00:08.000 --> 00:00:09.000
Hoje vamos agendar uma visita.

00:02:14.500 --> 00:02:20.000
O horário vai das <b>oito</b> às cinco.
`;
    const t = lerTranscricao(vtt);
    expect(t.comTempo).toBe(true);
    expect(t.falas).toBe(3);
    expect(t.duracao).toBe(140);
    const paragrafos = t.secoes[0].paragrafos as { texto: string; local?: string }[];
    expect(paragrafos[0]).toEqual({ texto: 'Fernanda: Oi, pessoal!', local: '00:01' });
    expect(paragrafos[2]).toEqual({ texto: 'O horário vai das oito às cinco.', local: '02:14' });
    const trechos = dividirEmTrechos(t.secoes, { titulo: 'Treinamento' });
    expect(trechos[0].local).toBe('00:01');
  });

  it('SRT com vírgula nos milissegundos', () => {
    const srt = `1\n00:01:05,000 --> 00:01:09,000\nPrimeira fala.\n\n2\n00:03:40,200 --> 00:03:44,000\nSegunda fala.\n`;
    const t = lerTranscricao(srt);
    const paragrafos = t.secoes[0].paragrafos as { texto: string; local?: string }[];
    expect(paragrafos.map((p) => p.local)).toEqual(['01:05', '03:40']);
  });

  it('texto colado com tempos no começo da linha e sem tempos', () => {
    const comTempo = lerTranscricao('[00:10] Abra a Agenda.\n02:14 - Escolha o técnico.\ncontinuação da fala.');
    const ps = comTempo.secoes[0].paragrafos as { texto: string; local?: string }[];
    expect(ps).toEqual([
      { texto: 'Abra a Agenda.', local: '00:10' },
      { texto: 'Escolha o técnico. continuação da fala.', local: '02:14' },
    ]);
    const semTempo = lerTranscricao('Primeiro parágrafo da fala.\n\nSegundo parágrafo.');
    expect(semTempo.comTempo).toBe(false);
    expect(semTempo.secoes[0].paragrafos).toEqual(['Primeiro parágrafo da fala.', 'Segundo parágrafo.']);
  });
});

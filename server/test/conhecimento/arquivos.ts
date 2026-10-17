// Geradores de arquivos pequenos para os testes (PDF e DOCX montados à mão, sem dependências).
import zlib from 'node:zlib';

/** PDF com uma página por item; cada página é uma lista de linhas. Página vazia = sem texto (como um escaneado). */
export function gerarPdf(paginas: string[][]): Buffer {
  const objetos: string[] = [];
  const n = paginas.length;
  const idPagina = (i: number) => 4 + i * 2;
  const idConteudo = (i: number) => 5 + i * 2;
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] /Count ${n} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  paginas.forEach((linhas, i) => {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const corpo = linhas.length
      ? `BT /F1 11 Tf 50 780 Td 15 TL ${linhas.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
      : '';
    objetos[idPagina(i)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idConteudo(i)} 0 R >>`;
    objetos[idConteudo(i)] = `<< /Length ${Buffer.byteLength(corpo, 'latin1')} >>\nstream\n${corpo}\nendstream`;
  });
  let saida = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objetos.length; id++) {
    offsets[id] = Buffer.byteLength(saida, 'latin1');
    saida += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(saida, 'latin1');
  saida += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) saida += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  saida += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(saida, 'latin1');
}

/** ZIP sem compressão (método "store"), suficiente para um DOCX mínimo. */
function zip(arquivos: { nome: string; dados: Buffer }[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const crc = zlib.crc32(a.dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(a.dados.length, 18);
    local.writeUInt32LE(a.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, a.dados);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(a.dados.length, 20);
    central.writeUInt32LE(a.dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, nome);
    offset += 30 + nome.length + a.dados.length;
  }
  const tamanhoCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}

/** DOCX mínimo: cada item é um título (Heading1/Heading2) ou um parágrafo. */
export function gerarDocx(blocos: ({ titulo: string; nivel?: 1 | 2 } | { paragrafo: string })[]): Buffer {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const corpo = blocos
    .map((b) =>
      'titulo' in b
        ? `<w:p><w:pPr><w:pStyle w:val="Heading${b.nivel ?? 1}"/></w:pPr><w:r><w:t>${esc(b.titulo)}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">${esc(b.paragrafo)}</w:t></w:r></w:p>`,
    )
    .join('');
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`;
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const relsDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  return zip([
    { nome: '[Content_Types].xml', dados: Buffer.from(tipos) },
    { nome: '_rels/.rels', dados: Buffer.from(rels) },
    { nome: 'word/document.xml', dados: Buffer.from(documento) },
    { nome: 'word/_rels/document.xml.rels', dados: Buffer.from(relsDoc) },
    { nome: 'word/styles.xml', dados: Buffer.from(estilos) },
  ]);
}

// Arquivo .zip escrito à mão (zlib do Node), sem dependência: é o pacote que vai para a Chrome Web
// Store e para o Edge Add-ons. Só o básico do formato: arquivos comprimidos com deflate, sem pastas
// vazias, sem zip64 (o pacote da extensão tem poucos arquivos e poucos KB).
import { deflateRawSync } from 'node:zlib';
import { crc32 } from './icones.ts';

export interface ArquivoZip {
  /** Caminho dentro do zip, com "/" (manifest.json na raiz). */
  caminho: string;
  dados: Buffer;
}

/** Data e hora no formato do MS-DOS (o que o zip guarda). */
function dataDos(d: Date): { data: number; hora: number } {
  const ano = Math.max(1980, d.getFullYear());
  return {
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

export function criarZip(arquivos: ArquivoZip[], quando = new Date()): Buffer {
  const { data, hora } = dataDos(quando);
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.caminho.replace(/\\/g, '/'), 'utf8');
    const comprimido = deflateRawSync(a.dados, { level: 9 });
    // Arquivo pequeno que não diminui: guarda sem comprimir.
    const guardar = comprimido.length >= a.dados.length;
    const corpo = guardar ? a.dados : comprimido;
    const metodo = guardar ? 0 : 8;
    const crc = crc32(a.dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(a.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, corpo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // feito por
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(corpo.length, 20);
    central.writeUInt32LE(a.dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    // extra, comentário, disco, atributos internos: 0
    central.writeUInt32LE(0, 38); // atributos externos
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);

    deslocamento += local.length + nome.length + corpo.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

// Pacote para as lojas (Chrome Web Store e Edge Add-ons):
//   npm run loja -w extension
// Compila a extensão (como o npm run build) e escreve em extension/dist-loja:
// - copiloto-gravador-<versão>.zip: o que se envia à loja (manifest.json na raiz);
// - as imagens pedidas pelas lojas, no tamanho certo (ícone 128 com a arte em 96, logo 300 do Edge,
//   bloco promocional 440 × 280);
// - listagem-pt-BR.md: o texto da listagem (cópia de extension/loja), para colar no painel da loja.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST, RAIZ_EXTENSAO, compilar } from './compilar.ts';
import { imagemLojaPng, lerCor, lerCores } from './icones.ts';
import { criarZip, type ArquivoZip } from './zip.ts';

export const SAIDA_LOJA = path.join(RAIZ_EXTENSAO, 'dist-loja');
const TOKENS = path.resolve(RAIZ_EXTENSAO, '..', 'shared', 'styles', 'tokens.css');

/** Imagens das lojas: nome do arquivo, largura, altura, tamanho do ícone e fundo. */
export const IMAGENS_LOJA = [
  { arquivo: 'icone-128.png', largura: 128, altura: 128, lado: 96, fundo: null },
  { arquivo: 'logo-300.png', largura: 300, altura: 300, lado: 300, fundo: null },
  { arquivo: 'promocional-440x280.png', largura: 440, altura: 280, lado: 152, fundo: 'brand-50' },
] as const;

/** Todos os arquivos de uma pasta, com o caminho relativo (com "/"), em ordem. */
export function arquivosDe(pasta: string): ArquivoZip[] {
  const lista: ArquivoZip[] = [];
  const andar = (dir: string) => {
    for (const nome of fs.readdirSync(dir).sort()) {
      const completo = path.join(dir, nome);
      if (fs.statSync(completo).isDirectory()) andar(completo);
      else lista.push({ caminho: path.relative(pasta, completo).split(path.sep).join('/'), dados: fs.readFileSync(completo) });
    }
  };
  andar(pasta);
  // manifest.json primeiro (algumas ferramentas leem só o começo do zip).
  return lista.sort((a, b) => (a.caminho === 'manifest.json' ? -1 : b.caminho === 'manifest.json' ? 1 : 0));
}

export interface ResultadoLoja {
  zip: string;
  imagens: string[];
  listagem: string;
}

export async function pacoteLoja(opcoes: { compilar?: boolean; saida?: string } = {}): Promise<ResultadoLoja> {
  const saida = path.resolve(opcoes.saida ?? SAIDA_LOJA);
  if (opcoes.compilar ?? true) await compilar();
  const manifesto = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8')) as { version: string };
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });

  const zip = path.join(saida, `copiloto-gravador-${manifesto.version}.zip`);
  fs.writeFileSync(zip, criarZip(arquivosDe(DIST)));

  const tokens = fs.readFileSync(TOKENS, 'utf8');
  const cores = lerCores(tokens);
  const imagens: string[] = [];
  for (const i of IMAGENS_LOJA) {
    const destino = path.join(saida, i.arquivo);
    fs.writeFileSync(destino, imagemLojaPng(i.largura, i.altura, i.lado, cores, i.fundo ? lerCor(tokens, i.fundo) : null));
    imagens.push(destino);
  }

  const listagem = path.join(saida, 'listagem-pt-BR.md');
  fs.copyFileSync(path.join(RAIZ_EXTENSAO, 'loja', 'listagem-pt-BR.md'), listagem);
  return { zip, imagens, listagem };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  pacoteLoja()
    .then((r) => {
      const rel = (p: string) => path.relative(process.cwd(), p) || p;
      console.log(`Pacote da loja pronto: ${rel(r.zip)}`);
      console.log(`Imagens: ${r.imagens.map(rel).join(', ')}`);
      console.log(`Texto da listagem: ${rel(r.listagem)}`);
      console.log('Envie o .zip no painel da Chrome Web Store e no Edge Add-ons (passo a passo no README, "Publicar nas lojas").');
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}

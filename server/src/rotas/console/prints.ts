// Prints das execuções e dos testes de fluxo (C4, C6). A imagem já sai mascarada quando a
// Segurança pede; depois da retenção configurada o print deixa de existir.
import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { exigir } from '../../auth/console.ts';
import { agoraIso } from '../../db/banco.ts';
import { caminhoPrint, obterPrint, type LinhaPrint } from '../../navegador/prints.ts';
import { ErroHttp } from '../../util/erros.ts';

/** Largura e altura de um PNG (cabeçalho IHDR). */
function medidasPng(arquivo: string): { largura: number; altura: number } | null {
  try {
    const fd = fs.openSync(arquivo, 'r');
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    fs.closeSync(fd);
    if (b.toString('ascii', 1, 4) !== 'PNG') return null;
    return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}

const rotas: FastifyPluginAsync = async (app) => {
  const { banco, config } = app.ctx;

  const achar = (id: string): { print: LinhaPrint; arquivo: string } => {
    const print = obterPrint(banco, id);
    if (!print) throw new ErroHttp(404, 'nao_encontrado', 'Print não encontrado.');
    if (print.apagarEm && print.apagarEm < agoraIso()) {
      throw new ErroHttp(410, 'print_apagado', 'Este print já foi apagado pela regra de retenção da aba Segurança.');
    }
    const arquivo = caminhoPrint(config.dirDados, print.arquivo);
    if (!fs.existsSync(arquivo)) throw new ErroHttp(404, 'nao_encontrado', 'O arquivo deste print não existe mais.');
    return { print, arquivo };
  };

  app.get<{ Params: { id: string } }>('/:id', { preHandler: exigir('ver') }, async (request, reply) => {
    const { arquivo } = achar(request.params.id);
    return reply.header('cache-control', 'private, max-age=86400').type('image/png').send(fs.createReadStream(arquivo));
  });

  /** Legenda, destaque (em pixels da imagem) e medidas, para desenhar o destaque por cima. */
  app.get<{ Params: { id: string } }>('/:id/info', { preHandler: exigir('ver') }, async (request) => {
    const { print, arquivo } = achar(request.params.id);
    return {
      id: print.id,
      legenda: print.legenda,
      destaque: print.destaque,
      mascarado: print.mascarado,
      criadoEm: print.criadoEm,
      apagarEm: print.apagarEm,
      ...(medidasPng(arquivo) ?? { largura: null, altura: null }),
    };
  });
};

export default rotas;

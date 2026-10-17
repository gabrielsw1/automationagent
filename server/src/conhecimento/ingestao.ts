// Leitura de uma fonte para trechos, por tipo. Quem chama cuida de status, progresso e gravação.
import fs from 'node:fs/promises';
import path from 'node:path';
import { errosFonte } from './erros.ts';
import { lerDocx, lerMarkdown, lerPdf, lerTranscricao, lerTxt, tempoEmSegundos } from './extratores.ts';
import type { LinhaFonte, MetaFonte } from './fontes.ts';
import { metaDe } from './fontes.ts';
import { rastrearSite } from './rastreador.ts';
import { dividirEmTrechos, type TrechoNovo } from './trechos.ts';

export const LIMITE_PAGINAS_PADRAO = 50;
export const LIMITE_PAGINAS_MAX = 500;

export interface ContextoLeitura {
  dirDados: string;
  sinal: AbortSignal;
  /** Grava trechos assim que ficam prontos (o que já foi lido pode ser citado durante a indexação). */
  gravar: (trechos: TrechoNovo[]) => void;
  progresso: (feitos: number, total: number) => void;
}

/** Formatos aceitos pelo envio de arquivo e pelo de vídeo. */
export function formatoDoArquivo(nome: string): MetaFonte['formato'] | null {
  const ext = path.extname(nome).slice(1).toLowerCase();
  if (ext === 'pdf' || ext === 'docx' || ext === 'md' || ext === 'txt' || ext === 'vtt' || ext === 'srt') return ext;
  if (ext === 'markdown') return 'md';
  return null;
}

export function caminhoAbsoluto(dirDados: string, arquivo: string): string {
  return path.isAbsolute(arquivo) ? arquivo : path.join(dirDados, arquivo);
}

async function lerArquivoGuardado(dirDados: string, l: LinhaFonte): Promise<Buffer> {
  if (!l.arquivo) throw errosFonte.arquivoSumiu();
  try {
    return await fs.readFile(caminhoAbsoluto(dirDados, l.arquivo));
  } catch {
    throw errosFonte.arquivoSumiu();
  }
}

function verificarSinal(sinal: AbortSignal) {
  if (sinal.aborted) throw sinal.reason ?? new Error('interrompido');
}

function textoDoArquivo(dados: Buffer): string {
  // UTF-8 com BOM ou sem; se não for UTF-8 válido, tenta Latin-1 (arquivos antigos do Windows).
  const utf8 = dados.toString('utf8').replace(/^﻿/, '');
  return utf8.includes('�') ? dados.toString('latin1') : utf8;
}

/** Lê a fonte inteira e grava os trechos pelo `gravar`. Devolve o que muda no meta. */
export async function lerFonte(l: LinhaFonte, c: ContextoLeitura): Promise<Partial<MetaFonte>> {
  const meta = metaDe(l);
  switch (l.tipo) {
    case 'site': {
      const limite = Math.min(meta.limitePaginas ?? LIMITE_PAGINAS_PADRAO, LIMITE_PAGINAS_MAX);
      c.progresso(0, 1);
      const r = await rastrearSite({
        url: l.origem,
        limite,
        sinal: c.sinal,
        aoPagina: (p) => c.gravar(dividirEmTrechos(p.secoes, { titulo: p.titulo, url: p.url })),
        aoProgresso: (feitos, total) => c.progresso(feitos, total),
      });
      return { paginas: r.lidas, ignoradas: r.ignoradas.length };
    }

    case 'arquivo': {
      const dados = await lerArquivoGuardado(c.dirDados, l);
      verificarSinal(c.sinal);
      if (dados.length === 0) throw errosFonte.arquivoVazio();
      const formato = meta.formato ?? formatoDoArquivo(l.arquivo ?? l.nome);
      const titulo = l.nome;
      if (formato === 'pdf') {
        const pdf = await lerPdf(dados, (feitas, total) => {
          verificarSinal(c.sinal);
          c.progresso(feitas, total);
        });
        // Páginas são quase sempre fronteiras de trecho (o local "página 12" fica preciso).
        c.gravar(dividirEmTrechos(pdf.secoes, { titulo }, { fecharNaSecao: 150 }));
        return { paginas: pdf.paginas, tamanho: dados.length, formato };
      }
      c.progresso(0, 1);
      let secoes;
      if (formato === 'docx') secoes = (await lerDocx(dados)).secoes;
      else if (formato === 'md') secoes = lerMarkdown(textoDoArquivo(dados)).secoes;
      else if (formato === 'txt') secoes = lerTxt(textoDoArquivo(dados)).secoes;
      else throw errosFonte.tipoNaoAceito(path.extname(l.nome).slice(1));
      const trechos = dividirEmTrechos(secoes, { titulo });
      if (!trechos.length) throw errosFonte.arquivoVazio();
      c.gravar(trechos);
      c.progresso(1, 1);
      return { tamanho: dados.length, formato };
    }

    case 'video': {
      const dados = await lerArquivoGuardado(c.dirDados, l);
      c.progresso(0, 1);
      const t = lerTranscricao(textoDoArquivo(dados));
      if (!t.secoes.length) throw errosFonte.transcricaoVazia();
      const trechos = dividirEmTrechos(t.secoes, { titulo: l.nome, url: meta.url }).map((tr) => {
        // Link do vídeo já no ponto da fala: "...#t=134".
        const seg = tr.local ? tempoEmSegundos(tr.local) : null;
        return meta.url && seg !== null ? { ...tr, url: `${meta.url.split('#')[0]}#t=${seg}` } : tr;
      });
      if (!trechos.length) throw errosFonte.transcricaoVazia();
      c.gravar(trechos);
      c.progresso(1, 1);
      return { duracao: t.duracao };
    }

    case 'respostas': {
      // Cada resposta pronta vira um trecho. Sem a lista (fonte criada por fora), mantém o que há.
      if (!meta.itens) return {};
      c.gravar(meta.itens.map(trechoDaResposta));
      c.progresso(meta.itens.length, meta.itens.length);
      return {};
    }
  }
}

export function trechoDaResposta(r: { pergunta: string; resposta: string }): TrechoNovo {
  const pergunta = r.pergunta.trim();
  return { titulo: pergunta, local: 'resposta pronta', texto: `${pergunta}\n${r.resposta.trim()}` };
}

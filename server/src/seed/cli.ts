// `npm run seed`: recria o banco local com os dados de exemplo (apaga o que houver em DATA_DIR).
// Use `npm run seed -- --manter` para só completar um banco vazio, sem apagar nada.
import fs from 'node:fs';
import path from 'node:path';
import { lerConfig } from '../config.ts';
import { criarContexto } from '../contexto.ts';
import { bancoVazio, semear, SENHA_PADRAO } from './index.ts';

const config = lerConfig();
const arquivo = path.join(config.dirDados, 'copiloto.db');
const manter = process.argv.includes('--manter');

if (!manter) {
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });
  for (const pasta of ['arquivos', 'anexos', 'prints']) fs.rmSync(path.join(config.dirDados, pasta), { recursive: true, force: true });
}

const ctx = criarContexto(config);
if (!bancoVazio(ctx.banco)) {
  console.log(`O banco ${arquivo} já tem dados. Nada foi alterado (rode sem --manter para recriar).`);
} else {
  const r = semear(ctx);
  console.log(
    `Dados de exemplo gravados em ${arquivo}: ${r.equipe} pessoas na equipe, ${r.tarefas} tarefas, ` +
      `${r.execucoes} execuções e ${r.fontes} fontes de conhecimento.`,
  );
  console.log(`Entre no console com rafael.lima@seusistema.com.br e a senha ${SENHA_PADRAO}.`);
}
await ctx.navegador.fechar();
ctx.banco.fechar();

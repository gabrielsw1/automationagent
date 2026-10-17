// `npm run seed`: recria os dados locais com a empresa de demonstração (apaga o que houver em
// DATA_DIR, inclusive as empresas criadas pelo cadastro). Use `npm run seed -- --manter` para só
// criar a demonstração quando ainda não há nenhuma empresa, sem apagar nada.
import { lerConfig } from '../config.ts';
import { Plataforma } from '../plataforma/index.ts';
import { plataformaVazia, semearPlataforma, SENHA_PADRAO } from './index.ts';

const config = lerConfig();
const manter = process.argv.includes('--manter');

if (!manter) Plataforma.apagarDados(config.dirDados);

const plataforma = new Plataforma(config);
if (!plataformaVazia(plataforma)) {
  console.log(`Já existem empresas em ${config.dirDados}. Nada foi alterado (rode sem --manter para recriar).`);
} else {
  const r = semearPlataforma(plataforma);
  console.log(
    `Empresa de demonstração ${r.empresa.nome} criada em ${config.dirDados}: ${r.equipe} pessoas na equipe, ${r.tarefas} tarefas, ` +
      `${r.execucoes} execuções e ${r.fontes} fontes de conhecimento.`,
  );
  console.log(`Entre no console com rafael.lima@seusistema.com.br e a senha ${SENHA_PADRAO}.`);
}
await plataforma.fechar();

// Guia de início (C0): cinco passos calculados a partir do estado real.
import type { Guia } from '@copiloto/shared';
import type { Contexto } from '../contexto.ts';

let cacheConexao: { em: number; ok: boolean; detalhe: string } | null = null;

export async function conexaoSistema(ctx: Contexto): Promise<{ ok: boolean; detalhe: string }> {
  if (cacheConexao && Date.now() - cacheConexao.em < 30_000) return cacheConexao;
  const r = await ctx.adaptador.verificarConexao();
  cacheConexao = { em: Date.now(), ...r };
  return r;
}

export async function calcularGuia(ctx: Contexto): Promise<Guia> {
  const { banco, configuracoes, adaptador } = ctx;
  const conexao = await conexaoSistema(ctx);
  const publicadas = banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM tarefas WHERE versao_publicada IS NOT NULL')!.n;
  const primeira = banco.um<{ id: string; definicao: string }>(
    `SELECT t.id, v.definicao FROM tarefas t JOIN tarefa_versoes v ON v.tarefa_id = t.id AND v.versao = t.versao_publicada
     ORDER BY t.criado_em LIMIT 1`,
  );
  const rodada = banco.um<{ aprovados: number; total: number }>(
    'SELECT aprovados, total FROM testes_rodadas ORDER BY criado_em DESC LIMIT 1',
  );
  const marcados = configuracoes.ler('guia_feitos');
  const instalacao = configuracoes.ler('widget_instalacao');
  const membros = banco.um<{ n: number }>('SELECT COUNT(*) AS n FROM equipe')!.n;

  const nomePrimeira = primeira ? (JSON.parse(primeira.definicao) as { nome: string; campos: unknown[] }) : null;
  const passos: Guia['passos'] = [
    {
      chave: 'sistema',
      titulo: 'Conectar o seu sistema',
      feito: conexao.ok,
      resumo: conexao.detalhe,
    },
    {
      chave: 'tarefa',
      titulo: 'Criar a primeira tarefa',
      feito: publicadas > 0,
      resumo: nomePrimeira
        ? `Tarefa ${nomePrimeira.nome} criada, com ${nomePrimeira.campos.length} campos e confirmação antes de gravar.`
        : 'Descreva uma tarefa em português ou grave o fluxo na tela.',
    },
    {
      chave: 'testes',
      titulo: 'Testar com pedidos reais',
      feito: !!rodada && rodada.total > 0 && rodada.aprovados / rodada.total >= 0.8,
      resumo: rodada
        ? `${rodada.aprovados} de ${rodada.total} acertos em pedidos escritos como a sua equipe escreve.`
        : 'Rode os testes da tarefa com frases do jeito que a equipe escreve.',
    },
    {
      chave: 'widget',
      titulo: 'Personalizar e instalar o widget',
      feito: !!instalacao || marcados.includes('widget'),
      resumo: instalacao
        ? `Detectado em ${instalacao.origem}.`
        : 'Escolha como o copiloto se apresenta e cole um trecho de código no seu sistema.',
    },
    {
      chave: 'equipe',
      titulo: 'Convidar a equipe',
      feito: membros >= 2,
      resumo:
        membros >= 2
          ? `${membros} pessoas na equipe.`
          : 'Chame quem vai criar tarefas e acompanhar execuções.',
    },
  ];
  return {
    feitos: passos.filter((p) => p.feito).length,
    total: passos.length,
    passos,
    sistema: { conectado: conexao.ok, url: ctx.config.sistema.urlApi, nome: adaptador.nome },
  };
}

// Esquema do banco SQLite. Cada migração roda uma vez, na ordem; nunca edite uma migração
// já publicada, crie outra no fim da lista.
export const MIGRACOES: string[] = [
  `
  CREATE TABLE config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    atualizado_por TEXT,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE sequencias (
    nome TEXT PRIMARY KEY,
    valor INTEGER NOT NULL
  );

  -- Pessoas que acessam o console (não são os usuários do widget).
  CREATE TABLE equipe (
    id TEXT PRIMARY KEY,
    nome TEXT,
    email TEXT NOT NULL UNIQUE,
    perfil TEXT NOT NULL CHECK (perfil IN ('admin','editor','suporte','leitor')),
    status TEXT NOT NULL CHECK (status IN ('ativo','convidado')),
    senha_hash TEXT,
    convite_token TEXT,
    convite_enviado_em TEXT,
    convite_expira_em TEXT,
    ultimo_acesso TEXT,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE sessoes (
    token TEXT PRIMARY KEY,
    membro_id TEXT NOT NULL REFERENCES equipe(id) ON DELETE CASCADE,
    criado_em TEXT NOT NULL,
    expira_em TEXT NOT NULL
  );

  -- Catálogo de tarefas. A ficha fica em tarefa_versoes.
  CREATE TABLE tarefas (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('ativa','teste','rascunho','inativa')),
    versao_publicada INTEGER,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    atualizado_por TEXT
  );

  CREATE TABLE tarefa_versoes (
    tarefa_id TEXT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    versao INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('publicada','rascunho','arquivada')),
    definicao TEXT NOT NULL,
    resumo_mudancas TEXT,
    salvo_em TEXT NOT NULL,
    publicado_por TEXT,
    publicado_em TEXT,
    PRIMARY KEY (tarefa_id, versao)
  );

  CREATE TABLE tarefa_testes (
    id TEXT PRIMARY KEY,
    tarefa_id TEXT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    frase TEXT NOT NULL,
    esperado TEXT NOT NULL,
    ordem INTEGER NOT NULL
  );

  CREATE TABLE testes_rodadas (
    id TEXT PRIMARY KEY,
    tarefa_id TEXT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    versao INTEGER NOT NULL,
    aprovados INTEGER NOT NULL,
    total INTEGER NOT NULL,
    resultados TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );

  -- Fluxos gravados na tela (caminho navegador).
  CREATE TABLE fluxos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    tarefa_id TEXT,
    etapa TEXT NOT NULL,
    status TEXT NOT NULL,
    versao INTEGER NOT NULL DEFAULT 1,
    passos TEXT NOT NULL DEFAULT '[]',
    campos_sugeridos TEXT NOT NULL DEFAULT '[]',
    eventos_gravados TEXT NOT NULL DEFAULT '[]',
    token_gravacao TEXT UNIQUE,
    gravado_por TEXT,
    gravado_em TEXT,
    duracao_gravacao_ms INTEGER,
    url_inicial TEXT,
    ultimo_teste TEXT,
    criado_em TEXT NOT NULL,
    salvo_em TEXT NOT NULL
  );

  -- Conversas do widget (e do modo de teste do console).
  CREATE TABLE conversas (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    usuario_nome TEXT NOT NULL,
    canal TEXT NOT NULL CHECK (canal IN ('widget','teste')),
    usar_rascunhos INTEGER NOT NULL DEFAULT 0,
    contexto TEXT,
    estado TEXT NOT NULL DEFAULT 'copiloto',
    atendente_id TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    encerrada_em TEXT
  );
  CREATE INDEX conversas_usuario ON conversas(usuario_id, atualizado_em);

  -- O que a pessoa vê no chat.
  CREATE TABLE mensagens (
    id TEXT PRIMARY KEY,
    conversa_id TEXT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    autor TEXT NOT NULL,
    corpo TEXT NOT NULL,
    id_cliente TEXT,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX mensagens_conversa ON mensagens(conversa_id, seq);
  CREATE UNIQUE INDEX mensagens_id_cliente ON mensagens(conversa_id, id_cliente) WHERE id_cliente IS NOT NULL;

  -- Transcrição enviada ao Claude. Só cresce (append-only): preserva o cache e os blocos de thinking.
  CREATE TABLE transcricao (
    conversa_id TEXT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    papel TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    PRIMARY KEY (conversa_id, seq)
  );

  CREATE TABLE execucoes (
    id TEXT PRIMARY KEY,
    conversa_id TEXT,
    usuario_id TEXT NOT NULL,
    usuario_nome TEXT NOT NULL,
    tarefa_id TEXT,
    tarefa_nome TEXT NOT NULL,
    tarefa_versao INTEGER,
    pedido TEXT NOT NULL,
    caminho TEXT,
    status TEXT NOT NULL,
    canal TEXT NOT NULL,
    dados TEXT NOT NULL DEFAULT '{}',
    resultado TEXT,
    erro TEXT,
    diagnostico TEXT,
    criado_em TEXT NOT NULL,
    iniciado_em TEXT,
    concluido_em TEXT,
    duracao_ms INTEGER,
    custo_modelo REAL,
    custo_navegador REAL,
    confirmado_por TEXT,
    confirmado_em TEXT,
    ip TEXT,
    desfazer_ate TEXT,
    transferida_para TEXT,
    transferida_em TEXT,
    mensagem_cartao_id TEXT,
    mensagem_progresso_id TEXT,
    cancelar INTEGER NOT NULL DEFAULT 0,
    exemplo INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX execucoes_inicio ON execucoes(criado_em);
  CREATE INDEX execucoes_status ON execucoes(status);
  CREATE INDEX execucoes_usuario ON execucoes(usuario_id, criado_em);

  CREATE TABLE execucao_eventos (
    id TEXT PRIMARY KEY,
    execucao_id TEXT NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    detalhe TEXT,
    estado TEXT NOT NULL,
    dados TEXT,
    print_id TEXT,
    fim TEXT
  );
  CREATE INDEX execucao_eventos_exec ON execucao_eventos(execucao_id, ts);

  -- Prints de execuções e de testes de fluxo. O arquivo fica em DATA_DIR/prints.
  CREATE TABLE prints (
    id TEXT PRIMARY KEY,
    execucao_id TEXT,
    fluxo_id TEXT,
    arquivo TEXT NOT NULL,
    legenda TEXT,
    destaque TEXT,
    mascarado INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL,
    apagar_em TEXT
  );

  CREATE TABLE aprovacoes (
    id TEXT PRIMARY KEY,
    execucao_id TEXT NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
    solicitante_id TEXT NOT NULL,
    solicitante_nome TEXT NOT NULL,
    aprovador_id TEXT,
    aprovador_nome TEXT,
    perfil_necessario TEXT,
    estado TEXT NOT NULL,
    motivo TEXT,
    mensagem_id TEXT,
    criado_em TEXT NOT NULL,
    decidido_em TEXT,
    decidido_por TEXT
  );

  -- Cada chamada ao Claude, para custo e auditoria.
  CREATE TABLE uso_llm (
    id TEXT PRIMARY KEY,
    conversa_id TEXT,
    execucao_id TEXT,
    finalidade TEXT NOT NULL,
    modelo TEXT NOT NULL,
    entrada INTEGER NOT NULL,
    saida INTEGER NOT NULL,
    cache_leitura INTEGER NOT NULL DEFAULT 0,
    cache_escrita INTEGER NOT NULL DEFAULT 0,
    custo_usd REAL NOT NULL,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX uso_llm_data ON uso_llm(criado_em);

  -- Pedidos classificados (Haiku): alimenta "pedidos sem tarefa".
  CREATE TABLE pedidos (
    id TEXT PRIMARY KEY,
    conversa_id TEXT,
    usuario_id TEXT,
    texto TEXT NOT NULL,
    tipo TEXT NOT NULL,
    tarefa_slug TEXT,
    tema TEXT,
    ignorado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE conhecimento_fontes (
    id TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    nome TEXT NOT NULL,
    origem TEXT NOT NULL,
    status TEXT NOT NULL,
    erro TEXT,
    como_resolver TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    progresso_feitos INTEGER,
    progresso_total INTEGER,
    arquivo TEXT,
    enviado_por TEXT,
    criado_em TEXT NOT NULL,
    sincronizado_em TEXT
  );

  CREATE VIRTUAL TABLE conhecimento_trechos USING fts5(
    fonte_id UNINDEXED,
    titulo,
    local UNINDEXED,
    url UNINDEXED,
    texto,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE perguntas_sem_resposta (
    id TEXT PRIMARY KEY,
    pergunta TEXT NOT NULL,
    chave TEXT NOT NULL UNIQUE,
    causa TEXT NOT NULL,
    vezes INTEGER NOT NULL DEFAULT 1,
    ultima_em TEXT NOT NULL,
    resolvida INTEGER NOT NULL DEFAULT 0,
    resposta TEXT
  );

  CREATE TABLE auditoria (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    ator TEXT NOT NULL,
    acao TEXT NOT NULL,
    alvo TEXT NOT NULL,
    detalhe TEXT
  );
  CREATE INDEX auditoria_ts ON auditoria(ts);

  CREATE TABLE anexos (
    id TEXT PRIMARY KEY,
    conversa_id TEXT,
    usuario_id TEXT NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL,
    tamanho INTEGER NOT NULL,
    arquivo TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
  `,
  // 2: notas para o agente (o que mudou fora da conversa), dados internos da execução e candidato da recuperação visual.
  `
  ALTER TABLE conversas ADD COLUMN notas TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE execucoes ADD COLUMN interno TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE execucao_eventos ADD COLUMN candidato TEXT;
  `,
  // 3: SaaS. Este banco passa a ser de uma empresa só (DATA_DIR/empresas/<id>/copiloto.db).
  // Senhas e sessões do console foram para o banco da plataforma: equipe.senha_hash e a tabela
  // sessoes ficam sem uso. usuarios_sistema guarda quem chegou pelo snippet assinado (conector só pela tela).
  `
  CREATE TABLE usuarios_sistema (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT,
    perfis TEXT NOT NULL DEFAULT '[]',
    visto_em TEXT NOT NULL
  );
  `,
  // 4: quem mandou o convite (a tela de aceitar mostra "Convite de Rafael Lima, Admin").
  `
  ALTER TABLE equipe ADD COLUMN convidado_por TEXT;
  `,
];

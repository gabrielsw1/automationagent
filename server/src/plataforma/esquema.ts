// Banco da plataforma (DATA_DIR/plataforma.db): empresas clientes, contas de acesso ao console,
// sessões e o índice de quem está em qual empresa. Os dados de cada empresa (tarefas, fluxos,
// execuções, conversas, conhecimento, equipe) ficam no banco dela, em DATA_DIR/empresas/<id>/.
// Como em db/esquema.ts: nunca edite uma migração publicada, acrescente outra no fim.
export const MIGRACOES_PLATAFORMA: string[] = [
  `
  CREATE TABLE empresas (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ativa', 'suspensa')),
    demo INTEGER NOT NULL DEFAULT 0,
    -- SistemaGuardado em JSON: nome, url, conector, acesso (sem a senha) e perfis.
    sistema TEXT NOT NULL,
    -- Vai no snippet do widget (data-chave). Pública, mas única: diz de qual empresa é o widget.
    chave_publica TEXT NOT NULL UNIQUE,
    -- Cifrados com a chave mestra (plataforma/cofre.ts).
    segredo_widget TEXT NOT NULL,
    credenciais TEXT,
    -- Domínios liberados no widget publicado (para o CORS, antes de saber a empresa).
    dominios TEXT NOT NULL DEFAULT '[]',
    -- Dados do cadastro: CNPJ (nota e contrato), faixa de pessoas que usam o sistema (plano) e
    -- quando quem criou aceitou os termos de uso e o contrato de tratamento de dados (LGPD).
    cnpj TEXT,
    faixa_usuarios TEXT,
    termos_aceitos_em TEXT,
    criado_por TEXT,
    criado_em TEXT NOT NULL
  );

  -- Quem entra no console. A mesma conta pode estar na equipe de várias empresas.
  CREATE TABLE contas (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    nome TEXT,
    senha_hash TEXT NOT NULL,
    ultima_empresa_id TEXT,
    criado_em TEXT NOT NULL,
    ultimo_acesso TEXT
  );

  -- Índice e-mail → empresas, para a entrada e o "Trocar de empresa". Quem decide o acesso é a
  -- tabela equipe do banco da empresa (perfil e status), conferida a cada pedido.
  CREATE TABLE vinculos (
    email TEXT NOT NULL,
    empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    criado_em TEXT NOT NULL,
    PRIMARY KEY (email, empresa_id)
  );

  CREATE TABLE sessoes (
    token TEXT PRIMARY KEY,
    conta_id TEXT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
    empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    criado_em TEXT NOT NULL,
    expira_em TEXT NOT NULL
  );
  CREATE INDEX sessoes_conta ON sessoes(conta_id);
  `,
  // 2: acesso completo. E-mail confirmado por código (contas antigas já contam como confirmadas),
  // bloqueio depois de 5 senhas erradas, links de senha nova, último acesso por empresa e avisos
  // para a próxima entrada ("Seu acesso à Vetor CRM foi removido").
  `
  ALTER TABLE contas ADD COLUMN email_confirmado_em TEXT;
  UPDATE contas SET email_confirmado_em = criado_em;
  ALTER TABLE contas ADD COLUMN falhas_entrada INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contas ADD COLUMN bloqueada_ate TEXT;
  ALTER TABLE vinculos ADD COLUMN ultimo_acesso TEXT;

  CREATE TABLE codigos_email (
    conta_id TEXT PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    expira_em TEXT NOT NULL,
    tentativas_restantes INTEGER NOT NULL,
    enviado_em TEXT NOT NULL
  );

  CREATE TABLE links_senha (
    token_hash TEXT PRIMARY KEY,
    conta_id TEXT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
    expira_em TEXT NOT NULL,
    usado_em TEXT,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX links_senha_conta ON links_senha(conta_id);

  CREATE TABLE avisos_conta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    texto TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
  `,
  // 3: equipe da Starta (contas separadas das empresas, com verificação em duas etapas), modo
  // suporte e o acompanhamento de cada empresa no painel (fase, plano, responsável, implantação).
  `
  CREATE TABLE pessoas_starta (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    -- Sem senha e sem segredo até ativar pelo link (e de novo depois de "Redefinir acesso").
    senha_hash TEXT,
    -- Segredo do aplicativo autenticador, cifrado com a chave mestra.
    totp_segredo TEXT,
    -- Último intervalo de 30 s aceito: o mesmo código não entra duas vezes.
    totp_ultimo_passo INTEGER,
    ativa INTEGER NOT NULL DEFAULT 1,
    falhas_entrada INTEGER NOT NULL DEFAULT 0,
    bloqueada_ate TEXT,
    criado_por TEXT,
    criado_em TEXT NOT NULL,
    ativado_em TEXT,
    ultimo_acesso TEXT
  );
  CREATE TABLE ativacoes_starta (
    token_hash TEXT PRIMARY KEY,
    pessoa_id TEXT NOT NULL REFERENCES pessoas_starta(id) ON DELETE CASCADE,
    -- Segredo proposto no QR code, cifrado; vira o da pessoa quando ela confirma um código.
    segredo_pendente TEXT NOT NULL,
    expira_em TEXT NOT NULL,
    usado_em TEXT,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE recuperacao_starta (
    pessoa_id TEXT NOT NULL REFERENCES pessoas_starta(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    usado_em TEXT,
    PRIMARY KEY (pessoa_id, codigo_hash)
  );
  -- Etapa 'codigo': a senha conferiu e falta o código do autenticador.
  CREATE TABLE sessoes_starta (
    token_hash TEXT PRIMARY KEY,
    pessoa_id TEXT NOT NULL REFERENCES pessoas_starta(id) ON DELETE CASCADE,
    etapa TEXT NOT NULL CHECK (etapa IN ('codigo', 'completa')),
    tentativas_restantes INTEGER NOT NULL,
    criado_em TEXT NOT NULL,
    expira_em TEXT NOT NULL
  );
  CREATE TABLE aparelhos_starta (
    token_hash TEXT PRIMARY KEY,
    pessoa_id TEXT NOT NULL REFERENCES pessoas_starta(id) ON DELETE CASCADE,
    criado_em TEXT NOT NULL,
    expira_em TEXT NOT NULL
  );
  -- "Entrar como suporte": quem, em qual empresa, por quê e até quando. O cookie do console
  -- leva o token (sup.<token>); o hash fica aqui.
  CREATE TABLE acessos_suporte (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    pessoa_id TEXT NOT NULL REFERENCES pessoas_starta(id) ON DELETE CASCADE,
    empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    motivo TEXT NOT NULL,
    inicio TEXT NOT NULL,
    expira_em TEXT NOT NULL,
    encerrado_em TEXT
  );
  CREATE INDEX acessos_suporte_empresa ON acessos_suporte(empresa_id, inicio);
  ALTER TABLE empresas ADD COLUMN fase TEXT NOT NULL DEFAULT 'implantacao';
  ALTER TABLE empresas ADD COLUMN fase_desde TEXT;
  ALTER TABLE empresas ADD COLUMN plano_id TEXT;
  ALTER TABLE empresas ADD COLUMN responsavel_starta TEXT;
  ALTER TABLE empresas ADD COLUMN meta_tarefas INTEGER;
  ALTER TABLE empresas ADD COLUMN avaliacao_piloto_em TEXT;
  ALTER TABLE empresas ADD COLUMN suspensa_em TEXT;
  UPDATE empresas SET fase = 'ativo', fase_desde = criado_em WHERE demo = 1;
  UPDATE empresas SET fase_desde = criado_em WHERE fase_desde IS NULL;
  `,
];

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
];

// Banco da plataforma (DATA_DIR/plataforma.db): empresas clientes, contas de acesso ao console,
// sessões, o índice de quem está em qual empresa, os planos e os pedidos de contato do site. Os
// dados de cada empresa (tarefas, fluxos, execuções, conversas, conhecimento, equipe) ficam no
// banco dela, em DATA_DIR/empresas/<id>/.
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
  // 3: site do produto. A tabela de planos que o site lê (preço NULL aparece como "Sob consulta" até
  // a Starta definir; a semente são os três planos do design), os pedidos de contato do site
  // ("Agendar demonstração", "Falar com vendas"), que só se acrescentam, e a versão dos Termos de uso
  // e do contrato de tratamento de dados (LGPD) aceita no cadastro.
  `
  CREATE TABLE planos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    ordem INTEGER NOT NULL,
    descricao TEXT NOT NULL,
    usuarios_min INTEGER NOT NULL,
    -- NULL: sem limite ("Mais de 1.000 usuários").
    usuarios_max INTEGER,
    -- Por mês; NULL: sob medida.
    creditos_incluidos INTEGER,
    -- Centavos de real. NULL: ainda não definido.
    preco_mensal_centavos INTEGER,
    taxa_implantacao_centavos INTEGER,
    preco_credito_extra_centavos INTEGER,
    -- Linha abaixo do preço; {implantacao} vira a taxa de implantação.
    nota_preco TEXT NOT NULL DEFAULT '',
    -- JSON: itens da lista depois de usuários, créditos e crédito extra.
    destaques TEXT NOT NULL DEFAULT '[]',
    botao TEXT NOT NULL CHECK (botao IN ('cadastro', 'demonstracao', 'vendas')),
    atualizado_em TEXT NOT NULL
  );
  INSERT INTO planos (id, nome, ordem, descricao, usuarios_min, usuarios_max, creditos_incluidos, nota_preco, destaques, botao, atualizado_em) VALUES
    ('piloto', 'Piloto', 1, 'Para validar com um grupo de clientes, com a Starta ao seu lado.', 1, 200, 3000,
     'mais taxa de implantação {implantacao}, cobrada uma vez',
     '["Implantação assistida: gravamos as primeiras tarefas com você","Assistente no seu sistema, com a sua marca"]',
     'cadastro', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('crescimento', 'Crescimento', 2, 'Para levar o copiloto a toda a sua base de clientes.', 201, 1000, 15000,
     'sem taxa de implantação para quem vem do piloto',
     '["Conector por API opcional, para tarefas que já têm API"]',
     'demonstracao', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('escala', 'Escala', 3, 'Para bases grandes ou mais de um sistema.', 1001, NULL, NULL,
     'proposta conforme volume',
     '["Vários sistemas no mesmo espaço","Acordo de nível de serviço e contato dedicado"]',
     'vendas', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

  CREATE TABLE contatos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    empresa TEXT NOT NULL,
    telefone TEXT,
    -- FaixaUsuarios: quantos usuários o sistema tem.
    faixa TEXT NOT NULL,
    mensagem TEXT,
    origem TEXT NOT NULL CHECK (origem IN ('demonstracao', 'vendas', 'piloto')),
    criado_em TEXT NOT NULL,
    ip TEXT
  );
  CREATE INDEX contatos_criado ON contatos(criado_em);

  -- Ex.: "termos@2026-10-17 contrato-lgpd@2026-10-17" (plataforma/textos.ts, versaoDosTermos).
  ALTER TABLE empresas ADD COLUMN termos_versao TEXT;
  `,
];

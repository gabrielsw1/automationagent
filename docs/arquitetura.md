# Arquitetura do Copiloto

Documento de referência para quem mexe no código. Os tipos citados estão em `shared/src/*.ts`
(fonte da verdade dos contratos); este texto explica rotas, regras e quem cuida de cada parte.

## Peças e portas

| Peça | Pasta | Porta (dev) | O que é |
|---|---|---|---|
| Servidor do copiloto | `server/` | 3000 | API do widget, API do console, agente (Claude), motor de execução, navegador (Playwright), conhecimento, SQLite |
| Console | `console/` | 5173 (Vite, com proxy de `/api` e `/copiloto.js` para 3000) | Administração: telas C0–C9 do design |
| Widget | `widget/` | — (compilado em `widget/dist/copiloto.js`, servido pelo servidor em `/copiloto.js`) | Chat embutido no sistema anfitrião (Shadow DOM) + gravador de fluxos |
| Extensão do navegador | `extension/` | — (compilada em `extension/dist`, carregada sem compactação no Chrome ou no Edge) | Grava fluxos em qualquer site, com a captura e a barra do widget; fala com o servidor pelo service worker |
| Sistema de exemplo "Horizonte" | `sample-system/` | 4000 | Sistema fictício com API REST e telas HTML, para demonstrar tudo sem o sistema real |
| Contratos | `shared/` | — | Tipos TypeScript, validação de campos, formatação pt-BR, `styles/tokens.css` (único arquivo de cores) e `styles/base.css` |

Banco: `node:sqlite` (embutido no Node 22.13+), um arquivo por empresa em `DATA_DIR/empresas/<empresaId>/copiloto.db`
e o da plataforma em `DATA_DIR/plataforma.db` (padrão `data/`). Prints, anexos e arquivos gerados ficam dentro da pasta da empresa.

## Várias empresas (`server/src/plataforma/`)

O banco da plataforma (`plataforma/esquema.ts`) guarda o que é de todas as empresas; o resto fica no banco de cada uma.

| Tabela | O que guarda |
|---|---|
| `empresas` | id, nome, CNPJ, faixa de usuários, `demo`, `status` (`ativa`/`suspensa`), chave pública do widget, segredo do widget e senha da conta de serviço (cifrados com `COPILOTO_CHAVE_MESTRA`, AES-256-GCM, formato `v1.iv.tag.corpo`), sistema (`SistemaGuardado`: nome, endereço, conector, modo de acesso, perfis) e domínios liberados |
| `contas` | Uma por e-mail, com senha em scrypt. A mesma conta pode estar em várias empresas |
| `vinculos` | Índice conta ↔ empresa, para o login e a troca de empresa. Perfil e status da pessoa ficam na tabela `equipe` do banco da empresa, que manda |
| `sessoes` | Sessão do console (cookie `copiloto_sessao`, 7 dias): conta e empresa aberta |

Regras:

- Toda rota pega as peças da empresa com `ctxDe(request)` (o `Contexto` de `server/src/contexto.ts`). O console resolve a
  empresa pela sessão; o widget, pela chave pública (`POST /iniciar`) e depois pelo token (`{e, u, t?, exp}`, HMAC com `SESSAO_SEGREDO`);
  a gravação e o convite, pelo prefixo do token (`<empresaId>.<aleatório>`, `tokenDaEmpresa`/`empresaDoToken`); os links de
  arquivos, por `?e=<empresaId>&chave=`. Nada lê o banco de uma empresa a partir de um pedido de outra.
- `Plataforma.contexto(id)` abre (e guarda aberto) o contexto de uma empresa, com `configDaEmpresa`: pasta de dados, sistema e segredo do widget dela.
- CORS: `plataforma.dominioLiberado` olha a união dos domínios publicados de todas as empresas; o widget confere de novo o domínio da empresa dele.
- A empresa de demonstração (`demo = 1`) é a Horizonte do seed: conector `api` com o adaptador `ADAPTADOR` e as variáveis `SISTEMA_*`,
  sistema não editável no console. As outras usam o conector `tela` (`adaptadores/tela.ts`): pessoas e perfis aprendidos pelo
  snippet assinado (tabela `usuarios_sistema`), sem `chamar` (501 `sem_api`); as tarefas rodam por fluxos gravados.
- Assinatura do snippet: sempre obrigatória fora da demonstração. Texto assinado: `textoAssinado(id, {nome, email, perfis})` de `shared/src/widget.ts`.
- Acesso do navegador ao sistema da empresa (`SistemaGuardado.acesso.modo`):
  `sessao` (antes do fluxo, `POST urlSessao` com `{usuario, ts}` e `X-Copiloto-Assinatura: hmac_sha256_hex("<usuario>.<ts>", segredo do widget)`;
  resposta `{cookies:[{name, value, domain?, path?}]}` ou `{url}` de entrada única), `conta` (login com Playwright na `urlLogin`,
  `entrarComConta` em `navegador/executor.ts`) ou `nenhum`. Falhas viram `ErroAcessoSistema` com mensagem para pessoas, e nada roda no sistema.
- Plataforma Starta: contas próprias (`pessoas_starta`, `plataforma/starta.ts`), com senha e TOTP (`auth/totp.ts`), códigos de recuperação,
  aparelho confiável e sessão em duas etapas (`sessoes_starta.etapa`). `COPILOTO_ADMINS` só cria as primeiras contas e manda o link de
  ativação; `Eu.adminPlataforma` diz se o e-mail da conta tem acesso ativo à Plataforma. Modo suporte: cookie do console `sup.<token>`
  (`acessos_suporte`), perfil `suporte` por 60 minutos, auditoria e e-mail aos Admins da empresa.

## Regras que valem para todo o código

- Texto para pessoas em português do Brasil, frases completas, sem jargão técnico (o design é a referência de tom).
- Cores só por `var(--token)` de `shared/styles/tokens.css`. Nunca hex solto em CSS ou TSX.
  Papéis: `--brand-600` (#FA276B) só em peças sem texto (botão flutuante, logo, barras, gráficos, foco);
  botões com texto branco usam `--brand-btn`; links e texto de marca usam `--brand-700`;
  caminho navegador e falhas em gráficos usam `--accent-500` (vinho); sucesso usa `--success-*` (verde).
  Fonte Open Sans (Google Fonts), botões em pílula (`--r-btn`), cartões com raio 20px (`--r-card`).
- Componentes base prontos em `shared/styles/base.css`: `.btn .btn-primary .btn-secondary .btn-ghost .btn-accent`,
  `.card .card-pad .card-head .card-body .card-foot`, `.badge .badge-*`, `.chip`, `.input .select .textarea`,
  `.table-wrap`, `.tabs .tab`, `.alert`, `.toast`, `.progress`, `.step`, `.spinner`, `.empty`, `.switch`, `.segmented`,
  e as peças do chat (`.widget .composer .msg-user .msg-bot .bubble .action-card .launcher .context-pill`). Leia o arquivo antes de criar CSS novo.
- Erros de API: corpo `ErroApi { erro, mensagem, ref? }`. No servidor, lance `ErroHttp` (`server/src/util/erros.ts`).
- Datas trafegam em ISO (UTC). Mostre com `fmt.*` de `@copiloto/shared` (fuso America/Sao_Paulo).
- Nada grava no sistema sem o "Confirmar e executar" da pessoa. O copiloto sempre age com as permissões de quem pediu.
- Claude só pelo SDK oficial `@anthropic-ai/sdk`, via `app.ctx.llm` (`server/src/llm/`). Nunca chame a API por fetch,
  nunca use outro provedor. Toda chamada nova precisa de uma regra `simulacao` (os testes usam o modelo simulado, `COPILOTO_LLM=simulado`). Sem chave, `LlmSemChave` falha com `SemChaveClaude` (503 `sem_claude` nas rotas, aviso no widget).
  Modelo principal `claude-opus-5-5` (raciocínio, agente, aprender fluxo, recuperação visual, montar ficha, respostas com citação);
  `claude-haiku-5-5` (`modelo: 'rapido'`) só para classificação e roteamento baratos.
- A chave vem só de `ANTHROPIC_API_KEY`. Nunca grave chave em arquivo nem em log.

## Servidor: peças disponíveis em `app.ctx` (`server/src/contexto.ts`)

| Campo | Arquivo | Para quê |
|---|---|---|
| `config` | `config.ts` | Variáveis de ambiente com padrões |
| `banco` | `db/banco.ts` | `todos`, `um`, `executar`, `inserir`, `atualizar`, `transacao`, `proximo` (sequência); `json()` lê colunas JSON. Esquema em `db/esquema.ts` (para mudar, acrescente uma migração no fim de `MIGRACOES`) |
| `eventos` | `eventos.ts` | SSE: `emitirConversa`, `emitirUsuario`, `emitirConsole` |
| `llm` | `llm/` | `turno()` (agente, streaming + ferramentas) e `estruturado()` (saída com esquema zod, `modelo: 'principal' \| 'rapido'`, `simulacao` obrigatória) |
| `adaptador` | `adaptadores/` | Único ponto que conhece o sistema da empresa (`AdaptadorSistema`) |
| `configuracoes` | `servicos/configuracoes.ts` | `ler/gravar/metadados` de `widget_publicado`, `widget_rascunho`, `widget_chave_publica`, `widget_instalacao`, `limites`, `seguranca`, `guia_feitos` |
| `auditoria` | `servicos/auditoria.ts` | `registrar(ator, acao, alvo, detalhe?)`, `listar()` |
| `gastos` | `servicos/gastos.ts` | Custos em R$, `limites()`, `verificar()`, `pausaAtiva()`, `gastoEntre()` |
| `conversas` | `servicos/conversas.ts` | Mensagens do widget (emite SSE), transcrição do Claude (só acrescenta) |
| `catalogo` | `servicos/catalogo.ts` | Tarefas e versões (`criar`, `salvarRascunho`, `publicar`, `emUso`, `testes`...) |
| `conhecimento` | `conhecimento/` | `buscar`, `registrarSemResposta`, `responder`, `retomar` |
| `navegador` | `navegador/` | `executar` um fluxo gravado com Playwright, `disponivel`, `fechar` |
| `motor` | `execucao/motor.ts` | Confirmar, cancelar, desfazer, reexecutar, concluir, aprovações |
| `agente` | `agente/agente.ts` | Turno do agente a cada mensagem; `rodarTestes` de uma tarefa |
| `atendimento` | `servicos/atendimento.ts` | Passagem para uma pessoa e respostas do suporte |

Autenticação do console: `exigir('ver' | 'operar' | 'editar' | 'administrar')` como `preHandler`, e `membro(request)`
dentro do handler (`server/src/auth/console.ts`). Permissões por perfil em `shared/src/console.ts` (`PERMISSOES`, `pode`).

## Rotas e donos

Cada área tem um dono. Não edite arquivo de outra área; se precisar de mudança fora da sua, descreva no relatório final.

| Área | Arquivos | Dono |
|---|---|---|
| Núcleo do servidor, agente, motor, rotas do widget, login, resumo, SSE, seed principal, scripts | `server/src/{app,index,config,contexto,eventos}.ts`, `server/src/{db,llm,auth,agente,execucao,servicos,util,adaptadores}/`, `server/src/rotas/widget.ts`, `server/src/rotas/console/{index,auth,resumo,eventos,sistema,teste}.ts`, `server/src/seed/index.ts`, `scripts/`, `shared/` | coordenação |
| Sistema de exemplo | `sample-system/` | sistema-exemplo |
| Widget e gravador | `widget/` | widget |
| Extensão do navegador | `extension/` | extensão |
| Console: moldura, login, guia, painel, tarefas, busca | `console/src/{main.tsx,App.tsx,console.css}`, `console/src/{layout,componentes,api}/`, `console/src/paginas/{entrar,guia,painel,tarefas}/`; `server/src/rotas/console/{painel,guia,tarefas,busca}.ts`, `server/src/tarefas/` | console-a |
| Console: execuções, canais, equipe e limites | `console/src/paginas/{execucoes,canais,equipe}/`; `server/src/rotas/console/{execucoes,canais,equipe}.ts` | console-b |
| Navegador e aprender fluxo | `server/src/navegador/`, `server/src/rotas/gravacao.ts`, `server/src/rotas/console/{fluxos,prints}.ts`, `server/src/seed/fluxos.ts`, `console/src/paginas/aprender/` | navegador |
| Conhecimento | `server/src/conhecimento/`, `server/src/rotas/console/conhecimento.ts`, `server/src/seed/conhecimento.ts`, `console/src/paginas/conhecimento/` | conhecimento |

Peças compartilhadas do console (`console/src/api/cliente.ts`, `api/hooks.ts`, `componentes/estados.tsx`,
`componentes/sessao.tsx`) já existem: `api.get/post/put/patch/del/upload/url`, `useApi`, `useAcao`, `useEventosConsole`,
`Carregando`, `EstadoErro`, `EstadoOffline`, `EstadoVazio`, `SemPermissao`, `useSessao`, `usePode`. O console-a pode
acrescentar componentes em `console/src/componentes/` (exporte de lá); as outras áreas podem importar deles e
criar componentes próprios dentro da própria pasta de páginas. O `App.tsx` já tem todas as rotas; as páginas
ficam dentro do `Layout` (menu lateral e topo), então cada página renderiza só o conteúdo.

## Usuários e perfis do Horizonte (sistema de exemplo)

| ID | Nome | E-mail | Perfis |
|---|---|---|---|
| 101 | Ana Ribeiro | ana.ribeiro@horizonte.com.br | Atendimento, Comercial |
| 102 | Marcos Teixeira | marcos.teixeira@horizonte.com.br | Financeiro |
| 103 | Paula Nunes | paula.nunes@horizonte.com.br | Comercial |
| 104 | Diego Alves | diego.alves@horizonte.com.br | Técnico, Atendimento |
| 105 | Rafael Lima | rafael.lima@horizonte.com.br | Administradores, Gestor financeiro |
| 106 | Júlia Martins | julia.martins@horizonte.com.br | Administradores |
| 107 | Camila Souza | camila.souza@horizonte.com.br | Atendimento |

Perfis: Comercial, Financeiro, Atendimento, Técnico, Gestor financeiro, Administradores.
Técnicos de campo (lista do agendamento): Carlos Mendes, Fernanda Lopes, João Pereira.
Planos: Básico, Pro, Premium.

Equipe do console (seed, senha `copiloto123` para todos): rafael.lima@seusistema.com.br (Admin),
julia.martins@seusistema.com.br (Admin), camila.souza@seusistema.com.br (Suporte),
bruno.costa@seusistema.com.br (Leitor), convite pendente leticia.prado@seusistema.com.br (Suporte).

## API do Horizonte (o adaptador `server/src/adaptadores/exemplo` fala com ela)

Base `SISTEMA_API_URL` (padrão `http://localhost:4000`). Toda chamada leva
`Authorization: Bearer <SISTEMA_CHAVE_SERVICO>` (padrão `chave-servico-local`) e `X-Usuario-Id: <id>`;
o Horizonte aplica as permissões desse usuário. Sem chave válida: 401. JSON em tudo.

Cabeçalho `x-simulacao: 1` em POST/PUT/PATCH/DELETE: valida tudo (inclusive permissões e duplicidade) e responde
como se tivesse gravado, com `"simulado": true`, sem gravar nada. Cabeçalho `idempotency-key`: a mesma chave
devolve a mesma resposta sem gravar duas vezes.

| Método e caminho | Resposta |
|---|---|
| `GET /v1/saude` | `{ ok: true, versao }` (503 quando a demo "API instável" está ligada) |
| `GET /v1/usuarios` | `{ itens: [{ id, nome, email, perfis }] }` |
| `GET /v1/usuarios/:id` | usuário ou 404 |
| `GET /v1/perfis` | `{ itens: string[] }` |
| `GET /v1/rotas` | `{ itens: RotaApi[] }` (descrição das rotas abaixo, ver `adaptadores/tipos.ts`) |
| `POST /v1/sessoes` `{ usuario_id }` | 201 `{ cookie: { name: "hz_sessao", value }, expira_em }` (sessão das telas para o navegador do copiloto) |
| `GET /v1/clientes?documento=&busca=` | `{ itens: Cliente[] }` (documento só dígitos; busca por nome, sem acento e sem caixa) |
| `GET /v1/clientes/:id` | Cliente ou 404 |
| `POST /v1/clientes` `{ razao_social, cnpj, email_cobranca, prazo_pagamento_dias, responsavel_id }` | 201 Cliente; 409 `{ erro: "cnpj_duplicado", mensagem, existente: Cliente }`; 422 `{ erro: "validacao", mensagem, campos: { campo: mensagem } }`; 403 `{ erro: "sem_permissao", mensagem, perfil_necessario }` |
| `PATCH /v1/clientes/:id` | Cliente atualizado (mesmos campos, todos opcionais) |
| `DELETE /v1/clientes/:id` | 204 (desfazer cadastro) |
| `GET /v1/planos` | `{ itens: ["Básico", "Pro", "Premium"] }` |
| `POST /v1/planos/alteracoes` `{ cliente, plano, a_partir_de? }` | 201 `{ id, cliente_id, cliente_nome, plano_anterior, plano, a_partir_de }`; `cliente` aceita nome ou CNPJ; 404 `cliente_nao_encontrado`; 409 `ambiguo` com `opcoes`; 409 `mesmo_plano`; 403 sem perfil Gestor financeiro ou Administradores |
| `DELETE /v1/planos/alteracoes/:id` | 204 (volta ao plano anterior) |
| `POST /v1/relatorios/vendas` `{ periodo_inicio, periodo_fim, agrupar_por, formato }` | 201 `{ id, arquivo_url, linhas, total_vendas }` (`agrupar_por`: vendedor, regiao, produto; `formato`: pdf ou planilha; arquivo em `/arquivos/relatorios/:id.(pdf\|csv)`) |
| `POST /v1/chamados` `{ assunto, cliente, prioridade, descricao }` | 201 `{ id, numero }` (`prioridade`: Baixa, Média, Alta, Urgente) |
| `DELETE /v1/chamados/:id` | 204 |

Cliente: `{ id, codigo, razao_social, cnpj, email_cobranca, prazo_pagamento_dias, plano, responsavel_id, criado_em }`
(`id` numérico em texto, ex. "4821"; `codigo` "#4821"). Dados iniciais incluem a "ACME Log Ltda" (#3190,
CNPJ 12.345.678/0001-95, contato@acmelog.com.br, prazo 15), "Padaria Estrela", "Transportes Vale",
"Clínica Bem Viver", "Metalúrgica Sul", "Loja Aurora", "Pólen Café", "Delta Transportes" e outros, com CNPJs válidos.

Não há API para boletos nem para agenda: essas tarefas usam o caminho navegador.

Demonstração: `GET/POST /_demo/estado` `{ api_instavel: boolean, tela_agendamento_v2: boolean }` e a página `/_demo`.

## Telas do Horizonte (caminho navegador e gravador)

Todas as páginas têm `<body data-pagina="<Seção>">` (o widget mostra "Você está em <Seção>") e o snippet do copiloto
no fim do body. Login de demonstração em `/entrar` (escolhe um usuário da lista; cookie `hz_sessao`).

- `/clientes` (Clientes): lista. `/clientes/:id`: ficha, com `[data-campo="codigo"]` contendo "#4821".
- `/clientes/novo` (Clientes): rótulos e `name` estáveis: "Razão social" `razao_social`, "CNPJ" `cnpj`,
  "E-mail de cobrança" `email_cobranca`, "Prazo de pagamento" `<select name="prazo_pagamento_dias">` (15, 30, 45, 60 dias),
  "Responsável" `<select name="responsavel_id">`; botão "Salvar cliente". Sucesso redireciona para `/clientes/:id`.
- `/financeiro/segunda-via` (Financeiro): "CPF/CNPJ do pagador" `doc_pagador`, "Competência" `<select name="competencia">`
  (opções "10/2026", "09/2026", ... últimos 12 meses), botão "Buscar boletos". O resultado aparece na mesma página
  com uma tabela e um botão "Gerar 2ª via" por boleto: baixa `boleto-<numero>.pdf` e mostra a linha digitável em
  `[data-campo="linha_digitavel"]`. Sem boleto: "Nenhum boleto encontrado para este pagador e competência."
- `/agenda/nova-visita` (Agenda): "Cliente" `<input name="cliente" list=...>`, "Data da visita" `<input type="date" name="data_visita">`,
  "Horário" `<select name="horario">` (08:00 a 17:00), "Técnico" `<select name="tecnico">` (os três técnicos e
  "Primeiro disponível"), "Observações" `<textarea name="observacoes">`, botão "Agendar visita". Sucesso vai para
  `/agenda/visitas/:id` com `[data-campo="protocolo"]` (ex. "VT-2026-0412").
  Com a demo `tela_agendamento_v2` ligada a tela muda: o botão vira "Confirmar agendamento" e o campo de data passa a
  `name="dt_visita"` com rótulo "Data" (serve para mostrar a recuperação visual).
- `/relatorios`, `/chamados`: telas simples do sistema (não precisam de fluxo).
- `/ajuda` e `/ajuda/<artigo>`: central de ajuda do Horizonte (artigos curtos), usada como fonte de conhecimento.

Snippet (no layout de todas as páginas logadas):

```html
<script src="{COPILOTO_URL}/copiloto.js" data-chave="{COPILOTO_CHAVE}" data-usuario="{id}"
        data-assinatura="{hmac_sha256_hex(id, WIDGET_SEGREDO)}" async></script>
```

Padrões: `COPILOTO_URL=http://localhost:3000`, `COPILOTO_CHAVE=pk_local_horizonte`, `WIDGET_SEGREDO=segredo-widget-local`.

## API do widget (`/api/widget`, dono: coordenação; consumidor: widget)

Autenticação: `POST /iniciar` devolve `token`; as demais rotas usam `Authorization: Bearer <token>`
(no SSE, `?token=`). Tipos em `shared/src/widget.ts`.

| Rota | Corpo → resposta |
|---|---|
| `POST /iniciar` | `WidgetInicioPedido` → `WidgetInicio` (401 `assinatura_invalida`, 403 `dominio_nao_liberado`, 404 `usuario_nao_encontrado`) |
| `GET /sessao` | → `WidgetInicio` para um token já emitido (usado pelo console no modo de teste) |
| `GET /conversa` | → `ConversaWidget \| null` (conversa aberta do usuário) |
| `POST /conversas` `{ contexto? }` | → `ConversaWidget` (nova conversa) |
| `GET /conversas/:id` | → `ConversaWidget` |
| `POST /conversas/:id/mensagens` | `EnviarMensagemPedido` → `{ mensagem: MensagemWidget }`; a resposta do copiloto chega pelo SSE |
| `GET /eventos?token=&conversa=` | SSE de `EventoWidget` (`data: <json>`); comentário `: ping` a cada 25 s |
| `POST /execucoes/:id/confirmar` | → `{ ok }` (cartão vira confirmado; progresso e recibo chegam pelo SSE) |
| `POST /execucoes/:id/corrigir` | → `{ ok }` (o copiloto pergunta o que mudar) |
| `POST /execucoes/:id/cancelar` | → `{ ok }` |
| `POST /execucoes/:id/desfazer` | → `{ ok }` (dentro da janela de desfazer) |
| `POST /execucoes/:id/tentar` | → `{ ok }` (tentar de novo depois de erro) |
| `POST /execucoes/:id/atualizar-existente` | → `{ ok }` (conflito: novo cartão para atualizar o cadastro existente) |
| `GET /execucoes/:id/arquivos/:nome?token=` | arquivo gerado (ex. PDF do boleto) |
| `POST /aprovacoes/:id/enviar` / `POST /aprovacoes/:id/cancelar` | → `{ ok }` |
| `POST /conversas/:id/humano` `{ motivo? }` | → `{ ok }` (passa para uma pessoa; W8) |
| `POST /mensagens/:id/feedback` `{ valor: "util" \| "nao_util" }` | → `{ ok }` |
| `POST /anexos` (multipart, campo `arquivo`) | → `AnexoEnviado` |
| `POST /proativa` `{ pagina, segundosParado }` | → `{ sugestao: SugestaoProativa \| null }` |
| `GET /recentes` | → `ItemRecente[]` |

Ações de botão dentro das mensagens (`AcaoBloco.acao`): `abrir` (abre `url`), `mensagem` (envia `mensagem` como se a
pessoa tivesse escrito), `humano` (`POST /conversas/:id/humano`), `atualizar` (`POST /execucoes/:id/atualizar-existente`),
`tentar` (`POST /execucoes/:id/tentar`).

O pacote `widget` exporta para o console (`@copiloto/widget/chat` e `@copiloto/widget/chat.css`):

- `ChatCopiloto` — props `{ token: string; apiBase?: string; aoFechar?: () => void; altura?: number | string }`:
  chat completo ligado ao servidor (usa `GET /sessao` com o token). Usado no "Testar copiloto", na pré-visualização
  da ficha (C3) e no teste do guia (C0).
- `PreviaWidget` — props `{ config: WidgetConfigPublica; usuarioNome: string; pagina?: string }`: prévia estática
  do widget (C8 "Pré-visualização ao vivo"), sem servidor.

## Gravador de fluxos (`/api/gravacao`, dono: navegador; consumidor: widget)

O console cria o fluxo e abre `urlGravacao` numa aba nova: `{SISTEMA_URL}{urlInicial}?copiloto_gravacao=<token>&copiloto_api=<PUBLIC_URL>`
(os parâmetros vão antes do `#`). `urlInicial` é um caminho do sistema (`/chamados`) ou, para gravar pela extensão em
outro site, um endereço completo (`https://portal.fornecedor.com.br/pedidos`); o console aceita os dois e guarda o
caminho quando o endereço é do próprio sistema. `copiloto_gravacao` e `copiloto_api` saem de toda URL gravada
(`caminhoDe` no servidor, `Captura` e `descrever` no widget).

Quem grava:

- **Extensão do navegador** (`extension/`), quando está instalada. O content script roda em `document_start` em toda
  página http(s), põe o atributo `data-copiloto-extensao="<versão>"` (`MARCA_EXTENSAO`) no `<html>`, tira os dois
  parâmetros da barra de endereço e entrega o token ao service worker, que guarda a gravação da aba em
  `chrome.storage.session` (vale entre páginas e entre sites na mesma aba, até concluir, cancelar ou fechar a aba).
  A captura é a `Captura` do widget, rodando num content script no mundo da página (`world: "MAIN"`); a barra é a
  `BarraGravacao` do widget, num Shadow DOM aberto com `tokens.css`, `base.css` e `gravador.css`. Toda a rede passa
  pelo service worker (a `ApiGravacao` do widget, em lotes de até 10 eventos). O servidor é o de `copiloto_api`; sem
  ele, o das opções da extensão (padrão `http://localhost:3000`). `localhost` e `127.0.0.1` já vêm liberados; outros
  servidores pedem permissão nas opções (`optional_host_permissions`), e até lá os passos ficam guardados na aba.
- **Widget**, quando a extensão não está: detecta o parâmetro, guarda o token em `sessionStorage` (vale entre páginas),
  mostra a barra "Gravando" e envia os eventos. Com a marca da extensão no `<html>`, o gravador do widget não liga
  (`tokenParaGravar`), para não gravar duas vezes.

Os dois nunca enviam valores digitados: só o formato (`formatoDoValor` de `shared/src/validacao.ts`).

`GET /api/saude` → `{ ok, modoSimulado, sistema, urlConsole }`. A extensão lê `urlConsole` (`CONSOLE_URL`) para o
"Gravar esta aba" do popup, que abre `{urlConsole}/aprender?gravar=<endereço da aba>`: o console abre o "Começar
gravação" com a página preenchida e, no modal, diz se a extensão está instalada (pela marca no `<html>`).

| Rota | Corpo → resposta |
|---|---|
| `GET /api/gravacao/:token` | → `GravacaoEstado` |
| `POST /api/gravacao/:token/eventos` | `{ eventos: EventoGravado[] }` → `{ passos: number }` |
| `POST /api/gravacao/:token/concluir` | → `{ ok, fluxoId }` (o console passa para "Revisar") |
| `POST /api/gravacao/:token/cancelar` | → `{ ok }` |

## API do console (`/api/console`, sessão por cookie)

Tipos em `shared/src/console.ts`. Todas exigem sessão; a coluna "Permissão" é o mínimo.

Núcleo (coordenação): `POST /auth/entrar {email, senha}` → `Eu` (403 `sem_empresa` quando a conta não está em nenhuma empresa ativa);
`POST /auth/sair`; `GET /auth/eu`; `POST /auth/empresa {empresaId}` → `Eu` (troca a empresa aberta);
`GET /auth/primeiro-acesso` → `PrimeiroAcesso`; `POST /auth/cadastro` `CadastroEmpresaPedido` → `Eu` (cria a empresa e, sem sessão,
a conta; com sessão, `pessoa` é opcional e a empresa nova entra na conta); `GET /auth/convite/:token` → `ConviteAberto`;
`POST /auth/convite/:token` (`{nome, senha}` para conta nova, `{senha}` para conta que já existe) → `Eu`;
`GET /sistema/config` → `SistemaEmpresa`; `PUT /sistema/config` `SistemaEmpresaPedido` (administrar; 409 `sistema_fixo` na demonstração);
`POST /sistema/verificar {url}` → `VerificacaoSistema`; `POST /sistema/testar-acesso {usuarioId?}` → `VerificacaoSistema`;
`GET /canais/segredo` · `POST /canais/segredo/novo` → `SegredoWidget` (administrar);
`GET /resumo` → `ResumoConsole`; `GET /eventos` (SSE de `EventoConsole`, ver `server/src/eventos.ts`);
`GET /sistema/usuarios` → `UsuarioSistema[]`; `GET /sistema/perfis`; `GET /sistema/rotas` → `RotaApi[]`; `GET /sistema/conexao`;
`POST /teste/token {usuarioId}` → `{ token, usuario }` (token de widget em modo de teste para o `ChatCopiloto`).

A Plataforma Starta (todas as empresas) não passa por aqui: tem API própria em `/api/plataforma` (cookie `starta_sessao`,
rotas em `server/src/rotas/plataforma/`, tipos em `shared/src/plataforma.ts`) e tela própria no console em `/plataforma/*`.

console-a:

| Rota | Permissão | Resposta |
|---|---|---|
| `GET /painel?periodo=7d\|30d\|mes` | ver | `Painel` |
| `GET /guia` | ver | `Guia` (use `calcularGuia` de `servicos/guia.ts`) |
| `POST /guia/widget-verificado` | editar | `Guia` (409 com explicação se o widget ainda não foi visto) |
| `GET /tarefas` | ver | `ListaTarefas` |
| `POST /tarefas` `{ definicao }` | editar | `TarefaDetalhe` |
| `POST /tarefas/descrever` `{ descricao }` | editar | `{ definicao: TarefaDefinicao }` (Claude monta a ficha a partir do texto e das rotas da API) |
| `GET /tarefas/:id` | ver | `TarefaDetalhe` |
| `PUT /tarefas/:id/rascunho` `{ definicao }` | editar | `TarefaDetalhe` |
| `DELETE /tarefas/:id/rascunho` | editar | `TarefaDetalhe` |
| `POST /tarefas/:id/publicar` `{ resumoMudancas? }` | editar | `TarefaDetalhe` |
| `POST /tarefas/:id/status` `{ status }` | editar | `TarefaDetalhe` |
| `POST /tarefas/:id/restaurar` `{ versao }` | editar | `TarefaDetalhe` |
| `PUT /tarefas/:id/testes` `{ casos }` | editar | `CasoDeTeste[]` |
| `POST /tarefas/:id/testes/rodar` `{ usarRascunho }` | editar | `RodadaTestes` (chama `ctx.agente.rodarTestes`) |
| `POST /tarefas/:id/testar-chamada` | editar | `{ ok, status, duracaoMs, mensagem }` (chamada com `simulacao: true`) |
| `POST /tarefas/sem-tarefa/ignorar` `{ tema }` | editar | `{ ok }` |
| `GET /busca?q=` | ver | `{ itens: { tipo, titulo, detalhe, destino }[] }` |

console-b:

| Rota | Permissão | Resposta |
|---|---|---|
| `GET /execucoes?aba=todas\|atencao\|aprovacao&status=&canal=&tarefa=&periodo=hoje\|7d\|30d\|mes&busca=&pagina=` | ver | `ListaExecucoes` (10 por página) |
| `GET /execucoes/exportar.csv?<mesmos filtros>` | ver | CSV (`;`, UTF-8 com BOM) |
| `GET /execucoes/:id` | ver | `ExecucaoDetalhe` |
| `POST /execucoes/:id/reexecutar` | operar | `{ id }` (`motor.reexecutar`) |
| `POST /execucoes/:id/concluir` `{ nota? }` | operar | `{ ok }` (`motor.concluirManual`) |
| `POST /execucoes/:id/desfazer` | administrar | `{ ok }` (`motor.desfazer`) |
| `POST /execucoes/:id/avisar` `{ texto }` | operar | `{ ok }` (`atendimento.avisarUsuario`) |
| `POST /execucoes/:id/assumir` · `/responder {texto}` · `/encerrar-atendimento` | operar | `{ ok }` (`atendimento.*` na conversa da execução) |
| `POST /execucoes/aprovacoes/:id/decidir` `{ aprovado, motivo? }` | operar | `{ ok }` (`motor.decidirAprovacao`) |
| `GET /canais` | ver | `Canais` |
| `PUT /canais/rascunho` `{ config: ConfigWidget }` | editar | `Canais` |
| `POST /canais/publicar` · `POST /canais/descartar` | editar | `Canais` |
| `GET /equipe` | ver | `MembroEquipe[]` |
| `POST /equipe/convites` `{ email, perfil }` | administrar | `{ membro: MembroEquipe, linkConvite }` (sem envio de e-mail: o console mostra o link para copiar) |
| `POST /equipe/:id/reenviar` | administrar | `{ membro, linkConvite }` |
| `PUT /equipe/:id/perfil` `{ perfil }` · `DELETE /equipe/:id` | administrar | `MembroEquipe` / `{ ok }` (o único admin não pode ser rebaixado nem removido) |
| `GET /limites` · `PUT /limites` | ver · administrar | `Limites` |
| `GET /seguranca` · `PUT /seguranca` | ver · administrar | `Seguranca` |
| `GET /auditoria?antes=` | administrar | `RegistroAuditoria[]` |

navegador: `GET /fluxos` → `Fluxo[]`; `POST /fluxos {nome, tarefaId?, urlInicial}` → `{ fluxo, token, urlGravacao }`;
`GET /fluxos/:id`; `PUT /fluxos/:id` (revisar/mapear); `POST /fluxos/:id/aprender` (Claude transforma os eventos em passos e sugere campos);
`POST /fluxos/:id/testar {valores, usuarioId}`; `POST /fluxos/:id/publicar`; `DELETE /fluxos/:id`; `GET /prints/:id` (imagem);
`GET /prints/:id/info`; `GET /fluxos/:id/gravacao` (passos gravados até agora, para o "N passos até agora" ao vivo);
`POST /fluxos/:id/gravar` (abre uma gravação nova para o fluxo); `POST /fluxos/:id/concluir-gravacao`; `POST /fluxos/:id/cancelar-gravacao`;
`POST /fluxos/:id/nova-versao` (fluxo publicado fica só leitura: editar cria versão nova); `POST /fluxos/:id/criar-tarefa`
(ficha em rascunho com os campos sugeridos, frases de exemplo tiradas do nome do fluxo e recibo `<nome>: feito`, ou com o primeiro dado lido).
Execuções de teste usam IDs `teste_*`, gravam o uso do Claude com `execucao_id` nulo e penduram os prints no fluxo.

conhecimento: `GET /conhecimento/fontes` → `FonteConhecimento[]`; `POST /conhecimento/fontes/site {url, limitePaginas?}`;
`POST /conhecimento/fontes/arquivo` (multipart: PDF, DOCX, TXT, MD); `POST /conhecimento/fontes/video` (transcrição .vtt/.srt ou texto);
`POST /conhecimento/fontes/respostas {pergunta, resposta}`; `POST /conhecimento/fontes/:id/sincronizar`; `POST /conhecimento/fontes/:id/pausar`;
`DELETE /conhecimento/fontes/:id`; `GET /conhecimento/perguntas-sem-resposta`; `POST /conhecimento/perguntas-sem-resposta/:id/responder {resposta}`;
`POST /conhecimento/perguntas-sem-resposta/:id/ignorar`; `POST /conhecimento/testar {pergunta}` → `RespostaTeste`.

## Tarefas do seed

| Slug | Nome | Caminho | Status | Observação |
|---|---|---|---|---|
| `cadastrar_cliente` | Cadastrar cliente | API (`POST /v1/clientes`), reserva pelo fluxo `cadastro_cliente_tela` | ativa | campos `nome_empresa`, `cnpj`, `email_cobranca`, `prazo_pagamento` (15/30/45/60 dias), `responsavel` (pessoa, não pergunta); desfazer 5 min |
| `alterar_plano` | Alterar plano do cliente | API (`POST /v1/planos/alteracoes`) | ativa | perfis Gestor financeiro e Administradores; aprovador Gestor financeiro |
| `emitir_relatorio_vendas` | Emitir relatório de vendas | API (`POST /v1/relatorios/vendas`) | ativa | período, agrupar por, formato |
| `agendar_visita` | Agendar visita técnica | navegador (fluxo `agendar_visita`) | ativa | cliente, data, horário, técnico |
| `segunda_via_boleto` | Segunda via de boleto | navegador (fluxo `segunda_via_boleto`) | teste | liberada para 102, 105 e 106 |
| `abrir_chamado` | Abrir chamado de suporte | API (`POST /v1/chamados`) | rascunho | |

## Design

Arquivos do design (HTML de referência, uma tela por arquivo) em
`/tmp/claude-0/-home-claude/276c3a68-76bd-532a-8826-71662d4a7024/scratchpad/artifact-files/9a7953b7-91ba-4835-bd27-e7898dec987f/project/`
e o CSS em `../d29c19b1e712327eb31dd39e693985b1.css`. Estes arquivos ainda usam a paleta antiga (azul e laranja):
siga o layout, os textos e os estados, e pegue as cores de `shared/styles/tokens.css`.
Telas: `C0`–`C9` (console), `W1`–`W8` e `Widget-Contexto` (widget), `Estados-Console`, `Mobile-*` (console a 390 px),
`Componentes`, `Tokens`, `Jornada-*` (fluxos de ponta a ponta).

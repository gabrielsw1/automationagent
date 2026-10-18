# automationagent

Copiloto que executa tarefas dentro do sistema de cada empresa cliente, vendido como SaaS: cada empresa cria o próprio espaço, com equipe, tarefas, fluxos gravados, base de conhecimento e widget separados das outras.

A pessoa pede no widget, do jeito dela ("cadastra o cliente Pólen Café, CNPJ ..., prazo 30 dias"). O copiloto pergunta o que falta, mostra um cartão para conferir e só grava depois do "Confirmar e executar". Ele grava pela API do sistema e, onde não há API, pelo navegador, usando um fluxo gravado na tela. No fim, devolve um recibo com a opção de desfazer. A equipe configura tudo no console: tarefas, fluxos, base de conhecimento, widget, equipe e limites de gasto.

## Rodar (Windows, PowerShell)

Requisitos: Node.js 22.13 ou mais novo e Git.

```powershell
git clone https://github.com/gabrielsw1/automationagent
cd automationagent
setx ANTHROPIC_API_KEY "sua-chave"   # uma vez; depois FECHE e abra outro terminal
npm run dev
```

O `setx` só vale para terminais abertos depois dele. Para conferir se a chave chegou, rode `echo $env:ANTHROPIC_API_KEY` num terminal novo. Para usar só no terminal atual, rode `$env:ANTHROPIC_API_KEY = "sua-chave"`.

Na primeira vez, o `npm run dev` faz três coisas: instala as dependências, baixa o Chromium usado nas tarefas pelo navegador (cerca de 150 MB) e grava os dados de exemplo. Depois disso, abra:

| O quê | Endereço | Entrar com |
|---|---|---|
| Sistema de exemplo (Horizonte) com o widget | http://localhost:4000 | Ana Ribeiro (escolha na tela de login) |
| Console do copiloto (demonstração Horizonte) | http://localhost:5173 | `rafael.lima@seusistema.com.br` / `copiloto123` |
| Criar o espaço de uma empresa nova | http://localhost:5173/criar-conta | o e-mail de trabalho e a senha que você escolher |

No widget, abra o copiloto pelo botão no canto da tela ou com Ctrl+K.

Sem `ANTHROPIC_API_KEY`, o copiloto não finge responder: o widget avisa que o assistente ainda não está ligado e oferece falar com uma pessoa, e o console mostra uma faixa vermelha dizendo o que falta. Os testes usam respostas por regras com `COPILOTO_LLM=simulado`; esse modo nunca liga sozinho.

### Com Docker

```powershell
docker compose up --build
```

O Docker sobe o mesmo conjunto, já compilado: o console fica em http://localhost:3000 e o Horizonte em http://localhost:4000. A chave vem da variável `ANTHROPIC_API_KEY` do terminal (aqui também vale a regra do `setx` só funcionar em terminal novo).

### Outros comandos

| Comando | O que faz |
|---|---|
| `npm test` | Roda os testes de todos os pacotes. |
| `npm run lint` | Roda o ESLint e o typecheck de todos os pacotes. |
| `npm run seed` | Recria o banco local com os dados de exemplo (apaga `data/`). |
| `npm start` | Compila e sobe sem recarga (console em http://localhost:3000). |
| `npm run setup` | Baixa o Chromium, caso o download automático tenha falhado. |

## Frases para testar no widget

| Peça como Ana Ribeiro | O que acontece |
|---|---|
| `cadastra o cliente Pólen Café, CNPJ 11.222.333/0001-81, prazo 30 dias` | Pergunta o e-mail, mostra o cartão e grava pela API. Devolve o recibo (#4821) com Desfazer por 5 minutos. |
| `cadastra a ACME, CNPJ 12.345.678/0001-95, prazo 30 dias, cobrança financeiro@acme.com.br` | O CNPJ já existe: nada é gravado. Oferece abrir o cadastro existente ou atualizar. |
| `muda o plano da ACME para Premium` | Ana não tem o perfil necessário. O copiloto oferece pedir aprovação a Rafael Lima, e quem aprova é o console (Execuções › Aguardando aprovação). |
| `agenda visita técnica na Padaria Estrela segunda às 10h` | Executa pelo navegador, com o fluxo gravado. |
| `como emitir a segunda via de um boleto vencido?` | Responde pela base de conhecimento, citando a fonte. |
| `quero falar com uma pessoa` | Passa a conversa para o suporte com um resumo. No console, Execuções mostra a conversa e o botão Assumir. |

Como Paula Nunes, peça `relatório de vendas de setembro por vendedor em pdf`. O recibo traz o link do PDF. Como Marcos Teixeira, peça uma segunda via de boleto (essa tarefa ainda está em teste, liberada só para algumas pessoas).

Para ver as falhas acontecerem, abra http://localhost:4000/_demo. Lá você pode deixar a API instável ou mudar a tela de agendamento. Com a API instável, o copiloto tenta de novo e, se não der, passa a usar o fluxo gravado. Com a tela mudada, ele tenta a recuperação visual e transfere para uma pessoa quando não tem certeza.

## Extensão para gravar fluxos

A extensão do navegador grava um fluxo em qualquer site, mesmo onde o widget não está instalado. Ela funciona no Chrome e no Edge. Ao gravar, ela usa a mesma barra "Gravando" do widget, e o widget sai de cena.

### Instalar

1. Gere a extensão. Ela fica na pasta `extension\dist`:
   - Com `npm run dev` rodando, a pasta já existe e é recompilada a cada mudança.
   - Para gerar só uma vez, rode `npm run build`.
2. No Chrome, abra `chrome://extensions`. No Edge, abra `edge://extensions`.
3. Ligue o **Modo do desenvolvedor**. No Chrome, ele fica no canto superior direito. No Edge, fica na barra da esquerda.
4. Clique em **Carregar sem compactação** e escolha a pasta `extension\dist`, dentro da pasta do repositório.
5. Fixe o ícone: clique no ícone de quebra-cabeça da barra do navegador e depois no alfinete ao lado de **Copiloto · Gravador de fluxos**.

Mudou o código da extensão com o `npm run dev` rodando? Clique em recarregar (↻) no cartão dela em `chrome://extensions`.

### Gravar o primeiro fluxo

Antes de gravar, entre no sistema, por exemplo no Horizonte como Ana Ribeiro. Assim a gravação já começa na tela certa, e não na de login.

A gravação pode começar por dois lugares:

- **Pelo console:** abra **Aprender fluxo** › **Começar gravação**. Dê um nome ao fluxo, informe a página onde a tarefa começa e clique em **Abrir e gravar**. Abre uma aba do sistema com a barra "Gravando" no topo. O modal mostra "Extensão instalada" quando o console encontra a extensão.
- **Pelo ícone:** na aba do sistema, clique no ícone do Copiloto e em **Gravar esta aba**. O console abre o mesmo **Começar gravação**, com o endereço da aba já preenchido.

Depois, faça a tarefa uma vez, do começo ao fim. A extensão grava:

- cliques e listas escolhidas;
- campos preenchidos, só com o formato do que foi digitado (por exemplo, `99.999.999/9999-99`), nunca com o valor;
- trocas de página, mesmo quando a aba vai para outro site;
- downloads.

Senhas nunca são gravadas.

Para terminar, clique em **Concluir** na barra ou no ícone do Copiloto. **Cancelar** descarta a gravação. Em seguida, volte ao console e siga as etapas: **Revisar passos**, **Mapear campos**, **Testar** e **Publicar**.

### Usar outro servidor do copiloto

A extensão já vem liberada para `localhost` e `127.0.0.1`. A gravação aberta pelo console traz na URL o endereço do servidor certo. Para outro servidor, por exemplo `https://copiloto.suaempresa.com.br`:

1. Clique com o botão direito no ícone do Copiloto e escolha **Opções**.
2. Em **Servidor do copiloto**, escreva o endereço e clique em **Salvar**.
3. O navegador pede permissão para aquele endereço. Aceite.
4. Clique em **Testar conexão** para conferir.

O botão **Gravar esta aba** usa esse servidor. O padrão é `http://localhost:3000`, que é o do `npm run dev`. Quando uma gravação depende de um servidor que ainda não foi liberado, a barra avisa e oferece **Abrir as opções**. Os passos ficam guardados e são enviados assim que o servidor é liberado.

### Do início ao fim: gravar com a extensão e executar pelo widget

Com o `npm run dev` rodando e a extensão carregada:

1. Abra http://localhost:4000, entre como **Ana Ribeiro** e clique em **Chamados** no menu.
2. Clique no ícone do Copiloto na barra do navegador e depois em **Gravar esta aba**. O console abre em **Aprender fluxo**, com o **Começar gravação** aberto e a página `/chamados` preenchida. Se o console pedir login, entre com `rafael.lima@seusistema.com.br` / `copiloto123`: ele volta para o mesmo lugar.
3. Em **Nome do fluxo**, escreva `Abrir chamado`. Deixe **Tarefa** em "Sem tarefa por enquanto" e clique em **Abrir e gravar**.
4. Na aba do Horizonte que abriu, com a barra "Gravando · Abrir chamado" no topo, preencha o quadro **Abrir chamado**:
   - **Assunto:** `Impressora sem tinta`
   - **Cliente:** `Padaria Estrela`
   - **Prioridade:** `Alta`
   - **Descrição:** `A impressora do caixa parou de imprimir.`

   Depois clique no botão **Abrir chamado**.
5. Clique em **Concluir** na barra. Ela mostra "Gravação enviada. Volte ao console para revisar." Pode fechar essa aba.
6. Volte à aba do console. O fluxo está em **Revisar passos**, com um passo para cada coisa que você fez (6, neste exemplo). Clique em **Continuar para mapear**.
7. Em **Mapear campos**, clique em **Criar tarefa com estes dados** e depois em **Continuar para testes**. O quadro **Número do registro criado** pode ficar em branco: sem ele, o copiloto procura o número no aviso de confirmação que o Horizonte mostra depois de abrir o chamado.
8. Em **Testar**:
   - Em **Rodar como**, escolha **Ana Ribeiro**.
   - Preencha os valores do teste, por exemplo Assunto `Teste do copiloto`, Cliente `Padaria Estrela`, Prioridade `Baixa` e Descrição `Teste do fluxo gravado.`
   - Clique em **Rodar teste**. O teste abre um chamado de verdade no Horizonte.
   - Quando aparecer "Deu certo", a linha **Registro criado** mostra o número que o Horizonte deu ao chamado, por exemplo `Chamado CH-2026-0153`. Para o copiloto ler sempre daquele lugar da tela, volte a **Mapear campos** e clique em **Usar este lugar**.
   - Clique em **Continuar para publicar**.
9. Em **Publicar**, confira o resumo: o que o copiloto vai pedir, como executa, o **Custo previsto** e o último teste. Deixe **Mostrar no widget** ligado e clique em **Publicar versão 1**. O fluxo e a tarefa são publicados juntos, e a tarefa fica ativa para todos os perfis, Ana inclusive. Para escolher perfis, desmarque **Todos os perfis** antes de publicar.
10. Volte ao Horizonte (como Ana Ribeiro). Abra o copiloto pelo botão no canto da tela ou com Ctrl+K e escreva:

    `Abre um chamado para a Padaria Estrela sobre impressora sem tinta, prioridade alta`
11. O copiloto confirma o assunto, a prioridade e o cliente e pergunta a descrição. Responda, por exemplo: `A impressora do caixa parou de imprimir os cupons fiscais.`
12. Confira o cartão **Confirme: Abrir chamado** e clique em **Confirmar e executar**. O copiloto abre o chamado pela tela, com a sessão de Ana, num navegador que não aparece. Em alguns segundos, chega o recibo **Abrir chamado: feito**, com a linha **Chamado CH-2026-0154 · Padaria Estrela · Prioridade alta** (o número é o que o Horizonte deu, lido da tela) e o link **Abrir o chamado**, que abre o chamado novo no Horizonte.

O mesmo caminho, sem a extensão, roda nos testes: `npx vitest run test/navegador/chamado-horizonte.test.ts`, na pasta `server`, sobe o Horizonte e o copiloto em portas livres e confere que o número do recibo é o do chamado criado.

## Claude

- O código usa o SDK oficial `@anthropic-ai/sdk` e nenhuma camada compatível com OpenAI.
- O agente roda no `claude-opus-5-5`, com thinking adaptativo e streaming. O `claude-haiku-5-5` só classifica os pedidos, que é a parte barata.
- A chave vem só da variável `ANTHROPIC_API_KEY` e nunca é gravada.
- Para trocar o modelo ou o esforço, use `COPILOTO_MODELO`, `COPILOTO_MODELO_RAPIDO` e `COPILOTO_ESFORCO`. As outras variáveis estão em `.env.example`.

## Várias empresas (SaaS)

O copiloto atende várias empresas no mesmo servidor. Cada empresa tem um banco só dela, em `data/empresas/<id>/copiloto.db`, com equipe, tarefas, fluxos, execuções, conversas, conhecimento, widget e auditoria. A lista de empresas, as contas e as sessões ficam em `data/plataforma.db`.

- **Cadastro:** em `/criar-conta`, uma pessoa cria a conta e o espaço da empresa em 3 etapas, como no design: **Sua conta** (nome, e-mail de trabalho, senha), **Seu sistema** (endereço e como o copiloto entra) e **Sua marca** (nome do assistente, cor, logo e primeira mensagem). Quem cria vira Admin do espaço.
- **Uma conta, várias empresas:** a mesma pessoa pode estar em mais de uma empresa (por convite ou criando outra). O menu da conta, no topo do console, troca de empresa. Os perfis (Admin, Editor, Operador, Leitor) valem por empresa.
- **Isolamento:** toda rota do console e do widget abre o banco da empresa da sessão ou da chave do widget. Tokens de convite, de gravação e de widget levam a empresa e não valem em outra. Os domínios liberados de uma empresa não liberam o widget de outra.
- **Widget por empresa:** cada empresa tem a própria chave pública e o próprio segredo de assinatura (Canais e widget › Segredo, só Admin vê; dá para gerar outro). Para empresas clientes, a assinatura do snippet é sempre obrigatória.
- **Logo do widget:** em **Sua marca** ou em **Canais e widget › Aparência**, um PNG ou SVG quadrado de até 1 MB. O servidor confere o arquivo pelo conteúdo (SVG com script, eventos ou links externos é recusado) e guarda em `data/empresas/<id>/marca/`. O widget mostra o logo no topo e ao lado das respostas depois de **Publicar alterações**; sem logo, ou se a imagem não abrir, volta ao ícone padrão.
- **Demonstração:** a empresa Horizonte continua sendo criada pelo seed, com o sistema de exemplo configurado pelas variáveis `SISTEMA_*`. As empresas novas não mexem nela.
- **Plataforma Starta (`/plataforma`):** o painel interno da equipe Starta, com contas próprias, separadas das contas das empresas. Para entrar é preciso a senha e o código de 6 dígitos de um aplicativo autenticador (Google Authenticator, Microsoft Authenticator e parecidos), com 10 códigos de recuperação. Na primeira vez, cada e-mail de `COPILOTO_ADMINS` recebe um link de ativação, que também aparece no log do servidor. Depois disso, quem já está na equipe convida os outros em **Configurações**. O painel mostra as empresas com métricas e nunca o conteúdo das conversas, além de implantações, uso e custos, saúde dos fluxos, suporte e os preços dos planos. Pausar uma empresa derruba as sessões dela e para o widget. **Entrar como suporte** abre o console da empresa por 60 minutos com o perfil Suporte, pede o motivo, registra na auditoria da empresa e avisa os Admins dela por e-mail.
- **Créditos:** cada execução concluída gasta 1 crédito pelo roteiro gravado, ou 5 quando o agente visual consertou um passo. Testes não gastam. Um fluxo com mais de 10 consertos em 30 dias aparece como quebrado no painel da Starta.
- **Segredos:** a senha da conta de serviço de cada empresa é cifrada no banco (AES-256-GCM) com `COPILOTO_CHAVE_MESTRA` e nunca volta para o console.

## Ligar ao sistema de uma empresa

Empresas novas usam o conector **pela tela**: o copiloto opera as telas do sistema com os fluxos gravados (extensão ou widget), sem precisar de API. A recuperação visual com o Claude entra só quando a tela muda.

### 1. Snippet do widget

Em **Canais e widget**, o console mostra o snippet com a chave da empresa. O servidor do sistema da empresa assina quem está logado com o segredo da empresa:

```html
<script src="{COPILOTO_URL}/copiloto.js" data-chave="{chave pública}" data-usuario="{id}"
        data-nome="{nome}" data-email="{email}" data-perfis="{perfil1,perfil2}"
        data-assinatura="{hmac_sha256_hex(texto, segredo)}" async></script>
```

O `texto` assinado é só o `id` quando nome, e-mail e perfis ficam vazios. Com eles, é `id`, `nome`, `email` e os perfis separados por vírgula, um por linha (`\n`). O copiloto aprende as pessoas e os perfis por esse snippet; não há API para listar usuários.

### 2. Como o copiloto entra no sistema

Na página **Sistema** do console (ou na etapa 2 do cadastro):

- **Com a sessão de quem pede (recomendado):** antes de cada tarefa, o copiloto pede ao sistema uma sessão da pessoa que pediu. Assim, valem as permissões dela. O sistema precisa de um endereço de sessão:
  - O copiloto faz `POST {endereço de sessão}` com o corpo `{"usuario": "<id>", "ts": <milissegundos>}` e o cabeçalho `X-Copiloto-Assinatura: hmac_sha256_hex("<id>.<ts>", segredo)`, com o mesmo segredo do widget.
  - O sistema confere a assinatura, recusa `ts` com mais de 5 minutos de diferença e responde `{"cookies": [{"name": "...", "value": "...", "domain": "...", "path": "/"}]}` ou `{"url": "https://.../entrada?token=uso-unico"}` (um link de entrada que vale uma vez).
- **Com uma conta de serviço:** o copiloto entra na página de login com o usuário e a senha de uma conta criada para ele. Tudo é feito com as permissões dessa conta.
- **Sem login:** para sistemas abertos ou de teste.

O botão **Testar acesso** abre o navegador do copiloto e entra como antes de uma tarefa, sem fazer nada no sistema, e diz o que a tela respondeu.

### Conector pela API (avançado)

Para um sistema com API, dá para escrever um adaptador em `server/src/adaptadores/` (o do Horizonte, em `exemplo/`, é o modelo) implementando `AdaptadorSistema` (`server/src/adaptadores/tipos.ts`). Hoje só a demonstração usa esse conector, escolhido pela variável `ADAPTADOR`.

## Configuração do servidor (produção)

| Variável | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | Chave do Claude. Defina como variável de ambiente, nunca em arquivo. |
| `SESSAO_SEGREDO` | Assina as sessões do console e os tokens do widget. Troque em produção. |
| `COPILOTO_CHAVE_MESTRA` | Cifra os segredos das empresas no banco. Sem ela, deriva do `SESSAO_SEGREDO`. Guarde-a: sem ela, as senhas das contas de serviço não abrem. |
| `COPILOTO_ADMINS` | E-mails (separados por vírgula) da equipe Starta. Na primeira vez que o servidor sobe, cada e-mail sem conta recebe o link para ativar o acesso à Plataforma (senha e aplicativo autenticador); o link também sai no log. |
| `COPILOTO_CADASTRO` | `fechado` desliga o cadastro de empresas novas pela tela de entrada. |
| `EMAIL_VENDAS` | Recebe por e-mail os pedidos de **Agendar demonstração** e **Falar com vendas** do site, os pedidos de **Mudar de plano** e, na cobrança manual, cada fatura a cobrar. Sem ela, tudo fica só no banco da plataforma. |
| `TEXTOS_LEGAIS_DIR` | Pasta com os textos jurídicos aprovados (`termos.md`, `privacidade.md`, `contrato-lgpd.md`). O texto que faltar ali vem da minuta em `docs/legal`, com o aviso de revisão jurídica. |
| `PUBLIC_URL` e `CONSOLE_URL` | Endereços públicos do servidor e do console (links de arquivos e de convite). |
| `ASAAS_API_KEY` | Chave da conta do Asaas que cobra as faturas e os pacotes de créditos. Sem ela, a cobrança é manual (a Starta envia por e-mail e marca como paga no painel). No PowerShell, use aspas simples: `$env:ASAAS_API_KEY = '$aact_...'`. |
| `ASAAS_AMBIENTE` | `sandbox` (padrão, para testar) ou `producao`. |
| `ASAAS_WEBHOOK_TOKEN` | Token que você cadastra no webhook do Asaas, apontado para `{PUBLIC_URL}/api/pagamentos/asaas`. Sem ele, os avisos de pagamento são recusados. |
| `ASAAS_NOTA_FISCAL` | `1` emite a nota fiscal de serviço pelo Asaas a cada fatura paga (precisa dos dados fiscais configurados na conta do Asaas). |
| `ASAAS_NF_SERVICO_ID` ou `ASAAS_NF_SERVICO_CODIGO` | Serviço municipal da nota fiscal: o id no Asaas ou o código da prefeitura. |
| `ASAAS_NF_SERVICO_NOME` | Descrição do serviço na nota fiscal. |
| `ASAAS_NF_IMPOSTOS` | Impostos da nota, em percentuais: `iss=2,pis=0.65,cofins=3,reterIss=0` (o que faltar é zero). |

As outras variáveis estão em `.env.example`.

## O que acontece quando algo falha

- **Sistema fora do ar:**
  - O copiloto tenta mais 2 vezes (depois de 1 s e de 3 s).
  - Se ainda falhar e a tarefa tiver um fluxo gravado, segue pelo navegador.
  - Se não tiver, avisa a pessoa sem gravar nada, oferece tentar de novo e manda uma mensagem quando o sistema volta.
- **Regra de negócio** (CNPJ duplicado, cliente já no plano, sem permissão): o copiloto explica em português e oferece o próximo passo (abrir, atualizar, pedir aprovação).
- **Tela mudou:** a recuperação visual procura o campo ou botão parecido. Só age sozinha acima da confiança mínima da tarefa (85% no padrão). Abaixo disso, transfere para o suporte com os prints.
- **Limite de gasto:** ao atingir o limite, pausa as tarefas pelo navegador (ou tudo, conforme Equipe e limites) e avisa no widget.
- **Sem chave do Claude:** o assistente avisa que não está ligado e oferece uma pessoa; o console mostra a faixa com o que falta. As rotas que dependem do Claude (montar ficha, aprender fluxo) respondem 503 `sem_claude`.

## Estrutura

| Pasta | O que tem |
|---|---|
| `server/` | API do widget e do console, agente (Claude), motor de execução, navegador (Playwright), base de conhecimento, banco SQLite (`node:sqlite`), seed |
| `console/` | Console da equipe (React + Vite) |
| `widget/` | `copiloto.js`, o widget embutido no sistema, e o gravador de fluxos |
| `extension/` | Extensão do navegador (Chrome e Edge) que grava fluxos em qualquer site. `npm run build` gera `extension/dist` |
| `sample-system/` | Horizonte, o sistema de exemplo com API e telas |
| `shared/` | Tipos, validação e formatação usados por todos, e as cores da marca (`shared/styles/tokens.css`) |
| `docs/arquitetura.md` | Contratos entre as partes e decisões de arquitetura |

As cores ficam todas em `shared/styles/tokens.css`. Para trocar a paleta, basta editar esse arquivo.

# automationagent

Copiloto que executa tarefas dentro do sistema da empresa. O código chega pelo PR da branch `claude/copiloto-build`.

A pessoa pede no widget, do jeito dela ("cadastra o cliente Pólen Café, CNPJ ..., prazo 30 dias"). O copiloto pergunta o que falta, mostra um cartão para conferir e só grava depois do "Confirmar e executar". Ele grava pela API do sistema e, onde não há API, pelo navegador, usando um fluxo gravado na tela. No fim, devolve um recibo com a opção de desfazer. A equipe configura tudo no console: tarefas, fluxos, base de conhecimento, widget, equipe e limites de gasto.

## Rodar (Windows, PowerShell)

Requisitos: Node.js 22.13 ou mais novo e Git.

```powershell
git clone https://github.com/gabrielsw1/automationagent
cd automationagent
git checkout claude/copiloto-build
setx ANTHROPIC_API_KEY "sua-chave"   # uma vez; depois FECHE e abra outro terminal
npm run dev
```

O `setx` só vale para terminais abertos depois dele. Para conferir se a chave chegou, rode `echo $env:ANTHROPIC_API_KEY` num terminal novo. Para usar só no terminal atual, rode `$env:ANTHROPIC_API_KEY = "sua-chave"`.

Na primeira vez, o `npm run dev` faz três coisas: instala as dependências, baixa o Chromium usado nas tarefas pelo navegador (cerca de 150 MB) e grava os dados de exemplo. Depois disso, abra:

| O quê | Endereço | Entrar com |
|---|---|---|
| Sistema de exemplo (Horizonte) com o widget | http://localhost:4000 | Ana Ribeiro (escolha na tela de login) |
| Console do copiloto | http://localhost:5173 | `rafael.lima@seusistema.com.br` / `copiloto123` |

No widget, abra o copiloto pelo botão no canto da tela ou com Ctrl+K.

Sem `ANTHROPIC_API_KEY`, tudo funciona em **modo simulado**: as respostas seguem regras fixas, e o widget e o console mostram um aviso. É o modo usado nos testes.

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
7. Em **Mapear campos**, clique em **Criar tarefa com estes dados** e depois em **Continuar para testes**.
8. Em **Testar**:
   - Em **Rodar como**, escolha **Ana Ribeiro**.
   - Preencha os valores do teste, por exemplo Assunto `Teste do copiloto`, Cliente `Padaria Estrela`, Prioridade `Baixa` e Descrição `Teste do fluxo gravado.`
   - Clique em **Rodar teste**. O teste abre um chamado de verdade no Horizonte.
   - Quando aparecer "Deu certo", clique em **Continuar para publicar**.
9. Em **Publicar**, clique em **Publicar versão 1** e depois em **Abrir a ficha da tarefa**.
10. Na ficha da tarefa **Abrir chamado**, clique em **Publicar versão 1**, no topo, e confirme em **Publicar versão 1**. A tarefa fica ativa para todos os perfis, Ana inclusive.
11. Volte ao Horizonte (como Ana Ribeiro). Abra o copiloto pelo botão no canto da tela ou com Ctrl+K e escreva:

    `Abre um chamado para a Padaria Estrela sobre impressora sem tinta, prioridade alta`
12. O copiloto confirma o assunto, a prioridade e o cliente e pergunta a descrição. Responda, por exemplo: `A impressora do caixa parou de imprimir os cupons fiscais.`
13. Confira o cartão **Confirme: Abrir chamado** e clique em **Confirmar e executar**. O copiloto abre o chamado pela tela, com a sessão de Ana, num navegador que não aparece. Em alguns segundos, chega o recibo **Abrir chamado: feito**. Recarregue **Chamados** e o chamado novo estará no topo da lista.

## Claude

- O código usa o SDK oficial `@anthropic-ai/sdk` e nenhuma camada compatível com OpenAI.
- O agente roda no `claude-opus-5-5`, com thinking adaptativo e streaming. O `claude-haiku-5-5` só classifica os pedidos, que é a parte barata.
- A chave vem só da variável `ANTHROPIC_API_KEY` e nunca é gravada.
- Para trocar o modelo ou o esforço, use `COPILOTO_MODELO`, `COPILOTO_MODELO_RAPIDO` e `COPILOTO_ESFORCO`. As outras variáveis estão em `.env.example`.

## Ligar ao seu sistema de verdade

O copiloto só fala com o sistema da empresa por um **adaptador**, em `server/src/adaptadores/`. O do Horizonte (`exemplo/`) serve de modelo.

1. Copie `server/src/adaptadores/exemplo/` para uma pasta nova, por exemplo `meu-sistema/`.
2. Implemente a interface `AdaptadorSistema` (`server/src/adaptadores/tipos.ts`):
   - `buscarUsuario` e `listarUsuarios`: quem usa o widget e com quais perfis.
   - `chamar`: uma chamada à API sempre em nome de quem pediu, para valerem as permissões dessa pessoa. Nos testes do console, ela roda em modo simulação, sem gravar.
   - `sessaoNavegador`: cookies que deixam o navegador logado como a pessoa, sem senha.
   - `descreverApi` (opcional) e `baixarArquivo` (opcional).
3. Registre a pasta em `server/src/adaptadores/index.ts` e rode com `ADAPTADOR=meu-sistema`, `SISTEMA_NOME`, `SISTEMA_URL`, `SISTEMA_API_URL` e `SISTEMA_CHAVE_SERVICO`.
4. Coloque o snippet do console (Canais e widget) nas páginas do seu sistema. O `data-assinatura` é um HMAC-SHA256 do ID do usuário com `WIDGET_SEGREDO`, calculado no servidor do seu sistema. O console mostra exemplos em Node, PHP e Python.
5. Crie as tarefas no console: escreva o que a tarefa faz ou grave o fluxo na tela.

Nada mais muda: agente, motor, console e widget não conhecem o Horizonte.

## O que acontece quando algo falha

- **Sistema fora do ar:**
  - O copiloto tenta mais 2 vezes (depois de 1 s e de 3 s).
  - Se ainda falhar e a tarefa tiver um fluxo gravado, segue pelo navegador.
  - Se não tiver, avisa a pessoa sem gravar nada, oferece tentar de novo e manda uma mensagem quando o sistema volta.
- **Regra de negócio** (CNPJ duplicado, cliente já no plano, sem permissão): o copiloto explica em português e oferece o próximo passo (abrir, atualizar, pedir aprovação).
- **Tela mudou:** a recuperação visual procura o campo ou botão parecido. Só age sozinha acima da confiança mínima da tarefa (85% no padrão). Abaixo disso, transfere para o suporte com os prints.
- **Limite de gasto:** ao atingir o limite, pausa as tarefas pelo navegador (ou tudo, conforme Equipe e limites) e avisa no widget.
- **Sem chave do Claude:** roda em modo simulado.

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

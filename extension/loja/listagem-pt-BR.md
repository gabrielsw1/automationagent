# Copiloto · Gravador de fluxos: texto da listagem nas lojas

Texto para colar no painel da Chrome Web Store e do Edge Add-ons. O `npm run loja -w extension`
gera o pacote (.zip) e as imagens em `extension/dist-loja`. O passo a passo da publicação está no
README, em "Publicar nas lojas".

## Ficha

| Campo | Valor |
| --- | --- |
| Nome | Copiloto · Gravador de fluxos |
| Desenvolvedor | Starta |
| Idioma | Português (Brasil) |
| Navegadores | Chrome e Edge |
| Categoria (Chrome Web Store) | Produtividade › Ferramentas |
| Categoria (Edge Add-ons) | Produtividade |
| Visibilidade sugerida | Não listada, enquanto só os clientes do Copiloto usam |

## Resumo (até 132 caracteres)

Grave uma vez o caminho de uma tarefa no sistema web da sua empresa e o Copiloto aprende a repetir sozinho.

## Descrição

Grave uma vez o caminho de uma tarefa no sistema web da sua empresa e o Copiloto aprende a repetir sozinho.

Funciona com a conta do Copiloto da sua empresa. A extensão grava cliques, listas escolhidas e o formato do que é digitado, nunca os valores nem as senhas.

Como funciona:
• Entre com a conta do Copiloto pelo ícone da extensão. A entrada acontece no console do Copiloto; a extensão não pede senha.
• Abra a tela do sistema e clique em "Gravar esta aba". O console abre com o endereço já preenchido: dê um nome ao fluxo e comece a gravar.
• Faça o caminho normalmente. Uma barra mostra que a aba está sendo gravada e um painel lista os passos assim que eles chegam ao Copiloto.
• Clique em Concluir. A gravação vai para o console, onde você revisa os passos antes de virar uma tarefa.

O que a extensão nunca grava:
• Valores digitados: só o formato (por exemplo, 99.999.999/9999-99 num CNPJ).
• Senhas, nem o formato delas.
• Nada fora das abas em que você começou uma gravação.

Quem pode gravar: as pessoas com perfil Admin ou Editor de tarefas na empresa. Sem conexão no fim da gravação, os passos ficam guardados e são enviados quando a internet voltar.

## Propósito único

Gravar o caminho de uma tarefa feita num sistema web para o Copiloto da empresa aprender a repeti-la.

## Por que cada permissão

| Permissão | Justificativa |
| --- | --- |
| storage | Guarda o endereço do servidor do Copiloto (opções), a conta conectada e os passos de uma gravação em andamento até eles serem enviados. |
| activeTab | Lê o endereço da aba atual quando a pessoa clica em "Gravar esta aba", para abrir o console com o endereço preenchido. |
| scripting | Logo depois de instalar ou atualizar, coloca o gravador nas abas que já estavam abertas, para o console perceber a extensão sem recarregar a página. |
| Acesso aos sites (scripts de conteúdo em http e https) | O sistema de cada empresa fica num endereço diferente. Em cada página, a extensão só marca que está instalada e fica parada; ela só captura cliques e formatos depois que a pessoa começa uma gravação pelo console. |
| Acesso opcional a outros servidores | Pedido nas opções, com o clique da pessoa, para a extensão falar com o servidor do Copiloto da empresa (fora do localhost). |
| Código remoto | Não usa. Todo o código vai no pacote. |

## Dados (formulário de privacidade da loja)

| Tipo de dado | Coleta? | Para quê |
| --- | --- | --- |
| Informações de identificação pessoal | Sim | Nome e e-mail da conta do Copiloto, para mostrar no popup para qual empresa vão as gravações. |
| Atividade na web | Sim, só durante uma gravação | Endereços das páginas e cliques da aba gravada, enviados ao servidor do Copiloto da empresa. |
| Conteúdo do site | Não | Valores digitados não saem do navegador; só o formato. Senhas, nunca. |
| Autenticação | Não | A extensão não vê a senha. Guarda um token próprio, que vale só para gravar e é cancelado em "Sair". |
| Localização, saúde, finanças, comunicações | Não | |

Declarações: os dados não são vendidos a terceiros, não são usados para nada além do propósito único e não são usados para avaliar crédito.

## Endereços pedidos pela loja

- Política de privacidade: a página de privacidade da empresa que publica (obrigatória porque a extensão lida com nome e e-mail).
- Site de suporte: a página de ajuda do Copiloto, ou o e-mail de suporte.

## Imagens

Geradas em `extension/dist-loja` pelo `npm run loja -w extension`, nas cores de `shared/styles/tokens.css`:

| Arquivo | Tamanho | Onde usar |
| --- | --- | --- |
| icone-128.png | 128 × 128 (arte em 96 × 96) | Ícone da Chrome Web Store |
| logo-300.png | 300 × 300 | Logo do Edge Add-ons |
| promocional-440x280.png | 440 × 280 | Bloco promocional pequeno (as duas lojas) |

As capturas de tela (1280 × 800, de 1 a 5) saem do console e do sistema da empresa: popup "Gravar esta aba", barra e painel "Passos gravados" na página, e a revisão no console.

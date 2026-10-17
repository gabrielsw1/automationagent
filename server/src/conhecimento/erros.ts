// Erros de leitura de uma fonte, em linguagem simples e com "como resolver" (mostrado no cartão da fonte).

export class ErroFonte extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly comoResolver: string,
  ) {
    super(mensagem);
    this.name = 'ErroFonte';
  }
}

export const LIMITE_ARQUIVO_MB = 20;

export const errosFonte = {
  siteLogin: () =>
    new ErroFonte(
      'site_login',
      'O site pede login, então o copiloto não consegue ler as páginas.',
      'Use o endereço público da central de ajuda (o que abre numa janela anônima sem pedir senha). Se o conteúdo só existe com login, exporte as páginas em PDF e envie como arquivo.',
    ),
  siteProibido: () =>
    new ErroFonte(
      'site_403',
      'O site recusou o acesso do copiloto (erro 403).',
      'Peça a quem cuida do site para liberar o acesso do robô "CopilotoBot" ou do endereço do servidor do copiloto. Enquanto isso, você pode exportar as páginas em PDF e enviar como arquivo.',
    ),
  siteNaoEncontrado: () =>
    new ErroFonte(
      'site_404',
      'O endereço não foi encontrado (erro 404).',
      'Abra o endereço no navegador para conferir se está certo, copie de novo da barra de endereços e adicione a fonte outra vez.',
    ),
  siteForaDoAr: (detalhe?: string) =>
    new ErroFonte(
      'site_fora_do_ar',
      `Não foi possível abrir o site${detalhe ? ` (${detalhe})` : ''}.`,
      'Confira se o endereço abre no navegador. Se o site estiver fora do ar, tente sincronizar de novo mais tarde.',
    ),
  siteBloqueado: () =>
    new ErroFonte(
      'site_robots',
      'O site pede para robôs não lerem estas páginas (regra no robots.txt).',
      'Peça a quem cuida do site para liberar este caminho no robots.txt, ou envie o conteúdo como arquivo (PDF ou DOCX).',
    ),
  siteNaoHtml: () =>
    new ErroFonte(
      'site_nao_html',
      'O endereço não abre uma página de texto (pode ser um arquivo para baixar).',
      'Se for um PDF ou documento, baixe e envie em "Adicionar fonte › Arquivo". Se for um site, use o endereço da página inicial da central de ajuda.',
    ),
  siteSemTexto: () =>
    new ErroFonte(
      'site_sem_texto',
      'As páginas abriram, mas não encontramos texto para ler.',
      'Confira se o endereço leva à central de ajuda e não a uma página em branco. Sites que só mostram o conteúdo depois de carregar programas no navegador não podem ser lidos: exporte as páginas em PDF e envie como arquivo.',
    ),
  urlInvalida: () =>
    new ErroFonte(
      'url_invalida',
      'O endereço não parece válido.',
      'Copie o endereço completo da barra do navegador, começando com https://.',
    ),
  pdfSenha: () =>
    new ErroFonte(
      'pdf_senha',
      'Não foi lido: o PDF está protegido por senha.',
      'Abra o arquivo, remova a senha (ou use "Imprimir › Salvar como PDF" para gerar uma cópia sem senha) e envie de novo. Enquanto isso, o copiloto não usa esta fonte.',
    ),
  pdfEscaneado: () =>
    new ErroFonte(
      'pdf_escaneado',
      'Não foi lido: o PDF parece ser uma digitalização (só imagens, sem texto).',
      'Gere uma versão com texto usando reconhecimento de texto (OCR): no Google Drive, abra o PDF com "Documentos Google" e baixe como .docx; no Adobe Acrobat, use "Digitalizar e OCR". Depois envie de novo.',
    ),
  pdfInvalido: () =>
    new ErroFonte(
      'pdf_invalido',
      'Não foi lido: o PDF está corrompido ou incompleto.',
      'Abra o arquivo no computador para ver se ele abre. Se abrir, use "Imprimir › Salvar como PDF" para gerar uma cópia nova e envie de novo.',
    ),
  docxSenha: () =>
    new ErroFonte(
      'docx_senha',
      'Não foi lido: arquivo protegido por senha.',
      'Abra o arquivo no Word, remova a senha (Arquivo › Informações › Proteger documento) e envie de novo. Enquanto isso, o copiloto não usa esta fonte.',
    ),
  docAntigo: () =>
    new ErroFonte(
      'doc_antigo',
      'Não foi lido: é um arquivo do Word antigo (.doc).',
      'Abra no Word e use "Salvar como › Documento do Word (.docx)". Depois envie o arquivo novo.',
    ),
  docxInvalido: () =>
    new ErroFonte(
      'docx_invalido',
      'Não foi lido: o arquivo do Word está corrompido.',
      'Abra no Word e use "Salvar como › Documento do Word (.docx)" para gerar uma cópia nova. Depois envie de novo.',
    ),
  arquivoVazio: () =>
    new ErroFonte(
      'arquivo_vazio',
      'Não foi lido: o arquivo não tem texto.',
      'Confira se enviou o arquivo certo. Se o conteúdo for uma imagem ou digitalização, gere uma versão com texto e envie de novo.',
    ),
  arquivoGrande: () =>
    new ErroFonte(
      'arquivo_grande',
      `O arquivo passa de ${LIMITE_ARQUIVO_MB} MB.`,
      'Divida o documento em partes menores (por capítulo, por exemplo) ou reduza o tamanho das imagens e envie cada parte como uma fonte.',
    ),
  tipoNaoAceito: (ext: string) =>
    new ErroFonte(
      'tipo_nao_aceito',
      `Arquivos ${ext ? `.${ext} ` : ''}ainda não são aceitos.`,
      'Envie em PDF, DOCX, TXT ou MD. Planilhas e apresentações podem ser salvas como PDF.',
    ),
  arquivoSumiu: () =>
    new ErroFonte(
      'arquivo_sumiu',
      'O arquivo original não está guardado no copiloto.',
      'Envie o arquivo de novo para atualizar esta fonte.',
    ),
  transcricaoVazia: () =>
    new ErroFonte(
      'transcricao_vazia',
      'Não encontramos falas na transcrição.',
      'Envie o arquivo de legenda do vídeo (.vtt ou .srt) ou cole o texto da transcrição. Na maioria das plataformas, a legenda pode ser baixada nas opções do vídeo.',
    ),
  inesperado: () =>
    new ErroFonte(
      'inesperado',
      'Algo deu errado ao ler esta fonte.',
      'Tente sincronizar de novo. Se continuar, remova a fonte e adicione outra vez.',
    ),
};

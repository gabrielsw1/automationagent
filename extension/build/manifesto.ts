// manifest.json da extensão (Manifest V3). A versão vem do package.json.

export const TAMANHOS_ICONE = [16, 32, 48, 128] as const;

export function manifesto(versao: string) {
  const icones = Object.fromEntries(TAMANHOS_ICONE.map((t) => [String(t), `icones/${t}.png`]));
  const sites = ['http://*/*', 'https://*/*'];
  return {
    manifest_version: 3,
    name: 'Copiloto · Gravador de fluxos',
    short_name: 'Copiloto',
    version: versao,
    description: 'Grava uma tarefa feita na tela, em qualquer site, para o copiloto aprender a repetir.',
    // "world": "MAIN" nos content scripts.
    minimum_chrome_version: '111',
    icons: icones,
    action: { default_title: 'Copiloto: gravar fluxo', default_popup: 'popup.html', default_icon: icones },
    options_ui: { page: 'opcoes.html', open_in_tab: true },
    background: { service_worker: 'fundo.js' },
    permissions: ['storage', 'activeTab'],
    // O copiloto local já vem liberado; outros servidores são liberados nas opções.
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    optional_host_permissions: sites,
    content_scripts: [
      // Captura no mundo da página (como o widget). Parada até a gravação começar.
      { matches: sites, js: ['pagina.js'], run_at: 'document_start', world: 'MAIN' },
      // Marca a página, pega o token da URL, mostra a barra e fala com o fundo.
      { matches: sites, js: ['conteudo.js'], run_at: 'document_start' },
    ],
  };
}

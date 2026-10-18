// Logo depois de instalar (ou atualizar), o Chrome não põe os content scripts nas abas que já estavam
// abertas. Aqui eles entram nas abas que a extensão pode acessar (localhost, 127.0.0.1 e servidores
// liberados nas opções): a página "Instalar o gravador" do console percebe a extensão sem recarregar.
// As outras abas recebem a extensão na próxima vez que carregarem.
import { paginaGravavel } from '../comum/parametros.ts';

export async function injetarNasAbasAbertas(): Promise<number> {
  let abas: chrome.tabs.Tab[];
  try {
    abas = await chrome.tabs.query({});
  } catch {
    return 0;
  }
  let injetadas = 0;
  for (const aba of abas) {
    if (aba.id === undefined) continue;
    // Sem acesso à aba, o Chrome nem informa o endereço: a injeção abaixo também falharia.
    if (aba.url !== undefined && !paginaGravavel(aba.url)) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ['pagina.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ['conteudo.js'] });
      injetadas++;
    } catch {
      // Aba sem permissão (outro site) ou página do navegador: fica para o próximo carregamento.
    }
  }
  return injetadas;
}

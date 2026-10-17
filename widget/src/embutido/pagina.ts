// Contexto da página do sistema anfitrião: body[data-pagina] (ou o título) vira "Você está em …".
import type { PaginaContexto } from '@copiloto/shared';
import { urlSemToken } from '../gravador/captura.ts';

export function lerContextoPagina(): PaginaContexto {
  const pagina = document.body?.getAttribute('data-pagina')?.trim();
  const titulo = document.title?.trim() || undefined;
  return { secao: pagina || titulo, titulo, url: urlSemToken(location.href) };
}

/** Avisa quando a seção muda (sistemas de página única trocam o título ou o data-pagina sem recarregar). */
export function observarContextoPagina(aoMudar: (c: PaginaContexto) => void): () => void {
  let anterior = JSON.stringify(lerContextoPagina());
  const verificar = () => {
    const atual = lerContextoPagina();
    const s = JSON.stringify(atual);
    if (s !== anterior) {
      anterior = s;
      aoMudar(atual);
    }
  };
  const obs = new MutationObserver(verificar);
  if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['data-pagina'] });
  const head = document.head;
  if (head) obs.observe(head, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', verificar);
  window.addEventListener('hashchange', verificar);
  return () => {
    obs.disconnect();
    window.removeEventListener('popstate', verificar);
    window.removeEventListener('hashchange', verificar);
  };
}

/** Há um formulário visível na página (condição da sugestão proativa). */
export function paginaTemFormulario(): boolean {
  const campos = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
  return campos.length > 0;
}

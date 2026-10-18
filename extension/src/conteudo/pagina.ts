// Content script no mundo da página ("world": "MAIN"), carregado em toda página no início.
// Fica parado até o content script da extensão mandar "comecar". Aí usa a mesma Captura do widget:
// como roda no mundo da página, vê o history.pushState do site e os downloads disparados por script.
import { Captura } from '@copiloto/widget/gravador/captura.ts';
import { EVENTO_CAPTURA, EVENTO_COMANDO, EVENTO_SUBSTITUIR, ehDoCopiloto } from './ponte.ts';

let captura: Captura | null = null;

const aoComando = (e: Event) => {
  const comando = (e as CustomEvent<unknown>).detail;
  if (comando === 'comecar' && !captura) {
    captura = new Captura({
      ignorar: ehDoCopiloto,
      aoEvento: (evento) => document.dispatchEvent(new CustomEvent(EVENTO_CAPTURA, { detail: JSON.stringify(evento) })),
    });
    captura.iniciar();
  } else if (comando === 'parar' && captura) {
    captura.parar();
    captura = null;
  }
};

// Uma cópia anterior (antes de atualizar a extensão) sai de cena; esta assume.
document.dispatchEvent(new CustomEvent(EVENTO_SUBSTITUIR, { detail: 'pagina' }));
const aoSubstituir = (e: Event) => {
  if ((e as CustomEvent<unknown>).detail !== 'pagina') return;
  captura?.parar();
  captura = null;
  document.removeEventListener(EVENTO_COMANDO, aoComando);
  document.removeEventListener(EVENTO_SUBSTITUIR, aoSubstituir);
};
document.addEventListener(EVENTO_COMANDO, aoComando);
document.addEventListener(EVENTO_SUBSTITUIR, aoSubstituir);

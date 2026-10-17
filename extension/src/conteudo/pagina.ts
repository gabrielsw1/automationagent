// Content script no mundo da página ("world": "MAIN"), carregado em toda página no início.
// Fica parado até o content script da extensão mandar "comecar". Aí usa a mesma Captura do widget:
// como roda no mundo da página, vê o history.pushState do site e os downloads disparados por script.
import { Captura } from '@copiloto/widget/gravador/captura.ts';
import { EVENTO_CAPTURA, EVENTO_COMANDO, ehDoCopiloto } from './ponte.ts';

let captura: Captura | null = null;

document.addEventListener(EVENTO_COMANDO, (e) => {
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
});

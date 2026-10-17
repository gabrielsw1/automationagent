// Página do popup (popup.html). Com ?aba=<id>, mostra a aba indicada em vez da aba ativa.
import '@copiloto/shared/styles/tokens.css';
import '@copiloto/shared/styles/base.css';
import './paginas.css';
import { montarPopup } from './popup.ts';

const aba = new URLSearchParams(location.search).get('aba');
void montarPopup(document.getElementById('raiz')!, { abaId: aba && /^\d+$/.test(aba) ? Number(aba) : undefined });

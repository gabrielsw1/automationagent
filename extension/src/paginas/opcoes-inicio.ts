// Página de opções (opcoes.html).
import '@copiloto/shared/styles/tokens.css';
import '@copiloto/shared/styles/base.css';
import './paginas.css';
import { montarOpcoes } from './opcoes.ts';

void montarOpcoes(document.getElementById('raiz')!, location.search);

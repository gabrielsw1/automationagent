// Content script da extensão (mundo isolado), em toda página http(s), no início do carregamento.
import { iniciarConteudo } from './gravacao.ts';

void iniciarConteudo(chrome.runtime.getManifest().version);

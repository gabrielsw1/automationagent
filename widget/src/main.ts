// copiloto.js: script que o sistema anfitrião inclui em cada página.
//   <script src="{COPILOTO_URL}/copiloto.js" data-chave="pk_..." data-usuario="{id}"
//           data-assinatura="{hmac}" [data-servidor="https://..."] async></script>
// Monta o widget num Shadow DOM (o CSS da página não vaza para dentro nem para fora).
// Com ?copiloto_gravacao=<token> na URL (ou o token no sessionStorage), liga o gravador de fluxos no lugar do chat.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import tokensCss from '@copiloto/shared/styles/tokens.css?inline';
import baseCss from '@copiloto/shared/styles/base.css?inline';
import chatCss from './chat/chat.css?inline';
import embutidoCss from './embutido/embutido.css?inline';
import gravadorCss from './gravador/gravador.css?inline';
import { ClienteApi, ErroCliente } from './chat/api.ts';
import { WidgetEmbutido } from './embutido/WidgetEmbutido.tsx';
import { lerContextoPagina } from './embutido/pagina.ts';
import { detectarTokenGravacao, iniciarGravador } from './gravador/index.ts';

const FONTES =
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';

interface DadosScript {
  chave: string | null;
  usuario: string | null;
  assinatura: string | null;
  servidor: string;
}

declare global {
  interface Window {
    __copilotoCarregado?: boolean;
  }
}

function acharScript(): HTMLScriptElement | null {
  const atual = document.currentScript;
  if (atual instanceof HTMLScriptElement) return atual;
  // Fallback (ex.: script injetado por outro script): o último com data-chave ou que termina em copiloto.js.
  const lista = Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-chave], script[src*="copiloto.js"]'));
  return lista[lista.length - 1] ?? null;
}

function lerDados(script: HTMLScriptElement | null): DadosScript {
  const ds = script?.dataset ?? {};
  let servidor = ds.servidor?.trim() ?? '';
  if (!servidor && script?.src) {
    try {
      servidor = new URL(script.src, location.href).origin;
    } catch {
      servidor = '';
    }
  }
  return {
    chave: ds.chave?.trim() || null,
    usuario: ds.usuario?.trim() || null,
    assinatura: ds.assinatura?.trim() || null,
    servidor: servidor || location.origin,
  };
}

function carregarFontes(): void {
  if (document.querySelector('link[data-copiloto-fontes]')) return;
  const head = document.head ?? document.documentElement;
  for (const origem of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = origem;
    if (origem.includes('gstatic')) pre.crossOrigin = 'anonymous';
    head.appendChild(pre);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONTES;
  link.setAttribute('data-copiloto-fontes', '');
  head.appendChild(link);
}

function criarHospedeiro(estilos: string[]): { hospedeiro: HTMLElement; raiz: ShadowRoot; conteiner: HTMLDivElement } {
  const hospedeiro = document.createElement('copiloto-widget');
  hospedeiro.setAttribute('data-copiloto', '');
  const raiz = hospedeiro.attachShadow({ mode: 'open' });
  const estilo = document.createElement('style');
  estilo.textContent = estilos.join('\n');
  raiz.appendChild(estilo);
  const conteiner = document.createElement('div');
  raiz.appendChild(conteiner);
  document.body.appendChild(hospedeiro);
  return { hospedeiro, raiz, conteiner };
}

function explicarFalha(e: unknown, dados: DadosScript): string {
  const prefixo = 'Copiloto: o botão do copiloto não vai aparecer nesta página.';
  if (e instanceof ErroCliente) {
    switch (e.codigo) {
      case 'assinatura_invalida':
        return `${prefixo} A assinatura do usuário "${dados.usuario}" não confere. O data-assinatura deve ser o HMAC-SHA256 do ID do usuário com o segredo do widget, calculado no servidor do seu sistema.`;
      case 'dominio_nao_liberado':
        return `${prefixo} O domínio ${location.host} não está liberado para a chave ${dados.chave}. Libere-o no console, em Canais e widget.`;
      case 'usuario_nao_encontrado':
        return `${prefixo} O usuário "${dados.usuario}" (data-usuario) não existe no sistema conectado ao copiloto.`;
      case 'chave_invalida':
        return `${prefixo} A chave pública "${dados.chave}" (data-chave) não foi reconhecida. Copie o trecho de instalação de novo no console.`;
      default:
        if (e.rede)
          return `${prefixo} Não consegui falar com o servidor do copiloto em ${dados.servidor}. Confira se ele está no ar e se este domínio está liberado.`;
        return `${prefixo} O servidor respondeu ${e.status}: ${e.message}${e.ref ? ` (código ${e.ref})` : ''}`;
    }
  }
  return `${prefixo} ${e instanceof Error ? e.message : String(e)}`;
}

function corPadrao(hospedeiro: HTMLElement): string | undefined {
  try {
    return getComputedStyle(hospedeiro).getPropertyValue('--brand-600').trim() || undefined;
  } catch {
    return undefined;
  }
}

async function iniciar(script: HTMLScriptElement | null): Promise<void> {
  const dados = lerDados(script);

  const tokenGravacao = detectarTokenGravacao();
  if (tokenGravacao) {
    carregarFontes();
    const { hospedeiro, raiz } = criarHospedeiro([tokensCss, baseCss, gravadorCss]);
    iniciarGravador({ servidor: dados.servidor, token: tokenGravacao, raiz, hospedeiro });
    return;
  }

  if (!dados.chave || !dados.usuario) {
    console.warn(
      'Copiloto: o botão do copiloto não vai aparecer. Faltam data-chave e/ou data-usuario no <script> do copiloto.js. ' +
        'Copie o trecho de instalação no console (Canais e widget) e passe o ID do usuário logado.',
    );
    return;
  }

  let inicio;
  try {
    inicio = await ClienteApi.iniciar(dados.servidor, {
      chave: dados.chave,
      usuario: dados.usuario,
      assinatura: dados.assinatura ?? undefined,
      pagina: lerContextoPagina(),
    });
  } catch (e) {
    console.warn(explicarFalha(e, dados));
    return;
  }

  carregarFontes();
  const { hospedeiro, conteiner } = criarHospedeiro([tokensCss, baseCss, chatCss, embutidoCss]);
  const api = new ClienteApi(dados.servidor, inicio.token);
  createRoot(conteiner).render(createElement(WidgetEmbutido, { inicio, api, corPadrao: corPadrao(hospedeiro) }));
}

function comecar(): void {
  if (window.__copilotoCarregado) return;
  window.__copilotoCarregado = true;
  // document.currentScript só existe durante a execução síncrona do script.
  const script = acharScript();
  const rodar = () =>
    iniciar(script).catch((e) => console.warn('Copiloto: não consegui iniciar o widget.', e));
  if (document.body) void rodar();
  else document.addEventListener('DOMContentLoaded', () => void rodar(), { once: true });
}

comecar();

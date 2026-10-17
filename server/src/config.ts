// Configuração lida das variáveis de ambiente. Todos os valores têm padrão para rodar local.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_SERVIDOR = path.resolve(aqui, '..');
export const RAIZ_REPO = path.resolve(RAIZ_SERVIDOR, '..');

function env(nome: string, padrao: string): string {
  const v = process.env[nome];
  return v === undefined || v === '' ? padrao : v;
}

function numeroEnv(nome: string, padrao: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && process.env[nome] !== '' && process.env[nome] !== undefined ? v : padrao;
}

export interface Config {
  porta: number;
  host: string;
  /** URL pública do servidor (serve o copiloto.js e a API do widget). */
  urlPublica: string;
  /** URL do console (em dev, o Vite). Usada em links de convite. */
  urlConsole: string;
  dirDados: string;
  /** Usa o modelo simulado: sem ANTHROPIC_API_KEY ou com COPILOTO_LLM=simulado. */
  llmSimulado: boolean;
  modeloPrincipal: string;
  modeloRapido: string;
  esforco: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Reais por dólar, para mostrar custos em R$. */
  cotacaoDolar: number;
  /** Custo estimado de um minuto de navegador na nuvem, em R$. */
  custoNavegadorMinuto: number;
  adaptador: string;
  sistema: {
    nome: string;
    urlBase: string;
    urlApi: string;
    chaveServico: string;
  };
  /** Segredo usado para assinar o ID do usuário no snippet do widget (HMAC). */
  segredoWidget: string;
  /** Segredo das sessões do console e dos tokens do widget. */
  segredoSessao: string;
  /** Exige a assinatura do usuário no snippet do widget. */
  exigirAssinatura: boolean;
  /** Mostra o navegador do Playwright (só para depurar fluxos). */
  navegadorVisivel: boolean;
  /** Caminho de um Chromium já instalado (opcional). */
  chromiumPath: string | undefined;
}

export function lerConfig(): Config {
  const porta = numeroEnv('PORT', 3000);
  const urlSistema = env('SISTEMA_URL', 'http://localhost:4000');
  const chave = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  return {
    porta,
    host: env('HOST', '0.0.0.0'),
    urlPublica: env('PUBLIC_URL', `http://localhost:${porta}`),
    urlConsole: env('CONSOLE_URL', 'http://localhost:5173'),
    dirDados: path.resolve(RAIZ_REPO, env('DATA_DIR', 'data')),
    llmSimulado: env('COPILOTO_LLM', chave ? 'claude' : 'simulado') === 'simulado',
    modeloPrincipal: env('COPILOTO_MODELO', 'claude-opus-5-5'),
    modeloRapido: env('COPILOTO_MODELO_RAPIDO', 'claude-haiku-5-5'),
    esforco: env('COPILOTO_ESFORCO', 'medium') as Config['esforco'],
    cotacaoDolar: numeroEnv('COTACAO_DOLAR', 5.4),
    custoNavegadorMinuto: numeroEnv('CUSTO_NAVEGADOR_MINUTO', 0.6),
    adaptador: env('ADAPTADOR', 'exemplo'),
    sistema: {
      nome: env('SISTEMA_NOME', 'Horizonte'),
      urlBase: urlSistema,
      urlApi: env('SISTEMA_API_URL', urlSistema),
      chaveServico: env('SISTEMA_CHAVE_SERVICO', 'chave-servico-local'),
    },
    segredoWidget: env('WIDGET_SEGREDO', 'segredo-widget-local'),
    segredoSessao: env('SESSAO_SEGREDO', 'segredo-sessao-local-troque-em-producao'),
    exigirAssinatura: env('WIDGET_EXIGIR_ASSINATURA', '1') !== '0',
    navegadorVisivel: env('NAVEGADOR_VISIVEL', '0') === '1',
    chromiumPath: process.env.CHROMIUM_PATH || undefined,
  };
}

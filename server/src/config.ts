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
  /** Usa o modelo simulado (respostas por regras): só com COPILOTO_LLM=simulado, para testes. */
  llmSimulado: boolean;
  /** Há ANTHROPIC_API_KEY. Sem ela (e sem o modo simulado), o assistente avisa que não está ligado. */
  temChaveClaude: boolean;
  modeloPrincipal: string;
  modeloRapido: string;
  esforco: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Reais por dólar, para mostrar custos em R$. */
  cotacaoDolar: number;
  /** Custo estimado de um minuto de navegador na nuvem, em R$. */
  custoNavegadorMinuto: number;
  /** Adaptador do conector `api` (a demonstração usa o do Horizonte). Empresas novas usam `tela`. */
  adaptador: string;
  /** Sistema da empresa. No servidor, vale para a demonstração; cada empresa tem o seu (plataforma). */
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
  /** Cifra os segredos das empresas no banco (COPILOTO_CHAVE_MESTRA; sem ela, deriva do SESSAO_SEGREDO). */
  chaveMestra: string;
  /** Qualquer pessoa pode criar a conta de uma empresa nova pela tela de entrada (COPILOTO_CADASTRO=fechado desliga). */
  cadastroAberto: boolean;
  /** E-mails de quem vê o painel da plataforma com todas as empresas (COPILOTO_ADMINS, separados por vírgula). */
  adminsPlataforma: string[];
  /** Provedor de e-mail (SMTP_URL, ex.: smtps://usuario:senha@smtp.provedor.com:465). Sem ele, os e-mails ficam em DATA_DIR/caixa-de-saida. */
  smtpUrl: string;
  /** Remetente dos e-mails (EMAIL_REMETENTE). */
  emailRemetente: string;
  /** Recebe os pedidos de contato do site (EMAIL_VENDAS). Sem ele, os pedidos ficam só no banco da plataforma. */
  emailVendas: string;
  /** Pasta com os textos jurídicos aprovados (TEXTOS_LEGAIS_DIR). Sem ela, o site mostra as minutas de docs/legal. */
  textosLegaisDir: string | null;
  /** Cobrança pelo Asaas. Sem ASAAS_API_KEY, a cobrança é manual: a equipe Starta envia por e-mail e marca as faturas como pagas. */
  asaas: ConfigAsaas;
  /** Exige a assinatura do usuário no snippet do widget. */
  exigirAssinatura: boolean;
  /** Mostra o navegador do Playwright (só para depurar fluxos). */
  navegadorVisivel: boolean;
  /** Caminho de um Chromium já instalado (opcional). */
  chromiumPath: string | undefined;
  /**
   * Extensão do navegador (gravador de fluxos): endereços nas lojas, depois de publicada
   * (EXTENSAO_URL_CHROME e EXTENSAO_URL_EDGE). Vazios, a página "Instalar o gravador" explica como
   * instalar pelo pacote (EXTENSAO_AJUDA_URL, padrão: a seção do README).
   */
  extensao: { urlChrome: string; urlEdge: string; ajudaInstalar: string };
}

export const AJUDA_INSTALAR_EXTENSAO = 'https://github.com/gabrielsw1/automationagent#instalar-pelo-pacote-sem-a-loja';

export interface ConfigAsaas {
  /** ASAAS_API_KEY ($aact_prod_... ou $aact_hmlg_...). Vazio: cobrança manual. */
  chave: string;
  /** ASAAS_AMBIENTE: sandbox (padrão) ou producao. */
  ambiente: 'sandbox' | 'producao';
  /** ASAAS_WEBHOOK_TOKEN: o Asaas manda no cabeçalho asaas-access-token de cada aviso de pagamento. */
  tokenWebhook: string;
  /**
   * Nota fiscal de serviço pelo Asaas a cada fatura paga (ASAAS_NOTA_FISCAL=1, com os dados fiscais e a
   * prefeitura já configurados na conta do Asaas). null: desligada.
   */
  notaFiscal: null | {
    /** ASAAS_NF_SERVICO_ID (id do serviço municipal no Asaas) ou ASAAS_NF_SERVICO_CODIGO (código da prefeitura). */
    servicoId: string;
    servicoCodigo: string;
    /** ASAAS_NF_SERVICO_NOME: descrição do serviço municipal. */
    servicoNome: string;
    /** ASAAS_NF_IMPOSTOS, ex.: "iss=2,pis=0.65,cofins=3,reterIss=0" (percentuais; o que faltar é zero). */
    impostos: { retainIss: boolean; iss: number; pis: number; cofins: number; csll: number; inss: number; ir: number };
  };
}

/** "iss=2,pis=0.65,reterIss=1" → impostos da nota fiscal (percentuais; o que faltar é zero). */
export function lerImpostos(texto: string): NonNullable<ConfigAsaas['notaFiscal']>['impostos'] {
  const v: Record<string, number> = {};
  for (const par of texto.split(/[,;]/)) {
    const [k, n] = par.split('=').map((s) => s.trim());
    const num = Number(n?.replace(',', '.'));
    if (k && Number.isFinite(num)) v[k.toLowerCase()] = num;
  }
  return { retainIss: (v.reteriss ?? v.retainiss ?? 0) > 0, iss: v.iss ?? 0, pis: v.pis ?? 0, cofins: v.cofins ?? 0, csll: v.csll ?? 0, inss: v.inss ?? 0, ir: v.ir ?? 0 };
}

function lerAsaas(): ConfigAsaas {
  const chave = env('ASAAS_API_KEY', '').trim();
  const servicoId = env('ASAAS_NF_SERVICO_ID', '').trim();
  const servicoCodigo = env('ASAAS_NF_SERVICO_CODIGO', '').trim();
  const servicoNome = env('ASAAS_NF_SERVICO_NOME', '').trim();
  const nf = env('ASAAS_NOTA_FISCAL', '0') === '1' && chave !== '' && (servicoId !== '' || servicoCodigo !== '') && servicoNome !== '';
  return {
    chave,
    ambiente: env('ASAAS_AMBIENTE', 'sandbox').trim().toLowerCase() === 'producao' ? 'producao' : 'sandbox',
    tokenWebhook: env('ASAAS_WEBHOOK_TOKEN', '').trim(),
    notaFiscal: nf ? { servicoId, servicoCodigo, servicoNome, impostos: lerImpostos(env('ASAAS_NF_IMPOSTOS', '')) } : null,
  };
}

export function lerConfig(): Config {
  const porta = numeroEnv('PORT', 3000);
  const urlSistema = env('SISTEMA_URL', 'http://localhost:4000');
  const chave = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  const segredoSessao = env('SESSAO_SEGREDO', 'segredo-sessao-local-troque-em-producao');
  return {
    porta,
    host: env('HOST', '0.0.0.0'),
    urlPublica: env('PUBLIC_URL', `http://localhost:${porta}`),
    urlConsole: env('CONSOLE_URL', 'http://localhost:5173'),
    dirDados: path.resolve(RAIZ_REPO, env('DATA_DIR', 'data')),
    llmSimulado: env('COPILOTO_LLM', 'claude') === 'simulado',
    temChaveClaude: chave !== '',
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
    segredoSessao,
    chaveMestra: env('COPILOTO_CHAVE_MESTRA', segredoSessao),
    cadastroAberto: env('COPILOTO_CADASTRO', 'aberto') !== 'fechado',
    adminsPlataforma: env('COPILOTO_ADMINS', '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    smtpUrl: env('SMTP_URL', ''),
    emailRemetente: env('EMAIL_REMETENTE', 'Copiloto Starta <nao-responda@starta.site>'),
    emailVendas: env('EMAIL_VENDAS', '').trim(),
    textosLegaisDir: process.env.TEXTOS_LEGAIS_DIR ? path.resolve(RAIZ_REPO, process.env.TEXTOS_LEGAIS_DIR) : null,
    asaas: lerAsaas(),
    exigirAssinatura: env('WIDGET_EXIGIR_ASSINATURA', '1') !== '0',
    navegadorVisivel: env('NAVEGADOR_VISIVEL', '0') === '1',
    chromiumPath: process.env.CHROMIUM_PATH || undefined,
    extensao: {
      urlChrome: env('EXTENSAO_URL_CHROME', '').trim(),
      urlEdge: env('EXTENSAO_URL_EDGE', '').trim(),
      ajudaInstalar: env('EXTENSAO_AJUDA_URL', AJUDA_INSTALAR_EXTENSAO).trim(),
    },
  };
}

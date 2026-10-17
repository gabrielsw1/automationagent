// Camada de adaptadores: o único ponto do copiloto que conhece o sistema da empresa.
// Empresas novas usam o conector só pela tela (adaptadores/tela.ts), que não precisa de API.
// Para um sistema com API, implemente esta interface numa pasta nova (ex.: adaptadores/meu-sistema),
// aponte ADAPTADOR=meu-sistema e use o conector `api` na empresa. Nada mais muda.
import type { MetodoHttp, UsuarioSistema } from '@copiloto/shared';

export interface ChamadaApi {
  metodo: MetodoHttp;
  /** Caminho relativo à API do sistema. Ex.: "/v1/clientes?documento=123". */
  caminho: string;
  corpo?: unknown;
  /** O copiloto sempre age em nome de quem pediu: o sistema aplica as permissões dessa pessoa. */
  usuarioId: string;
  /** Chave de idempotência: a mesma execução nunca grava duas vezes. */
  idempotencia?: string;
  /** Tempo máximo em ms (padrão 15 s). */
  tempoLimiteMs?: number;
  /**
   * Modo de teste: o sistema valida tudo como se fosse gravar, mas não grava nada
   * (no Horizonte, cabeçalho x-simulacao: 1). Usado no "Testar copiloto" e no teste da chamada.
   */
  simulacao?: boolean;
}

export interface RespostaApi {
  status: number;
  /** Corpo já decodificado (JSON) ou texto. */
  corpo: unknown;
  duracaoMs: number;
  /** Cabeçalhos úteis (ex.: content-type, location). */
  cabecalhos?: Record<string, string>;
}

export interface CookieNavegador {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface SessaoNavegador {
  /** Cookies que deixam o navegador logado como a pessoa (o navegador nunca usa a senha dela). */
  cookies: CookieNavegador[];
  /** Cabeçalhos extras, se o sistema autentica por cabeçalho. */
  cabecalhos?: Record<string, string>;
  /**
   * Conta de serviço da empresa (conector só pela tela): o navegador abre a página de login e
   * entra com ela antes do fluxo. A senha vem do cofre e só é digitada no campo de senha.
   */
  login?: { url: string; usuario: string; senha: string };
}

/** Rota da API do sistema, para o console sugerir chamadas ao criar uma tarefa. */
export interface RotaApi {
  metodo: MetodoHttp;
  caminho: string;
  descricao: string;
  /** Campos do corpo (para POST/PUT/PATCH), com tipo simples e descrição. */
  campos?: { nome: string; tipo: string; obrigatorio: boolean; descricao?: string }[];
  /** Campo do retorno com o identificador criado. */
  idRetorno?: string;
}

export interface AdaptadorSistema {
  /** Nome que aparece para as pessoas. Ex.: "Horizonte". */
  readonly nome: string;
  /** Endereço das telas do sistema (links nos recibos e caminho navegador). */
  readonly urlBase: string;

  /** Confere se o copiloto consegue falar com o sistema (guia de início e painel). */
  verificarConexao(): Promise<{ ok: boolean; detalhe: string }>;

  /** Usuário do sistema pelo ID que o snippet do widget envia. null se não existir. */
  buscarUsuario(id: string): Promise<UsuarioSistema | null>;
  listarUsuarios(): Promise<UsuarioSistema[]>;
  /** Perfis de acesso do sistema, para "Quem pode executar". */
  listarPerfis(): Promise<string[]>;

  /** Chamada à API do sistema em nome de um usuário. Não lança erro para status HTTP; só para falha de rede. */
  chamar(chamada: ChamadaApi): Promise<RespostaApi>;

  /** Rotas da API conhecidas (pode ser vazio). */
  descreverApi(): Promise<RotaApi[]>;

  /** Sessão autenticada como o usuário, para o caminho navegador (Playwright). */
  sessaoNavegador(usuarioId: string): Promise<SessaoNavegador>;

  /**
   * Opcional (conector só pela tela): guarda quem chegou pelo snippet assinado, com nome, e-mail
   * e perfis, para `buscarUsuario` e `listarUsuarios` acharem essa pessoa depois.
   */
  aprenderUsuario?(usuario: UsuarioSistema): Promise<void>;

  /**
   * Opcional: baixa um arquivo que a API devolveu como link (ex.: arquivo_url de um relatório),
   * para o copiloto entregar à pessoa por um link próprio. null se não for do sistema ou não existir.
   */
  baixarArquivo?(url: string, usuarioId: string): Promise<ArquivoBaixado | null>;
}

export interface ArquivoBaixado {
  nome: string;
  tipo: string;
  conteudo: Buffer;
}

/** Falha de rede ou tempo esgotado ao falar com o sistema. */
export class ErroConexaoSistema extends Error {
  constructor(
    mensagem: string,
    readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = 'ErroConexaoSistema';
  }
}

// Camada de adaptadores: o único ponto do copiloto que conhece o sistema da empresa.
// Para ligar o copiloto ao sistema real, implemente esta interface numa pasta nova
// (ex.: adaptadores/meu-sistema) e aponte ADAPTADOR=meu-sistema. Nada mais muda.
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
  /** Cookies que deixam o navegador logado como a pessoa (o navegador nunca usa senha). */
  cookies: CookieNavegador[];
  /** Cabeçalhos extras, se o sistema autentica por cabeçalho. */
  cabecalhos?: Record<string, string>;
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

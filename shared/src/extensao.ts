// Contrato da extensão do navegador (gravador de fluxos) com o servidor e com o console.
//
// Entrada da extensão (E3), sem senha na extensão:
// 1. O popup gera `estado` e um `verificador` secreto e abre /extensao/conectar no console com
//    `estado` e o `desafio` (SHA-256 do verificador, em base64url).
// 2. Na página do console (com a sessão de sempre), a pessoa escolhe a empresa. O console pede ao
//    servidor um código de uso único, curto, preso à conta, à empresa e ao desafio.
// 3. A página passa `estado` e `código` à extensão por window.postMessage. A extensão só aceita
//    mensagens da aba do console configurado e com o `estado` que ela mesma criou.
// 4. A extensão troca código + verificador pelo token dela (só o hash fica no servidor). O token
//    vale só nas rotas da extensão (/api/extensao), para uma conta numa empresa, e sai em "Sair".
import type { PerfilEquipe } from './console.ts';

/** Empresa em que a pessoa pode gravar (perfil Admin ou Editor de tarefas). */
export interface EmpresaDaExtensao {
  id: string;
  nome: string;
  demo: boolean;
  iniciais: string;
  perfil: PerfilEquipe;
}

/** Sessão da extensão (GET /api/extensao/sessao). */
export interface SessaoExtensao {
  pessoa: { nome: string; email: string; iniciais: string };
  empresa: { id: string; nome: string; demo: boolean; iniciais: string };
  perfil: PerfilEquipe;
  /** Admin e Editor de tarefas gravam; os outros perfis veem o aviso de permissão. */
  podeGravar: boolean;
  /** Empresas da conta em que ela pode gravar (para "Trocar"), incluindo a atual quando pode. */
  empresas: EmpresaDaExtensao[];
  /** Endereço do console (para "Gravar esta aba" e "Abrir no console"). */
  urlConsole: string;
}

/** gravando: ainda na aba; enviada: espera a revisão; em_revisao: alguém já mexeu; publicada: virou tarefa. */
export type SituacaoGravacaoRecente = 'gravando' | 'enviada' | 'em_revisao' | 'publicada';

export interface GravacaoRecente {
  fluxoId: string;
  nome: string;
  situacao: SituacaoGravacaoRecente;
  passos: number;
  /** Quando foi enviada (ISO), ou quando começou, se ainda está gravando. */
  em: string;
  /** Endereço do fluxo no console. */
  url: string;
}

/** Gravações recentes da pessoa na empresa da sessão (GET /api/extensao/gravacoes). */
export interface GravacoesRecentes {
  gravacoes: GravacaoRecente[];
}

/** POST /api/extensao/trocar: código de uso único + verificador → token da extensão. */
export interface PedidoTrocaExtensao {
  codigo: string;
  verificador: string;
  /** "Chrome" ou "Edge", para a lista de aparelhos conectados. */
  navegador?: string;
}

export interface TokenExtensao {
  token: string;
  sessao: SessaoExtensao;
}

/** POST /api/console/extensao/codigo: o console pede o código para entregar à extensão. */
export interface PedidoCodigoExtensao {
  empresaId: string;
  /** SHA-256 do verificador da extensão, em base64url (43 caracteres). */
  desafio: string;
}

export interface CodigoExtensao {
  codigo: string;
  expiraEm: string;
}

/** Página "Instalar o gravador" (GET /api/console/extensao). */
export interface InfoExtensao {
  /** Endereços nas lojas (EXTENSAO_URL_CHROME e EXTENSAO_URL_EDGE). null: ainda não publicada. */
  lojas: { chrome: string | null; edge: string | null };
  /** Como instalar pelo pacote (enquanto não está nas lojas). */
  ajudaInstalar: string;
  /** Pessoas da empresa que podem gravar (Admin e Editor de tarefas, ativas). */
  quemPodeGravar: { id: string; nome: string; email: string; iniciais: string; perfil: PerfilEquipe; voce: boolean }[];
}

// ---------- Conversa entre a página do console e a extensão (window.postMessage) ----------

export const FONTE_CONSOLE = 'copiloto-console';
export const FONTE_EXTENSAO = 'copiloto-extensao';

/** Console → extensão. `id` liga a resposta ao pedido. */
export type MensagemDoConsole =
  | { fonte: typeof FONTE_CONSOLE; tipo: 'extensao:estado'; id: string }
  | { fonte: typeof FONTE_CONSOLE; tipo: 'extensao:conectar'; id: string; estado: string; codigo: string };

/** A extensão conectada, como o console vê (só na aba do console configurado). */
export interface ConexaoExtensao {
  empresa: { id: string; nome: string };
  pessoa: { nome: string; email: string };
}

/** Extensão → console. */
export type MensagemDaExtensao =
  | {
      fonte: typeof FONTE_EXTENSAO;
      tipo: 'extensao:estado';
      id: string;
      versao: string;
      /** null: instalada, sem entrar (ou este console não é o configurado na extensão). */
      conexao: ConexaoExtensao | null;
      /** Esta aba é do console configurado na extensão. */
      consoleConfigurado: boolean;
    }
  | { fonte: typeof FONTE_EXTENSAO; tipo: 'extensao:conectada'; id: string; ok: true; conexao: ConexaoExtensao }
  | { fonte: typeof FONTE_EXTENSAO; tipo: 'extensao:conectada'; id: string; ok: false; mensagem: string };

export function ehMensagemDoConsole(m: unknown): m is MensagemDoConsole {
  if (!m || typeof m !== 'object') return false;
  const x = m as Partial<Record<string, unknown>>;
  if (x.fonte !== FONTE_CONSOLE || typeof x.id !== 'string' || x.id.length > 100) return false;
  if (x.tipo === 'extensao:estado') return true;
  return (
    x.tipo === 'extensao:conectar' &&
    typeof x.estado === 'string' &&
    x.estado.length <= 200 &&
    typeof x.codigo === 'string' &&
    x.codigo.length <= 200
  );
}

export function ehMensagemDaExtensao(m: unknown): m is MensagemDaExtensao {
  if (!m || typeof m !== 'object') return false;
  const x = m as Partial<Record<string, unknown>>;
  return x.fonte === FONTE_EXTENSAO && typeof x.id === 'string' && (x.tipo === 'extensao:estado' || x.tipo === 'extensao:conectada');
}

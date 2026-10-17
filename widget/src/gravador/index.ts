// Modo gravação: ativado por ?copiloto_gravacao=<token> (o console abre a tela do sistema assim).
// O token fica no sessionStorage e vale entre páginas da mesma aba. Nesse modo o chat não aparece.
import type { EventoGravado } from '@copiloto/shared';
import { armazenamento, mensagemDeErro } from '../chat/util.ts';
import { BarraGravacao } from './barra.ts';
import { Captura } from './captura.ts';
import { ApiGravacao, EnvioLotes } from './envio.ts';

export const CHAVE_TOKEN = 'copiloto_gravacao';
const CHAVE_PENDENTES = 'copiloto_gravacao_pendentes';
const CHAVE_ULTIMA_URL = 'copiloto_gravacao_ultima_url';
const CHAVE_PASSOS = 'copiloto_gravacao_passos';

/** Token da gravação (da URL ou do sessionStorage). Tira o parâmetro da barra de endereço. */
export function detectarTokenGravacao(): string | null {
  const guarda = armazenamento('sessao');
  let token: string | null = null;
  try {
    const url = new URL(location.href);
    token = url.searchParams.get(CHAVE_TOKEN);
    if (token) {
      guarda.gravar(CHAVE_TOKEN, token);
      url.searchParams.delete(CHAVE_TOKEN);
      history.replaceState(history.state, '', url.toString());
    }
  } catch {
    /* URL estranha: segue com o que estiver guardado */
  }
  return token || guarda.ler(CHAVE_TOKEN);
}

export function limparGravacao(): void {
  const guarda = armazenamento('sessao');
  for (const k of [CHAVE_TOKEN, CHAVE_PENDENTES, CHAVE_ULTIMA_URL, CHAVE_PASSOS]) guarda.remover(k);
}

export interface OpcoesGravador {
  servidor: string;
  token: string;
  /** Onde desenhar a barra (o Shadow DOM do widget). */
  raiz: ShadowRoot | HTMLElement;
  /** Elemento hospedeiro do widget: cliques nele não entram na gravação. */
  hospedeiro?: Element;
}

export interface Gravador {
  captura: Captura;
  envio: EnvioLotes;
  barra: BarraGravacao;
  parar(): void;
}

export function iniciarGravador({ servidor, token, raiz, hospedeiro }: OpcoesGravador): Gravador {
  const guarda = armazenamento('sessao');
  const api = new ApiGravacao(servidor, token);
  let passosServidor = Number(guarda.ler(CHAVE_PASSOS) ?? '0') || 0;

  const atualizarContagem = () => barra.definirPassos(passosServidor + envio.quantidadePendente);

  const envio = new EnvioLotes({
    api,
    chavePendentes: CHAVE_PENDENTES,
    aoPassos: (n) => {
      passosServidor = n;
      guarda.gravar(CHAVE_PASSOS, String(n));
      atualizarContagem();
    },
  });

  const captura = new Captura({
    chaveUltimaUrl: CHAVE_ULTIMA_URL,
    ignorar: (alvo) => Boolean(hospedeiro && alvo instanceof Node && (alvo === hospedeiro || hospedeiro.contains(alvo))),
    aoEvento: (e: EventoGravado) => {
      envio.adicionar(e);
      atualizarContagem();
    },
  });

  const aoSair = () => envio.salvar();

  const parar = () => {
    captura.parar();
    window.removeEventListener('pagehide', aoSair);
  };

  const barra = new BarraGravacao(raiz, {
    concluir: async () => {
      await envio.descarregar();
      await api.concluir();
      parar();
      envio.limpar();
      limparGravacao();
      barra.mostrarFinal('Gravação enviada. Volte ao console para revisar.');
    },
    cancelar: async () => {
      parar();
      envio.limpar();
      try {
        await api.cancelar();
      } finally {
        limparGravacao();
      }
      barra.mostrarFinal('Gravação descartada. Nada foi salvo.', false);
    },
    fechar: () => barra.remover(),
  });

  window.addEventListener('pagehide', aoSair);
  captura.iniciar();
  atualizarContagem();
  // Envia o que ficou da página anterior.
  if (envio.quantidadePendente) envio.descarregar().catch(() => {});

  api
    .estado()
    .then((estado) => {
      if (!estado.ativa) {
        parar();
        envio.limpar();
        limparGravacao();
        barra.mostrarFinal('Esta gravação já foi encerrada. Volte ao console para continuar.', false);
        return;
      }
      if (estado.nome) barra.definirNome(estado.nome);
      if (typeof estado.passos === 'number' && estado.passos > passosServidor) {
        passosServidor = estado.passos;
        atualizarContagem();
      }
    })
    .catch((e) => {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 410) {
        parar();
        envio.limpar();
        limparGravacao();
        barra.mostrarFinal('Não encontrei esta gravação. Comece de novo pelo console.', false);
      } else {
        barra.mostrarErro(mensagemDeErro(e, 'Não consegui falar com o copiloto. Os passos ficam guardados e saem quando a conexão voltar.'));
      }
    });

  return { captura, envio, barra, parar };
}

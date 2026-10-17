// Popup do ícone da extensão: estado da gravação na aba atual (Gravando, N passos, Concluir, Cancelar)
// ou, sem gravação, "Gravar esta aba", que abre o Aprender fluxo do console com o endereço preenchido.
import { ehAvisoEstado, enviar, type EstadoAba, type Resultado } from '../comum/mensagens.ts';
import { paginaGravavel } from '../comum/parametros.ts';
import { servidorConfigurado } from '../comum/servidor.ts';
import { ICONES, botao, el, icone, trocar } from './dom.ts';

type Tela =
  | { tipo: 'carregando' }
  | { tipo: 'livre'; erro: string | null; enviando: boolean; semPermissao: boolean }
  | { tipo: 'gravando'; estado: EstadoAba; confirmarCancelar: boolean; ocupado: string | null; erro: string | null }
  | { tipo: 'final'; texto: string; sucesso: boolean };

export interface OpcoesPopup {
  /** Aba alvo (o padrão é a aba ativa). Serve para abrir o popup numa aba, nos testes e nos prints. */
  abaId?: number;
  fechar?: () => void;
}

function textoPassos(n: number): string {
  if (n === 0) return 'Nenhum passo ainda';
  return `${n} ${n === 1 ? 'passo' : 'passos'} até agora`;
}

export async function montarPopup(raiz: HTMLElement, opcoes: OpcoesPopup = {}) {
  const fechar = opcoes.fechar ?? (() => window.close());
  let aba: chrome.tabs.Tab | undefined;
  try {
    aba = opcoes.abaId !== undefined ? await chrome.tabs.get(opcoes.abaId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  } catch {
    aba = undefined;
  }
  const abaId = opcoes.abaId ?? aba?.id;
  const servidor = await servidorConfigurado();
  let tela: Tela = { tipo: 'carregando' };

  const corpo = el('section', { class: 'pp-corpo', 'aria-live': 'polite' });
  const linkOpcoes = el('a', { href: '#', class: 'pp-link' }, 'Opções');
  linkOpcoes.addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
  raiz.replaceChildren(
    el(
      'div',
      { class: 'pp' },
      el(
        'header',
        { class: 'pp-topo' },
        el('span', { class: 'pp-marca', 'aria-hidden': 'true' }, el('span', { class: 'pp-marca-ponto' })),
        el('div', { class: 'pp-titulo' }, el('p', { class: 'strong' }, 'Copiloto'), el('p', { class: 'tiny muted' }, 'Gravador de fluxos')),
      ),
      corpo,
      el('footer', { class: 'pp-rodape tiny muted' }, el('span', { class: 'pp-servidor', title: servidor }, `Servidor: ${servidor}`), linkOpcoes),
    ),
  );

  const definir = (t: Tela) => {
    tela = t;
    desenhar();
  };

  const executar = async (rotulo: string, pedido: 'concluir' | 'cancelar') => {
    if (tela.tipo !== 'gravando' || abaId === undefined) return;
    definir({ ...tela, ocupado: rotulo, erro: null, confirmarCancelar: false });
    const r = await enviar<Resultado>({ tipo: pedido, abaId }).catch(
      (): Resultado => ({ ok: false, mensagem: 'Não consegui falar com a extensão. Feche e abra o popup de novo.' }),
    );
    if (r.ok) {
      definir(
        pedido === 'concluir'
          ? { tipo: 'final', sucesso: true, texto: 'Gravação enviada. Volte ao console para revisar.' }
          : { tipo: 'final', sucesso: false, texto: 'Gravação descartada. Nada foi salvo.' },
      );
    } else if (r.final) {
      definir({ tipo: 'final', sucesso: false, texto: r.mensagem });
    } else if (tela.tipo === 'gravando') {
      definir({ ...tela, ocupado: null, erro: r.mensagem });
    }
  };

  const gravarAba = async () => {
    if (tela.tipo !== 'livre' || !aba?.url) return;
    definir({ ...tela, enviando: true, erro: null });
    const r = await enviar<Resultado>({ tipo: 'gravarAba', url: aba.url }).catch(
      (): Resultado => ({ ok: false, mensagem: 'Não consegui falar com a extensão. Feche e abra o popup de novo.' }),
    );
    if (r.ok) fechar();
    else definir({ tipo: 'livre', enviando: false, erro: r.mensagem, semPermissao: !!r.semPermissao });
  };

  function aviso(texto: string, acao?: HTMLElement): HTMLElement {
    return el(
      'div',
      { class: 'alert alert-warning pp-aviso', role: 'alert' },
      icone(ICONES.alerta, 'i'),
      el('div', { class: 'stack-sm grow' }, el('p', { class: 'small' }, texto), acao),
    );
  }

  function desenhar() {
    const t = tela;
    if (t.tipo === 'carregando') {
      trocar(corpo, el('p', { class: 'small muted' }, 'Carregando…'));
      return;
    }
    if (t.tipo === 'final') {
      trocar(corpo, 
        el(
          'div',
          { class: 'pp-final', role: 'status' },
          icone(t.sucesso ? ICONES.check : ['M8 8l8 8M16 8l-8 8'], `i ${t.sucesso ? 'text-success' : 'muted'}`),
          el('p', {}, t.texto),
        ),
        el('div', { class: 'pp-acoes' }, botao('Fechar', 'btn-secondary btn-sm', fechar)),
      );
      return;
    }
    if (t.tipo === 'livre') {
      const gravavel = paginaGravavel(aba?.url);
      const b = botao(t.enviando ? 'Abrindo o console…' : 'Gravar esta aba', 'btn-primary btn-block', () => void gravarAba());
      if (!gravavel || t.enviando) b.disabled = true;
      trocar(corpo, 
        el('p', { class: 'h4' }, 'Gravar um fluxo nesta aba'),
        el(
          'p',
          { class: 'small muted' },
          gravavel
            ? 'Abre o Aprender fluxo do console com o endereço desta aba já preenchido. Lá você dá um nome ao fluxo e começa a gravar.'
            : 'Abra uma página do sistema (http ou https) para gravar um fluxo nela.',
        ),
        b,
        t.erro
          ? aviso(
              t.erro,
              t.semPermissao
                ? botao('Abrir as opções', 'btn-secondary btn-sm', () => void chrome.runtime.openOptionsPage())
                : undefined,
            )
          : null,
      );
      return;
    }
    const e = t.estado;
    const cabecalho = el(
      'div',
      { class: 'pp-gravando' },
      el('span', { class: 'pp-ponto', 'aria-hidden': 'true' }),
      el('span', { class: 'strong' }, 'Gravando'),
      e.nome ? el('span', { class: 'pp-nome muted', title: e.nome }, `· ${e.nome}`) : null,
    );
    const passos = el('p', { class: 'pp-passos num' }, textoPassos(e.passos));
    let acoes: HTMLElement;
    if (t.ocupado) {
      acoes = el('div', { class: 'pp-acoes' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { class: 'small' }, t.ocupado));
    } else if (t.confirmarCancelar) {
      acoes = el(
        'div',
        { class: 'stack-sm' },
        el('p', { class: 'small' }, 'Descartar a gravação? Os passos gravados até agora serão perdidos.'),
        el(
          'div',
          { class: 'pp-acoes' },
          botao('Descartar', 'btn-secondary btn-sm', () => void executar('Descartando…', 'cancelar')),
          botao('Continuar gravando', 'btn-primary btn-sm', () => definir({ ...t, confirmarCancelar: false })),
        ),
      );
    } else {
      acoes = el(
        'div',
        { class: 'pp-acoes' },
        botao('Concluir', 'btn-primary btn-sm', () => void executar('Enviando a gravação…', 'concluir')),
        botao('Cancelar', 'btn-ghost btn-sm', () => definir({ ...t, confirmarCancelar: true, erro: null })),
      );
    }
    const avisoTexto = t.erro ?? e.aviso;
    trocar(corpo, 
      cabecalho,
      passos,
      el('p', { class: 'small muted' }, 'Faça o caminho normalmente na aba. O que você digita não é gravado, só o formato.'),
      avisoTexto
        ? aviso(
            avisoTexto,
            e.situacao === 'sem_permissao'
              ? botao('Abrir as opções', 'btn-secondary btn-sm', () => void enviar({ tipo: 'permitir', abaId }).catch(() => {}))
              : undefined,
          )
        : null,
      acoes,
    );
  }

  const mostrarEstado = (estado: EstadoAba | null) => {
    if (!estado) {
      if (tela.tipo !== 'final') definir({ tipo: 'livre', erro: null, enviando: false, semPermissao: false });
      return;
    }
    if (estado.situacao === 'gravando' || estado.situacao === 'sem_permissao') {
      if (tela.tipo === 'gravando') definir({ ...tela, estado });
      else definir({ tipo: 'gravando', estado, confirmarCancelar: false, ocupado: null, erro: null });
      return;
    }
    if (tela.tipo !== 'final') definir({ tipo: 'final', sucesso: estado.situacao === 'concluida', texto: estado.aviso ?? '' });
  };

  // Ao vivo: o fundo avisa a cada passo que chega.
  const aoMensagem = (m: unknown) => {
    if (ehAvisoEstado(m) && m.abaId === abaId) mostrarEstado(m.estado);
  };
  chrome.runtime.onMessage.addListener(aoMensagem);

  const inicial = abaId === undefined ? null : await enviar<EstadoAba | null>({ tipo: 'estado', abaId }).catch(() => null);
  mostrarEstado(inicial);
  return { tela: () => tela };
}

// Popup do ícone da extensão:
// - sem conta: "Entre para gravar fluxos para a sua empresa" (a entrada acontece no console);
// - com conta: a empresa (com "Trocar"), "Gravar esta aba" e as gravações recentes da pessoa;
//   perfil que não grava vê o porquê (e pode trocar de empresa);
// - gravando nesta aba: nome, passos ao vivo, Concluir e Cancelar (com confirmação);
// - no fim: enviada (Abrir no console), sem conexão (Tentar agora) ou descartada (Gravar de novo).
import { ROTULO_PERFIL, fmt, type GravacaoRecente, type SessaoExtensao } from '@copiloto/shared';
import { ehAvisoConta, ehAvisoEstado, enviar, type EstadoAba, type EstadoConta, type Recentes, type Resultado } from '../comum/mensagens.ts';
import { paginaGravavel, semParametros } from '../comum/parametros.ts';
import { ICONES, botao, el, icone, trocar } from './dom.ts';

type Final = 'enviada' | 'sem_conexao' | 'descartada' | 'encerrada';

type Tela =
  | { tipo: 'carregando' }
  | { tipo: 'entrar'; aviso: string | null; abrindo: boolean; erro: string | null }
  | { tipo: 'pronto'; enviando: boolean; erro: string | null; semPermissao: boolean }
  | { tipo: 'trocar'; abrindo: string | null; erro: string | null }
  | { tipo: 'gravando'; estado: EstadoAba; confirmarCancelar: boolean; ocupado: string | null; erro: string | null }
  | { tipo: 'final'; final: Final; estado: EstadoAba; texto: string; ocupado: boolean; erro: string | null };

export interface OpcoesPopup {
  /** Aba alvo (o padrão é a aba ativa). Serve para abrir o popup numa aba, nos testes e nos prints. */
  abaId?: number;
  fechar?: () => void;
  /** Relógio dos "Enviada há 2 min" (testes). */
  agora?: () => Date;
}

export const TEXTOS_POPUP = {
  titulo: 'Copiloto · Gravador de fluxos',
  entrarTitulo: 'Entre para gravar fluxos para a sua empresa',
  entrarTexto: 'Use o mesmo e-mail do console do Copiloto. Depois de entrar, você escolhe a empresa.',
  entrarBotao: 'Entrar com a conta do Copiloto',
  entrarNota: 'Abre a página de entrada do Copiloto numa nova aba.',
  semConta: 'Ainda não tem conta?',
  semContaAdmin: 'Fale com o admin da sua empresa.',
  gravarTitulo: 'Gravar um fluxo nesta aba',
  gravarTexto: 'Abre o Aprender fluxo do console com o endereço desta aba já preenchido. Lá você dá um nome ao fluxo e começa a gravar.',
  gravarNaoDa: 'Abra uma página do sistema (http ou https) para gravar um fluxo nela.',
  recentes: 'Gravações recentes',
  notaEnviada: 'A enviada espera a sua revisão no console antes de virar tarefa.',
  semRecentes: 'Suas gravações aparecem aqui depois de enviadas.',
  offline: 'Sem conexão com o copiloto agora. A empresa mostrada é a da última vez.',
  dica: 'Faça o caminho normalmente na aba. O que você digita não é gravado, só o formato.',
  descartarTitulo: 'Descartar a gravação?',
  descartarTexto: 'Os passos gravados até agora serão perdidos.',
  enviada: 'Gravação enviada. Volte ao console para revisar.',
  semConexaoTitulo: 'Sem conexão agora.',
  esperando: 'Esperando a conexão voltar',
  descartada: 'Gravação descartada. Nada foi salvo.',
  descartadaTexto: 'Quando quiser, grave o fluxo de novo nesta aba.',
  semExtensao: 'Não consegui falar com a extensão. Feche e abra o popup de novo.',
};

function textoPassos(n: number): string {
  return `${n} ${n === 1 ? 'passo' : 'passos'}`;
}

/** "Os 6 passos estão guardados e serão enviados quando a internet voltar." */
export function textoGuardados(n: number): string {
  if (n === 1) return 'O passo está guardado e será enviado quando a internet voltar.';
  return `Os ${n} passos estão guardados e serão enviados quando a internet voltar.`;
}

/** Endereço sem o protocolo, para a linha pequena do "Gravando" (app.horizonte.com.br/chamados). */
function enderecoCurto(url: string | undefined): string | null {
  if (!url || !paginaGravavel(url)) return null;
  try {
    const u = new URL(semParametros(url));
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return null;
  }
}

/** Selo de cada gravação recente: "Enviada há 2 min", "Em revisão", "Publicada". */
export function seloRecente(g: GravacaoRecente, agora = new Date()): { texto: string; classe: string; ponto: boolean } {
  switch (g.situacao) {
    case 'gravando':
      return { texto: 'Gravando', classe: 'badge-danger', ponto: true };
    case 'enviada': {
      const ha = fmt.haQuanto(g.em, agora);
      return { texto: ha === 'agora' ? 'Enviada agora' : `Enviada ${ha}`, classe: 'badge-warning', ponto: false };
    }
    case 'em_revisao':
      return { texto: 'Em revisão', classe: 'badge-info', ponto: false };
    default:
      return { texto: 'Publicada', classe: 'badge-success', ponto: true };
  }
}

export async function montarPopup(raiz: HTMLElement, opcoes: OpcoesPopup = {}) {
  const fechar = opcoes.fechar ?? (() => window.close());
  const agora = opcoes.agora ?? (() => new Date());
  let aba: chrome.tabs.Tab | undefined;
  try {
    aba = opcoes.abaId !== undefined ? await chrome.tabs.get(opcoes.abaId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  } catch {
    aba = undefined;
  }
  const abaId = opcoes.abaId ?? aba?.id;
  let tela: Tela = { tipo: 'carregando' };
  let conta: EstadoConta = { conectada: false };
  let recentes: Recentes | null = null;

  const definir = (t: Tela) => {
    tela = t;
    desenhar();
  };

  const falhaExtensao = (): Resultado => ({ ok: false, mensagem: TEXTOS_POPUP.semExtensao });

  // ---------- Peças ----------

  function topo(comOpcoes: boolean): HTMLElement {
    return el(
      'header',
      { class: 'pp-topo' },
      el(
        'div',
        { class: 'row pp-topo-marca' },
        el('span', { class: 'pp-marca', 'aria-hidden': 'true' }, 'S'),
        el('p', { class: 'small strong' }, TEXTOS_POPUP.titulo),
      ),
      comOpcoes ? botao('Opções', 'btn-ghost btn-sm', () => void chrome.runtime.openOptionsPage()) : null,
    );
  }

  function rodape(texto: string | null): HTMLElement | null {
    return texto ? el('footer', { class: 'pp-rodape tiny muted' }, texto) : null;
  }

  function destino(e: EstadoAba): string | null {
    const partes = [e.empresa, e.pessoa].filter((x): x is string => !!x);
    return partes.length ? partes.join(' · ') : null;
  }

  function aviso(texto: string, acao?: HTMLElement | null, classe = 'alert-warning'): HTMLElement {
    return el(
      'div',
      { class: `alert ${classe} pp-aviso`, role: 'alert' },
      icone(ICONES.alerta, 'i'),
      el('div', { class: 'stack-sm grow' }, el('p', { class: 'small' }, texto), acao),
    );
  }

  function botaoOpcoes(): HTMLButtonElement {
    return botao('Abrir as opções', 'btn-secondary btn-sm', () => void chrome.runtime.openOptionsPage());
  }

  function comIcone(b: HTMLButtonElement, caminhos: string[]): HTMLButtonElement {
    b.prepend(icone(caminhos, 'i'));
    return b;
  }

  function linhaEmpresa(s: SessaoExtensao): HTMLElement {
    return el(
      'div',
      { class: 'row pp-empresa' },
      el('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' }, s.empresa.iniciais),
      el(
        'div',
        { class: 'grow pp-empresa-textos' },
        el('p', { class: 'small pp-empresa-nome' }, el('span', { class: 'strong' }, s.empresa.nome), el('span', { class: 'muted' }, ` · ${s.pessoa.nome}`)),
        // Só a empresa de demonstração tem dados de exemplo.
        s.empresa.demo ? el('span', { class: 'badge badge-outline pp-selo-exemplo' }, 'Dados de exemplo') : null,
      ),
      botao('Trocar', 'btn-ghost btn-sm', () => definir({ tipo: 'trocar', abrindo: null, erro: null }), { 'aria-label': 'Trocar de empresa ou de conta' }),
    );
  }

  // ---------- Ações ----------

  const entrar = async (empresaId?: string) => {
    if (tela.tipo === 'entrar') definir({ ...tela, abrindo: true, erro: null });
    else if (tela.tipo === 'trocar') definir({ ...tela, abrindo: empresaId ?? 'conta', erro: null });
    const r = await enviar<Resultado>(empresaId ? { tipo: 'entrar', empresaId } : { tipo: 'entrar' }).catch(falhaExtensao);
    if (r.ok) return fechar();
    if (tela.tipo === 'entrar') definir({ ...tela, abrindo: false, erro: r.mensagem });
    else if (tela.tipo === 'trocar') definir({ ...tela, abrindo: null, erro: r.mensagem });
  };

  const sair = async () => {
    await enviar<Resultado>({ tipo: 'sair' }).catch(falhaExtensao);
    conta = { conectada: false };
    recentes = null;
    definir({ tipo: 'entrar', aviso: null, abrindo: false, erro: null });
  };

  const gravarAba = async () => {
    if (tela.tipo !== 'pronto' || !aba?.url) return;
    definir({ ...tela, enviando: true, erro: null });
    const r = await enviar<Resultado>({ tipo: 'gravarAba', url: aba.url }).catch(falhaExtensao);
    if (r.ok) fechar();
    else definir({ tipo: 'pronto', enviando: false, erro: r.mensagem, semPermissao: !!r.semPermissao });
  };

  const executar = async (rotulo: string, pedido: 'concluir' | 'cancelar') => {
    if (tela.tipo !== 'gravando' || abaId === undefined) return;
    const estado = tela.estado;
    definir({ ...tela, ocupado: rotulo, erro: null, confirmarCancelar: false });
    const r = await enviar<Resultado>({ tipo: pedido, abaId }).catch(falhaExtensao);
    // O aviso do fundo pode ter chegado durante o pedido e já mostrado o fim.
    const agoraTela = tela as Tela;
    if (r.ok) {
      if (agoraTela.tipo === 'final' && agoraTela.final !== 'sem_conexao') return;
      const atual = agoraTela.tipo === 'gravando' ? agoraTela.estado : estado;
      definir(
        pedido === 'concluir'
          ? { tipo: 'final', final: 'enviada', estado: atual, texto: TEXTOS_POPUP.enviada, ocupado: false, erro: null }
          : { tipo: 'final', final: 'descartada', estado: atual, texto: TEXTOS_POPUP.descartada, ocupado: false, erro: null },
      );
    } else if (r.final) {
      definir({ tipo: 'final', final: 'encerrada', estado, texto: r.mensagem, ocupado: false, erro: null });
    } else if (r.semConexao) {
      if (agoraTela.tipo === 'final') return;
      const atual = agoraTela.tipo === 'gravando' ? agoraTela.estado : estado;
      definir({ tipo: 'final', final: 'sem_conexao', estado: { ...atual, situacao: 'sem_conexao' }, texto: TEXTOS_POPUP.semConexaoTitulo, ocupado: false, erro: null });
    } else if (agoraTela.tipo === 'gravando') {
      definir({ ...agoraTela, ocupado: null, erro: r.mensagem });
    }
  };

  const tentarAgora = async () => {
    if (tela.tipo !== 'final' || abaId === undefined) return;
    definir({ ...tela, ocupado: true, erro: null });
    const r = await enviar<Resultado>({ tipo: 'tentarAgora', abaId }).catch(falhaExtensao);
    if (tela.tipo !== 'final') return;
    if (r.ok) definir({ ...tela, final: 'enviada', texto: TEXTOS_POPUP.enviada, ocupado: false });
    else if (r.final) definir({ ...tela, final: 'encerrada', texto: r.mensagem, ocupado: false });
    else definir({ ...tela, ocupado: false, erro: r.semConexao ? null : r.mensagem });
  };

  const abrirNoConsole = async (e: EstadoAba) => {
    const r = await enviar<Resultado>({ tipo: 'abrirConsole', fluxoId: e.fluxoId ?? null, api: e.api || null }).catch(falhaExtensao);
    if (r.ok) fechar();
    else if (tela.tipo === 'final') definir({ ...tela, erro: r.mensagem });
  };

  const abrirRecente = async (g: GravacaoRecente) => {
    await chrome.tabs.create({ url: g.url }).catch(() => {});
    fechar();
  };

  // ---------- Telas ----------

  function telaEntrar(t: Extract<Tela, { tipo: 'entrar' }>): Node[] {
    const b = botao(t.abrindo ? 'Abrindo o console…' : TEXTOS_POPUP.entrarBotao, 'btn-primary btn-block', () => void entrar());
    if (t.abrindo) b.disabled = true;
    return [
      topo(false),
      el(
        'div',
        { class: 'pp-centro' },
        el('span', { class: 'pp-selo pp-selo-marca', 'aria-hidden': 'true' }, icone(ICONES.pessoa, 'i i-lg')),
        el('div', { class: 'stack-sm pp-textos' }, el('h1', { class: 'h3' }, TEXTOS_POPUP.entrarTitulo), el('p', { class: 'small muted' }, TEXTOS_POPUP.entrarTexto)),
        t.aviso ? aviso(t.aviso) : null,
        el('div', { class: 'stack-sm pp-largo' }, b, el('p', { class: 'tiny muted' }, TEXTOS_POPUP.entrarNota)),
        t.erro ? aviso(t.erro, botaoOpcoes()) : null,
      ),
      el(
        'footer',
        { class: 'pp-rodape pp-rodape-centro' },
        el('p', { class: 'small muted' }, `${TEXTOS_POPUP.semConta} `, el('span', { class: 'strong pp-tinta' }, TEXTOS_POPUP.semContaAdmin)),
      ),
    ];
  }

  function listaRecentes(): HTMLElement {
    const corpo: HTMLElement[] = [];
    if (!recentes) {
      corpo.push(el('p', { class: 'row tiny muted pp-carregando' }, el('span', { class: 'spinner pp-spinner-p', 'aria-hidden': 'true' }), 'Carregando…'));
    } else if (!recentes.ok) {
      corpo.push(el('p', { class: 'tiny muted' }, recentes.mensagem));
    } else if (recentes.gravacoes.length === 0) {
      corpo.push(el('p', { class: 'tiny muted' }, TEXTOS_POPUP.semRecentes));
    } else {
      const ul = el('ul', { class: 'stack-sm pp-recentes' });
      for (const g of recentes.gravacoes) {
        const selo = seloRecente(g, agora());
        const a = el(
          'a',
          { class: 'row pp-recente', href: g.url, title: `${g.nome} · ${textoPassos(g.passos)}` },
          el('span', { class: 'small strong grow pp-recente-nome' }, g.nome),
          el('span', { class: `badge ${selo.classe}` }, selo.ponto ? el('span', { class: 'dot' }) : null, selo.texto),
        );
        a.addEventListener('click', (e) => {
          e.preventDefault();
          void abrirRecente(g);
        });
        ul.appendChild(el('li', {}, a));
      }
      corpo.push(ul);
      if (recentes.gravacoes.some((g) => g.situacao === 'enviada')) corpo.push(el('p', { class: 'tiny muted' }, TEXTOS_POPUP.notaEnviada));
    }
    return el(
      'section',
      { class: 'stack-sm pp-secao-recentes', 'aria-labelledby': 'recentes-titulo' },
      el('h2', { class: 'eyebrow', id: 'recentes-titulo' }, TEXTOS_POPUP.recentes),
      ...corpo,
    );
  }

  function telaSemPerfil(s: SessaoExtensao): Node[] {
    const outras = s.empresas.filter((e) => e.id !== s.empresa.id);
    return [
      topo(true),
      linhaEmpresa(s),
      el(
        'div',
        { class: 'pp-centro' },
        el('span', { class: 'pp-selo pp-selo-neutro', 'aria-hidden': 'true' }, icone(ICONES.cadeado, 'i i-lg')),
        el(
          'div',
          { class: 'stack-sm pp-textos' },
          el('h1', { class: 'h4' }, 'Seu perfil não permite gravar fluxos'),
          el(
            'p',
            { class: 'small muted' },
            `Na ${s.empresa.nome} você está como ${ROTULO_PERFIL[s.perfil]}. Quem grava fluxos são Admin e Editor de tarefas. Peça a um admin da empresa para mudar o seu perfil no console.`,
          ),
        ),
        outras.length
          ? el('div', { class: 'stack-sm pp-largo' }, botao('Trocar de empresa', 'btn-secondary btn-block', () => definir({ tipo: 'trocar', abrindo: null, erro: null })))
          : null,
      ),
    ];
  }

  function telaPronto(t: Extract<Tela, { tipo: 'pronto' }>, s: SessaoExtensao, offline: boolean): Node[] {
    if (!s.podeGravar) return telaSemPerfil(s);
    const gravavel = paginaGravavel(aba?.url);
    const b = comIcone(botao(t.enviando ? 'Abrindo o console…' : 'Gravar esta aba', 'btn-primary btn-block', () => void gravarAba()), ICONES.gravar);
    if (!gravavel || t.enviando) b.disabled = true;
    const enderecoAba = aba?.url ? semParametros(aba.url) : '';
    const campo = el('input', { class: 'input mono pp-aba', id: 'aba-atual', type: 'text', readonly: '', title: enderecoAba });
    campo.value = enderecoAba;
    const filhos: (HTMLElement | null)[] = [
      topo(true),
      linhaEmpresa(s),
      offline ? el('div', { class: 'pp-faixa' }, aviso(TEXTOS_POPUP.offline)) : null,
      el(
        'div',
        { class: 'stack-sm pp-bloco' },
        el(
          'div',
          { class: 'stack-sm pp-junto' },
          el('h1', { class: 'h4' }, TEXTOS_POPUP.gravarTitulo),
          el('p', { class: 'small muted' }, gravavel ? TEXTOS_POPUP.gravarTexto : TEXTOS_POPUP.gravarNaoDa),
        ),
        gravavel ? el('div', { class: 'field pp-campo' }, el('label', { class: 'tiny', for: 'aba-atual' }, 'Esta aba'), campo) : null,
        b,
        t.erro ? aviso(t.erro, t.semPermissao ? botaoOpcoes() : null) : null,
      ),
      el('div', { class: 'divider' }),
      listaRecentes(),
    ];
    return filhos.filter((x): x is HTMLElement => !!x);
  }

  function telaTrocar(t: Extract<Tela, { tipo: 'trocar' }>, s: SessaoExtensao): Node[] {
    const lista = el('ul', { class: 'stack-sm pp-empresas' });
    const empresas = s.empresas.some((e) => e.id === s.empresa.id) ? s.empresas : [{ ...s.empresa, perfil: s.perfil }, ...s.empresas];
    for (const e of empresas) {
      const atual = e.id === s.empresa.id;
      const b = el(
        'button',
        { type: 'button', class: `row pp-empresa-opcao${atual ? ' pp-atual' : ''}` },
        el('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' }, e.iniciais),
        el('span', { class: 'grow pp-empresa-textos' }, el('span', { class: 'small strong' }, e.nome), el('span', { class: 'tiny muted' }, ROTULO_PERFIL[e.perfil])),
        atual ? el('span', { class: 'badge badge-outline' }, 'Atual') : t.abrindo === e.id ? el('span', { class: 'spinner pp-spinner-p', 'aria-hidden': 'true' }) : null,
      );
      if (atual || t.abrindo) b.disabled = true;
      if (atual) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => void entrar(e.id));
      lista.appendChild(el('li', {}, b));
    }
    const outra = botao(t.abrindo === 'conta' ? 'Abrindo o console…' : 'Entrar com outra conta', 'btn-secondary btn-block', () => void entrar());
    if (t.abrindo) outra.disabled = true;
    const filhos: (HTMLElement | null)[] = [
      topo(true),
      el(
        'div',
        { class: 'stack-sm pp-bloco' },
        el(
          'div',
          { class: 'row between' },
          el('h1', { class: 'h4' }, 'Trocar de empresa ou de conta'),
          botao('Voltar', 'btn-ghost btn-sm', () => definir({ tipo: 'pronto', enviando: false, erro: null, semPermissao: false })),
        ),
        el('p', { class: 'small muted' }, `Você entrou como ${s.pessoa.nome} (${s.pessoa.email}). Escolha para qual empresa vão as gravações:`),
        lista,
        el('p', { class: 'tiny muted' }, 'A troca é confirmada no console, numa nova aba.'),
        t.erro ? aviso(t.erro) : null,
        outra,
        botao('Sair da extensão', 'btn-ghost btn-block', () => void sair()),
      ),
    ];
    return filhos.filter((x): x is HTMLElement => !!x);
  }

  function telaGravando(t: Extract<Tela, { tipo: 'gravando' }>): Node[] {
    const e = t.estado;
    const endereco = enderecoCurto(aba?.url);
    const quem = destino(e);
    const cabecalho = el(
      'div',
      { class: 'stack-sm pp-junto' },
      el('p', { class: 'row small strong pp-gravando' }, el('span', { class: 'pp-ponto', 'aria-hidden': 'true' }), 'Gravando'),
      e.nome ? el(t.confirmarCancelar ? 'h2' : 'h1', { class: 'h3 pp-nome', title: e.nome }, e.nome) : null,
      t.confirmarCancelar
        ? el('p', { class: 'small muted num' }, `${textoPassos(e.passos)} até agora`)
        : endereco
          ? el('p', { class: 'tiny mono muted pp-endereco', title: endereco }, endereco)
          : null,
    );
    if (t.confirmarCancelar) {
      const filhos: (HTMLElement | null)[] = [
        topo(true),
        el(
          'div',
          { class: 'stack pp-bloco pp-cheio' },
          cabecalho,
          el(
            'div',
            { class: 'alert alert-warning pp-empurra', role: 'alert', 'aria-labelledby': 'descartar-titulo' },
            icone(ICONES.alerta, 'i'),
            el(
              'div',
              { class: 'stack-sm grow pp-junto' },
              el('p', { class: 'strong', id: 'descartar-titulo' }, TEXTOS_POPUP.descartarTitulo),
              el('p', { class: 'small' }, TEXTOS_POPUP.descartarTexto),
            ),
          ),
          el(
            'div',
            { class: 'row pp-botoes' },
            botao('Descartar', 'btn-secondary', () => void executar('Descartando…', 'cancelar')),
            botao('Continuar gravando', 'btn-primary grow', () => definir({ ...t, confirmarCancelar: false })),
          ),
        ),
        rodape(quem ? `Envia para ${quem}` : null),
      ];
      return filhos.filter((x): x is HTMLElement => !!x);
    }
    const contagem = el(
      'p',
      { class: 'row pp-contagem', role: 'status' },
      el('span', { class: 'num pp-contagem-n' }, e.passos === 0 ? 'Nenhum passo' : textoPassos(e.passos)),
      el('span', { class: 'small muted' }, e.passos === 0 ? 'ainda' : 'até agora'),
    );
    const avisoTexto = t.erro ?? e.aviso;
    const acoes = t.ocupado
      ? el('div', { class: 'row pp-botoes pp-empurra' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { class: 'small' }, t.ocupado))
      : el(
          'div',
          { class: 'row pp-botoes pp-empurra' },
          comIcone(botao('Concluir', 'btn-primary grow', () => void executar('Enviando a gravação…', 'concluir')), ICONES.check),
          botao('Cancelar', 'btn-ghost', () => definir({ ...t, confirmarCancelar: true, erro: null })),
        );
    const filhos: (HTMLElement | null)[] = [
      topo(true),
      el(
        'div',
        { class: 'stack pp-bloco pp-cheio' },
        cabecalho,
        contagem,
        el('p', { class: 'small muted' }, TEXTOS_POPUP.dica),
        avisoTexto
          ? aviso(
              avisoTexto,
              e.situacao === 'sem_permissao'
                ? botao('Abrir as opções', 'btn-secondary btn-sm', () => void enviar({ tipo: 'permitir', abaId }).catch(() => {}))
                : null,
            )
          : null,
        acoes,
      ),
      rodape(quem ? `Envia para ${quem}` : null),
    ];
    return filhos.filter((x): x is HTMLElement => !!x);
  }

  function telaFinal(t: Extract<Tela, { tipo: 'final' }>): Node[] {
    const e = t.estado;
    const quem = destino(e);
    let selo: HTMLElement;
    let textos: HTMLElement;
    let extra: HTMLElement | null = null;
    let principal: HTMLButtonElement;
    let rodapeTexto: string | null = quem;
    if (t.final === 'enviada') {
      selo = el('span', { class: 'pp-selo pp-selo-sucesso', 'aria-hidden': 'true' }, icone(ICONES.check, 'i i-lg'));
      textos = el(
        'div',
        { class: 'stack-sm pp-textos' },
        el('h1', { class: 'h4' }, t.texto),
        e.nome ? el('p', { class: 'small muted' }, `${e.nome} · ${textoPassos(e.passos)}`) : null,
      );
      principal = comIcone(botao('Abrir no console', 'btn-primary btn-block', () => void abrirNoConsole(e)), ICONES.externo);
      rodapeTexto = quem ? `Enviada para ${quem}` : null;
    } else if (t.final === 'sem_conexao') {
      selo = el('span', { class: 'pp-selo pp-selo-alerta', 'aria-hidden': 'true' }, icone(ICONES.semRede, 'i i-lg'));
      textos = el('div', { class: 'stack-sm pp-textos' }, el('h1', { class: 'h4' }, TEXTOS_POPUP.semConexaoTitulo), el('p', { class: 'small' }, textoGuardados(e.passos)));
      extra = el('p', { class: 'row tiny muted pp-esperando' }, el('span', { class: 'spinner pp-spinner-p', 'aria-hidden': 'true' }), TEXTOS_POPUP.esperando);
      principal = comIcone(botao(t.ocupado ? 'Tentando…' : 'Tentar agora', 'btn-secondary btn-block', () => void tentarAgora()), ICONES.tentar);
      if (t.ocupado) principal.disabled = true;
      rodapeTexto = quem ? `Vai para ${quem}` : null;
    } else if (t.final === 'descartada') {
      selo = el('span', { class: 'pp-selo pp-selo-neutro', 'aria-hidden': 'true' }, icone(ICONES.fechar, 'i i-lg'));
      textos = el('div', { class: 'stack-sm pp-textos' }, el('h1', { class: 'h4' }, t.texto), el('p', { class: 'small muted' }, TEXTOS_POPUP.descartadaTexto));
      principal = comIcone(botao('Gravar de novo', 'btn-secondary btn-block', () => void carregarConta()), ICONES.gravar);
    } else {
      selo = el('span', { class: 'pp-selo pp-selo-neutro', 'aria-hidden': 'true' }, icone(ICONES.info, 'i i-lg'));
      textos = el('div', { class: 'stack-sm pp-textos' }, el('h1', { class: 'h4' }, t.texto));
      principal = comIcone(botao('Abrir no console', 'btn-secondary btn-block', () => void abrirNoConsole(e)), ICONES.externo);
    }
    const filhos: (HTMLElement | null)[] = [
      topo(true),
      el('div', { class: 'pp-centro', role: 'status' }, selo, textos, extra),
      el('div', { class: 'stack-sm pp-final-acoes' }, t.erro ? aviso(t.erro) : null, principal, botao('Fechar', 'btn-ghost btn-block', fechar)),
      rodape(rodapeTexto),
    ];
    return filhos.filter((x): x is HTMLElement => !!x);
  }

  function desenhar(): void {
    const t = tela;
    let filhos: Node[];
    if (t.tipo === 'carregando') {
      filhos = [topo(false), el('div', { class: 'pp-centro' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('p', { class: 'small muted' }, 'Carregando…'))];
    } else if (t.tipo === 'entrar') {
      filhos = telaEntrar(t);
    } else if (t.tipo === 'pronto' || t.tipo === 'trocar') {
      if (!conta.conectada) {
        tela = { tipo: 'entrar', aviso: null, abrindo: false, erro: null };
        return desenhar();
      }
      filhos = t.tipo === 'pronto' ? telaPronto(t, conta.sessao, !!conta.offline) : telaTrocar(t, conta.sessao);
    } else if (t.tipo === 'gravando') {
      filhos = telaGravando(t);
    } else {
      filhos = telaFinal(t);
    }
    trocar(raiz, el('section', { class: 'pp', 'aria-label': TEXTOS_POPUP.titulo, 'aria-live': 'polite' }, ...filhos));
  }

  // ---------- Dados ----------

  async function carregarConta(): Promise<void> {
    const c = await enviar<EstadoConta | null>({ tipo: 'conta' }).catch(() => null);
    conta = c && typeof c === 'object' ? c : { conectada: false };
    if (!conta.conectada) {
      definir({ tipo: 'entrar', aviso: conta.aviso ?? null, abrindo: false, erro: null });
      return;
    }
    recentes = null;
    definir({ tipo: 'pronto', enviando: false, erro: null, semPermissao: false });
    if (conta.sessao.podeGravar) {
      recentes = await enviar<Recentes>({ tipo: 'recentes' }).catch((): Recentes => ({ ok: false, mensagem: TEXTOS_POPUP.semExtensao }));
      if (tela.tipo === 'pronto') desenhar();
    }
  }

  const mostrarEstado = async (estado: EstadoAba | null) => {
    if (!estado) {
      // Sem gravação nesta aba: a tela da conta (o fim de uma gravação continua na tela até fechar).
      if (tela.tipo === 'carregando' || tela.tipo === 'gravando') await carregarConta();
      return;
    }
    if (estado.situacao === 'gravando' || estado.situacao === 'sem_permissao') {
      if (tela.tipo === 'gravando') definir({ ...tela, estado });
      else definir({ tipo: 'gravando', estado, confirmarCancelar: false, ocupado: null, erro: null });
      return;
    }
    if (estado.situacao === 'sem_conexao') {
      if (tela.tipo === 'final' && tela.final === 'sem_conexao') definir({ ...tela, estado });
      else definir({ tipo: 'final', final: 'sem_conexao', estado, texto: TEXTOS_POPUP.semConexaoTitulo, ocupado: false, erro: null });
      return;
    }
    const final: Final = estado.situacao === 'concluida' ? 'enviada' : estado.situacao === 'cancelada' ? 'descartada' : 'encerrada';
    if (tela.tipo === 'final' && tela.final === final) return;
    const texto = final === 'enviada' ? TEXTOS_POPUP.enviada : final === 'descartada' ? TEXTOS_POPUP.descartada : (estado.aviso ?? '');
    definir({ tipo: 'final', final, estado, texto, ocupado: false, erro: null });
  };

  // Ao vivo: o fundo avisa a cada passo que chega e quando a conta muda (entrou pelo console, saiu).
  const aoMensagem = (m: unknown) => {
    if (ehAvisoEstado(m) && m.abaId === abaId) void mostrarEstado(m.estado);
    else if (ehAvisoConta(m) && (tela.tipo === 'entrar' || tela.tipo === 'pronto' || tela.tipo === 'trocar')) void carregarConta();
  };
  chrome.runtime.onMessage.addListener(aoMensagem);

  desenhar();
  const inicial = abaId === undefined ? null : await enviar<EstadoAba | null>({ tipo: 'estado', abaId }).catch(() => null);
  await mostrarEstado(inicial);
  return { tela: () => tela };
}

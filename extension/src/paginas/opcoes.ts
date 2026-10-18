// Opções da extensão: o "Servidor do copiloto" (padrão http://localhost:3000). Fora de localhost,
// o Chrome pede a permissão para aquele endereço; o pedido precisa sair do clique da pessoa.
// Com ?permitir=<servidor> (aberto pela barra de uma gravação), mostra antes o pedido de liberação.
// Também mostra a conta em que a extensão entrou (empresa e pessoa), com "Sair".
import { ehAvisoConta, enviar, type EstadoConta, type Resultado, type Saude } from '../comum/mensagens.ts';
import { SERVIDOR_PADRAO, origemDe, padraoPermissao, salvarServidor, servidorConfigurado, temPermissao } from '../comum/servidor.ts';
import { ICONES, botao, el, icone, trocar } from './dom.ts';

type Status = { tipo: 'ok' | 'erro' | 'info'; texto: string } | null;

function caixaStatus(s: Status): HTMLElement | null {
  if (!s) return null;
  const classe = s.tipo === 'ok' ? 'alert alert-success' : s.tipo === 'erro' ? 'alert alert-danger' : 'alert';
  return el(
    'div',
    { class: classe, role: s.tipo === 'erro' ? 'alert' : 'status' },
    icone(s.tipo === 'ok' ? ICONES.check : ICONES.alerta, 'i'),
    el('p', { class: 'small' }, s.texto),
  );
}

export async function montarOpcoes(raiz: HTMLElement, busca = '') {
  const pedidoPermissao = origemDe(new URLSearchParams(busca).get('permitir'));
  const atual = await servidorConfigurado();

  const campo = el('input', {
    id: 'servidor',
    class: 'input',
    type: 'url',
    inputmode: 'url',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: SERVIDOR_PADRAO,
    'aria-describedby': 'servidor-ajuda',
  });
  campo.value = atual;
  const statusServidor = el('div', { class: 'op-status', 'aria-live': 'polite' });
  const statusPermissao = el('div', { class: 'op-status', 'aria-live': 'polite' });
  const mostrar = (onde: HTMLElement, s: Status) => trocar(onde, caixaStatus(s));

  /** Pede a permissão e devolve se ficou liberado. Chamado direto no clique (o Chrome exige o gesto). */
  const pedirPermissao = (origem: string): Promise<boolean> =>
    chrome.permissions.request({ origins: [padraoPermissao(origem)] }).catch(() => false);

  const salvar = () => {
    const origem = origemDe(campo.value);
    if (!origem) {
      mostrar(statusServidor, { tipo: 'erro', texto: `Use um endereço completo, por exemplo ${SERVIDOR_PADRAO} ou https://copiloto.suaempresa.com.br.` });
      campo.focus();
      return;
    }
    const pedido = pedirPermissao(origem);
    void pedido.then(async (liberado) => {
      if (!liberado) {
        mostrar(statusServidor, {
          tipo: 'erro',
          texto: `Sem a permissão, a extensão não consegue falar com ${origem}. O servidor não foi trocado.`,
        });
        return;
      }
      const anterior = await servidorConfigurado();
      await salvarServidor(origem);
      campo.value = origem;
      // A conta é de um servidor: trocou o servidor, a extensão sai dela (o token deixa de valer).
      const trocou = anterior !== origem && conta.conectada;
      if (trocou) await enviar<Resultado>({ tipo: 'sair' }).catch(() => null);
      mostrar(statusServidor, {
        tipo: 'ok',
        texto: trocou ? `Servidor salvo: ${origem}. Entre de novo com a sua conta pelo ícone da extensão.` : `Servidor salvo: ${origem}.`,
      });
      await atualizarConta();
    });
  };

  const testar = async () => {
    const origem = origemDe(campo.value);
    if (!origem) {
      mostrar(statusServidor, { tipo: 'erro', texto: `Use um endereço completo, por exemplo ${SERVIDOR_PADRAO}.` });
      return;
    }
    mostrar(statusServidor, { tipo: 'info', texto: `Testando ${origem}…` });
    const r = await enviar<Saude>({ tipo: 'saude', servidor: origem }).catch(
      (): Saude => ({ ok: false, servidor: origem, mensagem: 'Não consegui falar com a extensão. Recarregue esta página.' }),
    );
    mostrar(
      statusServidor,
      r.ok
        ? { tipo: 'ok', texto: `Conectado ao copiloto. O console fica em ${r.urlConsole}.` }
        : { tipo: 'erro', texto: r.semPermissao ? `Salve o servidor para liberar ${origem} e teste de novo.` : r.mensagem },
    );
  };

  const form = el(
    'form',
    { class: 'card card-pad stack', novalidate: '' },
    el('div', {}, el('h2', { class: 'h4' }, 'Servidor do copiloto'), el('p', { class: 'small muted' }, 'Para onde a extensão manda os passos gravados.')),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'servidor' }, 'Servidor do copiloto'),
      campo,
      el(
        'p',
        { id: 'servidor-ajuda', class: 'tiny muted' },
        `Endereço do copiloto, sem caminho. Com npm run dev é ${SERVIDOR_PADRAO}. Gravações abertas pelo console já trazem o endereço certo.`,
      ),
    ),
    statusServidor,
    el(
      'div',
      { class: 'op-acoes' },
      botao('Testar conexão', 'btn-secondary', () => void testar()),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'Salvar'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    salvar();
  });

  // ---------- Conta ----------
  let conta: EstadoConta = { conectada: false };
  const corpoConta = el('div', { class: 'stack-sm', 'aria-live': 'polite' });
  const atualizarConta = async () => {
    const c = await enviar<EstadoConta | null>({ tipo: 'conta' }).catch(() => null);
    conta = c && typeof c === 'object' ? c : { conectada: false };
    if (conta.conectada) {
      const s = conta.sessao;
      trocar(
        corpoConta,
        el(
          'div',
          { class: 'row op-conta' },
          el('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' }, s.empresa.iniciais),
          el(
            'p',
            { class: 'small grow' },
            el('span', { class: 'strong' }, s.empresa.nome),
            el('span', { class: 'muted' }, ` · ${s.pessoa.nome} (${s.pessoa.email})`),
          ),
          botao('Sair', 'btn-secondary btn-sm', () => {
            void enviar<Resultado>({ tipo: 'sair' })
              .catch(() => null)
              .then(() => atualizarConta());
          }),
        ),
        el('p', { class: 'tiny muted' }, 'Para trocar de empresa, use "Trocar" no ícone da extensão. Ao sair, o acesso desta extensão é cancelado no copiloto.'),
      );
    } else {
      trocar(
        corpoConta,
        el('p', { class: 'small muted' }, conta.aviso ?? 'A extensão ainda não entrou em nenhuma conta.'),
        el(
          'div',
          { class: 'op-acoes op-acoes-esq' },
          botao('Entrar com a conta do Copiloto', 'btn-secondary btn-sm', () => {
            void enviar<Resultado>({ tipo: 'entrar' })
              .catch((): Resultado => ({ ok: false, mensagem: 'Não consegui falar com a extensão. Recarregue esta página.' }))
              .then((r) => {
                if (!r.ok) trocar(corpoConta, caixaStatus({ tipo: 'erro', texto: r.mensagem }));
              });
          }),
        ),
      );
    }
  };
  chrome.runtime.onMessage.addListener((m) => {
    if (ehAvisoConta(m)) void atualizarConta();
  });
  const cartaoConta = el(
    'section',
    { class: 'card card-pad stack', 'aria-labelledby': 'op-conta-titulo' },
    el('div', {}, el('h2', { class: 'h4', id: 'op-conta-titulo' }, 'Conta'), el('p', { class: 'small muted' }, 'Para qual empresa vão as gravações feitas pelo ícone da extensão.')),
    corpoConta,
  );
  await atualizarConta();

  let cartaoPermissao: HTMLElement | null = null;
  if (pedidoPermissao) {
    const jaLiberado = await temPermissao(pedidoPermissao);
    const permitir = botao(`Liberar ${pedidoPermissao}`, 'btn-primary', () => {
      void pedirPermissao(pedidoPermissao).then((ok) => {
        mostrar(
          statusPermissao,
          ok
            ? { tipo: 'ok', texto: 'Pronto. A gravação continua na aba do sistema; os passos guardados já estão sendo enviados.' }
            : { tipo: 'erro', texto: 'A permissão não foi dada. Sem ela, os passos ficam guardados na aba e não chegam ao console.' },
        );
        if (ok) permitir.disabled = true;
      });
    });
    if (jaLiberado) permitir.disabled = true;
    cartaoPermissao = el(
      'section',
      { class: 'card card-pad stack op-permissao', 'aria-labelledby': 'op-permissao-titulo' },
      el('h2', { class: 'h4', id: 'op-permissao-titulo' }, 'Uma gravação precisa deste servidor'),
      el(
        'p',
        { class: 'small' },
        `A gravação aberta pelo console manda os passos para o copiloto em ${pedidoPermissao}. Libere esse endereço para a extensão poder falar com ele.`,
      ),
      el('div', { class: 'op-acoes' }, permitir),
      statusPermissao,
    );
    if (jaLiberado) mostrar(statusPermissao, { tipo: 'ok', texto: 'Este servidor já está liberado.' });
  }

  raiz.replaceChildren(
    el(
      'main',
      { class: 'op' },
      el(
        'header',
        { class: 'op-topo' },
        el('span', { class: 'pp-marca', 'aria-hidden': 'true' }, 'S'),
        el('div', {}, el('h1', { class: 'h3' }, 'Copiloto · Gravador de fluxos'), el('p', { class: 'small muted' }, 'Opções da extensão')),
      ),
      cartaoPermissao,
      cartaoConta,
      form,
      el(
        'p',
        { class: 'tiny muted' },
        'A extensão só envia o formato do que você digita (por exemplo, 99.999.999/9999-99), nunca o valor, e nada de campos de senha.',
      ),
    ),
  );
  return { campo };
}

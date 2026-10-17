// Opções da extensão: o "Servidor do copiloto" (padrão http://localhost:3000). Fora de localhost,
// o Chrome pede a permissão para aquele endereço; o pedido precisa sair do clique da pessoa.
// Com ?permitir=<servidor> (aberto pela barra de uma gravação), mostra antes o pedido de liberação.
import { enviar, type Saude } from '../comum/mensagens.ts';
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
      await salvarServidor(origem);
      campo.value = origem;
      mostrar(statusServidor, { tipo: 'ok', texto: `Servidor salvo: ${origem}.` });
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
        el('span', { class: 'pp-marca', 'aria-hidden': 'true' }, el('span', { class: 'pp-marca-ponto' })),
        el('div', {}, el('h1', { class: 'h3' }, 'Copiloto · Gravador de fluxos'), el('p', { class: 'small muted' }, 'Opções da extensão')),
      ),
      cartaoPermissao,
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

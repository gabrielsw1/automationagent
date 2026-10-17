// O widget dentro do sistema anfitrião: botão flutuante, painel do chat, atalho Ctrl/Cmd+K,
// sugestão proativa discreta e aviso de mensagem nova com o painel fechado. Roda dentro do Shadow DOM.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MensagemWidget, PaginaContexto, SugestaoProativa, WidgetInicio } from '@copiloto/shared';
import { ClienteApi } from '../chat/api.ts';
import { ControladorChat, resumoMensagem } from '../chat/controlador.ts';
import { mesmaCor, variaveisMarca } from '../chat/cor.ts';
import { AvatarCopiloto, Icone } from '../chat/icones.tsx';
import { Painel } from '../chat/painel.tsx';
import { armazenamento, ehMac } from '../chat/util.ts';
import { lerContextoPagina, observarContextoPagina, paginaTemFormulario } from './pagina.ts';

const CHAVE_ABERTO = 'copiloto_aberto';
const CHAVE_CONECTAR = 'copiloto_conectar';
const CHAVE_PROATIVA = 'copiloto_proativa_mostrada';

const FOCAVEIS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PropsWidgetEmbutido {
  inicio: WidgetInicio;
  api: ClienteApi;
  /** Cor padrão de tokens.css (--brand-600 lida do hospedeiro), para não sobrescrever à toa. */
  corPadrao?: string;
}

function useProativa(inicio: WidgetInicio, api: ClienteApi, ativo: boolean) {
  const { proativa } = inicio.config;
  const [sugestao, setSugestao] = useState<SugestaoProativa | null>(null);
  useEffect(() => {
    if (!proativa.ativa || !ativo) return;
    const guarda = armazenamento('sessao');
    if (guarda.ler(CHAVE_PROATIVA) === '1') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let encerrado = false;
    let pedindo = false;
    const disparar = async () => {
      if (encerrado || pedindo) return;
      if (document.visibilityState === 'hidden' || !paginaTemFormulario()) return;
      pedindo = true;
      try {
        const r = await api.proativa(lerContextoPagina().secao ?? document.title, proativa.segundosParado);
        if (encerrado) return;
        encerrado = true; // pergunta uma vez por página
        if (r?.sugestao && guarda.ler(CHAVE_PROATIVA) !== '1') {
          guarda.gravar(CHAVE_PROATIVA, '1'); // no máximo uma vez por sessão
          setSugestao(r.sugestao);
        }
      } catch {
        encerrado = true;
      } finally {
        pedindo = false;
      }
    };
    const reiniciar = () => {
      if (timer) clearTimeout(timer);
      if (!encerrado) timer = setTimeout(() => void disparar(), proativa.segundosParado * 1000);
    };
    const eventos = ['keydown', 'pointerdown', 'input', 'wheel', 'touchstart'] as const;
    for (const ev of eventos) window.addEventListener(ev, reiniciar, { capture: true, passive: true });
    reiniciar();
    return () => {
      encerrado = true;
      if (timer) clearTimeout(timer);
      for (const ev of eventos) window.removeEventListener(ev, reiniciar, { capture: true });
    };
  }, [ativo, api, proativa.ativa, proativa.segundosParado]);
  return [sugestao, () => setSugestao(null)] as const;
}

export function WidgetEmbutido({ inicio, api, corPadrao }: PropsWidgetEmbutido) {
  const { config } = inicio;
  const guarda = useMemo(() => armazenamento('sessao'), []);
  const [aberto, setAberto] = useState(() => guarda.ler(CHAVE_ABERTO) === '1');
  const [montado, setMontado] = useState(aberto);
  const [contexto, setContexto] = useState<PaginaContexto>(() => lerContextoPagina());
  const [aviso, setAviso] = useState<string | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const [dicaVisivel, setDicaVisivel] = useState(false);
  const abertoRef = useRef(aberto);
  abertoRef.current = aberto;
  const painelRef = useRef<HTMLDivElement>(null);
  const lancadorRef = useRef<HTMLButtonElement>(null);
  const idPainel = useId();

  const aoNovaMensagem = useCallback((m: MensagemWidget) => {
    if (abertoRef.current) return;
    const texto = resumoMensagem(m);
    if (!texto) return;
    setAviso(texto.length > 160 ? `${texto.slice(0, 157)}…` : texto);
    setNaoLidas((n) => n + 1);
  }, []);

  const controlador = useMemo(
    () => new ControladorChat({ api, inicio, obterContexto: lerContextoPagina, aoNovaMensagem }),
    [api, inicio, aoNovaMensagem],
  );
  useEffect(() => () => controlador.destruir(), [controlador]);

  // Conecta ao abrir, ou já na carga quando a pessoa usou o chat nesta sessão (para avisar quando terminar).
  useEffect(() => {
    if (aberto || guarda.ler(CHAVE_CONECTAR) === '1') void controlador.iniciar();
  }, [aberto, controlador, guarda]);

  useEffect(() => observarContextoPagina(setContexto), []);

  const abrir = useCallback(() => {
    setAberto(true);
    setMontado(true);
    setAviso(null);
    setNaoLidas(0);
    guarda.gravar(CHAVE_ABERTO, '1');
  }, [guarda]);

  const fechar = useCallback(() => {
    setAberto(false);
    guarda.remover(CHAVE_ABERTO);
    setTimeout(() => lancadorRef.current?.focus(), 0);
  }, [guarda]);

  const alternar = useCallback(() => (abertoRef.current ? fechar() : abrir()), [abrir, fechar]);

  // Atalho Ctrl+K (Cmd+K no Mac). Não age se o sistema já tratou a tecla.
  useEffect(() => {
    if (!config.atalho) return;
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        alternar();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [config.atalho, alternar]);

  // Esc também fecha quando o foco caiu no corpo da página (com o foco dentro do painel, o próprio painel trata).
  useEffect(() => {
    if (!aberto) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const ativo = document.activeElement;
      if (ativo && ativo !== document.body && ativo !== document.documentElement) return;
      fechar();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [aberto, fechar]);

  const [sugestao, fecharSugestao] = useProativa(inicio, api, !aberto);

  // Cor principal do console (quando diferente da padrão de tokens.css).
  const estiloMarca = useMemo(() => {
    if (!config.cor || (corPadrao && mesmaCor(config.cor, corPadrao))) return undefined;
    return variaveisMarca(config.cor) ?? undefined;
  }, [config.cor, corPadrao]);

  function prenderFoco(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !painelRef.current) return;
    const cont = painelRef.current;
    const lista = Array.from(cont.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
      (el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true',
    );
    if (!lista.length) return;
    const primeiro = lista[0];
    const ultimo = lista[lista.length - 1];
    const raiz = cont.getRootNode() as Document | ShadowRoot;
    const atual = raiz.activeElement;
    if (e.shiftKey && (atual === primeiro || !cont.contains(atual))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (atual === ultimo || !cont.contains(atual))) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  const esquerda = config.posicao === 'esquerda';
  const tecla = ehMac() ? 'Cmd' : 'Ctrl';
  const mostrarDica = config.atalho && !aberto && (dicaVisivel || Boolean(sugestao));

  return (
    <div className={`cp-raiz${esquerda ? ' cp-esquerda' : ''}${aberto ? ' cp-aberto' : ''}`} style={estiloMarca}>
      {montado && (
        <div
          ref={painelRef}
          id={idPainel}
          className="cp-painel"
          role="dialog"
          aria-modal="true"
          aria-label={config.nome}
          hidden={!aberto}
          onKeyDown={prenderFoco}
        >
          <Painel
            controlador={controlador}
            modo="embutido"
            contextoPagina={contexto}
            visivel={aberto}
            aoMinimizar={fechar}
            aoFechar={fechar}
          />
        </div>
      )}

      {!aberto && sugestao && (
        <section className="card cp-flutuante cp-proativa" aria-label="Sugestão do copiloto">
          <div className="row-top cp-gap-10">
            <AvatarCopiloto tamanho="sm" />
            <div className="stack-sm grow cp-gap-4">
              <p className="strong">{sugestao.texto}</p>
              {sugestao.detalhe && <p className="small muted">{sugestao.detalhe}</p>}
            </div>
          </div>
          <div className="row cp-gap-8">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                fecharSugestao();
                abrir();
                if (sugestao.mensagem) controlador.enviar(sugestao.mensagem);
              }}
            >
              Sim, vamos
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={fecharSugestao}>
              Agora não
            </button>
          </div>
        </section>
      )}

      {!aberto && !sugestao && aviso && (
        <section className="card cp-flutuante cp-aviso" aria-label="Mensagem nova do copiloto" role="status">
          <div className="row-top cp-gap-10">
            <AvatarCopiloto tamanho="sm" />
            <p className="small grow">{aviso}</p>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Dispensar aviso" onClick={() => setAviso(null)}>
              <Icone nome="fechar" tamanho="sm" />
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={abrir}>
              Ver no chat
            </button>
          </div>
        </section>
      )}

      <div className="cp-lancador-linha">
        {mostrarDica && (
          <p className="cp-dica-atalho" aria-hidden="true">
            Abrir o copiloto: <span className="kbd">{tecla}</span> + <span className="kbd">K</span>
          </p>
        )}
        <button
          ref={lancadorRef}
          type="button"
          className="launcher cp-lancador"
          aria-label={aberto ? `Fechar ${config.nome}` : `Abrir ${config.nome}${naoLidas ? ` (${naoLidas} ${naoLidas === 1 ? 'mensagem nova' : 'mensagens novas'})` : ''}`}
          aria-expanded={aberto}
          aria-controls={montado ? idPainel : undefined}
          aria-keyshortcuts={config.atalho ? `${tecla === 'Cmd' ? 'Meta' : 'Control'}+K` : undefined}
          onClick={alternar}
          onMouseEnter={() => setDicaVisivel(true)}
          onMouseLeave={() => setDicaVisivel(false)}
          onFocus={() => setDicaVisivel(true)}
          onBlur={() => setDicaVisivel(false)}
        >
          <Icone nome={aberto ? 'fechar' : 'brilho'} tamanho="lg" />
          {naoLidas > 0 && !aberto && <span className="cp-nao-lidas" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

// C8 · Canais e widget: como o copiloto aparece no sistema, com rascunho, publicação,
// pré-visualização ao vivo e o trecho de instalação.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmt, type Canais as DadosCanais, type ConfigWidget, type UsuarioSistema } from '@copiloto/shared';
import { PreviaWidget } from '@copiloto/widget/chat';
import '@copiloto/widget/chat.css';
import { api, ErroApiCliente } from '../../api/cliente.ts';
import { useAcao, useApi } from '../../api/hooks.ts';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import {
  AvisoErro,
  BotaoCopiar,
  ErroAcao,
  EsqueletoTabela,
  Icone,
  Modal,
  useAgora,
  useOnline,
  useToast,
} from '../execucoes/pecas.tsx';

const CHAVE_LOCAL = 'copiloto.console.canais.rascunho';
const LIMITE_BOAS_VINDAS = 280;
const MAX_SUGESTOES = 4;

/** Cores sugeridas: lidas dos tokens da marca (tokens.css), nunca escritas aqui. */
const CORES_SUGERIDAS: { token: string; rotulo: string }[] = [
  { token: '--brand-600', rotulo: 'Rosa da marca' },
  { token: '--brand-btn', rotulo: 'Rosa escuro' },
  { token: '--accent-500', rotulo: 'Vinho' },
  { token: '--success-700', rotulo: 'Verde' },
  { token: '--ink-900', rotulo: 'Grafite' },
];

// ---------- Regras (as mesmas do servidor) ----------

export function normalizarDominio(entrada: string): string {
  let d = entrada.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.split(/[/?#]/)[0] ?? '';
  return d.replace(/\.$/, '');
}

const DOMINIO = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export function dominioValido(d: string): boolean {
  return DOMINIO.test(d);
}

export type ErrosConfig = Partial<Record<'nome' | 'boasVindas' | 'sugestoes' | 'cor' | 'horario' | 'dominios', string>>;

export function validarConfig(c: ConfigWidget): ErrosConfig {
  const e: ErrosConfig = {};
  if (!c.nome.trim()) e.nome = 'Dê um nome ao assistente.';
  else if (c.nome.trim().length > 40) e.nome = 'O nome pode ter até 40 caracteres.';
  if (!c.boasVindas.trim()) e.boasVindas = 'Escreva a mensagem de boas-vindas.';
  else if (c.boasVindas.trim().length > LIMITE_BOAS_VINDAS) e.boasVindas = 'A mensagem de boas-vindas pode ter até 280 caracteres.';
  if (c.sugestoes.length > MAX_SUGESTOES) e.sugestoes = 'Use no máximo 4 sugestões.';
  else if (c.sugestoes.some((s) => s.trim().length > 60)) e.sugestoes = 'Cada sugestão pode ter até 60 caracteres.';
  if (!/^#[0-9a-fA-F]{6}$/.test(c.cor)) e.cor = 'Use a cor no formato #RRGGBB, com 6 letras ou números depois do #.';
  if (c.atendimentoHumano.horario.length > 120) e.horario = 'O horário pode ter até 120 caracteres.';
  const ruim = c.dominios.find((d) => !dominioValido(d));
  if (ruim) e.dominios = `“${ruim}” não parece um domínio. Use, por exemplo, app.suaempresa.com.br.`;
  return e;
}

/** Contraste do texto branco sobre a cor (1 a 21). null se a cor não for válida. */
export function contrasteComBranco(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const [r, g, b] = v.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

const CAMPOS: (keyof ConfigWidget)[] = [
  'nome',
  'boasVindas',
  'sugestoes',
  'cor',
  'posicao',
  'atalho',
  'proativa',
  'atendimentoHumano',
  'dominios',
];

export function mesmaConfig(a: ConfigWidget, b: ConfigWidget): boolean {
  return CAMPOS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/** Como o servidor guarda a configuração (textos sem espaços nas pontas, domínios normalizados). */
export function normalizarConfig(c: ConfigWidget): ConfigWidget {
  const dominios: string[] = [];
  for (const bruto of c.dominios) {
    const d = normalizarDominio(bruto);
    if (d && !dominios.includes(d)) dominios.push(d);
  }
  return {
    ...c,
    nome: c.nome.trim(),
    boasVindas: c.boasVindas.trim(),
    sugestoes: c.sugestoes.map((x) => x.trim()),
    atendimentoHumano: { horario: c.atendimentoHumano.horario.trim() },
    dominios,
  };
}

function lerLocal(): ConfigWidget | null {
  try {
    const t = localStorage.getItem(CHAVE_LOCAL);
    return t ? (JSON.parse(t) as ConfigWidget) : null;
  } catch {
    return null;
  }
}

function gravarLocal(c: ConfigWidget | null) {
  try {
    if (c) localStorage.setItem(CHAVE_LOCAL, JSON.stringify(c));
    else localStorage.removeItem(CHAVE_LOCAL);
  } catch {
    /* sem armazenamento local: segue sem guardar */
  }
}

function mascararChave(chave: string): string {
  if (chave.length <= 12) return chave;
  return `${chave.slice(0, 10)}•••••••${chave.slice(-2)}`;
}

function listaPorExtenso(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

type EstadoSalvar = 'salvo' | 'pendente' | 'salvando' | 'erro' | 'invalido';

// ---------- Página ----------

export default function Canais() {
  const { dados, erro, recarregar, definir } = useApi<DadosCanais>('/canais');
  if (!dados) {
    return (
      <div className="cb-pagina">
        <Cabecalho />
        {erro ? (
          <AvisoErro erro={erro} titulo="Não conseguimos carregar a configuração do widget" aoTentar={() => void recarregar()} />
        ) : (
          <EsqueletoTabela linhas={6} texto="Carregando a configuração do widget" />
        )}
      </div>
    );
  }
  return <EditorCanais servidor={dados} definirServidor={(c) => definir(() => c)} />;
}

function Cabecalho({ children }: { children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="stack-sm">
        <h1 className="h1">Canais e widget</h1>
        <p className="muted body-lg">Onde seus usuários conversam com o copiloto e como ele aparece.</p>
      </div>
      {children}
    </div>
  );
}

function EditorCanais({
  servidor,
  definirServidor,
}: {
  servidor: DadosCanais;
  definirServidor: (c: DadosCanais) => void;
}) {
  const podeEditar = usePode('editar');
  const { resumo } = useSessao();
  const online = useOnline();
  const toast = useToast();

  // Rascunho local: começa no do servidor, ou no que ficou guardado neste navegador sem conexão.
  const [rascunho, setRascunho] = useState<ConfigWidget>(() => {
    const local = podeEditar ? lerLocal() : null;
    return local && !mesmaConfig(normalizarConfig(local), servidor.rascunho) ? local : servidor.rascunho;
  });
  const [estado, setEstado] = useState<EstadoSalvar>('salvo');
  const [erroSalvar, setErroSalvar] = useState<ErroApiCliente | null>(null);
  const [descartando, setDescartando] = useState(false);
  const erros = useMemo(() => validarConfig(rascunho), [rascunho]);
  const valido = Object.keys(erros).length === 0;
  const normalizado = useMemo(() => normalizarConfig(rascunho), [rascunho]);
  const pendente = !mesmaConfig(normalizado, servidor.rascunho);
  const temAlteracoes = !mesmaConfig(normalizado, servidor.publicada);

  // Salva o rascunho no servidor pouco depois da última mudança.
  const emVoo = useRef<Promise<unknown> | null>(null);
  const salvar = useCallback(
    async (c: ConfigWidget): Promise<DadosCanais | null> => {
      setEstado('salvando');
      setErroSalvar(null);
      const p = api.put<DadosCanais>('/canais/rascunho', { config: c });
      emVoo.current = p;
      try {
        const r = await p;
        definirServidor(r);
        gravarLocal(null);
        setEstado('salvo');
        return r;
      } catch (e) {
        const ex = e as ErroApiCliente;
        setErroSalvar(ex);
        setEstado('erro');
        if (ex.offline) gravarLocal(c);
        return null;
      } finally {
        emVoo.current = null;
      }
    },
    [definirServidor],
  );

  useEffect(() => {
    if (!podeEditar || !pendente) return;
    if (!valido) {
      setEstado('invalido');
      return;
    }
    setEstado('pendente');
    if (!online) {
      gravarLocal(rascunho);
      return;
    }
    const id = setTimeout(() => void salvar(rascunho), 800);
    return () => clearTimeout(id);
  }, [rascunho, pendente, valido, online, podeEditar, salvar]);

  // Instalação: enquanto não detectar, confere de novo a cada 30 s.
  useEffect(() => {
    if (servidor.instalacao) return;
    const id = setInterval(async () => {
      try {
        const r = await api.get<DadosCanais>('/canais');
        if (r.instalacao) definirServidor({ ...servidor, instalacao: r.instalacao });
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [servidor, definirServidor]);

  const publicar = useAcao(async () => {
    if (emVoo.current) await emVoo.current.catch(() => undefined);
    // Garante que o que está na tela é o que vai ser publicado.
    const salvo = await api.put<DadosCanais>('/canais/rascunho', { config: rascunho });
    definirServidor(salvo);
    gravarLocal(null);
    return api.post<DadosCanais>('/canais/publicar');
  });
  const descartar = useAcao(() => api.post<DadosCanais>('/canais/descartar'));

  const mudar = (parcial: Partial<ConfigWidget>) => setRascunho((r) => ({ ...r, ...parcial }));

  const usuarios = useApi<UsuarioSistema[]>('/sistema/usuarios');
  const [usuarioPrevia, setUsuarioPrevia] = useState('');
  const nomePrevia =
    usuarios.dados?.find((u) => u.id === usuarioPrevia)?.nome ?? usuarios.dados?.[0]?.nome ?? resumo.eu.nome;

  const publica = {
    nome: rascunho.nome,
    boasVindas: rascunho.boasVindas,
    sugestoes: rascunho.sugestoes,
    cor: rascunho.cor,
    posicao: rascunho.posicao,
    atalho: rascunho.atalho,
    proativa: rascunho.proativa,
    atendimentoHumano: rascunho.atendimentoHumano,
  };
  const textoSalvar =
    !podeEditar || !pendente
      ? null
      : estado === 'salvando'
        ? 'Salvando rascunho…'
        : estado === 'invalido'
          ? 'Corrija os campos destacados para salvar.'
          : estado === 'erro'
            ? erroSalvar?.offline
              ? 'Sem conexão: o rascunho ficou guardado neste navegador.'
              : 'Não foi possível salvar o rascunho.'
            : !online
              ? 'Sem conexão: o rascunho ficou guardado neste navegador.'
              : 'Salvando rascunho…';

  return (
    <div className="cb-pagina">
      <Cabecalho>
        {podeEditar ? (
          <div className="row wrap">
            <span className="small muted" aria-live="polite">
              {textoSalvar ?? (temAlteracoes ? 'Alterações não publicadas' : 'Tudo publicado')}
            </span>
            {temAlteracoes ? (
              <button className="btn btn-ghost" type="button" disabled={!online || descartar.enviando} onClick={() => setDescartando(true)}>
                Descartar
              </button>
            ) : null}
            <button
              className={`btn btn-primary${publicar.enviando ? ' is-loading' : ''}`}
              type="button"
              aria-busy={publicar.enviando}
              disabled={!temAlteracoes || !valido || !online || publicar.enviando}
              onClick={async () => {
                const r = await publicar.executar();
                if (r) {
                  definirServidor(r);
                  setRascunho(r.rascunho);
                  toast.mostrar('Widget publicado. Os usuários já veem a nova versão ao abrir o copiloto.');
                }
              }}
            >
              Publicar alterações
            </button>
          </div>
        ) : null}
      </Cabecalho>

      {podeEditar && temAlteracoes ? (
        <div className="alert alert-warning" role="status">
          <Icone nome="alerta" />
          <div className="stack-sm">
            <p className="strong">Alterações não publicadas</p>
            <p className="small">
              O rascunho fica salvo e a pré-visualização já mostra como vai ficar. Os usuários continuam vendo a versão publicada até você
              publicar.
            </p>
          </div>
        </div>
      ) : null}
      {!podeEditar ? (
        <div className="alert" role="status">
          <Icone nome="cadeado" />
          <p className="small">Seu perfil só permite ver esta configuração. Quem é Admin ou Editor de tarefas pode mudar o widget.</p>
        </div>
      ) : null}
      <ErroAcao erro={publicar.erro ?? (estado === 'erro' && !erroSalvar?.offline ? erroSalvar : null)} />

      <div className="tabs" role="tablist" aria-label="Canais">
        <button className="tab active" type="button" role="tab" aria-selected="true">
          <Icone nome="chat" tamanho="sm" />
          Widget
        </button>
        {[
          { rotulo: 'WhatsApp', icone: 'chat' as const },
          { rotulo: 'E-mail', icone: 'email' as const },
          { rotulo: 'Voz', icone: 'voz' as const },
        ].map((c) => (
          <button
            key={c.rotulo}
            className="tab cb-aba-desligada"
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            title={`${c.rotulo} chega em breve`}
          >
            <Icone nome={c.icone} tamanho="sm" />
            {c.rotulo}
            <span className="badge">Em breve</span>
          </button>
        ))}
      </div>

      <div className="split">
        <div className="main-col stack-lg">
          <Aparencia config={rascunho} erros={erros} mudar={mudar} travado={!podeEditar} />
          <Instalacao
            servidor={servidor}
            config={rascunho}
            erros={erros}
            mudar={mudar}
            travado={!podeEditar}
          />
        </div>

        <aside className="side-col stack-sm cb-previa" aria-label="Pré-visualização do widget">
          <div className="row between wrap">
            <span className="eyebrow">Pré-visualização ao vivo</span>
            {usuarios.dados && usuarios.dados.length > 1 ? (
              <label className="row tiny muted" style={{ gap: 6 }}>
                Como
                <select
                  className="select"
                  style={{ width: 'auto', minHeight: 28, padding: '2px 8px', fontSize: 'var(--fs-12)' }}
                  value={usuarioPrevia || usuarios.dados[0].id}
                  onChange={(e) => setUsuarioPrevia(e.target.value)}
                >
                  {usuarios.dados.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
                veria
              </label>
            ) : (
              <span className="tiny muted">Como {nomePrevia} veria</span>
            )}
          </div>
          <div className="cb-previa-caixa">
            <PreviaWidget config={publica} usuarioNome={nomePrevia} pagina="Clientes" />
          </div>
        </aside>
      </div>

      {descartando ? (
        <Modal
          titulo="Descartar as alterações do widget?"
          aoFechar={() => setDescartando(false)}
          rodape={
            <>
              <button className="btn btn-secondary" type="button" onClick={() => setDescartando(false)}>
                Cancelar
              </button>
              <button
                className={`btn btn-danger${descartar.enviando ? ' is-loading' : ''}`}
                type="button"
                disabled={descartar.enviando}
                onClick={async () => {
                  if (emVoo.current) await emVoo.current.catch(() => undefined);
                  const r = await descartar.executar();
                  if (r) {
                    gravarLocal(null);
                    definirServidor(r);
                    setRascunho(r.rascunho);
                    setDescartando(false);
                    toast.mostrar('Alterações descartadas. O rascunho voltou para a versão publicada.');
                  }
                }}
              >
                Descartar
              </button>
            </>
          }
        >
          <p className="small muted">O rascunho volta a ser igual à versão publicada. O que os usuários veem não muda.</p>
          <ErroAcao erro={descartar.erro} />
        </Modal>
      ) : null}
      {toast.elemento}
    </div>
  );
}

// ---------- Aparência e comportamento ----------

function Aparencia({
  config,
  erros,
  mudar,
  travado,
}: {
  config: ConfigWidget;
  erros: ErrosConfig;
  mudar: (p: Partial<ConfigWidget>) => void;
  travado: boolean;
}) {
  const [novaSugestao, setNovaSugestao] = useState<string | null>(null);
  const [cores, setCores] = useState<{ rotulo: string; valor: string }[]>([]);
  useEffect(() => {
    const estilo = getComputedStyle(document.documentElement);
    const vistos = new Set<string>();
    const lista: { rotulo: string; valor: string }[] = [];
    for (const c of CORES_SUGERIDAS) {
      const v = estilo.getPropertyValue(c.token).trim().toUpperCase();
      if (/^#[0-9A-F]{6}$/.test(v) && !vistos.has(v)) {
        vistos.add(v);
        lista.push({ rotulo: c.rotulo, valor: v });
      }
    }
    setCores(lista);
  }, []);
  const [corDigitada, setCorDigitada] = useState(config.cor);
  useEffect(() => setCorDigitada(config.cor), [config.cor]);
  const contraste = contrasteComBranco(config.cor);
  const adicionar = () => {
    const s = (novaSugestao ?? '').trim();
    if (s && !config.sugestoes.includes(s)) mudar({ sugestoes: [...config.sugestoes, s].slice(0, MAX_SUGESTOES) });
    setNovaSugestao(null);
  };

  return (
    <section className="card" aria-labelledby="t-aparencia">
      <div className="card-head">
        <h2 className="h4" id="t-aparencia">
          Aparência e comportamento
        </h2>
      </div>
      <div className="card-body stack-lg">
        <div className="field">
          <label htmlFor="nome-assistente">Nome do assistente</label>
          <input
            id="nome-assistente"
            className={`input${erros.nome ? ' is-error' : ''}`}
            type="text"
            value={config.nome}
            maxLength={40}
            disabled={travado}
            style={{ maxWidth: 360 }}
            aria-invalid={!!erros.nome}
            onChange={(e) => mudar({ nome: e.target.value })}
          />
          {erros.nome ? <span className="error-text">{erros.nome}</span> : <span className="help">Aparece no topo do chat e nas notificações.</span>}
        </div>

        <div className="field">
          <label htmlFor="boas-vindas">Mensagem de boas-vindas</label>
          <textarea
            id="boas-vindas"
            className={`textarea${erros.boasVindas ? ' is-error' : ''}`}
            value={config.boasVindas}
            disabled={travado}
            aria-invalid={!!erros.boasVindas}
            aria-describedby="boas-vindas-ajuda"
            onChange={(e) => mudar({ boasVindas: e.target.value })}
          />
          <span id="boas-vindas-ajuda" className={erros.boasVindas ? 'error-text' : 'help'}>
            {erros.boasVindas
              ? `${erros.boasVindas} Agora: ${config.boasVindas.trim().length}.`
              : `${config.boasVindas.trim().length} de ${LIMITE_BOAS_VINDAS} caracteres. Diga o que o copiloto faz, não só “Como posso ajudar?”.`}
          </span>
        </div>

        <div className="field">
          <span className="label" id="lbl-sugestoes">
            Sugestões exibidas
          </span>
          <div className="chips" role="group" aria-labelledby="lbl-sugestoes">
            {config.sugestoes.map((s) => (
              <span key={s} className="chip cb-chip-removivel">
                {s}
                {!travado ? (
                  <button
                    className="btn btn-ghost btn-icon btn-sm cb-chip-x"
                    type="button"
                    aria-label={`Remover sugestão ${s}`}
                    onClick={() => mudar({ sugestoes: config.sugestoes.filter((x) => x !== s) })}
                  >
                    <Icone nome="x" tamanho="sm" />
                  </button>
                ) : null}
              </span>
            ))}
            {!travado && novaSugestao === null && config.sugestoes.length < MAX_SUGESTOES ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setNovaSugestao('')}>
                <Icone nome="mais" tamanho="sm" />
                Adicionar sugestão
              </button>
            ) : null}
          </div>
          {novaSugestao !== null ? (
            <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <label className="sr-only" htmlFor="nova-sugestao">
                Nova sugestão
              </label>
              <input
                id="nova-sugestao"
                className="input"
                style={{ maxWidth: 320 }}
                value={novaSugestao}
                maxLength={60}
                autoFocus
                placeholder="Ex.: Agendar visita técnica"
                onChange={(e) => setNovaSugestao(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    adicionar();
                  } else if (e.key === 'Escape') setNovaSugestao(null);
                }}
              />
              <button className="btn btn-secondary btn-sm" type="button" disabled={!novaSugestao.trim()} onClick={adicionar}>
                Adicionar
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setNovaSugestao(null)}>
                Cancelar
              </button>
            </div>
          ) : null}
          {erros.sugestoes ? (
            <span className="error-text">{erros.sugestoes}</span>
          ) : (
            <span className="help">Até 4. Mostre só tarefas ativas e dúvidas comuns.</span>
          )}
        </div>

        <div className="field">
          <span className="label" id="lbl-cor">
            Cor principal
          </span>
          <div className="row wrap" role="group" aria-labelledby="lbl-cor">
            {cores.map((c) => {
              const escolhida = c.valor.toUpperCase() === config.cor.toUpperCase();
              return (
                <button
                  key={c.valor}
                  type="button"
                  className="cb-cor"
                  aria-label={`${c.rotulo}${escolhida ? ', selecionada' : ''}`}
                  aria-pressed={escolhida}
                  disabled={travado}
                  style={{ background: c.valor }}
                  onClick={() => mudar({ cor: c.valor })}
                />
              );
            })}
            {!cores.some((c) => c.valor.toUpperCase() === config.cor.toUpperCase()) && !erros.cor ? (
              <span className="cb-cor-livre" style={{ background: config.cor }} aria-hidden="true" />
            ) : null}
            <label className="sr-only" htmlFor="cor-hex">
              Código da cor
            </label>
            <input
              id="cor-hex"
              className={`input mono${erros.cor ? ' is-error' : ''}`}
              type="text"
              value={corDigitada}
              maxLength={7}
              disabled={travado}
              style={{ width: 120 }}
              aria-invalid={!!erros.cor}
              onChange={(e) => {
                let v = e.target.value.trim();
                if (v && !v.startsWith('#')) v = `#${v}`;
                setCorDigitada(v);
                mudar({ cor: v.toUpperCase() });
              }}
            />
          </div>
          {erros.cor ? (
            <span className="error-text">{erros.cor}</span>
          ) : contraste !== null && contraste < 3 ? (
            <div className="alert alert-warning" role="status">
              <Icone nome="alerta" />
              <p className="small">
                Cor clara demais para texto branco (contraste {contraste.toFixed(1).replace('.', ',')}:1). O widget escurece a cor nos
                botões com texto para ficar legível, então eles vão sair bem diferentes da cor escolhida. Prefira um tom mais forte.
              </p>
            </div>
          ) : contraste !== null && contraste < 4.5 ? (
            <span className="help">
              Contraste com texto branco: {contraste.toFixed(1).replace('.', ',')}:1. Nos botões com texto, o widget usa um tom um
              pouco mais escuro desta cor para ficar legível.
            </span>
          ) : (
            <span className="help">Usa a cor da sua marca por padrão. O contraste do texto é ajustado sozinho.</span>
          )}
        </div>

        <div className="stack-sm">
          <span className="label" id="lbl-pos">
            Posição na tela
          </span>
          <div className="segmented" role="group" aria-labelledby="lbl-pos">
            {(['direita', 'esquerda'] as const).map((p) => (
              <button
                key={p}
                className={config.posicao === p ? 'on' : ''}
                type="button"
                aria-pressed={config.posicao === p}
                disabled={travado}
                onClick={() => mudar({ posicao: p })}
              >
                {p === 'direita' ? 'Direita' : 'Esquerda'}
              </button>
            ))}
          </div>
        </div>

        <hr className="divider" />

        <div className="row-top between wrap" style={{ gap: 'var(--s-4)' }}>
          <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 300px' }}>
            <span className="strong">
              Abrir com atalho <span className="kbd">Ctrl</span> <span className="kbd">K</span>
            </span>
            <span className="help">
              No Mac, <span className="kbd">Cmd</span> <span className="kbd">K</span>. Não substitui atalhos que o sistema já usa.
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.atalho}
              disabled={travado}
              aria-label="Abrir com atalho Ctrl K"
              onChange={(e) => mudar({ atalho: e.target.checked })}
            />
            <span className="small strong">{config.atalho ? 'Ligado' : 'Desligado'}</span>
          </label>
        </div>

        <div className="row-top between wrap" style={{ gap: 'var(--s-4)' }}>
          <div className="stack-sm grow" style={{ gap: 6, flex: '1 1 300px' }}>
            <span className="strong">Sugestão proativa</span>
            <span className="help">
              Mostra uma oferta discreta de ajuda, no máximo uma vez por sessão e nunca sobre o conteúdo da tela.
            </span>
            <div className="card-flat row wrap small" style={{ padding: 'var(--s-2) var(--s-3)', gap: 'var(--s-2)' }}>
              <span className="muted">Regra:</span>
              <span>quando o usuário ficar</span>
              <label className="sr-only" htmlFor="segundos">
                Segundos parado
              </label>
              <select
                id="segundos"
                className="select"
                style={{ width: 'auto', minHeight: 32, padding: '4px 8px' }}
                value={config.proativa.segundosParado}
                disabled={travado || !config.proativa.ativa}
                onChange={(e) =>
                  mudar({ proativa: { ...config.proativa, segundosParado: Number(e.target.value) as 15 | 30 | 60 } })
                }
              >
                <option value={15}>15 s</option>
                <option value={30}>30 s</option>
                <option value={60}>60 s</option>
              </select>
              <span>parado em um formulário</span>
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.proativa.ativa}
              disabled={travado}
              aria-label="Sugestão proativa"
              onChange={(e) => mudar({ proativa: { ...config.proativa, ativa: e.target.checked } })}
            />
            <span className="small strong">{config.proativa.ativa ? 'Ligada' : 'Desligada'}</span>
          </label>
        </div>

        <hr className="divider" />

        <div className="field">
          <label htmlFor="horario-humano">Horário do atendimento humano</label>
          <input
            id="horario-humano"
            className={`input${erros.horario ? ' is-error' : ''}`}
            type="text"
            value={config.atendimentoHumano.horario}
            maxLength={120}
            disabled={travado}
            style={{ maxWidth: 420 }}
            placeholder="segunda a sexta, das 8h às 18h"
            onChange={(e) => mudar({ atendimentoHumano: { horario: e.target.value } })}
          />
          {erros.horario ? (
            <span className="error-text">{erros.horario}</span>
          ) : (
            <span className="help">
              Aparece quando alguém pede para falar com uma pessoa, para saber quando o suporte responde.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- Instalação ----------

function Instalacao({
  servidor,
  config,
  erros,
  mudar,
  travado,
}: {
  servidor: DadosCanais;
  config: ConfigWidget;
  erros: ErrosConfig;
  mudar: (p: Partial<ConfigWidget>) => void;
  travado: boolean;
}) {
  const agora = useAgora(30_000);
  const [novo, setNovo] = useState('');
  const [erroNovo, setErroNovo] = useState<string | null>(null);
  const trecho = (chave: string) =>
    `<script src="${servidor.urlScript}"\n  data-chave="${chave}"\n  data-usuario="ID_DO_USUARIO_LOGADO"\n  data-assinatura="HMAC_DO_ID_DO_USUARIO"\n  async></script>`;
  const adicionar = () => {
    const d = normalizarDominio(novo);
    if (!d) return;
    if (!dominioValido(d)) {
      setErroNovo(`“${novo.trim()}” não parece um domínio. Use, por exemplo, app.suaempresa.com.br.`);
      return;
    }
    setErroNovo(null);
    if (!config.dominios.includes(d)) mudar({ dominios: [...config.dominios, d] });
    setNovo('');
  };
  const publicados = servidor.publicada.dominios;

  return (
    <section className="card" aria-labelledby="t-instal">
      <div className="card-head cb-card-head-wrap">
        <h2 className="h4" id="t-instal">
          Instalação
        </h2>
        {servidor.instalacao ? (
          <span className="badge badge-success cb-selo-quebra" title={fmt.dataHora(servidor.instalacao.vistoEm)}>
            <Icone nome="check" tamanho="sm" />
            Detectado em {servidor.instalacao.origem} {fmt.haQuanto(servidor.instalacao.vistoEm, new Date(agora))}
          </span>
        ) : (
          <span className="badge">
            <Icone nome="relogio" tamanho="sm" />
            Ainda não detectado
          </span>
        )}
      </div>
      <div className="card-body stack">
        <p className="small">
          Cole este trecho antes de <span className="mono">&lt;/body&gt;</span> nas páginas onde o copiloto deve aparecer. Passe o ID do
          usuário logado: é assim que o copiloto age com as permissões de quem pede.
        </p>
        <div style={{ position: 'relative' }}>
          <pre className="mono cb-snippet" aria-label="Trecho de instalação">
            {trecho(mascararChave(servidor.chavePublica))}
          </pre>
          <BotaoCopiar texto={trecho(servidor.chavePublica)} className="btn btn-secondary btn-sm cb-snippet-copiar" />
        </div>
        {!servidor.instalacao ? (
          <p className="tiny muted">
            Depois de instalar, abra uma página do sistema já logado. O selo muda para “Detectado” sozinho, em até 30 segundos.
          </p>
        ) : null}

        <div className="card-flat stack-sm" style={{ padding: 'var(--s-4)' }}>
          <p className="small strong">
            O que é o <span className="mono">data-assinatura</span>
          </p>
          <p className="small">
            Prova que o ID em <span className="mono">data-usuario</span> é mesmo de quem está logado, para ninguém agir como outra pessoa
            trocando o ID no HTML. O seu sistema calcula, no servidor, o HMAC-SHA256 do ID do usuário com o segredo do widget e escreve o
            resultado em hexadecimal (64 caracteres). O segredo é o mesmo da variável <span className="mono">WIDGET_SEGREDO</span> do
            servidor do copiloto.
          </p>
          <p className="small">Nunca calcule a assinatura no navegador nem coloque o segredo na página. Sem assinatura válida, o copiloto não abre.</p>
          <details>
            <summary className="small strong" style={{ cursor: 'pointer' }}>
              Ver exemplos de código
            </summary>
            <div className="stack-sm" style={{ marginTop: 'var(--s-3)' }}>
              <span className="tiny strong">Node.js</span>
              <pre className="mono cb-codigo">{`const crypto = require('node:crypto');
const assinatura = crypto
  .createHmac('sha256', process.env.WIDGET_SEGREDO)
  .update(String(usuario.id))
  .digest('hex');`}</pre>
              <span className="tiny strong">PHP</span>
              <pre className="mono cb-codigo">{`$assinatura = hash_hmac('sha256', (string) $usuario->id, getenv('WIDGET_SEGREDO'));`}</pre>
              <span className="tiny strong">Python</span>
              <pre className="mono cb-codigo">{`import hmac, hashlib, os
assinatura = hmac.new(os.environ["WIDGET_SEGREDO"].encode(),
                      str(usuario.id).encode(), hashlib.sha256).hexdigest()`}</pre>
            </div>
          </details>
        </div>

        <div className="field">
          <span className="label" id="lbl-dominios">
            Domínios liberados
          </span>
          <div className="chips" role="group" aria-labelledby="lbl-dominios">
            {config.dominios.length === 0 ? <span className="small muted">Nenhum domínio liberado: o widget não abre em nenhum site.</span> : null}
            {config.dominios.map((d) => (
              <span key={d} className="chip cb-chip-removivel mono">
                {d}
                {!travado ? (
                  <button
                    className="btn btn-ghost btn-icon btn-sm cb-chip-x"
                    type="button"
                    aria-label={`Remover domínio ${d}`}
                    onClick={() => mudar({ dominios: config.dominios.filter((x) => x !== d) })}
                  >
                    <Icone nome="x" tamanho="sm" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {!travado ? (
            <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <label className="sr-only" htmlFor="novo-dominio">
                Novo domínio
              </label>
              <input
                id="novo-dominio"
                className={`input${erroNovo ? ' is-error' : ''}`}
                style={{ maxWidth: 320 }}
                value={novo}
                placeholder="app.suaempresa.com.br"
                onChange={(e) => {
                  setNovo(e.target.value);
                  setErroNovo(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    adicionar();
                  }
                }}
              />
              <button className="btn btn-secondary btn-sm" type="button" disabled={!novo.trim()} onClick={adicionar}>
                <Icone nome="mais" tamanho="sm" />
                Liberar domínio
              </button>
            </div>
          ) : null}
          {erroNovo || erros.dominios ? (
            <span className="error-text">{erroNovo ?? erros.dominios}</span>
          ) : (
            <span className="help">Só o endereço, sem https:// nem caminho. Inclua a porta quando houver, como localhost:4000.</span>
          )}
        </div>
        <p className="tiny muted">
          {publicados.length
            ? `A chave pública só funciona nos domínios liberados e publicados: ${listaPorExtenso(publicados)}.`
            : 'Nenhum domínio publicado ainda: a chave pública não funciona em nenhum site.'}
        </p>
      </div>
    </section>
  );
}

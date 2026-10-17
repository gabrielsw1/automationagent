// C8 · Canais e widget: como o copiloto aparece no sistema, com rascunho, publicação,
// pré-visualização ao vivo, o trecho de instalação (com os dados assinados de quem está logado),
// o endereço de sessão (sistemas ligados pelas telas) e o segredo do widget (só Admin).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmt, type Canais as DadosCanais, type ConfigWidget, type SegredoWidget, type UsuarioSistema } from '@copiloto/shared';
import { Link } from 'react-router-dom';
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
import { EXEMPLO_ASSINADO, exemplosAssinatura, exemplosSessao, trechoInstalacao } from './instalacao.ts';
import { contrasteComBranco, useCoresSugeridas } from './marca.ts';

export { contrasteComBranco };

/** Rascunho guardado neste navegador sem conexão, um por empresa (a mesma pessoa pode estar em várias). */
const chaveLocal = (empresaId: string) => `copiloto.console.canais.rascunho.${empresaId}`;
const LIMITE_BOAS_VINDAS = 280;
const MAX_SUGESTOES = 4;

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

function lerLocal(empresaId: string): ConfigWidget | null {
  try {
    const t = localStorage.getItem(chaveLocal(empresaId));
    return t ? (JSON.parse(t) as ConfigWidget) : null;
  } catch {
    return null;
  }
}

function gravarLocal(empresaId: string, c: ConfigWidget | null) {
  try {
    if (c) localStorage.setItem(chaveLocal(empresaId), JSON.stringify(c));
    else localStorage.removeItem(chaveLocal(empresaId));
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
  const podeAdministrar = usePode('administrar');
  const { resumo } = useSessao();
  const empresaId = resumo.eu.empresa.id;
  const online = useOnline();
  const toast = useToast();

  // Rascunho local: começa no do servidor, ou no que ficou guardado neste navegador sem conexão.
  const [rascunho, setRascunho] = useState<ConfigWidget>(() => {
    const local = podeEditar ? lerLocal(empresaId) : null;
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
        gravarLocal(empresaId, null);
        setEstado('salvo');
        return r;
      } catch (e) {
        const ex = e as ErroApiCliente;
        setErroSalvar(ex);
        setEstado('erro');
        if (ex.offline) gravarLocal(empresaId, c);
        return null;
      } finally {
        emVoo.current = null;
      }
    },
    [definirServidor, empresaId],
  );

  useEffect(() => {
    if (!podeEditar || !pendente) return;
    if (!valido) {
      setEstado('invalido');
      return;
    }
    setEstado('pendente');
    if (!online) {
      gravarLocal(empresaId, rascunho);
      return;
    }
    const id = setTimeout(() => void salvar(rascunho), 800);
    return () => clearTimeout(id);
  }, [rascunho, pendente, valido, online, podeEditar, salvar, empresaId]);

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
    gravarLocal(empresaId, null);
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
            podeAdministrar={podeAdministrar}
            demo={resumo.eu.empresa.demo}
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
                    gravarLocal(empresaId, null);
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
  const cores = useCoresSugeridas();
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
  podeAdministrar,
  demo,
}: {
  servidor: DadosCanais;
  config: ConfigWidget;
  erros: ErrosConfig;
  mudar: (p: Partial<ConfigWidget>) => void;
  travado: boolean;
  podeAdministrar: boolean;
  /** Empresa de demonstração: o segredo vem do servidor (WIDGET_SEGREDO). */
  demo: boolean;
}) {
  const agora = useAgora(30_000);
  const [novo, setNovo] = useState('');
  const [erroNovo, setErroNovo] = useState<string | null>(null);
  const tela = servidor.conector === 'tela';
  const trecho = (chave: string) => trechoInstalacao(servidor.urlScript, chave, servidor.conector);
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
  const ondeEstaOSegredo = demo
    ? 'O segredo é o mesmo da variável WIDGET_SEGREDO do servidor do copiloto.'
    : podeAdministrar
      ? 'Use o segredo do widget, mais abaixo. Guarde-o numa variável de ambiente do seu sistema, como WIDGET_SEGREDO.'
      : 'Um Admin da sua equipe vê o segredo do widget nesta tela.';

  return (
    <section className="card" aria-labelledby="t-instal" id="instalacao">
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
        {tela ? (
          <p className="small">
            Cole este trecho antes de <span className="mono">&lt;/body&gt;</span> nas páginas onde o copiloto deve aparecer. Preencha com
            os dados de quem está logado: ID, nome, e-mail e perfis de acesso. O copiloto usa os perfis para saber quem pode pedir cada
            tarefa.
          </p>
        ) : (
          <p className="small">
            Cole este trecho antes de <span className="mono">&lt;/body&gt;</span> nas páginas onde o copiloto deve aparecer. Passe o ID do
            usuário logado: é assim que o copiloto age com as permissões de quem pede.
          </p>
        )}
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
          {tela ? (
            <>
              <p className="small">
                Prova que os dados do trecho são mesmo de quem está logado, para ninguém agir como outra pessoa trocando o HTML. O seu
                sistema calcula, no servidor, o HMAC-SHA256 do texto abaixo com o segredo do widget e escreve o resultado em hexadecimal
                (64 caracteres). O texto tem o ID, o nome, o e-mail e os perfis, um por linha, com os perfis separados só por vírgula. Se a
                página não mandar nome, e-mail nem perfis, assine só o ID.
              </p>
              <pre className="mono cb-codigo" aria-label="Exemplo do texto assinado">
                {EXEMPLO_ASSINADO}
              </pre>
            </>
          ) : (
            <p className="small">
              Prova que o ID em <span className="mono">data-usuario</span> é mesmo de quem está logado, para ninguém agir como outra pessoa
              trocando o ID no HTML. O seu sistema calcula, no servidor, o HMAC-SHA256 do ID do usuário com o segredo do widget e escreve o
              resultado em hexadecimal (64 caracteres).
            </p>
          )}
          <p className="small">
            {ondeEstaOSegredo} Nunca calcule a assinatura no navegador nem coloque o segredo na página. Sem assinatura válida, o copiloto
            não abre.
          </p>
          <ExemplosCodigo exemplos={exemplosAssinatura(servidor.conector)} />
        </div>

        {tela ? <EnderecoDeSessao /> : null}
        {podeAdministrar ? <SegredoDoWidget demo={demo} /> : null}

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

function ExemplosCodigo({ exemplos, rotulo = 'Ver exemplos de código' }: { exemplos: { linguagem: string; codigo: string }[]; rotulo?: string }) {
  return (
    <details>
      <summary className="small strong" style={{ cursor: 'pointer' }}>
        {rotulo}
      </summary>
      <div className="stack-sm" style={{ marginTop: 'var(--s-3)' }}>
        {exemplos.map((e) => (
          <div key={e.linguagem} className="stack-sm">
            <span className="tiny strong">{e.linguagem}</span>
            <pre className="mono cb-codigo">{e.codigo}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Endereço de sessão (sistemas ligados pelas telas) ----------

const PEDIDO_SESSAO = `POST https://erp.suaempresa.com.br/copiloto/sessao
Content-Type: application/json
X-Copiloto-Assinatura: <HMAC-SHA256 em hexadecimal de "101.1760700000000">

{"usuario":"101","ts":1760700000000}`;

function EnderecoDeSessao() {
  return (
    <div className="card-flat stack-sm" style={{ padding: 'var(--s-4)' }}>
      <p className="small strong">Endereço de sessão: para o copiloto entrar com a sessão de quem pede</p>
      <p className="small">
        Quando o copiloto entra no sistema com a sessão de quem pediu (escolha em <Link to="/sistema">Sistema</Link>), ele chama o
        endereço de sessão do seu sistema antes de cada tarefa. Manda o ID da pessoa e a hora em milissegundos (
        <span className="mono">ts</span>), assinados com o segredo do widget:
      </p>
      <pre className="mono cb-codigo" aria-label="Pedido de sessão">
        {PEDIDO_SESSAO}
      </pre>
      <p className="small">
        A assinatura é o HMAC-SHA256 de <span className="mono">usuario.ts</span> (o ID, um ponto e a hora). O seu sistema confere a
        assinatura e se a hora é de no máximo 5 minutos atrás. Se estiver tudo certo, responde com os cookies da sessão dessa pessoa:
      </p>
      <pre className="mono cb-codigo" aria-label="Resposta com cookies">{`{"cookies":[{"name":"sessao","value":"..."}]}`}</pre>
      <p className="small">ou com um link de entrada única, que já abre o sistema logado:</p>
      <pre className="mono cb-codigo" aria-label="Resposta com link">{`{"url":"https://erp.suaempresa.com.br/entrada-unica?token=..."}`}</pre>
      <p className="small">Se a assinatura não conferir, responda com o status 401. O copiloto avisa a pessoa e não faz nada no sistema.</p>
      <ExemplosCodigo exemplos={exemplosSessao()} rotulo="Ver exemplos do endereço de sessão" />
    </div>
  );
}

// ---------- Segredo do widget (só Admin) ----------

function SegredoDoWidget({ demo }: { demo: boolean }) {
  const toast = useToast();
  const [segredo, setSegredo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const mostrar = useAcao(() => api.get<SegredoWidget>('/canais/segredo'));
  const gerar = useAcao(() => api.post<SegredoWidget>('/canais/segredo/novo'));
  // 409 segredo_do_ambiente: esta empresa usa o segredo do servidor (como a demonstração).
  const doAmbiente = [mostrar.erro, gerar.erro].find((e) => e?.erro === 'segredo_do_ambiente')?.message ?? null;

  if (demo || doAmbiente) {
    return (
      <div className="card-flat stack-sm" style={{ padding: 'var(--s-4)' }}>
        <p className="small strong">Segredo do widget</p>
        <p className="small">
          {doAmbiente ??
            'Na demonstração, o segredo vem da variável WIDGET_SEGREDO do servidor do copiloto, a mesma que o Horizonte usa. Por isso ele não aparece aqui e não dá para gerar outro.'}
        </p>
        <p className="tiny muted">Cada empresa criada no copiloto ganha um segredo próprio, que o Admin vê e troca nesta tela.</p>
      </div>
    );
  }

  return (
    <div className="card-flat stack-sm" style={{ padding: 'var(--s-4)' }}>
      <p className="small strong">Segredo do widget</p>
      <p className="small">
        Assina quem está logado no trecho e os pedidos de sessão. Fica só no servidor do seu sistema: nunca no navegador nem no código da página. Só Admin vê.
      </p>
      {segredo ? (
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <label className="sr-only" htmlFor="segredo-widget">
            Segredo do widget
          </label>
          <input id="segredo-widget" className="input mono" readOnly value={segredo} style={{ flex: '1 1 280px' }} onFocus={(e) => e.target.select()} />
          <BotaoCopiar texto={segredo} />
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSegredo(null)}>
            Esconder
          </button>
        </div>
      ) : null}
      <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
        {!segredo ? (
          <button
            className={`btn btn-secondary btn-sm${mostrar.enviando ? ' is-loading' : ''}`}
            type="button"
            disabled={mostrar.enviando}
            onClick={async () => {
              const r = await mostrar.executar();
              if (r) setSegredo(r.segredo);
            }}
          >
            <Icone nome="cadeado" tamanho="sm" />
            Mostrar segredo
          </button>
        ) : null}
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => {
            gerar.limparErro();
            setConfirmando(true);
          }}
        >
          <Icone nome="reexecutar" tamanho="sm" />
          Gerar novo segredo
        </button>
      </div>
      <ErroAcao erro={mostrar.erro} />

      {confirmando ? (
        <Modal
          titulo="Gerar um segredo novo?"
          aoFechar={() => setConfirmando(false)}
          rodape={
            <>
              <button className="btn btn-secondary" type="button" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
              <button
                className={`btn btn-danger${gerar.enviando ? ' is-loading' : ''}`}
                type="button"
                disabled={gerar.enviando}
                onClick={async () => {
                  const r = await gerar.executar();
                  if (r) {
                    setSegredo(r.segredo);
                    setConfirmando(false);
                    toast.mostrar('Segredo novo gerado. Atualize o seu sistema para assinar com ele.');
                  }
                }}
              >
                Gerar segredo novo
              </button>
            </>
          }
        >
          <p className="small muted">
            O segredo atual para de valer na hora. Até o seu sistema assinar com o novo, o assistente não abre para ninguém e o copiloto não
            consegue pedir sessões. Combine com o time técnico antes.
          </p>
          <ErroAcao erro={gerar.erro} />
        </Modal>
      ) : null}
      {toast.elemento}
    </div>
  );
}

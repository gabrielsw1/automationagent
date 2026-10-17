// Sistema da empresa: onde o copiloto trabalha (nome e endereço, com "Verificar endereço"), como ele
// entra lá (sessão de quem pede, conta de serviço ou sem login, com "Testar acesso") e os perfis de
// acesso do sistema, usados em "Quem pode executar". Só Admin muda; os outros perfis veem.
// Na demonstração o sistema é o Horizonte, pela API, configurado no servidor: a tela só mostra.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SistemaEmpresa, SistemaEmpresaPedido, UsuarioSistema, VerificacaoSistema } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useAcao, useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, CabecalhoPagina, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useOnline } from '../../componentes/pagina.tsx';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { EscolhaAcesso, pedidoAcesso, ResultadoVerificacao, ROTULO_MODO, validarAcesso, type ErrosAcesso, type FormAcesso } from './Acesso.tsx';
import { completarEndereco, enderecoValido, hostDe } from './endereco.ts';
import './sistema.css';

interface FormSistema {
  nome: string;
  url: string;
  acesso: FormAcesso;
  perfis: string[];
}

const MAX_PERFIS = 50;

function formDe(s: SistemaEmpresa): FormSistema {
  return {
    nome: s.nome,
    url: s.url,
    acesso: { modo: s.acesso.modo, urlSessao: s.acesso.urlSessao, urlLogin: s.acesso.urlLogin, usuario: s.acesso.usuario, senha: '' },
    perfis: s.perfis,
  };
}

/** O que muda no servidor ao salvar (a senha só conta quando foi digitada). */
function chaveDe(f: FormSistema): string {
  const a = pedidoAcesso(f.acesso);
  return JSON.stringify([f.nome.trim(), f.url.trim(), a, f.perfis]);
}

/** Erro ao adicionar um perfil, ou null quando ele pode entrar na lista. */
export function erroPerfil(perfil: string, lista: string[]): string | null {
  const p = perfil.trim();
  if (!p) return 'Digite o nome do perfil.';
  if (/[,\n]/.test(p)) return 'Um perfil por vez, sem vírgula.';
  if (p.length > 50) return 'Cada perfil pode ter até 50 caracteres.';
  if (lista.some((x) => x.toLocaleLowerCase('pt-BR') === p.toLocaleLowerCase('pt-BR'))) return 'Esse perfil já está na lista.';
  if (lista.length >= MAX_PERFIS) return `Use no máximo ${MAX_PERFIS} perfis.`;
  return null;
}

export default function Sistema() {
  const config = useApi<SistemaEmpresa>('/sistema/config');
  const s = config.dados;
  return (
    <div className="stack-lg">
      <CabecalhoPagina titulo="Sistema" subtitulo="Onde o copiloto trabalha, como ele entra lá e quais perfis de acesso o sistema tem." />
      {!s ? (
        config.erro ? (
          <EstadoErro erro={config.erro} aoTentar={() => void config.recarregar()} titulo="Não conseguimos abrir os dados do sistema" />
        ) : (
          <Carregando forma="ficha" texto="Abrindo os dados do sistema…" />
        )
      ) : s.editavel ? (
        <FormularioSistema sistema={s} aoSalvar={(novo) => config.definir(() => novo)} />
      ) : (
        <SistemaFixo sistema={s} />
      )}
    </div>
  );
}

// ---------- Demonstração (API do Horizonte, configurada no servidor) ----------

function SistemaFixo({ sistema: s }: { sistema: SistemaEmpresa }) {
  const perfis = useApi<string[]>(s.conector === 'api' ? '/sistema/perfis' : null);
  const lista = s.conector === 'api' ? (perfis.dados ?? []) : s.perfis;
  return (
    <>
      <Aviso tipo="info" titulo={`Na demonstração, o sistema é o ${s.nome}`}>
        Ele está configurado no servidor do copiloto e o copiloto fala com ele pela API. Por isso esta tela só mostra os dados.
        Para ligar o copiloto ao sistema da sua empresa, <Link to="/criar-conta">crie a conta da sua empresa</Link>.
      </Aviso>
      <section className="card" aria-labelledby="cs-fixo">
        <div className="card-head">
          <h2 className="h3" id="cs-fixo">
            {s.nome}
          </h2>
          <span className="badge badge-accent">Demonstração</span>
        </div>
        <div className="card-body stack">
          <dl className="grid-2" style={{ margin: 0 }}>
            <div className="stack-sm" style={{ gap: 2 }}>
              <dt className="small muted">Endereço</dt>
              <dd className="mono small" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                {s.url || 'Não informado'}
              </dd>
            </div>
            <div className="stack-sm" style={{ gap: 2 }}>
              <dt className="small muted">Como o copiloto fala com ele</dt>
              <dd className="small" style={{ margin: 0 }}>
                {s.conector === 'api' ? 'Pela API do sistema' : `Pelas telas · ${ROTULO_MODO[s.acesso.modo]}`}
              </dd>
            </div>
          </dl>
          <div className="stack-sm">
            <span className="small muted" id="cs-perfis-fixos">
              Perfis do sistema
            </span>
            {perfis.erro ? (
              <span className="small muted">Não conseguimos buscar os perfis agora.</span>
            ) : s.conector === 'api' && !perfis.dados ? (
              <span className="small muted">Buscando os perfis…</span>
            ) : lista.length ? (
              <ul className="row wrap" aria-labelledby="cs-perfis-fixos" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--s-2)' }}>
                {lista.map((p) => (
                  <li key={p} className="badge">
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="small muted">Nenhum perfil ainda.</span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

// ---------- Formulário (empresas com o sistema pelas telas) ----------

function FormularioSistema({ sistema: s, aoSalvar }: { sistema: SistemaEmpresa; aoSalvar: (s: SistemaEmpresa) => void }) {
  const { recarregarResumo } = useSessao();
  const podeAdministrar = usePode('administrar');
  const travado = !podeAdministrar;
  const online = useOnline();
  const toast = useToast();
  const [form, setForm] = useState<FormSistema>(() => formDe(s));
  const [tocados, setTocados] = useState<Partial<Record<'nome' | 'url' | keyof ErrosAcesso, boolean>>>({});
  const [verificacao, setVerificacao] = useState<(VerificacaoSistema & { url: string }) | null>(null);
  const [teste, setTeste] = useState<VerificacaoSistema | null>(null);
  const [testarComo, setTestarComo] = useState('');
  const [perfilNovo, setPerfilNovo] = useState('');
  const [erroNovo, setErroNovo] = useState<string | null>(null);

  const verificar = useAcao((url: string) => api.post<VerificacaoSistema>('/sistema/verificar', { url }));
  const testar = useAcao((usuarioId: string) =>
    api.post<VerificacaoSistema>('/sistema/testar-acesso', usuarioId ? { usuarioId } : {}),
  );
  const salvar = useAcao((corpo: SistemaEmpresaPedido) => api.put<SistemaEmpresa>('/sistema/config', corpo));

  const salvoModo = s.acesso.modo;
  const usuarios = useApi<UsuarioSistema[]>(podeAdministrar && salvoModo === 'sessao' ? '/sistema/usuarios' : null);

  const sujo = chaveDe(form) !== chaveDe(formDe(s));
  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [sujo]);

  const nome = form.nome.trim();
  const erroNome = nome.length < 2 ? 'Diga como a equipe chama o sistema.' : nome.length > 60 ? 'O nome do sistema pode ter até 60 caracteres.' : null;
  const erroUrl = !enderecoValido(form.url) ? 'Use o endereço completo do sistema, começando com https://' : null;
  const errosAcesso = validarAcesso(form.acesso, form.url, s.acesso.temSenha);
  const temErro = !!erroNome || !!erroUrl || Object.keys(errosAcesso).length > 0;
  const visivel = <K extends keyof typeof tocados>(k: K, erro: string | null | undefined) => (tocados[k] ? (erro ?? null) : null);
  const errosAcessoVisiveis = Object.fromEntries(
    Object.entries(errosAcesso).filter(([k]) => tocados[k as keyof ErrosAcesso]),
  ) as ErrosAcesso;

  const mudar = (p: Partial<FormSistema>) => setForm((f) => ({ ...f, ...p }));

  const adicionarPerfil = () => {
    const erro = erroPerfil(perfilNovo, form.perfis);
    setErroNovo(erro);
    if (erro) return;
    mudar({ perfis: [...form.perfis, perfilNovo.trim()] });
    setPerfilNovo('');
  };

  const enviar = async () => {
    setTocados({ nome: true, url: true, urlSessao: true, urlLogin: true, usuario: true, senha: true });
    if (temErro) return;
    const r = await salvar.executar({ nome, url: form.url.trim(), acesso: pedidoAcesso(form.acesso), perfis: form.perfis });
    if (!r) return;
    aoSalvar(r);
    setForm(formDe(r));
    setTocados({});
    setTeste(null);
    toast.sucesso('Sistema salvo. O copiloto já usa a configuração nova.');
    void recarregarResumo();
  };

  const urlAtual = form.url.trim();
  return (
    <>
      {travado ? (
        <Aviso tipo="info" titulo="Só quem tem perfil Admin muda o sistema">
          Você pode ver como o copiloto entra no sistema. Para mudar, peça a um Admin da sua equipe.
        </Aviso>
      ) : null}

      <section className="card" aria-labelledby="cs-onde">
        <div className="card-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h3" id="cs-onde">
              Onde o copiloto trabalha
            </h2>
            <p className="small muted">O widget é instalado neste endereço, e o navegador do copiloto entra nele para fazer as tarefas.</p>
          </div>
        </div>
        <div className="card-body stack">
          <Campo
            rotulo="Como a equipe chama o sistema"
            obrigatorio
            erro={visivel('nome', erroNome)}
            ajuda="Aparece no console e nas mensagens do assistente. Ex.: ERP, Portal do cliente."
          >
            {(p) => (
              <input
                {...p}
                value={form.nome}
                maxLength={60}
                disabled={travado}
                onChange={(e) => mudar({ nome: e.target.value })}
                onBlur={() => setTocados((t) => ({ ...t, nome: true }))}
              />
            )}
          </Campo>
          <div className="field">
            <label htmlFor="cs-endereco">
              Endereço do sistema{' '}
              <span className="req" aria-hidden="true">
                *
              </span>
            </label>
            <div className="input-group">
              <input
                id="cs-endereco"
                className={`input mono${visivel('url', erroUrl) ? ' is-error' : ''}`}
                type="url"
                inputMode="url"
                value={form.url}
                disabled={travado}
                aria-required
                aria-invalid={visivel('url', erroUrl) ? true : undefined}
                aria-describedby="cs-endereco-ajuda"
                placeholder="https://erp.suaempresa.com.br"
                onChange={(e) => mudar({ url: e.target.value })}
                onBlur={() => {
                  mudar({ url: completarEndereco(form.url) });
                  setTocados((t) => ({ ...t, url: true }));
                }}
              />
              {podeAdministrar ? (
                <Botao
                  icone="atualizar"
                  carregando={verificar.enviando}
                  disabled={!!erroUrl || !online}
                  onClick={async () => {
                    const r = await verificar.executar(urlAtual);
                    if (r) setVerificacao({ ...r, url: urlAtual });
                  }}
                >
                  Verificar endereço
                </Botao>
              ) : null}
            </div>
            {visivel('url', erroUrl) ? (
              <span className="error-text">
                <Icone nome="alerta" tamanho="sm" />
                {erroUrl}
              </span>
            ) : null}
            <span id="cs-endereco-ajuda" className="help">
              A página que as pessoas abrem para entrar no sistema. Ao mudar de domínio, o widget passa a ser liberado no novo.
            </span>
            {verificar.erro ? (
              <span className="error-text" role="alert">
                <Icone nome="alerta" tamanho="sm" />
                {verificar.erro.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : verificar.erro.message}
              </span>
            ) : null}
            {verificacao && verificacao.url === urlAtual ? (
              <ResultadoVerificacao
                ok={verificacao.ok}
                titulo={verificacao.ok ? `Encontramos ${hostDe(verificacao.url)}` : `Não conseguimos abrir ${hostDe(verificacao.url)}`}
                detalhe={verificacao.detalhe}
              />
            ) : null}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="cs-acesso">
        <div className="card-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h3" id="cs-acesso">
              Como o copiloto entra no sistema
            </h2>
            <p className="small muted">Em nenhuma das opções a senha passa pela IA.</p>
          </div>
        </div>
        <div className="card-body stack-lg">
          <fieldset className="cs-fieldset">
            <legend className="sr-only">Como o copiloto entra no sistema</legend>
            <EscolhaAcesso
              modos={['sessao', 'conta', 'nenhum']}
              valor={form.acesso}
              mudar={(p) => setForm((f) => ({ ...f, acesso: { ...f.acesso, ...p } }))}
              erros={errosAcessoVisiveis}
              aoSair={(c) => setTocados((t) => ({ ...t, [c]: true }))}
              temSenha={s.acesso.temSenha}
              travado={travado}
              ajudaSessao={
                <>
                  O copiloto pede aqui a sessão de quem fez o pedido. Veja como o seu sistema responde em{' '}
                  <Link to="/canais#instalacao">Canais e widget</Link>.
                </>
              }
            />
          </fieldset>

          {podeAdministrar ? (
            <TestarAcesso
              sujo={sujo}
              modo={salvoModo}
              usuarios={usuarios.dados ?? []}
              testarComo={testarComo}
              aoTrocarUsuario={setTestarComo}
              testando={testar.enviando}
              erro={testar.erro}
              resultado={teste}
              online={online}
              aoTestar={async () => {
                setTeste(null);
                const r = await testar.executar(testarComo);
                if (r) setTeste(r);
              }}
            />
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="cs-perfis">
        <div className="card-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h3" id="cs-perfis">
              Perfis do sistema
            </h2>
            <p className="small muted">
              Os perfis de acesso do seu sistema, como Comercial ou Financeiro. Servem para escolher quem pode pedir cada tarefa. Os perfis
              que chegam pelo widget entram sozinhos.
            </p>
          </div>
        </div>
        <div className="card-body stack">
          {form.perfis.length ? (
            <ul className="row wrap" aria-label="Perfis cadastrados" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--s-2)' }}>
              {form.perfis.map((p) => (
                <li key={p} className="badge cs-chip">
                  {p}
                  {travado ? null : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon cs-chip-x"
                      aria-label={`Tirar o perfil ${p}`}
                      onClick={() => mudar({ perfis: form.perfis.filter((x) => x !== p) })}
                    >
                      <Icone nome="fechar" tamanho="sm" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nenhum perfil ainda. Sem perfis, toda tarefa vale para qualquer pessoa logada no sistema.</p>
          )}
          {travado ? null : (
            <div className="field" style={{ maxWidth: 480 }}>
              <label htmlFor="cs-perfil-novo">Adicionar perfil</label>
              <div className="input-group">
                <input
                  id="cs-perfil-novo"
                  className={`input${erroNovo ? ' is-error' : ''}`}
                  value={perfilNovo}
                  maxLength={60}
                  aria-invalid={erroNovo ? true : undefined}
                  aria-describedby={erroNovo ? 'cs-perfil-erro' : undefined}
                  placeholder="Ex.: Financeiro"
                  onChange={(e) => {
                    setPerfilNovo(e.target.value);
                    setErroNovo(null);
                  }}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    adicionarPerfil();
                  }}
                />
                <Botao icone="mais" onClick={adicionarPerfil}>
                  Adicionar
                </Botao>
              </div>
              {erroNovo ? (
                <span className="error-text" id="cs-perfil-erro" role="alert">
                  <Icone nome="alerta" tamanho="sm" />
                  {erroNovo}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {podeAdministrar ? (
        <div className="stack-sm">
          {salvar.erro ? <ErroSalvar erro={salvar.erro} /> : null}
          {temErro && Object.keys(tocados).length ? (
            <p className="small text-danger" role="alert">
              Confira os campos marcados antes de salvar.
            </p>
          ) : null}
          <div className="row wrap cs-acoes">
            {sujo ? <span className="small muted">Você tem mudanças que ainda não foram salvas.</span> : null}
            <Botao
              variante="fantasma"
              disabled={!sujo || salvar.enviando}
              onClick={() => {
                setForm(formDe(s));
                setTocados({});
                salvar.limparErro();
              }}
            >
              Descartar mudanças
            </Botao>
            <Botao variante="primario" carregando={salvar.enviando} disabled={!sujo || !online} onClick={() => void enviar()}>
              Salvar sistema
            </Botao>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ErroSalvar({ erro }: { erro: ErroApiCliente }) {
  return (
    <Aviso tipo="erro" papel="alert" titulo="Não conseguimos salvar">
      {erro.offline ? 'Sem conexão. Nada foi perdido: tente de novo quando a internet voltar.' : erro.message}
    </Aviso>
  );
}

function TestarAcesso({
  sujo,
  modo,
  usuarios,
  testarComo,
  aoTrocarUsuario,
  testando,
  erro,
  resultado,
  online,
  aoTestar,
}: {
  sujo: boolean;
  /** Modo salvo: o teste usa a configuração salva. */
  modo: FormAcesso['modo'];
  usuarios: UsuarioSistema[];
  testarComo: string;
  aoTrocarUsuario: (id: string) => void;
  testando: boolean;
  erro: ErroApiCliente | null;
  resultado: VerificacaoSistema | null;
  online: boolean;
  aoTestar: () => void;
}) {
  return (
    <div className="card-flat stack" style={{ padding: 'var(--s-4) var(--s-5)' }}>
      <div className="stack-sm" style={{ gap: 2 }}>
        <h3 className="h4">Testar acesso</h3>
        <p className="small muted">
          O copiloto abre o navegador dele e entra no sistema como antes de uma tarefa, sem mudar nada lá. Usa o que está salvo.
        </p>
      </div>
      {modo === 'sessao' ? (
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="cs-testar-como">Testar com a sessão de</label>
          <select
            id="cs-testar-como"
            className="select"
            value={testarComo}
            disabled={testando}
            onChange={(e) => aoTrocarUsuario(e.target.value)}
          >
            <option value="">Quem usou o assistente por último</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
                {u.email ? ` (${u.email})` : ''}
              </option>
            ))}
          </select>
          <span className="help">A lista mostra quem já usou o assistente no seu sistema.</span>
        </div>
      ) : null}
      <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
        <Botao icone="play" carregando={testando} disabled={sujo || !online} onClick={aoTestar}>
          Testar acesso
        </Botao>
        {sujo ? (
          <span className="small muted">Salve as mudanças antes de testar: o teste usa o que está salvo.</span>
        ) : testando ? (
          <span className="small muted" role="status">
            Abrindo o navegador do copiloto e entrando no sistema. Pode levar até 30 segundos.
          </span>
        ) : null}
      </div>
      {erro ? (
        <span className="error-text" role="alert">
          <Icone nome="alerta" tamanho="sm" />
          {erro.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : erro.message}
        </span>
      ) : null}
      {resultado ? (
        <ResultadoVerificacao
          ok={resultado.ok}
          titulo={resultado.ok ? 'O copiloto entrou no sistema' : 'O copiloto não conseguiu entrar'}
          detalhe={resultado.detalhe}
        />
      ) : null}
    </div>
  );
}

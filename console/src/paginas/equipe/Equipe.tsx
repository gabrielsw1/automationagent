// C9 · Equipe e limites: quem administra o copiloto, quanto ele pode gastar, como os dados são
// protegidos e o registro de auditoria. Só Admin muda; os outros perfis veem.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  fmt,
  ROTULO_PERFIL,
  type Limites,
  type MembroEquipe,
  type PerfilEquipe,
  type RegistroAuditoria,
  type Seguranca,
} from '@copiloto/shared';
import { api } from '../../api/cliente.ts';
import { useAcao, useApi } from '../../api/hooks.ts';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import {
  AvisoErro,
  BotaoCopiar,
  ErroAcao,
  EsqueletoTabela,
  FaixaOffline,
  Icone,
  Modal,
  useOnline,
  useToast,
} from '../execucoes/pecas.tsx';

const PERFIS: PerfilEquipe[] = ['admin', 'editor', 'suporte', 'leitor'];

export const DESCRICAO_PERFIL: Record<PerfilEquipe, string> = {
  admin: 'Tudo, inclusive equipe, limites de gasto e segurança.',
  editor: 'Cria, testa e publica tarefas, fluxos e conhecimento.',
  suporte: 'Vê execuções, reexecuta e conclui casos transferidos.',
  leitor: 'Só vê painel e execuções. Não muda nada.',
};

/** "1.500,00", "1500", "1500.5" → número. null quando não dá para ler. */
export function lerMoeda(texto: string): number | null {
  let t = texto.replace(/R\$/g, '').replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function escreverMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nomeDe(m: MembroEquipe): string {
  return m.nome ?? m.email;
}

function ultimoAcesso(iso: string | null, agora = new Date()): string {
  if (!iso) return 'Nunca';
  if (agora.getTime() - Date.parse(iso) < 5 * 60_000) return 'Agora';
  return fmt.quando(iso, agora);
}

function listaPorExtenso(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

export default function Equipe() {
  const location = useLocation();
  const podeAdministrar = usePode('administrar');
  const equipe = useApi<MembroEquipe[]>('/equipe');
  const toast = useToast();

  useEffect(() => {
    if (location.hash !== '#auditoria' || !equipe.dados) return;
    const id = setTimeout(() => document.getElementById('auditoria')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50);
    return () => clearTimeout(id);
  }, [location.hash, equipe.dados]);

  const admins = (equipe.dados ?? []).filter((m) => m.perfil === 'admin' && m.status === 'ativo');

  return (
    <div className="cb-pagina">
      <FaixaOffline />
      <div className="page-head">
        <div className="stack-sm">
          <h1 className="h1">Equipe e limites</h1>
          <p className="muted body-lg">Quem administra o copiloto, quanto ele pode gastar e como os dados são protegidos.</p>
        </div>
      </div>

      <SecaoEquipe estado={equipe} podeAdministrar={podeAdministrar} aoAviso={toast.mostrar} />
      <SecaoLimites podeAdministrar={podeAdministrar} admins={admins} aoAviso={toast.mostrar} />
      <SecaoSeguranca podeAdministrar={podeAdministrar} aoAviso={toast.mostrar} />
      <SecaoAuditoria podeAdministrar={podeAdministrar} admins={admins} />
      {toast.elemento}
    </div>
  );
}

// ---------- Equipe ----------

type Dialogo =
  | null
  | { tipo: 'convidar' }
  | { tipo: 'link'; membro: MembroEquipe; link: string; reenviado: boolean }
  | { tipo: 'remover'; membro: MembroEquipe }
  | { tipo: 'cancelar'; membro: MembroEquipe }
  | { tipo: 'rebaixar-si'; membro: MembroEquipe; perfil: PerfilEquipe };

function SecaoEquipe({
  estado,
  podeAdministrar,
  aoAviso,
}: {
  estado: ReturnType<typeof useApi<MembroEquipe[]>>;
  podeAdministrar: boolean;
  aoAviso: (t: string) => void;
}) {
  const { resumo, recarregarResumo } = useSessao();
  const online = useOnline();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  // Linha da última troca de perfil ou reenvio, para mostrar o erro ao lado dela.
  const [linhaAcao, setLinhaAcao] = useState<string | null>(null);
  const reenviar = useAcao((id: string) => api.post<{ membro: MembroEquipe; linkConvite: string }>(`/equipe/${id}/reenviar`));
  const trocar = useAcao((id: string, perfil: PerfilEquipe) => api.put<MembroEquipe>(`/equipe/${id}/perfil`, { perfil }));
  // Como no design: você primeiro, depois a ordem do servidor (ativos por perfil, convites no fim).
  const membros = [...(estado.dados ?? [])].sort((a, b) => Number(b.id === resumo.eu.id) - Number(a.id === resumo.eu.id));
  const adminsAtivos = membros.filter((m) => m.perfil === 'admin' && m.status === 'ativo').length;
  const agora = new Date();

  const mudarPerfil = async (m: MembroEquipe, perfil: PerfilEquipe) => {
    setLinhaAcao(m.id);
    reenviar.limparErro();
    const r = await trocar.executar(m.id, perfil);
    if (r) {
      estado.definir((lista) => lista?.map((x) => (x.id === r.id ? r : x)));
      aoAviso(`Perfil de ${nomeDe(m)} mudou para ${ROTULO_PERFIL[perfil]}.`);
      if (m.id === resumo.eu.id) await recarregarResumo();
    } else {
      void estado.recarregar();
    }
  };

  return (
    <section className="stack" aria-labelledby="t-equipe">
      <div className="row between wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h3" id="t-equipe">
            Equipe
          </h2>
          <p className="small muted">Pessoas que acessam este console. Os usuários do widget não aparecem aqui.</p>
        </div>
        {podeAdministrar ? (
          <button className="btn btn-primary" type="button" disabled={!online} onClick={() => setDialogo({ tipo: 'convidar' })}>
            <Icone nome="mais" />
            Convidar pessoa
          </button>
        ) : null}
      </div>

      {!estado.dados ? (
        estado.erro ? (
          <AvisoErro erro={estado.erro} titulo="Não conseguimos carregar a equipe" aoTentar={() => void estado.recarregar()} />
        ) : (
          <EsqueletoTabela linhas={4} texto="Carregando a equipe" />
        )
      ) : (
        <div className="table-wrap">
          <table className="table cb-tabela-equipe">
            <thead>
              <tr>
                <th scope="col">Membro</th>
                <th scope="col">Perfil</th>
                <th scope="col">Último acesso</th>
                <th scope="col" className="t-right">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {membros.map((m) => {
                const eu = m.id === resumo.eu.id;
                const unicoAdmin = m.status === 'ativo' && m.perfil === 'admin' && adminsAtivos <= 1;
                const idSelect = `perfil-${m.id}`;
                if (m.status === 'convidado') {
                  const expirou = !!m.conviteExpiraEm && Date.parse(m.conviteExpiraEm) < agora.getTime();
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="row">
                          <span className="avatar cb-avatar-convite" aria-hidden="true">
                            {fmt.iniciais(m.email.split('@')[0].replace(/[._-]+/g, ' '))}
                          </span>
                          <div className="stack-sm" style={{ gap: 0 }}>
                            <span className="strong">{m.email}</span>
                            <span className={`small ${expirou ? 'text-danger' : 'muted'}`}>
                              {m.conviteEnviadoEm ? `Convite enviado em ${fmt.data(m.conviteEnviadoEm)}` : 'Convite criado'}
                              {m.conviteExpiraEm
                                ? expirou
                                  ? ` · expirou em ${fmt.diaMes(m.conviteExpiraEm)}`
                                  : ` · expira em ${fmt.diaMes(m.conviteExpiraEm)}`
                                : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${expirou ? 'badge-danger' : 'badge-warning'}`}>
                          <Icone nome="relogio" tamanho="sm" />
                          {expirou ? 'Convite expirado' : 'Convite pendente'} · {ROTULO_PERFIL[m.perfil]}
                        </span>
                      </td>
                      <td className="small muted cb-acesso" data-rotulo="Último acesso: ">Nunca</td>
                      <td className="t-right">
                        {podeAdministrar ? (
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--s-1)' }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={!online || reenviar.enviando}
                              onClick={async () => {
                                setLinhaAcao(m.id);
                                trocar.limparErro();
                                const r = await reenviar.executar(m.id);
                                if (r) {
                                  estado.definir((lista) => lista?.map((x) => (x.id === r.membro.id ? r.membro : x)));
                                  setDialogo({ tipo: 'link', membro: r.membro, link: r.linkConvite, reenviado: true });
                                }
                              }}
                            >
                              Reenviar
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={!online}
                              aria-label={`Cancelar convite de ${m.email}`}
                              onClick={() => setDialogo({ tipo: 'cancelar', membro: m })}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <span className="small muted">—</span>
                        )}
                        {linhaAcao === m.id ? <ErroAcao erro={reenviar.erro} /> : null}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="row">
                        <span className="avatar" aria-hidden="true">
                          {fmt.iniciais(nomeDe(m))}
                        </span>
                        <div className="stack-sm" style={{ gap: 0 }}>
                          <span className="strong">
                            {nomeDe(m)}{' '}
                            {eu ? (
                              <span className="badge" style={{ height: 20 }}>
                                Você
                              </span>
                            ) : null}
                          </span>
                          <span className="small muted">{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={idSelect}>
                        Perfil de {nomeDe(m)}
                      </label>
                      <select
                        id={idSelect}
                        className={`select cb-perfil-select${!podeAdministrar || unicoAdmin ? ' cb-select-travado' : ''}`}
                        value={m.perfil}
                        disabled={!podeAdministrar || unicoAdmin || !online || trocar.enviando}
                        onChange={(e) => {
                          const perfil = e.target.value as PerfilEquipe;
                          if (eu && m.perfil === 'admin' && perfil !== 'admin') setDialogo({ tipo: 'rebaixar-si', membro: m, perfil });
                          else void mudarPerfil(m, perfil);
                        }}
                      >
                        {PERFIS.map((p) => (
                          <option key={p} value={p}>
                            {ROTULO_PERFIL[p]}
                          </option>
                        ))}
                      </select>
                      {unicoAdmin ? <div className="tiny muted">Único admin: não pode ser alterado</div> : null}
                      {linhaAcao === m.id ? <ErroAcao erro={trocar.erro} /> : null}
                    </td>
                    <td className="small num cb-acesso" data-rotulo="Último acesso: ">
                      {ultimoAcesso(m.ultimoAcesso, agora)}
                    </td>
                    <td className="t-right">
                      {podeAdministrar && !eu && !unicoAdmin ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={!online}
                          aria-label={`Remover ${nomeDe(m)} da equipe`}
                          onClick={() => setDialogo({ tipo: 'remover', membro: m })}
                        >
                          Remover
                        </button>
                      ) : (
                        <span className="small muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-flat grid-kpi" style={{ padding: 'var(--s-4) var(--s-5)' }}>
        {PERFIS.map((p) => (
          <div key={p} className="stack-sm" style={{ gap: 2 }}>
            <span className="small strong">{ROTULO_PERFIL[p]}</span>
            <span className="tiny muted">{DESCRICAO_PERFIL[p]}</span>
          </div>
        ))}
      </div>

      {dialogo?.tipo === 'convidar' ? (
        <DialogoConvite
          aoFechar={() => setDialogo(null)}
          aoConvidar={(membro, link) => {
            estado.definir((lista) => [...(lista ?? []), membro]);
            setDialogo({ tipo: 'link', membro, link, reenviado: false });
            void recarregarResumo();
          }}
        />
      ) : null}
      {dialogo?.tipo === 'link' ? (
        <Modal
          titulo={dialogo.reenviado ? 'Link novo gerado' : 'Convite criado'}
          aoFechar={() => setDialogo(null)}
          rodape={
            <button className="btn btn-primary" type="button" onClick={() => setDialogo(null)}>
              Concluir
            </button>
          }
        >
          <p className="small">
            {dialogo.reenviado ? 'O link anterior deixou de valer. ' : ''}Não enviamos e-mail: copie o link e mande para{' '}
            <span className="strong">{dialogo.membro.email}</span>. Ele vale por 7 dias
            {dialogo.membro.conviteExpiraEm ? `, até ${fmt.data(dialogo.membro.conviteExpiraEm)}` : ''}, e dá acesso como{' '}
            {ROTULO_PERFIL[dialogo.membro.perfil]}.
          </p>
          <div className="field">
            <label htmlFor="link-convite">Link do convite</label>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <input
                id="link-convite"
                className="input mono cb-link-convite"
                readOnly
                value={dialogo.link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <BotaoCopiar texto={dialogo.link} rotulo="Copiar link" />
            </div>
          </div>
        </Modal>
      ) : null}
      {dialogo?.tipo === 'remover' ? (
        <DialogoConfirmar
          titulo={`Remover ${nomeDe(dialogo.membro)} da equipe?`}
          texto={`${nomeDe(dialogo.membro)} perde o acesso ao console na hora. O que essa pessoa fez continua no registro de auditoria.`}
          rotulo="Remover"
          executar={() => api.del(`/equipe/${dialogo.membro.id}`)}
          aoFechar={() => setDialogo(null)}
          aoConcluir={() => {
            const m = dialogo.membro;
            estado.definir((lista) => lista?.filter((x) => x.id !== m.id));
            setDialogo(null);
            aoAviso(`${nomeDe(m)} saiu da equipe.`);
          }}
        />
      ) : null}
      {dialogo?.tipo === 'cancelar' ? (
        <DialogoConfirmar
          titulo="Cancelar o convite?"
          texto={`O link enviado para ${dialogo.membro.email} deixa de funcionar. Você pode convidar de novo quando quiser.`}
          rotulo="Cancelar convite"
          executar={() => api.del(`/equipe/${dialogo.membro.id}`)}
          aoFechar={() => setDialogo(null)}
          aoConcluir={() => {
            const m = dialogo.membro;
            estado.definir((lista) => lista?.filter((x) => x.id !== m.id));
            setDialogo(null);
            aoAviso(`Convite de ${m.email} cancelado.`);
          }}
        />
      ) : null}
      {dialogo?.tipo === 'rebaixar-si' ? (
        <DialogoConfirmar
          titulo="Deixar de ser Admin?"
          texto={`Seu perfil vai mudar para ${ROTULO_PERFIL[dialogo.perfil]}. Você perde o acesso a equipe, limites de gasto e segurança, e só outro Admin pode devolver.`}
          rotulo={`Mudar para ${ROTULO_PERFIL[dialogo.perfil]}`}
          executar={() => api.put<MembroEquipe>(`/equipe/${dialogo.membro.id}/perfil`, { perfil: dialogo.perfil })}
          aoFechar={() => setDialogo(null)}
          aoConcluir={async () => {
            setDialogo(null);
            aoAviso(`Seu perfil mudou para ${ROTULO_PERFIL[dialogo.perfil]}.`);
            await Promise.all([estado.recarregar(), recarregarResumo()]);
          }}
        />
      ) : null}
    </section>
  );
}

function DialogoConvite({
  aoFechar,
  aoConvidar,
}: {
  aoFechar: () => void;
  aoConvidar: (m: MembroEquipe, link: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<PerfilEquipe>('suporte');
  const [tocado, setTocado] = useState(false);
  const convidar = useAcao(() => api.post<{ membro: MembroEquipe; linkConvite: string }>('/equipe/convites', { email, perfil }));
  const online = useOnline();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const enviar = async () => {
    setTocado(true);
    if (!emailOk) return;
    const r = await convidar.executar();
    if (r) aoConvidar(r.membro, r.linkConvite);
  };
  return (
    <Modal
      titulo="Convidar pessoa"
      aoFechar={aoFechar}
      rodape={
        <>
          <button className="btn btn-secondary" type="button" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            className={`btn btn-primary${convidar.enviando ? ' is-loading' : ''}`}
            type="button"
            disabled={convidar.enviando || !online}
            onClick={() => void enviar()}
          >
            Criar convite
          </button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <div className="field">
          <label htmlFor="convite-email">
            E-mail <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            id="convite-email"
            className={`input${tocado && !emailOk ? ' is-error' : ''}`}
            type="email"
            value={email}
            placeholder="nome@empresa.com.br"
            aria-invalid={tocado && !emailOk}
            onBlur={() => setTocado(true)}
            onChange={(e) => setEmail(e.target.value)}
          />
          {tocado && !emailOk ? (
            <span className="error-text">
              <Icone nome="alerta" tamanho="sm" />
              Digite um e-mail válido, por exemplo nome@empresa.com.br
            </span>
          ) : (
            <span className="help">Não enviamos e-mail: depois de criar, você copia o link e manda para a pessoa.</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="convite-perfil">Perfil</label>
          <select id="convite-perfil" className="select" value={perfil} onChange={(e) => setPerfil(e.target.value as PerfilEquipe)}>
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PERFIL[p]}
              </option>
            ))}
          </select>
          <span className="help">{DESCRICAO_PERFIL[perfil]}</span>
        </div>
        <button type="submit" hidden />
      </form>
      <ErroAcao erro={convidar.erro} />
    </Modal>
  );
}

function DialogoConfirmar({
  titulo,
  texto,
  rotulo,
  executar,
  aoFechar,
  aoConcluir,
}: {
  titulo: string;
  texto: string;
  rotulo: string;
  executar: () => Promise<unknown>;
  aoFechar: () => void;
  aoConcluir: () => void | Promise<void>;
}) {
  const acao = useAcao(async () => {
    await executar();
    return true;
  });
  return (
    <Modal
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <button className="btn btn-secondary" type="button" onClick={aoFechar}>
            Voltar
          </button>
          <button
            className={`btn btn-danger${acao.enviando ? ' is-loading' : ''}`}
            type="button"
            disabled={acao.enviando}
            onClick={async () => {
              if (await acao.executar()) await aoConcluir();
            }}
          >
            {rotulo}
          </button>
        </>
      }
    >
      <p className="small muted">{texto}</p>
      <ErroAcao erro={acao.erro} />
    </Modal>
  );
}

// ---------- Limites ----------

interface FormLimites {
  mensal: string;
  porUsuarioDia: string;
  alerta80: boolean;
  aoAtingir: Limites['aoAtingir'];
}

function formDe(l: Limites): FormLimites {
  return { mensal: escreverMoeda(l.mensal), porUsuarioDia: String(l.porUsuarioDia), alerta80: l.alerta80, aoAtingir: l.aoAtingir };
}

function SecaoLimites({
  podeAdministrar,
  admins,
  aoAviso,
}: {
  podeAdministrar: boolean;
  admins: MembroEquipe[];
  aoAviso: (t: string) => void;
}) {
  const { recarregarResumo } = useSessao();
  const online = useOnline();
  const estado = useApi<Limites>(podeAdministrar ? '/limites' : null);
  const [form, setForm] = useState<FormLimites | null>(null);
  useEffect(() => {
    if (estado.dados && !form) setForm(formDe(estado.dados));
  }, [estado.dados, form]);
  const salvar = useAcao((corpo: object) => api.put<Limites>('/limites', corpo));

  const l = estado.dados;
  const mensal = form ? lerMoeda(form.mensal) : null;
  const porDia = form && /^\d+$/.test(form.porUsuarioDia.trim()) ? Number(form.porUsuarioDia) : null;
  const erroMensal = form && (mensal === null || mensal < 0) ? 'Digite um valor em reais, por exemplo 1.500,00.' : null;
  const erroPorDia = form && (porDia === null || porDia < 1) ? 'Use um número inteiro a partir de 1.' : null;
  const sujo =
    !!form &&
    !!l &&
    (mensal !== l.mensal || porDia !== l.porUsuarioDia || form.alerta80 !== l.alerta80 || form.aoAtingir !== l.aoAtingir);
  const mes = useMemo(() => new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date()), []);
  const nomesAdmins = listaPorExtenso(admins.map(nomeDe));

  return (
    <section className="card" aria-labelledby="t-limites">
      <div className="card-head cb-card-head-wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h3" id="t-limites">
            Limites de gasto
          </h2>
          <p className="small muted">Evita surpresas na fatura. Valores com impostos.</p>
        </div>
      </div>
      {!podeAdministrar ? (
        <SemAcesso
          titulo="Você não tem acesso a Limites de gasto"
          texto="Só quem tem perfil Admin pode ver e mudar os limites."
          admins={admins}
          assunto="Acesso aos limites de gasto do Copiloto"
        />
      ) : !l || !form ? (
        <div className="card-body">
          {estado.erro ? (
            <AvisoErro erro={estado.erro} titulo="Não conseguimos carregar os limites" aoTentar={() => void estado.recarregar()} />
          ) : (
            <EsqueletoTabela linhas={3} texto="Carregando os limites" />
          )}
        </div>
      ) : (
        <>
          <div className="card-body stack-lg">
            <Uso limites={l} mes={mes} />

            <div className="grid-2">
              <div className="field">
                <label htmlFor="limite-mensal">Limite mensal</label>
                <div className="row" style={{ gap: 0 }}>
                  <span className="small strong cb-prefixo">R$</span>
                  <input
                    id="limite-mensal"
                    className={`input num cb-com-prefixo${erroMensal ? ' is-error' : ''}`}
                    type="text"
                    inputMode="decimal"
                    value={form.mensal}
                    disabled={!podeAdministrar}
                    aria-invalid={!!erroMensal}
                    onChange={(e) => setForm({ ...form, mensal: e.target.value })}
                    onBlur={() => mensal !== null && setForm({ ...form, mensal: escreverMoeda(mensal) })}
                  />
                </div>
                {erroMensal ? (
                  <span className="error-text">{erroMensal}</span>
                ) : (
                  <span className="help">Só Admin pode mudar. Vale a partir do momento em que salvar.</span>
                )}
              </div>
              <div className="field">
                <label htmlFor="limite-usuario">Limite por usuário</label>
                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <input
                    id="limite-usuario"
                    className={`input num${erroPorDia ? ' is-error' : ''}`}
                    type="number"
                    min={1}
                    step={1}
                    value={form.porUsuarioDia}
                    disabled={!podeAdministrar}
                    style={{ maxWidth: 120 }}
                    aria-invalid={!!erroPorDia}
                    onChange={(e) => setForm({ ...form, porUsuarioDia: e.target.value })}
                  />
                  <span className="small muted">execuções por dia</span>
                </div>
                {erroPorDia ? (
                  <span className="error-text">{erroPorDia}</span>
                ) : (
                  <span className="help">Protege contra uso repetido por engano. Dúvidas respondidas não contam.</span>
                )}
              </div>
            </div>

            <div className="row-top between wrap" style={{ gap: 'var(--s-4)' }}>
              <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 300px' }}>
                <span className="strong">Alerta em 80%</span>
                <span className="help">
                  Mostra um aviso no topo do console{nomesAdmins ? ` para ${nomesAdmins}` : ''} quando o gasto do mês passar de 80% do
                  limite.
                </span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.alerta80}
                  disabled={!podeAdministrar}
                  aria-label="Alerta em 80% do limite"
                  onChange={(e) => setForm({ ...form, alerta80: e.target.checked })}
                />
                <span className="small strong">{form.alerta80 ? 'Ligado' : 'Desligado'}</span>
              </label>
            </div>

            <fieldset className="stack-sm" style={{ border: 0, margin: 0, padding: 0 }} disabled={!podeAdministrar}>
              <legend className="strong" style={{ padding: 0, marginBottom: 'var(--s-2)' }}>
                Ao atingir o limite
              </legend>
              <label className="check">
                <input
                  type="radio"
                  name="ao-limite"
                  checked={form.aoAtingir === 'pausar_navegador'}
                  onChange={() => setForm({ ...form, aoAtingir: 'pausar_navegador' })}
                />
                <span>Pausar tarefas pelo navegador e manter as por API</span>
              </label>
              <span className="help cb-help-recuo">
                Recomendado. Tarefas pela API custam menos, e dúvidas continuam sendo respondidas.
              </span>
              <label className="check">
                <input
                  type="radio"
                  name="ao-limite"
                  checked={form.aoAtingir === 'pausar_tudo'}
                  onChange={() => setForm({ ...form, aoAtingir: 'pausar_tudo' })}
                />
                <span>Pausar tudo</span>
              </label>
              <span className="help cb-help-recuo">O copiloto avisa os usuários que está pausado e oferece falar com uma pessoa.</span>
            </fieldset>
            <ErroAcao erro={salvar.erro} />
          </div>
          <div className="card-foot" style={{ justifyContent: 'space-between' }}>
            <span className="tiny muted">
              {l.atualizadoPor && l.atualizadoEm
                ? `Última alteração por ${l.atualizadoPor} em ${fmt.data(l.atualizadoEm)}`
                : podeAdministrar
                  ? ''
                  : 'Só Admin pode mudar os limites.'}
            </span>
            {podeAdministrar ? (
              <div className="row">
                <button className="btn btn-ghost" type="button" disabled={!sujo || salvar.enviando} onClick={() => setForm(formDe(l))}>
                  Descartar
                </button>
                <button
                  className={`btn btn-primary${salvar.enviando ? ' is-loading' : ''}`}
                  type="button"
                  disabled={!sujo || !!erroMensal || !!erroPorDia || salvar.enviando || !online}
                  onClick={async () => {
                    const r = await salvar.executar({
                      mensal,
                      porUsuarioDia: porDia,
                      alerta80: form.alerta80,
                      aoAtingir: form.aoAtingir,
                    });
                    if (r) {
                      estado.definir(() => r);
                      setForm(formDe(r));
                      aoAviso('Limites salvos. Já estão valendo.');
                      await recarregarResumo();
                    }
                  }}
                >
                  Salvar limites
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function Uso({ limites: l, mes }: { limites: Limites; mes: string }) {
  const fracao = l.mensal > 0 ? l.usoMes / l.mensal : 0;
  const pct = Math.round(fracao * 100);
  return (
    <div className="card-flat stack-sm" style={{ padding: 'var(--s-4) var(--s-5)' }}>
      <div className="row between wrap">
        <span className="small strong">Uso em {mes}</span>
        <span className="small num">
          <span className="strong">{fmt.moeda(l.usoMes)}</span> de {fmt.moeda(l.mensal)} · {pct}%
        </span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Uso do limite mensal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
      >
        <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="row between wrap tiny muted">
        <span>Renova em {fmt.data(l.renovaEm)}</span>
        <span>
          {fracao >= 1
            ? l.aoAtingir === 'pausar_tudo'
              ? 'Limite atingido: o copiloto está pausado até renovar.'
              : 'Limite atingido: tarefas pelo navegador estão pausadas até renovar.'
            : `No ritmo atual, fecha o mês perto de ${fmt.moeda(l.previsaoMes)}`}
        </span>
      </div>
    </div>
  );
}

// ---------- Segurança ----------

function SecaoSeguranca({ podeAdministrar, aoAviso }: { podeAdministrar: boolean; aoAviso: (t: string) => void }) {
  const online = useOnline();
  const estado = useApi<Seguranca>('/seguranca');
  const [form, setForm] = useState<Seguranca | null>(null);
  useEffect(() => {
    if (estado.dados && !form) setForm(estado.dados);
  }, [estado.dados, form]);
  const salvar = useAcao((corpo: object) => api.put<Seguranca>('/seguranca', corpo));
  const s = estado.dados;
  const sujo =
    !!form &&
    !!s &&
    (form.mascararPrints !== s.mascararPrints ||
      form.retencaoPrintsDias !== s.retencaoPrintsDias ||
      form.retencaoConversasMeses !== s.retencaoConversasMeses);

  return (
    <section className="card" aria-labelledby="t-seg">
      <div className="card-head cb-card-head-wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h3" id="t-seg">
            Segurança e dados
          </h2>
          <p className="small muted">
            Duas regras não podem ser desligadas. Elas garantem que o copiloto nunca faça nada que o usuário não faria.
          </p>
        </div>
        {podeAdministrar ? (
          <a className="btn btn-secondary btn-sm" href="#auditoria">
            <Icone nome="lista" tamanho="sm" />
            Registro de auditoria
          </a>
        ) : null}
      </div>
      {!s || !form ? (
        <div className="card-body">
          {estado.erro ? (
            <AvisoErro erro={estado.erro} titulo="Não conseguimos carregar a segurança" aoTentar={() => void estado.recarregar()} />
          ) : (
            <EsqueletoTabela linhas={3} texto="Carregando a segurança" />
          )}
        </div>
      ) : (
        <>
          <div>
            <div className="row-top between wrap cb-linha-config">
              <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 320px' }}>
                <span className="strong">Confirmação antes de gravar</span>
                <span className="help">
                  O usuário vê os dados num cartão e toca em “Confirmar e executar” antes de qualquer gravação. Dúvidas não pedem
                  confirmação.
                </span>
              </div>
              <span className="badge">
                <Icone nome="cadeado" tamanho="sm" />
                Sempre · travado
              </span>
            </div>
            <div className="row-top between wrap cb-linha-config">
              <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 320px' }}>
                <span className="strong">Agente usa as permissões de quem pediu</span>
                <span className="help">
                  O copiloto nunca tem mais acesso que o usuário. Se a pessoa não pode fazer algo no sistema, ele explica e oferece pedir a
                  quem pode.
                </span>
              </div>
              <span className="badge">
                <Icone nome="cadeado" tamanho="sm" />
                Ligado · travado
              </span>
            </div>
            <div className="row-top between wrap cb-linha-config">
              <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 320px' }}>
                <span className="strong">Mascarar dados sensíveis nos prints</span>
                <span className="help">CPF, CNPJ, cartão, senhas e e-mails aparecem borrados nos prints das execuções.</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.mascararPrints}
                  disabled={!podeAdministrar}
                  aria-label="Mascarar dados sensíveis nos prints"
                  onChange={(e) => setForm({ ...form, mascararPrints: e.target.checked })}
                />
                <span className="small strong">{form.mascararPrints ? 'Ligado' : 'Desligado'}</span>
              </label>
            </div>
            <div className="row-top between wrap cb-linha-config">
              <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 320px' }}>
                <label className="strong" htmlFor="ret-prints">
                  Guardar prints por
                </label>
                <span className="help">Depois disso, os prints são apagados. O registro do que foi feito continua.</span>
              </div>
              <select
                id="ret-prints"
                className="select"
                style={{ width: 180 }}
                value={form.retencaoPrintsDias}
                disabled={!podeAdministrar}
                onChange={(e) => setForm({ ...form, retencaoPrintsDias: Number(e.target.value) as Seguranca['retencaoPrintsDias'] })}
              >
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
                <option value={180}>180 dias</option>
              </select>
            </div>
            <div className="row-top between wrap cb-linha-config">
              <div className="stack-sm grow" style={{ gap: 2, flex: '1 1 320px' }}>
                <label className="strong" htmlFor="ret-conversas">
                  Guardar conversas por
                </label>
                <span className="help">Usuários podem pedir a exclusão das próprias conversas a qualquer momento.</span>
              </div>
              <select
                id="ret-conversas"
                className="select"
                style={{ width: 180 }}
                value={form.retencaoConversasMeses}
                disabled={!podeAdministrar}
                onChange={(e) =>
                  setForm({ ...form, retencaoConversasMeses: Number(e.target.value) as Seguranca['retencaoConversasMeses'] })
                }
              >
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
                <option value={24}>24 meses</option>
              </select>
            </div>
            {salvar.erro ? (
              <div style={{ padding: '0 var(--s-6) var(--s-4)' }}>
                <ErroAcao erro={salvar.erro} />
              </div>
            ) : null}
          </div>
          <div className="card-foot" style={{ justifyContent: 'space-between' }}>
            <span className="tiny muted">
              {s.atualizadoPor && s.atualizadoEm
                ? `Última alteração por ${s.atualizadoPor} em ${fmt.data(s.atualizadoEm)}`
                : podeAdministrar
                  ? 'Ainda com os valores padrão.'
                  : 'Só Admin pode mudar estas regras.'}
            </span>
            {podeAdministrar ? (
              <div className="row">
                <button className="btn btn-ghost" type="button" disabled={!sujo || salvar.enviando} onClick={() => setForm(s)}>
                  Descartar
                </button>
                <button
                  className={`btn btn-primary${salvar.enviando ? ' is-loading' : ''}`}
                  type="button"
                  disabled={!sujo || salvar.enviando || !online}
                  onClick={async () => {
                    const r = await salvar.executar({
                      mascararPrints: form.mascararPrints,
                      retencaoPrintsDias: form.retencaoPrintsDias,
                      retencaoConversasMeses: form.retencaoConversasMeses,
                    });
                    if (r) {
                      estado.definir(() => r);
                      setForm(r);
                      aoAviso('Regras de segurança salvas.');
                    }
                  }}
                >
                  Salvar
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- Sem acesso (Estados-Console) ----------

function SemAcesso({ titulo, texto, admins, assunto }: { titulo: string; texto: string; admins: MembroEquipe[]; assunto: string }) {
  const { resumo } = useSessao();
  const admin = admins.find((a) => a.id !== resumo.eu.id) ?? admins[0];
  return (
    <div className="card-body">
      <div className="empty" style={{ padding: 'var(--s-6) 0' }}>
        <div className="empty-icon" style={{ background: 'var(--surface-2)', color: 'var(--ink-700)' }}>
          <Icone nome="cadeado" tamanho="lg" />
        </div>
        <h3 className="h3">{titulo}</h3>
        <p>
          {texto} Seu perfil é {ROTULO_PERFIL[resumo.eu.perfil]}.
        </p>
        {admin ? (
          <a className="btn btn-primary" href={`mailto:${admin.email}?subject=${encodeURIComponent(assunto)}`}>
            Pedir acesso a {nomeDe(admin)}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Auditoria ----------

function SecaoAuditoria({ podeAdministrar, admins }: { podeAdministrar: boolean; admins: MembroEquipe[] }) {
  const primeira = useApi<RegistroAuditoria[]>(podeAdministrar ? '/auditoria' : null);
  const [mais, setMais] = useState<RegistroAuditoria[]>([]);
  const [fim, setFim] = useState(false);
  const carregarMais = useAcao(async (antes: string) => api.get<RegistroAuditoria[]>(`/auditoria?antes=${encodeURIComponent(antes)}`));
  useEffect(() => {
    setMais([]);
    setFim(false);
  }, [primeira.dados]);
  const registros = [...(primeira.dados ?? []), ...mais];
  const temMais = !fim && (mais.length ? mais.length === 50 : (primeira.dados?.length ?? 0) === 50);

  return (
    <section className="card" id="auditoria" aria-labelledby="t-auditoria">
      <div className="card-head cb-card-head-wrap">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="h3" id="t-auditoria">
            Registro de auditoria
          </h2>
          <p className="small muted">Quem mudou o quê no console, do mais recente para o mais antigo. Não dá para apagar.</p>
        </div>
        <span className="muted">
          <Icone nome="cadeado" />
        </span>
      </div>
      {!podeAdministrar ? (
        <SemAcesso
          titulo="Você não tem acesso ao registro de auditoria"
          texto="Só quem tem perfil Admin pode ver o registro."
          admins={admins}
          assunto="Acesso ao registro de auditoria do Copiloto"
        />
      ) : !primeira.dados ? (
        <div className="card-body">
          {primeira.erro ? (
            <AvisoErro erro={primeira.erro} titulo="Não conseguimos carregar o registro de auditoria" aoTentar={() => void primeira.recarregar()} />
          ) : (
            <EsqueletoTabela linhas={4} texto="Carregando o registro de auditoria" />
          )}
        </div>
      ) : registros.length === 0 ? (
        <div className="card-body">
          <p className="small muted">Nada registrado ainda. Cada mudança feita no console aparece aqui.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="table cb-tabela-auditoria">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Quem</th>
                  <th scope="col">O que</th>
                  <th scope="col">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id}>
                    <td className="small num cb-nowrap">{fmt.dataHora(r.ts)}</td>
                    <td className="small cb-nowrap">{r.ator}</td>
                    <td className="small">
                      {r.acao} <span className="strong">{r.alvo}</span>
                    </td>
                    <td className="small muted">{r.detalhe ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot" style={{ justifyContent: 'space-between' }}>
            <span className="tiny muted">
              {registros.length} {registros.length === 1 ? 'registro' : 'registros'}
            </span>
            {temMais ? (
              <button
                className={`btn btn-secondary btn-sm${carregarMais.enviando ? ' is-loading' : ''}`}
                type="button"
                disabled={carregarMais.enviando}
                onClick={async () => {
                  const r = await carregarMais.executar(registros[registros.length - 1].ts);
                  if (r) {
                    setMais((m) => [...m, ...r]);
                    if (r.length < 50) setFim(true);
                  }
                }}
              >
                Carregar mais
              </button>
            ) : null}
            <ErroAcao erro={carregarMais.erro} />
          </div>
        </>
      )}
    </section>
  );
}

// Janelas da página Empresas: "Nova empresa", editar o acompanhamento (fase, plano, responsável,
// meta, avaliação e contrato), "Entrar como suporte" e "Sugerir regravação à empresa".
import { useEffect, useState } from 'react';
import {
  cnpjValido,
  fmt,
  ROTULO_FAIXA_USUARIOS,
  ROTULO_SITUACAO,
  type DetalheEmpresaStarta,
  type FaixaUsuarios,
  type FaseEmpresa,
  type FluxoComConserto,
  type MembroStarta,
  type NovaEmpresaStarta,
  type SuporteAberto,
} from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { apiPlataforma, useApiPlataforma, type PlanoStarta, type RegravacaoSugerida } from '../../api/plataforma.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { recarregar } from '../../componentes/sessao.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { AvisoEnvio, LinkParaCopiar, plural } from './pecas.tsx';

const FASES: FaseEmpresa[] = ['implantacao', 'piloto', 'ativo'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MOTIVO_MINIMO = 10;

function mensagem(e: unknown): string {
  const ex = e as ErroApiCliente;
  return ex.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : ex.message;
}

function ErroAcao({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p className="error-text" role="alert">
      <Icone nome="alerta" tamanho="sm" />
      {texto}
    </p>
  );
}

/** Data ISO para o campo de data (dia de Brasília, como as telas mostram). */
function paraCampoData(iso: string | null | undefined): string {
  if (!iso) return '';
  const [d, m, a] = fmt.data(iso).split('/');
  return `${a}-${m}-${d}`;
}

/** Planos para os campos de seleção; sem a lista, fica o plano atual (para não apagar sem querer). */
function OpcoesPlano({ planos, atual }: { planos: PlanoStarta[] | undefined; atual: { id: string; nome: string } | null }) {
  const lista = planos ?? (atual ? [{ id: atual.id, nome: atual.nome }] : []);
  return (
    <>
      <option value="">Sem plano</option>
      {lista.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Nova empresa

export function ModalNovaEmpresa({ aberto, aoFechar, aoCriar }: { aberto: boolean; aoFechar: () => void; aoCriar: (id: string | null) => void }) {
  const planos = useApiPlataforma<PlanoStarta[]>(aberto ? '/planos' : null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [faixa, setFaixa] = useState<FaixaUsuarios | ''>('');
  const [planoId, setPlanoId] = useState('');
  const [fase, setFase] = useState<FaseEmpresa>('implantacao');
  const [erros, setErros] = useState<{ nome?: string; email?: string; cnpj?: string }>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [criada, setCriada] = useState<NovaEmpresaStarta | null>(null);

  const fechar = () => {
    setNome('');
    setEmail('');
    setCnpj('');
    setFaixa('');
    setPlanoId('');
    setFase('implantacao');
    setErros({});
    setErro(null);
    setCriada(null);
    aoFechar();
  };

  const criar = async () => {
    const e: typeof erros = {};
    if (nome.trim().length < 2) e.nome = 'Diga o nome da empresa.';
    if (!EMAIL.test(email.trim())) e.email = 'Digite o e-mail de quem vai administrar o espaço da empresa.';
    if (cnpj.trim() && !cnpjValido(cnpj)) e.cnpj = 'CNPJ inválido. Confira os números.';
    setErros(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPlataforma.post<NovaEmpresaStarta>('/empresas', {
        nome: nome.trim(),
        ...(cnpj.trim() ? { cnpj: cnpj.trim() } : {}),
        ...(faixa ? { faixaUsuarios: faixa } : {}),
        ...(planoId ? { planoId } : {}),
        fase,
        admin: { email: email.trim() },
      });
      setCriada(r);
      aoCriar(r.empresa.id);
    } catch (ex) {
      setErro(mensagem(ex));
      // A empresa foi criada mesmo sem o e-mail: a lista precisa mostrar.
      if ((ex as ErroApiCliente).erro === 'email_indisponivel') aoCriar(null);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo={criada ? `${criada.empresa.nome} foi criada` : 'Nova empresa'}
      descricao={criada ? undefined : 'A Starta cria o espaço da empresa e convida o primeiro Admin. O sistema e a marca, a empresa configura depois de entrar.'}
      aoFechar={fechar}
      travado={enviando}
      rodape={
        criada ? (
          <Botao variante="primario" onClick={fechar}>
            Pronto
          </Botao>
        ) : (
          <>
            <Botao onClick={fechar} disabled={enviando}>
              Cancelar
            </Botao>
            <Botao variante="primario" carregando={enviando} onClick={() => void criar()}>
              Criar empresa
            </Botao>
          </>
        )
      }
    >
      {criada ? (
        <>
          <p className="small">
            A empresa está em {ROTULO_SITUACAO[criada.empresa.situacao].toLowerCase()} e você ficou como responsável. O convite leva o Admin a criar a senha e
            entrar no console da empresa.
          </p>
          <AvisoEnvio envio={criada.envio} para={email.trim()} oQue="o convite" />
          <LinkParaCopiar link={criada.linkConvite} rotulo="Link do convite" />
        </>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void criar();
          }}
        >
          <Campo rotulo="Nome da empresa" obrigatorio erro={erros.nome}>
            {(p) => <input {...p} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="organization" data-autofoco />}
          </Campo>
          <Campo rotulo="E-mail do primeiro Admin" obrigatorio erro={erros.email} ajuda="Recebe o convite para criar a senha e entrar no console da empresa.">
            {(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
          </Campo>
          <div className="cp-campos-2">
            <Campo rotulo="CNPJ" erro={erros.cnpj} ajuda="Opcional.">
              {(p) => <input {...p} inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />}
            </Campo>
            <Campo rotulo="Usuários do sistema" classe="select" ajuda="Opcional.">
              {(p) => (
                <select {...p} value={faixa} onChange={(e) => setFaixa(e.target.value as FaixaUsuarios | '')}>
                  <option value="">Não informado</option>
                  {(Object.keys(ROTULO_FAIXA_USUARIOS) as FaixaUsuarios[]).map((f) => (
                    <option key={f} value={f}>
                      {ROTULO_FAIXA_USUARIOS[f]}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo rotulo="Plano" classe="select" ajuda={planos.erro ? 'Não consegui carregar os planos agora. Dá para escolher depois.' : undefined}>
              {(p) => (
                <select {...p} value={planoId} onChange={(e) => setPlanoId(e.target.value)} disabled={!planos.dados}>
                  <OpcoesPlano planos={planos.dados} atual={null} />
                </select>
              )}
            </Campo>
            <Campo rotulo="Fase" classe="select">
              {(p) => (
                <select {...p} value={fase} onChange={(e) => setFase(e.target.value as FaseEmpresa)}>
                  {FASES.map((f) => (
                    <option key={f} value={f}>
                      {ROTULO_SITUACAO[f]}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          </div>
          <ErroAcao texto={erro} />
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Acompanhamento

export function ModalAcompanhamento({
  aberto,
  empresa,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  empresa: DetalheEmpresaStarta;
  aoFechar: () => void;
  aoSalvar: (d: DetalheEmpresaStarta) => void;
}) {
  const planos = useApiPlataforma<PlanoStarta[]>(aberto ? '/planos' : null);
  const equipe = useApiPlataforma<MembroStarta[]>(aberto ? '/equipe' : null);
  const contrato = empresa.implantacao.find((e) => e.chave === 'contrato');
  const inicial = {
    fase: empresa.fase,
    planoId: empresa.plano?.id ?? '',
    responsavel: empresa.responsavel?.id ?? '',
    meta: empresa.metaTarefas === null ? '' : String(empresa.metaTarefas),
    avaliacao: paraCampoData(empresa.avaliacaoPilotoEm),
    contrato: contrato?.feita ? paraCampoData(contrato.quando) : '',
  };
  const [v, setV] = useState(inicial);
  const [erroMeta, setErroMeta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setV(inicial);
      setErro(null);
      setErroMeta(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const mudar = <K extends keyof typeof inicial>(k: K, valor: (typeof inicial)[K]) => setV((x) => ({ ...x, [k]: valor }));

  const salvar = async () => {
    const meta = v.meta.trim() === '' ? null : Number(v.meta);
    if (meta !== null && (!Number.isInteger(meta) || meta < 1)) {
      setErroMeta('Use um número inteiro de tarefas, a partir de 1. Deixe vazio para ficar sem meta.');
      return;
    }
    setErroMeta(null);
    const corpo: Record<string, unknown> = {};
    if (v.fase !== inicial.fase) corpo.fase = v.fase;
    if (v.planoId !== inicial.planoId) corpo.planoId = v.planoId || null;
    if (v.responsavel !== inicial.responsavel) corpo.responsavelStarta = v.responsavel || null;
    if (v.meta !== inicial.meta) corpo.metaTarefas = meta;
    if (v.avaliacao !== inicial.avaliacao) corpo.avaliacaoPilotoEm = v.avaliacao || null;
    if (v.contrato !== inicial.contrato) corpo.contratoAssinadoEm = v.contrato || null;
    if (Object.keys(corpo).length === 0) {
      aoFechar();
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      aoSalvar(await apiPlataforma.put<DetalheEmpresaStarta>(`/empresas/${encodeURIComponent(empresa.id)}`, corpo));
      aoFechar();
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setEnviando(false);
    }
  };

  const ativos = (equipe.dados ?? []).filter((m) => m.ativa || m.id === inicial.responsavel);
  return (
    <Modal
      aberto={aberto}
      titulo="Editar acompanhamento"
      descricao={`O que a Starta combinou com a ${empresa.nome}. Fase e plano ficam na auditoria da empresa.`}
      aoFechar={aoFechar}
      travado={enviando}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={enviando} onClick={() => void salvar()}>
            Salvar
          </Botao>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <div className="cp-campos-2">
          <Campo rotulo="Fase" classe="select">
            {(p) => (
              <select {...p} value={v.fase} onChange={(e) => mudar('fase', e.target.value as FaseEmpresa)} data-autofoco>
                {FASES.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_SITUACAO[f]}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="Plano" classe="select" ajuda={planos.erro ? 'Não consegui carregar os planos agora.' : undefined}>
            {(p) => (
              <select {...p} value={v.planoId} onChange={(e) => mudar('planoId', e.target.value)} disabled={!planos.dados}>
                <OpcoesPlano planos={planos.dados} atual={empresa.plano} />
              </select>
            )}
          </Campo>
          <Campo rotulo="Responsável Starta" classe="select" ajuda={equipe.erro ? 'Não consegui carregar a equipe agora.' : undefined}>
            {(p) => (
              <select {...p} value={v.responsavel} onChange={(e) => mudar('responsavel', e.target.value)} disabled={!equipe.dados}>
                <option value="">Sem responsável</option>
                {(equipe.dados ? ativos : empresa.responsavel ? [empresa.responsavel] : []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="Meta de tarefas publicadas" erro={erroMeta} ajuda="Para a etapa “Tarefas publicadas” da implantação.">
            {(p) => <input {...p} type="number" min={1} step={1} inputMode="numeric" value={v.meta} onChange={(e) => mudar('meta', e.target.value)} placeholder="Sem meta" />}
          </Campo>
          <Campo rotulo="Avaliação do piloto" ajuda="Dia da reunião com a empresa.">
            {(p) => <input {...p} type="date" value={v.avaliacao} onChange={(e) => mudar('avaliacao', e.target.value)} />}
          </Campo>
          <Campo rotulo="Contrato e LGPD assinados em" ajuda="Para empresas criadas pela Starta, com o contrato assinado fora do cadastro.">
            {(p) => <input {...p} type="date" value={v.contrato} onChange={(e) => mudar('contrato', e.target.value)} />}
          </Campo>
        </div>
        <ErroAcao texto={erro} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Entrar como suporte

export function ModalSuporte({ aberto, empresa, aoFechar }: { aberto: boolean; empresa: { id: string; nome: string }; aoFechar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    setMotivo('');
    setErroMotivo(null);
    setErro(null);
    aoFechar();
  };

  const entrar = async () => {
    if (motivo.trim().length < MOTIVO_MINIMO) {
      setErroMotivo(`Diga o motivo do acesso, em pelo menos ${MOTIVO_MINIMO} caracteres.`);
      return;
    }
    setErroMotivo(null);
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPlataforma.post<SuporteAberto>(`/empresas/${encodeURIComponent(empresa.id)}/suporte`, { motivo: motivo.trim() });
      // O cookie do console já é o de suporte: abre o console da empresa do zero.
      recarregar.console(r.url);
    } catch (e) {
      setErro(mensagem(e));
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo={`Entrar como suporte na ${empresa.nome}`}
      aoFechar={fechar}
      travado={enviando}
      rodape={
        <>
          <Botao onClick={fechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone="cadeado" carregando={enviando} onClick={() => void entrar()}>
            Entrar como suporte
          </Botao>
        </>
      }
    >
      <div className="alert" role="note">
        <Icone nome="info" />
        <p className="small">
          O acesso fica registrado na auditoria da {empresa.nome} e os Admins dela recebem um e-mail com o seu nome e o motivo. Você entra no console da empresa
          com o perfil Suporte: vê e opera, sem editar nem administrar. O acesso tem prazo e termina quando você sair do modo suporte.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
      >
        <Campo rotulo="Motivo do acesso" obrigatorio erro={erroMotivo} ajuda={`Pelo menos ${MOTIVO_MINIMO} caracteres. A empresa vai ler este texto.`} classe="textarea">
          {(p) => (
            <textarea
              {...p}
              rows={3}
              maxLength={300}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: A empresa pediu ajuda com o fluxo de remarcação"
              data-autofoco
            />
          )}
        </Campo>
      </form>
      <ErroAcao texto={erro} />
    </Modal>
  );
}

// ---------------------------------------------------------------- Sugerir regravação

export function ModalRegravar({
  aberto,
  empresa,
  fluxos,
  aoFechar,
}: {
  aberto: boolean;
  empresa: { id: string; nome: string };
  fluxos: FluxoComConserto[];
  aoFechar: () => void;
}) {
  const toast = useToast();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const quebrados = fluxos.filter((f) => f.quebrado).map((f) => f.tarefaId);
    setMarcados(new Set(quebrados.length ? quebrados : fluxos.slice(0, 1).map((f) => f.tarefaId)));
    setErro(null);
  }, [aberto, fluxos]);

  const enviar = async () => {
    const escolhidos = fluxos.filter((f) => marcados.has(f.tarefaId));
    if (!escolhidos.length) {
      setErro('Marque pelo menos um fluxo.');
      return;
    }
    setEnviando(true);
    setErro(null);
    let ultimo: RegravacaoSugerida | null = null;
    const enviados: string[] = [];
    try {
      for (const f of escolhidos) {
        ultimo = await apiPlataforma.post<RegravacaoSugerida>(`/empresas/${encodeURIComponent(empresa.id)}/regravar`, { tarefaId: f.tarefaId });
        enviados.push(f.nome);
      }
    } catch (e) {
      setErro(enviados.length ? `${mensagem(e)} Já foram enviados: ${enviados.join(', ')}.` : mensagem(e));
      setEnviando(false);
      return;
    }
    setEnviando(false);
    aoFechar();
    if (ultimo) {
      const quem = plural(ultimo.enviadosPara, 'Admin', 'Admins');
      toast.mostrar(
        ultimo.envio === 'smtp'
          ? { texto: `Sugestão enviada por e-mail a ${quem} da ${empresa.nome}.`, tipo: 'sucesso' }
          : { texto: `Sugestão registrada para ${quem} da ${empresa.nome}, mas o servidor está sem envio de e-mail (SMTP): ficou na caixa de saída local.`, tipo: 'info' },
      );
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo="Sugerir regravação à empresa"
      descricao={`Os Admins da ${empresa.nome} recebem um e-mail por fluxo marcado, com o link da tarefa para gravar o fluxo de novo.`}
      aoFechar={aoFechar}
      travado={enviando}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone="enviar" carregando={enviando} onClick={() => void enviar()}>
            Enviar sugestão
          </Botao>
        </>
      }
    >
      <fieldset className="cp-fieldset stack-sm">
        <legend className="label">Fluxos para regravar</legend>
        {fluxos.map((f) => (
          <label key={f.tarefaId} className="check">
            <input
              type="checkbox"
              checked={marcados.has(f.tarefaId)}
              onChange={(e) =>
                setMarcados((m) => {
                  const n = new Set(m);
                  if (e.target.checked) n.add(f.tarefaId);
                  else n.delete(f.tarefaId);
                  return n;
                })
              }
            />
            <span className="small">
              <span className="strong">{f.nome}</span> · {plural(f.consertos30d, 'conserto', 'consertos')} em 30 dias
              {f.quebrado ? <span className="badge badge-danger cp-selo-linha">Quebrado</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <ErroAcao texto={erro} />
    </Modal>
  );
}

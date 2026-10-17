// A6 · Aceitar o convite da equipe de uma empresa (/convite/:token). Quem convidou, a empresa e o
// perfil aparecem antes do formulário. E-mail novo: nome e senha, e já entra. E-mail que já tem
// conta: entra com ela (A1 com ?convite=) e o convite é aceito logo depois; se este navegador já
// está logado com esse e-mail, aceita direto.
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmt, ROTULO_PERFIL, type ConviteAberto, type Eu, type PerfilEquipe } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { SENHA_MINIMO } from '../cadastro/regras.ts';
import { CampoRepetirSenha, CampoSenha, ItemRegra } from './pecas.tsx';
import TelaDeEntrada from './TelaDeEntrada.tsx';

const O_QUE_FAZ: Record<PerfilEquipe, string> = {
  admin: 'ver tudo, criar tarefas, cuidar da equipe, dos limites de gasto e da segurança',
  editor: 'criar, testar e publicar tarefas, fluxos e conhecimento',
  suporte: 'acompanhar execuções, aprovar pedidos e atender quem o copiloto passar para a equipe',
  leitor: 'acompanhar o painel e as execuções, sem alterar nada',
};

/** Convite vencido (410, a mensagem já diz quem reenvia) ou que não existe (404). */
function ConviteIndisponivel({ erro }: { erro: ErroApiCliente }) {
  const expirou = erro.status === 410;
  return (
    <div className="stack">
      <span className="ce-icone-aviso" aria-hidden="true">
        <Icone nome={expirou ? 'relogio' : 'alerta'} tamanho="lg" />
      </span>
      <div className="stack-sm" role="alert">
        <h1 className="h2">{expirou ? 'Este convite expirou' : 'Convite não encontrado'}</h1>
        <p className="small muted">
          {erro.message}
          {expirou ? '' : ' Confira se o link está completo ou peça um convite novo a um Admin.'}
        </p>
      </div>
      {expirou ? (
        <p className="tiny muted">
          Cada convite vale por 7 dias. O novo chega no mesmo e-mail{erro.extra.email ? <>, <strong>{erro.extra.email}</strong></> : null}.
        </p>
      ) : null}
      <Link className="btn btn-secondary btn-block" to="/entrar">
        Ir para a tela de entrada
      </Link>
    </div>
  );
}

export default function Convite() {
  const id = useId();
  const { token = '' } = useParams();
  const navegar = useNavigate();
  const [convite, setConvite] = useState<ConviteAberto | null>(null);
  const [erroConvite, setErroConvite] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  // Quem já está logado neste navegador: com o e-mail do convite, aceita sem entrar de novo.
  const [logado, setLogado] = useState<Eu | null>(null);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Convite · Copiloto Starta';
    let vivo = true;
    api
      .get<ConviteAberto>(`/auth/convite/${encodeURIComponent(token)}`)
      .then((c) => vivo && (setConvite(c), setErroConvite(null)))
      .catch((e: ErroApiCliente) => vivo && setErroConvite(e));
    api
      .get<Eu>('/auth/eu')
      .then((eu) => vivo && setLogado(eu))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  const caminho = `/auth/convite/${encodeURIComponent(token)}`;
  const erros = {
    nome: nome.trim().length < 2 ? 'Diga seu nome, como a equipe conhece você.' : null,
    senha: senha.length < SENHA_MINIMO,
    repetir: repetir !== senha,
  };
  const tocar = (k: string) => () => setTocados((t) => ({ ...t, [k]: true }));
  const entrou = (eu: Eu) => navegar(eu.emailConfirmado ? '/' : '/criar-conta', { replace: true });
  const falhou = (ex: unknown) => {
    const e = ex as ErroApiCliente;
    if (e.status === 410 || e.status === 404) setErroConvite(e);
    else setErro(e.message);
  };

  const criar = async () => {
    setTocados({ nome: true, senha: true, repetir: true });
    if (erros.nome || erros.senha || erros.repetir) return;
    setEnviando(true);
    setErro(null);
    try {
      entrou(await api.post<Eu>(caminho, { nome: nome.trim(), senha }));
    } catch (ex) {
      if ((ex as ErroApiCliente).erro === 'conta_existente' && convite) setConvite({ ...convite, contaExistente: true });
      else falhou(ex);
    } finally {
      setEnviando(false);
    }
  };

  const entrarEAceitar = async () => {
    if (!convite) return;
    if (logado?.email.toLowerCase() !== convite.email.toLowerCase()) {
      navegar(`/entrar?convite=${encodeURIComponent(token)}`, { state: { email: convite.email } });
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      entrou(await api.post<Eu>(`${caminho}/aceitar`));
    } catch (ex) {
      falhou(ex);
    } finally {
      setEnviando(false);
    }
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void (convite?.contaExistente ? entrarEAceitar() : criar());
  };

  let conteudo: ReactNode;
  if (erroConvite && (erroConvite.status === 410 || erroConvite.status === 404)) {
    conteudo = <ConviteIndisponivel erro={erroConvite} />;
  } else if (erroConvite && !convite) {
    conteudo = <EstadoErro erro={erroConvite} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui abrir o convite" />;
  } else if (!convite) {
    conteudo = <Carregando texto="Abrindo o convite…" />;
  } else {
    const somenteLeitura = (p: { className?: string }) => `${p.className} ce-somente-leitura`;
    conteudo = (
      <form className="stack" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
        <div className="stack-sm">
          {convite.convidadoPor ? (
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <span className="avatar avatar-sm" aria-hidden="true">
                {fmt.iniciais(convite.convidadoPor.nome)}
              </span>
              <span className="small muted">
                Convite de{' '}
                <span className="strong" style={{ color: 'var(--ink-900)' }}>
                  {convite.convidadoPor.nome}
                </span>
                , {ROTULO_PERFIL[convite.convidadoPor.perfil]}
              </span>
            </div>
          ) : null}
          <h1 id={`${id}-t`} className="h2">
            Você recebeu um convite para o Copiloto da {convite.empresa}
          </h1>
        </div>
        {erro ? (
          <Aviso tipo="erro" papel="alert">
            {erro}
          </Aviso>
        ) : null}
        {convite.contaExistente ? (
          <>
            <div className="alert" role="status">
              <Icone nome="info" />
              <p className="small">Você já tem conta com este e-mail. Entre para aceitar o convite.</p>
            </div>
            <Campo rotulo="E-mail">
              {(p) => <input {...p} className={somenteLeitura(p)} type="email" autoComplete="username" value={convite.email} readOnly />}
            </Campo>
            <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
              Entrar e aceitar o convite
            </Botao>
            <p className="tiny muted">
              Depois de entrar, a {convite.empresa} aparece na sua lista de empresas, como {ROTULO_PERFIL[convite.perfil]}.
            </p>
          </>
        ) : (
          <>
            <div className="card-flat row-top" style={{ padding: 'var(--s-3) var(--s-4)', borderRadius: 'var(--r-md)', gap: 'var(--s-3)' }}>
              <Icone nome="tarefas" className="text-brand" style={{ marginTop: 2 }} />
              <p className="small">
                Você entra como <span className="strong">{ROTULO_PERFIL[convite.perfil]}</span>: vai poder {O_QUE_FAZ[convite.perfil]}.
              </p>
            </div>
            <Campo rotulo="Seu nome" obrigatorio erro={tocados.nome ? erros.nome : null}>
              {(p) => <input {...p} autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={tocar('nome')} autoFocus />}
            </Campo>
            <Campo rotulo="E-mail" ajuda="O convite vale só para este e-mail.">
              {(p) => <input {...p} className={somenteLeitura(p)} type="email" autoComplete="username" value={convite.email} readOnly />}
            </Campo>
            <CampoSenha
              rotulo="Senha"
              obrigatorio
              autoComplete="new-password"
              valor={senha}
              aoMudar={setSenha}
              aoSair={tocar('senha')}
              regras={
                <ItemRegra ok={!erros.senha} erro={!!tocados.senha}>
                  Pelo menos {SENHA_MINIMO} caracteres
                </ItemRegra>
              }
            />
            <CampoRepetirSenha
              rotulo="Repita a senha"
              obrigatorio
              senha={senha}
              valor={repetir}
              aoMudar={setRepetir}
              aoSair={tocar('repetir')}
              mostrarErro={!!tocados.repetir}
            />
            <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
              Aceitar e entrar
            </Botao>
            {convite.validoAte ? (
              <p className="tiny muted" style={{ textAlign: 'center' }}>
                Convite válido até {fmt.data(convite.validoAte)}.
              </p>
            ) : null}
          </>
        )}
      </form>
    );
  }

  return (
    <TelaDeEntrada
      direita={
        <p className="small muted">
          Já tem conta?{' '}
          <Link className="strong" to="/entrar">
            Entrar
          </Link>
        </p>
      }
      rodape={<p className="tiny muted">O copiloto executa tarefas no seu sistema só depois do “confirmo” de quem pediu, com as permissões dessa pessoa.</p>}
    >
      {conteudo}
    </TelaDeEntrada>
  );
}

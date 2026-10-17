// Ativação do acesso à Plataforma Starta (link de COPILOTO_ADMINS, de "Convidar" ou de "Redefinir
// acesso"): na mesma tela, 1) ler o QR code no aplicativo autenticador (ou digitar a chave),
// 2) criar a senha e 3) digitar o código de 6 dígitos. Ativado, a pessoa já entra e vê os 10
// códigos de recuperação uma vez só; "Entrar na plataforma" libera depois de marcar que guardou.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AtivacaoConcluida, AtivacaoStarta } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { apiPlataforma } from '../../api/plataforma.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { CampoRepetirSenha, CampoSenha, horaEDia, ItemRegra } from '../entrar/pecas.tsx';
import { ListaCodigos } from './Codigos.tsx';
import { MolduraAcessoStarta } from './MolduraAcesso.tsx';
import { copiarTexto } from './pecas.tsx';

const SENHA_MINIMA = 8;

const mensagem = (e: unknown) => {
  const ex = e as ErroApiCliente;
  return ex.offline ? 'Sem conexão. Confira a internet e tente de novo.' : ex.message;
};

/** "ABCD EFGH IJKL …": a chave em blocos de 4, mais fácil de digitar no aplicativo. */
export const emBlocos = (segredo: string) => (segredo.match(/.{1,4}/g) ?? []).join(' ');

function LinkExpirado() {
  return (
    <div className="stack">
      <span className="ce-icone-aviso" aria-hidden="true">
        <Icone nome="relogio" tamanho="lg" />
      </span>
      <div className="stack-sm" role="alert">
        <h1 className="h2">Este link expirou ou já foi usado.</h1>
        <p className="small muted">Cada link de ativação vale por um tempo e funciona uma vez só. Peça a um Admin da plataforma para enviar outro.</p>
      </div>
      <Link className="btn btn-lg btn-block cp-btn-escuro" to="/plataforma/entrar">
        Ir para a entrada da plataforma
      </Link>
    </div>
  );
}

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <li className="cp-passo" aria-labelledby={id}>
      <span className="cp-passo-n" aria-hidden="true">
        {n}
      </span>
      <div className="stack-sm">
        <h2 id={id} className="h4">
          {titulo}
        </h2>
        {children}
      </div>
    </li>
  );
}

function FormAtivar({
  token,
  ativacao,
  aoAtivar,
  aoExpirar,
}: {
  token: string;
  ativacao: AtivacaoStarta;
  aoAtivar: (r: AtivacaoConcluida) => void;
  /** O link deixou de valer enquanto a pessoa preenchia (410). */
  aoExpirar: (e: ErroApiCliente) => void;
}) {
  const id = useId();
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [codigo, setCodigo] = useState('');
  const [tentou, setTentou] = useState(false);
  const [saiuRepetir, setSaiuRepetir] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [copiou, setCopiou] = useState<string | null>(null);
  const campoCodigo = useRef<HTMLInputElement>(null);

  const senhaOk = senha.length >= SENHA_MINIMA;
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setTentou(true);
    setErro(null);
    setErroSenha(null);
    const codigoOk = /^\d{6}$/.test(codigo);
    setErroCodigo(codigoOk ? null : 'Digite os 6 dígitos que aparecem agora no aplicativo.');
    if (!senhaOk || senha !== repetir || !codigoOk) return;
    setEnviando(true);
    try {
      aoAtivar(await apiPlataforma.post<AtivacaoConcluida>(`/auth/ativar/${encodeURIComponent(token)}`, { senha, codigo }));
    } catch (ex) {
      const err = ex as ErroApiCliente;
      setEnviando(false);
      if (err.status === 410) {
        aoExpirar(err);
      } else if (err.erro === 'codigo_incorreto') {
        setErroCodigo(err.message);
        campoCodigo.current?.focus();
        campoCodigo.current?.select();
      } else if (err.status === 400) {
        setErroSenha(err.message);
      } else {
        setErro(mensagem(err));
      }
    }
  };

  return (
    <form className="stack-lg" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
      <div className="stack-sm">
        <h1 id={`${id}-t`} className="h2">
          Ativar o seu acesso
        </h1>
        <p className="muted">{ativacao.nome}, ligue a verificação em duas etapas e crie a sua senha para entrar na Plataforma Starta.</p>
      </div>
      <Campo rotulo="E-mail">
        {(p) => <input {...p} className={`${p.className} ce-somente-leitura`} type="email" autoComplete="username" value={ativacao.email} readOnly />}
      </Campo>
      <ol className="cp-passos stack-lg">
        <Passo n={1} titulo="Leia o QR code no aplicativo autenticador">
          <p className="small muted">No aplicativo autenticador do celular, adicione uma conta e aponte a câmera para o código.</p>
          <img
            className="cp-qr"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ativacao.qrSvg)}`}
            alt="QR code da sua conta na Plataforma Starta para o aplicativo autenticador"
            width={168}
            height={168}
          />
          <p className="small muted">Sem câmera? Digite esta chave no aplicativo:</p>
          <div className="row wrap" style={{ gap: 'var(--s-2) var(--s-3)' }}>
            <span className="cp-chave strong" aria-label={`Chave: ${ativacao.segredo.split('').join(' ')}`}>
              {emBlocos(ativacao.segredo)}
            </span>
            <Botao
              tamanho="sm"
              icone="copiar"
              onClick={async () => setCopiou((await copiarTexto(ativacao.segredo)) ? 'Chave copiada.' : 'Não consegui copiar. Selecione a chave e copie.')}
            >
              Copiar chave
            </Botao>
            {copiou ? (
              <span className="tiny muted" role="status">
                {copiou}
              </span>
            ) : null}
          </div>
        </Passo>
        <Passo n={2} titulo="Crie a sua senha">
          <CampoSenha
            rotulo="Senha"
            autoComplete="new-password"
            obrigatorio
            valor={senha}
            aoMudar={(v) => {
              setSenha(v);
              setErroSenha(null);
            }}
            regras={
              <ItemRegra ok={senhaOk} erro={tentou}>
                Pelo menos {SENHA_MINIMA} caracteres
              </ItemRegra>
            }
          />
          {erroSenha ? (
            <span className="error-text" role="alert">
              <Icone nome="alerta" tamanho="sm" />
              {erroSenha}
            </span>
          ) : null}
          <CampoRepetirSenha
            rotulo="Repita a senha"
            obrigatorio
            senha={senha}
            valor={repetir}
            aoMudar={setRepetir}
            aoSair={() => setSaiuRepetir(true)}
            mostrarErro={(saiuRepetir || tentou) && (repetir.length > 0 || tentou)}
          />
        </Passo>
        <Passo n={3} titulo="Digite o código do aplicativo">
          <div className="field">
            <label htmlFor={`${id}-codigo`}>Código do autenticador</label>
            <input
              ref={campoCodigo}
              id={`${id}-codigo`}
              className={`input num cp-codigo-2fa${erroCodigo ? ' is-error' : ''}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6));
                setErroCodigo(null);
              }}
              aria-invalid={erroCodigo ? true : undefined}
              aria-describedby={erroCodigo ? `${id}-erro ${id}-ajuda` : `${id}-ajuda`}
            />
            {erroCodigo ? (
              <span id={`${id}-erro`} className="error-text" role="alert">
                <Icone nome="alerta" tamanho="sm" />
                {erroCodigo}
              </span>
            ) : null}
            <span id={`${id}-ajuda`} className="help">
              O código muda a cada 30 segundos. Use o que estiver na tela agora.
            </span>
          </div>
        </Passo>
      </ol>
      {erro ? (
        <Aviso tipo="erro" papel="alert">
          {erro}
        </Aviso>
      ) : null}
      <div className="stack-sm">
        <Botao type="submit" tamanho="lg" bloco className="cp-btn-escuro" carregando={enviando}>
          Ativar acesso
        </Botao>
        <p className="tiny muted">Este link vale até {horaEDia(ativacao.expiraEm)} e funciona uma vez só.</p>
      </div>
    </form>
  );
}

function CodigosDaAtivacao({ concluida }: { concluida: AtivacaoConcluida }) {
  const id = useId();
  const navegar = useNavigate();
  const [guardei, setGuardei] = useState(false);
  return (
    <div className="stack" aria-labelledby={`${id}-t`} role="group">
      <div className="stack-sm">
        <span className="badge badge-success" style={{ alignSelf: 'flex-start' }}>
          <Icone nome="check" tamanho="sm" />
          Acesso ativado
        </span>
        <h1 id={`${id}-t`} className="h2">
          Guarde os seus códigos de recuperação
        </h1>
        <p className="muted">
          Se perder o celular com o aplicativo autenticador, entre com um destes códigos. Cada um funciona uma vez só, e eles não aparecem de novo.
        </p>
      </div>
      <ListaCodigos codigos={concluida.codigosRecuperacao} email={concluida.eu.email} />
      <label className="check cp-guardei">
        <input type="checkbox" checked={guardei} onChange={(e) => setGuardei(e.target.checked)} />
        <span className="small">Guardei os códigos em lugar seguro</span>
      </label>
      <Botao tamanho="lg" bloco className="cp-btn-escuro" disabled={!guardei} onClick={() => navegar('/plataforma', { replace: true })}>
        Entrar na plataforma
      </Botao>
    </div>
  );
}

export default function AtivarPlataforma() {
  const { token = '' } = useParams();
  const [ativacao, setAtivacao] = useState<AtivacaoStarta | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [concluida, setConcluida] = useState<AtivacaoConcluida | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    apiPlataforma
      .get<AtivacaoStarta>(`/auth/ativar/${encodeURIComponent(token)}`)
      .then((a) => vivo && setAtivacao(a))
      .catch((e: ErroApiCliente) => vivo && setErro(e));
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  let conteudo;
  if (concluida) conteudo = <CodigosDaAtivacao concluida={concluida} />;
  else if (erro?.status === 410 || erro?.status === 404) conteudo = <LinkExpirado />;
  else if (erro) conteudo = <EstadoErro erro={erro} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui abrir o link de ativação" />;
  else if (!ativacao) conteudo = <Carregando texto="Abrindo o link de ativação…" />;
  else conteudo = <FormAtivar token={token} ativacao={ativacao} aoAtivar={setConcluida} aoExpirar={setErro} />;

  return <MolduraAcessoStarta titulo={concluida ? 'Códigos de recuperação' : 'Ativar acesso à plataforma'}>{conteudo}</MolduraAcessoStarta>;
}

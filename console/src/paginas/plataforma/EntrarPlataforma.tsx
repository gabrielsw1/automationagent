// A7 · Entrar na plataforma. Etapa 1: e-mail e senha ("Continuar"). Etapa 2: o código de 6 dígitos
// do aplicativo autenticador, com "Confiar neste aparelho por 30 dias", ou um código de recuperação.
// Aparelho confiável pula a etapa 2. 5 senhas erradas bloqueiam (423, até `ate`); 5 códigos errados
// encerram a entrada (401 recomecar) e a pessoa volta à etapa 1 com o aviso. Quem já entrou vai
// direto para a Plataforma; ?voltar= leva de volta à página da Plataforma que pediu a entrada.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, type EntradaStarta, type EuStarta } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { apiPlataforma } from '../../api/plataforma.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { emailValido } from '../cadastro/regras.ts';
import { CampoSenha } from '../entrar/pecas.tsx';
import { destinoNaPlataforma, MolduraAcessoStarta, type EstadoEntrou } from './MolduraAcesso.tsx';

type Fase = 'verificando' | 'senha' | 'codigo' | 'recuperacao';

const mensagem = (e: unknown) => {
  const ex = e as ErroApiCliente;
  return ex.offline ? 'Sem conexão. Confira a internet e tente de novo.' : ex.message;
};

function EtapaSenha({
  email,
  setEmail,
  aviso,
  aoContinuar,
}: {
  email: string;
  setEmail: (v: string) => void;
  /** Mensagem de quem voltou da etapa 2 ("Foram 5 códigos incorretos…"). */
  aviso: string | null;
  aoContinuar: (r: EntradaStarta) => void;
}) {
  const id = useId();
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocado, setTocado] = useState(false);
  const [bloqueio, setBloqueio] = useState<{ email: string; ate: string; mensagem: string } | null>(null);
  const campoSenha = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!bloqueio) return;
    const t = setTimeout(() => setBloqueio(null), Math.max(0, Date.parse(bloqueio.ate) - Date.now()));
    return () => clearTimeout(t);
  }, [bloqueio]);

  const bloqueado = bloqueio?.email === email.trim().toLowerCase() ? bloqueio : null;
  const erroEmail = tocado && email && !emailValido(email) ? 'Digite um e-mail completo, por exemplo nome@starta.site' : null;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (bloqueado || enviando) return;
    setTocado(true);
    if (!emailValido(email) || !senha) {
      setErro(!senha && emailValido(email) ? 'Digite a sua senha.' : 'Digite o e-mail e a senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      aoContinuar(await apiPlataforma.post<EntradaStarta>('/auth/entrar', { email: email.trim(), senha }));
    } catch (ex) {
      const err = ex as ErroApiCliente;
      setSenha('');
      if (err.erro === 'bloqueado' && err.extra.ate) {
        setBloqueio({ email: email.trim().toLowerCase(), ate: err.extra.ate, mensagem: err.message });
      } else {
        setErro(mensagem(err));
        if (err.erro === 'credenciais') campoSenha.current?.focus();
      }
      setEnviando(false);
    }
  };

  return (
    <form className="stack" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
      <div className="stack-sm">
        <h1 id={`${id}-t`} className="h2">
          Entrar na plataforma
        </h1>
        <p className="muted">Painel interno da Starta para cuidar das empresas clientes.</p>
      </div>
      {bloqueado ? (
        <div className="alert alert-warning" role="alert">
          <Icone nome="cadeado" />
          <div className="stack-sm" style={{ gap: 2 }}>
            <p className="small strong">{bloqueado.mensagem}</p>
            <p className="small">Tente de novo às {fmt.hora(bloqueado.ate)} ou peça a outro Admin da plataforma para redefinir o seu acesso.</p>
          </div>
        </div>
      ) : erro ? (
        <Aviso tipo="erro" papel="alert">
          {erro}
        </Aviso>
      ) : aviso ? (
        <Aviso tipo="aviso" papel="alert">
          {aviso}
        </Aviso>
      ) : null}
      <Campo rotulo="E-mail" erro={erroEmail}>
        {(p) => (
          <input
            {...p}
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="nome@starta.site"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTocado(true)}
            autoFocus={!email}
          />
        )}
      </Campo>
      <CampoSenha rotulo="Senha" autoComplete="current-password" valor={senha} aoMudar={setSenha} entrada={campoSenha} />
      {bloqueado ? (
        <button className="btn btn-lg btn-block" type="button" disabled>
          <Icone nome="relogio" tamanho="sm" />
          Continuar
        </button>
      ) : (
        <Botao type="submit" tamanho="lg" bloco className="cp-btn-escuro" carregando={enviando}>
          Continuar
        </Botao>
      )}
      <p className="tiny muted">Esqueceu a senha ou perdeu o aparelho com o autenticador? Peça a outro Admin da plataforma para redefinir o seu acesso.</p>
    </form>
  );
}

function EtapaCodigo({
  pessoa,
  recuperacao,
  setRecuperacao,
  aoEntrar,
  aoRecomecar,
}: {
  pessoa: { nome: string; iniciais: string };
  recuperacao: boolean;
  setRecuperacao: (v: boolean) => void;
  aoEntrar: (eu: EuStarta) => void;
  aoRecomecar: (mensagem: string) => void;
}) {
  const id = useId();
  const [codigo, setCodigo] = useState('');
  const [confiar, setConfiar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // O código veio errado do servidor (não só faltando dígitos): mostra a dica do relógio.
  const [incorreto, setIncorreto] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  const trocar = (v: boolean) => {
    setRecuperacao(v);
    setCodigo('');
    setErro(null);
    setIncorreto(false);
    setTimeout(() => campo.current?.focus(), 0);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    const valor = codigo.trim();
    if (recuperacao ? valor.replace(/[^0-9a-z]/gi, '').length < 8 : !/^\d{6}$/.test(valor)) {
      setErro(recuperacao ? 'Digite o código de recuperação, por exemplo K7QD-M2WP.' : 'Digite os 6 dígitos que aparecem agora no aplicativo.');
      setIncorreto(false);
      campo.current?.focus();
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const eu = await apiPlataforma.post<EuStarta>('/auth/codigo', {
        codigo: valor,
        tipo: recuperacao ? 'recuperacao' : 'aplicativo',
        confiarAparelho: !recuperacao && confiar,
      });
      aoEntrar(eu);
    } catch (ex) {
      const err = ex as ErroApiCliente;
      setEnviando(false);
      if (err.erro === 'recomecar') {
        aoRecomecar(err.message);
        return;
      }
      setErro(mensagem(err));
      setIncorreto(err.erro === 'codigo_incorreto');
      campo.current?.focus();
      campo.current?.select();
    }
  };

  const ajudaId = `${id}-ajuda`;
  const erroId = `${id}-erro`;
  const ajuda = recuperacao
    ? 'Cada código funciona uma vez só. Depois de entrar, gere códigos novos se estiverem acabando.'
    : incorreto
      ? 'Confira se o relógio do celular está certo e use o código que aparece agora no aplicativo.'
      : 'O código muda a cada 30 segundos. Use o que estiver na tela agora.';

  return (
    <form className="stack" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
      <div className="stack-sm">
        <span className="row" style={{ gap: 'var(--s-2)' }}>
          <span className="avatar avatar-sm" aria-hidden="true">
            {pessoa.iniciais}
          </span>
          <span className="small muted">{pessoa.nome}</span>
        </span>
        <h1 id={`${id}-t`} className="h2">
          {recuperacao ? 'Usar um código de recuperação' : 'Verificação em duas etapas'}
        </h1>
        <p className="muted">
          {recuperacao
            ? 'Use um dos códigos que você guardou quando ativou a verificação em duas etapas.'
            : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-codigo`}>{recuperacao ? 'Código de recuperação' : 'Código do autenticador'}</label>
        {recuperacao ? (
          <input
            ref={campo}
            key="recuperacao"
            id={`${id}-codigo`}
            className={`input cp-codigo-recuperacao${erro ? ' is-error' : ''}`}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            placeholder="XXXX-XXXX"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${erroId} ${ajudaId}` : ajudaId}
            autoFocus
          />
        ) : (
          <input
            ref={campo}
            key="aplicativo"
            id={`${id}-codigo`}
            className={`input num cp-codigo-2fa${erro ? ' is-error' : ''}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${erroId} ${ajudaId}` : ajudaId}
            autoFocus
          />
        )}
        {erro ? (
          <span id={erroId} className="error-text" role="alert">
            <Icone nome="alerta" tamanho="sm" />
            {erro}
          </span>
        ) : null}
        <span id={ajudaId} className="help">
          {ajuda}
        </span>
      </div>
      {recuperacao ? null : (
        <label className="check">
          <input type="checkbox" checked={confiar} onChange={(e) => setConfiar(e.target.checked)} />
          <span className="small">Confiar neste aparelho por 30 dias</span>
        </label>
      )}
      <Botao type="submit" tamanho="lg" bloco className="cp-btn-escuro" carregando={enviando}>
        Entrar na plataforma
      </Botao>
      <button className="btn btn-ghost btn-sm cp-link-centro" type="button" onClick={() => trocar(!recuperacao)} disabled={enviando}>
        {recuperacao ? 'Voltar para o código do aplicativo' : 'Usar um código de recuperação'}
      </button>
    </form>
  );
}

export default function EntrarPlataforma() {
  const navegar = useNavigate();
  const [busca] = useSearchParams();
  const destino = destinoNaPlataforma(busca.get('voltar'));
  const [fase, setFase] = useState<Fase>('verificando');
  const [email, setEmail] = useState('');
  const [pessoa, setPessoa] = useState<{ nome: string; iniciais: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Quem já entrou (sessão completa) não vê a entrada de novo.
  useEffect(() => {
    let vivo = true;
    apiPlataforma
      .get<EuStarta>('/auth/eu')
      .then(() => vivo && navegar(destino, { replace: true }))
      .catch(() => vivo && setFase('senha'));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entrou = () => {
    const estado: EstadoEntrou = { entrou: true };
    navegar(destino, { replace: true, state: estado });
  };

  if (fase === 'verificando') {
    return (
      <MolduraAcessoStarta titulo="Entrar na plataforma">
        <Carregando />
      </MolduraAcessoStarta>
    );
  }

  return (
    <MolduraAcessoStarta titulo="Entrar na plataforma" etapa={fase === 'senha' ? 'Etapa 1 de 2' : 'Etapa 2 de 2'}>
      {fase === 'senha' || !pessoa ? (
        <EtapaSenha
          email={email}
          setEmail={setEmail}
          aviso={aviso}
          aoContinuar={(r) => {
            if (r.etapa === 'completa') {
              entrou();
              return;
            }
            setAviso(null);
            setPessoa(r.pessoa);
            setFase('codigo');
          }}
        />
      ) : (
        <EtapaCodigo
          pessoa={pessoa}
          recuperacao={fase === 'recuperacao'}
          setRecuperacao={(v) => setFase(v ? 'recuperacao' : 'codigo')}
          aoEntrar={entrou}
          aoRecomecar={(m) => {
            setAviso(m);
            setPessoa(null);
            setFase('senha');
          }}
        />
      )}
    </MolduraAcessoStarta>
  );
}

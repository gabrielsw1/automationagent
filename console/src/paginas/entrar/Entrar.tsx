// A1 · Entrar no Copiloto. Depois de entrar, segue para a escolha da empresa, para o código do
// e-mail ou direto para onde a pessoa ia (?voltar=, que aparece no cartão). Com ?convite=<token>
// (A6, e-mail que já tem conta), o servidor aceita o convite na mesma entrada e abre aquela empresa.
// 5 senhas erradas bloqueiam a entrada com senha por 15 minutos: a tela diz até quando e oferece
// redefinir a senha. Quando ainda não há nenhum acesso neste copiloto, leva ao cadastro.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, type Entrada, type PrimeiroAcesso } from '@copiloto/shared';
import { api, ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { secaoDoConsole } from '../../layout/navegacao.ts';
import { emailValido } from '../cadastro/regras.ts';
import { CampoSenha, destinoDepoisDeEntrar, useSeguirEntrada } from './pecas.tsx';
import TelaDeEntrada from './TelaDeEntrada.tsx';

/** "Depois de entrar: Execuções › EX-20431". Só para seções do console. */
function DepoisDeEntrar({ destino }: { destino: string }) {
  const [secao = '', detalhe] = destino.split('?')[0].split('/').filter(Boolean);
  const s = secaoDoConsole(secao);
  if (!s) return null;
  let item = detalhe;
  try {
    item = detalhe && decodeURIComponent(detalhe);
  } catch {
    // Caminho malformado: mostra como veio.
  }
  return (
    <span className="context-pill ce-destino">
      <Icone nome={s.icone} tamanho="sm" />
      Depois de entrar: {s.rotulo}
      {item ? (
        <>
          {' › '}
          <span className="mono">{item}</span>
        </>
      ) : null}
    </span>
  );
}

function FormEntrar({ demo, cadastroAberto }: { demo: boolean; cadastroAberto: boolean }) {
  const id = useId();
  const navegar = useNavigate();
  const seguir = useSeguirEntrada();
  const { state } = useLocation();
  const [busca] = useSearchParams();
  const destino = destinoDepoisDeEntrar(busca.get('voltar'));
  const convite = busca.get('convite');
  const [email, setEmail] = useState(() => (state as { email?: string } | null)?.email ?? '');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Bloqueio depois de 5 senhas erradas (423): vale para o e-mail digitado, até `ate`.
  const [bloqueio, setBloqueio] = useState<{ email: string; ate: string; mensagem: string } | null>(null);
  const [tocado, setTocado] = useState(false);
  const campoSenha = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!bloqueio) return;
    const t = setTimeout(() => setBloqueio(null), Math.max(0, Date.parse(bloqueio.ate) - Date.now()));
    return () => clearTimeout(t);
  }, [bloqueio]);

  const bloqueado = bloqueio?.email === email.trim().toLowerCase() ? bloqueio : null;
  const erroEmail = tocado && email && !emailValido(email) ? 'Digite um e-mail completo, por exemplo nome@empresa.com.br' : null;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (bloqueado) return;
    setTocado(true);
    if (!emailValido(email) || !senha) {
      setErro(!senha && emailValido(email) ? 'Digite a sua senha.' : 'Digite o e-mail e a senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const entrada = await api.post<Entrada>('/auth/entrar', { email: email.trim(), senha, ...(convite ? { convite } : {}) });
      if (convite && entrada.eu) {
        // Convite aceito na entrada: a sessão já abriu na empresa do convite.
        navegar(entrada.eu.emailConfirmado ? '/' : '/criar-conta', { replace: true });
        return;
      }
      seguir(entrada, email.trim(), destino);
    } catch (ex) {
      const e = ex as ErroApiCliente;
      if (e.erro === 'bloqueado' && e.extra.ate) {
        setBloqueio({ email: email.trim().toLowerCase(), ate: e.extra.ate, mensagem: e.message });
        setSenha('');
      } else {
        setErro(e.message);
        // Senha errada: o e-mail continua preenchido e a senha volta vazia, com o foco nela.
        if (e.erro === 'credenciais') {
          setSenha('');
          campoSenha.current?.focus();
        }
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="stack" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
      {destino !== '/' ? <DepoisDeEntrar destino={destino} /> : null}
      <div className="stack-sm">
        <h1 id={`${id}-t`} className="h2">
          Entrar no Copiloto
        </h1>
        <p className="muted">Acompanhe o que o copiloto faz e configure as tarefas dele.</p>
      </div>
      {bloqueado ? (
        <div className="alert alert-warning" role="alert">
          <Icone nome="cadeado" />
          <div className="stack-sm" style={{ gap: 2 }}>
            <p className="small strong">{bloqueado.mensagem}</p>
            <p className="small">Você pode redefinir a senha agora.</p>
          </div>
        </div>
      ) : erro ? (
        <Aviso tipo="erro" papel="alert">
          {erro}
        </Aviso>
      ) : null}
      <Campo rotulo="E-mail" erro={erroEmail}>
        {(p) => (
          <input
            {...p}
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTocado(true)}
            placeholder="nome@empresa.com.br"
            autoFocus={!email}
          />
        )}
      </Campo>
      {bloqueado ? (
        <>
          <Link className="btn btn-primary btn-lg btn-block" to="/senha" state={{ email: email.trim() }}>
            Redefinir a senha
          </Link>
          <button className="btn btn-secondary btn-lg btn-block" type="button" disabled aria-describedby={`${id}-libera`}>
            <Icone nome="relogio" tamanho="sm" />
            Entrar
          </button>
          <p id={`${id}-libera`} className="tiny muted" style={{ textAlign: 'center' }}>
            Entrar com senha volta a funcionar às {fmt.hora(bloqueado.ate)}.
          </p>
        </>
      ) : (
        <>
          <CampoSenha
            rotulo="Senha"
            autoComplete="current-password"
            valor={senha}
            aoMudar={setSenha}
            entrada={campoSenha}
            acessorio={
              <Link className="small strong" to="/senha" state={{ email: email.trim() }}>
                Esqueci a senha
              </Link>
            }
          />
          <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
            Entrar
          </Botao>
        </>
      )}
      {demo ? (
        <div className="card-flat ca-nota">
          <Icone nome="info" tamanho="sm" />
          <p className="small">
            Dados de exemplo: <span className="mono">rafael.lima@seusistema.com.br</span> / <span className="mono">copiloto123</span>
          </p>
        </div>
      ) : null}
      {cadastroAberto ? (
        <>
          <hr className="divider" />
          <p className="small muted" style={{ textAlign: 'center' }}>
            Sua empresa ainda não usa o Copiloto?{' '}
            <Link className="strong" to="/criar-conta">
              Criar conta da empresa
            </Link>
          </p>
        </>
      ) : null}
    </form>
  );
}

export default function Entrar() {
  const [estado, setEstado] = useState<PrimeiroAcesso | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    document.title = 'Entrar · Copiloto Starta';
    let vivo = true;
    api
      .get<PrimeiroAcesso>('/auth/primeiro-acesso')
      .then((r) => vivo && (setEstado(r), setErro(null)))
      .catch((e: ErroApiCliente) => vivo && setErro(e));
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  return (
    <TelaDeEntrada
      direita={
        <Link className="small strong" to="/">
          Conhecer o Copiloto
        </Link>
      }
      rodape={
        <>
          <p className="small muted">
            É da equipe da Starta?{' '}
            <Link className="strong" to="/plataforma/entrar">
              Entrar na plataforma
            </Link>
          </p>
          <p className="tiny muted">O copiloto executa tarefas no seu sistema só depois do “confirmo” de quem pediu, com as permissões dessa pessoa.</p>
        </>
      }
    >
      {erro && !estado ? (
        <EstadoErro erro={erro} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui falar com o servidor do copiloto" />
      ) : !estado ? (
        <Carregando />
      ) : estado.precisaCriarAdmin ? (
        <Navigate to="/criar-conta" replace />
      ) : (
        <FormEntrar demo={estado.demo} cadastroAberto={estado.cadastroAberto} />
      )}
    </TelaDeEntrada>
  );
}

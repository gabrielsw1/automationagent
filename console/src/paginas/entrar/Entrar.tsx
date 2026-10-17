// Entrar no console. Quando ainda não há nenhum acesso neste copiloto, leva direto ao cadastro da
// primeira empresa; com o cadastro aberto, um link leva a "Criar a conta da sua empresa".
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { Eu, PrimeiroAcesso } from '@copiloto/shared';
import { api, ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { emailValido } from '../cadastro/regras.ts';
import TelaDeEntrada from './TelaDeEntrada.tsx';

/** ?voltar=<caminho do console>: só caminhos daqui, nunca outro site. */
export function destinoDepoisDeEntrar(voltar: string | null): string {
  const v = voltar ?? '';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.startsWith('/entrar')) return '/';
  return v;
}

function FormEntrar({ demo, cadastroAberto }: { demo: boolean; cadastroAberto: boolean }) {
  const navegar = useNavigate();
  const [busca] = useSearchParams();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Conta certa, mas fora de todas as equipes (403 sem_empresa).
  const [semEmpresa, setSemEmpresa] = useState(false);
  const [tocado, setTocado] = useState(false);

  const erroEmail = tocado && email && !emailValido(email) ? 'Digite um e-mail completo, por exemplo nome@empresa.com.br' : null;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocado(true);
    if (!emailValido(email) || !senha) {
      setErro(!senha && emailValido(email) ? 'Digite a sua senha.' : 'Digite o e-mail e a senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    setSemEmpresa(false);
    try {
      await api.post<Eu>('/auth/entrar', { email: email.trim(), senha });
      navegar(destinoDepoisDeEntrar(busca.get('voltar')), { replace: true });
    } catch (ex) {
      const e = ex as ErroApiCliente;
      if (e.erro === 'sem_empresa') setSemEmpresa(true);
      else setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="stack" onSubmit={enviar} noValidate>
      <div className="stack-sm">
        <h1 className="h2">Entrar no console</h1>
        <p className="muted">Acompanhe o que o copiloto faz e configure as tarefas dele.</p>
      </div>
      {erro ? (
        <Aviso tipo="erro" papel="alert">
          {erro}
        </Aviso>
      ) : null}
      {semEmpresa ? (
        <Aviso tipo="aviso" papel="alert" titulo="Seu acesso não está em nenhuma equipe agora">
          {cadastroAberto ? (
            <>
              Peça um convite novo a um Admin da sua empresa ou <Link to="/criar-conta">crie a conta de uma empresa nova</Link>.
            </>
          ) : (
            'Peça um convite novo a um Admin da sua empresa.'
          )}
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
            autoFocus
          />
        )}
      </Campo>
      <Campo rotulo="Senha">
        {(p) => (
          <div className="ca-senha">
            <input {...p} type={verSenha ? 'text' : 'password'} autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm ca-ver-senha" onClick={() => setVerSenha((v) => !v)} aria-pressed={verSenha}>
              {verSenha ? 'Esconder' : 'Mostrar'}
            </button>
          </div>
        )}
      </Campo>
      <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
        Entrar
      </Botao>
      {demo ? (
        <div className="card-flat ca-dica-demo">
          <Icone nome="info" tamanho="sm" />
          <p className="small">
            Dados de exemplo: <span className="mono">rafael.lima@seusistema.com.br</span> / <span className="mono">copiloto123</span>
          </p>
        </div>
      ) : null}
      {cadastroAberto ? (
        <p className="small muted">
          Sua empresa ainda não usa o copiloto? <Link to="/criar-conta">Criar a conta da sua empresa</Link>
        </p>
      ) : null}
      <p className="tiny muted">Esqueceu a senha? Peça a um Admin para reenviar o seu convite em Equipe e limites.</p>
    </form>
  );
}

export default function Entrar() {
  const [estado, setEstado] = useState<PrimeiroAcesso | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    document.title = 'Entrar · Copiloto';
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
    <TelaDeEntrada>
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

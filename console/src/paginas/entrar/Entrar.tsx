// Entrar no console. Quando ninguém da equipe tem acesso ainda, a mesma tela cria o primeiro admin.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Eu } from '@copiloto/shared';
import { api, ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import TelaDeEntrada from './TelaDeEntrada.tsx';

interface PrimeiroAcesso {
  precisaCriarAdmin: boolean;
  demo: boolean;
}

const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

function FormEntrar({ demo }: { demo: boolean }) {
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
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
    try {
      await api.post<Eu>('/auth/entrar', { email: email.trim(), senha });
      navegar('/', { replace: true });
    } catch (ex) {
      setErro((ex as ErroApiCliente).message);
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
      <p className="tiny muted">Esqueceu a senha? Peça a um Admin para reenviar o seu convite em Equipe e limites.</p>
    </form>
  );
}

function FormPrimeiroAdmin() {
  const navegar = useNavigate();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocados, setTocados] = useState<Record<string, boolean>>({});

  const erros = {
    nome: nome.trim().length < 2 ? 'Diga seu nome, como a equipe conhece você.' : null,
    email: !emailValido(email) ? 'Digite um e-mail completo, por exemplo nome@empresa.com.br' : null,
    senha: senha.length < 8 ? 'Use pelo menos 8 caracteres.' : null,
  };
  const mostrar = (k: keyof typeof erros) => (tocados[k] ? erros[k] : null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocados({ nome: true, email: true, senha: true });
    if (erros.nome || erros.email || erros.senha) return;
    setEnviando(true);
    setErro(null);
    try {
      await api.post<Eu>('/auth/primeiro-admin', { nome: nome.trim(), email: email.trim(), senha });
      navegar('/guia', { replace: true });
    } catch (ex) {
      setErro((ex as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="stack" onSubmit={enviar} noValidate>
      <div className="stack-sm">
        <span className="eyebrow">Primeiro acesso</span>
        <h1 className="h2">Crie o seu acesso de Admin</h1>
        <p className="muted">
          Ninguém entrou no console ainda. Você será o primeiro Admin e depois pode convidar o resto da equipe.
        </p>
      </div>
      {erro ? (
        <Aviso tipo="erro" papel="alert">
          {erro}
        </Aviso>
      ) : null}
      <Campo rotulo="Seu nome" obrigatorio erro={mostrar('nome')}>
        {(p) => (
          <input
            {...p}
            autoComplete="name"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={() => setTocados((t) => ({ ...t, nome: true }))}
            placeholder="Ex.: Rafael Lima"
            autoFocus
          />
        )}
      </Campo>
      <Campo rotulo="E-mail" obrigatorio erro={mostrar('email')}>
        {(p) => (
          <input
            {...p}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTocados((t) => ({ ...t, email: true }))}
            placeholder="nome@empresa.com.br"
          />
        )}
      </Campo>
      <Campo rotulo="Senha" obrigatorio erro={mostrar('senha')} ajuda="Pelo menos 8 caracteres.">
        {(p) => (
          <input
            {...p}
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onBlur={() => setTocados((t) => ({ ...t, senha: true }))}
          />
        )}
      </Campo>
      <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
        Criar acesso e entrar
      </Botao>
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
        <FormPrimeiroAdmin />
      ) : (
        <FormEntrar demo={estado.demo} />
      )}
    </TelaDeEntrada>
  );
}

// A3 · Redefinir a senha (/senha). Pede o link de senha nova por e-mail; a resposta é a mesma exista
// ou não a conta, e o reenvio só libera depois da espera que o servidor manda (60 s).
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { EnvioEmail, PedidoSenhaNova } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo, NotaCaixaDeSaida } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { emailValido } from '../cadastro/regras.ts';
import { useContagem } from './pecas.tsx';
import TelaDeEntrada from './TelaDeEntrada.tsx';

export default function EsqueciSenha() {
  const id = useId();
  const { state } = useLocation();
  const [email, setEmail] = useState(() => (state as { email?: string } | null)?.email ?? '');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<{ email: string; envio: EnvioEmail } | null>(null);
  const { restam, comecar } = useContagem();

  useEffect(() => {
    document.title = 'Redefinir a senha · Copiloto Starta';
  }, []);

  const erroEmail = tocado && !emailValido(email) ? 'Digite um e-mail completo, por exemplo nome@empresa.com.br' : null;

  const pedir = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<PedidoSenhaNova>('/auth/senha/esqueci', { email: email.trim() });
      setEnviado({ email: email.trim(), envio: r.envio });
      comecar(r.reenviarEmS);
    } catch (ex) {
      setErro((ex as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setTocado(true);
    if (emailValido(email)) void pedir();
  };

  return (
    <TelaDeEntrada
      direita={
        <p className="small muted">
          Lembrou a senha?{' '}
          <Link className="strong" to="/entrar" state={{ email: email.trim() }}>
            Entrar
          </Link>
        </p>
      }
      rodape={<p className="tiny muted">A senha nova vale para todas as empresas em que você entra com este e-mail.</p>}
    >
      {enviado ? (
        <section className="stack" aria-labelledby={`${id}-t`}>
          <h1 id={`${id}-t`} className="h2">
            Confira o seu e-mail
          </h1>
          <div className="alert alert-success" role="status">
            <Icone nome="check" />
            <p className="small">
              Se houver uma conta com <span className="strong">{enviado.email}</span>, enviamos um link para criar uma senha nova. O link vale por 1
              hora.
            </p>
          </div>
          <p className="small muted">Não chegou em alguns minutos? Confira a caixa de spam ou se o e-mail foi digitado certo.</p>
          <NotaCaixaDeSaida envio={enviado.envio} />
          {erro ? (
            <Aviso tipo="erro" papel="alert">
              {erro}
            </Aviso>
          ) : null}
          <button
            className={`btn btn-secondary btn-block${enviando ? ' is-loading' : ''}`}
            type="button"
            disabled={restam > 0 || enviando}
            onClick={() => void pedir()}
          >
            <Icone nome={restam > 0 ? 'relogio' : 'atualizar'} tamanho="sm" />
            {restam > 0 ? `Reenviar em ${restam} s` : 'Reenviar link'}
          </button>
          <Link className="btn btn-ghost btn-block" to="/entrar" state={{ email: enviado.email }}>
            Voltar para entrar
          </Link>
        </section>
      ) : (
        <form className="stack" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
          <div className="stack-sm">
            <h1 id={`${id}-t`} className="h2">
              Redefinir a senha
            </h1>
            <p className="muted">Digite o e-mail que você usa para entrar. Vamos enviar um link para você criar uma senha nova.</p>
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
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com.br"
                autoFocus
              />
            )}
          </Campo>
          <Botao type="submit" variante="primario" tamanho="lg" bloco icone="enviar" carregando={enviando}>
            Enviar link
          </Botao>
          <Link className="small strong" to="/entrar" state={{ email: email.trim() }} style={{ alignSelf: 'center' }}>
            Voltar para entrar
          </Link>
        </form>
      )}
    </TelaDeEntrada>
  );
}

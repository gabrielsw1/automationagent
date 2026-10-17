// A4 · Crie uma senha nova (/senha-nova/:token, o link do e-mail de "Esqueci a senha"). O link vale
// 1 hora e uma vez só. "Salvar e entrar" troca a senha, destrava a entrada e segue como depois de
// entrar; "Sair de todos os outros aparelhos" vem ligado.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Entrada, LinkSenhaAberto } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { SENHA_MINIMO } from '../cadastro/regras.ts';
import { CampoRepetirSenha, CampoSenha, horaEDia, ItemRegra, useSeguirEntrada } from './pecas.tsx';
import TelaDeEntrada from './TelaDeEntrada.tsx';

function LinkExpirado() {
  return (
    <div className="stack">
      <span className="ce-icone-aviso" aria-hidden="true">
        <Icone nome="relogio" tamanho="lg" />
      </span>
      <div className="stack-sm" role="alert">
        <h1 className="h2">Este link expirou ou já foi usado.</h1>
        <p className="small muted">Por segurança, cada link vale por 1 hora e funciona uma vez só. Peça outro e use o mais recente que chegar.</p>
      </div>
      <Link className="btn btn-primary btn-lg btn-block" to="/senha">
        Pedir um link novo
      </Link>
      <Link className="btn btn-ghost btn-block" to="/entrar">
        Voltar para entrar
      </Link>
    </div>
  );
}

export default function SenhaNova() {
  const id = useId();
  const { token = '' } = useParams();
  const seguir = useSeguirEntrada();
  const [link, setLink] = useState<LinkSenhaAberto | null>(null);
  const [erroLink, setErroLink] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [sairDosOutros, setSairDosOutros] = useState(true);
  const [tocados, setTocados] = useState<{ senha?: boolean; repetir?: boolean }>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Senha nova · Copiloto Starta';
    let vivo = true;
    api
      .get<LinkSenhaAberto>(`/auth/senha/${encodeURIComponent(token)}`)
      .then((l) => vivo && (setLink(l), setErroLink(null)))
      .catch((e: ErroApiCliente) => vivo && setErroLink(e));
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  const curta = senha.length < SENHA_MINIMO;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocados({ senha: true, repetir: true });
    if (!link || curta || repetir !== senha) return;
    setEnviando(true);
    setErro(null);
    try {
      const entrada = await api.post<Entrada>(`/auth/senha/${encodeURIComponent(token)}`, { senha, sairDosOutros });
      seguir(entrada, link.email, '/');
    } catch (ex) {
      const e = ex as ErroApiCliente;
      if (e.status === 410) setErroLink(e);
      else setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <TelaDeEntrada
      direita={
        <Link className="small strong" to="/entrar">
          Entrar
        </Link>
      }
    >
      {erroLink?.status === 410 ? (
        <LinkExpirado />
      ) : erroLink && !link ? (
        <EstadoErro erro={erroLink} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui abrir o link" />
      ) : !link ? (
        <Carregando />
      ) : (
        <form className="stack" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
          <div className="stack-sm">
            <h1 id={`${id}-t`} className="h2">
              Crie uma senha nova
            </h1>
            <p className="muted">
              Para{' '}
              <span className="strong" style={{ color: 'var(--ink-900)' }}>
                {link.email}
              </span>
              .
            </p>
          </div>
          {/* Para o gerenciador de senhas guardar a senha nova com o e-mail certo. */}
          <input className="sr-only" type="email" autoComplete="username" value={link.email} readOnly tabIndex={-1} aria-hidden="true" />
          {erro ? (
            <Aviso tipo="erro" papel="alert">
              {erro}
            </Aviso>
          ) : null}
          <CampoSenha
            rotulo="Nova senha"
            autoComplete="new-password"
            valor={senha}
            aoMudar={setSenha}
            aoSair={() => setTocados((t) => ({ ...t, senha: true }))}
            regras={
              <ItemRegra ok={!curta} erro={!!tocados.senha}>
                Pelo menos {SENHA_MINIMO} caracteres
              </ItemRegra>
            }
          />
          <CampoRepetirSenha
            rotulo="Repetir senha"
            senha={senha}
            valor={repetir}
            aoMudar={setRepetir}
            aoSair={() => setTocados((t) => ({ ...t, repetir: true }))}
            mostrarErro={!!tocados.repetir}
          />
          <div className="stack-sm" style={{ gap: 2 }}>
            <label className="switch">
              <input type="checkbox" checked={sairDosOutros} onChange={(e) => setSairDosOutros(e.target.checked)} aria-describedby={`${id}-sair`} />
              <span className="small strong">Sair de todos os outros aparelhos</span>
            </label>
            <span id={`${id}-sair`} className="help">
              Quem estiver com a sua conta aberta em outro computador ou navegador vai precisar entrar de novo.
            </span>
          </div>
          <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
            Salvar e entrar
          </Botao>
          <p className="tiny muted" style={{ textAlign: 'center' }}>
            Este link vale até {horaEDia(link.expiraEm)} e funciona uma vez só.
          </p>
        </form>
      )}
    </TelaDeEntrada>
  );
}

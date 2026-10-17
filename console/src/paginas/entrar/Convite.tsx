// Aceitar o convite da equipe de uma empresa (/convite/:token). E-mail novo: a pessoa diz o nome,
// cria a senha e entra. E-mail que já tem acesso ao copiloto (em outra empresa): só a senha atual.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ROTULO_PERFIL, type ConviteAberto, type Eu, type PerfilEquipe } from '@copiloto/shared';
import { api, ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { regrasSenha, SENHA_MINIMO } from '../cadastro/regras.ts';
import TelaDeEntrada from './TelaDeEntrada.tsx';

const O_QUE_FAZ: Record<PerfilEquipe, string> = {
  admin: 'ver tudo, criar tarefas, cuidar da equipe, dos limites de gasto e da segurança',
  editor: 'criar, testar e publicar tarefas, fluxos e conhecimento',
  suporte: 'acompanhar execuções, aprovar pedidos e atender quem o copiloto passar para a equipe',
  leitor: 'acompanhar o painel e as execuções, sem alterar nada',
};

/** A mesma regra do servidor para a senha de uma conta nova. */
function erroSenhaNova(senha: string, empresa: string): string | null {
  const [tamanho, letrasENumeros, semEmpresa] = regrasSenha(senha, empresa);
  if (!tamanho.ok) return `Use pelo menos ${SENHA_MINIMO} caracteres.`;
  if (!letrasENumeros.ok) return 'Use letras e números na senha.';
  if (!semEmpresa.ok && empresa) return 'A senha precisa ser diferente do nome da empresa.';
  return null;
}

export default function Convite() {
  const { token = '' } = useParams();
  const navegar = useNavigate();
  const [convite, setConvite] = useState<ConviteAberto | null>(null);
  const [erroConvite, setErroConvite] = useState<ErroApiCliente | null>(null);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Convite · Copiloto';
    let vivo = true;
    api
      .get<ConviteAberto>(`/auth/convite/${encodeURIComponent(token)}`)
      .then((c) => vivo && setConvite(c))
      .catch((e: ErroApiCliente) => vivo && setErroConvite(e));
    return () => {
      vivo = false;
    };
  }, [token]);

  const existente = !!convite?.contaExistente;
  const erros = existente
    ? { nome: null, senha: !senha ? 'Digite a sua senha.' : null, repetir: null }
    : {
        nome: nome.trim().length < 2 ? 'Diga seu nome, como a equipe conhece você.' : null,
        senha: erroSenhaNova(senha, convite?.empresa ?? ''),
        repetir: repetir !== senha ? 'As senhas não são iguais. Digite a mesma senha nos dois campos.' : null,
      };
  const mostrar = (k: keyof typeof erros) => (tocados[k] ? erros[k] : null);
  const tocar = (k: string) => () => setTocados((t) => ({ ...t, [k]: true }));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocados({ nome: true, senha: true, repetir: true });
    if (erros.nome || erros.senha || erros.repetir) return;
    setEnviando(true);
    setErro(null);
    try {
      await api.post<Eu>(`/auth/convite/${encodeURIComponent(token)}`, existente ? { senha } : { nome: nome.trim(), senha });
      navegar('/', { replace: true });
    } catch (ex) {
      setErro((ex as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  };

  if (erroConvite) {
    const expirou = erroConvite.status === 410;
    return (
      <TelaDeEntrada>
        <div className="stack">
          <h1 className="h2">{expirou ? 'Este convite expirou' : erroConvite.offline ? 'Sem conexão' : 'Convite não encontrado'}</h1>
          <p className="muted">
            {erroConvite.message}
            {!expirou && !erroConvite.offline ? ' Confira se o link está completo ou peça um convite novo a um Admin.' : ''}
          </p>
          <Link className="btn btn-secondary" to="/entrar">
            Ir para a tela de entrada
          </Link>
        </div>
      </TelaDeEntrada>
    );
  }
  if (!convite) {
    return (
      <TelaDeEntrada>
        <Carregando texto="Abrindo o convite…" />
      </TelaDeEntrada>
    );
  }

  return (
    <TelaDeEntrada>
      <form className="stack" onSubmit={enviar} noValidate>
        <div className="stack-sm">
          <span className="eyebrow">Convite para a equipe da {convite.empresa}</span>
          <h1 className="h2">{existente ? 'Entre na equipe' : 'Crie o seu acesso'}</h1>
          {existente ? (
            <p className="muted">
              Você já tem acesso ao copiloto com este e-mail. Digite sua senha para entrar também na equipe da{' '}
              <span className="strong">{convite.empresa}</span>.
            </p>
          ) : null}
          <p className="muted">
            Você foi convidado como <span className="strong">{ROTULO_PERFIL[convite.perfil]}</span>: vai poder {O_QUE_FAZ[convite.perfil]}.
          </p>
        </div>
        {erro ? (
          <Aviso tipo="erro" papel="alert">
            {erro}
          </Aviso>
        ) : null}
        <Campo rotulo="E-mail">{(p) => <input {...p} type="email" value={convite.email} disabled readOnly />}</Campo>
        {existente ? (
          <Campo rotulo="Sua senha" obrigatorio erro={mostrar('senha')} ajuda="A mesma que você usa para entrar no copiloto.">
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onBlur={tocar('senha')}
                autoFocus
              />
            )}
          </Campo>
        ) : (
          <>
            <Campo rotulo="Seu nome" obrigatorio erro={mostrar('nome')}>
              {(p) => <input {...p} autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={tocar('nome')} autoFocus />}
            </Campo>
            <Campo rotulo="Senha" obrigatorio erro={mostrar('senha')} ajuda="Pelo menos 8 caracteres, com letras e números.">
              {(p) => <input {...p} type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} onBlur={tocar('senha')} />}
            </Campo>
            <Campo rotulo="Repita a senha" obrigatorio erro={mostrar('repetir')}>
              {(p) => <input {...p} type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} onBlur={tocar('repetir')} />}
            </Campo>
          </>
        )}
        <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
          {existente ? 'Entrar na equipe' : 'Criar acesso e entrar'}
        </Botao>
      </form>
    </TelaDeEntrada>
  );
}

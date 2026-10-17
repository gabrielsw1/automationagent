// Etapa 1 do cadastro: "Crie o espaço da sua empresa". Sem sessão, pede também quem cria (nome,
// e-mail de trabalho e senha), que vira o primeiro Admin. Com sessão ("Criar outra empresa"), só a
// empresa: ela fica no acesso de quem está logado. POST /auth/cadastro abre a sessão na empresa nova.
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  cnpjValido,
  formatarCnpj,
  ROTULO_FAIXA_USUARIOS,
  somenteDigitos,
  type CadastroEmpresaPedido,
  type Eu,
  type FaixaUsuarios,
} from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { erroEmailTrabalho, regrasSenha } from './regras.ts';

const FAIXAS = Object.keys(ROTULO_FAIXA_USUARIOS) as FaixaUsuarios[];

type Chave = 'nome' | 'email' | 'senha' | 'empresa' | 'cnpj' | 'faixa' | 'aceites';

export default function EtapaEmpresa({
  conta,
  primeiroAcesso,
  aoCriar,
}: {
  /** Quem está logado; null pede o acesso de quem cria. */
  conta: Eu | null;
  primeiroAcesso: boolean;
  aoCriar: (eu: Eu) => void;
}) {
  const id = useId();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [faixa, setFaixa] = useState<FaixaUsuarios | ''>('');
  const [termos, setTermos] = useState(false);
  const [dados, setDados] = useState(false);
  const [tocados, setTocados] = useState<Partial<Record<Chave, boolean>>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);

  const regras = regrasSenha(senha, empresa);
  const erros: Record<Chave, string | null> = {
    nome: conta ? null : nome.trim().length < 2 ? 'Diga seu nome, como a equipe conhece você.' : null,
    email: conta ? null : erroEmailTrabalho(email),
    senha: conta ? null : regras.some((r) => !r.ok) ? 'A senha ainda não segue as regras abaixo.' : null,
    empresa:
      empresa.trim().length < 2
        ? 'Diga o nome da empresa.'
        : empresa.trim().length > 80
          ? 'O nome da empresa pode ter até 80 caracteres.'
          : null,
    cnpj: cnpj.trim() && !cnpjValido(cnpj) ? 'Este CNPJ não é válido. Confira os números.' : null,
    faixa: !faixa ? 'Escolha quantas pessoas usam o seu sistema.' : null,
    aceites: !termos || !dados ? 'Para criar o espaço, aceite os Termos de uso e o Contrato de tratamento de dados.' : null,
  };
  const mostrar = (k: Chave) => (tocados[k] ? erros[k] : null);
  const tocar = (k: Chave) => () => setTocados((t) => ({ ...t, [k]: true }));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocados({ nome: true, email: true, senha: true, empresa: true, cnpj: true, faixa: true, aceites: true });
    if (Object.values(erros).some(Boolean)) return;
    const pedido: CadastroEmpresaPedido = {
      empresa: { nome: empresa.trim(), ...(cnpj.trim() ? { cnpj: somenteDigitos(cnpj) } : {}), faixaUsuarios: faixa || undefined },
      ...(conta ? {} : { pessoa: { nome: nome.trim(), email: email.trim(), senha } }),
      aceites: { termos, dados },
    };
    setEnviando(true);
    setErro(null);
    try {
      aoCriar(await api.post<Eu>('/auth/cadastro', pedido));
    } catch (ex) {
      setErro(ex as ErroApiCliente);
    } finally {
      setEnviando(false);
    }
  };

  const erroSenha = mostrar('senha');
  return (
    <form className="stack-lg" onSubmit={enviar} noValidate aria-labelledby={`${id}-t`}>
      <div className="stack-sm">
        {primeiroAcesso ? <span className="eyebrow">Primeiro acesso</span> : null}
        <h1 className="h1" id={`${id}-t`}>
          {conta ? 'Criar outra empresa' : 'Crie o espaço da sua empresa'}
        </h1>
        <p className="muted body-lg">Um espaço isolado para o copiloto do seu sistema: roteiros, usuários, marca e dados só da sua empresa.</p>
        {conta ? (
          <p className="muted">
            Ele fica no seu acesso (<span className="strong">{conta.email}</span>), com você como Admin. Para voltar à empresa atual, use o
            menu da conta.
          </p>
        ) : primeiroAcesso ? (
          <p className="muted">Ninguém usa este copiloto ainda: você cria o primeiro espaço e fica como Admin dele.</p>
        ) : null}
      </div>

      {erro ? <ErroCadastro erro={erro} /> : null}

      {conta ? null : (
        <>
          <fieldset className="stack cc-fieldset">
            <legend className="eyebrow">Você</legend>
            <div className="grid-auto">
              <Campo rotulo="Seu nome" obrigatorio erro={mostrar('nome')}>
                {(p) => <input {...p} autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={tocar('nome')} autoFocus />}
              </Campo>
              <Campo rotulo="E-mail de trabalho" obrigatorio erro={mostrar('email')}>
                {(p) => (
                  <input
                    {...p}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={tocar('email')}
                    placeholder="nome@suaempresa.com.br"
                  />
                )}
              </Campo>
            </div>
            <div className="field">
              <label htmlFor={`${id}-senha`}>
                Senha{' '}
                <span className="req" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id={`${id}-senha`}
                className={`input${erroSenha ? ' is-error' : ''}`}
                type="password"
                autoComplete="new-password"
                value={senha}
                maxLength={200}
                aria-required
                aria-invalid={erroSenha ? true : undefined}
                aria-describedby={`${id}-regras`}
                onChange={(e) => setSenha(e.target.value)}
                onBlur={tocar('senha')}
              />
              <ul id={`${id}-regras`} className="row wrap tiny cc-regras">
                {regras.map((r) => (
                  <li key={r.rotulo} className={r.ok ? 'text-success' : erroSenha ? 'text-danger' : 'muted'}>
                    <Icone nome={r.ok ? 'check' : 'circulo'} tamanho="sm" />
                    {r.rotulo}
                    <span className="sr-only">{r.ok ? ': ok' : ': falta'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </fieldset>
          <hr className="divider" />
        </>
      )}

      <fieldset className="stack cc-fieldset">
        <legend className="eyebrow">Sua empresa</legend>
        <div className="grid-auto">
          <Campo rotulo="Nome da empresa" obrigatorio erro={mostrar('empresa')}>
            {(p) => (
              <input
                {...p}
                autoComplete="organization"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                onBlur={tocar('empresa')}
                placeholder="Ex.: Pedra Branca Distribuidora"
                autoFocus={!!conta}
              />
            )}
          </Campo>
          <Campo rotulo="CNPJ" erro={mostrar('cnpj')} ajuda="Usado na nota fiscal e no contrato.">
            {(p) => (
              <input
                {...p}
                className={`${p.className} num`}
                inputMode="numeric"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                onBlur={() => {
                  if (cnpjValido(cnpj)) setCnpj(formatarCnpj(cnpj));
                  tocar('cnpj')();
                }}
                placeholder="00.000.000/0000-00"
              />
            )}
          </Campo>
        </div>
        <Campo
          rotulo="Quantas pessoas usam o seu sistema"
          obrigatorio
          classe="select"
          erro={mostrar('faixa')}
          ajuda="Conta quem usa o seu sistema e poderá falar com o copiloto, não só o seu time. Define a faixa do plano e pode mudar depois."
        >
          {(p) => (
            <select {...p} style={{ maxWidth: 360 }} value={faixa} onChange={(e) => setFaixa(e.target.value as FaixaUsuarios)} onBlur={tocar('faixa')}>
              <option value="">Escolha uma faixa</option>
              {FAIXAS.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FAIXA_USUARIOS[f]}
                </option>
              ))}
            </select>
          )}
        </Campo>
      </fieldset>

      <hr className="divider" />

      <div className="stack-sm">
        <label className="check">
          <input type="checkbox" checked={termos} onChange={(e) => setTermos(e.target.checked)} />
          <span className="small">
            Li e aceito os{' '}
            <a href="/termos" target="_blank" rel="noopener noreferrer">
              Termos de uso
            </a>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={dados} onChange={(e) => setDados(e.target.checked)} />
          <span className="small">
            Li e aceito o{' '}
            <a href="/contrato-lgpd" target="_blank" rel="noopener noreferrer">
              Contrato de tratamento de dados (LGPD)
            </a>
            , que define a Starta como operadora dos dados dos seus clientes
          </span>
        </label>
        {mostrar('aceites') ? (
          <span className="error-text" role="alert">
            <Icone nome="alerta" tamanho="sm" />
            {erros.aceites}
          </span>
        ) : null}
      </div>

      <div className="row wrap between" style={{ gap: 'var(--s-4)' }}>
        <Botao type="submit" variante="primario" tamanho="lg" iconeDepois="seta-direita" carregando={enviando}>
          Criar espaço
        </Botao>
        {conta ? (
          <p className="small muted">
            Mudou de ideia? <Link to="/">Voltar ao console</Link>
          </p>
        ) : null}
      </div>
    </form>
  );
}

function ErroCadastro({ erro }: { erro: ErroApiCliente }) {
  if (erro.erro === 'conta_existente') {
    return (
      <Aviso tipo="aviso" papel="alert" titulo="Este e-mail já tem acesso ao copiloto">
        Digite a senha que você já usa para entrar. Ou <Link to="/entrar">entre no console</Link> e crie a empresa pelo menu da conta, em
        “Criar outra empresa”.
      </Aviso>
    );
  }
  if (erro.erro === 'cadastro_fechado') {
    return (
      <Aviso tipo="erro" papel="alert" titulo="O cadastro de empresas novas está fechado">
        {erro.message} Se a sua empresa já usa o copiloto, peça um convite a um Admin dela.
      </Aviso>
    );
  }
  return (
    <Aviso tipo="erro" papel="alert">
      {erro.offline ? 'Sem conexão. Confira a internet e tente de novo.' : erro.message}
    </Aviso>
  );
}

/** Painel ao lado da etapa 1. */
export function OQueAconteceDepois() {
  const id = useId();
  const passos = [
    {
      titulo: 'Conecte o seu sistema',
      texto: 'Informe o endereço e escolha como o copiloto entra: com a sessão de quem pede ou com uma conta de serviço.',
    },
    { titulo: 'Dê a sua cara ao assistente', texto: 'Nome, cor e primeira mensagem. Seus clientes veem a sua marca, não a nossa.' },
    { titulo: 'Grave a primeira tarefa', texto: 'Você faz a tarefa uma vez no sistema e o copiloto aprende a repetir, com a confirmação de quem pede.' },
  ];
  return (
    <aside className="side-col stack-lg cc-depois" aria-labelledby={id}>
      <h2 id={id} className="h3">
        O que acontece depois
      </h2>
      <ol className="steps">
        {passos.map((p, i) => (
          <li key={p.titulo} className="step">
            <span className="step-dot" aria-hidden="true">
              {i + 1}
            </span>
            <div className="stack-sm" style={{ gap: 2, paddingBottom: i < passos.length - 1 ? 'var(--s-2)' : 0 }}>
              <span className="strong">{p.titulo}</span>
              <span className="small">{p.texto}</span>
            </div>
          </li>
        ))}
      </ol>
      <hr className="divider" />
      <div className="row-top" style={{ gap: 'var(--s-3)' }}>
        <Icone nome="cadeado" />
        <p className="small">Nada é cobrado agora.</p>
      </div>
    </aside>
  );
}

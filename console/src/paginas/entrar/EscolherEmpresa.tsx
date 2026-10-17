// A2 · Em qual empresa você quer entrar? Vem da entrada (as empresas e os avisos chegam no estado da
// navegação) ou de "Trocar de empresa" no menu da conta (GET /auth/empresas). A sessão já está aberta
// na primeira da lista, a usada por último; escolher outra chama POST /auth/empresa. Conta sem
// nenhuma empresa (a entrada não abriu sessão): explica como voltar a entrar.
import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, ROTULO_PERFIL, type EmpresaDaConta, type Eu } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { destinoDepoisDeEntrar, quandoMinusculo, type EstadoEscolha } from './pecas.tsx';
import TelaDeEntrada from './TelaDeEntrada.tsx';

interface Escolha {
  empresas: EmpresaDaConta[];
  avisos: string[];
  pessoa: { nome: string | null; email: string; iniciais: string };
  /** Empresa em que a sessão já está aberta; null quando a entrada não abriu sessão (nenhuma empresa). */
  aberta: string | null;
}

function escolhaDaEntrada({ entrada, email }: EstadoEscolha): Escolha {
  const { eu } = entrada;
  return {
    empresas: entrada.empresas,
    avisos: entrada.avisos,
    pessoa: eu
      ? { nome: eu.nome, email: eu.email, iniciais: eu.iniciais }
      : { nome: null, email, iniciais: fmt.iniciais(email.split('@')[0].replace(/[._-]+/g, ' ')) },
    aberta: eu?.empresa.id ?? null,
  };
}

/** "Seu acesso à Vetor CRM foi removido por um Admin dessa empresa." */
function Avisos({ avisos }: { avisos: string[] }) {
  return avisos.map((a) => (
    <div key={a} className="alert" role="status">
      <Icone nome="info" />
      <p className="small">{a}</p>
    </div>
  ));
}

function SemEmpresa({ avisos }: { avisos: string[] }) {
  return (
    <div className="stack">
      <h1 className="h2">Sua conta não está em nenhuma empresa agora</h1>
      <Avisos avisos={avisos} />
      <p className="small muted">
        Para entrar, peça a um Admin da sua empresa um convite em Equipe e limites. Se a sua empresa ainda não usa o Copiloto, você pode criar a
        conta dela.
      </p>
      <Link className="btn btn-primary btn-lg btn-block" to="/criar-conta">
        Criar conta da empresa
      </Link>
      <Link className="btn btn-ghost btn-block" to="/entrar">
        Entrar com outra conta
      </Link>
    </div>
  );
}

export default function EscolherEmpresa() {
  const id = useId();
  const navegar = useNavigate();
  const { state } = useLocation();
  const [busca] = useSearchParams();
  const destino = destinoDepoisDeEntrar(busca.get('voltar'));
  const daEntrada = (state as EstadoEscolha | null)?.entrada ? (state as EstadoEscolha) : null;
  const [escolha, setEscolha] = useState<Escolha | null>(() => (daEntrada ? escolhaDaEntrada(daEntrada) : null));
  const [erroCarga, setErroCarga] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Escolher empresa · Copiloto Starta';
  }, []);

  // Sem o estado da entrada ("Trocar de empresa" ou a página recarregada): pergunta ao servidor.
  useEffect(() => {
    if (escolha) return;
    let vivo = true;
    Promise.all([api.get<{ empresas: EmpresaDaConta[]; avisos: string[] }>('/auth/empresas'), api.get<Eu>('/auth/eu')])
      .then(([r, eu]) => {
        if (!vivo) return;
        setEscolha({ ...r, pessoa: { nome: eu.nome, email: eu.email, iniciais: eu.iniciais }, aberta: eu.empresa.id });
        setErroCarga(null);
      })
      .catch((e: ErroApiCliente) => {
        if (!vivo) return;
        if (e.status === 401) navegar('/entrar', { replace: true });
        else setErroCarga(e);
      });
    return () => {
      vivo = false;
    };
  }, [escolha, tentativa, navegar]);

  const sair = async () => {
    await api.post('/auth/sair').catch(() => {});
    navegar('/entrar', { replace: true });
  };

  const escolher = async (e: EmpresaDaConta) => {
    setAbrindo(e.id);
    setErro(null);
    try {
      if (e.id !== escolha?.aberta) await api.post<Eu>('/auth/empresa', { empresaId: e.id });
      navegar(destino, { replace: true });
    } catch (ex) {
      setErro(`Não consegui abrir ${e.nome}. ${(ex as ErroApiCliente).message}`);
      setAbrindo(null);
    }
  };

  const direita = escolha ? (
    <div className="row" style={{ gap: 'var(--s-3)' }}>
      <span className="avatar avatar-sm" aria-hidden="true">
        {escolha.pessoa.iniciais}
      </span>
      <span className="small muted hide-sm">{escolha.pessoa.email}</span>
      {escolha.aberta ? (
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void sair()}>
          Sair
        </button>
      ) : null}
    </div>
  ) : null;

  if (!escolha) {
    return (
      <TelaDeEntrada>
        {erroCarga ? (
          <EstadoErro erro={erroCarga} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui carregar as suas empresas" />
        ) : (
          <Carregando />
        )}
      </TelaDeEntrada>
    );
  }

  if (!escolha.empresas.length) {
    return (
      <TelaDeEntrada direita={direita}>
        <SemEmpresa avisos={escolha.avisos} />
      </TelaDeEntrada>
    );
  }

  const { empresas, pessoa } = escolha;
  return (
    <TelaDeEntrada direita={direita}>
      <section className="stack" aria-labelledby={`${id}-t`}>
        <div className="stack-sm">
          <h1 id={`${id}-t`} className="h2">
            {pessoa.nome ? `Olá, ${fmt.primeiroNome(pessoa.nome)}. ` : ''}Em qual empresa você quer entrar?
          </h1>
          {empresas.length > 1 ? (
            <p className="muted">Você faz parte de {empresas.length} empresas. Depois dá para trocar pelo seletor no topo do menu.</p>
          ) : null}
        </div>
        <Avisos avisos={escolha.avisos} />
        {erro ? (
          <Aviso tipo="erro" papel="alert">
            {erro}
          </Aviso>
        ) : null}
        <ul className="stack-sm ce-empresas" aria-labelledby={`${id}-t`}>
          {empresas.map((e, i) => (
            <li key={e.id}>
              <button
                type="button"
                className={`row ce-empresa${i === 0 ? ' ce-empresa-recente' : ''}`}
                disabled={!!abrindo}
                aria-busy={abrindo === e.id || undefined}
                onClick={() => void escolher(e)}
              >
                <span className="avatar" aria-hidden="true">
                  {e.iniciais}
                </span>
                <span className="stack-sm grow" style={{ gap: 2 }}>
                  <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                    <span className="strong">{e.nome}</span>
                    <span className="badge badge-outline">{ROTULO_PERFIL[e.perfil]}</span>
                    {e.demo ? <span className="badge badge-accent">Demonstração</span> : null}
                  </span>
                  {e.ultimoAcesso ? <span className="tiny muted">Último acesso: {quandoMinusculo(e.ultimoAcesso)}</span> : null}
                </span>
                <Icone nome="seta-direita" className={i === 0 ? 'text-brand' : 'muted'} />
              </button>
            </li>
          ))}
        </ul>
        <hr className="divider" />
        <p className="small muted" style={{ textAlign: 'center' }}>
          Não é você?{' '}
          <button type="button" className="ce-link strong" onClick={() => void sair()}>
            Entrar com outra conta
          </button>
        </p>
      </section>
    </TelaDeEntrada>
  );
}

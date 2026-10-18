// Entrada da extensão do navegador (/extensao/conectar?estado=…&desafio=…[&empresa=…]). A extensão abre
// esta página quando a pessoa clica em "Entrar com a conta do Copiloto" (ou "Trocar") no ícone do
// gravador. Com a sessão do console, a pessoa escolhe a empresa; o console pede ao servidor um código
// de uso único (preso à conta, à empresa e ao desafio da extensão) e entrega à extensão nesta aba,
// por window.postMessage. Quem troca o código pelo token é a extensão, com o verificador que só ela tem.
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ROTULO_PERFIL, pode, type CodigoExtensao, type ConexaoExtensao, type EmpresaDaConta, type Eu } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import TelaDeEntrada from '../entrar/TelaDeEntrada.tsx';
import { perguntarExtensao, versaoNaPagina } from './ponte.ts';
import './extensao.css';

const DESAFIO = /^[A-Za-z0-9_-]{43}$/;
const ESTADO = /^[A-Za-z0-9_-]{16,200}$/;

interface Dados {
  empresas: EmpresaDaConta[];
  eu: Eu;
}

/** A empresa que já vem marcada: a pedida pela extensão ("Trocar"), a aberta no console, ou a primeira que grava. */
export function empresaInicial(empresas: EmpresaDaConta[], pedida: string | null, aberta: string | null): string | null {
  const grava = (id: string | null) => !!id && empresas.some((e) => e.id === id && pode(e.perfil, 'editar'));
  if (grava(pedida)) return pedida;
  if (grava(aberta)) return aberta;
  return empresas.find((e) => pode(e.perfil, 'editar'))?.id ?? null;
}

export default function Conectar() {
  const id = useId();
  const navegar = useNavigate();
  const [busca] = useSearchParams();
  const estado = busca.get('estado') ?? '';
  const desafio = busca.get('desafio') ?? '';
  const pedida = busca.get('empresa');
  const enderecoValido = ESTADO.test(estado) && DESAFIO.test(desafio);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erroCarga, setErroCarga] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conectada, setConectada] = useState<ConexaoExtensao | null>(null);
  const [semExtensao, setSemExtensao] = useState(false);

  useEffect(() => {
    document.title = 'Conectar o gravador · Copiloto Starta';
  }, []);

  useEffect(() => {
    if (!enderecoValido) return;
    let vivo = true;
    Promise.all([api.get<{ empresas: EmpresaDaConta[] }>('/auth/empresas'), api.get<Eu>('/auth/eu')])
      .then(([r, eu]) => {
        if (!vivo) return;
        setDados({ empresas: r.empresas, eu });
        setEscolhida((atual) => atual ?? empresaInicial(r.empresas, pedida, eu.empresa.id));
        setErroCarga(null);
      })
      .catch((e: ErroApiCliente) => {
        if (!vivo) return;
        // Sem sessão: entra no console e volta para cá (o pedido da extensão vale 15 minutos).
        if (e.status === 401) navegar(`/entrar?voltar=${encodeURIComponent(`/extensao/conectar?${busca.toString()}`)}`, { replace: true });
        else setErroCarga(e);
      });
    return () => {
      vivo = false;
    };
  }, [enderecoValido, tentativa, pedida, navegar, busca]);

  // A extensão marca a página logo no início; sem a marca depois de uns segundos, avisa.
  useEffect(() => {
    if (versaoNaPagina()) return;
    const t = setTimeout(() => setSemExtensao(!versaoNaPagina()), 2500);
    return () => clearTimeout(t);
  }, []);

  const conectar = async () => {
    if (!escolhida || !dados) return;
    setEnviando(true);
    setErro(null);
    try {
      const c = await api.post<CodigoExtensao>('/extensao/codigo', { empresaId: escolhida, desafio });
      const r = await perguntarExtensao({ tipo: 'extensao:conectar', estado, codigo: c.codigo }, 20_000);
      if (!r || r.tipo !== 'extensao:conectada') {
        setErro('A extensão não respondeu nesta aba. Confira se ela está instalada e ativa, recarregue a página e tente de novo.');
      } else if (r.ok) {
        setConectada(r.conexao);
      } else {
        setErro(r.mensagem);
      }
    } catch (e) {
      setErro((e as ErroApiCliente).message);
    } finally {
      setEnviando(false);
    }
  };

  if (!enderecoValido) {
    return (
      <TelaDeEntrada>
        <div className="stack">
          <span className="ce-icone-aviso" aria-hidden="true">
            <Icone nome="alerta" tamanho="lg" />
          </span>
          <h1 className="h2">Este endereço de entrada está incompleto</h1>
          <p className="muted">Para conectar o gravador, clique no ícone dele no navegador e em Entrar com a conta do Copiloto. Ele abre esta página do jeito certo.</p>
          <Link className="btn btn-secondary btn-block" to="/aprender/instalar">
            Ver como instalar o gravador
          </Link>
        </div>
      </TelaDeEntrada>
    );
  }

  if (conectada) {
    return (
      <TelaDeEntrada>
        <div className="stack" role="status" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className="ex-conectado" aria-hidden="true">
            <Icone nome="check" tamanho="lg" />
          </span>
          <h1 className="h2">Gravador conectado</h1>
          <p>
            Ele entrou como <span className="strong">{conectada.pessoa.nome}</span>, na <span className="strong">{conectada.empresa.nome}</span>. As gravações feitas pelo
            ícone vão só para ela.
          </p>
          <p className="small muted">Pode fechar esta aba. Na tela do sistema, clique no ícone do gravador e em Gravar esta aba.</p>
          <div className="stack-sm" style={{ width: '100%' }}>
            <Botao variante="primario" bloco onClick={() => window.close()}>
              Fechar esta aba
            </Botao>
            <Link className="btn btn-ghost btn-block" to="/aprender">
              Ir para Aprender fluxo
            </Link>
          </div>
        </div>
      </TelaDeEntrada>
    );
  }

  if (!dados) {
    return (
      <TelaDeEntrada>
        {erroCarga ? <EstadoErro erro={erroCarga} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui carregar as suas empresas" /> : <Carregando />}
      </TelaDeEntrada>
    );
  }

  const { empresas, eu } = dados;
  const algumaGrava = empresas.some((e) => pode(e.perfil, 'editar'));
  const direita = (
    <div className="row" style={{ gap: 'var(--s-3)' }}>
      <span className="avatar avatar-sm" aria-hidden="true">
        {eu.iniciais}
      </span>
      <span className="small muted hide-sm">{eu.email}</span>
    </div>
  );

  return (
    <TelaDeEntrada
      direita={direita}
      rodape={<p className="tiny muted">O gravador não vê a sua senha. Ele recebe um acesso próprio, que só serve para gravar e acaba quando você clica em Sair nele.</p>}
    >
      <section className="stack" aria-labelledby={`${id}-t`}>
        <div className="stack-sm">
          <span className="row" style={{ gap: 10 }}>
            <span className="ex-icone-s" aria-hidden="true">
              S
            </span>
            <span className="small strong">Copiloto · Gravador de fluxos</span>
          </span>
          <h1 id={`${id}-t`} className="h2">
            Para qual empresa vão as gravações?
          </h1>
          <p className="muted">
            O gravador vai entrar como {eu.nome} ({eu.email}). Escolha a empresa: as gravações feitas pelo ícone vão só para ela.
          </p>
        </div>
        {semExtensao ? (
          <Aviso tipo="aviso" titulo="Não encontrei o gravador nesta aba">
            Confira se a extensão Copiloto · Gravador de fluxos está instalada e ativa e recarregue esta página.
          </Aviso>
        ) : null}
        {!algumaGrava ? (
          <Aviso tipo="aviso" titulo="Seu perfil não permite gravar fluxos">
            Quem grava são Admin e Editor de tarefas. Peça a um admin da empresa para mudar o seu perfil em Equipe e limites.
          </Aviso>
        ) : null}
        {erro ? (
          <Aviso tipo="erro" papel="alert">
            {erro}
          </Aviso>
        ) : null}
        <ul className="ex-conectar-empresas" role="radiogroup" aria-labelledby={`${id}-t`}>
          {empresas.map((e) => {
            const grava = pode(e.perfil, 'editar');
            return (
              <li key={e.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={escolhida === e.id}
                  className="row ex-empresa"
                  disabled={!grava || enviando}
                  onClick={() => setEscolhida(e.id)}
                >
                  <span className="ex-radio" aria-hidden="true" />
                  <span className="avatar avatar-sm" aria-hidden="true">
                    {e.iniciais}
                  </span>
                  <span className="stack-sm grow" style={{ gap: 2 }}>
                    <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                      <span className="strong">{e.nome}</span>
                      {e.demo ? <span className="badge badge-accent">Demonstração</span> : null}
                    </span>
                    <span className="tiny muted">{grava ? ROTULO_PERFIL[e.perfil] : `${ROTULO_PERFIL[e.perfil]}: este perfil não grava fluxos`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <Botao variante="primario" tamanho="lg" bloco carregando={enviando} disabled={!escolhida || !algumaGrava} onClick={() => void conectar()}>
          Conectar o gravador
        </Botao>
      </section>
    </TelaDeEntrada>
  );
}

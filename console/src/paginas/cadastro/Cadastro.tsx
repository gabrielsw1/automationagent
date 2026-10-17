// Cadastro de uma empresa nova em três etapas: /criar-conta (Sua conta), /criar-conta/sistema
// (Seu sistema) e /criar-conta/marca (Sua marca). A etapa 1 cria a empresa e abre a sessão nela;
// as outras duas já rodam logadas, então recarregar a página no meio continua de onde parou.
// Conta nova confirma o e-mail com o código (A5) antes da etapa 2: enquanto não confirma, qualquer
// etapa mostra a confirmação. Também é o "Criar outra empresa" do menu da conta: logado, a etapa 1
// não pede o acesso.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Eu, PrimeiroAcesso } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Progresso } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { FaixaSemInternet } from '../../layout/Faixas.tsx';
import TelaDeEntrada, { TopoDeAcesso } from '../entrar/TelaDeEntrada.tsx';
import ConfirmarEmail from './ConfirmarEmail.tsx';
import EtapaEmpresa, { OQueAconteceDepois } from './EtapaEmpresa.tsx';
import EtapaMarca from './EtapaMarca.tsx';
import EtapaSistema from './EtapaSistema.tsx';
import './cadastro.css';

const ETAPAS = { '': 1, sistema: 2, marca: 3 } as const;

function TelaDeCadastro({ direita, children }: { direita?: ReactNode; children: ReactNode }) {
  return (
    <>
      <FaixaSemInternet />
      <div className="cc-tela">
        <TopoDeAcesso direita={direita} />
        <main className="cc-main">{children}</main>
      </div>
    </>
  );
}

/**
 * "Sua conta / Seu sistema / Sua marca", "Etapa N de 3" e a barra de progresso. `compacto`: no
 * cartão estreito da confirmação do e-mail (A5).
 */
export function IndicadorEtapas({
  atual,
  primeira,
  detalhe,
  compacto,
}: {
  atual: 1 | 2 | 3;
  primeira: string;
  detalhe?: string;
  compacto?: boolean;
}) {
  const nomes = [primeira, 'Seu sistema', 'Sua marca'];
  return (
    <div className="stack">
      <div className="row between wrap">
        <ol className={`row wrap cc-etapas${compacto ? ' cc-etapas-compacto' : ''}`} aria-label="Etapas do cadastro">
          {nomes.map((n, i) => {
            const num = i + 1;
            const feita = num < atual;
            const ativa = num === atual;
            return (
              <li key={n} className={`step${feita ? ' done' : ''}${ativa ? ' active' : ''}`} aria-current={ativa ? 'step' : undefined}>
                <span className="step-dot" aria-hidden="true">
                  {feita ? <Icone nome="check" tamanho="sm" /> : num}
                </span>
                <span className={`small${ativa ? ' strong' : feita ? '' : ' muted'}`}>
                  {n}
                  {feita ? <span className="sr-only"> (concluída)</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
        <span className="tiny muted">
          Etapa {atual} de 3{detalhe ? ` · ${detalhe}` : ''}
        </span>
      </div>
      <Progresso valor={atual / 3} rotulo="Progresso do cadastro" />
    </div>
  );
}

export default function Cadastro() {
  const { etapa = '' } = useParams();
  const navegar = useNavigate();
  const [estado, setEstado] = useState<{ acesso: PrimeiroAcesso; eu: Eu | null } | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  // Conta logada antes de começar (só na etapa 1: depois dela, todo mundo está logado).
  const [logadoAntes, setLogadoAntes] = useState(false);
  const numero = ETAPAS[etapa as keyof typeof ETAPAS] ?? 1;

  useEffect(() => {
    let vivo = true;
    // Sem sessão, /auth/eu responde 401: a etapa 1 pede o acesso de quem cria.
    Promise.all([
      api.get<PrimeiroAcesso>('/auth/primeiro-acesso'),
      api.get<Eu>('/auth/eu').catch((e: ErroApiCliente) => {
        if (e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([acesso, eu]) => {
        if (!vivo) return;
        setEstado({ acesso, eu });
        // Conta ainda sem o e-mail confirmado está no meio do próprio cadastro (etapa 1 de "Sua conta").
        setLogadoAntes(!!eu?.emailConfirmado);
        setErro(null);
      })
      .catch((e: ErroApiCliente) => vivo && setErro(e));
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  const confirmando = !!estado?.eu && !estado.eu.emailConfirmado;
  useEffect(() => {
    document.title = `${confirmando ? 'Confirmar e-mail' : numero === 1 && logadoAntes ? 'Criar outra empresa' : 'Criar espaço'} · Copiloto Starta`;
  }, [numero, logadoAntes, confirmando]);

  if (erro && !estado) {
    return (
      <TelaDeCadastro>
        <EstadoErro erro={erro} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui falar com o servidor do copiloto" />
      </TelaDeCadastro>
    );
  }
  if (!estado) {
    return (
      <TelaDeCadastro>
        <Carregando />
      </TelaDeCadastro>
    );
  }

  const { acesso, eu } = estado;
  if (confirmando) {
    return (
      <TelaDeEntrada
        direita={
          <p className="small muted">
            Já tem uma conta?{' '}
            <Link className="strong" to="/entrar">
              Entrar
            </Link>
          </p>
        }
      >
        <div className="stack-lg">
          <IndicadorEtapas atual={1} primeira="Sua conta" compacto />
          <ConfirmarEmail
            aoConfirmar={(confirmado) => {
              setEstado({ acesso, eu: confirmado });
              navegar('/criar-conta/sistema');
            }}
          />
        </div>
      </TelaDeEntrada>
    );
  }
  // Etapas 2 e 3 precisam da sessão na empresa nova.
  if (numero > 1 && !eu) return <Navigate to={`/entrar?voltar=${encodeURIComponent(`/criar-conta/${etapa}`)}`} replace />;

  if (numero === 1) {
    const fechado = !eu && !acesso.cadastroAberto && !acesso.precisaCriarAdmin;
    return (
      <TelaDeCadastro
        direita={
          eu ? (
            <Link className="small strong" to="/">
              Voltar ao console
            </Link>
          ) : (
            <p className="small muted">
              Já tem uma conta?{' '}
              <Link className="strong" to="/entrar">
                Entrar
              </Link>
            </p>
          )
        }
      >
        {fechado ? (
          <section className="card card-pad stack" style={{ maxWidth: 560 }}>
            <h1 className="h2">O cadastro de empresas novas está fechado</h1>
            <p className="muted">
              Neste copiloto, só quem administra cria empresas novas. Se a sua empresa já usa o copiloto, peça um convite a um Admin dela.
            </p>
            <Link className="btn btn-secondary" to="/entrar" style={{ alignSelf: 'flex-start' }}>
              Ir para a tela de entrada
            </Link>
          </section>
        ) : (
          <div className="split">
            <section className="main-col card" aria-label="Criar o espaço da empresa">
              <div className="card-body stack-lg">
                <IndicadorEtapas atual={1} primeira={eu ? 'Sua empresa' : 'Sua conta'} />
                <EtapaEmpresa
                  conta={eu}
                  primeiroAcesso={acesso.precisaCriarAdmin}
                  aoCriar={(novo) => {
                    setEstado({ acesso: { ...acesso, precisaCriarAdmin: false }, eu: novo });
                    // Conta nova: o código do e-mail aparece aqui mesmo, antes de "Seu sistema".
                    if (novo.emailConfirmado) navegar('/criar-conta/sistema');
                  }}
                />
              </div>
            </section>
            <OQueAconteceDepois />
          </div>
        )}
      </TelaDeCadastro>
    );
  }

  const conta = eu!;
  return (
    <TelaDeCadastro
      direita={
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <span className="small muted cc-topo-empresa">{conta.empresa.nome}</span>
          <span className="avatar" title={conta.nome}>
            {conta.iniciais}
            <span className="sr-only">{conta.nome}</span>
          </span>
        </div>
      }
    >
      <IndicadorEtapas
        atual={numero}
        primeira={logadoAntes ? 'Sua empresa' : 'Sua conta'}
        detalhe={numero === 2 ? `espaço “${conta.empresa.nome}” criado` : undefined}
      />
      {numero === 2 ? (
        <EtapaSistema eu={conta} aoContinuar={() => navegar('/criar-conta/marca')} />
      ) : (
        <EtapaMarca eu={conta} aoVoltar={() => navegar('/criar-conta/sistema')} />
      )}
    </TelaDeCadastro>
  );
}

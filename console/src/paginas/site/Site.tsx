// Site do produto (S1 · Site do produto), servido pelo próprio console em /site. Público: não pede
// sessão. Os planos vêm da tabela de planos (GET /api/publico/planos); "Começar piloto" leva ao
// cadastro e "Agendar demonstração" e "Falar com vendas" abrem o pedido de contato.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { OrigemContato, PlanosPublicos } from '@copiloto/shared';
import { apiPublica, type ErroApiCliente } from '../../api/cliente.ts';
import { Icone } from '../../componentes/icones.tsx';
import { AssistenteNoSistema, MiniGravando, MiniRecibo, MiniTarefas } from './Ilustracoes.tsx';
import { Rodape, Topo } from './moldura.tsx';
import { PedidoContato } from './PedidoContato.tsx';
import { BotaoComecarPiloto, SecaoPlanos } from './Planos.tsx';
import './site.css';

const PROVAS = ['Piloto com implantação assistida', 'Dados isolados por empresa', 'Contrato de tratamento de dados (LGPD)'];

const PASSOS: { etapa: string; titulo: string; texto: string; ilustracao: ReactNode }[] = [
  {
    etapa: 'Grave',
    titulo: 'A extensão aprende a tarefa vendo você fazer uma vez',
    texto:
      'Instale a extensão no Chrome ou no Edge, abra a tela do seu sistema e faça o caminho normalmente. Ela grava cliques e trocas de página. Do que você digita, guarda só o formato, nunca o valor.',
    ilustracao: <MiniGravando />,
  },
  {
    etapa: 'Configure',
    titulo: 'Diga o que o copiloto pode fazer, com a sua marca',
    texto:
      'Revise os passos, marque o que o cliente vai informar, teste como um usuário real e publique. Escolha nome, cor e logo do assistente. Cada tarefa tem quem pode pedir e o que é obrigatório.',
    ilustracao: <MiniTarefas />,
  },
  {
    etapa: 'Execute',
    titulo: 'O cliente pede, confirma e o copiloto faz pela tela',
    texto:
      'O copiloto pergunta o que faltar e mostra um cartão para confirmar. Depois executa num navegador na nuvem, com a sessão de quem pediu, e devolve um recibo com o número do registro.',
    ilustracao: <MiniRecibo />,
  },
];

const svg = (corpo: ReactNode) => (
  <svg className="i" viewBox="0 0 24 24">
    {corpo}
  </svg>
);

const SEGURANCA: { icone: ReactNode; titulo: string; texto: string }[] = [
  {
    icone: <Icone nome="check" />,
    titulo: 'Nada grava sem confirmação',
    texto: 'Antes de criar ou alterar qualquer coisa, o cliente vê os dados num cartão e toca em “Confirmar e executar”.',
  },
  {
    icone: <Icone nome="pessoa" />,
    titulo: 'Age com as permissões de quem pede',
    texto: 'Entra no sistema com a sessão do próprio cliente. Se ele não pode fazer algo, o copiloto explica e oferece pedir a quem pode.',
  },
  {
    icone: <Icone nome="navegador" />,
    titulo: 'Dados isolados por empresa',
    texto:
      'Roteiros, navegadores, usuários e conversas de cada empresa ficam no espaço dela. A Starta vê métricas de uso, não as conversas.',
  },
  {
    icone: <Icone nome="cadeado" />,
    titulo: 'Senhas nunca são gravadas',
    texto: 'A extensão ignora campos de senha. Se você usar uma conta de serviço, a senha fica num cofre e nunca vai para a IA.',
  },
  {
    icone: svg(
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="M21 17l-5-5-9 8" />
      </>,
    ),
    titulo: 'Histórico com prints e LGPD',
    texto:
      'Cada execução guarda as etapas e os prints, com dados sensíveis borrados. Você define por quanto tempo guardar e assina o contrato de tratamento de dados.',
  },
];

const PERGUNTAS: [string, string][] = [
  [
    'Meu sistema precisa ter API?',
    'Não. O copiloto opera a tela do seu sistema pelo roteiro gravado com a extensão. Se uma tarefa já tem API, você pode ligar o Conector por API como atalho, mas não é obrigatório.',
  ],
  [
    'O copiloto vê a senha dos meus clientes?',
    'Não. O navegador na nuvem usa a sessão de quem pediu, assinada pelo seu sistema. Se preferir uma conta de serviço, a senha fica num cofre e nunca é enviada para a IA.',
  ],
  [
    'O que acontece se os créditos acabarem?',
    'Avisamos antes, com a data prevista. Você compra um pacote, liga a recarga automática ou escolhe pausar as tarefas. Pausado, o assistente continua respondendo dúvidas e oferece falar com uma pessoa.',
  ],
  [
    'Em quais navegadores funciona?',
    'Seus clientes usam o assistente em qualquer navegador moderno, dentro do seu sistema. Para gravar tarefas, seu time usa a extensão no Chrome ou no Edge.',
  ],
];

/** GET /api/publico/planos com estado de erro e "Tentar de novo". */
function usePlanos() {
  const [dados, setDados] = useState<PlanosPublicos | undefined>(undefined);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await apiPublica.get<PlanosPublicos>('/planos'));
    } catch (e) {
      setErro(e as ErroApiCliente);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { dados, erro, carregar };
}

export default function Site() {
  const { hash } = useLocation();
  const planos = usePlanos();
  const [pedido, setPedido] = useState<OrigemContato | null>(null);
  const cadastroAberto = planos.dados?.cadastroAberto ?? true;
  const agendar = () => setPedido('demonstracao');

  useEffect(() => {
    document.title = 'Copiloto Starta';
  }, []);

  // Vindo de outra página com /site#planos: rola até a seção.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [hash]);

  return (
    <div className="st">
      <Topo noSite aoAgendar={agendar} />

      <main>
        <section aria-labelledby="t-hero" className="st-hero">
          <div className="st-dentro grid-2 st-hero-grade">
            <div className="stack-lg">
              <span className="eyebrow st-marcador">Para empresas de software web</span>
              <h1 id="t-hero" className="display">
                Um copiloto que faz o trabalho dentro do seu sistema, pelos seus clientes
              </h1>
              <p className="body-lg st-hero-texto">
                Seus clientes pedem em português, no assistente com a sua marca. O copiloto pergunta o que faltar, mostra os dados para
                confirmar e executa na tela do seu sistema, com o acesso de quem pediu. Não precisa esperar uma API nova.
              </p>
              <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
                <button type="button" className="btn btn-primary btn-lg" onClick={agendar}>
                  Agendar demonstração
                </button>
                <a className="btn btn-secondary btn-lg" href="#como-funciona">
                  <Icone nome="play" />
                  Ver como funciona
                </a>
              </div>
              <ul className="row wrap small st-lista st-provas">
                {PROVAS.map((p) => (
                  <li key={p} className="row">
                    <Icone nome="check" tamanho="sm" className="text-success" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <AssistenteNoSistema />
          </div>
        </section>

        <section id="como-funciona" aria-labelledby="t-como" className="st-dentro st-secao">
          <div className="stack-lg">
            <div className="stack-sm st-cabeca">
              <span className="eyebrow st-marcador">Como funciona</span>
              <h2 id="t-como" className="h1">
                Você mostra uma vez. O copiloto repete quantas vezes seus clientes pedirem.
              </h2>
            </div>
            <ol className="grid-auto st-lista st-passos">
              {PASSOS.map((p, i) => (
                <li key={p.etapa} className="card card-pad stack">
                  <div className="row">
                    <span className="avatar" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="eyebrow">{p.etapa}</span>
                  </div>
                  <h3 className="h3">{p.titulo}</h3>
                  <p className="muted">{p.texto}</p>
                  {p.ilustracao}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="seguranca" aria-labelledby="t-seg" className="st-faixa">
          <div className="st-dentro st-secao stack-lg">
            <div className="stack-sm st-cabeca">
              <span className="eyebrow st-marcador">Por que é seguro</span>
              <h2 id="t-seg" className="h1">
                O copiloto nunca faz o que o seu cliente não faria
              </h2>
              <p className="body-lg muted">Regras que valem para toda empresa e não podem ser desligadas.</p>
            </div>
            <ul className="grid-auto st-lista">
              {SEGURANCA.map((s) => (
                <li key={s.titulo} className="card card-pad stack-sm">
                  <span aria-hidden="true" className="st-icone-seguro">
                    {s.icone}
                  </span>
                  <h3 className="h4">{s.titulo}</h3>
                  <p className="small muted">{s.texto}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="t-muda" className="st-dentro st-secao">
          <div className="grid-2 st-muda">
            <div className="stack-lg">
              <div className="stack-sm">
                <span className="eyebrow st-marcador">Quando a tela muda</span>
                <h2 id="t-muda" className="h1">
                  O roteiro faz o dia a dia. O agente visual só entra quando precisa.
                </h2>
              </div>
              <p className="body-lg st-corpo">
                Cada tarefa roda por um roteiro gravado: o copiloto repete os passos que você mostrou, sem pensar de novo a cada pedido. É
                rápido e gasta 1 crédito.
              </p>
              <p className="body-lg st-corpo">
                Se o seu time muda a tela e o roteiro não encontra o que esperava, ele para antes de gravar. O agente visual olha a tela,
                encontra o caminho novo e conclui o pedido. Depois, propõe atualizar o roteiro.
              </p>
              <div className="card-flat row-top st-porque">
                <svg className="i i-lg" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="6" width="18" height="14" rx="2" />
                  <path d="M3 10h18M16 15h2" />
                </svg>
                <div className="stack-sm" style={{ gap: 4 }}>
                  <span className="strong">Por que isso deixa a tarefa mais barata</span>
                  <span className="small muted">
                    Olhar a tela e decidir custa mais do que repetir passos conhecidos. Com o conserto aprovado, a próxima execução volta a
                    custar 1 crédito, em vez de depender do agente visual toda vez.
                  </span>
                </div>
              </div>
            </div>
            <ExemploCreditos />
          </div>
        </section>

        <SecaoPlanos dados={planos.dados} erro={planos.erro} aoTentar={() => void planos.carregar()} aoPedir={setPedido} />

        <section aria-labelledby="t-faq" className="st-dentro st-secao st-faq">
          <div className="stack-lg">
            <h2 id="t-faq" className="h1">
              Perguntas frequentes
            </h2>
            <div className="card">
              {PERGUNTAS.map(([pergunta, resposta], i) => (
                <details key={pergunta} open={i === 0}>
                  <summary className="h4">{pergunta}</summary>
                  <p className="muted">{resposta}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="t-cta" className="st-dentro st-cta-secao">
          <div className="row wrap between st-cta">
            <div className="stack-sm st-cta-texto">
              <h2 id="t-cta" className="h2">
                Comece com um piloto acompanhado
              </h2>
              <p>
                Gravamos as primeiras tarefas junto com o seu time e medimos o resultado com um grupo de clientes antes de abrir para todos.
              </p>
            </div>
            <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
              <BotaoComecarPiloto cadastroAberto={cadastroAberto} aoPedir={setPedido} className="btn btn-primary btn-lg" />
              <button type="button" className="btn btn-secondary btn-lg" onClick={agendar}>
                Agendar demonstração
              </button>
            </div>
          </div>
        </section>
      </main>

      <Rodape noSite />

      {pedido ? <PedidoContato origem={pedido} aoFechar={() => setPedido(null)} /> : null}
    </div>
  );
}

/** "Abrir chamado": o que cada etapa custa quando a tela muda (1 crédito, até 5, volta a 1). */
function ExemploCreditos() {
  return (
    <div className="card card-pad stack st-exemplo">
      <div className="row between">
        <span className="h4">Abrir chamado</span>
        <span className="badge badge-outline">Exemplo</span>
      </div>
      <ol className="steps">
        <li className="step done">
          <span className="step-dot" aria-hidden="true">
            <Icone nome="check" tamanho="sm" />
          </span>
          <div className="stack-sm" style={{ gap: 2 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="strong">O roteiro gravado roda</span>
              <span className="badge">1 crédito</span>
            </div>
            <span className="small muted">Preenche assunto, cliente e prioridade e clica em “Abrir chamado”. Assim nos dias normais.</span>
          </div>
        </li>
        <li className="step fail">
          <span className="step-dot" aria-hidden="true">
            <Icone nome="fechar" tamanho="sm" />
          </span>
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="strong">A tela mudou</span>
            <span className="small muted">O botão “Abrir chamado” virou “Registrar”. O roteiro para e não grava nada pela metade.</span>
          </div>
        </li>
        <li className="step active">
          <span className="step-dot" aria-hidden="true">
            <Icone nome="copiloto" tamanho="sm" />
          </span>
          <div className="stack-sm" style={{ gap: 2 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="strong">O agente visual conserta</span>
              <span className="badge badge-accent">até 5 créditos</span>
            </div>
            <span className="small muted">Encontra o botão novo e conclui o pedido do cliente, que só percebe alguns segundos a mais.</span>
          </div>
        </li>
        <li className="step">
          <span className="step-dot" aria-hidden="true">
            4
          </span>
          <div className="stack-sm" style={{ gap: 2 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="strong">Você aprova o roteiro novo</span>
              <span className="badge">volta a 1 crédito</span>
            </div>
            <span className="small muted">O console mostra o passo que mudou, antes e depois. Um clique atualiza o roteiro.</span>
          </div>
        </li>
      </ol>
    </div>
  );
}

// Seção "Planos" do site: os cartões vêm da tabela de planos (GET /api/publico/planos). Preço ainda
// não definido aparece como "Sob consulta", e a nota de valores de exemplo só fica enquanto faltar
// algum preço. Os botões de compra levam ao cadastro; os outros abrem o pedido de contato.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmt, precoEmReais, ROTULO_BOTAO_PLANO, SOB_CONSULTA, type OrigemContato, type Plano, type PlanosPublicos } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { EstadoErro } from '../../componentes/estados.tsx';
import { Icone } from '../../componentes/icones.tsx';

/** "Começar piloto": cadastro em /criar-conta ou, com o cadastro fechado, pedido de contato. */
export function BotaoComecarPiloto({
  cadastroAberto,
  aoPedir,
  className,
}: {
  cadastroAberto: boolean;
  aoPedir: (origem: OrigemContato) => void;
  className: string;
}) {
  return cadastroAberto ? (
    <Link className={className} to="/criar-conta">
      {ROTULO_BOTAO_PLANO.cadastro}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => aoPedir('piloto')}>
      {ROTULO_BOTAO_PLANO.cadastro}
    </button>
  );
}

function Item({ children }: { children: ReactNode }) {
  return (
    <li className="row-top" style={{ gap: 8 }}>
      <Icone nome="check" tamanho="sm" className="text-success" />
      <span>{children}</span>
    </li>
  );
}

/** "Até 200 usuários do seu sistema", "De 201 a 1.000 usuários", "Mais de 1.000 usuários". */
function Usuarios({ plano: { usuariosMin: min, usuariosMax: max } }: { plano: Plano }) {
  if (max === null) return <span className="strong">Mais de {fmt.numero(min - 1)} usuários</span>;
  if (min <= 1) {
    return (
      <>
        Até <span className="strong">{fmt.numero(max)} usuários</span> do seu sistema
      </>
    );
  }
  return (
    <>
      De{' '}
      <span className="strong">
        {fmt.numero(min)} a {fmt.numero(max)} usuários
      </span>
    </>
  );
}

function CartaoPlano({
  plano,
  destaque,
  cadastroAberto,
  aoPedir,
}: {
  plano: Plano;
  destaque: boolean;
  cadastroAberto: boolean;
  aoPedir: (origem: OrigemContato) => void;
}) {
  const { botao } = plano;
  const id = `plano-${plano.id}`;
  const mensal = precoEmReais(plano.precoMensalCentavos);
  const nota = plano.notaPreco.replace('{implantacao}', precoEmReais(plano.taxaImplantacaoCentavos) ?? SOB_CONSULTA.toLowerCase());
  const classeBotao = `btn ${destaque ? 'btn-primary' : 'btn-secondary'} btn-block st-plano-botao`;
  return (
    <article className={`card card-pad stack-lg st-plano${destaque ? ' st-plano-destaque' : ''}`} aria-labelledby={id}>
      <div className="stack-sm">
        <div className="row between">
          <h3 id={id} className="h3">
            {plano.nome}
          </h3>
          {destaque ? <span className="badge badge-info">Comece por aqui</span> : null}
        </div>
        <p className="small muted">{plano.descricao}</p>
      </div>
      <div className="stack-sm" style={{ gap: 2 }}>
        <p>
          <span className="strong st-preco">{mensal ?? SOB_CONSULTA}</span>
          {mensal ? <span className="muted">/mês</span> : null}
        </p>
        {nota ? <span className="tiny muted">{nota}</span> : null}
      </div>
      <ul className="stack-sm small st-lista">
        <Item>
          <Usuarios plano={plano} />
        </Item>
        <Item>
          {plano.creditosIncluidos === null ? (
            'Créditos incluídos sob medida'
          ) : (
            <>
              <span className="strong num">{fmt.numero(plano.creditosIncluidos)} créditos</span> incluídos por mês
            </>
          )}
        </Item>
        <Item>Crédito extra {precoEmReais(plano.precoCreditoExtraCentavos) ?? SOB_CONSULTA.toLowerCase()}</Item>
        {plano.destaques.map((d) => (
          <Item key={d}>{d}</Item>
        ))}
      </ul>
      {botao === 'cadastro' ? (
        <BotaoComecarPiloto cadastroAberto={cadastroAberto} aoPedir={aoPedir} className={classeBotao} />
      ) : (
        <button type="button" className={classeBotao} onClick={() => aoPedir(botao)}>
          {ROTULO_BOTAO_PLANO[botao]}
        </button>
      )}
    </article>
  );
}

export function SecaoPlanos({
  dados,
  erro,
  aoTentar,
  aoPedir,
}: {
  dados: PlanosPublicos | undefined;
  erro: ErroApiCliente | null;
  aoTentar: () => void;
  aoPedir: (origem: OrigemContato) => void;
}) {
  return (
    <section id="planos" aria-labelledby="t-planos" className="st-faixa">
      <div className="st-dentro st-secao stack-lg">
        <div className="stack-sm st-cabeca">
          <span className="eyebrow st-marcador">Planos</span>
          <h2 id="t-planos" className="h1">
            Uma assinatura pela sua base de usuários, mais créditos pelo que o copiloto faz
          </h2>
          <p className="body-lg muted">Conversas e dúvidas não gastam crédito. Só tarefas executadas.</p>
        </div>
        {dados ? (
          <div className="grid-auto st-planos">
            {dados.planos.map((p, i) => (
              <CartaoPlano key={p.id} plano={p} destaque={i === 0} cadastroAberto={dados.cadastroAberto} aoPedir={aoPedir} />
            ))}
          </div>
        ) : erro ? (
          <div className="card">
            <EstadoErro erro={erro} aoTentar={aoTentar} titulo="Não conseguimos carregar os planos" />
          </div>
        ) : (
          <div className="grid-auto st-planos" aria-busy="true" aria-label="Carregando os planos">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card esqueleto" style={{ minHeight: 420 }}>
                <span className="esqueleto-linha" style={{ width: '40%' }} />
                <span className="esqueleto-linha" style={{ width: '80%' }} />
                <span className="esqueleto-linha" style={{ width: '60%' }} />
              </div>
            ))}
          </div>
        )}
        <div className="card row-top wrap st-creditos">
          <Icone nome="info" tamanho="lg" />
          <div className="stack-sm grow st-creditos-texto">
            <span className="strong">Como os créditos são contados</span>
            <span className="small st-corpo">
              <span className="strong">1 crédito por tarefa pelo roteiro; até 5 quando o agente visual precisa consertar.</span> O console
              mostra para onde foi cada crédito e avisa antes de acabarem.
            </span>
          </div>
          {dados?.valoresDeExemplo ? (
            <span className="tiny muted st-creditos-nota">
              Faixas e créditos incluídos são de exemplo. Os valores finais saem na proposta.
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

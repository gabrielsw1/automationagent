// Plataforma › Suporte: os acessos da equipe Starta ao console das empresas (quem, onde, por quê,
// quando) e os pedidos de contato que chegaram pelo site do produto.
import { Link } from 'react-router-dom';
import { fmt, ROTULO_FAIXA_USUARIOS, ROTULO_ORIGEM_CONTATO, type AcessoSuporteResumo, type ContatoRecebido } from '@copiloto/shared';
import { useApiPlataforma, type SuportePlataforma } from '../../api/plataforma.ts';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { CabecalhoPagina } from '../../componentes/formulario.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import { useEmpresasDemo } from './contexto.tsx';
import { SeloDemo } from './pecas.tsx';

function Fim({ a }: { a: AcessoSuporteResumo }) {
  if (a.encerradoEm) return <span>{fmt.dataHora(a.encerradoEm)}</span>;
  if (new Date(a.expiraEm).getTime() > Date.now()) {
    return (
      <span className="badge badge-info">
        <span className="dot" />
        Em andamento até {fmt.hora(a.expiraEm)}
      </span>
    );
  }
  return (
    <span>
      {fmt.dataHora(a.expiraEm)} <span className="tiny muted">(venceu)</span>
    </span>
  );
}

export default function Suporte() {
  const dados = useApiPlataforma<SuportePlataforma>('/suporte');
  const demo = useEmpresasDemo();
  return (
    <>
      <CabecalhoPagina titulo="Suporte" subtitulo="Quem da Starta entrou no console das empresas e os pedidos de contato que chegaram pelo site." />
      {dados.dados ? (
        <>
          <section className="stack-sm" aria-labelledby="t-acessos">
            <h2 id="t-acessos" className="h3">
              Acessos de suporte
            </h2>
            <p className="small muted">Cada acesso também fica na auditoria da empresa, e os Admins dela recebem um e-mail com o motivo.</p>
            <Tabela<AcessoSuporteResumo>
              rotulo="Acessos de suporte"
              linhas={dados.dados.acessos}
              chave={(a) => a.id}
              vazio="Ninguém da Starta entrou como suporte ainda."
              colunas={[
                { titulo: 'Quem', classe: 'strong cp-sem-quebra', celula: (a) => a.pessoa },
                {
                  titulo: 'Empresa',
                  celula: (a) => (
                    <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                      <Link to={`/plataforma?empresa=${encodeURIComponent(a.empresaId)}`} className="cp-sem-quebra">
                        {a.empresa}
                      </Link>
                      {demo.has(a.empresaId) ? <SeloDemo /> : null}
                    </span>
                  ),
                },
                { titulo: 'Motivo', classe: 'small cp-texto-longo', celula: (a) => a.motivo },
                { titulo: 'Início', classe: 'small cp-sem-quebra', celula: (a) => fmt.dataHora(a.inicio) },
                { titulo: 'Fim', classe: 'small cp-sem-quebra', celula: (a) => <Fim a={a} /> },
              ]}
            />
          </section>

          <section className="stack-sm" aria-labelledby="t-contatos">
            <h2 id="t-contatos" className="h3">
              Pedidos de contato do site
            </h2>
            <p className="small muted">“Agendar demonstração”, “Falar com vendas” e “Começar piloto” com o cadastro fechado. Responda pelo e-mail de cada pessoa.</p>
            <Tabela<ContatoRecebido>
              rotulo="Pedidos de contato do site"
              linhas={dados.dados.contatos}
              chave={(c) => c.id}
              vazio="Nenhum pedido de contato chegou pelo site."
              colunas={[
                { titulo: 'Quando', classe: 'small cp-sem-quebra', celula: (c) => fmt.dataHora(c.criadoEm) },
                {
                  titulo: 'Pessoa',
                  celula: (c) => (
                    <div className="stack-sm" style={{ gap: 2 }}>
                      <span className="strong cp-sem-quebra">{c.nome}</span>
                      <a className="small" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                      {c.telefone ? <span className="tiny muted cp-sem-quebra">{c.telefone}</span> : null}
                    </div>
                  ),
                },
                { titulo: 'Empresa', classe: 'cp-sem-quebra', celula: (c) => c.empresa },
                { titulo: 'Usuários', classe: 'small cp-sem-quebra', celula: (c) => ROTULO_FAIXA_USUARIOS[c.faixa] ?? c.faixa },
                { titulo: 'Pedido', celula: (c) => <span className="badge badge-outline">{ROTULO_ORIGEM_CONTATO[c.origem] ?? c.origem}</span> },
                { titulo: 'Mensagem', classe: 'small cp-texto-longo', celula: (c) => c.mensagem ?? <span className="muted">—</span> },
              ]}
            />
          </section>
        </>
      ) : dados.erro ? (
        <EstadoErro erro={dados.erro} aoTentar={() => void dados.recarregar()} titulo="Não conseguimos carregar o suporte" />
      ) : (
        <Carregando forma="tabela" texto="Carregando os acessos e os pedidos…" />
      )}
    </>
  );
}

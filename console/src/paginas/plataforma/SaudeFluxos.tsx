// Plataforma › Saúde dos fluxos: tarefas com conserto visual nos últimos 30 dias, em todas as
// empresas ativas. Quebrado primeiro; cada linha abre a empresa (lá está "Sugerir regravação").
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CONSERTOS_PARA_QUEBRADO, fmt, type SaudeFluxo } from '@copiloto/shared';
import { Abas } from '../../componentes/Abas.tsx';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { CabecalhoPagina } from '../../componentes/formulario.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import { useEmpresasDemo, useSessaoStarta } from './contexto.tsx';
import { SeloDemo } from './pecas.tsx';

type Filtro = 'todos' | 'quebrados';

export default function SaudeFluxos() {
  const { saude } = useSessaoStarta();
  const demo = useEmpresasDemo();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const lista = saude.dados;
  const quebrados = lista?.filter((f) => f.quebrado) ?? [];
  const linhas = filtro === 'quebrados' ? quebrados : (lista ?? []);

  return (
    <>
      <CabecalhoPagina
        titulo="Saúde dos fluxos"
        subtitulo="Fluxos em que a tela mudou e o agente visual precisou consertar o roteiro nos últimos 30 dias."
      />
      {lista ? (
        lista.length === 0 ? (
          <EstadoVazio
            emCartao
            icone="execucoes"
            titulo="Nenhum fluxo precisou de conserto"
            texto="Nos últimos 30 dias, todos os roteiros gravados rodaram sem o agente visual consertar nenhum passo."
          />
        ) : (
          <section className="stack" aria-label="Fluxos com conserto">
            <Abas<Filtro>
              rotulo="Filtrar fluxos"
              ativa={filtro}
              aoTrocar={setFiltro}
              abas={[
                { chave: 'todos', rotulo: 'Todos com conserto', selo: <span className="badge cp-selo-aba">{lista.length}</span> },
                { chave: 'quebrados', rotulo: 'Quebrados', selo: <span className="badge cp-selo-aba">{quebrados.length}</span> },
              ]}
            />
            <div id={`painel-${filtro}`} role="tabpanel" aria-labelledby={`aba-${filtro}`}>
              <Tabela<SaudeFluxo>
                rotulo="Fluxos com conserto"
                linhas={linhas}
                chave={(f) => `${f.empresaId}:${f.tarefaId}`}
                vazio="Nenhum fluxo quebrado agora."
                colunas={[
                  {
                    titulo: 'Fluxo',
                    celula: (f) => (
                      <div className="stack-sm cp-fluxo-celula" style={{ gap: 2 }}>
                        <span className="strong">{f.nome}</span>
                        {f.detalhe ? <span className="tiny muted">{f.detalhe}</span> : null}
                      </div>
                    ),
                  },
                  {
                    titulo: 'Empresa',
                    celula: (f) => (
                      <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                        <span className="cp-sem-quebra">{f.empresa}</span>
                        {demo.has(f.empresaId) ? <SeloDemo /> : null}
                      </span>
                    ),
                  },
                  { titulo: 'Consertos 30\u00a0d', alinhar: 'direita', classe: 'num', celula: (f) => fmt.numero(f.consertos30d) },
                  { titulo: 'Execuções 30\u00a0d', alinhar: 'direita', classe: 'num', celula: (f) => fmt.numero(f.execucoes30d) },
                  {
                    titulo: 'Falhas 30\u00a0d',
                    alinhar: 'direita',
                    classe: (f) => `num${f.falhas30d > 0 ? ' text-danger' : ' muted'}`,
                    celula: (f) => fmt.numero(f.falhas30d),
                  },
                  {
                    titulo: 'Último conserto',
                    classe: 'small cp-sem-quebra',
                    celula: (f) => (f.ultimoConserto ? fmt.quando(f.ultimoConserto) : <span className="muted">—</span>),
                  },
                  {
                    titulo: 'Situação',
                    celula: (f) => (f.quebrado ? <span className="badge badge-danger">Quebrado</span> : <span className="badge badge-warning">Com conserto</span>),
                  },
                  {
                    titulo: 'Ação',
                    tituloOculto: true,
                    alinhar: 'direita',
                    celula: (f) => (
                      <Link className="btn btn-ghost btn-sm" to={`/plataforma?empresa=${encodeURIComponent(f.empresaId)}`} aria-label={`Abrir ${f.empresa}`}>
                        Abrir
                      </Link>
                    ),
                  },
                ]}
              />
            </div>
            <p className="tiny muted">
              “Quebrado” é um fluxo em que o roteiro falhou e o agente visual consertou mais de {fmt.numero(CONSERTOS_PARA_QUEBRADO)} vezes em 30 dias. Na empresa,
              “Sugerir regravação à empresa” manda aos Admins o link da tarefa para gravar o fluxo de novo.
            </p>
          </section>
        )
      ) : saude.erro ? (
        <EstadoErro erro={saude.erro} aoTentar={() => void saude.recarregar()} titulo="Não conseguimos carregar a saúde dos fluxos" />
      ) : (
        <Carregando forma="tabela" texto="Carregando a saúde dos fluxos…" />
      )}
    </>
  );
}

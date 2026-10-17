// Painel da plataforma: todas as empresas clientes, com métricas de uso e nunca o conteúdo
// (conversas, prints e dados dos clientes ficam no espaço de cada empresa). Só para quem administra
// a plataforma (eu.adminPlataforma). Daqui dá para suspender e reativar uma empresa.
import { useMemo, useState } from 'react';
import { fmt, formatarCnpj, type EmpresaPlataforma, type ModoAcesso } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useAcao, useApi } from '../../api/hooks.ts';
import { Abas } from '../../componentes/Abas.tsx';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro, SemPermissao } from '../../componentes/estados.tsx';
import { Aviso, CabecalhoPagina } from '../../componentes/formulario.tsx';
import { Confirmar } from '../../componentes/Modal.tsx';
import { useMigalhas } from '../../componentes/pagina.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { hostDe } from '../sistema/endereco.ts';
import './plataforma.css';

type Filtro = 'todas' | 'ativa' | 'suspensa';

const DIA = 86_400_000;

const ACESSO_CURTO: Record<ModoAcesso, string> = {
  sessao: 'Sessão de quem pede',
  conta: 'Conta de serviço',
  nenhum: 'Sem login',
};

/** "Sessão de quem pede", "Conta de serviço", "Sem login" ou "Pela API". */
export function rotuloAcesso(s: EmpresaPlataforma['sistema']): string {
  return s.conector === 'api' ? 'Pela API' : ACESSO_CURTO[s.acesso];
}

export default function Plataforma() {
  useMigalhas([{ rotulo: 'Plataforma' }, { rotulo: 'Empresas clientes' }]);
  const { resumo } = useSessao();
  const admin = resumo.eu.adminPlataforma;
  const empresas = useApi<EmpresaPlataforma[]>(admin ? '/plataforma/empresas' : null);

  const cabecalho = <CabecalhoPagina titulo="Empresas clientes" subtitulo="Quem usa o Copiloto e como está o uso de cada uma." />;
  if (!admin || empresas.erro?.status === 403) {
    return (
      <div className="stack-lg">
        {cabecalho}
        <SemPermissao area="Empresas clientes" mensagem="Só quem administra a plataforma vê as empresas clientes." />
      </div>
    );
  }
  return (
    <div className="stack-lg">
      {cabecalho}
      <Aviso tipo="info">
        Aqui você vê métricas, não conteúdo: conversas, prints e dados dos clientes de cada empresa ficam no espaço dela.
      </Aviso>
      {empresas.dados ? (
        <Painel
          lista={empresas.dados}
          empresaAberta={resumo.eu.empresa.id}
          aoMudar={(e) => empresas.definir((l) => l?.map((x) => (x.id === e.id ? e : x)))}
        />
      ) : empresas.erro ? (
        <EstadoErro erro={empresas.erro} aoTentar={() => void empresas.recarregar()} titulo="Não conseguimos carregar as empresas" />
      ) : (
        <Carregando forma="painel" texto="Carregando as empresas clientes…" />
      )}
    </div>
  );
}

function Painel({
  lista,
  empresaAberta,
  aoMudar,
}: {
  lista: EmpresaPlataforma[];
  empresaAberta: string;
  aoMudar: (e: EmpresaPlataforma) => void;
}) {
  const toast = useToast();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [confirmar, setConfirmar] = useState<EmpresaPlataforma | null>(null);
  const mudar = useAcao((id: string, status: EmpresaPlataforma['status']) =>
    api.put<EmpresaPlataforma>(`/plataforma/empresas/${encodeURIComponent(id)}/status`, { status }),
  );

  const kpis = useMemo(() => {
    const desde = Date.now() - 30 * DIA;
    return {
      ativas: lista.filter((e) => e.status === 'ativa').length,
      execucoes: lista.reduce((n, e) => n + e.execucoes30d, 0),
      novas: lista.filter((e) => Date.parse(e.criadoEm) >= desde).length,
    };
  }, [lista]);
  const suspensas = lista.length - kpis.ativas;
  const linhas = filtro === 'todas' ? lista : lista.filter((e) => e.status === filtro);

  const confirmarMudanca = async () => {
    if (!confirmar) return;
    const novo = confirmar.status === 'ativa' ? 'suspensa' : 'ativa';
    const r = await mudar.executar(confirmar.id, novo);
    if (!r) return;
    aoMudar(r);
    setConfirmar(null);
    toast.sucesso(novo === 'suspensa' ? `${r.nome} foi suspensa.` : `${r.nome} foi reativada.`);
  };

  return (
    <>
      <section className="grid-kpi" aria-label="Resumo das empresas">
        <div className="card kpi">
          <span className="kpi-label">Empresas ativas</span>
          <span className="kpi-value">{fmt.numero(kpis.ativas)}</span>
          <span className="small muted">{suspensas ? `${fmt.numero(suspensas)} suspensa${suspensas > 1 ? 's' : ''}` : 'Nenhuma suspensa'}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Execuções em 30 dias</span>
          <span className="kpi-value">{fmt.numero(kpis.execucoes)}</span>
          <span className="small muted">Somando todas as empresas, sem os testes</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Empresas criadas nos últimos 30 dias</span>
          <span className="kpi-value">{fmt.numero(kpis.novas)}</span>
        </div>
      </section>

      <section className="card cp-empresas" aria-label="Lista de empresas clientes">
        <div className="card-head" style={{ paddingBottom: 0 }}>
          <Abas<Filtro>
            rotulo="Filtrar empresas"
            ativa={filtro}
            aoTrocar={setFiltro}
            abas={[
              { chave: 'todas', rotulo: 'Todas', selo: <span className="badge">{lista.length}</span> },
              { chave: 'ativa', rotulo: 'Ativas', selo: <span className="badge">{kpis.ativas}</span> },
              { chave: 'suspensa', rotulo: 'Suspensas', selo: <span className="badge">{suspensas}</span> },
            ]}
          />
        </div>
        <div id={`painel-${filtro}`} role="tabpanel" aria-labelledby={`aba-${filtro}`}>
          <Tabela
            semBorda
            rotulo="Empresas clientes"
            linhas={linhas}
            chave={(e) => e.id}
            vazio={filtro === 'suspensa' ? 'Nenhuma empresa suspensa.' : filtro === 'ativa' ? 'Nenhuma empresa ativa.' : 'Nenhuma empresa ainda.'}
            colunas={[
              {
                titulo: 'Empresa',
                celula: (e) => (
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <span className="strong" title={e.cnpj ? `CNPJ ${formatarCnpj(e.cnpj)}` : undefined}>
                      {e.nome}
                    </span>
                    {e.demo ? (
                      <span className="badge badge-accent" style={{ alignSelf: 'flex-start' }}>
                        Demonstração
                      </span>
                    ) : null}
                  </div>
                ),
              },
              {
                titulo: 'Status',
                celula: (e) =>
                  e.status === 'ativa' ? <span className="badge badge-success">Ativa</span> : <span className="badge badge-warning">Suspensa</span>,
              },
              {
                titulo: 'Sistema',
                celula: (e) => (
                  <div className="stack-sm cp-sistema" style={{ gap: 2 }}>
                    <span>{e.sistema.nome || 'Sem nome'}</span>
                    <span className="tiny muted">
                      {e.sistema.url ? `${hostDe(e.sistema.url)} · ` : 'Sem endereço · '}
                      {rotuloAcesso(e.sistema)}
                    </span>
                  </div>
                ),
              },
              { titulo: 'Equipe', alinhar: 'direita', classe: 'num', celula: (e) => fmt.numero(e.equipe) },
              { titulo: 'Usuários', alinhar: 'direita', classe: 'num', celula: (e) => fmt.numero(e.usuarios) },
              { titulo: 'Tarefas ativas', alinhar: 'direita', classe: 'num', celula: (e) => fmt.numero(e.tarefasAtivas) },
              { titulo: 'Execuções 30 d', alinhar: 'direita', classe: 'num', celula: (e) => fmt.numero(e.execucoes30d) },
              {
                titulo: 'Sucesso',
                alinhar: 'direita',
                classe: 'num',
                celula: (e) => (e.sucesso30d === null ? <span className="muted">—</span> : fmt.percentual(e.sucesso30d, 0)),
              },
              {
                titulo: 'Criada',
                celula: (e) => (
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <span className="small cp-sem-quebra">{fmt.data(e.criadoEm)}</span>
                    {e.criadoPor ? <span className="tiny muted">por {e.criadoPor}</span> : null}
                  </div>
                ),
              },
              {
                titulo: 'Ações',
                tituloOculto: true,
                alinhar: 'direita',
                celula: (e) =>
                  e.id === empresaAberta && e.status === 'ativa' ? (
                    <span className="tiny muted">Aberta agora</span>
                  ) : (
                    <Botao
                      tamanho="sm"
                      variante={e.status === 'ativa' ? 'fantasma' : 'secundario'}
                      aria-label={`${e.status === 'ativa' ? 'Suspender' : 'Reativar'} ${e.nome}`}
                      onClick={() => {
                        mudar.limparErro();
                        setConfirmar(e);
                      }}
                    >
                      {e.status === 'ativa' ? 'Suspender' : 'Reativar'}
                    </Botao>
                  ),
              },
            ]}
          />
        </div>
      </section>

      <Confirmar
        aberto={!!confirmar}
        titulo={confirmar?.status === 'ativa' ? `Suspender ${confirmar.nome}?` : `Reativar ${confirmar?.nome ?? ''}?`}
        texto={
          confirmar?.status === 'ativa'
            ? 'Ninguém da equipe dela entra no console e o assistente para de atender no sistema dela até você reativar. Nada é apagado.'
            : 'A equipe volta a entrar no console e o assistente volta a atender no sistema dela.'
        }
        rotuloConfirmar={confirmar?.status === 'ativa' ? 'Suspender empresa' : 'Reativar empresa'}
        perigo={confirmar?.status === 'ativa'}
        carregando={mudar.enviando}
        erro={mensagemErro(mudar.erro)}
        aoConfirmar={() => void confirmarMudanca()}
        aoFechar={() => setConfirmar(null)}
      />
    </>
  );
}

function mensagemErro(e: ErroApiCliente | null): string | null {
  if (!e) return null;
  return e.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : e.message;
}

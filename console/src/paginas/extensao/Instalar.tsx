// E1 · Instalar o gravador (/aprender/instalar). Os três passos (instalar, fixar o ícone, entrar com a
// conta), o que a extensão grava e o que nunca grava, e quem pode gravar na empresa. A página percebe
// sozinha quando a extensão chega (marca no <html> + pergunta pela própria janela) e quando ela entra
// na conta: não precisa recarregar.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROTULO_PERFIL, type InfoExtensao } from '@copiloto/shared';
import { useApi } from '../../api/hooks.ts';
import { EstadoErro } from '../../componentes/estados.tsx';
import { CabecalhoPagina } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useMigalhas } from '../../componentes/pagina.tsx';
import { SeloExemplo } from '../../componentes/Selos.tsx';
import { usePode, useSessao } from '../../componentes/sessao.tsx';
import { navegadorAtual, useExtensao, type EstadoExtensao } from './ponte.ts';
import './extensao.css';

type EstadoPasso = 'feito' | 'atual' | 'depois';

function Passo({ n, estado, titulo, texto, children }: { n: number; estado: EstadoPasso; titulo: string; texto: ReactNode; children?: ReactNode }) {
  return (
    <li className={`row-top ex-passo ex-passo-${estado}`} aria-current={estado === 'atual' ? 'step' : undefined}>
      <span className="ex-passo-n" aria-hidden="true">
        {estado === 'feito' ? <Icone nome="check" tamanho="sm" /> : n}
      </span>
      <div className="stack-sm grow ex-passo-corpo">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h3 className="h4">
            {titulo}
            {estado === 'feito' ? <span className="sr-only"> (feito)</span> : null}
          </h3>
          <div className="small muted">{texto}</div>
        </div>
        {children}
      </div>
    </li>
  );
}

/** Desenho da barra do navegador com o menu de extensões aberto e o alfinete do gravador. */
function DesenhoFixar() {
  return (
    <figure className="stack-sm ex-figura">
      <div className="host ex-navegador" aria-hidden="true">
        <div className="row ex-navegador-barra">
          <span className="row" style={{ gap: 5 }}>
            <span className="host-block ex-bolinha" />
            <span className="host-block ex-bolinha" />
            <span className="host-block ex-bolinha" />
          </span>
          <span className="host-block ex-endereco" />
          <span className="host-block ex-quadradinho" />
          <span className="ex-icone-s">S</span>
          <span className="row ex-peca">
            <Icone nome="extensao" tamanho="sm" />
          </span>
        </div>
        <div className="row ex-navegador-menu">
          <div className="ex-menu">
            <span className="host-block" style={{ width: 64, height: 8 }} />
            <div className="row ex-menu-item">
              <span className="ex-icone-s ex-icone-s-p">S</span>
              <span className="tiny strong grow">Copiloto · Gravador de fluxos</span>
              <Icone nome="alfinete" tamanho="sm" className="text-brand" />
            </div>
            <div className="row" style={{ gap: 8, padding: 6 }}>
              <span className="host-block" style={{ width: 18, height: 18, borderRadius: 5 }} />
              <span className="host-block" style={{ width: 120, height: 8 }} />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="tiny muted">O ícone rosa com S é o gravador. Fixado, ele fica sempre visível ao lado da barra de endereço.</figcaption>
    </figure>
  );
}

function BotoesLoja({ info }: { info: InfoExtensao | undefined }) {
  const navegador = navegadorAtual();
  const lojas = info?.lojas;
  if (!info) return <div className="skel" style={{ height: 40, width: 320 }} aria-hidden="true" />;
  if (!lojas?.chrome && !lojas?.edge) {
    return (
      <div className="stack-sm ex-sem-loja">
        <p className="small">
          A extensão ainda não está publicada na loja. Enquanto isso, instale pelo pacote: baixe a pasta da extensão e carregue em
          “Carregar sem compactação”, com o modo do desenvolvedor ligado.
        </p>
        <a className="btn btn-secondary" href={info.ajudaInstalar} target="_blank" rel="noreferrer">
          <Icone nome="externo" />
          Como instalar pelo pacote
        </a>
      </div>
    );
  }
  const edgePrimeiro = navegador === 'Edge';
  const botoes = [
    lojas.chrome ? { rotulo: 'Instalar no Chrome', url: lojas.chrome, principal: !edgePrimeiro || !lojas.edge } : null,
    lojas.edge ? { rotulo: 'Instalar no Edge', url: lojas.edge, principal: edgePrimeiro || !lojas.chrome } : null,
  ]
    .filter((b): b is { rotulo: string; url: string; principal: boolean } => !!b)
    .sort((a, b) => Number(b.principal) - Number(a.principal));
  return (
    <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
      {botoes.map((b) => (
        <a key={b.rotulo} className={`btn ${b.principal ? 'btn-primary' : 'btn-secondary'}`} href={b.url} target="_blank" rel="noreferrer">
          <Icone nome="externo" />
          {b.rotulo}
        </a>
      ))}
    </div>
  );
}

/** Rodapé do cartão: o que a página sabe da extensão agora. */
function EstadoAoVivo({ ext, empresa, textoPronto }: { ext: EstadoExtensao; empresa: { id: string; nome: string }; textoPronto: string }) {
  const podeEditar = usePode('editar');
  const navegador = navegadorAtual();
  if (!ext.instalada) {
    return (
      <div className="row ex-estado" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div className="stack-sm" style={{ gap: 0 }}>
          <p className="strong">Procurando a extensão…</p>
          <p className="small muted">Esta página percebe sozinha quando a instalação terminar. Não precisa recarregar.</p>
        </div>
      </div>
    );
  }
  const versao = ext.versao ? ` · versão ${ext.versao}` : '';
  if (ext.consoleConfigurado === false) {
    return (
      <div className="row ex-estado" role="status" aria-live="polite">
        <span className="ex-estado-icone ex-estado-aviso" aria-hidden="true">
          <Icone nome="alerta" />
        </span>
        <div className="stack-sm grow" style={{ gap: 2 }}>
          <p className="strong">Extensão instalada{versao}, ligada a outro servidor do copiloto</p>
          <p className="small muted">Abra as opções da extensão (clique com o botão direito no ícone do gravador) e confira o servidor do copiloto.</p>
        </div>
      </div>
    );
  }
  if (!ext.conexao) {
    return (
      <div className="row ex-estado" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div className="stack-sm" style={{ gap: 0 }}>
          <p className="strong">Extensão instalada{versao} · falta entrar</p>
          <p className="small muted">Clique no ícone do gravador e em Entrar com a conta do Copiloto. Esta página atualiza sozinha.</p>
        </div>
      </div>
    );
  }
  const outraEmpresa = ext.conexao.empresa.id !== empresa.id;
  return (
    <div className="row wrap ex-estado ex-estado-ok" role="status" aria-live="polite">
      <span className={`ex-estado-icone ${outraEmpresa ? 'ex-estado-aviso' : 'ex-estado-sucesso'}`} aria-hidden="true">
        <Icone nome={outraEmpresa ? 'alerta' : 'check'} />
      </span>
      <div className="stack-sm grow" style={{ gap: 2, minWidth: 220 }}>
        <p className="strong">
          Extensão instalada{versao} · conectada a {ext.conexao.empresa.nome}
        </p>
        <p className="small muted">
          {navegador === 'outro' ? 'Entrou' : `${navegador}, entrou`} como {ext.conexao.pessoa.nome}.{' '}
          {outraEmpresa
            ? `As gravações pela extensão vão para a ${ext.conexao.empresa.nome}. Para gravar para a ${empresa.nome}, use Trocar no ícone do gravador.`
            : textoPronto}
        </p>
      </div>
      {podeEditar && !outraEmpresa ? (
        <Link className="btn btn-primary" to="/aprender?nova=1">
          <Icone nome="aprender" />
          Começar gravação
        </Link>
      ) : null}
    </div>
  );
}

export default function Instalar() {
  useMigalhas([{ rotulo: 'Aprender fluxo', para: '/aprender' }, { rotulo: 'Instalar o gravador' }]);
  const { resumo } = useSessao();
  const { eu, nomeSistema } = resumo;
  const info = useApi<InfoExtensao>('/extensao');
  const ext = useExtensao();
  const conectadaAqui = !!ext.conexao && ext.conexao.empresa.id === eu.empresa.id;

  const passo1: EstadoPasso = ext.instalada ? 'feito' : 'atual';
  const passo2: EstadoPasso = ext.instalada ? (ext.conexao ? 'feito' : 'atual') : 'depois';
  const passo3: EstadoPasso = conectadaAqui ? 'feito' : ext.instalada ? 'atual' : 'depois';

  return (
    <div className="stack-lg">
      <CabecalhoPagina
        eyebrow="Aprender fluxo"
        titulo="Ensine um fluxo ao copiloto"
        subtitulo={`Você faz a tarefa uma vez no ${nomeSistema}, com o gravador ligado. O copiloto guarda o caminho e depois repete sozinho, com os dados de cada pedido.`}
      />
      <div className="split">
        <div className="main-col stack">
          <section className="card" aria-labelledby="instalar-titulo">
            <div className="card-body stack-lg">
              <div className="row-top" style={{ gap: 'var(--s-4)' }}>
                <span className="ex-icone-grande" aria-hidden="true">
                  <Icone nome="extensao" tamanho="lg" />
                </span>
                <div className="stack-sm grow" style={{ gap: 4 }}>
                  <h2 className="h2" id="instalar-titulo">
                    Instale o gravador de fluxos
                  </h2>
                  <p className="muted">É uma extensão do navegador. Você instala uma vez e ela fica disponível sempre que quiser ensinar um fluxo novo.</p>
                </div>
              </div>

              <ol className="ex-passos">
                <Passo n={1} estado={passo1} titulo="Instalar no navegador" texto="Abre a loja de extensões numa nova aba. Lá você clica em Adicionar e confirma.">
                  {passo1 === 'feito' ? null : (
                    <>
                      <BotoesLoja info={info.dados} />
                      <p className="help">Usa outro navegador? Por enquanto o gravador funciona só no Chrome e no Edge.</p>
                    </>
                  )}
                </Passo>
                <li aria-hidden="true" className="ex-ligacao" />
                <Passo
                  n={2}
                  estado={passo2}
                  titulo="Fixar o ícone na barra"
                  texto="Clique na peça de quebra-cabeça ao lado da barra de endereço e no alfinete ao lado de Copiloto · Gravador de fluxos. Assim o botão de gravar fica a um clique."
                >
                  <DesenhoFixar />
                </Passo>
                <li aria-hidden="true" className="ex-ligacao" />
                <Passo
                  n={3}
                  estado={passo3}
                  titulo="Entrar com a sua conta do Copiloto"
                  texto="Clique no ícone e entre com o mesmo e-mail que você usa neste console. Depois escolha a empresa: as gravações vão só para ela."
                >
                  <p className="tiny muted">
                    Neste console você está como <span className="strong ex-tinta">{eu.nome}</span>, na <span className="strong ex-tinta">{eu.empresa.nome}</span>.
                  </p>
                </Passo>
              </ol>
            </div>
            <div className="card-foot ex-rodape">
              <EstadoAoVivo ext={ext} empresa={eu.empresa} textoPronto="Já dá para gravar." />
            </div>
          </section>
        </div>

        <aside className="side-col stack">
          <section className="card card-pad stack" aria-labelledby="grava-titulo">
            <h2 className="h4" id="grava-titulo">
              O que a extensão grava e o que não grava
            </h2>
            <div className="stack-sm">
              <span className="eyebrow">Grava</span>
              <ul className="ex-lista">
                {[
                  'Cliques em botões, menus e links',
                  'A opção escolhida em cada lista',
                  <>
                    O formato do que você digita, como <span className="mono">99.999.999/9999-99</span>
                  </>,
                  'Trocas de página',
                  'Downloads de arquivos',
                ].map((t, i) => (
                  <li key={i} className="row-top">
                    <Icone nome="check" tamanho="sm" className="text-success ex-lista-icone" />
                    <span className="small">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="divider" />
            <div className="stack-sm">
              <span className="eyebrow">Nunca grava</span>
              <ul className="ex-lista">
                {['Os valores que você digita', 'Senhas, nem o formato delas', 'Nada fora da aba que você está gravando'].map((t) => (
                  <li key={t} className="row-top">
                    <Icone nome="fechar" tamanho="sm" className="text-danger ex-lista-icone" />
                    <span className="small">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="alert" style={{ padding: 'var(--s-3)' }}>
              <Icone nome="info" />
              <p className="small">
                Se o caminho passar por outro site, como uma consulta de CNPJ, esses passos ficam marcados na revisão. O copiloto só repete os passos no{' '}
                {nomeSistema}; você escolhe remover os outros ou mantê-los como instrução.
              </p>
            </div>
          </section>

          <section className="card card-pad stack" aria-labelledby="quem-titulo">
            <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <Icone nome="cadeado" className="text-brand" />
              <h2 className="h4 grow" id="quem-titulo">
                Quem pode gravar
              </h2>
              {eu.empresa.demo ? <SeloExemplo /> : null}
            </div>
            <p className="small muted">Só quem tem um destes perfis na {eu.empresa.nome}. Para os outros, a extensão mostra que falta permissão.</p>
            <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
              <span className="badge badge-info">{ROTULO_PERFIL.admin}</span>
              <span className="badge badge-info">{ROTULO_PERFIL.editor}</span>
            </div>
            {info.erro && !info.dados ? (
              <EstadoErro erro={info.erro} aoTentar={() => void info.recarregar()} titulo="Não consegui carregar a equipe" />
            ) : (
              <ul className="ex-lista ex-pessoas" aria-label="Pessoas que podem gravar">
                {(info.dados?.quemPodeGravar ?? []).map((p) => (
                  <li key={p.id} className="row">
                    <span className="avatar avatar-sm" aria-hidden="true">
                      {p.iniciais}
                    </span>
                    <span className="small grow ex-pessoa-nome">
                      {p.nome}
                      {p.voce ? <span className="muted"> (você)</span> : null}
                    </span>
                    <span className="tiny muted">{ROTULO_PERFIL[p.perfil]}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="small strong" to="/equipe">
              Mudar perfis em Equipe e limites
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

// Plataforma › Configurações: "Meus códigos de recuperação", a equipe Starta (convidar, redefinir o
// acesso, desativar e reativar) e os preços dos planos (em reais na tela, centavos na API).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmt, type LinkAtivacao, type MembroStarta, type Plano, type PrecosPlano } from '@copiloto/shared';
import type { ErroApiCliente } from '../../api/cliente.ts';
import { useAcao } from '../../api/hooks.ts';
import { apiPlataforma, useApiPlataforma } from '../../api/plataforma.ts';
import { Abas } from '../../componentes/Abas.tsx';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro, EstadoVazio } from '../../componentes/estados.tsx';
import { CabecalhoPagina, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Confirmar, Modal } from '../../componentes/Modal.tsx';
import { Tabela } from '../../componentes/Tabela.tsx';
import { useToast } from '../../componentes/Toast.tsx';
import { useSessaoStarta } from './contexto.tsx';
import { AvisoEnvio, LinkParaCopiar, plural } from './pecas.tsx';

type Aba = 'equipe' | 'planos';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mensagem(e: unknown): string {
  const ex = e as ErroApiCliente;
  return ex.offline ? 'Sem conexão. Tente de novo quando a internet voltar.' : ex.message;
}

// ---------------------------------------------------------------- Códigos de recuperação

function CartaoCodigos() {
  const { eu, abrirCodigos } = useSessaoStarta();
  const poucos = eu.codigosRecuperacao <= 2;
  return (
    <section className="card card-pad cp-codigos-cartao" aria-labelledby="t-codigos">
      <div className="row-top" style={{ gap: 'var(--s-3)' }}>
        <span className="avatar cp-icone-cartao" aria-hidden="true">
          <Icone nome="cadeado" tamanho="sm" />
        </span>
        <div className="stack-sm grow" style={{ gap: 2 }}>
          <h2 id="t-codigos" className="h4">
            Meus códigos de recuperação
          </h2>
          <p className={`small ${poucos ? 'text-warning strong' : 'muted'}`}>
            {eu.codigosRecuperacao === 0
              ? 'Você não tem mais códigos de recuperação. Gere códigos novos para não ficar sem acesso se perder o celular.'
              : `${plural(eu.codigosRecuperacao, 'código ainda funciona', 'códigos ainda funcionam')}. Use um deles para entrar quando estiver sem o celular com o aplicativo autenticador.`}
          </p>
        </div>
      </div>
      <Botao icone="atualizar" onClick={abrirCodigos}>
        Gerar códigos novos
      </Botao>
    </section>
  );
}

// ---------------------------------------------------------------- Equipe Starta

function Situacao({ m }: { m: MembroStarta }) {
  if (!m.ativa) return <span className="badge">Desativada</span>;
  if (!m.ativada) return <span className="badge badge-warning">Aguardando ativação</span>;
  return (
    <span className="badge badge-success">
      <span className="dot" />
      Ativa
    </span>
  );
}

function ModalLink({ resultado, titulo, aoFechar }: { resultado: LinkAtivacao | null; titulo: string; aoFechar: () => void }) {
  return (
    <Modal
      aberto={!!resultado}
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <Botao variante="primario" onClick={aoFechar}>
          Pronto
        </Botao>
      }
    >
      {resultado ? (
        <>
          <p className="small">
            {resultado.membro.nome} cria a senha e liga o aplicativo autenticador por este link. Ele vale uma vez, até {fmt.dataHora(resultado.expiraEm)}.
          </p>
          <AvisoEnvio envio={resultado.envio} para={resultado.membro.email} oQue="o link de ativação" />
          <LinkParaCopiar link={resultado.link} rotulo="Link de ativação" />
        </>
      ) : null}
    </Modal>
  );
}

function ModalConvidar({ aberto, aoFechar, aoConvidar }: { aberto: boolean; aoFechar: () => void; aoConvidar: (r: LinkAtivacao) => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [erros, setErros] = useState<{ nome?: string; email?: string }>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    setNome('');
    setEmail('');
    setErros({});
    setErro(null);
    aoFechar();
  };

  const convidar = async () => {
    const e: typeof erros = {};
    if (nome.trim().length < 2) e.nome = 'Diga o nome da pessoa.';
    if (!EMAIL.test(email.trim())) e.email = 'Digite um e-mail válido.';
    setErros(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPlataforma.post<LinkAtivacao>('/equipe', { nome: nome.trim(), email: email.trim() });
      setNome('');
      setEmail('');
      aoConvidar(r);
    } catch (ex) {
      setErro(mensagem(ex));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo="Convidar para a equipe Starta"
      descricao="A pessoa recebe um link para criar a senha e ligar o aplicativo autenticador. Ela entra como Admin da plataforma."
      aoFechar={fechar}
      travado={enviando}
      largura={480}
      rodape={
        <>
          <Botao onClick={fechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={enviando} onClick={() => void convidar()}>
            Enviar convite
          </Botao>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void convidar();
        }}
      >
        <Campo rotulo="Nome" obrigatorio erro={erros.nome}>
          {(p) => <input {...p} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" data-autofoco />}
        </Campo>
        <Campo rotulo="E-mail" obrigatorio erro={erros.email}>
          {(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
        </Campo>
        {erro ? (
          <p className="error-text" role="alert">
            <Icone nome="alerta" tamanho="sm" />
            {erro}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function EquipeStarta() {
  const { eu } = useSessaoStarta();
  const toast = useToast();
  const equipe = useApiPlataforma<MembroStarta[]>('/equipe');
  const [convidando, setConvidando] = useState(false);
  const [link, setLink] = useState<{ r: LinkAtivacao; titulo: string } | null>(null);
  const [confirmar, setConfirmar] = useState<{ m: MembroStarta; acao: 'redefinir' | 'desativar' } | null>(null);
  const [reativando, setReativando] = useState<string | null>(null);
  const acao = useAcao(async (m: MembroStarta, a: 'redefinir' | 'desativar') => {
    if (a === 'redefinir') return { link: await apiPlataforma.post<LinkAtivacao>(`/equipe/${encodeURIComponent(m.id)}/redefinir`) };
    return { membro: await apiPlataforma.post<MembroStarta>(`/equipe/${encodeURIComponent(m.id)}/desativar`) };
  });

  const trocar = (m: MembroStarta) => equipe.definir((l) => l?.map((x) => (x.id === m.id ? m : x)));

  const executar = async (m: MembroStarta, a: 'redefinir' | 'desativar') => {
    const r = await acao.executar(m, a);
    if (!r) return false;
    if (r.link) {
      trocar(r.link.membro);
      setLink({ r: r.link, titulo: m.ativada ? `Acesso de ${m.nome} redefinido` : `Link novo para ${m.nome}` });
    } else if (r.membro) {
      trocar(r.membro);
      toast.sucesso(`${m.nome} não entra mais na Plataforma.`);
    }
    return true;
  };

  const reativar = async (m: MembroStarta) => {
    setReativando(m.id);
    try {
      trocar(await apiPlataforma.post<MembroStarta>(`/equipe/${encodeURIComponent(m.id)}/reativar`));
      toast.sucesso(`${m.nome} pode entrar na Plataforma de novo.`);
    } catch (e) {
      toast.erro(mensagem(e));
    } finally {
      setReativando(null);
    }
  };

  return (
    <section className="stack" aria-labelledby="t-equipe">
      <div className="row wrap between" style={{ alignItems: 'flex-end' }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 id="t-equipe" className="h3">
            Equipe Starta
          </h2>
          <p className="small muted">Quem entra na Plataforma. Cada pessoa ativa o acesso pelo link, com senha e aplicativo autenticador.</p>
        </div>
        <Botao variante="primario" icone="mais" onClick={() => setConvidando(true)}>
          Convidar pessoa
        </Botao>
      </div>
      {equipe.dados ? (
        <Tabela<MembroStarta>
          rotulo="Equipe Starta"
          linhas={equipe.dados}
          chave={(m) => m.id}
          vazio="Ninguém na equipe ainda."
          colunas={[
            {
              titulo: 'Pessoa',
              celula: (m) => (
                <div className="row" style={{ gap: 10 }}>
                  <span className={`avatar avatar-sm${m.ativa ? '' : ' cp-avatar-pausado'}`} aria-hidden="true">
                    {m.iniciais}
                  </span>
                  <div className="stack-sm" style={{ gap: 0 }}>
                    <span className="strong cp-sem-quebra">
                      {m.nome}
                      {m.id === eu.id ? <span className="tiny muted"> (você)</span> : null}
                    </span>
                    <span className="tiny muted">{m.email}</span>
                  </div>
                </div>
              ),
            },
            { titulo: 'Situação', celula: (m) => <Situacao m={m} /> },
            { titulo: 'Responsável por', classe: 'small cp-sem-quebra', celula: (m) => (m.empresas ? plural(m.empresas, 'empresa', 'empresas') : <span className="muted">Nenhuma empresa</span>) },
            { titulo: 'Último acesso', classe: 'small cp-sem-quebra', celula: (m) => (m.ultimoAcesso ? fmt.quando(m.ultimoAcesso) : <span className="muted">Nunca entrou</span>) },
            {
              titulo: 'Ações',
              tituloOculto: true,
              alinhar: 'direita',
              celula: (m) =>
                m.id === eu.id ? (
                  <span className="tiny muted cp-sem-quebra">Peça a outra pessoa para redefinir o seu acesso</span>
                ) : m.ativa ? (
                  <span className="row cp-acoes-linha">
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      aria-label={m.ativada ? `Redefinir acesso de ${m.nome}` : `Reenviar link de ativação para ${m.nome}`}
                      onClick={() => setConfirmar({ m, acao: 'redefinir' })}
                    >
                      {m.ativada ? 'Redefinir acesso' : 'Reenviar link'}
                    </Botao>
                    <Botao variante="fantasma" tamanho="sm" aria-label={`Desativar ${m.nome}`} onClick={() => setConfirmar({ m, acao: 'desativar' })}>
                      Desativar
                    </Botao>
                  </span>
                ) : (
                  <Botao variante="secundario" tamanho="sm" aria-label={`Reativar ${m.nome}`} carregando={reativando === m.id} onClick={() => void reativar(m)}>
                    Reativar
                  </Botao>
                ),
            },
          ]}
        />
      ) : equipe.erro ? (
        <EstadoErro erro={equipe.erro} aoTentar={() => void equipe.recarregar()} titulo="Não conseguimos carregar a equipe" />
      ) : (
        <Carregando forma="tabela" texto="Carregando a equipe…" />
      )}

      <ModalConvidar
        aberto={convidando}
        aoFechar={() => setConvidando(false)}
        aoConvidar={(r) => {
          setConvidando(false);
          equipe.definir((l) => (l ? [...l, r.membro] : [r.membro]));
          setLink({ r, titulo: `Convite para ${r.membro.nome}` });
        }}
      />
      <ModalLink resultado={link?.r ?? null} titulo={link?.titulo ?? ''} aoFechar={() => setLink(null)} />
      <Confirmar
        aberto={!!confirmar}
        titulo={
          confirmar?.acao === 'redefinir'
            ? confirmar.m.ativada
              ? `Redefinir o acesso de ${confirmar.m.nome}?`
              : `Reenviar o link de ativação para ${confirmar.m.nome}?`
            : `Desativar ${confirmar?.m.nome ?? ''}?`
        }
        texto={
          confirmar?.acao === 'redefinir'
            ? confirmar.m.ativada
              ? `A senha e o aplicativo autenticador de ${confirmar.m.nome} deixam de valer na hora, e as sessões abertas terminam. Um link novo vai por e-mail para ativar o acesso de novo.`
              : `Um link novo vai por e-mail para ${confirmar.m.email}. O link anterior deixa de valer.`
            : `${confirmar?.m.nome ?? ''} deixa de entrar na Plataforma na hora. As empresas pelas quais é responsável continuam com o nome até você trocar. Dá para reativar depois.`
        }
        rotuloConfirmar={confirmar?.acao === 'redefinir' ? (confirmar.m.ativada ? 'Redefinir acesso' : 'Reenviar link') : 'Desativar'}
        perigo={confirmar?.acao === 'desativar'}
        carregando={acao.enviando}
        erro={acao.erro ? mensagem(acao.erro) : null}
        aoConfirmar={async () => {
          if (confirmar && (await executar(confirmar.m, confirmar.acao))) setConfirmar(null);
        }}
        aoFechar={() => {
          acao.limparErro();
          setConfirmar(null);
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------- Planos e preços

const CAMPOS_PRECO: { chave: keyof PrecosPlano; rotulo: string; ajuda: string }[] = [
  { chave: 'precoMensalCentavos', rotulo: 'Preço mensal', ajuda: 'Por mês, com os créditos incluídos.' },
  { chave: 'taxaImplantacaoCentavos', rotulo: 'Taxa de implantação', ajuda: 'Uma vez, no começo.' },
  { chave: 'precoCreditoExtraCentavos', rotulo: 'Preço do crédito extra', ajuda: 'Entra na receita e na margem de Uso e custos.' },
];

/** 199000 → "1.990,00"; null → "". */
export function centavosParaCampo(c: number | null): string {
  return c === null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1.990,00", "1990", "0,45", "R$ 12" → centavos; "" → null; inválido → undefined. */
export function campoParaCentavos(s: string): number | null | undefined {
  const limpo = s.replace(/R\$|\s/g, '');
  if (!limpo) return null;
  let normal: string;
  if (limpo.includes(',')) normal = limpo.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, '');
  else normal = limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return undefined;
  return Math.round(Number(normal) * 100);
}

function usuarios(p: Plano): string {
  return p.usuariosMax === null ? `Mais de ${fmt.numero(Math.max(0, p.usuariosMin - 1))} usuários` : `${fmt.numero(p.usuariosMin)} a ${fmt.numero(p.usuariosMax)} usuários`;
}

function CartaoPlano({ plano, aoSalvar }: { plano: Plano; aoSalvar: (p: Plano) => void }) {
  const toast = useToast();
  const inicial = Object.fromEntries(CAMPOS_PRECO.map((c) => [c.chave, centavosParaCampo(plano[c.chave])])) as Record<keyof PrecosPlano, string>;
  const [v, setV] = useState(inicial);
  const [erros, setErros] = useState<Partial<Record<keyof PrecosPlano, string>>>({});
  const salvar = useAcao((corpo: Partial<PrecosPlano>) => apiPlataforma.put<Plano>(`/planos/${encodeURIComponent(plano.id)}`, corpo));
  const mudou = CAMPOS_PRECO.some((c) => v[c.chave] !== inicial[c.chave]);

  const enviar = async () => {
    const corpo: Partial<PrecosPlano> = {};
    const e: typeof erros = {};
    for (const c of CAMPOS_PRECO) {
      if (v[c.chave] === inicial[c.chave]) continue;
      const centavos = campoParaCentavos(v[c.chave]);
      if (centavos === undefined) e[c.chave] = 'Use um valor em reais, como 1.990,00 ou 0,45.';
      else corpo[c.chave] = centavos;
    }
    setErros(e);
    if (Object.keys(e).length) return;
    const r = await salvar.executar(corpo);
    if (!r) return;
    aoSalvar(r);
    toast.sucesso(`Preços do plano ${r.nome} salvos.`);
  };

  return (
    <article className="card cp-plano" aria-labelledby={`plano-${plano.id}`}>
      <div className="card-head cp-painel-cabeca">
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <h3 id={`plano-${plano.id}`} className="h4">
            {plano.nome}
          </h3>
          <span className="tiny muted">
            {usuarios(plano)} · {plano.creditosIncluidos === null ? 'créditos sob medida' : `${plural(plano.creditosIncluidos, 'crédito', 'créditos')} por mês`}
          </span>
        </div>
        <span className="tiny muted cp-sem-quebra">Atualizado em {fmt.data(plano.atualizadoEm)}</span>
      </div>
      <form
        className="card-body stack"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        {plano.descricao ? <p className="small muted">{plano.descricao}</p> : null}
        <div className="cp-campos-3">
          {CAMPOS_PRECO.map((c) => (
            <Campo key={c.chave} rotulo={`${c.rotulo} (R$)`} erro={erros[c.chave]} ajuda={c.ajuda}>
              {(p) => (
                <input
                  {...p}
                  className={`${p.className} num`}
                  inputMode="decimal"
                  placeholder="Sob consulta"
                  value={v[c.chave]}
                  onChange={(e) => setV((x) => ({ ...x, [c.chave]: e.target.value }))}
                />
              )}
            </Campo>
          ))}
        </div>
        {salvar.erro ? (
          <p className="error-text" role="alert">
            <Icone nome="alerta" tamanho="sm" />
            {mensagem(salvar.erro)}
          </p>
        ) : null}
        <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
          {mudou ? (
            <Botao
              variante="fantasma"
              onClick={() => {
                setV(inicial);
                setErros({});
                salvar.limparErro();
              }}
              disabled={salvar.enviando}
            >
              Desfazer
            </Botao>
          ) : null}
          <Botao type="submit" variante="primario" carregando={salvar.enviando} disabled={!mudou}>
            Salvar preços
          </Botao>
        </div>
      </form>
    </article>
  );
}

function PlanosPrecos() {
  const { atualizar } = useSessaoStarta();
  const planos = useApiPlataforma<Plano[]>('/planos');
  return (
    <section className="stack" aria-labelledby="t-planos">
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2 id="t-planos" className="h3">
          Planos e preços
        </h2>
        <p className="small muted">Valores em reais. Deixe vazio para o site mostrar “Sob consulta”. O preço do crédito extra é o que entra na margem por crédito.</p>
      </div>
      {planos.dados ? (
        planos.dados.length ? (
          [...planos.dados]
            .sort((a, b) => a.ordem - b.ordem)
            .map((p) => (
              <CartaoPlano
                // Preço salvo muda a chave: o cartão volta com os valores novos, sem efeito para copiar a prop.
                key={`${p.id}:${CAMPOS_PRECO.map((c) => p[c.chave]).join('|')}`}
                plano={p}
                aoSalvar={(novo) => {
                  planos.definir((l) => l?.map((x) => (x.id === novo.id ? novo : x)));
                  atualizar();
                }}
              />
            ))
        ) : (
          <EstadoVazio emCartao icone="cartao" titulo="Nenhum plano cadastrado" />
        )
      ) : planos.erro ? (
        <EstadoErro erro={planos.erro} aoTentar={() => void planos.recarregar()} titulo="Não conseguimos carregar os planos" />
      ) : (
        <Carregando forma="ficha" texto="Carregando os planos…" />
      )}
    </section>
  );
}

export default function Configuracoes() {
  const [params, setParams] = useSearchParams();
  const aba: Aba = params.get('aba') === 'planos' ? 'planos' : 'equipe';
  return (
    <>
      <CabecalhoPagina titulo="Configurações" subtitulo="Quem entra na Plataforma, os preços dos planos e o seu acesso." />
      <CartaoCodigos />
      <Abas<Aba>
        rotulo="Seções das configurações"
        ativa={aba}
        aoTrocar={(a) => setParams(a === 'equipe' ? {} : { aba: a }, { replace: true })}
        abas={[
          { chave: 'equipe', rotulo: 'Equipe Starta' },
          { chave: 'planos', rotulo: 'Planos e preços' },
        ]}
      />
      <div id={`painel-${aba}`} role="tabpanel" aria-labelledby={`aba-${aba}`}>
        {aba === 'equipe' ? <EquipeStarta /> : <PlanosPrecos />}
      </div>
    </>
  );
}

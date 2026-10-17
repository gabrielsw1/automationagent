// Estados de tela do design (Estados-Console): carregando, vazio, erro, offline e sem permissão.
// Use estes componentes em todas as páginas para que os estados fiquem iguais no console inteiro.
//
//   if (carregando) return <Carregando forma="painel" />;          // esqueleto com a forma do conteúdo
//   if (erro) return <EstadoErro erro={erro} aoTentar={recarregar} titulo="Não conseguimos carregar as tarefas" />;
//   <EstadoVazio icone="tarefas" titulo="Crie a primeira tarefa" texto="..." acao={<Botao>...</Botao>} />
//   <SemPermissao area="Limites de gasto" />
//
// EstadoErro escolhe sozinho: sem conexão → EstadoOffline; 403 → SemPermissao.
import { useEffect, useState, type ReactNode } from 'react';
import { ROTULO_PERFIL } from '@copiloto/shared';
import type { ErroApiCliente } from '../api/cliente.ts';
import { Icone, type NomeIcone } from './icones.tsx';
import { useSessaoOpcional } from './sessao.tsx';

function useDemorou(ms = 10_000): boolean {
  const [demorou, setDemorou] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDemorou(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return demorou;
}

function Skel({ w, h = 12, raio }: { w: string | number; h?: number; raio?: number | string }) {
  return <div className="skel" style={{ width: w, height: h, borderRadius: raio }} />;
}

function EsqueletoTabela({ linhas }: { linhas: number }) {
  const larguras = ['40%', '52%', '34%', '46%', '38%', '50%'];
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="row" style={{ padding: '10px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <Skel w="18%" h={10} />
        <Skel w="30%" h={10} />
        <div style={{ marginLeft: 'auto', width: '16%' }}>
          <Skel w="100%" h={10} />
        </div>
      </div>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="row" style={{ padding: '12px 14px', borderBottom: i < linhas - 1 ? '1px solid var(--line)' : 0 }}>
          <Skel w={24} h={24} raio="50%" />
          <Skel w={larguras[i % larguras.length]} />
          <div style={{ marginLeft: 'auto' }}>
            <Skel w={64} h={20} raio={999} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Carregando. Sem `forma`, mostra o giro com texto. Com `forma`, um esqueleto com o desenho do
 * conteúdo: 'painel' (indicadores + tabela), 'tabela', 'ficha' (formulário). `linhas` (legado)
 * mostra linhas simples. Depois de 10 s aparece "Ainda carregando…".
 */
export function Carregando({
  texto = 'Carregando…',
  linhas = 0,
  forma,
}: {
  texto?: string;
  linhas?: number;
  forma?: 'painel' | 'tabela' | 'ficha';
}) {
  const demorou = useDemorou();
  const aviso = demorou ? <p className="tiny muted">Ainda carregando… A conexão está lenta, mas nada foi perdido.</p> : null;
  if (forma) {
    return (
      <div className="stack ca-esqueleto" aria-busy="true" aria-live="polite">
        <span className="sr-only">{texto}</span>
        {forma === 'painel' ? (
          <div className="grid-kpi">
            {[60, 50, 65, 55].map((w, i) => (
              <div key={i} className="card stack-sm" style={{ padding: 'var(--s-4)' }}>
                <Skel w={`${w}%`} />
                <Skel w={`${w + 20}%`} h={24} />
              </div>
            ))}
          </div>
        ) : null}
        {forma === 'ficha' ? (
          <div className="card stack" style={{ padding: 'var(--s-6)' }}>
            <Skel w="30%" h={14} />
            <Skel w="100%" h={88} raio="var(--r-md)" />
            <Skel w="45%" h={14} />
            <Skel w="100%" h={40} raio="var(--r-md)" />
            <Skel w="100%" h={40} raio="var(--r-md)" />
          </div>
        ) : (
          <EsqueletoTabela linhas={forma === 'painel' ? 4 : 5} />
        )}
        {aviso}
      </div>
    );
  }
  if (linhas > 0) {
    return (
      <div className="stack-sm ca-esqueleto" aria-busy="true" aria-label={texto}>
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="skel" style={{ height: 14, width: `${[60, 90, 75, 85, 70][i % 5]}%` }} />
        ))}
        {aviso}
      </div>
    );
  }
  return (
    <div className="estado estado-carregando" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{demorou ? 'Ainda carregando…' : texto}</span>
    </div>
  );
}

/** Erro ao carregar (faixa vermelha com "Tentar de novo" e o código para o suporte). */
export function EstadoErro({
  erro,
  aoTentar,
  titulo,
  texto,
}: {
  erro: ErroApiCliente | Error | null;
  aoTentar?: () => void;
  titulo?: string;
  /** Explicação; padrão: a mensagem do servidor. */
  texto?: string;
}) {
  const e = erro as ErroApiCliente | null;
  if (e && 'offline' in e && e.offline) return <EstadoOffline aoTentar={aoTentar} />;
  if (e && 'status' in e && e.status === 403) return <SemPermissao mensagem={e.message} />;
  const status = e && 'status' in e && e.status ? e.status : null;
  const ref = e && 'ref' in e ? e.ref : undefined;
  return (
    <div className="alert alert-danger estado-erro" role="alert">
      <Icone nome="alerta" />
      <div className="stack-sm">
        <p className="strong">{titulo ?? 'Não conseguimos carregar esta página'}</p>
        <p className="small">
          {texto ?? e?.message ?? 'Algo deu errado do nosso lado.'} Nada foi perdido e o copiloto continua atendendo as pessoas.
        </p>
        <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
          {aoTentar ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={aoTentar}>
              <Icone nome="atualizar" tamanho="sm" />
              Tentar de novo
            </button>
          ) : null}
          {status || ref ? (
            <span className="mono tiny muted">
              {status ? `Erro ${status}` : ''}
              {status && ref ? ' · ' : ''}
              {ref ? `ref ${ref}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EstadoOffline({ aoTentar }: { aoTentar?: () => void }) {
  return (
    <div className="empty estado-offline" role="alert">
      <div className="empty-icon" aria-hidden="true">
        <Icone nome="sem-conexao" tamanho="lg" />
      </div>
      <h3 className="h3">Você está sem internet</h3>
      <p>Confira a conexão. O que você já preencheu continua guardado neste navegador.</p>
      {aoTentar ? (
        <button type="button" className="btn btn-secondary" onClick={aoTentar}>
          <Icone nome="atualizar" tamanho="sm" />
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function EstadoVazio({
  titulo,
  texto,
  acao,
  icone = 'tarefas',
  emCartao,
}: {
  titulo: string;
  texto?: ReactNode;
  acao?: ReactNode;
  icone?: NomeIcone;
  /** Envolve num cartão branco (quando o vazio é a página inteira). */
  emCartao?: boolean;
}) {
  return (
    <div className={`empty estado-vazio${emCartao ? ' card' : ''}`}>
      <div className="empty-icon" aria-hidden="true">
        <Icone nome={icone} tamanho="lg" />
      </div>
      <h3 className="h3">{titulo}</h3>
      {texto ? <p>{texto}</p> : null}
      {acao}
    </div>
  );
}

/** Sem permissão. `area` diz o quê ("Limites de gasto"); `mensagem` substitui a explicação. */
export function SemPermissao({ mensagem, area, acao }: { mensagem?: string; area?: string; acao?: ReactNode }) {
  const sessao = useSessaoOpcional();
  const perfil = sessao ? ROTULO_PERFIL[sessao.resumo.eu.perfil] : null;
  return (
    <div className="empty estado-sem-permissao" role="alert">
      <div className="empty-icon ca-icone-neutro" aria-hidden="true">
        <Icone nome="cadeado" tamanho="lg" />
      </div>
      <h3 className="h3">{area ? `Você não tem acesso a ${area}` : 'Seu perfil não tem acesso a esta área'}</h3>
      <p>
        {mensagem ?? 'Peça a um Admin para mudar seu perfil em Equipe e limites.'}
        {perfil && !/Seu perfil é/i.test(mensagem ?? '') ? ` Seu perfil é ${perfil}.` : ''}
      </p>
      {acao}
    </div>
  );
}

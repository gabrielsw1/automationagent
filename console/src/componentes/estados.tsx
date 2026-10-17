// Estados de tela do design (Estados-Console): carregando, vazio, erro, offline e sem permissão.
// Use estes componentes em todas as páginas para que os estados fiquem iguais no console inteiro.
import type { ReactNode } from 'react';
import type { ErroApiCliente } from '../api/cliente.ts';

export function Carregando({ texto = 'Carregando…', linhas = 0 }: { texto?: string; linhas?: number }) {
  if (linhas > 0) {
    return (
      <div className="esqueleto" aria-busy="true" aria-label={texto}>
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="esqueleto-linha" />
        ))}
      </div>
    );
  }
  return (
    <div className="estado estado-carregando" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}

export function EstadoErro({ erro, aoTentar, titulo }: { erro: ErroApiCliente | Error | null; aoTentar?: () => void; titulo?: string }) {
  const e = erro as ErroApiCliente | null;
  if (e && 'offline' in e && e.offline) return <EstadoOffline aoTentar={aoTentar} />;
  if (e && 'status' in e && e.status === 403) return <SemPermissao mensagem={e.message} />;
  return (
    <div className="estado estado-erro empty" role="alert">
      <div className="empty-icon" aria-hidden="true">!</div>
      <h3>{titulo ?? 'Não foi possível carregar'}</h3>
      <p>{e?.message ?? 'Algo deu errado. Tente de novo.'}</p>
      {e && 'ref' in e && e.ref ? <p className="text-muted">Código para o suporte: {e.ref}</p> : null}
      {aoTentar ? (
        <button className="btn btn-secondary" onClick={aoTentar}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function EstadoOffline({ aoTentar }: { aoTentar?: () => void }) {
  return (
    <div className="estado estado-offline empty" role="alert">
      <div className="empty-icon" aria-hidden="true">⌁</div>
      <h3>Sem conexão</h3>
      <p>Confira a internet. O que você já preencheu continua aqui.</p>
      {aoTentar ? (
        <button className="btn btn-secondary" onClick={aoTentar}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function EstadoVazio({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="estado estado-vazio empty">
      <div className="empty-icon" aria-hidden="true">○</div>
      <h3>{titulo}</h3>
      {texto ? <p>{texto}</p> : null}
      {acao}
    </div>
  );
}

export function SemPermissao({ mensagem }: { mensagem?: string }) {
  return (
    <div className="estado estado-sem-permissao empty" role="alert">
      <div className="empty-icon" aria-hidden="true">🔒</div>
      <h3>Seu perfil não tem acesso a esta área</h3>
      <p>{mensagem ?? 'Peça a um Admin para mudar seu perfil em Equipe e limites.'}</p>
    </div>
  );
}

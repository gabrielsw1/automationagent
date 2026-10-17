// Chat do copiloto em modo de teste, "como" um usuário do sistema. Nada é gravado no sistema e as
// tarefas usam o rascunho quando houver. Usado no "Testar copiloto", no guia (C0) e na
// pré-visualização da ficha (C3).
//
//   <ChatDeTeste altura={520} />                         // escolhe o usuário num seletor
//   <ChatDeTeste altura={480} seletor="pilula" />        // seletor compacto "Como Ana Ribeiro"
//   <ChatDeTeste seletor="pilula" titulo={<h2>Pré-visualizar</h2>} reinicio={versao} />
//                                    // título à esquerda da pílula; mudar `reinicio` recomeça a conversa
//
// Busca os usuários em GET /sistema/usuarios e o token em POST /teste/token.
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { UsuarioSistema } from '@copiloto/shared';
import { ChatCopiloto } from '@copiloto/widget/chat';
import '@copiloto/widget/chat.css';
import { api, type ErroApiCliente } from '../api/cliente.ts';
import { Icone } from './icones.tsx';
import { guardado } from './pagina.tsx';

let cacheUsuarios: Promise<UsuarioSistema[]> | null = null;

/** Usuários do sistema (com cache durante a sessão do console). */
export function usuariosDoSistema(): Promise<UsuarioSistema[]> {
  if (!cacheUsuarios) {
    cacheUsuarios = api.get<UsuarioSistema[]>('/sistema/usuarios').catch((e) => {
      cacheUsuarios = null;
      throw e;
    });
  }
  return cacheUsuarios;
}

export function useUsuariosDoSistema() {
  const [usuarios, setUsuarios] = useState<UsuarioSistema[] | null>(null);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let vivo = true;
    usuariosDoSistema()
      .then((u) => vivo && (setUsuarios(u), setErro(null)))
      .catch((e: ErroApiCliente) => vivo && setErro(e));
    return () => {
      vivo = false;
    };
  }, [tentativa]);
  return { usuarios, erro, tentar: () => setTentativa((n) => n + 1) };
}

const CHAVE_USUARIO = 'copiloto:teste:usuario';

export function ChatDeTeste({
  altura = 560,
  seletor = 'campo',
  usuarioInicial,
  aoFechar,
  titulo,
  reinicio,
}: {
  altura?: number | string;
  seletor?: 'campo' | 'pilula';
  usuarioInicial?: string;
  aoFechar?: () => void;
  /** Só no seletor "pilula": conteúdo à esquerda da pílula (ex.: o título do cartão). */
  titulo?: ReactNode;
  /** Quando muda, a conversa recomeça (ex.: depois de salvar o rascunho). */
  reinicio?: string | number;
}) {
  const id = useId();
  const { usuarios, erro: erroUsuarios, tentar } = useUsuariosDoSistema();
  const [usuarioId, setUsuarioId] = useState<string>(usuarioInicial ?? guardado.ler<string>(CHAVE_USUARIO) ?? '');
  const [token, setToken] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!usuarios || usuarios.length === 0) return;
    if (!usuarios.some((u) => u.id === usuarioId)) setUsuarioId(usuarios[0].id);
  }, [usuarios, usuarioId]);

  useEffect(() => {
    if (!usuarioId || !usuarios?.some((u) => u.id === usuarioId)) return;
    let vivo = true;
    setToken(null);
    setErro(null);
    api
      .post<{ token: string }>('/teste/token', { usuarioId })
      .then((r) => vivo && setToken(r.token))
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [usuarioId, usuarios]);

  const trocar = (v: string) => {
    setUsuarioId(v);
    guardado.gravar(CHAVE_USUARIO, v);
  };

  const escolhido = usuarios?.find((u) => u.id === usuarioId);
  const opcoes = (usuarios ?? []).map((u) => (
    <option key={u.id} value={u.id}>
      {seletor === 'pilula' ? `Como ${u.nome}` : `${u.nome} · ${u.perfis.join(', ')}`}
    </option>
  ));

  return (
    <div className="stack-sm ca-chat-teste">
      {seletor === 'campo' ? (
        <div className="field">
          <label htmlFor={`${id}-u`}>Testar como</label>
          <select id={`${id}-u`} className="select" value={usuarioId} onChange={(e) => trocar(e.target.value)} disabled={!usuarios}>
            {usuarios ? opcoes : <option>Carregando usuários…</option>}
          </select>
          <span className="help">O copiloto age com as permissões de quem você escolher. Nada é gravado no sistema.</span>
        </div>
      ) : (
        <div className="row between wrap ca-chat-teste-pilula">
          {titulo}
          <label className="sr-only" htmlFor={`${id}-u`}>
            Pré-visualizar como
          </label>
          <select
            id={`${id}-u`}
            className="context-pill ca-pilula-select"
            value={usuarioId}
            onChange={(e) => trocar(e.target.value)}
            disabled={!usuarios}
            title={escolhido ? `Perfis: ${escolhido.perfis.join(', ')}` : undefined}
          >
            {usuarios ? opcoes : <option>Carregando…</option>}
          </select>
        </div>
      )}
      {erroUsuarios ? (
        <div className="alert alert-danger" role="alert">
          <Icone nome="alerta" />
          <div className="stack-sm">
            <p className="small">{erroUsuarios.message} Sem a lista de usuários do sistema não dá para abrir o chat de teste.</p>
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={tentar}>
                Tentar de novo
              </button>
            </div>
          </div>
        </div>
      ) : erro ? (
        <div className="alert alert-danger" role="alert">
          <Icone nome="alerta" />
          <p className="small">{erro}</p>
        </div>
      ) : token ? (
        <ChatCopiloto key={`${token}:${reinicio ?? ''}`} token={token} altura={altura} aoFechar={aoFechar} />
      ) : (
        <div className="card stack-sm ca-chat-carregando" style={{ height: altura }} aria-busy="true">
          <span className="sr-only">Abrindo o chat de teste</span>
          <div className="skel" style={{ height: 14, width: '60%' }} />
          <div className="skel" style={{ height: 14, width: '90%' }} />
          <div className="skel" style={{ height: 14, width: '75%' }} />
        </div>
      )}
    </div>
  );
}

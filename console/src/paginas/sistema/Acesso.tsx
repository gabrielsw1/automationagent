// Como o copiloto entra no sistema da empresa para fazer as tarefas: com a sessão de quem pede
// (recomendado), com uma conta de serviço ou sem login. Usado no cadastro (etapa "Seu sistema")
// e na tela Sistema. Em nenhum dos modos a senha passa pela IA.
import { useId, type ReactNode } from 'react';
import type { ModoAcesso, SistemaEmpresaPedido } from '@copiloto/shared';
import { Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { enderecoValido, paginaLoginValida } from './endereco.ts';
import './sistema.css';

export interface FormAcesso {
  modo: ModoAcesso;
  urlSessao: string;
  urlLogin: string;
  usuario: string;
  /** Vazio mantém a senha guardada. */
  senha: string;
}

export type ErrosAcesso = Partial<Record<'urlSessao' | 'urlLogin' | 'usuario' | 'senha', string>>;

export const ROTULO_MODO: Record<ModoAcesso, string> = {
  sessao: 'Com a sessão de quem pede',
  conta: 'Com uma conta de serviço',
  nenhum: 'Sem login',
};

const MODOS: Record<ModoAcesso, { texto: string; pros: string[]; atencao: string; recomendado?: boolean }> = {
  sessao: {
    texto:
      'Seu sistema assina o widget com a identidade de quem está logado e entrega ao copiloto uma sessão dessa pessoa. O navegador na nuvem age com as permissões dela.',
    pros: ['Age com as permissões de quem pediu', 'Nenhuma senha é guardada pela Starta'],
    atencao: 'Pede uma pequena mudança no seu sistema: assinar o widget e responder ao pedido de sessão',
    recomendado: true,
  },
  conta: {
    texto:
      'Você cria um usuário para o copiloto no seu sistema. A senha fica guardada num cofre e só o navegador na nuvem a usa para entrar. Ela nunca vai para a IA.',
    pros: ['Começa sem mudar nada no seu sistema', 'Cada tarefa continua definindo quem pode pedir'],
    atencao: 'No sistema, age com o acesso dessa conta. Dê a ela só o necessário.',
  },
  nenhum: {
    texto: 'As telas do sistema abrem direto, sem pedir login. Serve para sistemas internos ou de teste.',
    pros: ['Nada para configurar'],
    atencao: 'Quem chega ao endereço vê as telas. Use só se o sistema já é protegido de outro jeito.',
  },
};

export function validarAcesso(a: FormAcesso, urlSistema: string, temSenha: boolean): ErrosAcesso {
  const e: ErrosAcesso = {};
  if (a.modo === 'sessao' && a.urlSessao.trim() && !enderecoValido(a.urlSessao)) {
    e.urlSessao = 'Use o endereço completo, começando com https://';
  }
  if (a.modo === 'conta') {
    if (!a.urlLogin.trim()) e.urlLogin = 'Diga em que página o copiloto entra no sistema.';
    else if (!paginaLoginValida(a.urlLogin, urlSistema)) e.urlLogin = 'Use o endereço completo da página de login ou um caminho do sistema, como /login.';
    if (!a.usuario.trim()) e.usuario = 'Diga o usuário da conta do copiloto.';
    if (!temSenha && !a.senha) e.senha = 'Digite a senha da conta do copiloto.';
  }
  return e;
}

/** `acesso` do PUT /sistema/config: os endereços e o usuário sempre vão, vazios quando o modo não usa. */
export function pedidoAcesso(a: FormAcesso): SistemaEmpresaPedido['acesso'] {
  return {
    modo: a.modo,
    urlSessao: a.modo === 'sessao' ? a.urlSessao.trim() : '',
    urlLogin: a.modo === 'conta' ? a.urlLogin.trim() : '',
    usuario: a.modo === 'conta' ? a.usuario.trim() : '',
    ...(a.modo === 'conta' && a.senha ? { senha: a.senha } : {}),
  };
}

export function EscolhaAcesso({
  modos,
  valor,
  mudar,
  erros,
  aoSair,
  temSenha,
  travado = false,
  ajudaSessao,
}: {
  modos: ModoAcesso[];
  valor: FormAcesso;
  mudar: (p: Partial<FormAcesso>) => void;
  /** Só os erros que já devem aparecer (campos tocados). */
  erros: ErrosAcesso;
  aoSair?: (campo: keyof ErrosAcesso) => void;
  /** Já há senha guardada para a conta de serviço. */
  temSenha: boolean;
  travado?: boolean;
  ajudaSessao?: ReactNode;
}) {
  const grupo = useId();
  return (
    <div className="cs-modos">
      {modos.map((m) => {
        const info = MODOS[m];
        const escolhido = valor.modo === m;
        const id = `${grupo}-${m}`;
        return (
          <div key={m} className={`cs-modo${escolhido ? ' escolhido' : ''}${travado ? ' cs-modo-travado' : ''}`}>
            <label className="cs-modo-topo" htmlFor={id}>
              <input id={id} type="radio" name={grupo} checked={escolhido} disabled={travado} onChange={() => mudar({ modo: m })} />
              <span className="stack-sm" style={{ gap: 4 }}>
                <span className="row wrap" style={{ gap: 'var(--s-2)' }}>
                  <span className="h4">{ROTULO_MODO[m]}</span>
                  {info.recomendado ? <span className="badge badge-success">Recomendado</span> : null}
                </span>
                <span className="small cs-modo-texto">{info.texto}</span>
              </span>
            </label>
            <ul className="card-flat small cs-modo-lista">
              {info.pros.map((p) => (
                <li key={p}>
                  <Icone nome="check" tamanho="sm" className="text-success" />
                  {p}
                </li>
              ))}
              <li>
                <Icone nome={m === 'sessao' ? 'info' : 'alerta'} tamanho="sm" className="text-warning" />
                {info.atencao}
              </li>
            </ul>

            {escolhido && m === 'sessao' ? (
              <Campo rotulo="Endereço de sessão" erro={erros.urlSessao} ajuda={ajudaSessao}>
                {(p) => (
                  <input
                    {...p}
                    className={`${p.className} mono`}
                    type="url"
                    inputMode="url"
                    value={valor.urlSessao}
                    disabled={travado}
                    onChange={(e) => mudar({ urlSessao: e.target.value })}
                    onBlur={() => aoSair?.('urlSessao')}
                    placeholder="https://erp.suaempresa.com.br/copiloto/sessao"
                  />
                )}
              </Campo>
            ) : null}
            {escolhido && m === 'conta' ? (
              <>
                <Campo
                  rotulo="Página de login"
                  obrigatorio
                  erro={erros.urlLogin}
                  ajuda="Onde o copiloto digita o usuário e a senha. Pode ser só o caminho, como /login."
                >
                  {(p) => (
                    <input
                      {...p}
                      className={`${p.className} mono`}
                      value={valor.urlLogin}
                      disabled={travado}
                      onChange={(e) => mudar({ urlLogin: e.target.value })}
                      onBlur={() => aoSair?.('urlLogin')}
                      placeholder="https://erp.suaempresa.com.br/login"
                    />
                  )}
                </Campo>
                <Campo rotulo="Usuário" obrigatorio erro={erros.usuario}>
                  {(p) => (
                    <input
                      {...p}
                      autoComplete="off"
                      value={valor.usuario}
                      disabled={travado}
                      onChange={(e) => mudar({ usuario: e.target.value })}
                      onBlur={() => aoSair?.('usuario')}
                      placeholder="Ex.: copiloto@suaempresa.com.br"
                    />
                  )}
                </Campo>
                <Campo
                  rotulo="Senha"
                  obrigatorio={!temSenha}
                  erro={erros.senha}
                  ajuda="Fica guardada com criptografia e só o navegador do copiloto usa, para entrar antes de cada fluxo. Ela nunca volta para esta tela nem vai para a IA."
                >
                  {(p) => (
                    <input
                      {...p}
                      type="password"
                      autoComplete="new-password"
                      value={valor.senha}
                      disabled={travado}
                      onChange={(e) => mudar({ senha: e.target.value })}
                      onBlur={() => aoSair?.('senha')}
                      placeholder={temSenha ? 'Guardada. Deixe em branco para manter.' : undefined}
                    />
                  )}
                </Campo>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Resultado de "Verificar endereço" ou "Testar acesso". */
export function ResultadoVerificacao({ ok, titulo, detalhe }: { ok: boolean; titulo: string; detalhe: string }) {
  return (
    <div className={`alert ${ok ? 'alert-success' : 'alert-danger'} cs-resultado`} role="status">
      <Icone nome={ok ? 'check' : 'alerta'} />
      <div className="stack-sm" style={{ gap: 2 }}>
        <span className="strong">{titulo}</span>
        <span className="small">{detalhe}</span>
      </div>
    </div>
  );
}

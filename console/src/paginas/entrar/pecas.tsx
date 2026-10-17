// Peças das telas de acesso: senha com "Mostrar", regras embaixo da senha, contagem do reenvio,
// datas ("hoje, 09:12") e o caminho depois de entrar (escolher a empresa, confirmar o e-mail ou ir).
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt, type Entrada } from '@copiloto/shared';
import { Icone } from '../../componentes/icones.tsx';

/** ?voltar=<caminho do console>: só caminhos daqui, nunca outro site. */
export function destinoDepoisDeEntrar(voltar: string | null): string {
  const v = voltar ?? '';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.startsWith('/entrar')) return '/';
  return v;
}

/** O que a entrada passa para "Em qual empresa você quer entrar?" (A2) no estado da navegação. */
export interface EstadoEscolha {
  entrada: Entrada;
  /** O e-mail digitado: sem empresa, a entrada não traz quem é. */
  email: string;
}

/**
 * Depois de entrar (A1) ou de salvar a senha nova (A4): e-mail ainda sem confirmar vai ao código do
 * cadastro (A5); sem empresa, com mais de uma ou com aviso para ler, à escolha da empresa (A2);
 * senão, direto ao destino.
 */
export function useSeguirEntrada() {
  const navegar = useNavigate();
  return useCallback(
    (entrada: Entrada, email: string, destino: string) => {
      if (entrada.eu && !entrada.eu.emailConfirmado) {
        navegar('/criar-conta', { replace: true });
      } else if (!entrada.eu || entrada.empresas.length > 1 || entrada.avisos.length > 0) {
        const voltar = destino === '/' ? '' : `?voltar=${encodeURIComponent(destino)}`;
        const estado: EstadoEscolha = { entrada, email };
        navegar(`/entrar/empresa${voltar}`, { replace: true, state: estado });
      } else {
        navegar(destino, { replace: true });
      }
    },
    [navegar],
  );
}

/** "hoje, 09:12", "ontem, 16:40" ou "14/10/2026" (último acesso, na escolha da empresa). */
export function quandoMinusculo(iso: string, agora = new Date()): string {
  return fmt.quando(iso, agora).replace(/^(Hoje|Ontem)/, (p) => p.toLowerCase());
}

/** "10:40 de hoje", "00:30 de amanhã" ou "10:40 de 18/10/2026" (validade do link de senha nova). */
export function horaEDia(iso: string, agora = new Date()): string {
  const dia = fmt.data(iso);
  const quando = dia === fmt.data(agora) ? 'hoje' : dia === fmt.data(new Date(agora.getTime() + 86400_000)) ? 'amanhã' : dia;
  return `${fmt.hora(iso)} de ${quando}`;
}

/**
 * Contagem regressiva em segundos ("Reenviar em 45 s"). `comecar(s)` recomeça; `restam` chega a 0.
 * Conta pelo relógio: com a aba em segundo plano (timers mais lentos), não fica para trás.
 */
export function useContagem(): { restam: number; comecar: (segundos: number) => void } {
  const [restam, setRestam] = useState(0);
  const fim = useRef(0);
  useEffect(() => {
    if (restam <= 0) return;
    const t = setTimeout(() => setRestam((r) => Math.max(0, Math.min(r - 1, Math.ceil((fim.current - Date.now()) / 1000)))), 1000);
    return () => clearTimeout(t);
  }, [restam]);
  const comecar = useCallback((segundos: number) => {
    fim.current = Date.now() + segundos * 1000;
    setRestam(Math.max(0, Math.ceil(segundos)));
  }, []);
  return { restam, comecar };
}

/** Uma regra embaixo da senha: verde com ✓ quando cumprida; vermelha depois de tentar enviar sem ela. */
export function ItemRegra({ ok, erro, children }: { ok: boolean; erro?: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'text-success' : erro ? 'text-danger' : 'muted'}>
      <Icone nome={ok ? 'check' : 'circulo'} tamanho="sm" />
      {children}
      <span className="sr-only">{ok ? ': ok' : ': falta'}</span>
    </li>
  );
}

/**
 * Senha com o botão "Mostrar". `acessorio` fica na linha do rótulo ("Esqueci a senha"); `regras`
 * são os <ItemRegra> embaixo do campo.
 */
export function CampoSenha({
  rotulo,
  valor,
  aoMudar,
  aoSair,
  autoComplete,
  obrigatorio,
  acessorio,
  regras,
  entrada,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  aoSair?: () => void;
  autoComplete: 'current-password' | 'new-password';
  obrigatorio?: boolean;
  acessorio?: ReactNode;
  regras?: ReactNode;
  entrada?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [ver, setVer] = useState(false);
  const rotuloEl = (
    <label htmlFor={id} className={acessorio ? 'label' : undefined}>
      {rotulo}
      {obrigatorio ? (
        <>
          {' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </>
      ) : null}
    </label>
  );
  return (
    <div className="field">
      {acessorio ? (
        <div className="row between">
          {rotuloEl}
          {acessorio}
        </div>
      ) : (
        rotuloEl
      )}
      <div className="ca-senha">
        <input
          ref={entrada}
          id={id}
          className="input"
          type={ver ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={valor}
          maxLength={200}
          aria-required={obrigatorio || undefined}
          aria-describedby={regras ? `${id}-regras` : undefined}
          onChange={(e) => aoMudar(e.target.value)}
          onBlur={aoSair}
        />
        <button type="button" className="btn btn-ghost btn-sm ca-ver-senha" onClick={() => setVer((v) => !v)} aria-pressed={ver} aria-controls={id}>
          {ver ? 'Esconder' : 'Mostrar'}
        </button>
      </div>
      {regras ? (
        <ul id={`${id}-regras`} className="row wrap tiny ce-regras">
          {regras}
        </ul>
      ) : null}
    </div>
  );
}

/** "Repetir senha": confere com a primeira e diz "As duas senhas são iguais" ou o erro. */
export function CampoRepetirSenha({
  rotulo,
  senha,
  valor,
  aoMudar,
  aoSair,
  mostrarErro,
  obrigatorio,
}: {
  rotulo: string;
  senha: string;
  valor: string;
  aoMudar: (v: string) => void;
  aoSair?: () => void;
  /** Depois de sair do campo ou de tentar enviar. */
  mostrarErro: boolean;
  obrigatorio?: boolean;
}) {
  const id = useId();
  const erro = mostrarErro && valor !== senha;
  return (
    <div className="field">
      <label htmlFor={id}>
        {rotulo}
        {obrigatorio ? (
          <>
            {' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </>
        ) : null}
      </label>
      <input
        id={id}
        className={`input${erro ? ' is-error' : ''}`}
        type="password"
        autoComplete="new-password"
        value={valor}
        maxLength={200}
        aria-required={obrigatorio || undefined}
        aria-invalid={erro || undefined}
        aria-describedby={`${id}-igual`}
        onChange={(e) => aoMudar(e.target.value)}
        onBlur={aoSair}
      />
      <div id={`${id}-igual`} aria-live="polite">
        {erro ? (
          <span className="error-text">
            <Icone nome="alerta" tamanho="sm" />
            As senhas não são iguais. Digite a mesma senha nos dois campos.
          </span>
        ) : valor && valor === senha ? (
          <ul className="row wrap tiny ce-regras">
            <ItemRegra ok>As duas senhas são iguais</ItemRegra>
          </ul>
        ) : null}
      </div>
    </div>
  );
}

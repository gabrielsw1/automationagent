// A5 · Confirme o seu e-mail: o código de 6 dígitos que a conta nova recebe na etapa 1 do cadastro.
// Até confirmar, o servidor só responde às rotas de acesso, então o Cadastro mostra esta tela no
// lugar de qualquer etapa (também quando a pessoa fecha a aba e entra de novo depois). O código vale
// 10 minutos e 5 tentativas; "Reenviar código" libera depois da espera do servidor (45 s).
import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ConfirmacaoEmail, Eu } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo, NotaCaixaDeSaida } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useContagem } from '../entrar/pecas.tsx';
import { erroEmailTrabalho } from './regras.ts';

const VAZIO = ['', '', '', '', '', ''];

/** Seis quadrados de um dígito. Colar o código inteiro (ou o preenchimento do celular) preenche todos. */
function CampoCodigo({ digitos, aoMudar, erro }: { digitos: string[]; aoMudar: (d: string[]) => void; erro: string | null }) {
  const id = useId();
  const quadros = useRef<(HTMLInputElement | null)[]>([]);

  const preencher = (inicio: number, texto: string) => {
    const novos = [...digitos];
    let i = inicio;
    for (const c of texto.replace(/\D/g, '').slice(0, 6 - inicio)) novos[i++] = c;
    aoMudar(novos);
    quadros.current[Math.min(i, 5)]?.focus();
  };

  const mudar = (i: number, valor: string): void => {
    const v = valor.replace(/\D/g, '');
    // Digitou por cima do dígito que já estava: fica o novo.
    if (v.length === 2 && digitos[i]) return mudar(i, v[0] === digitos[i] ? v[1] : v[0]);
    if (v.length > 1) return preencher(i, v);
    const novos = [...digitos];
    novos[i] = v;
    aoMudar(novos);
    if (v && i < 5) quadros.current[i + 1]?.focus();
  };

  return (
    <fieldset className="stack-sm ce-fieldset" aria-describedby={`${id}-ajuda`}>
      <legend className="label">Código de 6 dígitos</legend>
      <div className="row ce-codigo">
        {digitos.map((d, i) => (
          <Fragment key={i}>
            <label className="sr-only" htmlFor={`${id}-${i}`}>
              Dígito {i + 1} de 6
            </label>
            <input
              ref={(el) => {
                quadros.current[i] = el;
              }}
              id={`${id}-${i}`}
              className={`input num ce-digito${erro ? ' is-error' : ''}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              value={d}
              aria-invalid={erro ? true : undefined}
              autoFocus={i === 0}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => mudar(i, e.target.value)}
              onPaste={(e) => {
                e.preventDefault();
                preencher(i, e.clipboardData.getData('text'));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !d && i > 0) {
                  e.preventDefault();
                  const novos = [...digitos];
                  novos[i - 1] = '';
                  aoMudar(novos);
                  quadros.current[i - 1]?.focus();
                } else if (e.key === 'ArrowLeft' && i > 0) {
                  quadros.current[i - 1]?.focus();
                } else if (e.key === 'ArrowRight' && i < 5) {
                  quadros.current[i + 1]?.focus();
                }
              }}
            />
          </Fragment>
        ))}
      </div>
      {erro ? (
        <span id={`${id}-ajuda`} className="error-text" role="alert">
          <Icone nome="alerta" tamanho="sm" />
          {erro}
        </span>
      ) : (
        <span id={`${id}-ajuda`} className="help">
          Pode colar o código inteiro no primeiro quadrado. Ele vale por 10 minutos.
        </span>
      )}
    </fieldset>
  );
}

export default function ConfirmarEmail({ aoConfirmar }: { aoConfirmar: (eu: Eu) => void }) {
  const id = useId();
  const [conf, setConf] = useState<ConfirmacaoEmail | null>(null);
  const [erroCarga, setErroCarga] = useState<ErroApiCliente | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [digitos, setDigitos] = useState(VAZIO);
  // Código incorreto (embaixo dos quadrados) e código expirado (no lugar deles).
  const [erro, setErro] = useState<string | null>(null);
  const [expirado, setExpirado] = useState<string | null>(null);
  // Falha ao reenviar ou ao trocar o e-mail.
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [novoEmail, setNovoEmail] = useState('');
  const [tocadoEmail, setTocadoEmail] = useState(false);
  const [status, setStatus] = useState('');
  const { restam, comecar } = useContagem();

  useEffect(() => {
    let vivo = true;
    api
      .get<ConfirmacaoEmail>('/auth/email')
      .then((c) => {
        if (!vivo) return;
        setConf(c);
        comecar(c.reenviarEmS);
        setErroCarga(null);
      })
      .catch((e: ErroApiCliente) => vivo && setErroCarga(e));
    return () => {
      vivo = false;
    };
  }, [tentativa, comecar]);

  /** Chegou um código novo (reenviado ou para o e-mail trocado): recomeça a tela. */
  const codigoNovo = (c: ConfirmacaoEmail) => {
    setConf(c);
    comecar(c.reenviarEmS);
    setDigitos(VAZIO);
    setErro(null);
    setExpirado(null);
    setStatus(`Enviamos um código novo para ${c.email}.`);
  };

  const confirmar = async (e: FormEvent) => {
    e.preventDefault();
    const codigo = digitos.join('');
    if (codigo.length < 6) {
      setErro('Digite os 6 dígitos do código.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      aoConfirmar(await api.post<Eu>('/auth/email/confirmar', { codigo }));
    } catch (ex) {
      const e = ex as ErroApiCliente;
      if (e.erro === 'codigo_expirado') setExpirado(e.message);
      else setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const reenviar = async () => {
    setReenviando(true);
    setAviso(null);
    try {
      codigoNovo(await api.post<ConfirmacaoEmail>('/auth/email/reenviar'));
    } catch (ex) {
      const e = ex as ErroApiCliente;
      if (e.extra.aguardarS) comecar(e.extra.aguardarS);
      setAviso(e.message);
    } finally {
      setReenviando(false);
    }
  };

  const abrirTroca = () => {
    setNovoEmail(conf?.email ?? '');
    setTocadoEmail(false);
    setAviso(null);
    setTrocando(true);
  };

  const trocar = async (e: FormEvent) => {
    e.preventDefault();
    setTocadoEmail(true);
    if (erroEmailTrabalho(novoEmail)) return;
    setReenviando(true);
    setAviso(null);
    try {
      codigoNovo(await api.post<ConfirmacaoEmail>('/auth/email/trocar', { email: novoEmail.trim() }));
      setTrocando(false);
    } catch (ex) {
      setAviso((ex as ErroApiCliente).message);
    } finally {
      setReenviando(false);
    }
  };

  if (!conf) {
    return erroCarga ? (
      <EstadoErro erro={erroCarga} aoTentar={() => setTentativa((n) => n + 1)} titulo="Não consegui abrir a confirmação do e-mail" />
    ) : (
      <Carregando />
    );
  }

  const erroAviso = aviso ? (
    <Aviso tipo="erro" papel="alert">
      {aviso}
    </Aviso>
  ) : null;

  if (trocando) {
    return (
      <form className="stack" onSubmit={trocar} noValidate aria-labelledby={`${id}-t`}>
        <div className="stack-sm">
          <h1 id={`${id}-t`} className="h2">
            Trocar e-mail
          </h1>
          <p className="muted">Digite o e-mail certo. Vamos enviar um código novo para ele.</p>
        </div>
        {erroAviso}
        <Campo rotulo="E-mail de trabalho" obrigatorio erro={tocadoEmail ? erroEmailTrabalho(novoEmail) : null}>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={novoEmail}
              onChange={(e) => setNovoEmail(e.target.value)}
              onBlur={() => setTocadoEmail(true)}
              placeholder="nome@suaempresa.com.br"
              autoFocus
            />
          )}
        </Campo>
        <Botao type="submit" variante="primario" tamanho="lg" bloco icone="enviar" carregando={reenviando}>
          Enviar código
        </Botao>
        <button className="btn btn-ghost btn-block" type="button" onClick={() => (setTrocando(false), setAviso(null))}>
          Cancelar
        </button>
      </form>
    );
  }

  const linkTrocar = (
    <button className="ce-link strong" type="button" onClick={abrirTroca}>
      Trocar e-mail
    </button>
  );

  return (
    <form className="stack" onSubmit={confirmar} noValidate aria-labelledby={`${id}-t`}>
      <div className="stack-sm">
        <h1 id={`${id}-t`} className="h2">
          Confirme o seu e-mail
        </h1>
        {expirado ? null : (
          <p className="muted">
            Enviamos um código de 6 dígitos para{' '}
            <span className="strong" style={{ color: 'var(--ink-900)' }}>
              {conf.email}
            </span>
            .
          </p>
        )}
      </div>
      {expirado ? (
        <>
          <div className="alert alert-warning" role="alert">
            <Icone nome="relogio" />
            <p className="small">{expirado}</p>
          </div>
          {erroAviso}
          <button className={`btn btn-primary btn-lg btn-block${reenviando ? ' is-loading' : ''}`} type="button" disabled={reenviando} onClick={() => void reenviar()}>
            <Icone nome="atualizar" tamanho="sm" />
            Enviar outro código
          </button>
          <p className="small muted" style={{ textAlign: 'center' }}>
            Vamos enviar para {conf.email}. {linkTrocar}
          </p>
        </>
      ) : (
        <>
          {erroAviso}
          <CampoCodigo
            digitos={digitos}
            aoMudar={(d) => {
              setDigitos(d);
              setErro(null);
            }}
            erro={erro}
          />
          <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
            Confirmar
          </Botao>
          <div className="row between wrap" style={{ gap: 'var(--s-2)' }}>
            <button className="btn btn-ghost btn-sm ce-reenviar" type="button" disabled={restam > 0 || reenviando} onClick={() => void reenviar()}>
              <Icone nome={restam > 0 ? 'relogio' : 'atualizar'} tamanho="sm" />
              {restam > 0 ? `Reenviar código em ${restam} s` : 'Reenviar código'}
            </button>
            <span className="small">{linkTrocar}</span>
          </div>
          <hr className="divider" />
          <p className="tiny muted">Não chegou? Confira a caixa de spam ou de promoções. O assunto é “Seu código do Copiloto Starta”.</p>
        </>
      )}
      <NotaCaixaDeSaida envio={conf.envio} />
      <p className="sr-only" role="status">
        {status}
      </p>
    </form>
  );
}

// Etapa 2 do cadastro: "Seu sistema". Onde o copiloto vai trabalhar (endereço, com "Verificar
// endereço") e como ele entra lá (sessão de quem pede ou conta de serviço). Já logado na empresa
// nova: salva com PUT /sistema/config e segue para a marca.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Eu, SistemaEmpresa, VerificacaoSistema } from '@copiloto/shared';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso } from '../../componentes/formulario.tsx';
import { EscolhaAcesso, pedidoAcesso, ResultadoVerificacao, validarAcesso, type ErrosAcesso, type FormAcesso } from '../sistema/Acesso.tsx';
import { completarEndereco, enderecoValido, hostDe } from '../sistema/endereco.ts';

export default function EtapaSistema({ eu, aoContinuar }: { eu: Eu; aoContinuar: () => void }) {
  const config = useApi<SistemaEmpresa>('/sistema/config');
  const [url, setUrl] = useState('');
  const [acesso, setAcesso] = useState<FormAcesso | null>(null);
  const [tocados, setTocados] = useState<Partial<Record<'url' | keyof ErrosAcesso, boolean>>>({});
  const [verificacao, setVerificacao] = useState<(VerificacaoSistema & { url: string }) | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);

  const s = config.dados;
  useEffect(() => {
    if (!s || acesso) return;
    setUrl(s.url);
    // Empresa nova: a sessão de quem pede vem marcada (recomendado). Só a conta de serviço fica, se já escolhida.
    setAcesso({
      modo: s.acesso.modo === 'conta' ? 'conta' : 'sessao',
      urlSessao: s.acesso.urlSessao,
      urlLogin: s.acesso.urlLogin,
      usuario: s.acesso.usuario,
      senha: '',
    });
  }, [s, acesso]);

  if (!s || !acesso) {
    return config.erro ? (
      <EstadoErro erro={config.erro} aoTentar={() => void config.recarregar()} titulo="Não conseguimos abrir os dados do sistema" />
    ) : (
      <Carregando forma="ficha" texto="Abrindo os dados do sistema…" />
    );
  }

  const erroUrl = !enderecoValido(url) ? 'Use o endereço completo do sistema, começando com https://' : null;
  const errosAcesso = validarAcesso(acesso, url, s.acesso.temSenha);
  const errosVisiveis = Object.fromEntries(Object.entries(errosAcesso).filter(([k]) => tocados[k as keyof ErrosAcesso])) as ErrosAcesso;

  const verificar = async () => {
    setVerificando(true);
    setErro(null);
    try {
      const r = await api.post<VerificacaoSistema>('/sistema/verificar', { url: url.trim() });
      setVerificacao({ ...r, url: url.trim() });
    } catch (e) {
      setErro(e as ErroApiCliente);
    } finally {
      setVerificando(false);
    }
  };

  const continuar = async () => {
    setTocados({ url: true, urlSessao: true, urlLogin: true, usuario: true, senha: true });
    if (erroUrl || Object.keys(errosAcesso).length) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.put<SistemaEmpresa>('/sistema/config', {
        nome: s.nome || eu.empresa.nome,
        url: url.trim(),
        acesso: pedidoAcesso(acesso),
        perfis: s.perfis,
      });
      aoContinuar();
    } catch (e) {
      setErro(e as ErroApiCliente);
    } finally {
      setSalvando(false);
    }
  };

  const mostrarErroUrl = tocados.url ? erroUrl : null;
  return (
    <section className="card" aria-labelledby="cc-sistema">
      <div className="card-body stack-lg">
        <div className="stack-sm">
          <h1 id="cc-sistema" className="h1">
            Seu sistema
          </h1>
          <p className="muted body-lg">Onde o copiloto vai trabalhar e como ele entra lá.</p>
        </div>

        {erro ? (
          <Aviso tipo="erro" papel="alert">
            {erro.offline ? 'Sem conexão. Confira a internet e tente de novo.' : erro.message}
          </Aviso>
        ) : null}

        <div className="field" style={{ maxWidth: 720 }}>
          <label htmlFor="cc-endereco">
            Endereço do sistema{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <div className="input-group">
            <input
              id="cc-endereco"
              className={`input mono${mostrarErroUrl ? ' is-error' : ''}`}
              type="url"
              inputMode="url"
              value={url}
              aria-required
              aria-invalid={mostrarErroUrl ? true : undefined}
              aria-describedby="cc-endereco-ajuda"
              placeholder="https://erp.suaempresa.com.br"
              onChange={(e) => {
                setUrl(e.target.value);
                setVerificacao(null);
              }}
              onBlur={() => {
                setUrl((u) => completarEndereco(u));
                setTocados((t) => ({ ...t, url: true }));
              }}
            />
            <Botao icone="atualizar" carregando={verificando} disabled={!!erroUrl} onClick={() => void verificar()}>
              Verificar endereço
            </Botao>
          </div>
          {mostrarErroUrl ? <span className="error-text">{mostrarErroUrl}</span> : null}
          <span id="cc-endereco-ajuda" className="help">
            A página que as pessoas abrem para entrar no sistema.
          </span>
          {verificacao && verificacao.url === url.trim() ? (
            <ResultadoVerificacao
              ok={verificacao.ok}
              titulo={verificacao.ok ? `Encontramos ${hostDe(verificacao.url)}` : `Não conseguimos abrir ${hostDe(verificacao.url)}`}
              detalhe={verificacao.detalhe}
            />
          ) : null}
        </div>

        <fieldset className="stack cc-fieldset">
          <legend className="stack-sm" style={{ gap: 2 }}>
            <span className="h3">Como o copiloto entra no seu sistema</span>
            <span className="small muted" style={{ display: 'block' }}>
              Você pode trocar depois. Em nenhuma das opções a senha passa pela IA.
            </span>
          </legend>
          <EscolhaAcesso
            modos={['sessao', 'conta']}
            valor={acesso}
            mudar={(p) => setAcesso((a) => (a ? { ...a, ...p } : a))}
            erros={errosVisiveis}
            aoSair={(c) => setTocados((t) => ({ ...t, [c]: true }))}
            temSenha={s.acesso.temSenha}
            ajudaSessao="Opcional agora. O time técnico configura depois; as instruções estão em Canais e widget."
          />
        </fieldset>
      </div>
      <div className="card-foot" style={{ justifyContent: 'space-between' }}>
        <Link className="btn btn-ghost" to="/guia">
          Configurar depois
        </Link>
        <Botao variante="primario" carregando={salvando} onClick={() => void continuar()}>
          Continuar para Sua marca
        </Botao>
      </div>
    </section>
  );
}

// Etapa 3 do cadastro: "Sua marca". Nome do assistente, cor e primeira mensagem, com a
// pré-visualização ao lado. Grava na configuração do widget (rascunho e publicação), a mesma de
// Canais e widget, e abre o console no guia de início.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Canais, ConfigWidget, Eu } from '@copiloto/shared';
import { PreviaWidget } from '@copiloto/widget/chat';
import '@copiloto/widget/chat.css';
import { api, type ErroApiCliente } from '../../api/cliente.ts';
import { useApi } from '../../api/hooks.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Carregando, EstadoErro } from '../../componentes/estados.tsx';
import { Aviso, Campo } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { contrasteComBranco, textoContraste, useCoresSugeridas } from '../canais/marca.ts';

type FormMarca = Pick<ConfigWidget, 'nome' | 'cor' | 'boasVindas'>;

export default function EtapaMarca({ eu, aoVoltar }: { eu: Eu; aoVoltar: () => void }) {
  const navegar = useNavigate();
  const canais = useApi<Canais>('/canais');
  const cores = useCoresSugeridas();
  const [form, setForm] = useState<FormMarca | null>(null);
  const [corDigitada, setCorDigitada] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<ErroApiCliente | null>(null);
  const [tentou, setTentou] = useState(false);

  const r = canais.dados?.rascunho;
  useEffect(() => {
    if (!r || form) return;
    setForm({ nome: r.nome, cor: r.cor.toUpperCase(), boasVindas: r.boasVindas });
    setCorDigitada(r.cor.toUpperCase());
  }, [r, form]);

  if (!r || !form) {
    return canais.erro ? (
      <EstadoErro erro={canais.erro} aoTentar={() => void canais.recarregar()} titulo="Não conseguimos abrir a configuração do assistente" />
    ) : (
      <Carregando forma="ficha" texto="Abrindo a configuração do assistente…" />
    );
  }

  const erros = {
    nome: !form.nome.trim() ? 'Dê um nome ao assistente.' : form.nome.trim().length > 40 ? 'O nome pode ter até 40 caracteres.' : null,
    cor: !/^#[0-9a-fA-F]{6}$/.test(form.cor) ? 'Use a cor no formato #RRGGBB, com 6 letras ou números depois do #.' : null,
    boasVindas: !form.boasVindas.trim()
      ? 'Escreva a primeira mensagem.'
      : form.boasVindas.trim().length > 280
        ? 'A primeira mensagem pode ter até 280 caracteres.'
        : null,
  };
  const contraste = contrasteComBranco(form.cor);
  const mudar = (p: Partial<FormMarca>) => setForm((f) => (f ? { ...f, ...p } : f));

  const entrar = async () => {
    setTentou(true);
    if (erros.nome || erros.cor || erros.boasVindas) return;
    setSalvando(true);
    setErro(null);
    try {
      const config: ConfigWidget = { ...r, nome: form.nome.trim(), cor: form.cor, boasVindas: form.boasVindas.trim() };
      await api.put<Canais>('/canais/rascunho', { config });
      await api.post<Canais>('/canais/publicar');
      navegar('/guia', { replace: true });
    } catch (e) {
      setErro(e as ErroApiCliente);
    } finally {
      setSalvando(false);
    }
  };

  const mostrar = (k: keyof typeof erros) => (tentou ? erros[k] : null);
  return (
    <section className="card" aria-labelledby="cc-marca">
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1 id="cc-marca" className="h2">
            Sua marca
          </h1>
          <p className="small muted">Como o assistente aparece para quem usa o seu sistema.</p>
        </div>
      </div>
      <div className="card-body">
        <div className="split">
          <div className="main-col stack-lg">
            {erro ? (
              <Aviso tipo="erro" papel="alert">
                {erro.offline ? 'Sem conexão. Confira a internet e tente de novo.' : erro.message}
              </Aviso>
            ) : null}
            <Campo rotulo="Nome do assistente" obrigatorio erro={mostrar('nome')} ajuda="Aparece no topo do assistente.">
              {(p) => <input {...p} value={form.nome} maxLength={40} onChange={(e) => mudar({ nome: e.target.value })} placeholder={`Ex.: Assistente ${eu.empresa.nome}`} />}
            </Campo>

            <fieldset className="stack-sm cc-fieldset">
              <legend className="label">Cor principal</legend>
              <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
                {cores.map((c) => {
                  const escolhida = c.valor === form.cor.toUpperCase();
                  return (
                    <button
                      key={c.valor}
                      type="button"
                      className="cc-cor"
                      aria-label={`${c.rotulo}${escolhida ? ', selecionada' : ''}`}
                      aria-pressed={escolhida}
                      style={{ background: c.valor }}
                      onClick={() => {
                        mudar({ cor: c.valor });
                        setCorDigitada(c.valor);
                      }}
                    />
                  );
                })}
                <label className="sr-only" htmlFor="cc-cor-hex">
                  Outra cor, em código hexadecimal
                </label>
                <input
                  id="cc-cor-hex"
                  className={`input mono${mostrar('cor') ? ' is-error' : ''}`}
                  style={{ width: 120 }}
                  maxLength={7}
                  value={corDigitada}
                  onChange={(e) => {
                    let v = e.target.value.trim();
                    if (v && !v.startsWith('#')) v = `#${v}`;
                    setCorDigitada(v);
                    mudar({ cor: v.toUpperCase() });
                  }}
                />
              </div>
              {erros.cor ? (
                <span className="error-text">
                  <Icone nome="alerta" tamanho="sm" />
                  {erros.cor}
                </span>
              ) : contraste !== null && contraste >= 4.5 ? (
                <span className="row small text-success" style={{ gap: 6 }}>
                  <Icone nome="check" tamanho="sm" />
                  Texto branco fica legível sobre esta cor ({textoContraste(contraste)}).
                </span>
              ) : contraste !== null ? (
                <span className="row-top small text-warning" style={{ gap: 6 }}>
                  <Icone nome="alerta" tamanho="sm" />
                  Texto branco fica difícil de ler sobre esta cor ({textoContraste(contraste)}). Nos botões com texto, o assistente usa um tom
                  mais escuro dela. Prefira uma cor mais forte.
                </span>
              ) : null}
            </fieldset>

            <Campo
              rotulo="Primeira mensagem"
              obrigatorio
              classe="textarea"
              erro={mostrar('boasVindas')}
              ajuda="Diga o que o assistente sabe fazer. Assim ninguém pede o que ele ainda não faz."
            >
              {(p) => <textarea {...p} rows={3} maxLength={280} value={form.boasVindas} onChange={(e) => mudar({ boasVindas: e.target.value })} />}
            </Campo>
          </div>

          <div className="side-col stack-sm">
            <span className="eyebrow">Pré-visualização</span>
            <div className="cc-previa">
              <PreviaWidget config={{ ...r, nome: form.nome, cor: erros.cor ? r.cor : form.cor, boasVindas: form.boasVindas }} usuarioNome={eu.nome} />
            </div>
            <span className="tiny muted" style={{ textAlign: 'center' }}>
              Atualiza enquanto você edita. É assim que as pessoas vão ver.
            </span>
          </div>
        </div>
      </div>
      <div className="card-foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row wrap">
          <Botao variante="fantasma" icone="seta-esquerda" onClick={aoVoltar}>
            Voltar
          </Botao>
          <span className="small muted">Você pode mudar tudo isso depois em Canais e widget.</span>
        </div>
        <Botao variante="primario" tamanho="lg" iconeDepois="seta-direita" carregando={salvando} onClick={() => void entrar()}>
          Entrar no console
        </Botao>
      </div>
    </section>
  );
}

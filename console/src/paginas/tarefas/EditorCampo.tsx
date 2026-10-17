// Janela para criar ou editar um campo da ficha: rótulo, chave, tipo, obrigatório, pergunta,
// opções e validação. Valida antes de devolver o campo.
import { useEffect, useState } from 'react';
import type { Campo, TipoCampo } from '@copiloto/shared';
import { Botao } from '../../componentes/Botao.tsx';
import { Campo as CampoForm } from '../../componentes/formulario.tsx';
import { Modal } from '../../componentes/Modal.tsx';
import { AJUDA_TIPO, CHAVE_VALIDA, chaveDoRotulo, ROTULO_TIPO } from './ficha.ts';

const TIPOS = Object.keys(ROTULO_TIPO) as TipoCampo[];

function numeroOuVazio(v: string): number | undefined {
  const t = v.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export default function EditorCampo({
  aberto,
  campo,
  chavesUsadas,
  aoSalvar,
  aoRemover,
  aoFechar,
}: {
  aberto: boolean;
  /** null: campo novo. */
  campo: Campo | null;
  /** Chaves dos outros campos (para não repetir). */
  chavesUsadas: string[];
  aoSalvar: (c: Campo) => void;
  aoRemover?: () => void;
  aoFechar: () => void;
}) {
  const [c, setC] = useState<Campo>(() => campo ?? { chave: '', rotulo: '', tipo: 'texto', obrigatorio: true, pergunta: '' });
  const [chaveManual, setChaveManual] = useState(!!campo);
  const [opcoesTexto, setOpcoesTexto] = useState((campo?.opcoes ?? []).join('\n'));
  const [minimo, setMinimo] = useState(campo?.minimo?.toString() ?? '');
  const [maximo, setMaximo] = useState(campo?.maximo?.toString() ?? '');
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setC(campo ?? { chave: '', rotulo: '', tipo: 'texto', obrigatorio: true, pergunta: '' });
    setChaveManual(!!campo);
    setOpcoesTexto((campo?.opcoes ?? []).join('\n'));
    setMinimo(campo?.minimo?.toString() ?? '');
    setMaximo(campo?.maximo?.toString() ?? '');
    setTentou(false);
  }, [aberto, campo]);

  const mudar = (p: Partial<Campo>) => setC((x) => ({ ...x, ...p }));
  const perguntar = c.perguntar !== false;
  const opcoes = opcoesTexto
    .split(/\n|;/)
    .map((o) => o.trim())
    .filter(Boolean);

  const erros = {
    rotulo: !c.rotulo.trim() ? 'Dê um nome ao campo, como a pessoa entende. Ex.: E-mail de cobrança.' : null,
    chave: !c.chave
      ? 'Informe a chave técnica.'
      : !CHAVE_VALIDA.test(c.chave)
        ? 'Use só letras minúsculas sem acento, números e _ (ex.: email_cobranca).'
        : chavesUsadas.includes(c.chave)
          ? 'Outro campo já usa esta chave. Escolha outra.'
          : null,
    pergunta: c.obrigatorio && perguntar && !c.pergunta.trim() ? 'Escreva a pergunta que o agente faz quando este dado falta.' : null,
    opcoes: c.tipo === 'lista' && opcoes.length < 2 ? 'Informe pelo menos duas opções, uma por linha.' : null,
    padrao: !perguntar && c.obrigatorio && !c.padrao ? 'Como o agente não pergunta, dê um valor padrão.' : null,
    limites:
      numeroOuVazio(minimo) !== undefined && numeroOuVazio(maximo) !== undefined && numeroOuVazio(minimo)! > numeroOuVazio(maximo)!
        ? 'O mínimo não pode ser maior que o máximo.'
        : null,
  };
  const temErro = Object.values(erros).some(Boolean);
  const mostrar = (k: keyof typeof erros) => (tentou ? erros[k] : null);

  const salvar = () => {
    setTentou(true);
    if (temErro) return;
    const final: Campo = {
      chave: c.chave,
      rotulo: c.rotulo.trim(),
      tipo: c.tipo,
      obrigatorio: c.obrigatorio,
      pergunta: perguntar ? c.pergunta.trim() : '',
    };
    if (c.tipo === 'lista') final.opcoes = opcoes;
    const usaLimites = c.tipo === 'texto' || c.tipo === 'numero' || c.tipo === 'moeda';
    if (usaLimites && numeroOuVazio(minimo) !== undefined) final.minimo = numeroOuVazio(minimo);
    if ((c.tipo === 'numero' || c.tipo === 'moeda') && numeroOuVazio(maximo) !== undefined) final.maximo = numeroOuVazio(maximo);
    if (c.padrao) final.padrao = c.padrao;
    if (!perguntar) final.perguntar = false;
    if (c.tipo === 'documento' && c.verificarExistente) final.verificarExistente = true;
    if (c.ajuda?.trim()) final.ajuda = c.ajuda.trim();
    aoSalvar(final);
  };

  return (
    <Modal
      aberto={aberto}
      titulo={campo ? `Editar campo “${campo.rotulo}”` : 'Adicionar campo'}
      descricao="O copiloto só pede confirmação quando todos os obrigatórios estão preenchidos e válidos."
      aoFechar={aoFechar}
      largura={640}
      rodape={
        <>
          {campo && aoRemover ? (
            <Botao variante="fantasma" className="text-danger ct-remover" icone="lixeira" onClick={aoRemover}>
              Remover campo
            </Botao>
          ) : null}
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={salvar}>
            {campo ? 'Salvar campo' : 'Adicionar campo'}
          </Botao>
        </>
      }
    >
      <div className="grid-2 ct-grade-form">
        <CampoForm rotulo="Nome do campo" obrigatorio erro={mostrar('rotulo')}>
          {(p) => (
            <input
              {...p}
              value={c.rotulo}
              data-autofoco
              placeholder="Ex.: E-mail de cobrança"
              onChange={(e) => mudar({ rotulo: e.target.value, ...(chaveManual ? {} : { chave: chaveDoRotulo(e.target.value) }) })}
            />
          )}
        </CampoForm>
        <CampoForm rotulo="Chave técnica" obrigatorio erro={mostrar('chave')} ajuda="Usada no mapeamento e nos títulos, como {nome_empresa}.">
          {(p) => (
            <input
              {...p}
              className={`${p.className} mono`}
              value={c.chave}
              spellCheck={false}
              onChange={(e) => {
                setChaveManual(true);
                mudar({ chave: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') });
              }}
            />
          )}
        </CampoForm>
      </div>

      <div className="grid-2 ct-grade-form">
        <CampoForm rotulo="Tipo" classe="select" ajuda={AJUDA_TIPO[c.tipo]}>
          {(p) => (
            <select
              {...p}
              value={c.tipo}
              onChange={(e) => {
                const tipo = e.target.value as TipoCampo;
                mudar({ tipo, ...(tipo === 'pessoa' && !c.padrao ? { padrao: 'solicitante' } : {}) });
              }}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </option>
              ))}
            </select>
          )}
        </CampoForm>
        <div className="stack-sm ct-checks">
          <label className="check">
            <input type="checkbox" checked={c.obrigatorio} onChange={(e) => mudar({ obrigatorio: e.target.checked })} />
            Obrigatório
          </label>
          <label className="check">
            <input type="checkbox" checked={perguntar} onChange={(e) => mudar({ perguntar: e.target.checked ? undefined : false })} />
            O agente pergunta quando falta
          </label>
          {c.tipo === 'documento' ? (
            <label className="check">
              <input type="checkbox" checked={!!c.verificarExistente} onChange={(e) => mudar({ verificarExistente: e.target.checked || undefined })} />
              Conferir se já existe cadastro antes de gravar
            </label>
          ) : null}
        </div>
      </div>

      {perguntar ? (
        <CampoForm rotulo="Pergunta que o agente faz" obrigatorio={c.obrigatorio} erro={mostrar('pergunta')} ajuda="Uma pergunta curta, do jeito que um colega perguntaria.">
          {(p) => <input {...p} value={c.pergunta} placeholder="Ex.: Qual é o e-mail de cobrança da empresa?" onChange={(e) => mudar({ pergunta: e.target.value })} />}
        </CampoForm>
      ) : (
        <p className="small muted ct-nota">Não pergunta. Mostra no cartão de confirmação para a pessoa trocar se quiser.</p>
      )}

      {c.tipo === 'lista' ? (
        <CampoForm rotulo="Opções aceitas" classe="textarea" obrigatorio erro={mostrar('opcoes')} ajuda="Uma por linha, do jeito que aparecem no sistema. Ex.: 15 dias.">
          {(p) => <textarea {...p} rows={4} value={opcoesTexto} onChange={(e) => setOpcoesTexto(e.target.value)} />}
        </CampoForm>
      ) : null}

      {c.tipo === 'texto' ? (
        <CampoForm rotulo="Mínimo de letras" ajuda="Deixe vazio para aceitar qualquer tamanho." style={{ maxWidth: 240 }}>
          {(p) => <input {...p} inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value.replace(/[^\d]/g, ''))} />}
        </CampoForm>
      ) : null}

      {c.tipo === 'numero' || c.tipo === 'moeda' ? (
        <div className="grid-2 ct-grade-form">
          <CampoForm rotulo={c.tipo === 'moeda' ? 'Valor mínimo (R$)' : 'Valor mínimo'} erro={mostrar('limites')}>
            {(p) => <input {...p} inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} />}
          </CampoForm>
          <CampoForm rotulo={c.tipo === 'moeda' ? 'Valor máximo (R$)' : 'Valor máximo'}>
            {(p) => <input {...p} inputMode="decimal" value={maximo} onChange={(e) => setMaximo(e.target.value)} />}
          </CampoForm>
        </div>
      ) : null}

      {c.tipo === 'pessoa' ? (
        <CampoForm rotulo="Valor padrão" classe="select" erro={mostrar('padrao')}>
          {(p) => (
            <select {...p} value={c.padrao === 'solicitante' ? 'solicitante' : ''} onChange={(e) => mudar({ padrao: e.target.value || undefined })}>
              <option value="solicitante">Quem pediu</option>
              <option value="">Sem padrão</option>
            </select>
          )}
        </CampoForm>
      ) : !perguntar || c.padrao ? (
        <CampoForm rotulo="Valor padrão" erro={mostrar('padrao')} ajuda="Usado quando a pessoa não informa.">
          {(p) => <input {...p} value={c.padrao ?? ''} onChange={(e) => mudar({ padrao: e.target.value || undefined })} />}
        </CampoForm>
      ) : null}

      <CampoForm rotulo="Dica para a equipe (opcional)" ajuda="Aparece só aqui no console.">
        {(p) => <input {...p} value={c.ajuda ?? ''} onChange={(e) => mudar({ ajuda: e.target.value })} />}
      </CampoForm>
    </Modal>
  );
}

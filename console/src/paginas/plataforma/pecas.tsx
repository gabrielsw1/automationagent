// Peças comuns das telas da Plataforma Starta: selo da situação da empresa, etapas da implantação,
// link para copiar com o aviso de como o e-mail saiu, e formatação de dinheiro e listas.
import { useState, type ReactNode } from 'react';
import { fmt, ROTULO_SITUACAO, type ConectorSistema, type EtapaImplantacao, type ModoAcesso, type SituacaoEmpresa } from '@copiloto/shared';
import { Botao } from '../../componentes/Botao.tsx';
import { Icone } from '../../componentes/icones.tsx';

const CLASSE_SITUACAO: Record<SituacaoEmpresa, string> = {
  ativo: 'badge-success',
  piloto: 'badge-info',
  implantacao: 'badge-outline',
  pausado: '',
};

/** "Ativo" e "Piloto" com o ponto (em uso); "Implantação" e "Pausado" sem. */
export function SeloSituacao({ situacao }: { situacao: SituacaoEmpresa }) {
  const emUso = situacao === 'ativo' || situacao === 'piloto';
  return (
    <span className={`badge ${CLASSE_SITUACAO[situacao]}`}>
      {emUso ? <span className="dot" /> : null}
      {ROTULO_SITUACAO[situacao]}
    </span>
  );
}

export function SeloDemo() {
  return (
    <span className="badge badge-accent cp-selo-demo" title="Empresa de demonstração, com dados de exemplo">
      Demonstração
    </span>
  );
}

const ROTULO_ACESSO: Record<ModoAcesso, string> = {
  sessao: 'Sessão de quem pede',
  conta: 'Conta de serviço',
  nenhum: 'Sem login',
};

/** "Acesso ao sistema" no painel: pela API não há login de pessoa; pelas telas, o modo de acesso. */
export function rotuloAcesso(e: { conector: ConectorSistema; acesso: ModoAcesso }): string {
  return e.conector === 'api' ? 'Pela API do sistema' : ROTULO_ACESSO[e.acesso];
}

/** "A", "A e B", "A, B e C". */
export function listaE(itens: string[]): string {
  return itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** "1 empresa", "3 empresas". */
export function plural(n: number, um: string, varios: string): string {
  return `${fmt.numero(n)} ${n === 1 ? um : varios}`;
}

/** R$ com centavos; null vira "—" (valor não definido, nunca um número inventado). */
export function reais(valor: number | null): string {
  return valor === null ? '—' : fmt.moeda(valor);
}

/** Linha de baixo de uma etapa: a data em que ficou pronta e o detalhe ("25/09 · widget assinado pelo sistema"). */
export function textoEtapa(e: EtapaImplantacao): string | null {
  const partes = [e.feita && e.quando ? fmt.diaMes(e.quando) : null, e.detalhe].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** As 5 etapas da implantação: feitas com o check, a primeira que falta em destaque. */
export function Etapas({ etapas }: { etapas: EtapaImplantacao[] }) {
  const atual = etapas.findIndex((e) => !e.feita);
  return (
    <ol className="steps cp-etapas">
      {etapas.map((e, i) => {
        const texto = textoEtapa(e);
        return (
          <li key={e.chave} className={`step${e.feita ? ' done' : i === atual ? ' active' : ''}`}>
            <span className="step-dot" aria-hidden="true">
              {e.feita ? <Icone nome="check" tamanho="sm" /> : i + 1}
            </span>
            <div className="stack-sm" style={{ gap: 0 }}>
              <span className="small strong">
                {e.titulo}
                <span className="sr-only">{e.feita ? ' (feita)' : ' (falta)'}</span>
              </span>
              {texto ? <span className="tiny muted">{texto}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** Link que aparece uma vez (convite, ativação): campo só de leitura e "Copiar". */
export function LinkParaCopiar({ link, rotulo }: { link: string; rotulo: string }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  return (
    <div className="field">
      <span className="label">{rotulo}</span>
      <div className="input-group">
        <input className="input mono" readOnly value={link} aria-label={rotulo} onFocus={(e) => e.currentTarget.select()} />
        <Botao
          variante="secundario"
          icone="copiar"
          onClick={async () => {
            setCopiado(await copiarTexto(link));
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Botao>
      </div>
      {copiado === false ? <span className="help">Não consegui copiar sozinho. Selecione o link e copie.</span> : null}
    </div>
  );
}

/** Como o e-mail saiu: pelo provedor (SMTP) ou guardado na caixa de saída local do servidor. */
export function AvisoEnvio({ envio, para, oQue }: { envio: 'smtp' | 'caixa_local'; para: string; oQue: string }) {
  return envio === 'smtp' ? (
    <p className="small cp-envio">
      <Icone nome="check" tamanho="sm" className="text-success" />
      <span>
        Enviamos {oQue} por e-mail para <span className="strong">{para}</span>.
      </span>
    </p>
  ) : (
    <div className="alert alert-warning" role="status">
      <Icone nome="alerta" />
      <p className="small">
        O servidor está sem envio de e-mail (SMTP): {oQue} ficou na caixa de saída local, sem chegar a <span className="strong">{para}</span>. Copie o
        link e envie você mesmo.
      </p>
    </div>
  );
}

/** Célula numérica que fica cinza quando é zero ou não existe. */
export function Numero({ valor, sufixo, formato }: { valor: number | null; sufixo?: ReactNode; formato?: (n: number) => string }) {
  if (valor === null) return <span className="muted">—</span>;
  return (
    <span className={valor === 0 ? 'muted' : undefined}>
      {(formato ?? fmt.numero)(valor)}
      {sufixo}
    </span>
  );
}

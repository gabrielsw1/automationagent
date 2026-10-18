// Plataforma › Empresas › painel da empresa: as faturas dela, em bloco compacto. Na cobrança manual
// (sem o Asaas), a equipe Starta marca como paga quando o pagamento chega (os créditos de um pacote
// entram nessa hora) ou cancela a cobrança. Tudo vai para a auditoria da empresa. Faturas pelo
// Asaas mudam sozinhas, pelo aviso de pagamento.
import { useState } from 'react';
import { fmt, nomeCompetencia, precoEmReais, resumoFatura, ROTULO_STATUS_FATURA, SOB_CONSULTA, type Fatura, type FaturasEmpresaStarta } from '@copiloto/shared';
import { useAcao } from '../../api/hooks.ts';
import { apiPlataforma, useApiPlataforma } from '../../api/plataforma.ts';
import { Botao } from '../../componentes/Botao.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { Confirmar } from '../../componentes/Modal.tsx';
import { useToast } from '../../componentes/Toast.tsx';

const SELO: Record<Fatura['status'], string> = {
  aberta: 'badge-outline',
  emitida: 'badge-info',
  paga: 'badge-success',
  vencida: 'badge-danger',
  cancelada: 'badge-outline',
};

function titulo(f: Fatura): string {
  return f.tipo === 'mensal' && f.competencia ? `Fatura de ${nomeCompetencia(f.competencia)}` : `${resumoFatura(f)} de ${fmt.diaMes(f.criadoEm)}`;
}

export function FaturasEmpresa({ empresaId }: { empresaId: string }) {
  const toast = useToast();
  const estado = useApiPlataforma<FaturasEmpresaStarta>(`/empresas/${encodeURIComponent(empresaId)}/faturas`);
  const [cancelar, setCancelar] = useState<Fatura | null>(null);
  const acao = useAcao((f: Fatura, qual: 'paga' | 'cancelar') =>
    apiPlataforma.post<FaturasEmpresaStarta>(`/empresas/${encodeURIComponent(empresaId)}/faturas/${encodeURIComponent(f.id)}/${qual}`),
  );
  const executar = async (f: Fatura, qual: 'paga' | 'cancelar') => {
    const r = await acao.executar(f, qual);
    if (!r) return;
    estado.definir(() => r);
    // "Fatura de ... marcada como paga", "Pacote de ... marcado como pago".
    const o = f.tipo === 'pacote' ? 'o' : 'a';
    toast.sucesso(qual === 'paga' ? `${titulo(f)} marcad${o} como pag${o}.` : `${titulo(f)} cancelad${o}.`);
  };
  const d = estado.dados;
  const lista = (d?.faturas ?? []).filter((f) => !f.exemplo).slice(0, 6);

  return (
    <section className="stack-sm" aria-labelledby="t-faturas">
      <h3 id="t-faturas" className="h4">
        Faturas
      </h3>
      {estado.erro ? (
        <p className="small text-danger">Não conseguimos carregar as faturas. {estado.erro.message}</p>
      ) : !d ? (
        <p className="small muted">Carregando as faturas…</p>
      ) : (
        <>
          {d.pendencias.map((p) => (
            <p key={p} className="tiny row-top cp-nota text-warning">
              <Icone nome="alerta" tamanho="sm" />
              <span>{p}</span>
            </p>
          ))}
          {lista.length ? (
            <ul className="card-flat cp-fluxos">
              {lista.map((f) => {
                const manual = f.gateway === 'manual' && (f.status === 'emitida' || f.status === 'vencida' || f.status === 'aberta');
                return (
                  <li key={f.id} className="stack-sm" style={{ gap: 'var(--s-1)' }}>
                    <div className="row-top between wrap" style={{ gap: 'var(--s-1) var(--s-2)' }}>
                      <div className="stack-sm" style={{ gap: 0, minWidth: 0, flex: '1 1 150px' }}>
                        <span className="small strong">{titulo(f)}</span>
                        <span className="tiny muted">
                          {precoEmReais(f.totalCentavos) ?? SOB_CONSULTA}
                          {f.vencimento && f.status !== 'paga' && f.status !== 'cancelada' ? ` · ${f.status === 'vencida' ? 'venceu' : 'vence'} em ${fmt.diaMes(`${f.vencimento}T12:00:00Z`)}` : ''}
                          {f.pagoEm ? ` · paga em ${fmt.diaMes(f.pagoEm)}` : ''}
                          {f.gateway === 'asaas' ? ' · Asaas' : ''}
                        </span>
                      </div>
                      <span className={`badge ${SELO[f.status]}`}>{ROTULO_STATUS_FATURA[f.status]}</span>
                    </div>
                    {manual ? (
                      <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
                        <Botao tamanho="sm" icone="check" disabled={acao.enviando} onClick={() => void executar(f, 'paga')}>
                          Marcar como paga
                        </Botao>
                        <Botao tamanho="sm" variante="fantasma" disabled={acao.enviando} onClick={() => setCancelar(f)}>
                          Cancelar
                        </Botao>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small muted">Nenhuma fatura ainda.</p>
          )}
          {acao.erro ? <p className="small text-danger">{acao.erro.message}</p> : null}
          <p className="tiny muted">
            {d.pagamentos.modo === 'asaas'
              ? 'Cobrança pelo Asaas: as faturas ficam pagas sozinhas quando o Asaas confirma.'
              : 'Cobrança manual: envie a cobrança por e-mail e marque como paga quando o pagamento chegar.'}
          </p>
        </>
      )}
      <Confirmar
        aberto={!!cancelar}
        titulo={cancelar ? `Cancelar ${titulo(cancelar).charAt(0).toLowerCase()}${titulo(cancelar).slice(1)}?` : ''}
        texto="A empresa deixa de dever esse valor. Fica registrado na auditoria da empresa."
        rotuloConfirmar="Cancelar fatura"
        rotuloCancelar="Voltar"
        carregando={acao.enviando}
        perigo
        aoConfirmar={async () => {
          if (cancelar) await executar(cancelar, 'cancelar');
          setCancelar(null);
        }}
        aoFechar={() => setCancelar(null)}
      />
    </section>
  );
}

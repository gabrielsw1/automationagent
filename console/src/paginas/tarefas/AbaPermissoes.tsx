// Aba "Permissões" (C3): confirmação travada, janela de desfazer, perfis que podem executar,
// quem aprova e, em teste, quem já pode usar.
import type { StatusTarefa } from '@copiloto/shared';
import { Campo as CampoForm } from '../../componentes/formulario.tsx';
import { Icone } from '../../componentes/icones.tsx';
import { useSessao } from '../../componentes/sessao.tsx';
import { useUsuariosDoSistema } from '../../componentes/ChatDeTeste.tsx';
import { minuscula, OPCOES_DESFAZER } from './ficha.ts';
import type { PropsAba } from './AbaFicha.tsx';

export default function AbaPermissoes({ def, mudar, podeEditar, perfisSistema, status }: PropsAba & { perfisSistema: string[]; status: StatusTarefa }) {
  const { resumo } = useSessao();
  const { usuarios, erro: erroUsuarios } = useUsuariosDoSistema();
  // Perfis gravados na ficha que não existem mais no sistema continuam visíveis para poder desmarcar.
  const perfis = [...perfisSistema, ...def.perfisPermitidos.filter((p) => !perfisSistema.includes(p))];
  const liberada = def.liberadaPara ?? [];
  const alternar = (lista: string[], item: string, marcar: boolean) => (marcar ? [...new Set([...lista, item])] : lista.filter((x) => x !== item));

  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="seguranca-titulo">
        <div className="card-head">
          <h2 className="h4" id="seguranca-titulo">
            Segurança
          </h2>
        </div>
        <div className="card-body stack-lg">
          <div className="stack-sm">
            <div className="row wrap between">
              <label className="switch ct-travado">
                <input type="checkbox" checked disabled aria-describedby="confirma-nota" />
                <span className="strong">Pedir confirmação antes de executar</span>
              </label>
              <span className="badge">
                <Icone nome="cadeado" tamanho="sm" />
                Travado
              </span>
            </div>
            <p className="help" id="confirma-nota">
              Obrigatório para tarefas que gravam dados. A pessoa vê um cartão com todos os campos e escolhe “Confirmar e executar” ou “Corrigir”.
            </p>
          </div>

          <CampoForm
            rotulo="Permitir desfazer por"
            classe="select"
            style={{ maxWidth: 320 }}
            ajuda={
              def.desfazerMinutos === 0
                ? 'O recibo não mostra “Desfazer”. Só um Admin desfaz pelo console.'
                : 'O recibo mostra “Desfazer” durante esse tempo. Depois, só um Admin desfaz pelo console.'
            }
          >
            {(p) => (
              <select
                {...p}
                value={def.desfazerMinutos}
                disabled={!podeEditar}
                onChange={(e) => mudar((d) => ({ ...d, desfazerMinutos: Number(e.target.value) as typeof d.desfazerMinutos }))}
              >
                {OPCOES_DESFAZER.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            )}
          </CampoForm>
          {def.desfazerMinutos > 0 && def.caminho === 'api' && !def.api?.desfazer ? (
            <p className="small text-danger" style={{ marginTop: 'calc(var(--s-4) * -1)' }}>
              Falta dizer qual chamada desfaz. Configure em Execução, “Mais opções da chamada”.
            </p>
          ) : null}

          <fieldset className="stack-sm ct-fieldset-limpo" disabled={!podeEditar}>
            <legend className="label">Quem pode executar</legend>
            {perfis.length === 0 ? (
              <p className="small muted">Não consegui ler os perfis do {resumo.nomeSistema}.</p>
            ) : (
              <div className="grid-auto ct-checks-grade">
                {perfis.map((p) => (
                  <label key={p} className="check">
                    <input
                      type="checkbox"
                      checked={def.perfisPermitidos.includes(p)}
                      onChange={(e) =>
                        mudar((d) => ({
                          ...d,
                          perfisPermitidos: alternar(d.perfisPermitidos, p, e.target.checked),
                        }))
                      }
                    />
                    {p}
                    {!perfisSistema.includes(p) ? <span className="tiny text-danger"> (não existe mais)</span> : null}
                  </label>
                ))}
              </div>
            )}
            <span className="help">
              Perfis do {resumo.nomeSistema}. Quem não estiver marcado pode pedir, e o copiloto oferece encaminhar a quem pode.
            </span>
            {def.perfisPermitidos.length === 0 ? <span className="small text-danger">Marque pelo menos um perfil.</span> : null}
          </fieldset>

          <CampoForm
            rotulo="Quem aprova os pedidos de quem não pode"
            classe="select"
            style={{ maxWidth: 420 }}
            ajuda="O copiloto manda o pedido para aprovação, com os dados já preenchidos. Sem aprovador, ele só explica que a pessoa não tem permissão."
          >
            {(p) => (
              <select
                {...p}
                value={def.perfilAprovador ?? ''}
                disabled={!podeEditar}
                onChange={(e) => mudar((d) => ({ ...d, perfilAprovador: e.target.value || undefined }))}
              >
                <option value="">Ninguém: só explica que não pode</option>
                {perfis.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            )}
          </CampoForm>

          <div className="alert">
            <Icone nome="info" />
            <div className="small">
              O copiloto sempre age com as permissões de quem pediu. Se a pessoa não puder {minuscula(def.nome || 'executar esta tarefa')} no {resumo.nomeSistema}, ele
              explica o motivo em vez de tentar.
            </div>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="liberada-titulo">
        <div className="card-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 className="h4" id="liberada-titulo">
              Liberada em teste para
            </h2>
            <span className="small muted">
              {status === 'teste'
                ? 'A tarefa está em teste: só as pessoas marcadas conseguem usar.'
                : 'Vale quando a tarefa está em teste. Sem ninguém marcado, todos os perfis permitidos usam.'}
            </span>
          </div>
          {liberada.length ? <span className="badge badge-warning">{liberada.length === 1 ? '1 pessoa' : `${liberada.length} pessoas`}</span> : null}
        </div>
        <div className="card-body">
          {erroUsuarios ? (
            <p className="small text-danger">Não consegui ler os usuários do {resumo.nomeSistema}: {erroUsuarios.message}</p>
          ) : !usuarios ? (
            <div className="stack-sm" aria-busy="true">
              <div className="skel" style={{ height: 14, width: '40%' }} />
              <div className="skel" style={{ height: 14, width: '55%' }} />
            </div>
          ) : (
            <fieldset className="ct-fieldset-limpo" disabled={!podeEditar}>
              <legend className="sr-only">Usuários liberados em teste</legend>
              <div className="grid-auto ct-checks-grade">
                {usuarios.map((u) => (
                  <label key={u.id} className="check" title={u.perfis.join(', ')}>
                    <input
                      type="checkbox"
                      checked={liberada.includes(u.id)}
                      onChange={(e) =>
                        mudar((d) => {
                          const l = alternar(d.liberadaPara ?? [], u.id, e.target.checked);
                          return { ...d, liberadaPara: l.length ? l : undefined };
                        })
                      }
                    />
                    <span>
                      {u.nome} <span className="tiny muted">· {u.perfis.join(', ')}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </section>
    </div>
  );
}

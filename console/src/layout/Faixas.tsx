// Faixas globais do topo: sem internet, modo simulado e limite de gasto perto do fim.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, type ResumoConsole } from '@copiloto/shared';
import { Icone } from '../componentes/icones.tsx';
import { guardado, useOnline } from '../componentes/pagina.tsx';

const CHAVE_LEMBRAR = 'copiloto:gasto:lembrar-em';

function hojeSp(): string {
  return fmt.data(new Date());
}

export function FaixaSemInternet() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="ca-faixa-offline" role="status">
      <Icone nome="sem-conexao" />
      <span className="small">Você está sem internet. Alterações não salvas ficam guardadas neste navegador.</span>
    </div>
  );
}

export function FaixasDoResumo({ resumo }: { resumo: ResumoConsole }) {
  const [lembrarEm, setLembrarEm] = useState(() => guardado.ler<string>(CHAVE_LEMBRAR));
  const gasto = resumo.alertaGasto;
  const mostrarGasto = gasto && lembrarEm !== hojeSp();
  if (!resumo.modoSimulado && !mostrarGasto) return null;
  return (
    <div className="ca-faixas">
      {resumo.modoSimulado ? (
        <div className="alert alert-warning" role="status">
          <Icone nome="info" />
          <p className="small">
            O copiloto está em modo simulado: defina <span className="mono">ANTHROPIC_API_KEY</span> no servidor para usar o Claude.
          </p>
        </div>
      ) : null}
      {mostrarGasto ? (
        <div className="alert alert-warning" role="status">
          <Icone nome="alerta" />
          <div className="stack-sm">
            <p className="strong">
              Você usou {Math.floor(gasto.percentual * 100)}% do limite de gasto deste mês
            </p>
            <p className="small">
              {fmt.moeda(gasto.usado)} de {fmt.moeda(gasto.limite)}. Ao chegar a 100%, as tarefas pelo navegador pausam e as por API continuam.
            </p>
            <div className="row wrap" style={{ gap: 'var(--s-3)' }}>
              <Link className="btn btn-secondary btn-sm" to="/equipe">
                Ajustar limite
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  // "Lembrar amanhã": some até o dia virar.
                  guardado.gravar(CHAVE_LEMBRAR, hojeSp());
                  setLembrarEm(hojeSp());
                }}
              >
                Lembrar amanhã
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

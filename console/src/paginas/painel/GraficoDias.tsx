// Gráfico de barras empilhadas "Execuções por dia" (SVG próprio, sem biblioteca).
// Concluídas em rosa (--brand-600) e falhas em vinho (--accent-500) por cima.
// Passar o mouse ou o foco do teclado sobre uma barra mostra o dia.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '@copiloto/shared';

export interface Dia {
  dia: string;
  concluidas: number;
  falhas: number;
}

const ALTURA = 180;
const MARGEM = { cima: 8, baixo: 24, esquerda: 32, direita: 4 };

/** Teto "redondo" para o eixo: 75 → 80, 230 → 250, 4 → 4. */
export function tetoEixo(max: number): number {
  if (max <= 4) return 4;
  const passo = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * passo >= max) return m * passo;
  }
  return 10 * passo;
}

function rotuloDia(dia: string): string {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

export function descricaoDia(d: Dia): string {
  const total = d.concluidas + d.falhas;
  if (total === 0) return `${rotuloDia(d.dia)}: nenhuma execução`;
  const exec = total === 1 ? '1 execução' : `${fmt.numero(total)} execuções`;
  if (d.falhas === 0) return `${rotuloDia(d.dia)}: ${exec}, ${total === 1 ? 'concluída' : 'todas concluídas'}`;
  return `${rotuloDia(d.dia)}: ${exec}, ${fmt.numero(d.concluidas)} ${d.concluidas === 1 ? 'concluída' : 'concluídas'}, ${fmt.numero(d.falhas)} com falha`;
}

export default function GraficoDias({ dias, legenda }: { dias: Dia[]; legenda: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(720);
  const [foco, setFoco] = useState<number | null>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(260, el.clientWidth));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = useMemo(() => tetoEixo(Math.max(0, ...dias.map((d) => d.concluidas + d.falhas))), [dias]);
  const areaL = largura - MARGEM.esquerda - MARGEM.direita;
  const areaA = ALTURA - MARGEM.cima - MARGEM.baixo;
  const passo = dias.length ? areaL / dias.length : areaL;
  const vao = Math.min(6, Math.max(1, passo * 0.2));
  const larguraBarra = Math.max(2, passo - vao);
  const y = (v: number) => MARGEM.cima + areaA - (v / max) * areaA;
  const marcas = [0, max / 4, max / 2, (3 * max) / 4, max].filter((v, i, l) => Number.isInteger(v) || i === 0 || i === l.length - 1);
  const cadaQuantos = dias.length <= 10 ? 1 : dias.length <= 20 ? 3 : 5;

  const ativo = foco !== null ? dias[foco] : null;
  const xAtivo = foco !== null ? MARGEM.esquerda + foco * passo + passo / 2 : 0;

  return (
    <div className="cp-grafico" ref={caixa}>
      <svg width={largura} height={ALTURA} role="img" aria-label={legenda} className="cp-grafico-svg">
        {marcas.map((v) => (
          <g key={v}>
            <line
              x1={MARGEM.esquerda}
              x2={largura - MARGEM.direita}
              y1={y(v)}
              y2={y(v)}
              className={v === 0 ? 'cp-eixo' : 'cp-grade'}
            />
            <text x={MARGEM.esquerda - 6} y={y(v)} dy="0.32em" textAnchor="end" className="cp-texto-eixo">
              {fmt.numero(Math.round(v))}
            </text>
          </g>
        ))}
        {dias.map((d, i) => {
          const x = MARGEM.esquerda + i * passo + vao / 2;
          const hOk = (d.concluidas / max) * areaA;
          const hFalha = (d.falhas / max) * areaA;
          const base = MARGEM.cima + areaA;
          const total = d.concluidas + d.falhas;
          return (
            <g
              key={d.dia}
              tabIndex={0}
              role="img"
              aria-label={descricaoDia(d)}
              className={`cp-dia${foco === i ? ' ativo' : ''}`}
              onMouseEnter={() => setFoco(i)}
              onMouseLeave={() => setFoco((f) => (f === i ? null : f))}
              onFocus={() => setFoco(i)}
              onBlur={() => setFoco((f) => (f === i ? null : f))}
            >
              <rect x={x - vao / 2} y={MARGEM.cima} width={passo} height={areaA} className="cp-alvo" />
              {d.concluidas > 0 ? (
                <rect x={x} y={base - hOk} width={larguraBarra} height={Math.max(1, hOk)} rx={d.falhas ? 0 : Math.min(3, larguraBarra / 2)} className="cp-barra-ok" />
              ) : null}
              {d.falhas > 0 ? (
                <rect
                  x={x}
                  y={base - hOk - hFalha - (d.concluidas ? 1 : 0)}
                  width={larguraBarra}
                  height={Math.max(2, hFalha)}
                  rx={Math.min(3, larguraBarra / 2)}
                  className="cp-barra-falha"
                />
              ) : null}
              {total === 0 ? <rect x={x} y={base - 1} width={larguraBarra} height={1} className="cp-barra-zero" /> : null}
              {i % cadaQuantos === 0 || i === dias.length - 1 ? (
                <text
                  x={i === dias.length - 1 && dias.length > 10 ? x + larguraBarra : x + larguraBarra / 2}
                  y={ALTURA - 6}
                  textAnchor={i === dias.length - 1 && dias.length > 10 ? 'end' : 'middle'}
                  className="cp-texto-eixo"
                >
                  {i === dias.length - 1 || i % cadaQuantos === 0 ? rotuloDia(d.dia) : ''}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {ativo ? (
        <div
          className="cp-dica"
          aria-hidden="true"
          style={{
            left: Math.min(Math.max(xAtivo, 90), largura - 90),
            top: Math.max(0, y(ativo.concluidas + ativo.falhas) - 8),
          }}
        >
          {descricaoDia(ativo)}
        </div>
      ) : null}
    </div>
  );
}

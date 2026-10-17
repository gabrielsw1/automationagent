// Ambiente das telas do console-b nos testes: sessão falsa, rotas, fetch e EventSource de mentira.
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { EmpresaResumo, Eu, PerfilEquipe, ResumoConsole } from '@copiloto/shared';
import { ProvedorSessao } from '../../src/componentes/sessao.tsx';

export interface Pedido {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

type Resposta = { status?: number; corpo?: unknown } | unknown;
type Rota = (p: Pedido) => Resposta | Promise<Resposta>;

/** Troca o fetch global por um roteador simples. A chave é "METODO /caminho" (sem /api/console e sem query). */
export function instalarFetch(rotas: Record<string, Rota | unknown>) {
  const pedidos: Pedido[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const caminho = String(url).replace(/^\/api\/console/, '');
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null);
    const pedido = { metodo, caminho, corpo };
    pedidos.push(pedido);
    const semQuery = caminho.split('?')[0];
    const chave = [`${metodo} ${caminho}`, `${metodo} ${semQuery}`].find((k) => k in rotas);
    if (!chave) return json(404, { erro: 'nao_encontrado', mensagem: `Sem rota de teste para ${metodo} ${caminho}` });
    const r = rotas[chave];
    const saida = (typeof r === 'function' ? await (r as Rota)(pedido) : r) as { status?: number; corpo?: unknown };
    if (saida && typeof saida === 'object' && 'status' in saida && typeof saida.status === 'number') {
      return json(saida.status, saida.corpo);
    }
    return json(200, saida);
  });
  vi.stubGlobal('fetch', fn);
  return { pedidos, fn };
}

function json(status: number, corpo: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(corpo ?? null), { status, headers: { 'content-type': 'application/json' } });
}

/** EventSource falso: guarda as instâncias para o teste mandar eventos. */
export class EventSourceFalso {
  static instancias: EventSourceFalso[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  fechado = false;
  constructor(readonly url: string) {
    EventSourceFalso.instancias.push(this);
  }
  close() {
    this.fechado = true;
  }
  static emitir(evento: object) {
    for (const f of EventSourceFalso.instancias) if (!f.fechado) f.onmessage?.({ data: JSON.stringify(evento) });
  }
}

export function instalarEventSource() {
  EventSourceFalso.instancias = [];
  vi.stubGlobal('EventSource', EventSourceFalso);
}

/** Empresa de demonstração aberta nos testes. */
export const HORIZONTE: EmpresaResumo = { id: 'emp-horizonte', nome: 'Horizonte', demo: true };

export function resumo(perfil: PerfilEquipe = 'admin', nome = 'Rafael Lima', id = 'mem-1', eu: Partial<Eu> = {}): ResumoConsole {
  return {
    eu: {
      id,
      nome,
      email: 'rafael.lima@seusistema.com.br',
      perfil,
      iniciais: 'RL',
      emailConfirmado: true,
      empresa: HORIZONTE,
      empresas: [HORIZONTE],
      adminPlataforma: false,
      ...eu,
    },
    execucoesAtencao: 0,
    aprovacoesPendentes: 0,
    guia: { feitos: 0, total: 6 },
    modoSimulado: false,
    semClaude: false,
    alertaGasto: null,
    nomeSistema: 'Horizonte',
  };
}

let localAtual = '';
function Espiao() {
  const l = useLocation();
  localAtual = l.pathname + l.search + l.hash;
  return null;
}
/** Caminho atual do roteador de teste. */
export const local = () => localAtual;

export function renderizar(
  elemento: ReactNode,
  { perfil = 'admin', caminho = '/', rota = '*', eu = {} }: { perfil?: PerfilEquipe; caminho?: string; rota?: string; eu?: Partial<Eu> } = {},
) {
  const sessao = { resumo: resumo(perfil, undefined, undefined, eu), recarregarResumo: vi.fn(async () => {}), sair: vi.fn(async () => {}) };
  const r = render(
    <ProvedorSessao valor={sessao}>
      <MemoryRouter initialEntries={[caminho]}>
        <Espiao />
        <Routes>
          <Route path={rota} element={elemento} />
          {rota === '*' ? null : <Route path="*" element={<div>outra página</div>} />}
        </Routes>
      </MemoryRouter>
    </ProvedorSessao>,
  );
  return { ...r, sessao };
}

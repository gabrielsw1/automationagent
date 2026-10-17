// Ambiente das telas do console-a nos testes: sessão falsa, roteador em memória, fetch e
// EventSource de mentira, e dados de exemplo (tarefa "Cadastrar cliente").
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { EmpresaResumo, Eu, PerfilEquipe, ResumoConsole, TarefaDefinicao, TarefaDetalhe } from '@copiloto/shared';
import { ProvedorSessao } from '../../src/componentes/sessao.tsx';
import { ProvedorToast } from '../../src/componentes/Toast.tsx';

export interface Pedido {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

type Rota = (p: Pedido) => unknown;

/** Resposta com status diferente de 200. */
export const status = (s: number, corpo: unknown) => ({ __status: s, corpo });

/** Troca o fetch global por um roteador. Chave: "METODO /caminho" (sem /api/console; com ou sem query). */
export function instalarFetch(rotas: Record<string, Rota | unknown>) {
  const pedidos: Pedido[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const caminho = String(url).replace(/^\/api\/console/, '');
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null);
    const pedido = { metodo, caminho, corpo };
    pedidos.push(pedido);
    const chave = [`${metodo} ${caminho}`, `${metodo} ${caminho.split('?')[0]}`].find((k) => k in rotas);
    if (!chave) return json(404, { erro: 'nao_encontrado', mensagem: `Sem rota de teste para ${metodo} ${caminho}` });
    const r = rotas[chave];
    const saida = typeof r === 'function' ? await (r as Rota)(pedido) : r;
    if (saida && typeof saida === 'object' && '__status' in saida) {
      const s = saida as { __status: number; corpo: unknown };
      return json(s.__status, s.corpo);
    }
    return json(200, saida);
  });
  vi.stubGlobal('fetch', fn);
  return { pedidos, fn };
}

function json(s: number, corpo: unknown): Response {
  if (s === 204) return new Response(null, { status: s });
  return new Response(JSON.stringify(corpo ?? null), { status: s, headers: { 'content-type': 'application/json' } });
}

class EventSourceFalso {
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close() {}
}
export function instalarEventSource() {
  vi.stubGlobal('EventSource', EventSourceFalso);
}

/** Empresa de demonstração aberta nos testes. */
export const HORIZONTE: EmpresaResumo = { id: 'emp-horizonte', nome: 'Horizonte', demo: true };

export function resumo(perfil: PerfilEquipe = 'admin', extra: Partial<ResumoConsole> = {}, eu: Partial<Eu> = {}): ResumoConsole {
  return {
    eu: {
      id: 'mem-1',
      nome: 'Rafael Lima',
      email: 'rafael.lima@seusistema.com.br',
      perfil,
      iniciais: 'RL',
      empresa: HORIZONTE,
      empresas: [HORIZONTE],
      adminPlataforma: false,
      ...eu,
    },
    execucoesAtencao: 3,
    aprovacoesPendentes: 1,
    guia: { feitos: 3, total: 5 },
    modoSimulado: false,
    alertaGasto: null,
    nomeSistema: 'Horizonte',
    ...extra,
  };
}

let localAtual = '';
function Espiao() {
  const l = useLocation();
  localAtual = l.pathname + l.search;
  return null;
}
/** Caminho atual do roteador de teste. */
export const local = () => localAtual;

export function renderizar(
  elemento: ReactNode,
  {
    perfil = 'admin',
    caminho = '/',
    rota = '*',
    extra = {},
    eu = {},
  }: { perfil?: PerfilEquipe; caminho?: string; rota?: string; extra?: Partial<ResumoConsole>; eu?: Partial<Eu> } = {},
) {
  const sessao = { resumo: resumo(perfil, extra, eu), recarregarResumo: vi.fn(async () => {}), sair: vi.fn(async () => {}) };
  const r = render(
    <ProvedorSessao valor={sessao}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[caminho]}>
          <Espiao />
          <Routes>
            <Route path={rota} element={elemento} />
            {rota === '*' ? null : <Route path="*" element={<div>outra página</div>} />}
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </ProvedorSessao>,
  );
  return { ...r, sessao };
}

export const USUARIOS = [
  { id: '101', nome: 'Ana Ribeiro', email: 'ana@horizonte.com.br', perfis: ['Comercial'] },
  { id: '102', nome: 'Bruno Costa', email: 'bruno@horizonte.com.br', perfis: ['Financeiro'] },
];

export function definicao(p: Partial<TarefaDefinicao> = {}): TarefaDefinicao {
  return {
    nome: 'Cadastrar cliente',
    descricao: 'Cria um cliente novo com CNPJ, cobrança e prazo.',
    quandoUsar: 'Use quando a pessoa quiser incluir uma empresa nova como cliente.',
    exemplos: ['novo cliente', 'abre cadastro pra Delta Transportes'],
    campos: [
      { chave: 'nome_empresa', rotulo: 'Nome da empresa', tipo: 'texto', obrigatorio: true, pergunta: 'Qual é o nome da empresa?', minimo: 3 },
      { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', obrigatorio: true, pergunta: 'Qual é o CNPJ da empresa?', verificarExistente: true },
      {
        chave: 'prazo_pagamento',
        rotulo: 'Prazo de pagamento',
        tipo: 'lista',
        obrigatorio: true,
        pergunta: 'Qual o prazo de pagamento?',
        opcoes: ['15 dias', '30 dias'],
      },
    ],
    caminho: 'api',
    api: {
      metodo: 'POST',
      caminho: '/v1/clientes',
      mapeamento: [
        { campo: 'nome_empresa', destino: 'razao_social' },
        { campo: 'cnpj', destino: 'cnpj', transformacao: 'somente_digitos' },
      ],
      idRetorno: 'id',
    },
    fluxoId: null,
    usarFluxoSeApiFalhar: false,
    confirmacao: true,
    desfazerMinutos: 5,
    perfisPermitidos: ['Comercial', 'Financeiro'],
    tituloRecibo: 'Cliente {nome_empresa} criado (#{id})',
    tituloConfirmacao: 'Confirme o cadastro',
    tituloProgresso: 'Cadastrando {nome_empresa}',
    proximosPassos: [],
    contextos: ['Clientes'],
    confiancaMinima: 0.8,
    ...p,
  };
}

export function detalhe(p: Partial<TarefaDetalhe> = {}): TarefaDetalhe {
  const pub = definicao();
  return {
    id: 'tar-1',
    slug: 'cadastrar-cliente',
    status: 'ativa',
    publicada: { versao: 4, definicao: pub, publicadoPor: 'Júlia Martins', publicadoEm: '2026-10-14T13:00:00.000Z' },
    rascunho: null,
    testes: [
      { id: 'c1', frase: 'cadastra o cliente ACME Logística, prazo 30 dias', esperado: { resultado: 'pergunta', campoPerguntado: 'cnpj' } },
      { id: 'c2', frase: 'inclui a Delta Transportes com prazo de 90 dias', esperado: { resultado: 'pergunta', campoPerguntado: 'prazo_pagamento' } },
    ],
    ultimaRodada: null,
    historico: [
      { versao: 4, status: 'publicada', publicadoPor: 'Júlia Martins', publicadoEm: '2026-10-14T13:00:00.000Z', resumoMudancas: 'Prazo de 45 dias.' },
      { versao: 3, status: 'arquivada', publicadoPor: 'Rafael Lima', publicadoEm: '2026-10-02T13:00:00.000Z', resumoMudancas: null },
    ],
    fluxo: null,
    perfisSistema: ['Comercial', 'Financeiro', 'Atendimento', 'Administradores'],
    ...p,
  };
}

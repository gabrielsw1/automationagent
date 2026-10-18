// Tipos das respostas do servidor e peças pequenas usadas nas etapas do Aprender fluxo (C4).
import { passoExecutavel, type Campo, type EtapaFluxo, type Fluxo, type PassoFluxo, type RegistroLido, type TipoPasso } from '@copiloto/shared';

/** POST /fluxos, GET /fluxos/:id/gravacao e POST /fluxos/:id/gravar. */
export interface RespostaGravacao {
  fluxo: Fluxo;
  token: string;
  urlGravacao: string;
}

export interface Destaque {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eventos do navegador devolvidos pelo teste (mesmo formato do servidor). */
export interface EventoTeste {
  tipo: 'login' | 'passo_inicio' | 'passo_ok' | 'passo_falhou' | 'recuperacao' | 'aviso';
  passo?: number;
  titulo: string;
  detalhe?: string;
  printId?: string;
  destaque?: Destaque;
  candidato?: { texto: string; confianca: number };
}

/** POST /fluxos/:id/testar */
export interface RespostaTeste {
  fluxo: Fluxo;
  resultado: {
    ok: boolean;
    mensagem: string;
    motivo?: string;
    passo?: number | null;
    duracaoMs: number;
    gerados: Record<string, string>;
    arquivos: { nome: string; tipo: string }[];
    recuperacoes: number;
    printId?: string;
    candidato?: { texto: string; confianca: number };
    /** Número do registro criado, lido da tela no fim do teste (null: não achou). */
    registro?: RegistroLido | null;
  };
  eventos: EventoTeste[];
}

/** "Chamado #1287", "CH-2026-0153": como o recibo mostra o número lido. */
export function registroPorExtenso(r: Pick<RegistroLido, 'nome' | 'numero'>): string {
  const numero = /^\d+$/.test(r.numero) ? `#${r.numero}` : r.numero;
  return r.nome ? `${r.nome} ${numero}` : numero;
}

/** GET /prints/:id/info */
export interface InfoPrint {
  id: string;
  legenda: string | null;
  destaque: Destaque | null;
  mascarado: boolean;
  criadoEm: string;
  apagarEm: string | null;
  largura: number | null;
  altura: number | null;
}

export const ETAPAS: { id: EtapaFluxo; rotulo: string }[] = [
  { id: 'gravar', rotulo: 'Gravar' },
  { id: 'revisar', rotulo: 'Revisar passos' },
  { id: 'mapear', rotulo: 'Mapear campos' },
  { id: 'testar', rotulo: 'Testar' },
  { id: 'publicar', rotulo: 'Publicar' },
];

export const ROTULO_TIPO: Record<TipoPasso, string> = {
  navegar: 'Abrir tela',
  clique: 'Clique',
  preencher: 'Preencher',
  selecionar: 'Selecionar',
  leitura: 'Leitura',
  download: 'Download',
  esperar: 'Esperar',
};

export function indiceEtapa(e: EtapaFluxo): number {
  return ETAPAS.findIndex((x) => x.id === e);
}

/** Passos que recebem um valor (preencher, selecionar). Passo em outro site não recebe: o copiloto não o faz. */
export function usaValor(p: PassoFluxo): boolean {
  return (p.tipo === 'preencher' || p.tipo === 'selecionar') && passoExecutavel(p);
}

/** Passos feitos em outro site que ainda esperam a escolha: remover ou manter como instrução. */
export function outrosSitesPendentes(f: Pick<Fluxo, 'passos'>): PassoFluxo[] {
  return f.passos.filter((p) => !!p.outroSite && !p.instrucao);
}

/** O seletor escolhido do passo (ou null quando o passo não usa seletor). */
export function seletorDo(p: PassoFluxo) {
  return p.seletores[p.seletorEscolhido] ?? p.seletores[0] ?? null;
}

export function ehFragil(p: PassoFluxo): boolean {
  return seletorDo(p)?.estabilidade === 'fragil';
}

/** Linha pequena acima do título do passo: "Passo 3 · Preencher · usa “documento”". */
export function resumoDoPasso(p: PassoFluxo, campos: Campo[]): string {
  const partes = [`Passo ${p.n}`, ROTULO_TIPO[p.tipo]];
  const v = p.valor;
  if (p.outroSite) partes.push(p.instrucao ? 'instrução' : 'outro site, falta escolher');
  else if (p.pendencia) partes.push('falta resolver');
  else if (v?.origem === 'campo') {
    const c = campos.find((x) => x.chave === v.campo);
    partes.push(`usa “${c?.rotulo ?? v.campo}”`);
  } else if (v?.origem === 'fixo') partes.push('valor fixo');
  else if (v?.origem === 'nao_preencher') partes.push('não preenche');
  else if (p.tipo === 'leitura' && p.gera) partes.push(`gera “${p.gera}”`);
  else if (p.tipo === 'download') partes.push('envia o arquivo');
  return partes.join(' · ');
}

/** Campos que o fluxo pode usar: os da tarefa ligada, ou os sugeridos pela gravação. */
export function camposDoFluxo(fluxo: Fluxo, camposTarefa: Campo[] | null): Campo[] {
  return camposTarefa && camposTarefa.length ? camposTarefa : fluxo.camposSugeridos;
}

/** Texto do status do fluxo para a lista. */
export function rotuloSituacao(f: Fluxo): { texto: string; classe: string } {
  if (f.status === 'publicado') return { texto: 'Publicado', classe: 'badge-success' };
  if (f.status === 'gravando') return { texto: 'Gravando', classe: 'badge-info' };
  const etapa = ETAPAS.find((e) => e.id === f.etapa)?.rotulo ?? 'Rascunho';
  return { texto: `Rascunho · ${etapa.toLowerCase()}`, classe: '' };
}

/**
 * Abre uma aba em branco já no clique (para o navegador não bloquear) e devolve uma função que
 * leva a aba ao endereço quando ele chegar do servidor. A aba não fica com acesso ao console.
 */
export function prepararAba(): { ir: (url: string) => boolean; fechar: () => void } {
  let aba: Window | null = null;
  try {
    aba = window.open('about:blank', '_blank');
    if (aba) aba.opener = null;
  } catch {
    aba = null;
  }
  return {
    ir: (url) => {
      if (!aba || aba.closed) return false;
      aba.location.href = url;
      return true;
    },
    fechar: () => {
      try {
        aba?.close();
      } catch {
        /* já fechada */
      }
    },
  };
}

/** Pontos animados de "gravando". */
export function PontoAoVivo({ rotulo }: { rotulo: string }) {
  return (
    <span className="ap-ao-vivo">
      <span className="ap-ao-vivo-ponto" aria-hidden="true" />
      {rotulo}
    </span>
  );
}

export function SeloEstabilidade({ estabilidade }: { estabilidade: 'estavel' | 'fragil' }) {
  return estabilidade === 'estavel' ? (
    <span className="badge badge-success">
      <span className="dot" />
      Estável
    </span>
  ) : (
    <span className="badge badge-warning">
      <span className="dot" />
      Frágil
    </span>
  );
}

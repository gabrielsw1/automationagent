// Selos de status e de caminho, iguais em todas as telas.
//
//   <SeloStatusTarefa status="teste" />          → "Em teste" (amarelo)
//   <SeloStatusExecucao status="falhou" />       → "Falhou" (vermelho)
//   <SeloCaminho caminho="navegador" />          → ícone de tela + "Navegador"
//   <SeloExemplo />                              → "Dados de exemplo"
import type { Caminho, StatusExecucao, StatusTarefa } from '@copiloto/shared';
import { Icone } from './icones.tsx';

export const ROTULO_STATUS_TAREFA: Record<StatusTarefa, string> = {
  ativa: 'Ativa',
  teste: 'Em teste',
  rascunho: 'Rascunho',
  inativa: 'Inativa',
};

const CLASSE_TAREFA: Record<StatusTarefa, string> = {
  ativa: 'badge-success',
  teste: 'badge-warning',
  rascunho: '',
  inativa: 'badge-outline',
};

export function SeloStatusTarefa({ status }: { status: StatusTarefa }) {
  return (
    <span className={`badge ${CLASSE_TAREFA[status]}`}>
      <span className="dot" />
      {ROTULO_STATUS_TAREFA[status]}
    </span>
  );
}

export const ROTULO_STATUS_EXECUCAO: Record<StatusExecucao, string> = {
  aguardando_confirmacao: 'Aguardando confirmação',
  aguardando_aprovacao: 'Aguardando aprovação',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  falhou: 'Falhou',
  desfeita: 'Desfeita',
  cancelada: 'Cancelada',
};

const CLASSE_EXECUCAO: Record<StatusExecucao, string> = {
  aguardando_confirmacao: 'badge-outline',
  aguardando_aprovacao: 'badge-warning',
  em_andamento: 'badge-info',
  concluida: 'badge-success',
  falhou: 'badge-danger',
  desfeita: '',
  cancelada: '',
};

export function SeloStatusExecucao({ status }: { status: StatusExecucao }) {
  return (
    <span className={`badge ${CLASSE_EXECUCAO[status]}`}>
      {status === 'em_andamento' ? <span className="spinner ca-spinner-selo" aria-hidden="true" /> : <span className="dot" />}
      {ROTULO_STATUS_EXECUCAO[status]}
    </span>
  );
}

export function SeloCaminho({ caminho }: { caminho: Caminho }) {
  return caminho === 'api' ? (
    <span className="badge badge-info">
      <Icone nome="api" tamanho="sm" />
      API
    </span>
  ) : (
    <span className="badge badge-accent">
      <Icone nome="navegador" tamanho="sm" />
      Navegador
    </span>
  );
}

export function SeloExemplo() {
  return (
    <span className="badge badge-accent" title="Números gerados para demonstração. Somem quando o copiloto começar a ser usado de verdade.">
      Dados de exemplo
    </span>
  );
}

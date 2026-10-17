// Textos e regras da ficha da tarefa usados por várias abas.
import { fmt, type Campo, type TarefaDefinicao, type TipoCampo, type Transformacao } from '@copiloto/shared';

export const ROTULO_TIPO: Record<TipoCampo, string> = {
  texto: 'Texto',
  documento: 'Documento',
  email: 'E-mail',
  telefone: 'Telefone',
  lista: 'Lista',
  data: 'Data',
  hora: 'Hora',
  numero: 'Número',
  moeda: 'Valor em R$',
  pessoa: 'Pessoa',
};

export const AJUDA_TIPO: Record<TipoCampo, string> = {
  texto: 'Qualquer texto. Dá para exigir um mínimo de letras.',
  documento: 'CPF ou CNPJ. O copiloto confere os dígitos verificadores.',
  email: 'Confere se o e-mail está completo.',
  telefone: 'Telefone com DDD.',
  lista: 'Só aceita uma das opções. O copiloto entende variações, como “30” para “30 dias”.',
  data: 'Aceita “amanhã”, “sexta”, “22/10” e converte para a data certa.',
  hora: 'Aceita “14h”, “14:30”, “duas da tarde”.',
  numero: 'Número inteiro ou com vírgula. Dá para limitar o mínimo e o máximo.',
  moeda: 'Valor em reais, como “R$ 1.200,50”.',
  pessoa: 'Um usuário do sistema. Pode vir preenchido com quem pediu.',
};

export const ROTULO_TRANSFORMACAO: Record<Transformacao, string> = {
  nenhuma: 'Como foi digitado',
  somente_digitos: 'Só números',
  numero: 'Número',
  id_usuario: 'ID do usuário',
  data_iso: 'Data (AAAA-MM-DD)',
};

/** "Valida os dígitos verificadores e se já existe cadastro", "Mínimo de 3 letras"... */
export function descricaoValidacao(c: Campo): string {
  switch (c.tipo) {
    case 'texto':
      return c.minimo ? `Mínimo de ${c.minimo} ${c.minimo === 1 ? 'letra' : 'letras'}` : 'Sem regra';
    case 'documento':
      return `Valida os dígitos verificadores${c.verificarExistente ? ' e se já existe cadastro' : ''}`;
    case 'email':
      return 'Formato de e-mail';
    case 'telefone':
      return 'Telefone com DDD';
    case 'lista':
      return (c.opcoes ?? []).join(', ') || 'Sem opções: informe quais valores aceitar';
    case 'data':
      return 'Data válida';
    case 'hora':
      return 'Horário válido';
    case 'numero':
    case 'moeda': {
      const f = (n: number) => (c.tipo === 'moeda' ? `R$ ${n.toLocaleString('pt-BR')}` : n.toLocaleString('pt-BR'));
      if (c.minimo !== undefined && c.maximo !== undefined) return `Entre ${f(c.minimo)} e ${f(c.maximo)}`;
      if (c.minimo !== undefined) return `Mínimo de ${f(c.minimo)}`;
      if (c.maximo !== undefined) return `Máximo de ${f(c.maximo)}`;
      return c.tipo === 'moeda' ? 'Valor em reais' : 'Número';
    }
    case 'pessoa':
      return c.padrao === 'solicitante' ? 'Padrão: quem pediu' : 'Usuário do sistema';
  }
}

/** "Nome da empresa" → "nome_empresa"; "E-mail de cobrança" → "email_cobranca". */
export function chaveDoRotulo(rotulo: string): string {
  const c = rotulo
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/([a-z0-9])-([a-z0-9])/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !['de', 'da', 'do', 'dos', 'das', 'e'].includes(p))
    .join('_')
    .slice(0, 40)
    .replace(/_+$/, '');
  return /^[a-z]/.test(c) ? c : c ? `campo_${c}` : '';
}

export const CHAVE_VALIDA = /^[a-z][a-z0-9_]*$/;

export function iguais(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Troca a chave de um campo e atualiza o mapeamento da API que usava a chave antiga. */
export function renomearChave(def: TarefaDefinicao, antiga: string, nova: string): TarefaDefinicao {
  if (antiga === nova || !def.api) return def;
  return {
    ...def,
    api: { ...def.api, mapeamento: def.api.mapeamento.map((m) => (m.campo === antiga ? { ...m, campo: nova } : m)) },
  };
}

/** Número da próxima versão que "Publicar" vai criar. */
export function proximaVersao(rascunho: { versao: number } | null, publicada: { versao: number } | null): number {
  return rascunho?.versao ?? (publicada ? publicada.versao + 1 : 1);
}

/** Primeira letra minúscula ("Cadastrar cliente" → "cadastrar cliente"), sem mexer em siglas. */
export function minuscula(s: string): string {
  return s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** "hoje às 09:12", "ontem às 16:40" ou "em 14/10/2026 às 10:05". */
export function quandoAs(iso: string, agora = new Date()): string {
  const dia = fmt.data(iso);
  const h = fmt.hora(iso);
  if (dia === fmt.data(agora)) return `hoje às ${h}`;
  if (dia === fmt.data(new Date(agora.getTime() - 86400000))) return `ontem às ${h}`;
  return `em ${dia} às ${h}`;
}

/** Valores da janela de desfazer, na ordem do seletor. */
export const OPCOES_DESFAZER: { valor: TarefaDefinicao['desfazerMinutos']; rotulo: string }[] = [
  { valor: 0, rotulo: 'Não permitir' },
  { valor: 2, rotulo: '2 minutos' },
  { valor: 5, rotulo: '5 minutos' },
  { valor: 15, rotulo: '15 minutos' },
];

// Pessoas que usam o Horizonte e o que cada perfil pode fazer.
import { listaOu } from '../util/texto.ts';
import { PERFIS, type Perfil, type Usuario } from './tipos.ts';

export const USUARIOS: Usuario[] = [
  { id: '101', nome: 'Ana Ribeiro', email: 'ana.ribeiro@horizonte.com.br', perfis: ['Atendimento', 'Comercial'] },
  { id: '102', nome: 'Marcos Teixeira', email: 'marcos.teixeira@horizonte.com.br', perfis: ['Financeiro'] },
  { id: '103', nome: 'Paula Nunes', email: 'paula.nunes@horizonte.com.br', perfis: ['Comercial'] },
  { id: '104', nome: 'Diego Alves', email: 'diego.alves@horizonte.com.br', perfis: ['Técnico', 'Atendimento'] },
  { id: '105', nome: 'Rafael Lima', email: 'rafael.lima@horizonte.com.br', perfis: ['Administradores', 'Gestor financeiro'] },
  { id: '106', nome: 'Júlia Martins', email: 'julia.martins@horizonte.com.br', perfis: ['Administradores'] },
  { id: '107', nome: 'Camila Souza', email: 'camila.souza@horizonte.com.br', perfis: ['Atendimento'] },
];

export type Area = 'clientes' | 'planos' | 'relatorios' | 'boletos' | 'agenda' | 'chamados';

export interface RegraPermissao {
  perfis: Perfil[];
  /** Perfil citado no erro 403 (o mais comum para a tarefa). */
  necessario: Perfil;
  /** Complemento de "Seu perfil não permite ...". */
  acao: string;
}

export const PERMISSOES: Record<Area, RegraPermissao> = {
  clientes: {
    perfis: ['Comercial', 'Atendimento', 'Administradores'],
    necessario: 'Comercial',
    acao: 'cadastrar ou alterar clientes',
  },
  planos: {
    perfis: ['Gestor financeiro', 'Administradores'],
    necessario: 'Gestor financeiro',
    acao: 'alterar o plano de clientes',
  },
  relatorios: {
    perfis: ['Comercial', 'Financeiro', 'Gestor financeiro', 'Administradores'],
    necessario: 'Comercial',
    acao: 'emitir relatórios de vendas',
  },
  boletos: {
    perfis: ['Financeiro', 'Gestor financeiro', 'Atendimento', 'Administradores'],
    necessario: 'Financeiro',
    acao: 'emitir segunda via de boletos',
  },
  agenda: {
    perfis: ['Atendimento', 'Comercial', 'Técnico', 'Administradores'],
    necessario: 'Atendimento',
    acao: 'agendar visitas técnicas',
  },
  chamados: {
    perfis: [...PERFIS],
    necessario: 'Atendimento',
    acao: 'abrir chamados de suporte',
  },
};

export function pode(usuario: Usuario, area: Area): boolean {
  return usuario.perfis.some((p) => PERMISSOES[area].perfis.includes(p));
}

export function mensagemSemPermissao(area: Area): string {
  const regra = PERMISSOES[area];
  return `Seu perfil não permite ${regra.acao}. É preciso ter o perfil ${listaOu(regra.perfis)}.`;
}

export function usuarioPorId(id: string | undefined | null): Usuario | undefined {
  if (!id) return undefined;
  return USUARIOS.find((u) => u.id === String(id).trim());
}

export function nomeUsuario(id: string): string {
  return usuarioPorId(id)?.nome ?? `Usuário ${id}`;
}

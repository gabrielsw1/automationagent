// Textos dos e-mails. O assunto do código é o que a tela de confirmação cita ("Seu código do
// Copiloto Starta"), para a pessoa achar na caixa de entrada.
import {
  fmt,
  nomeCompetencia,
  precoEmReais,
  ROTULO_FAIXA_USUARIOS,
  ROTULO_PERFIL,
  type ContatoRecebido,
  type DadosCobranca,
  type Fatura,
  type PerfilEquipe,
} from '@copiloto/shared';
import type { EmailSaindo } from './index.ts';

const ASSINATURA = 'Equipe Copiloto Starta';

export function emailCodigo(para: string, nome: string, codigo: string): EmailSaindo {
  return {
    para,
    assunto: 'Seu código do Copiloto Starta',
    texto: [
      `Olá, ${fmt.primeiroNome(nome)}.`,
      `Seu código para confirmar o e-mail é ${codigo}. Ele vale por 10 minutos.`,
      'Se não foi você que criou uma conta no Copiloto Starta, ignore este e-mail.',
      ASSINATURA,
    ].join('\n\n'),
  };
}

export function emailSenhaNova(para: string, nome: string | null, link: string): EmailSaindo {
  return {
    para,
    assunto: 'Crie uma senha nova no Copiloto Starta',
    texto: [
      nome ? `Olá, ${fmt.primeiroNome(nome)}.` : 'Olá.',
      'Recebemos um pedido para criar uma senha nova para esta conta. Use o link abaixo. Ele vale por 1 hora e funciona uma vez só.',
      link,
      'Se você não pediu, ignore este e-mail: a sua senha continua a mesma.',
      ASSINATURA,
    ].join('\n\n'),
  };
}

export function emailConvite(d: {
  para: string;
  empresa: string;
  convidadoPor: string;
  perfil: PerfilEquipe;
  link: string;
  validoAte: string;
}): EmailSaindo {
  return {
    para: d.para,
    assunto: `${d.convidadoPor} convidou você para o Copiloto da ${d.empresa}`,
    texto: [
      'Olá.',
      `${d.convidadoPor} convidou você para a equipe da ${d.empresa} no Copiloto Starta, como ${ROTULO_PERFIL[d.perfil]}.`,
      `Para aceitar, abra o link abaixo. O convite vale até ${fmt.data(d.validoAte)}.`,
      d.link,
      ASSINATURA,
    ].join('\n\n'),
  };
}

/** Convite para a equipe Starta (ou "Redefinir acesso"): criar senha e ligar o autenticador. */
export function emailAtivacaoStarta(d: { para: string; nome: string; link: string; validoAte: string; convidadoPor: string | null; redefinicao: boolean }): EmailSaindo {
  return {
    para: d.para,
    assunto: d.redefinicao ? 'Redefina o seu acesso à Plataforma Starta' : 'Ative o seu acesso à Plataforma Starta',
    texto: [
      `Olá, ${fmt.primeiroNome(d.nome)}.`,
      d.redefinicao
        ? `${d.convidadoPor ?? 'Um Admin da plataforma'} redefiniu o seu acesso à Plataforma Starta. A senha e o autenticador antigos não valem mais.`
        : `${d.convidadoPor ? `${d.convidadoPor} convidou você` : 'Você foi convidado'} para a equipe da Plataforma Starta, o painel interno que cuida das empresas clientes do Copiloto.`,
      `Abra o link abaixo para criar a sua senha e ligar a verificação em duas etapas no aplicativo autenticador do celular. O link vale até ${fmt.data(d.validoAte)} e funciona uma vez só.`,
      d.link,
      ASSINATURA,
    ].join('\n\n'),
  };
}

/** Aviso aos Admins da empresa: alguém da Starta entrou como suporte. */
export function emailSuporte(d: { para: string; empresa: string; pessoa: string; motivo: string; inicio: string; ate: string }): EmailSaindo {
  return {
    para: d.para,
    assunto: `A equipe Starta entrou no Copiloto da ${d.empresa} como suporte`,
    texto: [
      'Olá.',
      `${d.pessoa}, da equipe Starta, entrou no console do Copiloto da ${d.empresa} como suporte em ${fmt.dataHora(d.inicio)}, com acesso até ${fmt.hora(d.ate)}.`,
      `Motivo informado: ${d.motivo}`,
      'O acesso fica registrado em Equipe e limites › Auditoria, com tudo o que for feito nele. Se você não esperava este acesso, responda a este e-mail.',
      ASSINATURA,
    ].join('\n\n'),
  };
}

/** "Sugerir regravação à empresa": o fluxo precisou de muito conserto visual. */
export function emailRegravar(d: { para: string; empresa: string; tarefa: string; consertos: number; link: string }): EmailSaindo {
  return {
    para: d.para,
    assunto: `Sugestão da Starta: regravar o fluxo “${d.tarefa}”`,
    texto: [
      'Olá.',
      `Nos últimos 30 dias, a tarefa “${d.tarefa}” da ${d.empresa} precisou do agente visual ${d.consertos} vezes, porque a tela do sistema mudou desde a gravação. Cada execução com conserto gasta até 5 créditos.`,
      'Regravar o fluxo com a extensão leva poucos minutos e faz cada execução voltar a gastar 1 crédito. Abra a tarefa no console:',
      d.link,
      ASSINATURA,
    ].join('\n\n'),
  };
}

const ASSUNTO_CONTATO: Record<ContatoRecebido['origem'], string> = {
  demonstracao: 'Pedido de demonstração',
  vendas: 'Contato com vendas',
  piloto: 'Pedido de piloto',
  mudanca_plano: 'Pedido de mudança de plano',
};

/** Pedido do site para a equipe de vendas (EMAIL_VENDAS). "Responder" vai direto para quem pediu. */
export function emailContatoVendas(para: string, c: ContatoRecebido): EmailSaindo {
  return {
    para,
    responderPara: c.email,
    assunto: `${ASSUNTO_CONTATO[c.origem]}: ${c.empresa}`,
    texto: [
      `${ASSUNTO_CONTATO[c.origem]} pelo site do Copiloto Starta, recebido em ${fmt.dataHora(c.criadoEm)}.`,
      [
        `Nome: ${c.nome}`,
        `E-mail: ${c.email}`,
        `Empresa: ${c.empresa}`,
        `Telefone: ${c.telefone ?? 'não informado'}`,
        `Usuários do sistema: ${c.faixa ? ROTULO_FAIXA_USUARIOS[c.faixa] : 'não informado'}`,
      ].join('\n'),
      c.mensagem ? `Mensagem:\n${c.mensagem}` : 'Sem mensagem.',
      'Responda este e-mail para falar direto com quem pediu.',
    ].join('\n\n'),
  };
}

/** "Mudar de plano" em Plano e créditos, para a equipe de vendas (EMAIL_VENDAS). */
export function emailMudancaPlano(d: {
  para: string;
  empresa: string;
  cnpj: string | null;
  pessoa: string;
  email: string;
  planoAtual: string | null;
  planoPedido: string;
  mensagem: string | null;
  em: string;
  linkPlataforma: string;
}): EmailSaindo {
  return {
    para: d.para,
    responderPara: d.email,
    assunto: `Pedido de mudança de plano: ${d.empresa}`,
    texto: [
      `${d.pessoa} (${d.email}), Admin da ${d.empresa}, pediu para mudar de plano em ${fmt.dataHora(d.em)}.`,
      [`Empresa: ${d.empresa}${d.cnpj ? ` (CNPJ ${d.cnpj})` : ''}`, `Plano atual: ${d.planoAtual ?? 'sem plano'}`, `Plano pedido: ${d.planoPedido}`].join('\n'),
      d.mensagem ? `Mensagem:\n${d.mensagem}` : 'Sem mensagem.',
      `Nada muda até a Starta confirmar com a empresa e trocar o plano na Plataforma: ${d.linkPlataforma}`,
      'Responda este e-mail para falar direto com quem pediu.',
    ].join('\n\n'),
  };
}

/** Cobrança manual (sem ASAAS_API_KEY): a equipe Starta recebe a fatura para cobrar a empresa. */
export function emailFaturaManual(d: { para: string; empresa: string; cobranca: DadosCobranca; fatura: Fatura; linkPlataforma: string }): EmailSaindo {
  const f = d.fatura;
  const qual = f.tipo === 'mensal' && f.competencia ? `Fatura de ${nomeCompetencia(f.competencia)}` : `Pacote de ${fmt.numero(f.creditos ?? 0)} créditos`;
  const c = d.cobranca;
  return {
    para: d.para,
    assunto: `Cobrar: ${qual} da ${d.empresa}`,
    texto: [
      `${qual} da ${d.empresa}: ${precoEmReais(f.totalCentavos) ?? 'valor não definido'}, vencimento em ${f.vencimento ? fmt.data(`${f.vencimento}T12:00:00Z`) : 'a combinar'}.`,
      f.itens.map((i) => `- ${i.descricao}${i.quantidade > 1 ? ` (${fmt.numero(i.quantidade)})` : ''}: ${precoEmReais(i.totalCentavos) ?? 'sem valor'}`).join('\n'),
      [
        `Razão social: ${c.razaoSocial ?? 'não informada'}`,
        `CNPJ: ${c.cnpj ?? 'não informado'}`,
        `E-mail de cobrança: ${c.emailCobranca ?? 'não informado'}`,
        `Forma escolhida: ${c.metodo === 'cartao' ? 'cartão de crédito' : 'boleto'}`,
      ].join('\n'),
      `A cobrança pelo Asaas não está ligada (ASAAS_API_KEY), então a Starta cobra a empresa. Quando o pagamento chegar, marque a fatura como paga na Plataforma${f.tipo === 'pacote' ? ' (os créditos do pacote entram nessa hora)' : ''}: ${d.linkPlataforma}`,
      ASSINATURA,
    ].join('\n\n'),
  };
}

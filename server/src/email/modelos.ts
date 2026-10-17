// Textos dos e-mails. O assunto do código é o que a tela de confirmação cita ("Seu código do
// Copiloto Starta"), para a pessoa achar na caixa de entrada.
import { fmt, ROTULO_FAIXA_USUARIOS, ROTULO_PERFIL, type ContatoRecebido, type PerfilEquipe } from '@copiloto/shared';
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
        `Usuários do sistema: ${ROTULO_FAIXA_USUARIOS[c.faixa]}`,
      ].join('\n'),
      c.mensagem ? `Mensagem:\n${c.mensagem}` : 'Sem mensagem.',
      'Responda este e-mail para falar direto com quem pediu.',
    ].join('\n\n'),
  };
}

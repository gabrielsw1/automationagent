// Textos dos e-mails. O assunto do código é o que a tela de confirmação cita ("Seu código do
// Copiloto Starta"), para a pessoa achar na caixa de entrada.
import { fmt, ROTULO_PERFIL, type PerfilEquipe } from '@copiloto/shared';
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

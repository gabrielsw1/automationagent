// E-mails do produto: código de confirmação do cadastro, link de senha nova, convite da equipe e
// pedidos de contato do site para a equipe de vendas.
//
// - Com SMTP_URL (ex.: smtps://usuario:senha@smtp.seuprovedor.com:465), envia pelo provedor de
//   verdade, com o remetente de EMAIL_REMETENTE.
// - Sem SMTP_URL, nada sai do servidor: cada e-mail vira um arquivo em DATA_DIR/caixa-de-saida e
//   uma linha no log, e o console diz que o envio não está configurado. Serve para rodar no
//   computador; em produção, configure o SMTP.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.ts';

export interface EmailSaindo {
  para: string;
  assunto: string;
  /** Texto puro (o HTML é montado a partir dele). */
  texto: string;
  /** Endereço do "Responder" (ex.: quem pediu a demonstração). */
  responderPara?: string;
}

export interface Correio {
  /** smtp: sai pelo provedor; caixa_local: fica em DATA_DIR/caixa-de-saida (envio não configurado). */
  readonly modo: 'smtp' | 'caixa_local';
  enviar(email: EmailSaindo): Promise<void>;
}

function escapar(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Parágrafos e links clicáveis, na fonte e na cor da Starta. */
export function htmlDe(texto: string): string {
  const paragrafos = texto
    .split(/\n{2,}/)
    .map((p) => escapar(p).replace(/https?:\/\/\S+/g, (u) => `<a href="${u}" style="color:#CD1F57">${u}</a>`).replace(/\n/g, '<br>'))
    .map((p) => `<p style="margin:0 0 16px">${p}</p>`)
    .join('');
  return `<div style="font-family:'Open Sans',Arial,sans-serif;font-size:16px;line-height:1.5;color:#2C2D2D;max-width:560px">${paragrafos}</div>`;
}

export class CorreioSmtp implements Correio {
  readonly modo = 'smtp';
  private readonly transporte: Transporter;

  constructor(
    url: string,
    private readonly remetente: string,
  ) {
    this.transporte = nodemailer.createTransport(url);
  }

  async enviar(e: EmailSaindo): Promise<void> {
    await this.transporte.sendMail({
      from: this.remetente,
      to: e.para,
      replyTo: e.responderPara,
      subject: e.assunto,
      text: e.texto,
      html: htmlDe(e.texto),
    });
  }
}

/** Sem provedor: guarda cada e-mail num arquivo e na memória (os testes leem `enviados`). */
export class CaixaLocal implements Correio {
  readonly modo = 'caixa_local';
  readonly enviados: EmailSaindo[] = [];

  constructor(private readonly pasta: string | null) {}

  async enviar(e: EmailSaindo): Promise<void> {
    this.enviados.push(e);
    if (!this.pasta) return;
    fs.mkdirSync(this.pasta, { recursive: true });
    const nome = `${new Date().toISOString().replace(/[:.]/g, '-')}-${e.para.replace(/[^\w.@-]/g, '_')}.txt`;
    const arquivo = path.join(this.pasta, nome);
    const responder = e.responderPara ? `Responder para: ${e.responderPara}\n` : '';
    fs.writeFileSync(arquivo, `Para: ${e.para}\n${responder}Assunto: ${e.assunto}\n\n${e.texto}\n`, 'utf8');
    console.log(`E-mail não enviado (SMTP_URL não configurado). Ficou em ${arquivo}`);
  }
}

export function criarCorreio(config: Config): Correio {
  if (config.smtpUrl) return new CorreioSmtp(config.smtpUrl, config.emailRemetente);
  return new CaixaLocal(path.join(config.dirDados, 'caixa-de-saida'));
}

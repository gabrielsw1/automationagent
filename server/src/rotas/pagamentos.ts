// Avisos do gateway de pagamento (sem sessão). O Asaas chama POST /api/pagamentos/asaas a cada
// mudança de uma cobrança, com o token configurado no webhook (ASAAS_WEBHOOK_TOKEN) no cabeçalho
// asaas-access-token. Sem 200, o Asaas reenvia; cada evento é tratado uma vez só (cobranca/faturas.ts).
import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { AvisoAsaas } from '../cobranca/faturas.ts';
import { ErroHttp } from '../util/erros.ts';

function mesmoToken(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  app.post('/asaas', async (request): Promise<{ ok: true; resultado: string }> => {
    const esperado = plataforma.config.asaas.tokenWebhook;
    if (!esperado || !plataforma.config.asaas.chave) {
      throw new ErroHttp(503, 'asaas_desligado', 'A cobrança pelo Asaas não está ligada neste servidor (ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN).');
    }
    const recebido = request.headers['asaas-access-token'];
    if (typeof recebido !== 'string' || !mesmoToken(recebido, esperado)) {
      throw new ErroHttp(401, 'token_invalido', 'Token do webhook inválido.');
    }
    const corpo = request.body as AvisoAsaas | undefined;
    if (!corpo || typeof corpo.event !== 'string') throw new ErroHttp(400, 'pedido_invalido', 'Aviso sem o campo event.');
    const resultado = await plataforma.faturas.webhook(corpo);
    request.log.info({ evento: corpo.event, id: corpo.id, resultado }, 'Aviso do Asaas');
    return { ok: true, resultado };
  });
};

export default rotas;

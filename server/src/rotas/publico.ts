// Rotas públicas (/api/publico), sem sessão: o site do produto lê os planos e os textos jurídicos e
// manda os pedidos de "Agendar demonstração" e "Falar com vendas". Cada pedido fica no banco da
// plataforma e, com EMAIL_VENDAS, vai também por e-mail para a equipe de vendas.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DOCUMENTOS_LEGAIS,
  ROTULO_FAIXA_USUARIOS,
  somenteDigitos,
  type DocumentoLegal,
  type FaixaUsuarios,
  type PlanosPublicos,
  type TextoLegal,
} from '@copiloto/shared';
import { emailContatoVendas } from '../email/modelos.ts';
import { valoresDeExemplo } from '../plataforma/planos.ts';
import { lerTextoLegal } from '../plataforma/textos.ts';
import { ErroHttp, naoEncontrado, pedidoInvalido } from '../util/erros.ts';

/** Pedidos de contato por IP numa hora. Fica na memória: zera quando o servidor reinicia. */
export const LIMITE_CONTATOS_POR_HORA = 5;
const HORA = 60 * 60_000;

/** Texto de uma linha só (vai no assunto do e-mail). */
const Linha = (vazio: string, max: number) =>
  z
    .string({ error: vazio })
    .trim()
    .min(2, vazio)
    .max(max, `Use até ${max} caracteres.`)
    .refine((t) => !/[\r\n\t]/.test(t), 'Use uma linha só.');

const PedidoContato = z.object({
  nome: Linha('Diga seu nome.', 120),
  email: z
    .string({ error: 'Digite o seu e-mail de trabalho.' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Digite um e-mail completo, por exemplo nome@suaempresa.com.br')),
  empresa: Linha('Diga o nome da empresa.', 120),
  telefone: z
    .string()
    .trim()
    .max(40)
    .refine(
      (t) => !t || (somenteDigitos(t).length >= 10 && somenteDigitos(t).length <= 13),
      'Digite o telefone com DDD, por exemplo (51) 99999-0000.',
    )
    .optional(),
  faixa: z.enum(Object.keys(ROTULO_FAIXA_USUARIOS) as [FaixaUsuarios, ...FaixaUsuarios[]], {
    error: 'Escolha quantos usuários o seu sistema tem.',
  }),
  mensagem: z.string().trim().max(2000, 'A mensagem pode ter até 2.000 caracteres.').optional(),
  origem: z.enum(['demonstracao', 'vendas', 'piloto']),
});

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;
  const pedidosPorIp = new Map<string, number[]>();

  /** Pedidos deste IP na última hora (e esquece os mais antigos). */
  function recentes(ip: string): number[] {
    const agora = Date.now();
    const lista = (pedidosPorIp.get(ip) ?? []).filter((t) => agora - t < HORA);
    if (lista.length) pedidosPorIp.set(ip, lista);
    else pedidosPorIp.delete(ip);
    return lista;
  }

  app.get('/planos', async (): Promise<PlanosPublicos> => {
    const planos = plataforma.planos();
    return { planos, valoresDeExemplo: valoresDeExemplo(planos), cadastroAberto: plataforma.config.cadastroAberto };
  });

  app.post('/contato', async (request): Promise<{ ok: true }> => {
    const ip = request.ip;
    const anteriores = recentes(ip);
    if (anteriores.length >= LIMITE_CONTATOS_POR_HORA) {
      const aguardarS = Math.ceil((anteriores[0] + HORA - Date.now()) / 1000);
      throw new ErroHttp(
        429,
        'muitos_pedidos',
        `Recebemos muitos pedidos deste endereço na última hora. Tente de novo em ${Math.ceil(aguardarS / 60)} min.`,
        { aguardarS },
      );
    }
    const r = PedidoContato.safeParse(request.body ?? {});
    if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
    const contato = plataforma.registrarContato({ ...r.data, ip });
    pedidosPorIp.set(ip, [...anteriores, Date.now()]);
    const { emailVendas } = plataforma.config;
    if (emailVendas) {
      // O pedido já está guardado: se o e-mail falhar, a equipe ainda o vê na área da Starta.
      await plataforma.correio
        .enviar(emailContatoVendas(emailVendas, contato))
        .catch((e) => console.error('Falha ao enviar o pedido de contato para EMAIL_VENDAS:', e));
    }
    return { ok: true };
  });

  app.get<{ Params: { documento: string } }>('/textos/:documento', async (request): Promise<TextoLegal> => {
    const documento = request.params.documento as DocumentoLegal;
    if (!DOCUMENTOS_LEGAIS.includes(documento)) throw naoEncontrado('Texto');
    const texto = lerTextoLegal(plataforma.config, documento);
    if (!texto) throw new Error(`Texto jurídico "${documento}" não encontrado em docs/legal nem em TEXTOS_LEGAIS_DIR.`);
    return texto;
  });
};

export default rotas;

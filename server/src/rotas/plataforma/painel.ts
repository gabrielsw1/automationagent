// Plataforma › Implantações, Uso e custos, Saúde dos fluxos, Suporte (acessos de suporte e pedidos
// de contato do site) e Configurações › Planos e preços.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AcessoSuporteResumo, ContatoRecebido, DetalheEmpresaStarta, Plano, SaudeFluxo, UsoPlataforma } from '@copiloto/shared';
import { exigirStarta } from '../../auth/starta.ts';
import { desde30d, detalheEmpresa, saudeFluxos, usoPlataforma } from '../../plataforma/metricas.ts';
import { naoEncontrado } from '../../util/erros.ts';
import { validar } from './comum.ts';

const Centavos = z.number().int('Use centavos inteiros.').min(0, 'O preço não pode ser negativo.').max(100_000_000).nullable().optional();
const Precos = z.object({
  precoMensalCentavos: Centavos,
  taxaImplantacaoCentavos: Centavos,
  precoCreditoExtraCentavos: Centavos,
  /** Créditos do pacote avulso de Plano e créditos. */
  pacoteCreditos: z.number().int('Use um número inteiro de créditos.').min(1, 'O pacote tem pelo menos 1 crédito.').max(10_000_000).optional(),
});
const Periodo = z.object({ dias: z.coerce.number().int().min(1).max(366).default(30) });

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  app.addHook('preHandler', exigirStarta);

  /** Empresas em implantação ou piloto (e ativas), com as etapas. */
  app.get('/implantacoes', async (): Promise<DetalheEmpresaStarta[]> =>
    plataforma
      .listarEmpresas()
      .filter((e) => e.status === 'ativa' && !e.demo && (e.fase === 'implantacao' || e.fase === 'piloto'))
      .map((e) => detalheEmpresa(plataforma, e)),
  );

  app.get('/uso', async (request): Promise<UsoPlataforma> => {
    const { dias } = validar(Periodo, request.query);
    return usoPlataforma(plataforma, new Date(Date.now() - dias * 86_400_000).toISOString());
  });

  app.get('/saude', async (): Promise<SaudeFluxo[]> => saudeFluxos(plataforma));

  app.get('/suporte', async (): Promise<{ acessos: AcessoSuporteResumo[]; contatos: ContatoRecebido[]; desde: string }> => {
    const nomes = new Map(plataforma.listarEmpresas().map((e) => [e.id, e.nome]));
    return {
      acessos: plataforma.starta.acessosSuporte({ limite: 100 }).map((a) => ({ ...a, pessoa: a.pessoaNome, empresa: nomes.get(a.empresaId) ?? a.empresaId })),
      contatos: plataforma.contatos(100),
      desde: desde30d(),
    };
  });

  app.get('/planos', async (): Promise<Plano[]> => plataforma.planos());

  app.put<{ Params: { id: string } }>('/planos/:id', async (request): Promise<Plano> => {
    if (!plataforma.plano(request.params.id)) throw naoEncontrado('Plano');
    return plataforma.atualizarPrecosPlano(request.params.id, validar(Precos, request.body));
  });
};

export default rotas;

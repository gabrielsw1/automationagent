// Plataforma › Empresas › painel da empresa: as faturas dela. Na cobrança manual (sem ASAAS_API_KEY),
// a equipe Starta marca como paga quando o dinheiro chega (créditos de pacote entram nessa hora) ou
// cancela. Tudo vai para a auditoria da empresa.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { nomeCompetencia, precoEmReais, type Fatura, type FaturasEmpresaStarta } from '@copiloto/shared';
import { exigirStarta, pessoaStarta } from '../../auth/starta.ts';
import type { Empresa } from '../../plataforma/index.ts';
import { naoEncontrado } from '../../util/erros.ts';

type ComId = { Params: { id: string } };
type ComFatura = { Params: { id: string; fatura: string } };

function nomeFatura(f: Fatura): string {
  return f.tipo === 'mensal' && f.competencia ? `Fatura de ${nomeCompetencia(f.competencia)}` : `Pacote de ${(f.creditos ?? 0).toLocaleString('pt-BR')} créditos`;
}

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  app.addHook('preHandler', exigirStarta);

  const empresa = (request: FastifyRequest<ComId>): Empresa => {
    const e = plataforma.empresa(request.params.id);
    if (!e) throw naoEncontrado('Empresa');
    return e;
  };

  const lista = (e: Empresa): FaturasEmpresaStarta => ({
    faturas: plataforma.faturas.listar(e.id),
    pagamentos: { modo: plataforma.faturas.modo, notaFiscal: plataforma.faturas.notaFiscal },
    pendencias: plataforma.faturas.pendencias(e.id),
  });

  const auditar = (e: Empresa, request: FastifyRequest, acao: string, f: Fatura) =>
    plataforma.contexto(e.id).auditoria.registrar(`${pessoaStarta(request).nome} (Starta)`, acao, nomeFatura(f), precoEmReais(f.totalCentavos) ?? undefined);

  app.get<ComId>('/:id/faturas', async (request): Promise<FaturasEmpresaStarta> => lista(empresa(request)));

  app.post<ComFatura>('/:id/faturas/:fatura/paga', async (request): Promise<FaturasEmpresaStarta> => {
    const e = empresa(request);
    const f = await plataforma.faturas.marcarPaga(e.id, request.params.fatura);
    auditar(e, request, 'marcou a fatura como paga', f);
    return lista(e);
  });

  app.post<ComFatura>('/:id/faturas/:fatura/cancelar', async (request): Promise<FaturasEmpresaStarta> => {
    const e = empresa(request);
    const f = plataforma.faturas.cancelar(e.id, request.params.fatura);
    auditar(e, request, 'cancelou a fatura', f);
    return lista(e);
  });
};

export default rotas;

// Plataforma › Configurações › Equipe Starta: convidar, redefinir o acesso de quem esqueceu a senha
// ou perdeu o aparelho com o autenticador, e desativar quem saiu da equipe.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LinkAtivacao, MembroStarta } from '@copiloto/shared';
import { exigirStarta, pessoaStarta, resumoStarta } from '../../auth/starta.ts';
import { emailAtivacaoStarta } from '../../email/modelos.ts';
import type { PessoaStarta } from '../../plataforma/starta.ts';
import { ErroHttp, conflito, naoEncontrado } from '../../util/erros.ts';
import { validar } from './comum.ts';

const Convite = z.object({
  nome: z.string().trim().min(2, 'Diga o nome da pessoa.').max(120),
  email: z.string().trim().toLowerCase().email('Digite um e-mail válido.'),
});

type ComId = { Params: { id: string } };

const rotas: FastifyPluginAsync = async (app) => {
  const { plataforma } = app;

  app.addHook('preHandler', exigirStarta);

  const membroDe = (p: PessoaStarta): MembroStarta => ({
    ...resumoStarta(p),
    ativa: p.ativa,
    ativada: p.ativada,
    ultimoAcesso: p.ultimoAcesso,
    criadoEm: p.criadoEm,
    empresas: plataforma.listarEmpresas().filter((e) => e.responsavelStarta === p.id).length,
  });

  const pessoa = (request: FastifyRequest<ComId>): PessoaStarta => {
    const p = plataforma.starta.pessoa(request.params.id);
    if (!p) throw naoEncontrado('Pessoa da equipe Starta');
    return p;
  };

  async function enviarAtivacao(p: PessoaStarta, quem: PessoaStarta, redefinicao: boolean): Promise<LinkAtivacao> {
    const { token, expiraEm } = redefinicao ? plataforma.starta.redefinir(p.id) : plataforma.starta.novaAtivacao(p.id);
    const link = plataforma.linkAtivacaoStarta(token);
    try {
      await plataforma.correio.enviar(emailAtivacaoStarta({ para: p.email, nome: p.nome, link, validoAte: expiraEm, convidadoPor: quem.nome, redefinicao }));
    } catch (erro) {
      console.error('Falha ao enviar o link de ativação da equipe Starta:', erro);
      throw new ErroHttp(502, 'email_indisponivel', 'O link foi criado, mas o e-mail não saiu. Tente de novo em instantes.');
    }
    return { membro: membroDe(plataforma.starta.pessoa(p.id)!), link, expiraEm, envio: plataforma.correio.modo };
  }

  app.get('/', async (): Promise<MembroStarta[]> => plataforma.starta.listar().map(membroDe));

  app.post('/', async (request): Promise<LinkAtivacao> => {
    const d = validar(Convite, request.body);
    if (plataforma.starta.porEmail(d.email)) throw conflito('Esta pessoa já está na equipe Starta.');
    const quem = pessoaStarta(request);
    return enviarAtivacao(plataforma.starta.criar({ ...d, criadoPor: quem.id }), quem, false);
  });

  /** Apaga a senha e o autenticador e manda um link novo. */
  app.post<ComId>('/:id/redefinir', async (request): Promise<LinkAtivacao> => {
    const p = pessoa(request);
    const quem = pessoaStarta(request);
    if (p.id === quem.id) throw conflito('Peça a outro Admin da plataforma para redefinir o seu acesso.');
    if (!p.ativa) throw conflito('Reative a pessoa antes de redefinir o acesso.');
    return enviarAtivacao(p, quem, p.ativada);
  });

  app.post<ComId>('/:id/desativar', async (request): Promise<MembroStarta> => {
    const p = pessoa(request);
    if (p.id === pessoaStarta(request).id) throw conflito('Você não pode desativar o seu próprio acesso.');
    plataforma.starta.desativar(p.id);
    return membroDe(plataforma.starta.pessoa(p.id)!);
  });

  app.post<ComId>('/:id/reativar', async (request): Promise<MembroStarta> => {
    const p = pessoa(request);
    plataforma.starta.reativar(p.id);
    return membroDe(plataforma.starta.pessoa(p.id)!);
  });
};

export default rotas;

// Escolhe o adaptador de cada empresa. Empresas com conector `tela` usam o adaptador só pela tela;
// as com conector `api` usam o de ADAPTADOR (a demonstração usa o do Horizonte, `exemplo`).
// Para o seu sistema com API, acrescente uma linha em ADAPTADORES.
import type { Config } from '../config.ts';
import type { Banco } from '../db/banco.ts';
import { AdaptadorHorizonte } from './exemplo/index.ts';
import { AdaptadorTela } from './tela.ts';
import type { AdaptadorSistema, ArquivoBaixado, ChamadaApi, SessaoNavegador } from './tipos.ts';
import type { ModoAcesso, UsuarioSistema } from '@copiloto/shared';

export * from './tipos.ts';

export interface DadosAdaptador {
  /** Config da empresa (o `sistema` já é o dela). */
  config: Config;
  banco: Banco;
  perfis: string[];
  acesso: { modo: ModoAcesso; urlSessao: string; urlLogin: string; usuario: string };
  senhaAcesso: () => string | null;
  /** Segredo do widget da empresa: também assina os pedidos de sessão (modo `sessao`). */
  segredoWidget: () => string;
}

const ADAPTADORES: Record<string, (d: DadosAdaptador) => AdaptadorSistema> = {
  exemplo: (d) => new AdaptadorHorizonte(d.config),
  tela: (d) =>
    new AdaptadorTela(d.banco, {
      nome: d.config.sistema.nome,
      urlBase: d.config.sistema.urlBase,
      perfis: d.perfis,
      acesso: d.acesso,
      senha: d.senhaAcesso,
      segredo: d.segredoWidget,
    }),
};

export function criarAdaptador(d: DadosAdaptador): AdaptadorSistema {
  const criar = ADAPTADORES[d.config.adaptador];
  if (!criar) {
    throw new Error(
      `Adaptador "${d.config.adaptador}" não existe. Opções: ${Object.keys(ADAPTADORES).join(', ')}. Veja a seção "Ligar ao sistema de um cliente" do README.`,
    );
  }
  return criar(d);
}

/**
 * Adaptador da empresa que pode trocar por dentro quando o admin muda o sistema no console
 * (endereço, conta de serviço, perfis). Quem guardou a referência continua com o objeto certo.
 */
export class AdaptadorDaEmpresa implements AdaptadorSistema {
  constructor(
    private atual: AdaptadorSistema,
    /** Trocado pelos testes: não muda quando o sistema da empresa muda. */
    readonly fixo = false,
  ) {}

  trocar(novo: AdaptadorSistema) {
    if (!this.fixo) this.atual = novo;
  }

  get nome() {
    return this.atual.nome;
  }
  get urlBase() {
    return this.atual.urlBase;
  }
  verificarConexao() {
    return this.atual.verificarConexao();
  }
  buscarUsuario(id: string) {
    return this.atual.buscarUsuario(id);
  }
  listarUsuarios() {
    return this.atual.listarUsuarios();
  }
  listarPerfis() {
    return this.atual.listarPerfis();
  }
  chamar(c: ChamadaApi) {
    return this.atual.chamar(c);
  }
  descreverApi() {
    return this.atual.descreverApi();
  }
  sessaoNavegador(usuarioId: string): Promise<SessaoNavegador> {
    return this.atual.sessaoNavegador(usuarioId);
  }
  /** Só existe no conector só pela tela; nos outros, quem diz quem é a pessoa é a API. */
  get aprenderUsuario(): ((u: UsuarioSistema) => Promise<void>) | undefined {
    const a = this.atual;
    return a.aprenderUsuario ? (u) => a.aprenderUsuario!(u) : undefined;
  }
  async baixarArquivo(url: string, usuarioId: string): Promise<ArquivoBaixado | null> {
    return this.atual.baixarArquivo ? this.atual.baixarArquivo(url, usuarioId) : null;
  }
}

// Erro com status HTTP e mensagem em português pronta para mostrar (corpo ErroApi).
export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    /** Campos extras do corpo (ErroApi): `ate`, `restantes`, `aguardarS`. */
    readonly extra: { ate?: string; restantes?: number; aguardarS?: number } = {},
  ) {
    super(mensagem);
    this.name = 'ErroHttp';
  }
}

export const naoEncontrado = (o_que: string) => new ErroHttp(404, 'nao_encontrado', `${o_que} não encontrado.`);
export const semPermissao = (msg = 'Seu perfil não permite esta ação.') => new ErroHttp(403, 'sem_permissao', msg);
export const pedidoInvalido = (msg: string) => new ErroHttp(400, 'pedido_invalido', msg);
export const conflito = (msg: string) => new ErroHttp(409, 'conflito', msg);

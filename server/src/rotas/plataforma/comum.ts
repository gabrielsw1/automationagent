// Peças das rotas da Plataforma Starta.
import type { z } from 'zod';
import { pedidoInvalido } from '../../util/erros.ts';

export function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (!r.success) throw pedidoInvalido(r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

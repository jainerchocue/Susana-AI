import { z } from 'zod';
import { PAGINATION } from '../../config/constants';
import { codigoHis } from '../his/his.schemas';

/**
 * Catalogo de procedimientos (CUPS), derivado por el importador de
 * `Servicios.txt` (B0) y ampliable por API (TC3): `code` es la clave natural
 * (PK real en `schema.prisma`), nunca un UUID ni un autoincremental.
 */

export const procedureCodeParamSchema = z.object({ code: codigoHis });

export const createProcedureSchema = z
  .object({ code: codigoHis, name: z.string().trim().min(1).max(200) })
  .strict();

/** `code` es la clave natural: inmutable por API. Solo `name` se edita. */
export const updateProcedureSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

/**
 * Paginacion por cursor sobre `code` (PK string, no entera): a diferencia de
 * `cursorEnteroQuerySchema` (para las tablas con PK `Int`), aqui el keyset es
 * alfabetico sobre el propio codigo.
 */
export const listProceduresQuerySchema = z
  .object({
    cursor: codigoHis.optional(),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
  })
  .strict();

export type CreateProcedureInput = z.infer<typeof createProcedureSchema>;
export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>;
export type ListProceduresQuery = z.infer<typeof listProceduresQuerySchema>;
export type ProcedureCodeParam = z.infer<typeof procedureCodeParamSchema>;

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC3) ─────────────────────
export const procedureResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
});

import { z } from 'zod';
import { searchSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';
import { periodoQuerySchema } from '../his/his.periodo';

/**
 * `kind` lo calcula el importador (B0: prefijo `DM` -> insumo, el resto ->
 * medicamento) y lo guarda en `Medication.kind`. Aqui solo se valida que el
 * filtro venga en uno de esos dos valores.
 */
export const MEDICATION_KINDS = ['medicamento', 'insumo'] as const;

/**
 * Codigos del HIS observados: alfanumericos en mayusculas (ATC, `NP...`,
 * `DM...`). El limite superior deja margen sin ser tan laxo como para aceptar
 * cualquier cosa.
 */
export const medicationCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{3,20}$/, 'Codigo de medicamento invalido.');

export const codeParamSchema = z.object({ code: medicationCodeSchema });

/**
 * Catalogo paginado (page/limit, no cursor: son ~1.300 codigos, un COUNT
 * exacto es barato). `desde/hasta` acotan "cantidad y lineas del periodo";
 * `avgDailyConsumption` es una ventana fija de 30 dias hasta la fecha de
 * referencia y no depende de este periodo (T9).
 */
export const listMedicationsQuerySchema = periodoQuerySchema
  .extend({
    page: z.coerce.number().int().min(1).max(10_000).default(PAGINATION.defaultPage),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    search: searchSchema.optional(),
    kind: z.enum(MEDICATION_KINDS).optional(),
  })
  .strict();

export const consumptionQuerySchema = periodoQuerySchema
  .extend({
    code: medicationCodeSchema.optional(),
    grain: z.enum(['day', 'week']).default('day'),
  })
  .strict();

/** JSON body: ya viene tipado, sin `z.coerce` (eso es solo para query params, CLAUDE.md §4). */
export const updateStockSchema = z.object({ quantity: z.number().int().min(0) }).strict();

export type ListMedicationsQuery = z.infer<typeof listMedicationsQuerySchema>;
export type ConsumptionQuery = z.infer<typeof consumptionQuerySchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type CodeParam = z.infer<typeof codeParamSchema>;

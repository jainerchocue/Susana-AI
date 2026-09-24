import { z } from 'zod';
import { offsetQuerySchema, searchSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';
import { periodoQuerySchema } from '../his/his.periodo';
import { codigoHis, cursorEnteroQuerySchema, fechaHoraConDesfase } from '../his/his.schemas';

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

// ─────────────────────────────────────────────────────────────────────────────
// Catalogo: crear/editar (medications:manage, TC4). `code` es la clave natural
// del HIS: se normaliza con `codigoHis` (trim + mayusculas), igual que el resto
// de CRUD de datos HIS (TC1-TC5, his.schemas.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const createMedicationSchema = z
  .object({
    code: codigoHis,
    name: z.string().trim().min(1).max(200),
    kind: z.enum(MEDICATION_KINDS),
  })
  .strict();

/** `code` no se edita aqui: es el parametro de ruta (identidad del recurso), no un campo del cuerpo. */
export const updateMedicationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(MEDICATION_KINDS),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

// ─────────────────────────────────────────────────────────────────────────────
// Stock: listado paginado (medications:read, TC4). El alta/edicion sigue
// siendo el upsert de `updateStockSchema` (T9); esto solo pagina lo ya
// registrado, con el mismo `page/limit` que el catalogo (pocas filas: un
// COUNT exacto es barato, igual que en `listMedicationsQuerySchema`).
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_LEVELS = ['CRITICAL', 'LOW', 'OK', 'insufficient_data'] as const;

export const listStockQuerySchema = offsetQuerySchema.extend({ risk: z.enum(RISK_LEVELS).optional() }).strict();

// ─────────────────────────────────────────────────────────────────────────────
// Dispensaciones: CRUD completo (TC4, C0). Lectura con medications:read,
// escritura con data:manage: FARMACIA gestiona catalogo y stock pero NO
// dispensa por API (C0 lo deja explicito: dispensar sigue siendo un acto
// clinico, no de inventario).
// ─────────────────────────────────────────────────────────────────────────────

export const listDispensesQuerySchema = cursorEnteroQuerySchema
  .extend({
    admissionId: z.coerce.number().int().positive().optional(),
    code: medicationCodeSchema.optional(),
    area: z.string().trim().min(1).max(120).optional(),
    specialty: z.string().trim().min(1).max(120).optional(),
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
  })
  .strict();

/**
 * El id es `OidMI`, la clave natural del HIS: lo manda quien crea (C0), no se
 * autogenera (a diferencia de `SurgerySchedule`, la unica excepcion).
 */
export const createDispenseSchema = z
  .object({
    id: z.number().int().positive(),
    admissionId: z.number().int().positive(),
    code: codigoHis,
    quantity: z.number().int().positive(),
    dispensedAt: fechaHoraConDesfase,
    area: z.string().trim().min(1).max(120),
    specialty: z.string().trim().min(1).max(120),
  })
  .strict();

/** `id` no se edita: identidad del recurso (parametro de ruta), no campo del cuerpo. */
export const updateDispenseSchema = z
  .object({
    admissionId: z.number().int().positive(),
    code: codigoHis,
    quantity: z.number().int().positive(),
    dispensedAt: fechaHoraConDesfase,
    area: z.string().trim().min(1).max(120),
    specialty: z.string().trim().min(1).max(120),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export type CreateMedicationInput = z.infer<typeof createMedicationSchema>;
export type UpdateMedicationInput = z.infer<typeof updateMedicationSchema>;
export type ListStockQuery = z.infer<typeof listStockQuerySchema>;
export type ListDispensesQuery = z.infer<typeof listDispensesQuerySchema>;
export type CreateDispenseInput = z.infer<typeof createDispenseSchema>;
export type UpdateDispenseInput = z.infer<typeof updateDispenseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Esquemas de RESPUESTA (documentacion OpenAPI, TC4). Forma exacta de lo que
// devuelve cada handler (medications.service.ts): el `data` de un exito,
// nunca la entidad Prisma cruda.
// ─────────────────────────────────────────────────────────────────────────────

const numeroOInsuficiente = z.union([z.number(), z.literal('insufficient_data')]);
const riesgoResponseSchema = z.enum(['CRITICAL', 'LOW', 'OK', 'insufficient_data']);

export const medicationListItemResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  quantity: z.number(),
  lines: z.number(),
  lastDispensedAt: z.string().datetime().nullable(),
  stock: z.number().nullable(),
  avgDailyConsumption: numeroOInsuficiente,
  daysOfInventory: numeroOInsuficiente,
  risk: riesgoResponseSchema,
  rotation: z.literal('insufficient_data'),
});

export const criticalMedicationsResponseSchema = z.union([
  z.object({
    status: z.literal('ok'),
    items: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        kind: z.string().nullable(),
        stock: z.number(),
        avgDailyConsumption: z.number(),
        daysOfInventory: z.number(),
        risk: z.enum(['CRITICAL', 'LOW']),
      }),
    ),
  }),
  z.object({ status: z.literal('insufficient_data'), reason: z.string(), items: z.array(z.unknown()) }),
]);

export const consumptionResponseSchema = z.object({
  desde: z.string().datetime(),
  hasta: z.string().datetime(),
  grain: z.enum(['day', 'week']),
  code: z.string().nullable(),
  series: z.array(z.object({ date: z.string().datetime(), quantity: z.number() })),
  top: z.array(z.object({ code: z.string(), name: z.string(), quantity: z.number() })),
  byArea: z.array(z.object({ area: z.string(), quantity: z.number() })),
});

export const stockResponseSchema = z.object({
  code: z.string(),
  quantity: z.number(),
  updatedAt: z.string().datetime(),
});

export const stockListItemResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  quantity: z.number(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().uuid().nullable(),
  avgDailyConsumption: numeroOInsuficiente,
  daysOfInventory: numeroOInsuficiente,
  risk: riesgoResponseSchema,
});

export const medicationDetailResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  stock: z.number().nullable(),
  stockUpdatedAt: z.string().datetime().nullable(),
  consumption30d: z.number(),
  avgDailyConsumption: numeroOInsuficiente,
  daysOfInventory: numeroOInsuficiente,
  risk: riesgoResponseSchema,
  lastDispensedAt: z.string().datetime().nullable(),
});

export const medicationCatalogResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.string(),
});

export const dispenseResponseSchema = z.object({
  id: z.number(),
  admissionId: z.number(),
  code: z.string(),
  quantity: z.number(),
  dispensedAt: z.string().datetime(),
  area: z.string(),
  specialty: z.string(),
});

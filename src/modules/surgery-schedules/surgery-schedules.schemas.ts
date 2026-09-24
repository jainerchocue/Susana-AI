import { z } from 'zod';
import { codigoHis, cursorEnteroQuerySchema } from '../his/his.schemas';

/**
 * `SurgerySchedule` (his_surgery_schedules, ProgramacionCirugia.txt, B0): SIN
 * FK real (ni a Patient ni a Admission: el diccionario las declara pero los
 * datos reales no las cumplen, ver schema.prisma). `id` SI es autoincremental
 * aqui (unica de las 6 entidades HIS sin clave natural utilizable, C0), asi
 * que no viene en el POST. `executed` es un derivado de solo lectura
 * (recalcularDerivados): no forma parte de ningun schema de escritura, y
 * `.strict()` hace que mandarlo en el cuerpo de todas formas responda 422 en
 * vez de ignorarse en silencio.
 */

const CAMPOS_ESCRIBIBLES = {
  scheduleNumber: z.string().trim().min(1).max(50),
  patientId: z.number().int().positive(),
  // Null explicito = "sin ingreso verificable en el extracto" (B0): distinto
  // de "no se envio", que en un PATCH significa "no tocar este campo".
  admissionId: z.number().int().positive().nullable(),
  procedureCode: codigoHis,
};

export const createSurgeryScheduleSchema = z.object(CAMPOS_ESCRIBIBLES).strict();

export const updateSurgeryScheduleSchema = z
  .object(CAMPOS_ESCRIBIBLES)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export const EXECUTED_VALUES = ['si', 'no', 'desconocido'] as const;

export const listSurgerySchedulesQuerySchema = cursorEnteroQuerySchema
  .extend({
    scheduleNumber: z.string().trim().min(1).max(50).optional(),
    admissionId: z.coerce.number().int().positive().optional(),
    procedureCode: codigoHis.optional(),
    executed: z.enum(EXECUTED_VALUES).optional(),
  })
  .strict();

export type CreateSurgeryScheduleInput = z.infer<typeof createSurgeryScheduleSchema>;
export type UpdateSurgeryScheduleInput = z.infer<typeof updateSurgeryScheduleSchema>;
export type ListSurgerySchedulesQuery = z.infer<typeof listSurgerySchedulesQuerySchema>;

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC3) ─────────────────────
export const surgeryScheduleResponseSchema = z.object({
  id: z.number().int(),
  scheduleNumber: z.string(),
  patientId: z.number().int(),
  admissionId: z.number().int().nullable(),
  procedureCode: z.string(),
  executed: z.enum(EXECUTED_VALUES),
});

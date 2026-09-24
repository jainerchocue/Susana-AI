import { z } from 'zod';
import { cursorEnteroQuerySchema, fechaHoraConDesfase } from '../his/his.schemas';

/**
 * Triages (TC2). El id es la clave natural del HIS (`OidTriage`). Los signos
 * vitales son opcionales y acotados a un rango fisiologicamente plausible
 * (fuera de rango -> null, no error 422: mismo criterio que
 * `parseSignoEnRango` en el importador, que descarta el SIGNO, no la fila
 * entera). `level` no se deriva de `classification` aqui (a diferencia del
 * importador, que lo extrae con una regex de un texto en bruto del HIS): en
 * un alta manual por API el cliente ya sabe el nivel, y forzar el mismo regex
 * sobre un texto libre seria fragil.
 */

const textoCorto = (max: number) => z.string().trim().min(1).max(max);
const signoVital = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const camposEscribibles = {
  id: z.number().int().positive(),
  triagedAt: fechaHoraConDesfase,
  systolic: signoVital(0, 400),
  diastolic: signoVital(0, 300),
  heartRate: signoVital(0, 400),
  respiratoryRate: signoVital(0, 150),
  temperature: signoVital(20, 45),
  patientId: z.number().int().positive().nullable().optional(),
  code: textoCorto(20),
  classification: textoCorto(200),
  level: z.number().int().min(1).max(5).nullable().optional(),
};

export const createTriageSchema = z.object(camposEscribibles).strict();

export const updateTriageSchema = createTriageSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export const listTriagesQuerySchema = cursorEnteroQuerySchema
  .extend({
    level: z.coerce.number().int().min(1).max(5).optional(),
    patientId: z.coerce.number().int().positive().optional(),
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => !v.desde || !v.hasta || v.desde <= v.hasta, {
    message: '"desde" debe ser anterior o igual a "hasta".',
    path: ['desde'],
  });

export type CreateTriageInput = z.infer<typeof createTriageSchema>;
export type UpdateTriageInput = z.infer<typeof updateTriageSchema>;
export type ListTriagesQuery = z.infer<typeof listTriagesQuerySchema>;

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC2) ─────────────────────
export const publicTriageResponseSchema = z.object({
  id: z.number().int(),
  triagedAt: z.string().datetime(),
  systolic: z.number().nullable(),
  diastolic: z.number().nullable(),
  heartRate: z.number().nullable(),
  respiratoryRate: z.number().nullable(),
  temperature: z.number().nullable(),
  patientId: z.number().int().nullable(),
  code: z.string(),
  classification: z.string(),
  level: z.number().int().nullable(),
});

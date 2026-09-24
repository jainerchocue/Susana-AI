import { z } from 'zod';
import { cursorEnteroQuerySchema, fechaSimple } from '../his/his.schemas';

/**
 * Pacientes (TC2). El id es la clave natural del HIS (`IdPaciente`), no un
 * UUID: lo manda el cliente en el POST. Los campos de texto son los mismos
 * que valida el importador (`textoRequerido` en `src/scripts/import-data.ts`):
 * cadenas libres, sin catalogo cerrado (B0 documenta solo 2 sexos y 2 zonas en
 * el extracto real, pero el HIS no impone un enum a nivel de columna).
 */

const textoCorto = (max: number) => z.string().trim().min(1).max(max);

export const createPatientSchema = z
  .object({
    id: z.number().int().positive(),
    documentType: textoCorto(20),
    birthDate: fechaSimple,
    sex: textoCorto(20),
    insurer: textoCorto(120),
    regime: textoCorto(60),
    department: textoCorto(80),
    municipality: textoCorto(80),
    zone: textoCorto(20),
  })
  .strict();

/** Edicion parcial: el id es la clave natural, nunca se reasigna. */
export const updatePatientSchema = createPatientSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export const listPatientsQuerySchema = cursorEnteroQuerySchema
  .extend({
    sex: textoCorto(20).optional(),
    regime: textoCorto(60).optional(),
    zone: textoCorto(20).optional(),
    department: textoCorto(80).optional(),
    municipality: textoCorto(80).optional(),
    // Edad en AÑOS a la fecha de referencia (`fechaReferencia()`, B0: max(admittedAt), no `now()`).
    minAge: z.coerce.number().int().min(0).max(130).optional(),
    maxAge: z.coerce.number().int().min(0).max(130).optional(),
  })
  .strict()
  .refine((v) => v.minAge === undefined || v.maxAge === undefined || v.minAge <= v.maxAge, {
    message: '"minAge" debe ser menor o igual que "maxAge".',
    path: ['minAge'],
  });

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC2) ─────────────────────
// Forma exacta de `PublicPatient` (patients.mapper.ts): SIN `birthDate` (B0,
// "nunca sale un registro de paciente" con su fecha de nacimiento cruda). Solo
// sale `age`, ya calculada a la fecha de referencia.
export const publicPatientResponseSchema = z.object({
  id: z.number().int(),
  documentType: z.string(),
  sex: z.string(),
  insurer: z.string(),
  regime: z.string(),
  department: z.string(),
  municipality: z.string(),
  zone: z.string(),
  age: z.number().int(),
});

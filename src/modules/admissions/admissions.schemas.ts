import { z } from 'zod';
import { cursorEnteroQuerySchema, fechaHoraConDesfase } from '../his/his.schemas';

/**
 * Ingresos (TC2). El id es la clave natural del HIS (`OidIngreso`), no
 * autoincremental. `virtualBed` NO se acepta en la entrada: se deriva del
 * nombre de cama (`bedName.includes('VIRTUAL')`), igual que el importador
 * (`src/scripts/import-data.ts`, `ingresoSchema.transform`) -- aceptarlo suelto
 * permitiria una cama marcada "VIRTUAL" en el nombre pero `virtualBed: false`,
 * que rompe silenciosamente el censo de ocupacion (B0).
 *
 * `firstCareAt` tampoco se acepta aqui: se edita solo con
 * `PUT/DELETE /admissions/:id/first-care` (contrato del plan, TC2).
 * Los derivados (`lastActivityAt`, `triageLevel`, `waitMinutes`, `stayHours`,
 * `patientSex/Regime/Zone/Age`) son de solo lectura: los llena
 * `recalcularDerivados` tras cada escritura, nunca el cliente.
 */

const textoCorto = (max: number) => z.string().trim().min(1).max(max);
const textoCortoOpcional = (max: number) => textoCorto(max).nullable().optional();

const camposEscribibles = {
  id: z.number().int().positive(),
  consecutive: z.number().int().positive(),
  patientId: z.number().int().positive(),
  admissionClass: textoCorto(60),
  entryRoute: textoCorto(60),
  riskType: textoCorto(120),
  admittedAt: fechaHoraConDesfase,
  hospitalizedAt: fechaHoraConDesfase.nullable().optional(),
  // Null explicito = "sin triage" (mismo significado que el importador cuando
  // `OidTriageA` viene vacio o el triage referenciado no existe).
  triageId: z.number().int().positive().nullable().optional(),
  bedCode: textoCorto(30),
  bedName: textoCorto(120),
  unit: textoCorto(80),
  subunit: textoCorto(80),
  diagnosisCode: textoCortoOpcional(20),
  diagnosisName: textoCortoOpcional(200),
};

export const createAdmissionSchema = z.object(camposEscribibles).strict();

export const updateAdmissionSchema = createAdmissionSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export const listAdmissionsQuerySchema = cursorEnteroQuerySchema
  .extend({
    unit: textoCorto(80).optional(),
    admissionClass: textoCorto(60).optional(),
    entryRoute: textoCorto(60).optional(),
    triageLevel: z.coerce.number().int().min(1).max(5).optional(),
    diagnosisCode: textoCorto(20).optional(),
    patientId: z.coerce.number().int().positive().optional(),
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => !v.desde || !v.hasta || v.desde <= v.hasta, {
    message: '"desde" debe ser anterior o igual a "hasta".',
    path: ['desde'],
  });

/** `PUT /admissions/:id/first-care`: unica via para tocar `firstCareAt`. */
export const setFirstCareSchema = z.object({ firstCareAt: fechaHoraConDesfase }).strict();

export type CreateAdmissionInput = z.infer<typeof createAdmissionSchema>;
export type UpdateAdmissionInput = z.infer<typeof updateAdmissionSchema>;
export type ListAdmissionsQuery = z.infer<typeof listAdmissionsQuerySchema>;
export type SetFirstCareInput = z.infer<typeof setFirstCareSchema>;

// ─── Esquemas de RESPUESTA (documentacion OpenAPI, TC2) ────────────────────
/** Triage resumido (admissions.mapper.ts): solo lo esencial, no los signos vitales completos. */
export const triageResumenResponseSchema = z
  .object({
    id: z.number().int(),
    level: z.number().int().nullable(),
    code: z.string(),
    classification: z.string(),
    triagedAt: z.string().datetime(),
  })
  .nullable();

export const publicAdmissionResponseSchema = z.object({
  id: z.number().int(),
  consecutive: z.number().int(),
  patientId: z.number().int(),
  admissionClass: z.string(),
  entryRoute: z.string(),
  riskType: z.string(),
  admittedAt: z.string().datetime(),
  hospitalizedAt: z.string().datetime().nullable(),
  triageId: z.number().int().nullable(),
  bedCode: z.string(),
  bedName: z.string(),
  unit: z.string(),
  subunit: z.string(),
  virtualBed: z.boolean(),
  diagnosisCode: z.string().nullable(),
  diagnosisName: z.string().nullable(),
  firstCareAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  triageLevel: z.number().int().nullable(),
  waitMinutes: z.number().nullable(),
  stayHours: z.number().nullable(),
  patientSex: z.string().nullable(),
  patientRegime: z.string().nullable(),
  patientZone: z.string().nullable(),
  patientAge: z.number().int().nullable(),
  triage: triageResumenResponseSchema,
});

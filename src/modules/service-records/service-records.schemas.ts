import { z } from 'zod';
import { codigoHis, cursorEnteroQuerySchema, fechaHoraConDesfase } from '../his/his.schemas';
import { periodoQuerySchema } from '../his/his.periodo';

/**
 * `ServiceRecord` (his_service_records, Servicios.txt, B0): el id es la clave
 * natural del HIS (`OidS`), no autoincremental, y viene en el POST.
 * `providedAt` usa el formato con desfase EXPLICITO (his.schemas), a
 * diferencia del importador (que asume `-05:00` porque el HIS de origen no lo
 * trae).
 */

const CAMPOS_ESCRIBIBLES = {
  code: codigoHis,
  /**
   * Solo se exige si `code` no existe todavia en el catalogo (his_procedures):
   * la validacion de "obligatorio en ese caso" es semantica (depende del
   * estado de la BD), asi que vive en el servicio, no aqui (CLAUDE.md §4: Zod
   * valida forma, no reglas de negocio que dependen de otra tabla).
   */
  procedureName: z.string().trim().min(1).max(200).optional(),
  quantity: z.number().int().positive(),
  providedAt: fechaHoraConDesfase,
  areaCode: z.string().trim().min(1).max(20),
  area: z.string().trim().min(1).max(120),
  specialty: z.string().trim().min(1).max(120),
};

export const createServiceRecordSchema = z
  .object({
    // Clave natural (OidS del HIS): la manda el cliente, no se autogenera
    // (CLAUDE.md/C0: "los ids son las claves naturales del HIS y vienen en el
    // POST", salvo surgery-schedules).
    id: z.number().int().positive(),
    admissionId: z.number().int().positive(),
    ...CAMPOS_ESCRIBIBLES,
  })
  .strict();

/**
 * `admissionId` e `id` NO son editables (claves/vinculos inmutables): un
 * PATCH que reasignara el ingreso obligaria a recalcular los derivados de DOS
 * ingresos (el viejo y el nuevo) por un caso de uso que la especificacion no
 * pide. `executed` no existe en este recurso (es propio de surgery-schedules).
 */
export const updateServiceRecordSchema = z
  .object(CAMPOS_ESCRIBIBLES)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

/**
 * Filtros del listado (TC3): admissionId/code/area/specialty, mas el rango de
 * `providedAt` (desde/hasta, heredado de `periodoQuerySchema`: mismo par de
 * campos que ya usa el resto de la API, aqui como filtro literal, no como
 * "periodo con fecha de referencia").
 */
export const listServiceRecordsQuerySchema = cursorEnteroQuerySchema
  .merge(periodoQuerySchema)
  .extend({
    admissionId: z.coerce.number().int().positive().optional(),
    code: codigoHis.optional(),
    area: z.string().trim().min(1).max(120).optional(),
    specialty: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type CreateServiceRecordInput = z.infer<typeof createServiceRecordSchema>;
export type UpdateServiceRecordInput = z.infer<typeof updateServiceRecordSchema>;
export type ListServiceRecordsQuery = z.infer<typeof listServiceRecordsQuerySchema>;

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC3) ─────────────────────
export const serviceRecordResponseSchema = z.object({
  id: z.number().int(),
  admissionId: z.number().int(),
  code: z.string(),
  procedureName: z.string(),
  quantity: z.number().int(),
  providedAt: z.string().datetime(),
  areaCode: z.string(),
  area: z.string(),
  specialty: z.string(),
});

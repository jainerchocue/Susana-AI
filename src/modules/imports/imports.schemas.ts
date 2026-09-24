import { z } from 'zod';
import { uuidSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';
import { TABLAS_IMPORTABLES } from '../his/his.import';

/**
 * Esquemas de `POST /imports/:table` y compañia (TC1). `TABLAS_IMPORTABLES`
 * vive en `his.import.ts` (es quien sabe importar cada una): este modulo solo
 * la reusa para no duplicar la lista de nombres de tabla.
 */

export const tablaParamSchema = z.object({ table: z.enum(TABLAS_IMPORTABLES) }).strict();

export type TablaParam = z.infer<typeof tablaParamSchema>;

/** `?fileName=` es opcional y solo informativo (se guarda en el job, nunca se usa para elegir la ruta en disco). */
export const fileNameQuerySchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export type FileNameQuery = z.infer<typeof fileNameQuerySchema>;

const ESTADOS_IMPORT_JOB = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;

/**
 * Cursor UUID (keyset sobre `ImportJob.id`), igual que `listAuditQuerySchema`:
 * `ImportJob.id` es `@default(uuid())`, a diferencia de los recursos HIS
 * (`hisIdParamSchema`/`cursorEnteroQuerySchema`), que usan claves naturales
 * enteras del HIS.
 */
export const listImportsQuerySchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    status: z.enum(ESTADOS_IMPORT_JOB).optional(),
    table: z.enum(TABLAS_IMPORTABLES).optional(),
  })
  .strict();

export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;

/** Forma publica de `ImportJob` (OpenAPI + contrato de respuesta de todas las rutas de `/imports`). */
export const importJobResponseSchema = z.object({
  id: uuidSchema,
  table: z.enum(TABLAS_IMPORTABLES),
  status: z.enum(ESTADOS_IMPORT_JOB),
  fileName: z.string().nullable(),
  fileBytes: z.number().int(),
  delimiter: z.string().nullable(),
  processed: z.number().int(),
  inserted: z.number().int(),
  duplicates: z.number().int(),
  skipped: z.number().int(),
  invalid: z.number().int(),
  warnings: z.number().int(),
  errors: z.array(z.object({ linea: z.number().int(), motivo: z.string() })).nullable(),
  message: z.string().nullable(),
  createdBy: uuidSchema.nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

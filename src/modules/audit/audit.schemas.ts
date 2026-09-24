import { z } from 'zod';
import { uuidSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';

export const listAuditQuerySchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(50),
    actorId: uuidSchema.optional(),
    targetId: uuidSchema.optional(),
    action: z.string().trim().min(3).max(64).optional(),
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
  })
  .strict();

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

// ─── Esquema de RESPUESTA (documentacion OpenAPI, TC5) ─────────────────────
// Forma exacta de `PublicAuditEntry` (audit.service.ts). `metadata` es JSON
// arbitrario (detalle estructurado de cada accion): sin forma fija que documentar.
export const auditEntryResponseSchema = z.object({
  id: uuidSchema,
  action: z.string(),
  actorId: uuidSchema.nullable(),
  actorEmail: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: uuidSchema.nullable(),
  metadata: z.unknown(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

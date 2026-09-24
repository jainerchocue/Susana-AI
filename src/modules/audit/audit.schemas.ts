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

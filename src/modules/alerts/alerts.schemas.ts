import { z } from 'zod';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { uuidSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';
import { ALERT_SCOPES, ALERT_TYPES } from './alerts.constants';

export const idParamSchema = z.object({ id: uuidSchema });

export const listAlertsQuerySchema = z
  .object({
    // Paginacion por cursor (keyset), igual que audit.schemas.ts: coste
    // constante con la profundidad, sin OFFSET (A-13).
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    status: z.nativeEnum(AlertStatus).optional(),
    severity: z.nativeEnum(AlertSeverity).optional(),
    type: z.enum(ALERT_TYPES).optional(),
    scope: z.enum(ALERT_SCOPES).optional(),
  })
  .strict();

/** Solo estas dos transiciones se piden por API; OPEN es el estado inicial del motor. */
export const updateAlertSchema = z
  .object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']) })
  .strict();

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;

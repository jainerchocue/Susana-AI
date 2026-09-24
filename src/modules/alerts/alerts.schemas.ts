import { z } from 'zod';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { uuidSchema } from '../../core/http/schemas';
import { PAGINATION } from '../../config/constants';
import { ALERT_SCOPES, ALERT_SOURCES, ALERT_TYPES } from './alerts.constants';

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

/**
 * Alerta manual (TC5): un operador reporta un problema que el motor no
 * detecta. `value`/`threshold` no aplican (no hay metrica ni umbral real
 * detras de una nota humana); el servicio los guarda a 0 porque
 * `Alert.value`/`Alert.threshold` son `Float` obligatorios en schema.prisma
 * (TC5 no toca el esquema). El cliente distingue una manual de una del motor
 * por `source: 'manual'`, nunca por value/threshold en 0.
 */
export const createManualAlertSchema = z
  .object({
    type: z.enum(ALERT_TYPES),
    severity: z.nativeEnum(AlertSeverity),
    scope: z.enum(ALERT_SCOPES),
    scopeId: z.string().trim().min(1).max(64).optional(),
    message: z.string().trim().min(3).max(500),
  })
  .strict();

/** Los tipos de regla los define el motor: no se crean ni se borran por API. */
export const ruleTypeParamSchema = z.object({ type: z.enum(ALERT_TYPES) }).strict();

/**
 * Reglas del motor (TC5): solo se activan/desactivan y se cambian sus
 * umbrales. La coherencia entre warning/critical (LOW_STOCK: critical <
 * warning; el resto: critical > warning) se valida en el SERVICIO, no aqui:
 * un PATCH parcial puede tocar solo uno de los dos campos, y la coherencia se
 * comprueba contra el valor YA GUARDADO del otro (alerts.service.ts#updateRule).
 */
export const updateRuleSchema = z
  .object({
    enabled: z.boolean(),
    warningThreshold: z.number().positive(),
    criticalThreshold: z.number().positive().nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Envia al menos un campo.' });

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;
export type CreateManualAlertInput = z.infer<typeof createManualAlertSchema>;
export type RuleTypeParam = z.infer<typeof ruleTypeParamSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;

// ─── Esquemas de RESPUESTA (documentacion OpenAPI, TC5) ────────────────────
// Forma exacta de `alerts.mapper.ts` (PublicAlert/PublicAlertRule) y del
// resultado de `alerts.job.ts#evaluarAlertas`.

export const publicAlertResponseSchema = z.object({
  id: uuidSchema,
  type: z.enum(ALERT_TYPES),
  severity: z.nativeEnum(AlertSeverity),
  status: z.nativeEnum(AlertStatus),
  scope: z.enum(ALERT_SCOPES),
  scopeId: z.string().nullable(),
  metric: z.string(),
  value: z.number(),
  threshold: z.number(),
  message: z.string(),
  source: z.enum(ALERT_SOURCES),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
});

export const alertRuleResponseSchema = z.object({
  type: z.enum(ALERT_TYPES),
  enabled: z.boolean(),
  warningThreshold: z.number(),
  criticalThreshold: z.number().nullable(),
  updatedAt: z.string().datetime(),
});

export const evaluateAlertsResponseSchema = z.object({
  creadas: z.number().int(),
  actualizadas: z.number().int(),
  resueltas: z.number().int(),
  evaluadoEn: z.string().datetime(),
});

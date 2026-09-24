import type { Alert, AlertRule, AlertSeverity, AlertStatus } from '@prisma/client';
import type { AlertSource } from './alerts.constants';

/**
 * Forma publica de una alerta. NO expone `acknowledgedBy` ni `createdBy`: son
 * ids internos de usuario y el panel no los necesita (evita filtrar quien es
 * quien sin pasar por el mapper de usuarios).
 */
export interface PublicAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  scope: string;
  scopeId: string | null;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  /** 'engine' (motor de reglas) o 'manual' (creada por un operador, TC5). */
  source: AlertSource;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export function toPublicAlert(alert: Alert): PublicAlert {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    scope: alert.scope,
    scopeId: alert.scopeId,
    metric: alert.metric,
    value: alert.value,
    threshold: alert.threshold,
    message: alert.message,
    // `Alert.source` es `String` en Prisma (no un enum de la BD): se estrecha
    // con una comparacion, nunca con `as` (CLAUDE.md §11).
    source: alert.source === 'manual' ? 'manual' : 'engine',
    firstSeenAt: alert.firstSeenAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Forma publica de una regla del motor (TC5). No expone `updatedBy` (id
 * interno de usuario), igual que `PublicAlert` no expone `acknowledgedBy`.
 */
export interface PublicAlertRule {
  type: string;
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number | null;
  updatedAt: string;
}

export function toPublicAlertRule(rule: AlertRule): PublicAlertRule {
  return {
    type: rule.type,
    enabled: rule.enabled,
    warningThreshold: rule.warningThreshold,
    criticalThreshold: rule.criticalThreshold,
    updatedAt: rule.updatedAt.toISOString(),
  };
}

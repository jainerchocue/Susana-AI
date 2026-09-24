import type { Alert, AlertSeverity, AlertStatus } from '@prisma/client';

/**
 * Forma publica de una alerta. NO expone `acknowledgedBy`: es un id interno de
 * usuario y el panel no lo necesita (evita filtrar quien es quien sin pasar
 * por el mapper de usuarios).
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
    firstSeenAt: alert.firstSeenAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
  };
}

import { env } from '../../config/env';
import { PERMISSIONS } from '../../core/rbac/permissions';

/**
 * Constantes del dominio de alertas: ambitos, tipos y el permiso que habilita
 * ver cada ambito. Las usan el motor de reglas (T3) y el catalogo del
 * asistente (T4); viven aqui, en el modulo de negocio, no en `core/`.
 */

export const ALERT_SCOPES = ['medication', 'service', 'triage', 'surgery'] as const;
export type AlertScope = (typeof ALERT_SCOPES)[number];

export const ALERT_TYPES = [
  'LOW_STOCK',
  'HIGH_OCCUPANCY',
  'LONG_WAIT',
  'DEMAND_SPIKE',
  'SURGERY_CANCELLATIONS',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * Origen de una alerta (TC5). `engine` = motor de reglas; `manual` = creada
 * por un operador via `POST /alerts`. El motor NUNCA resuelve ni pisa las
 * manuales (alerts.service.ts#sincronizar filtra por `source: 'engine'`).
 */
export const ALERT_SOURCES = ['engine', 'manual'] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

/**
 * Permiso que habilita ver alertas de cada ambito. Entrada de
 * `alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION)` para
 * filtrar el listado por fila sin convertirlo en una puerta de acceso.
 */
export const ALERT_SCOPE_PERMISSION: Readonly<Record<AlertScope, string>> = {
  medication: PERMISSIONS.medications.read,
  service: PERMISSIONS.services.read,
  triage: PERMISSIONS.services.read,
  surgery: PERMISSIONS.surgeries.read,
};

export interface UmbralAlertaDefecto {
  warningThreshold: number;
  /** Null en las reglas de un solo nivel (DEMAND_SPIKE, SURGERY_CANCELLATIONS). */
  criticalThreshold: number | null;
}

/**
 * Umbrales por defecto (`env.ALERT_*`) de las 5 `AlertRule` (TC0/TC5), en el
 * MISMO orden y con la MISMA correspondencia que `alerts.engine.ts`
 * (`reglasPara`): si esa tabla cambia, esta debe cambiar con ella.
 *
 * Los usa el seed (crea las filas que falten, sin pisar las editadas por API)
 * y el global-setup E2E (las resiembra tras limpiar la BD entre corridas).
 */
export const UMBRALES_ALERTA_POR_DEFECTO: Record<AlertType, UmbralAlertaDefecto> = {
  LOW_STOCK: { warningThreshold: env.ALERT_LOW_STOCK_DAYS, criticalThreshold: env.ALERT_CRITICAL_STOCK_DAYS },
  HIGH_OCCUPANCY: {
    warningThreshold: env.ALERT_OCCUPANCY_PCT,
    criticalThreshold: env.ALERT_CRITICAL_OCCUPANCY_PCT,
  },
  LONG_WAIT: { warningThreshold: env.ALERT_WAIT_MINUTES, criticalThreshold: env.ALERT_WAIT_MINUTES * 2 },
  DEMAND_SPIKE: { warningThreshold: env.ALERT_DEMAND_SPIKE_PCT, criticalThreshold: null },
  SURGERY_CANCELLATIONS: { warningThreshold: env.ALERT_SURGERY_CANCELLATION_PCT, criticalThreshold: null },
};

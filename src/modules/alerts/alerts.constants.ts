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

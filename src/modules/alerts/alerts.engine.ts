import { AlertSeverity } from '@prisma/client';
import { env } from '../../config/env';
import type { AlertScope, AlertType } from './alerts.constants';

/**
 * Motor de reglas: PURO, sin Prisma. Convierte metricas del HIS en candidatos
 * de alerta comparando contra umbrales. La persistencia (crear/actualizar/
 * resolver) vive en `alerts.service.ts`; aqui solo se decide "que deberia
 * existir ahora mismo segun los numeros".
 */

export type MetricKey =
  | 'medication.daysOfInventory'
  | 'service.occupancyPct'
  | 'triage.waitMinutesP50'
  | 'service.demandChangePct'
  | 'surgery.cancellationPct';

export interface MetricPoint {
  metric: MetricKey;
  scope: AlertScope;
  scopeId: string | null;
  label: string;
  /** 'insufficient_data' cuando el KPI no es calculable: nunca genera alerta. */
  value: number | 'insufficient_data';
}

export interface AlertCandidate {
  type: AlertType;
  severity: AlertSeverity;
  scope: AlertScope;
  scopeId: string | null;
  metric: MetricKey;
  value: number;
  threshold: number;
  message: string;
}

export interface Umbrales {
  lowStockDays: number;
  criticalStockDays: number;
  occupancyPct: number;
  criticalOccupancyPct: number;
  waitMinutes: number;
  demandSpikePct: number;
  surgeryCancellationPct: number;
}

export const UMBRALES: Umbrales = {
  lowStockDays: env.ALERT_LOW_STOCK_DAYS,
  criticalStockDays: env.ALERT_CRITICAL_STOCK_DAYS,
  occupancyPct: env.ALERT_OCCUPANCY_PCT,
  criticalOccupancyPct: env.ALERT_CRITICAL_OCCUPANCY_PCT,
  waitMinutes: env.ALERT_WAIT_MINUTES,
  demandSpikePct: env.ALERT_DEMAND_SPIKE_PCT,
  surgeryCancellationPct: env.ALERT_SURGERY_CANCELLATION_PCT,
};

/** Sentido de la comparacion: por debajo de un minimo o por encima de un maximo. */
type Direccion = 'bajo_minimo' | 'sobre_maximo';

interface ReglaUmbral {
  type: AlertType;
  direccion: Direccion;
  warning: number;
  /** null = la regla solo tiene nivel WARNING (DEMAND_SPIKE, SURGERY_CANCELLATIONS). */
  critical: number | null;
}

/**
 * `Record<MetricKey, ...>` obliga en tiempo de compilacion a cubrir las 5
 * metricas: si se añade una a `MetricKey` y se olvida aqui, TypeScript falla.
 */
function reglasPara(u: Umbrales): Record<MetricKey, ReglaUmbral> {
  return {
    'medication.daysOfInventory': {
      type: 'LOW_STOCK',
      direccion: 'bajo_minimo',
      warning: u.lowStockDays,
      critical: u.criticalStockDays,
    },
    'service.occupancyPct': {
      type: 'HIGH_OCCUPANCY',
      direccion: 'sobre_maximo',
      warning: u.occupancyPct,
      critical: u.criticalOccupancyPct,
    },
    'triage.waitMinutesP50': {
      type: 'LONG_WAIT',
      direccion: 'sobre_maximo',
      warning: u.waitMinutes,
      critical: u.waitMinutes * 2,
    },
    'service.demandChangePct': {
      type: 'DEMAND_SPIKE',
      direccion: 'sobre_maximo',
      warning: u.demandSpikePct,
      critical: null,
    },
    'surgery.cancellationPct': {
      type: 'SURGERY_CANCELLATIONS',
      direccion: 'sobre_maximo',
      warning: u.surgeryCancellationPct,
      critical: null,
    },
  };
}

function construirCandidato(
  punto: MetricPoint,
  value: number,
  threshold: number,
  regla: ReglaUmbral,
  severity: AlertSeverity,
): AlertCandidate {
  const sentido = regla.direccion === 'bajo_minimo' ? 'por debajo del umbral' : 'por encima del umbral';
  return {
    type: regla.type,
    severity,
    scope: punto.scope,
    scopeId: punto.scopeId,
    metric: punto.metric,
    value,
    threshold,
    message: `${punto.label}: ${value.toFixed(1)} ${sentido} de ${threshold}.`,
  };
}

/** Comparacion ESTRICTA: en el umbral exacto no hay alerta. */
function excede(direccion: Direccion, value: number, umbral: number): boolean {
  return direccion === 'bajo_minimo' ? value < umbral : value > umbral;
}

function evaluarPunto(punto: MetricPoint, value: number, regla: ReglaUmbral): AlertCandidate | null {
  if (regla.critical !== null && excede(regla.direccion, value, regla.critical)) {
    return construirCandidato(punto, value, regla.critical, regla, AlertSeverity.CRITICAL);
  }
  if (excede(regla.direccion, value, regla.warning)) {
    return construirCandidato(punto, value, regla.warning, regla, AlertSeverity.WARNING);
  }
  return null;
}

/** Evalua todos los puntos y devuelve los candidatos que superan algun umbral. */
export function evaluarReglas(puntos: MetricPoint[], umbrales: Umbrales = UMBRALES): AlertCandidate[] {
  const reglas = reglasPara(umbrales);
  const candidatos: AlertCandidate[] = [];

  for (const punto of puntos) {
    if (punto.value === 'insufficient_data') continue;
    const candidato = evaluarPunto(punto, punto.value, reglas[punto.metric]);
    if (candidato) candidatos.push(candidato);
  }

  return candidatos;
}

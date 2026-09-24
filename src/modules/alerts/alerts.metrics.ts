import { fechaReferencia } from '../his/his.periodo';
import * as occupancyService from '../analytics/occupancy.service';
import * as waitTimeService from '../analytics/wait-time.service';
import * as demandService from '../analytics/demand.service';
import * as medicationsService from '../medications/medications.service';
import * as surgeriesService from '../surgeries/surgeries.service';
import type { MetricKey, MetricPoint } from './alerts.engine';

/**
 * Puente entre los datos HIS (T8/T9) y el motor de reglas (T3, puro): convierte
 * lo que ya calculan `occupancy/wait-time/demand/medications/surgeries.service`
 * en `MetricPoint[]`, todos referidos a `fechaReferencia()` (los datos acaban
 * ahi, no en `now()`, B0). Nunca toca Prisma directamente.
 */

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Las 5 metricas que el motor conoce (`alerts.engine.ts`). Se evaluan SIEMPRE
 * las 5, aunque alguna no aporte ningun punto en esta pasada (p. ej. sin stock
 * registrado, `medication.daysOfInventory` no genera puntos): es la lista que
 * `sincronizar` necesita para poder RESOLVER una alerta cuyo problema ya no se
 * detecta (alerts.service.ts, "una metrica no evaluada no se resuelve").
 */
export const METRICAS_EVALUADAS: MetricKey[] = [
  'medication.daysOfInventory',
  'service.occupancyPct',
  'triage.waitMinutesP50',
  'service.demandChangePct',
  'surgery.cancellationPct',
];

/**
 * Construye los puntos de todas las metricas del motor, en la fecha de
 * referencia de los datos HIS. Si no hay datos importados, `fechaReferencia()`
 * lanza `AppError.externalService` (503): se propaga tal cual, no se traga.
 */
export async function construirMetricas(): Promise<MetricPoint[]> {
  const referencia = await fechaReferencia();
  const desdeEspera = new Date(referencia.getTime() - SIETE_DIAS_MS);

  const [ocupacion, espera, demanda, inventario, pctSinEjecucion] = await Promise.all([
    occupancyService.ocupacionPorUnidad(referencia),
    // Espera "reciente" (7 dias hasta la referencia), igual criterio que
    // `GET /dashboard/summary` para su p50 de espera.
    waitTimeService.esperaPorNivel(desdeEspera, referencia),
    demandService.cambioDemandaPorUnidad(referencia),
    medicationsService.diasInventario(referencia),
    surgeriesService.pctSinEjecucion(),
  ]);

  const puntos: MetricPoint[] = [];

  for (const u of ocupacion) {
    puntos.push({
      metric: 'service.occupancyPct',
      scope: 'service',
      scopeId: u.unit,
      label: `Ocupacion de ${u.unit}`,
      value: u.occupancyPct,
    });
  }

  for (const e of espera) {
    puntos.push({
      metric: 'triage.waitMinutesP50',
      scope: 'triage',
      scopeId: `nivel-${e.level}`,
      label: `Espera mediana en triage nivel ${e.level}`,
      value: e.p50,
    });
  }

  for (const d of demanda) {
    puntos.push({
      metric: 'service.demandChangePct',
      scope: 'service',
      scopeId: d.unit,
      label: `Cambio de demanda en ${d.unit}`,
      value: d.changePct,
    });
  }

  for (const m of inventario) {
    puntos.push({
      metric: 'medication.daysOfInventory',
      scope: 'medication',
      scopeId: m.code,
      label: `Dias de inventario de ${m.name}`,
      value: m.daysOfInventory,
    });
  }

  // Ambito unico (no hay una "unidad" natural para cirugias programadas):
  // scopeId null, tal como fija el contrato compartido del plan de fase B.
  puntos.push({
    metric: 'surgery.cancellationPct',
    scope: 'surgery',
    scopeId: null,
    label: 'Cirugias programadas sin ejecucion registrada',
    value: pctSinEjecucion,
  });

  return puntos;
}

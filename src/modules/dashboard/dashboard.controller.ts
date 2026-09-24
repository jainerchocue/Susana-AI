import type { Request, RequestHandler } from 'express';
import { AlertStatus } from '@prisma/client';
import { ok } from '../../core/http/api-response';
import { fechaReferencia, resolverPeriodo } from '../his/his.periodo';
import { alcancesPorPermiso } from '../../core/rbac/alcance';
import { ALERT_SCOPE_PERMISSION, type AlertScope } from '../alerts/alerts.constants';
import * as alertsService from '../alerts/alerts.service';
import type { ListAlertsQuery } from '../alerts/alerts.schemas';
import * as occupancyService from '../analytics/occupancy.service';
import * as waitTimeService from '../analytics/wait-time.service';
import * as demandService from '../analytics/demand.service';
import type { DashboardQuery } from './dashboard.schemas';

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const SIETE_DIAS_MS = 7 * UN_DIA_MS;

// `DashboardQuery` (desde/hasta, ambos opcionales) no tiene ningun campo
// obligatorio: no hace falta ninguna asercion, TS ya acepta `req.query`
// directamente (a diferencia de un schema con `limit` obligatorio, como el de
// alertas, donde si hace falta el `as unknown as`).
function query(req: Request): DashboardQuery {
  return req.query;
}

function periodoIso(desde: Date, hasta: Date): { desde: string; hasta: string } {
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/**
 * Cuenta las alertas OPEN por severidad, solo en los ambitos visibles para el
 * actor (CLAUDE.md §0/T1: filtrado por fila con `alcancesPorPermiso`, la
 * puerta la puso `requirePermissions(dashboard.read)` en la ruta). Reusa
 * `alerts.service.list` en vez de tocar Prisma aqui: el volumen de alertas
 * abiertas es pequeño frente al de datos HIS, así que recorrer sus páginas es
 * barato y evita duplicar la consulta en otro módulo.
 */
async function alertasAbiertasPorSeveridad(
  alcances: AlertScope[],
): Promise<{ WARNING: number; CRITICAL: number } | undefined> {
  if (alcances.length === 0) return undefined;

  const conteo = { WARNING: 0, CRITICAL: 0 };
  let cursor: string | undefined;
  for (;;) {
    const consulta: ListAlertsQuery = { limit: 100, status: AlertStatus.OPEN, cursor };
    // Bucle secuencial a proposito: cada pagina necesita el cursor de la anterior.
    const pagina = await alertsService.list(consulta, alcances);
    for (const item of pagina.items) conteo[item.severity] += 1;
    if (!pagina.hasNext || !pagina.nextCursor) break;
    cursor = pagina.nextCursor;
  }
  return conteo;
}

export const summary: RequestHandler = async (req, res) => {
  const datosHasta = await fechaReferencia();
  const { desde, hasta } = await resolverPeriodo(query(req));
  const ventana24h = new Date(datosHasta.getTime() - UN_DIA_MS);
  const ventana7d = new Date(datosHasta.getTime() - SIETE_DIAS_MS);

  const [admissionsPeriodo, admissions24h, admissions7d, ocupacion, espera] = await Promise.all([
    demandService.conteoIngresos(desde, hasta),
    demandService.conteoIngresos(ventana24h, datosHasta),
    demandService.conteoIngresos(ventana7d, datosHasta),
    occupancyService.ocupacionPorUnidad(datosHasta),
    waitTimeService.esperaGlobal(ventana7d, datosHasta),
  ]);

  const totalCenso = ocupacion.reduce((acc, u) => acc + u.census, 0);
  const totalCamas = ocupacion.reduce((acc, u) => acc + u.physicalBeds, 0);

  const alcances = alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION);
  const alerts = await alertasAbiertasPorSeveridad(alcances);

  ok(res, {
    periodo: periodoIso(desde, hasta),
    datosHasta: datosHasta.toISOString(),
    admissions: { last24h: admissions24h, last7d: admissions7d, periodo: admissionsPeriodo },
    occupancy: {
      census: totalCenso,
      physicalBeds: totalCamas,
      occupancyPct: totalCamas === 0 ? 'insufficient_data' : (totalCenso / totalCamas) * 100,
      metodo: occupancyService.METODO_OCUPACION,
    },
    waitTimeP50Minutes: espera.p50,
    ...(alerts ? { alerts } : {}),
  });
};

export const occupancy: RequestHandler = async (req, res) => {
  const datosHasta = await fechaReferencia();
  const { desde, hasta } = await resolverPeriodo(query(req));

  const [porUnidad, serieDiaria] = await Promise.all([
    occupancyService.ocupacionPorUnidad(datosHasta),
    occupancyService.censoDiario(desde, hasta),
  ]);

  ok(res, {
    periodo: periodoIso(desde, hasta),
    datosHasta: datosHasta.toISOString(),
    metodo: occupancyService.METODO_OCUPACION,
    porUnidad,
    serieDiaria,
  });
};

export const waitTimes: RequestHandler = async (req, res) => {
  const { desde, hasta } = await resolverPeriodo(query(req));

  const [porNivel, serieDiaria] = await Promise.all([
    waitTimeService.esperaPorNivel(desde, hasta),
    waitTimeService.p50Diario(desde, hasta),
  ]);

  ok(res, { periodo: periodoIso(desde, hasta), porNivel, serieDiaria });
};

export const demand: RequestHandler = async (req, res) => {
  const datosHasta = await fechaReferencia();
  const { desde, hasta } = await resolverPeriodo(query(req));

  const [porDiaYUnidad, porViaIngreso, perfilHorario, cambioPorUnidad] = await Promise.all([
    demandService.ingresosPorDiaYUnidad(desde, hasta),
    demandService.ingresosPorViaIngreso(desde, hasta),
    demandService.perfilHorarioIngresos(desde, hasta),
    demandService.cambioDemandaPorUnidad(datosHasta),
  ]);

  ok(res, {
    periodo: periodoIso(desde, hasta),
    datosHasta: datosHasta.toISOString(),
    porDiaYUnidad,
    porViaIngreso,
    perfilHorario,
    cambioPorUnidad,
  });
};

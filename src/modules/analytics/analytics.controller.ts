import type { Request, RequestHandler } from 'express';
import { ok } from '../../core/http/api-response';
import { enviarCsv } from '../../core/http/csv';
import { AUDIT, auditar } from '../../core/audit/audit';
import { requestMeta } from '../../core/http/request';
import { resolverPeriodo } from '../his/his.periodo';
import * as analyticsService from './analytics.service';
import * as waitTimeService from './wait-time.service';
import type { AnalyticsQuery } from './analytics.schemas';

// `AnalyticsQuery` (desde/hasta, ambos opcionales) no tiene ningun campo
// obligatorio: no hace falta ninguna asercion (ver el mismo comentario en
// dashboard.controller.ts).
function query(req: Request): AnalyticsQuery {
  return req.query;
}

function periodoIso(desde: Date, hasta: Date): { desde: string; hasta: string } {
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

export const services: RequestHandler = async (req, res) => {
  const { desde, hasta } = await resolverPeriodo(query(req));

  const [porAreaEspecialidad, topProcedimientos, serieDiaria] = await Promise.all([
    analyticsService.volumenPorAreaEspecialidad(desde, hasta),
    analyticsService.topProcedimientos(desde, hasta),
    analyticsService.serieDiariaServicios(desde, hasta),
  ]);

  ok(res, { periodo: periodoIso(desde, hasta), porAreaEspecialidad, topProcedimientos, serieDiaria });
};

export const triage: RequestHandler = async (req, res) => {
  const { desde, hasta } = await resolverPeriodo(query(req));

  const [porNivel, porClasificacion, perfilHorario, esperaPorNivel] = await Promise.all([
    analyticsService.distribucionTriagePorNivel(desde, hasta),
    analyticsService.distribucionTriagePorClasificacion(desde, hasta),
    analyticsService.perfilHorarioTriage(desde, hasta),
    waitTimeService.esperaPorNivel(desde, hasta),
  ]);

  ok(res, { periodo: periodoIso(desde, hasta), porNivel, porClasificacion, perfilHorario, esperaPorNivel });
};

/** CSV del volumen por area/especialidad: es la tabla mas representativa del periodo. */
export const exportServices: RequestHandler = async (req, res) => {
  const { desde, hasta } = await resolverPeriodo(query(req));
  const filas = await analyticsService.volumenPorAreaEspecialidad(desde, hasta);

  await auditar({
    action: AUDIT.exportacion,
    actorId: req.auth!.id,
    targetType: 'analytics.services',
    metadata: { report: 'analytics.services', desde: desde.toISOString(), hasta: hasta.toISOString(), filas: filas.length },
    ...requestMeta(req),
  });

  enviarCsv(
    res,
    'servicios',
    ['area', 'specialty', 'lines', 'quantity'],
    filas.map((f) => ({ area: f.area, specialty: f.specialty, lines: f.lines, quantity: f.quantity })),
  );
};

/** CSV de la espera por nivel de triage (reusa wait-time.service, igual que la vista en pantalla). */
export const exportTriage: RequestHandler = async (req, res) => {
  const { desde, hasta } = await resolverPeriodo(query(req));
  const filas = await waitTimeService.esperaPorNivel(desde, hasta);

  await auditar({
    action: AUDIT.exportacion,
    actorId: req.auth!.id,
    targetType: 'analytics.triage',
    metadata: { report: 'analytics.triage', desde: desde.toISOString(), hasta: hasta.toISOString(), filas: filas.length },
    ...requestMeta(req),
  });

  enviarCsv(
    res,
    'triage',
    ['level', 'n', 'p50', 'p90', 'avg'],
    filas.map((f) => ({ level: f.level, n: f.n, p50: f.p50, p90: f.p90, avg: f.avg })),
  );
};

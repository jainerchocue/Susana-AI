import type { Request, RequestHandler } from 'express';
import { ok, paginated } from '../../core/http/api-response';
import { body, param, requestMeta } from '../../core/http/request';
import { AUDIT, auditar } from '../../core/audit/audit';
import { alcancesPorPermiso } from '../../core/rbac/alcance';
import { ALERT_SCOPE_PERMISSION, type AlertScope } from './alerts.constants';
import * as service from './alerts.service';
import { evaluarAlertas } from './alerts.job';
import type { ListAlertsQuery, UpdateAlertInput } from './alerts.schemas';

/**
 * Filtrado por ambito (CLAUDE.md §0, decision de T1): la puerta de acceso la
 * puso `requirePermissions(alerts.read/manage)` en la ruta; esto solo decide
 * que SUBCONJUNTO de filas ve el actor (p. ej. FARMACIA no ve `service`).
 */
function alcances(req: Request): AlertScope[] {
  return alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION);
}

function listQuery(req: Request): ListAlertsQuery {
  return req.query as unknown as ListAlertsQuery;
}

export const list: RequestHandler = async (req, res) =>
  paginated(res, await service.list(listQuery(req), alcances(req)));

export const getById: RequestHandler = async (req, res) =>
  ok(res, await service.getById(param(req, 'id'), alcances(req)));

export const updateStatus: RequestHandler = async (req, res) =>
  ok(
    res,
    await service.updateStatus(
      param(req, 'id'),
      body<UpdateAlertInput>(req),
      alcances(req),
      req.auth!.id,
      requestMeta(req),
    ),
  );

/**
 * Disparo manual del motor de reglas (T11): misma evaluacion que el job
 * periodico. La auditoria vive aqui, no en `evaluarAlertas()`, porque esa
 * funcion tambien la llama el job sin actor (igual que `exportServices` en
 * analytics.controller.ts audita en el controlador, no en el servicio, cuando
 * la operacion no es una escritura de negocio con su propio dueño).
 */
export const evaluate: RequestHandler = async (req, res) => {
  const resultado = await evaluarAlertas();
  await auditar({
    action: AUDIT.alertasEvaluadas,
    actorId: req.auth!.id,
    metadata: { ...resultado },
    ...requestMeta(req),
  });
  ok(res, resultado);
};

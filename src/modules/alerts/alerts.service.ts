import type { Prisma } from '@prisma/client';
import { AlertStatus } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import type { AlertCandidate, MetricKey } from './alerts.engine';
import type { AlertScope } from './alerts.constants';
import { toPublicAlert, type PublicAlert } from './alerts.mapper';
import type { ListAlertsQuery, UpdateAlertInput } from './alerts.schemas';

/** Identifica una alerta activa: mismo tipo y mismo recurso del HIS. */
function claveDe(type: string, scopeId: string | null): string {
  return `${type}::${scopeId ?? ''}`;
}

const ABIERTAS: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED];

/**
 * Sincroniza el estado de las alertas con lo que el motor de reglas acaba de
 * evaluar. Clave de identidad = (type, scopeId):
 *  - si ya existe una alerta OPEN/ACKNOWLEDGED con esa clave, se actualiza
 *    (severity/value/threshold/message/lastSeenAt) SIN tocar su status: un
 *    operador pudo haberla reconocido ya.
 *  - si no existe, se crea en OPEN.
 * Toda alerta OPEN/ACKNOWLEDGED cuya `metric` este entre las evaluadas en esta
 * pasada y cuya clave ya no aparezca entre los candidatos se marca RESOLVED:
 * el problema que la origino ya no se detecta.
 *
 * ponytail: sin index unico parcial sobre (type, scopeId) para OPEN/ACKNOWLEDGED
 * (ver prisma/schema.prisma). Basta con que un solo evaluador corra a la vez.
 */
export async function sincronizar(
  candidatos: AlertCandidate[],
  evaluadas: MetricKey[],
): Promise<{ creadas: number; actualizadas: number; resueltas: number }> {
  return prisma.$transaction(async (tx) => {
    let creadas = 0;
    let actualizadas = 0;
    const clavesCandidatos = new Set(candidatos.map((c) => claveDe(c.type, c.scopeId)));

    for (const candidato of candidatos) {
      const existente = await tx.alert.findFirst({
        where: { type: candidato.type, scopeId: candidato.scopeId, status: { in: ABIERTAS } },
        select: { id: true },
      });

      if (existente) {
        await tx.alert.update({
          where: { id: existente.id },
          data: {
            severity: candidato.severity,
            value: candidato.value,
            threshold: candidato.threshold,
            message: candidato.message,
            lastSeenAt: new Date(),
          },
        });
        actualizadas += 1;
      } else {
        await tx.alert.create({
          data: {
            type: candidato.type,
            severity: candidato.severity,
            scope: candidato.scope,
            scopeId: candidato.scopeId,
            metric: candidato.metric,
            value: candidato.value,
            threshold: candidato.threshold,
            message: candidato.message,
          },
        });
        creadas += 1;
      }
    }

    const abiertas = await tx.alert.findMany({
      where: { metric: { in: evaluadas }, status: { in: ABIERTAS } },
      select: { id: true, type: true, scopeId: true },
    });
    const aResolver = abiertas.filter((a) => !clavesCandidatos.has(claveDe(a.type, a.scopeId)));

    if (aResolver.length > 0) {
      await tx.alert.updateMany({
        where: { id: { in: aResolver.map((a) => a.id) } },
        data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
      });
    }

    return { creadas, actualizadas, resueltas: aResolver.length };
  });
}

/**
 * Filtro de fila por ambito: `alcances` viene de
 * `alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION)` en el
 * controlador. Un ambito fuera de ese conjunto nunca aparece ni cuenta como
 * "no encontrado" distinto de un id inexistente (anti-enumeracion).
 */
function scopeFiltrado(query: { scope?: AlertScope }, alcances: AlertScope[]): AlertScope[] {
  if (!query.scope) return alcances;
  return alcances.includes(query.scope) ? [query.scope] : [];
}

export interface ListAlertsResult {
  items: PublicAlert[];
  limit: number;
  hasNext: boolean;
  nextCursor: string | null;
}

/** Listado paginado por cursor, igual que audit.service.ts. */
export async function list(query: ListAlertsQuery, alcances: AlertScope[]): Promise<ListAlertsResult> {
  const where: Prisma.AlertWhereInput = { scope: { in: scopeFiltrado(query, alcances) } };
  if (query.status) where.status = query.status;
  if (query.severity) where.severity = query.severity;
  if (query.type) where.type = query.type;

  const filas = await prisma.alert.findMany({
    where,
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = filas.length > query.limit;
  const pagina = hasNext ? filas.slice(0, query.limit) : filas;

  return {
    items: pagina.map(toPublicAlert),
    limit: query.limit,
    hasNext,
    nextCursor: hasNext ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

/** Una alerta fuera del ambito del actor responde 404, igual que un id inexistente. */
export async function getById(id: string, alcances: AlertScope[]): Promise<PublicAlert> {
  const alert = await prisma.alert.findFirst({ where: { id, scope: { in: alcances } } });
  if (!alert) throw AppError.notFound('Alerta');
  return toPublicAlert(alert);
}

const TRANSICIONES_VALIDAS: Record<AlertStatus, AlertStatus[]> = {
  [AlertStatus.OPEN]: [AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED],
  [AlertStatus.ACKNOWLEDGED]: [AlertStatus.RESOLVED],
  [AlertStatus.RESOLVED]: [],
};

/** Reconocer o resolver. Transicion invalida -> 409 (no es un error de forma, es de estado). */
export async function updateStatus(
  id: string,
  input: UpdateAlertInput,
  alcances: AlertScope[],
  actorId: string,
  meta: RequestMeta,
): Promise<PublicAlert> {
  const alert = await prisma.alert.findFirst({ where: { id, scope: { in: alcances } } });
  if (!alert) throw AppError.notFound('Alerta');

  const destino = input.status;
  if (!TRANSICIONES_VALIDAS[alert.status].includes(destino)) {
    throw AppError.conflict(`No se puede pasar de ${alert.status} a ${destino}.`);
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const data: Prisma.AlertUpdateInput = { status: destino };
    if (destino === AlertStatus.ACKNOWLEDGED) {
      data.acknowledgedBy = actorId;
      data.acknowledgedAt = new Date();
    } else {
      // UpdateAlertInput solo admite 'ACKNOWLEDGED' | 'RESOLVED': descartado el
      // primero, `destino` ya es 'RESOLVED' (evita una condicion siempre verdadera).
      data.resolvedAt = new Date();
    }

    const fila = await tx.alert.update({ where: { id }, data });
    await auditarEnTx(tx, {
      action: AUDIT.alertaActualizada,
      actorId,
      targetType: 'alert',
      targetId: id,
      metadata: { from: alert.status, to: destino },
      ...meta,
    });
    return fila;
  });

  return toPublicAlert(actualizado);
}

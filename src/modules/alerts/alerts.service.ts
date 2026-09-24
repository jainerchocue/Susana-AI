import type { Prisma } from '@prisma/client';
import { AlertStatus } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import { UMBRALES, type AlertCandidate, type MetricKey, type Umbrales } from './alerts.engine';
import { UMBRALES_ALERTA_POR_DEFECTO, type AlertScope, type AlertType } from './alerts.constants';
import { toPublicAlert, toPublicAlertRule, type PublicAlert, type PublicAlertRule } from './alerts.mapper';
import type { CreateManualAlertInput, ListAlertsQuery, UpdateAlertInput, UpdateRuleInput } from './alerts.schemas';

/** Identifica una alerta activa: mismo tipo y mismo recurso del HIS. */
function claveDe(type: string, scopeId: string | null): string {
  return `${type}::${scopeId ?? ''}`;
}

const ABIERTAS: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED];

/** Origen de una alerta generada por el motor (por oposicion a 'manual', TC5). */
const FUENTE_MOTOR = 'engine';
const FUENTE_MANUAL = 'manual';
/** Metrica de una alerta manual: nunca coincide con un `MetricKey` real, asi
 *  que el filtro `metric: { in: evaluadas }` de `sincronizar()` nunca la toca. */
const METRICA_MANUAL = 'manual';

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
 * `source: FUENTE_MOTOR` en AMBAS consultas (TC5): sin el, una alerta MANUAL
 * con el mismo (type, scopeId) que un candidato real seria "actualizada" con
 * los datos del motor (perdiendo el mensaje del operador) o "resuelta" sin
 * que nadie la tocara. El invariante ("el motor nunca resuelve ni pisa las
 * manuales") se cumple ademas por construccion en la resolucion: una manual
 * siempre tiene `metric: METRICA_MANUAL`, que nunca esta en `evaluadas`.
 *
 * ponytail: sin index unico parcial sobre (type, scopeId, source) para
 * OPEN/ACKNOWLEDGED (ver prisma/schema.prisma). Basta con que un solo
 * evaluador corra a la vez.
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
        where: {
          type: candidato.type,
          scopeId: candidato.scopeId,
          status: { in: ABIERTAS },
          source: FUENTE_MOTOR,
        },
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
            source: FUENTE_MOTOR,
          },
        });
        creadas += 1;
      }
    }

    const abiertas = await tx.alert.findMany({
      where: { metric: { in: evaluadas }, status: { in: ABIERTAS }, source: FUENTE_MOTOR },
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

// ─────────────────────────────────────────────────────────────────────────────
// Reglas del motor (BD, TC5): GET /alerts/rules[/:type], PATCH /alerts/rules/:type
// ─────────────────────────────────────────────────────────────────────────────

export async function listRules(): Promise<PublicAlertRule[]> {
  const filas = await prisma.alertRule.findMany({ orderBy: { type: 'asc' } });
  return filas.map(toPublicAlertRule);
}

export async function getRule(type: AlertType): Promise<PublicAlertRule> {
  const fila = await prisma.alertRule.findUnique({ where: { type } });
  if (!fila) throw AppError.notFound('Regla de alerta');
  return toPublicAlertRule(fila);
}

/** Tipos cuya regla solo tiene nivel WARNING: su `criticalThreshold` es siempre null (alerts.engine.ts). */
const REGLAS_DE_UN_SOLO_NIVEL: ReadonlySet<AlertType> = new Set(['DEMAND_SPIKE', 'SURGERY_CANCELLATIONS']);

/**
 * Activar/desactivar una regla y/o cambiar sus umbrales. Coherencia (422):
 *  - Tipos de un solo nivel (DEMAND_SPIKE, SURGERY_CANCELLATIONS): el motor
 *    ignora `criticalThreshold` (siempre null en `reglasPara`), asi que se
 *    rechaza cualquier intento de ponerle un valor: dejarlo pasar guardaria
 *    un dato que nunca se usa, y eso es peor que rechazarlo.
 *  - LOW_STOCK: `criticalThreshold < warningThreshold` (menos dias = peor).
 *  - El resto (HIGH_OCCUPANCY, LONG_WAIT): `criticalThreshold > warningThreshold`.
 * La comprobacion se hace contra los valores YA GUARDADOS de los campos que
 * el PATCH no toca: un PATCH parcial no puede dejar la regla incoherente.
 */
export async function updateRule(
  type: AlertType,
  input: UpdateRuleInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicAlertRule> {
  const actual = await prisma.alertRule.findUnique({ where: { type } });
  if (!actual) throw AppError.notFound('Regla de alerta');

  const enabled = input.enabled ?? actual.enabled;
  const warningThreshold = input.warningThreshold ?? actual.warningThreshold;
  const criticalThreshold =
    input.criticalThreshold === undefined ? actual.criticalThreshold : input.criticalThreshold;

  if (criticalThreshold !== null) {
    if (REGLAS_DE_UN_SOLO_NIVEL.has(type)) {
      throw AppError.validation(`${type} no tiene nivel CRITICAL: criticalThreshold debe ser null.`, [
        { field: 'body.criticalThreshold', message: 'Esta regla solo tiene nivel WARNING.' },
      ]);
    }
    const coherente =
      type === 'LOW_STOCK' ? criticalThreshold < warningThreshold : criticalThreshold > warningThreshold;
    if (!coherente) {
      throw AppError.validation('Umbral critico incoherente con el de warning.', [
        {
          field: 'body.criticalThreshold',
          message:
            type === 'LOW_STOCK'
              ? 'En LOW_STOCK, criticalThreshold debe ser menor que warningThreshold.'
              : 'criticalThreshold debe ser mayor que warningThreshold.',
        },
      ]);
    }
  }

  const actualizada = await prisma.$transaction(async (tx) => {
    const fila = await tx.alertRule.update({
      where: { type },
      data: { enabled, warningThreshold, criticalThreshold, updatedBy: actorId },
    });
    await auditarEnTx(tx, {
      action: AUDIT.reglaAlertaActualizada,
      actorId,
      targetType: 'alert_rule',
      // `type` no es @db.Uuid en AuditLog (igual que el `code` de medicamentos):
      // viaja en metadata, no en targetId.
      metadata: {
        type,
        from: { enabled: actual.enabled, warningThreshold: actual.warningThreshold, criticalThreshold: actual.criticalThreshold },
        to: { enabled, warningThreshold, criticalThreshold },
      },
      ...meta,
    });
    return fila;
  });

  return toPublicAlertRule(actualizada);
}

/**
 * Traduce las 5 filas de `AlertRule` al formato que consume el motor puro
 * (`evaluarReglas`, alerts.engine.ts). Si falta alguna fila (no deberia pasar:
 * el seed las crea todas), cae al umbral por defecto de env y avisa con un
 * warn, nunca lanza: una fila que falte no debe tumbar la evaluacion.
 */
export async function leerReglas(): Promise<{ umbrales: Umbrales; desactivadas: ReadonlySet<AlertType> }> {
  // Solo 5 filas: buscar por `find` en vez de armar un Map evita tener que
  // estrechar `fila.type` (String en Prisma) a `AlertType` con un `as`
  // (CLAUDE.md §11). `valorDe` ya conoce el tipo por su propio parametro.
  const filas = await prisma.alertRule.findMany();
  const desactivadas = new Set<AlertType>();

  const valorDe = (type: AlertType): { warningThreshold: number; criticalThreshold: number | null } => {
    const fila = filas.find((f) => f.type === type);
    if (!fila) {
      logger.warn({ type }, 'Falta la regla de alertas en BD; se usa el umbral por defecto de env.');
      return UMBRALES_ALERTA_POR_DEFECTO[type];
    }
    if (!fila.enabled) desactivadas.add(type);
    return { warningThreshold: fila.warningThreshold, criticalThreshold: fila.criticalThreshold };
  };

  const lowStock = valorDe('LOW_STOCK');
  const occupancy = valorDe('HIGH_OCCUPANCY');
  const wait = valorDe('LONG_WAIT');
  const demand = valorDe('DEMAND_SPIKE');
  const surgery = valorDe('SURGERY_CANCELLATIONS');

  const umbrales: Umbrales = {
    lowStockDays: lowStock.warningThreshold,
    criticalStockDays: lowStock.criticalThreshold ?? UMBRALES.criticalStockDays,
    occupancyPct: occupancy.warningThreshold,
    criticalOccupancyPct: occupancy.criticalThreshold ?? UMBRALES.criticalOccupancyPct,
    waitMinutes: wait.warningThreshold,
    criticalWaitMinutes: wait.criticalThreshold ?? wait.warningThreshold * 2,
    demandSpikePct: demand.warningThreshold,
    surgeryCancellationPct: surgery.warningThreshold,
  };

  return { umbrales, desactivadas };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertas manuales (TC5): POST /alerts, DELETE /alerts/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea una alerta manual. `value`/`threshold` se guardan a 0 (ver el
 * comentario de `createManualAlertSchema`): no hay metrica real detras.
 * Solo se puede crear en un ambito visible para el actor (mismo filtro de
 * fila que list/getById, `alcancesPorPermiso` en el controlador): crear en un
 * ambito que ni siquiera puede LEER seria una escalada de autoridad.
 */
export async function createManual(
  input: CreateManualAlertInput,
  alcances: AlertScope[],
  actorId: string,
  meta: RequestMeta,
): Promise<PublicAlert> {
  if (!alcances.includes(input.scope)) {
    throw AppError.forbidden(`No tienes permiso para crear alertas de ambito "${input.scope}".`);
  }

  const creada = await prisma.$transaction(async (tx) => {
    const fila = await tx.alert.create({
      data: {
        type: input.type,
        severity: input.severity,
        status: AlertStatus.OPEN,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        metric: METRICA_MANUAL,
        value: 0,
        threshold: 0,
        message: input.message,
        source: FUENTE_MANUAL,
        createdBy: actorId,
      },
    });
    await auditarEnTx(tx, {
      action: AUDIT.alertaCreada,
      actorId,
      targetType: 'alert',
      targetId: fila.id,
      metadata: { type: fila.type, scope: fila.scope, scopeId: fila.scopeId },
      ...meta,
    });
    return fila;
  });

  return toPublicAlert(creada);
}

/**
 * Borra una alerta. Solo manuales o RESOLVED (409 en cualquier otro caso): una
 * alerta abierta del motor la recrearia la siguiente evaluacion, asi que
 * borrarla sin resolverla antes solo esconde el problema un instante.
 */
export async function remove(
  id: string,
  alcances: AlertScope[],
  actorId: string,
  meta: RequestMeta,
): Promise<void> {
  const alert = await prisma.alert.findFirst({ where: { id, scope: { in: alcances } } });
  if (!alert) throw AppError.notFound('Alerta');

  if (alert.source !== FUENTE_MANUAL && alert.status !== AlertStatus.RESOLVED) {
    throw AppError.conflict('Solo se pueden borrar alertas manuales o resueltas.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.alert.delete({ where: { id } });
    await auditarEnTx(tx, {
      action: AUDIT.alertaBorrada,
      actorId,
      targetType: 'alert',
      targetId: id,
      metadata: { type: alert.type, scope: alert.scope, source: alert.source, status: alert.status },
      ...meta,
    });
  });
}

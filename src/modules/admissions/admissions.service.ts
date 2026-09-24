import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import type { Actor } from '../../core/rbac/guards';
import { invalidarFechaReferencia } from '../his/his.periodo';
import { recalcularDerivados } from '../his/his.derivados';
import { admissionWithTriageInclude, toPublicAdmission, type PublicAdmission } from './admissions.mapper';
import type { CreateAdmissionInput, ListAdmissionsQuery, UpdateAdmissionInput } from './admissions.schemas';

export interface ListResult<T> {
  items: T[];
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

/** `NombreCama` contiene "VIRTUAL": misma derivacion que el importador (import-data.ts, `ingresoSchema`). */
function esCamaVirtual(bedName: string): boolean {
  return bedName.includes('VIRTUAL');
}

export async function list(query: ListAdmissionsQuery): Promise<ListResult<PublicAdmission>> {
  const where: Prisma.AdmissionWhereInput = {};
  if (query.unit) where.unit = query.unit;
  if (query.admissionClass) where.admissionClass = query.admissionClass;
  if (query.entryRoute) where.entryRoute = query.entryRoute;
  if (query.triageLevel !== undefined) where.triageLevel = query.triageLevel;
  if (query.diagnosisCode) where.diagnosisCode = query.diagnosisCode;
  if (query.patientId !== undefined) where.patientId = query.patientId;
  if (query.desde || query.hasta) {
    where.admittedAt = {};
    if (query.desde) where.admittedAt.gte = query.desde;
    if (query.hasta) where.admittedAt.lte = query.hasta;
  }

  const items = await prisma.admission.findMany({
    where,
    include: admissionWithTriageInclude,
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  return {
    items: pagina.map(toPublicAdmission),
    limit: query.limit,
    nextCursor: hasNext ? String(pagina[pagina.length - 1]!.id) : null,
    hasNext,
  };
}

export async function getById(id: number): Promise<PublicAdmission> {
  const admission = await prisma.admission.findUnique({ where: { id }, include: admissionWithTriageInclude });
  if (!admission) throw AppError.notFound('Ingreso');
  return toPublicAdmission(admission);
}

export async function create(
  input: CreateAdmissionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicAdmission> {
  const existente = await prisma.admission.findUnique({ where: { id: input.id }, select: { id: true } });
  if (existente) throw AppError.conflict(`Ya existe un ingreso con id ${input.id}.`);

  const admission = await prisma.$transaction(async (tx) => {
    // FK reales (patientId RESTRICT, triageId UNIQUE + SET NULL): un
    // paciente/triage inexistente o un triage ya usado lanzan P2003/P2002,
    // que el error handler traduce solo (CLAUDE.md §10): no se comprueban a mano.
    const creado = await tx.admission.create({
      data: { ...input, virtualBed: esCamaVirtual(input.bedName) },
      include: admissionWithTriageInclude,
    });
    await recalcularDerivados(tx, { admissionIds: [creado.id] });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroCreado,
      targetType: 'admission',
      // `auditLog.targetId` es UUID en BD: los ids del HIS son enteros, asi
      // que viajan solo en `metadata` (igual en el resto de este modulo).
      metadata: { id: input.id, campos: Object.keys(input) },
      ...meta,
    });
    // `creado` es la fila TAL COMO quedo el INSERT, antes de que
    // `recalcularDerivados` la tocara (patientSex/Regime/Zone/Age, triageLevel,
    // waitMinutes...): sin releerla, la respuesta devolveria esos derivados en
    // null aunque la BD ya los tenga bien. Misma `tx`: ve sus propios cambios.
    return tx.admission.findUniqueOrThrow({ where: { id: creado.id }, include: admissionWithTriageInclude });
  });

  // Un ingreso nuevo puede mover `max(admittedAt)`: invalida SIEMPRE, es solo
  // limpiar una cache en memoria (his.periodo.ts).
  invalidarFechaReferencia();
  return toPublicAdmission(admission);
}

export async function update(
  id: number,
  input: UpdateAdmissionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicAdmission> {
  const data: Prisma.AdmissionUpdateInput = { ...input };
  if (input.bedName !== undefined) data.virtualBed = esCamaVirtual(input.bedName);
  // `recalcularDerivados` recalcula triageLevel/waitMinutes con un JOIN sobre
  // `triageId`: si se limpia el vinculo (triageId -> null), ese JOIN deja de
  // casar y el UPDATE compartido NO toca la fila (no es su trabajo "resetear",
  // solo "recalcular con lo que hay"). Sin este null explicito, un ingreso sin
  // triage se quedaria con el nivel/espera del triage que perdio, ya obsoletos.
  if (input.triageId === null) {
    data.triageLevel = null;
    data.waitMinutes = null;
  }

  const admission = await prisma.$transaction(async (tx) => {
    // `update` (no `updateMany`) lanza P2025 si no existe -> 404 automatico.
    // No hace falta `include` aqui: se relee completa despues de recalcular.
    await tx.admission.update({ where: { id }, data });
    await recalcularDerivados(tx, { admissionIds: [id] });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroActualizado,
      targetType: 'admission',
      metadata: { id, campos: Object.keys(input) },
      ...meta,
    });
    // Misma razon que en `create()`: `recalcularDerivados` corre DESPUES de
    // este UPDATE, asi que la fila devuelta por el propio UPDATE ya esta
    // obsoleta para triageLevel/waitMinutes/etc.
    return tx.admission.findUniqueOrThrow({ where: { id }, include: admissionWithTriageInclude });
  });

  if (input.admittedAt !== undefined) invalidarFechaReferencia();
  return toPublicAdmission(admission);
}

export async function remove(id: number, actor: Actor, meta: RequestMeta): Promise<void> {
  const existente = await prisma.admission.findUnique({ where: { id }, select: { id: true } });
  if (!existente) throw AppError.notFound('Ingreso');

  const [servicios, dispensas] = await Promise.all([
    prisma.serviceRecord.count({ where: { admissionId: id } }),
    prisma.medicationDispense.count({ where: { admissionId: id } }),
  ]);
  if (servicios > 0 || dispensas > 0) {
    const partes: string[] = [];
    if (servicios > 0) partes.push(`${servicios} registro(s) de servicio`);
    if (dispensas > 0) partes.push(`${dispensas} dispensacion(es) de medicamento`);
    throw AppError.conflict(`No se puede borrar el ingreso: tiene ${partes.join(' y ')}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.admission.delete({ where: { id } });
    // `his_surgery_schedules` no tiene FK real a Admission (B0): tras borrar,
    // se recalcula para que `executed` pase a 'desconocido' si alguna cirugia
    // referenciaba este ingreso (misma pasada que usa el importador).
    await recalcularDerivados(tx, { admissionIds: [id] });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroBorrado,
      targetType: 'admission',
      metadata: { id },
      ...meta,
    });
  });

  invalidarFechaReferencia();
}

/** `PUT /admissions/:id/first-care`. Unica via para tocar `firstCareAt` (contrato TC2). */
export async function setFirstCare(
  id: number,
  firstCareAt: Date,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicAdmission> {
  return escribirFirstCare(id, firstCareAt, actor, meta);
}

/** `DELETE /admissions/:id/first-care`: vuelve a "sin atencion registrada". */
export async function clearFirstCare(id: number, actor: Actor, meta: RequestMeta): Promise<PublicAdmission> {
  return escribirFirstCare(id, null, actor, meta);
}

async function escribirFirstCare(
  id: number,
  firstCareAt: Date | null,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicAdmission> {
  const admission = await prisma.$transaction(async (tx) => {
    await tx.admission.update({
      // Mismo motivo que en `update()`: al limpiar `firstCareAt`, el UPDATE
      // compartido deja de casar (exige `firstCareAt IS NOT NULL`) y no
      // resetea `waitMinutes` por si solo.
      data: firstCareAt === null ? { firstCareAt, waitMinutes: null } : { firstCareAt },
      where: { id },
    });
    // `waitMinutes` depende de `firstCareAt` (triage -> primera atencion).
    await recalcularDerivados(tx, { admissionIds: [id] });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroActualizado,
      targetType: 'admission',
      metadata: { id, campos: ['firstCareAt'] },
      ...meta,
    });
    // Se relee tras recalcular (mismo motivo que en `create()`/`update()`).
    return tx.admission.findUniqueOrThrow({ where: { id }, include: admissionWithTriageInclude });
  });

  return toPublicAdmission(admission);
}

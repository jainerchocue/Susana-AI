import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditar, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import type { Actor } from '../../core/rbac/guards';
import { fechaReferencia } from '../his/his.periodo';
import { recalcularDerivados } from '../his/his.derivados';
import { toPublicPatient, type PublicPatient } from './patients.mapper';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patients.schemas';

export interface ListResult<T> {
  items: T[];
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

/**
 * Convierte `minAge`/`maxAge` (años a `fechaReferencia()`, B0) en limites de
 * `birthDate`. Bogota esta fija en UTC-5 sin horario de verano: restar 5h a la
 * referencia y leer los componentes UTC equivale a "AT TIME ZONE
 * 'America/Bogota'" (mismo criterio que `calcularEdad`, patients.mapper.ts).
 */
const CINCO_HORAS_MS = 5 * 60 * 60 * 1000;
function limiteNacimiento(aniosAtras: number, referencia: Date): Date {
  const refBogota = new Date(referencia.getTime() - CINCO_HORAS_MS);
  return new Date(Date.UTC(refBogota.getUTCFullYear() - aniosAtras, refBogota.getUTCMonth(), refBogota.getUTCDate()));
}

function construirWhere(query: ListPatientsQuery, referencia: Date): Prisma.PatientWhereInput {
  const where: Prisma.PatientWhereInput = {};
  if (query.sex) where.sex = query.sex;
  if (query.regime) where.regime = query.regime;
  if (query.zone) where.zone = query.zone;
  if (query.department) where.department = query.department;
  if (query.municipality) where.municipality = query.municipality;

  if (query.minAge !== undefined || query.maxAge !== undefined) {
    where.birthDate = {};
    // age >= minAge <=> birthDate <= limite(minAge). age <= maxAge <=> birthDate > limite(maxAge + 1).
    if (query.minAge !== undefined) where.birthDate.lte = limiteNacimiento(query.minAge, referencia);
    if (query.maxAge !== undefined) where.birthDate.gt = limiteNacimiento(query.maxAge + 1, referencia);
  }
  return where;
}

/** Nunca valores clinicos: solo los FILTROS pedidos y cuantas filas devolvio el listado. */
function metadatosListado(query: ListPatientsQuery, resultados: number): Prisma.InputJsonValue {
  return {
    filtros: {
      sex: query.sex ?? null,
      regime: query.regime ?? null,
      zone: query.zone ?? null,
      department: query.department ?? null,
      municipality: query.municipality ?? null,
      minAge: query.minAge ?? null,
      maxAge: query.maxAge ?? null,
    },
    resultados,
  };
}

export async function list(query: ListPatientsQuery): Promise<ListResult<PublicPatient>> {
  const referencia = await fechaReferencia();
  const where = construirWhere(query, referencia);

  const items = await prisma.patient.findMany({
    where,
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  // Lectura de datos de paciente: se audita SIEMPRE, incluso si no hay resultados
  // (C0: "cada lectura se audita"; en el listado, una sola fila con los
  // filtros y el numero de resultados, nunca los valores clinicos en si).
  await auditar({
    action: AUDIT.accesoSensible,
    targetType: 'patient',
    metadata: metadatosListado(query, pagina.length),
  });

  return {
    items: pagina.map((p) => toPublicPatient(p, referencia)),
    limit: query.limit,
    nextCursor: hasNext ? String(pagina[pagina.length - 1]!.id) : null,
    hasNext,
  };
}

export async function getById(id: number): Promise<PublicPatient> {
  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw AppError.notFound('Paciente');

  await auditar({ action: AUDIT.accesoSensible, targetType: 'patient', targetId: String(id) });

  const referencia = await fechaReferencia();
  return toPublicPatient(patient, referencia);
}

export async function create(input: CreatePatientInput, actor: Actor, meta: RequestMeta): Promise<PublicPatient> {
  const existente = await prisma.patient.findUnique({ where: { id: input.id }, select: { id: true } });
  if (existente) throw AppError.conflict(`Ya existe un paciente con id ${input.id}.`);

  const patient = await prisma.$transaction(async (tx) => {
    const creado = await tx.patient.create({ data: input });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroCreado,
      targetType: 'patient',
      targetId: String(input.id),
      metadata: { id: input.id, campos: Object.keys(input) },
      ...meta,
    });
    return creado;
  });

  return toPublicPatient(patient, await fechaReferencia());
}

export async function update(
  id: number,
  input: UpdatePatientInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicPatient> {
  const patient = await prisma.$transaction(async (tx) => {
    // `update` (no `updateMany`) lanza P2025 si no existe: el error handler lo
    // traduce a 404 automaticamente (CLAUDE.md §10).
    const actualizado = await tx.patient.update({ where: { id }, data: input });

    // Cualquier campo del paciente (sexo, regimen, zona, fecha de nacimiento)
    // esta copiado como snapshot en los ingresos (his.derivados.ts, paso 5):
    // se recalculan los ingresos de ESTE paciente, nunca la tabla entera.
    const admisiones = await tx.admission.findMany({ where: { patientId: id }, select: { id: true } });
    if (admisiones.length > 0) {
      await recalcularDerivados(tx, { admissionIds: admisiones.map((a) => a.id) });
    }

    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroActualizado,
      targetType: 'patient',
      targetId: String(id),
      metadata: { id, campos: Object.keys(input) },
      ...meta,
    });
    return actualizado;
  });

  return toPublicPatient(patient, await fechaReferencia());
}

export async function remove(id: number, actor: Actor, meta: RequestMeta): Promise<void> {
  const existente = await prisma.patient.findUnique({ where: { id }, select: { id: true } });
  if (!existente) throw AppError.notFound('Paciente');

  const [admisiones, triages] = await Promise.all([
    prisma.admission.count({ where: { patientId: id } }),
    prisma.triage.count({ where: { patientId: id } }),
  ]);
  if (admisiones > 0 || triages > 0) {
    const partes: string[] = [];
    if (admisiones > 0) partes.push(`${admisiones} ingreso(s)`);
    if (triages > 0) partes.push(`${triages} triage(s)`);
    throw AppError.conflict(`No se puede borrar el paciente: lo referencian ${partes.join(' y ')}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.patient.delete({ where: { id } });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroBorrado,
      targetType: 'patient',
      targetId: String(id),
      metadata: { id },
      ...meta,
    });
  });
}

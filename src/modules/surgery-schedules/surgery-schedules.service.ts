import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import { recalcularDerivados } from '../his/his.derivados';
import type {
  CreateSurgeryScheduleInput,
  ListSurgerySchedulesQuery,
  UpdateSurgeryScheduleInput,
} from './surgery-schedules.schemas';

export interface PublicSurgerySchedule {
  id: number;
  scheduleNumber: string;
  patientId: number;
  admissionId: number | null;
  procedureCode: string;
  executed: string;
}

export interface ListResult {
  items: PublicSurgerySchedule[];
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

/**
 * Recalcula `executed` de ESTA fila tras crearla o editarla. Sin ingreso
 * (`admissionId` null), `executed` es trivialmente 'desconocido' (B0): la UPDATE
 * de `recalcularDerivados` filtra `s."admissionId" = ANY(ids)`, que nunca casa
 * con NULL (Postgres: NULL no es igual a nada), asi que esa rama se escribe a
 * mano en vez de pasar un id inexistente al filtro SQL.
 */
async function recalcularEjecucion(tx: Prisma.TransactionClient, id: number, admissionId: number | null): Promise<void> {
  if (admissionId === null) {
    await tx.surgerySchedule.update({ where: { id }, data: { executed: 'desconocido' } });
    return;
  }
  await recalcularDerivados(tx, { admissionIds: [admissionId] });
}

export async function list(query: ListSurgerySchedulesQuery): Promise<ListResult> {
  const where: Prisma.SurgeryScheduleWhereInput = {};
  if (query.scheduleNumber) where.scheduleNumber = query.scheduleNumber;
  if (query.admissionId) where.admissionId = query.admissionId;
  if (query.procedureCode) where.procedureCode = query.procedureCode;
  if (query.executed) where.executed = query.executed;

  const items = await prisma.surgerySchedule.findMany({
    where,
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  return {
    items: pagina,
    limit: query.limit,
    nextCursor: hasNext ? String(pagina[pagina.length - 1]?.id ?? '') : null,
    hasNext,
  };
}

export async function getById(id: number): Promise<PublicSurgerySchedule> {
  const schedule = await prisma.surgerySchedule.findUnique({ where: { id } });
  if (!schedule) throw AppError.notFound('Programacion de cirugia');
  return schedule;
}

export async function create(
  input: CreateSurgeryScheduleInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicSurgerySchedule> {
  const creado = await prisma.$transaction(async (tx) => {
    // `executed` no se acepta en el POST (deriva de recalcularEjecucion, mas
    // abajo, en la misma transaccion): el placeholder nunca es visible fuera de ella.
    const fila = await tx.surgerySchedule.create({
      data: {
        scheduleNumber: input.scheduleNumber,
        patientId: input.patientId,
        admissionId: input.admissionId,
        procedureCode: input.procedureCode,
        executed: 'desconocido',
      },
    });

    await recalcularEjecucion(tx, fila.id, input.admissionId);

    await auditarEnTx(tx, {
      action: AUDIT.registroCreado,
      actorId,
      targetType: 'surgery-schedule',
      targetId: String(fila.id),
      metadata: { scheduleNumber: input.scheduleNumber, admissionId: input.admissionId },
      ...meta,
    });

    return tx.surgerySchedule.findUniqueOrThrow({ where: { id: fila.id } });
  });

  return creado;
}

export async function update(
  id: number,
  input: UpdateSurgeryScheduleInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicSurgerySchedule> {
  const actual = await prisma.surgerySchedule.findUnique({ where: { id } });
  if (!actual) throw AppError.notFound('Programacion de cirugia');

  const nuevoAdmissionId = input.admissionId !== undefined ? input.admissionId : actual.admissionId;

  const actualizado = await prisma.$transaction(async (tx) => {
    await tx.surgerySchedule.update({
      where: { id },
      data: {
        ...(input.scheduleNumber !== undefined ? { scheduleNumber: input.scheduleNumber } : {}),
        ...(input.patientId !== undefined ? { patientId: input.patientId } : {}),
        ...(input.admissionId !== undefined ? { admissionId: input.admissionId } : {}),
        ...(input.procedureCode !== undefined ? { procedureCode: input.procedureCode } : {}),
      },
    });

    // El nuevo admissionId y/o procedureCode pueden cambiar si es 'si'/'no'/'desconocido'.
    await recalcularEjecucion(tx, id, nuevoAdmissionId);

    await auditarEnTx(tx, {
      action: AUDIT.registroActualizado,
      actorId,
      targetType: 'surgery-schedule',
      targetId: String(id),
      metadata: { cambios: Object.keys(input) },
      ...meta,
    });

    return tx.surgerySchedule.findUniqueOrThrow({ where: { id } });
  });

  return actualizado;
}

/** Sin dependientes (ninguna otra tabla referencia `his_surgery_schedules`): un borrado nunca da 409. */
export async function remove(id: number, actorId: string, meta: RequestMeta): Promise<void> {
  const actual = await prisma.surgerySchedule.findUnique({ where: { id }, select: { id: true } });
  if (!actual) throw AppError.notFound('Programacion de cirugia');

  await prisma.$transaction(async (tx) => {
    await tx.surgerySchedule.delete({ where: { id } });
    await auditarEnTx(tx, {
      action: AUDIT.registroBorrado,
      actorId,
      targetType: 'surgery-schedule',
      targetId: String(id),
      metadata: {},
      ...meta,
    });
  });
}

import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import { recalcularDerivados } from '../his/his.derivados';
import type {
  CreateServiceRecordInput,
  ListServiceRecordsQuery,
  UpdateServiceRecordInput,
} from './service-records.schemas';

export interface PublicServiceRecord {
  id: number;
  admissionId: number;
  code: string;
  procedureName: string;
  quantity: number;
  providedAt: string;
  areaCode: string;
  area: string;
  specialty: string;
}

export interface ListResult {
  items: PublicServiceRecord[];
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

type ServiceRecordConProcedimiento = Prisma.ServiceRecordGetPayload<{ include: { procedure: true } }>;

function toPublic(record: ServiceRecordConProcedimiento): PublicServiceRecord {
  return {
    id: record.id,
    admissionId: record.admissionId,
    code: record.code,
    // `code` es FK NOT NULL con ON DELETE RESTRICT hacia his_procedures: el
    // procedimiento SIEMPRE existe (verificado con `\d his_service_records`).
    procedureName: record.procedure.name,
    quantity: record.quantity,
    providedAt: record.providedAt.toISOString(),
    areaCode: record.areaCode,
    area: record.area,
    specialty: record.specialty,
  };
}

const INCLUDE_PROCEDURE = { procedure: true } as const;

export async function list(query: ListServiceRecordsQuery): Promise<ListResult> {
  const where: Prisma.ServiceRecordWhereInput = {};
  if (query.admissionId) where.admissionId = query.admissionId;
  if (query.code) where.code = query.code;
  if (query.area) where.area = query.area;
  if (query.specialty) where.specialty = query.specialty;
  if (query.desde || query.hasta) {
    where.providedAt = {
      ...(query.desde ? { gte: query.desde } : {}),
      ...(query.hasta ? { lte: query.hasta } : {}),
    };
  }

  // take + 1 (sin COUNT): con 582k filas, contar el total en cada pagina
  // hundiria el listado (mismo razonamiento que users.service.list, A-13).
  const items = await prisma.serviceRecord.findMany({
    where,
    include: INCLUDE_PROCEDURE,
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  return {
    items: pagina.map(toPublic),
    limit: query.limit,
    nextCursor: hasNext ? String(pagina[pagina.length - 1]?.id ?? '') : null,
    hasNext,
  };
}

export async function getById(id: number): Promise<PublicServiceRecord> {
  const record = await prisma.serviceRecord.findUnique({ where: { id }, include: INCLUDE_PROCEDURE });
  if (!record) throw AppError.notFound('Registro de servicio');
  return toPublic(record);
}

/**
 * Da de alta el procedimiento en el catalogo si `code` es nuevo (TC3): dentro
 * de la MISMA transaccion que el alta del registro, para que un fallo a mitad
 * de camino no deje un procedimiento huerfano sin su servicio, ni viceversa.
 */
async function asegurarProcedimiento(
  tx: Prisma.TransactionClient,
  code: string,
  procedureName: string | undefined,
): Promise<void> {
  const existe = await tx.procedure.findUnique({ where: { code }, select: { code: true } });
  if (existe) return;
  if (!procedureName) {
    throw AppError.validation('El procedimiento no existe en el catalogo.', [
      { field: 'procedureName', message: 'Obligatorio para dar de alta un procedimiento nuevo.' },
    ]);
  }
  await tx.procedure.create({ data: { code, name: procedureName } });
}

export async function create(
  input: CreateServiceRecordInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicServiceRecord> {
  const existe = await prisma.serviceRecord.findUnique({ where: { id: input.id }, select: { id: true } });
  if (existe) throw AppError.conflict('Ya existe un registro de servicio con ese id.');

  const admission = await prisma.admission.findUnique({
    where: { id: input.admissionId },
    select: { id: true },
  });
  if (!admission) throw AppError.notFound('Ingreso');

  await prisma.$transaction(async (tx) => {
    await asegurarProcedimiento(tx, input.code, input.procedureName);

    await tx.serviceRecord.create({
      data: {
        id: input.id,
        admissionId: input.admissionId,
        code: input.code,
        quantity: input.quantity,
        providedAt: input.providedAt,
        areaCode: input.areaCode,
        area: input.area,
        specialty: input.specialty,
      },
    });

    // Un service-record nuevo puede mover lastActivityAt del ingreso y el
    // `executed` de sus cirugias (C0: "toda escritura recalcula los derivados
    // de los ingresos afectados").
    await recalcularDerivados(tx, { admissionIds: [input.admissionId] });

    await auditarEnTx(tx, {
      action: AUDIT.registroCreado,
      actorId,
      targetType: 'service-record',
      targetId: String(input.id),
      metadata: { admissionId: input.admissionId, code: input.code, quantity: input.quantity },
      ...meta,
    });
  });

  return getById(input.id);
}

export async function update(
  id: number,
  input: UpdateServiceRecordInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicServiceRecord> {
  const actual = await prisma.serviceRecord.findUnique({ where: { id } });
  if (!actual) throw AppError.notFound('Registro de servicio');

  await prisma.$transaction(async (tx) => {
    if (input.code) await asegurarProcedimiento(tx, input.code, input.procedureName);

    await tx.serviceRecord.update({
      where: { id },
      data: {
        ...(input.code ? { code: input.code } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.providedAt ? { providedAt: input.providedAt } : {}),
        ...(input.areaCode ? { areaCode: input.areaCode } : {}),
        ...(input.area ? { area: input.area } : {}),
        ...(input.specialty ? { specialty: input.specialty } : {}),
      },
    });

    // `code` o `providedAt` pueden cambiar lastActivityAt del ingreso y el
    // `executed` de sus cirugias (misma razon que en `create`).
    await recalcularDerivados(tx, { admissionIds: [actual.admissionId] });

    await auditarEnTx(tx, {
      action: AUDIT.registroActualizado,
      actorId,
      targetType: 'service-record',
      targetId: String(id),
      metadata: { admissionId: actual.admissionId, cambios: Object.keys(input) },
      ...meta,
    });
  });

  return getById(id);
}

export async function remove(id: number, actorId: string, meta: RequestMeta): Promise<void> {
  const actual = await prisma.serviceRecord.findUnique({ where: { id }, select: { id: true, admissionId: true } });
  if (!actual) throw AppError.notFound('Registro de servicio');

  await prisma.$transaction(async (tx) => {
    await tx.serviceRecord.delete({ where: { id } });

    // Borrar tambien puede bajar lastActivityAt del ingreso y cambiar el
    // `executed` de sus cirugias (si este era el unico registro que las
    // hacia verificables).
    await recalcularDerivados(tx, { admissionIds: [actual.admissionId] });

    await auditarEnTx(tx, {
      action: AUDIT.registroBorrado,
      actorId,
      targetType: 'service-record',
      targetId: String(id),
      metadata: { admissionId: actual.admissionId },
      ...meta,
    });
  });
}

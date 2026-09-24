import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import type { Actor } from '../../core/rbac/guards';
import { recalcularDerivados } from '../his/his.derivados';
import { toPublicTriage, type PublicTriage } from './triages.mapper';
import type { CreateTriageInput, ListTriagesQuery, UpdateTriageInput } from './triages.schemas';

export interface ListResult<T> {
  items: T[];
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

export async function list(query: ListTriagesQuery): Promise<ListResult<PublicTriage>> {
  const where: Prisma.TriageWhereInput = {};
  if (query.level !== undefined) where.level = query.level;
  if (query.patientId !== undefined) where.patientId = query.patientId;
  if (query.desde || query.hasta) {
    where.triagedAt = {};
    if (query.desde) where.triagedAt.gte = query.desde;
    if (query.hasta) where.triagedAt.lte = query.hasta;
  }

  const items = await prisma.triage.findMany({
    where,
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  return {
    items: pagina.map(toPublicTriage),
    limit: query.limit,
    nextCursor: hasNext ? String(pagina[pagina.length - 1]!.id) : null,
    hasNext,
  };
}

export async function getById(id: number): Promise<PublicTriage> {
  const triage = await prisma.triage.findUnique({ where: { id } });
  if (!triage) throw AppError.notFound('Triage');
  return toPublicTriage(triage);
}

/** Ingreso (si alguno) que hoy tiene `triageId = id`: 1:1 (Admission.triageId es @unique). */
async function admisionVinculada(tx: Prisma.TransactionClient, triageId: number): Promise<number | null> {
  const admision = await tx.admission.findFirst({ where: { triageId }, select: { id: true } });
  return admision?.id ?? null;
}

export async function create(input: CreateTriageInput, actor: Actor, meta: RequestMeta): Promise<PublicTriage> {
  const existente = await prisma.triage.findUnique({ where: { id: input.id }, select: { id: true } });
  if (existente) throw AppError.conflict(`Ya existe un triage con id ${input.id}.`);

  // Un triage recien creado todavia no lo referencia ningun ingreso (el
  // vinculo se hace desde `admissions` con `triageId`): no hay derivados que
  // recalcular aqui.
  const triage = await prisma.$transaction(async (tx) => {
    const creado = await tx.triage.create({ data: input });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroCreado,
      targetType: 'triage',
      // `auditLog.targetId` es UUID en BD: los ids del HIS son enteros, asi
      // que viajan solo en `metadata` (igual en el resto de este modulo).
      metadata: { id: input.id, campos: Object.keys(input) },
      ...meta,
    });
    return creado;
  });

  return toPublicTriage(triage);
}

export async function update(
  id: number,
  input: UpdateTriageInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicTriage> {
  const triage = await prisma.$transaction(async (tx) => {
    const actualizado = await tx.triage.update({ where: { id }, data: input });

    // `triagedAt`/`level` alimentan `triageLevel`/`waitMinutes` del ingreso
    // que lo tenga vinculado (si alguno): se recalcula SOLO ese ingreso.
    const admissionId = await admisionVinculada(tx, id);
    if (admissionId !== null) await recalcularDerivados(tx, { admissionIds: [admissionId] });

    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroActualizado,
      targetType: 'triage',
      metadata: { id, campos: Object.keys(input) },
      ...meta,
    });
    return actualizado;
  });

  return toPublicTriage(triage);
}

export async function remove(id: number, actor: Actor, meta: RequestMeta): Promise<void> {
  const existente = await prisma.triage.findUnique({ where: { id }, select: { id: true } });
  if (!existente) throw AppError.notFound('Triage');

  // `his_admissions_triageId_fkey` es ON DELETE SET NULL (permite borrar sin
  // error de FK), pero orfanaria en silencio `triageLevel`/`waitMinutes` del
  // ingreso (recalcularDerivados no los resetea si el JOIN deja de casar,
  // ver admissions.service.ts): se bloquea a nivel de aplicacion, igual que
  // el resto de los CRUD HIS ("dependientes -> 409").
  const ingresos = await prisma.admission.count({ where: { triageId: id } });
  if (ingresos > 0) {
    throw AppError.conflict(`No se puede borrar el triage: lo referencia ${ingresos} ingreso(s).`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.triage.delete({ where: { id } });
    await auditarEnTx(tx, {
      actorId: actor.id,
      action: AUDIT.registroBorrado,
      targetType: 'triage',
      metadata: { id },
      ...meta,
    });
  });
}

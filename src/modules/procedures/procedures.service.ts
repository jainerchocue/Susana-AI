import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import type { CreateProcedureInput, ListProceduresQuery, UpdateProcedureInput } from './procedures.schemas';

export interface PublicProcedure {
  code: string;
  name: string;
}

export interface ListResult {
  items: PublicProcedure[];
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

/**
 * Listado por cursor alfabetico sobre `code` (PK string): mismo patron de
 * `users.service.list` (take + 1 para saber si hay siguiente sin COUNT).
 */
export async function list(query: ListProceduresQuery): Promise<ListResult> {
  const items = await prisma.procedure.findMany({
    orderBy: { code: 'asc' },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { code: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  return {
    items: pagina,
    limit: query.limit,
    nextCursor: hasNext ? (pagina[pagina.length - 1]?.code ?? null) : null,
    hasNext,
  };
}

export async function getByCode(code: string): Promise<PublicProcedure> {
  const procedure = await prisma.procedure.findUnique({ where: { code } });
  if (!procedure) throw AppError.notFound('Procedimiento');
  return procedure;
}

export async function create(
  input: CreateProcedureInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicProcedure> {
  const existe = await prisma.procedure.findUnique({ where: { code: input.code }, select: { code: true } });
  if (existe) throw AppError.conflict('Ya existe un procedimiento con ese codigo.');

  return prisma.$transaction(async (tx) => {
    const creado = await tx.procedure.create({ data: input });
    // `targetId` es @db.Uuid en AuditLog (C0): el codigo (clave natural,
    // string) no encaja ahi, asi que va en `metadata`.
    await auditarEnTx(tx, {
      action: AUDIT.registroCreado,
      actorId,
      targetType: 'procedure',
      metadata: { code: creado.code },
      ...meta,
    });
    return creado;
  });
}

export async function update(
  code: string,
  input: UpdateProcedureInput,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicProcedure> {
  const existe = await prisma.procedure.findUnique({ where: { code }, select: { code: true } });
  if (!existe) throw AppError.notFound('Procedimiento');

  return prisma.$transaction(async (tx) => {
    const actualizado = await tx.procedure.update({ where: { code }, data: input });
    await auditarEnTx(tx, {
      action: AUDIT.registroActualizado,
      actorId,
      targetType: 'procedure',
      metadata: { code, cambios: Object.keys(input) },
      ...meta,
    });
    return actualizado;
  });
}

/**
 * Borrado. `his_service_records.code` referencia `his_procedures.code` con
 * `ON DELETE RESTRICT` (verificado con `\d his_service_records`): sin este
 * chequeo previo, Postgres lanzaria una violacion de FK que el error handler
 * traduce a 400 (P2003, "Referencia invalida"), no al 409 con motivo que pide
 * la especificacion (CLAUDE.md §6, mismo patron que `roles.service.remove`).
 */
export async function remove(code: string, actorId: string, meta: RequestMeta): Promise<void> {
  const existe = await prisma.procedure.findUnique({ where: { code }, select: { code: true } });
  if (!existe) throw AppError.notFound('Procedimiento');

  const dependientes = await prisma.serviceRecord.count({ where: { code } });
  if (dependientes > 0) {
    throw AppError.conflict(
      `El procedimiento tiene ${dependientes} registro(s) de servicio asociado(s). Borralos antes de eliminarlo.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.procedure.delete({ where: { code } });
    await auditarEnTx(tx, {
      action: AUDIT.registroBorrado,
      actorId,
      targetType: 'procedure',
      metadata: { code },
      ...meta,
    });
  });
}

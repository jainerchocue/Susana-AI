import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import type { ListAuditQuery } from './audit.schemas';

const SELECT_PUBLICO = {
  id: true,
  action: true,
  actorId: true,
  actorEmail: true,
  targetType: true,
  targetId: true,
  metadata: true,
  ip: true,
  requestId: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export interface PublicAuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.JsonValue;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

/**
 * Consulta del rastro de auditoria. Solo lectura: la tabla es append-only y la
 * migracion instala un trigger que rechaza UPDATE y DELETE.
 *
 * `userAgent` NO se expone: es huella de dispositivo y no aporta nada al panel.
 */
export async function list(query: ListAuditQuery): Promise<{
  items: PublicAuditEntry[];
  limit: number;
  hasNext: boolean;
  nextCursor: string | null;
}> {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.actorId) where.actorId = query.actorId;
  if (query.targetId) where.targetId = query.targetId;
  if (query.action) where.action = { startsWith: query.action };
  if (query.desde || query.hasta) {
    where.createdAt = { ...(query.desde && { gte: query.desde }), ...(query.hasta && { lte: query.hasta }) };
  }

  const filas = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: SELECT_PUBLICO,
  });

  const hasNext = filas.length > query.limit;
  const pagina = hasNext ? filas.slice(0, query.limit) : filas;

  return {
    items: pagina.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
    limit: query.limit,
    hasNext,
    nextCursor: hasNext ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

/** Detalle de una fila del rastro (TC5). Un id inexistente responde 404, como cualquier otro recurso. */
export async function getById(id: string): Promise<PublicAuditEntry> {
  const fila = await prisma.auditLog.findUnique({ where: { id }, select: SELECT_PUBLICO });
  if (!fila) throw AppError.notFound('Registro de auditoria');
  return { ...fila, createdAt: fila.createdAt.toISOString() };
}

import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { AppError } from '../../core/http/errors';
import { assertPuedeAsignarPermisos, type Actor } from '../../core/rbac/guards';
import { invalidarRbacDeUsuarios } from '../../core/rbac/rbac-cache';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import type { CreateRoleInput, ListRolesQuery, UpdateRoleInput } from './roles.schemas';

export interface PublicRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  usersCount: number;
  createdAt: string;
}

const roleInclude = {
  permissions: { select: { permission: { select: { action: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

type RoleWithRelations = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toPublicRole(role: RoleWithRelations): PublicRole {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((p) => p.permission.action).sort(),
    usersCount: role._count.users,
    createdAt: role.createdAt.toISOString(),
  };
}

async function resolvePermissionIds(actions: string[]): Promise<string[]> {
  if (actions.length === 0) return [];
  const unique = [...new Set(actions)];
  const found = await prisma.permission.findMany({
    where: { action: { in: unique } },
    select: { id: true, action: true },
  });

  const faltantes = unique.filter((a) => !found.some((p) => p.action === a));
  if (faltantes.length > 0) {
    throw AppError.badRequest(
      `Permisos inexistentes: ${faltantes.join(', ')}. Deben estar en el catalogo (core/rbac/permissions.ts) y sembrados.`,
    );
  }
  return found.map((p) => p.id);
}

async function getRole(id: string): Promise<RoleWithRelations> {
  const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  if (!role) throw AppError.notFound('Rol');
  return role;
}

/** Portadores del rol: hay que invalidarles la cache al cambiar sus permisos. */
async function usuariosDelRol(roleId: string): Promise<string[]> {
  const filas = await prisma.userRole.findMany({ where: { roleId }, select: { userId: true } });
  return filas.map((f) => f.userId);
}

export async function list(query: ListRolesQuery) {
  const where: Prisma.RoleWhereInput = query.search
    ? { name: { contains: query.search, mode: 'insensitive' } }
    : {};

  const [items, total] = await prisma.$transaction([
    prisma.role.findMany({
      where,
      include: roleInclude,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.role.count({ where }),
  ]);

  return { items: items.map(toPublicRole), total, page: query.page, limit: query.limit, hasNext: query.page * query.limit < total, nextCursor: null };
}

export async function getById(id: string): Promise<PublicRole> {
  return toPublicRole(await getRole(id));
}

export async function create(input: CreateRoleInput, actor: Actor, meta: RequestMeta): Promise<PublicRole> {
  const exists = await prisma.role.findUnique({ where: { name: input.name }, select: { id: true } });
  if (exists) throw AppError.conflict('Ya existe un rol con ese nombre.');

  // Crear un rol con permisos es conceder autoridad: misma guarda que editarlos.
  assertPuedeAsignarPermisos(actor, { id: '__nuevo__', name: input.name, isSystem: false }, input.permissions);

  const permissionIds = await resolvePermissionIds(input.permissions);

  const role = await prisma.$transaction(async (tx) => {
    const creado = await tx.role.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
    await auditarEnTx(tx, {
      action: AUDIT.rolCreado,
      actorId: actor.id,
      targetType: 'role',
      targetId: creado.id,
      metadata: { name: input.name, permissions: input.permissions },
      ...meta,
    });
    return creado;
  });

  return toPublicRole(role);
}

export async function update(
  id: string,
  input: UpdateRoleInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicRole> {
  const role = await getRole(id);
  // Renombrar un rol de sistema rompe el codigo que lo referencia por nombre.
  if (role.isSystem) {
    throw AppError.forbidden('Un rol de sistema no se modifica por API: su definicion vive en el codigo.');
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const r = await tx.role.update({ where: { id }, data: input, include: roleInclude });
    await auditarEnTx(tx, {
      action: AUDIT.rolActualizado,
      actorId: actor.id,
      targetType: 'role',
      targetId: id,
      metadata: { cambios: Object.keys(input) },
      ...meta,
    });
    return r;
  });

  return toPublicRole(actualizado);
}

/**
 * Borra un rol vacio.
 *
 * La guarda de permisos tambien aplica al borrado: sin ella, quien tuviera
 * `roles:delete` podia destruir un rol con permisos por encima de los suyos
 * (mientras no tuviera portadores). No es escalada, pero si destruccion de
 * autoridad que el actor no habria podido crear.
 */
export async function remove(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  const role = await getRole(id);
  if (role.isSystem) throw AppError.forbidden('No se puede eliminar un rol de sistema.');
  assertPuedeAsignarPermisos(
    actor,
    { id: role.id, name: role.name, isSystem: false },
    role.permissions.map((p) => p.permission.action),
  );
  if (role._count.users > 0) {
    throw AppError.conflict(
      `El rol tiene ${role._count.users} usuario(s) asignado(s). Reasignalos antes de eliminarlo.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id } });
    await auditarEnTx(tx, {
      action: AUDIT.rolBorrado,
      actorId: actor.id,
      targetType: 'role',
      targetId: id,
      metadata: { name: role.name },
      ...meta,
    });
  });
}

/**
 * Reemplaza el set de permisos de un rol.
 *
 * `assertPuedeAsignarPermisos` cierra la escalada C-02: prohibe el comodin por
 * API, blinda los roles de sistema, impide tocar un rol propio y exige que todo
 * permiso concedido este ya en manos del actor.
 */
export async function setPermissions(
  id: string,
  actions: string[],
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicRole> {
  const role = await getRole(id);
  assertPuedeAsignarPermisos(actor, role, actions);

  const permissionIds = await resolvePermissionIds(actions);
  const afectados = await usuariosDelRol(id);

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      });
    }
    await auditarEnTx(tx, {
      action: AUDIT.permisosAsignados,
      actorId: actor.id,
      targetType: 'role',
      targetId: id,
      metadata: { permissions: actions, usuariosAfectados: afectados.length },
      ...meta,
    });
  });

  // Sin esto, los permisos revocados siguen vivos hasta que expire la cache.
  await invalidarRbacDeUsuarios(afectados);

  return getById(id);
}

import type { Prisma } from '@prisma/client';
import { UserStatus } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { auth } from '../../core/auth/auth';
import { AppError } from '../../core/http/errors';
import { assertPuedeAdministrarUsuario, assertPuedeAsignarRoles, type Actor } from '../../core/rbac/guards';
import { invalidarRbac } from '../../core/rbac/rbac-cache';
import { AUDIT, auditarEnTx, type RequestMeta } from '../../core/audit/audit';
import { toPublicUser, userWithRolesInclude, type PublicUser } from './users.mapper';
import type { CreateUserInput, ListUsersQuery, UpdateMeInput, UpdateUserInput } from './users.schemas';

export interface ListResult {
  items: PublicUser[];
  total?: number;
  page?: number;
  limit: number;
  nextCursor: string | null;
  hasNext: boolean;
}

async function resolveRoleIds(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const unique = [...new Set(names)];
  const roles = await prisma.role.findMany({ where: { name: { in: unique } }, select: { id: true, name: true } });

  const faltantes = unique.filter((n) => !roles.some((r) => r.name === n));
  if (faltantes.length > 0) throw AppError.badRequest(`Roles inexistentes: ${faltantes.join(', ')}.`);
  return roles.map((r) => r.id);
}

/**
 * Listado.
 *
 * La busqueda usa los indices GIN de trigramas creados en la migracion: sin
 * ellos, `ILIKE '%x%'` fuerza un Seq Scan de toda la tabla (auditoria C-06).
 * La paginacion por cursor evita el OFFSET, que degrada linealmente (A-13).
 */
export async function list(query: ListUsersQuery): Promise<ListResult> {
  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (query.status) where.status = query.status;
  if (query.role) where.roles = { some: { role: { name: query.role } } };
  if (query.search) {
    const term = query.search;
    where.OR = [
      { email: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
    ];
  }

  const orden: Prisma.UserOrderByWithRelationInput[] = [
    { createdAt: query.sortDir },
    // Desempate estable: sin el, dos filas con el mismo createdAt pueden
    // repetirse o saltarse entre paginas.
    { id: query.sortDir },
  ];

  // take + 1 para saber si hay siguiente sin contar la tabla entera.
  const items = await prisma.user.findMany({
    where,
    include: userWithRolesInclude,
    orderBy: orden,
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    ...(query.page && !query.cursor ? { skip: (query.page - 1) * query.limit } : {}),
  });

  const hasNext = items.length > query.limit;
  const pagina = hasNext ? items.slice(0, query.limit) : items;

  // El conteo exacto solo se calcula en modo pagina (paneles internos con
  // pocos registros). En modo cursor se devuelve hasNext, que es O(1).
  const total = query.page ? await prisma.user.count({ where }) : undefined;

  return {
    items: pagina.map(toPublicUser),
    total,
    page: query.page,
    limit: query.limit,
    nextCursor: hasNext ? (pagina[pagina.length - 1]?.id ?? null) : null,
    hasNext,
  };
}

export async function getById(id: string): Promise<PublicUser> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: userWithRolesInclude });
  if (!user) throw AppError.notFound('Usuario');
  return toPublicUser(user);
}

/**
 * Alta administrativa.
 *
 * Pasa por `auth.api.signUpEmail` en vez de escribir el usuario a mano: la
 * contraseña vive en `Account.password` y solo Better Auth sabe como hashearla
 * y guardarla con el formato que luego sabra verificar.
 */
export async function create(input: CreateUserInput, actor: Actor, meta: RequestMeta): Promise<PublicUser> {
  // Crear un usuario con roles es conceder autoridad: pasa por la misma guarda.
  if (input.roles.length > 0) {
    await assertPuedeAsignarRoles(actor, '__nuevo__', input.roles);
  }

  const exists = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw AppError.conflict('Ya existe un usuario con ese correo.');

  const roleIds = await resolveRoleIds(input.roles);

  const alta = await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name },
  });

  const userId = alta.user.id;

  // signUpEmail abre sesion para el usuario creado. Aqui no la quiere nadie:
  // el alta la hace un administrador, no el titular de la cuenta.
  await prisma.session.deleteMany({ where: { userId } });

  await prisma.$transaction(async (tx) => {
    if (roleIds.length > 0) {
      // El hook de Better Auth ya asigno el rol por defecto: se reemplaza.
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId, assignedBy: actor.id })),
        skipDuplicates: true,
      });
    }
    await auditarEnTx(tx, {
      action: AUDIT.usuarioCreado,
      actorId: actor.id,
      targetType: 'user',
      targetId: userId,
      metadata: { email: input.email, roles: input.roles },
      ...meta,
    });
  });

  await invalidarRbac(userId);
  return getById(userId);
}

/** Edicion administrativa: puede tocar `status`. */
export async function update(
  id: string,
  input: UpdateUserInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicUser> {
  await assertPuedeAdministrarUsuario(actor, id);

  const user = await prisma.$transaction(async (tx) => {
    const actualizado = await tx.user.update({ where: { id }, data: input, include: userWithRolesInclude });
    // Suspender debe cortar el acceso ya, no cuando caduque la sesion.
    if (input.status && input.status !== UserStatus.ACTIVE) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    await auditarEnTx(tx, {
      action: AUDIT.usuarioActualizado,
      actorId: actor.id,
      targetType: 'user',
      targetId: id,
      metadata: { cambios: Object.keys(input) },
      ...meta,
    });
    return actualizado;
  });

  await invalidarRbac(id);
  return toPublicUser(user);
}

/** Edicion del propio perfil: nunca toca campos administrativos. */
export async function updateMe(id: string, input: UpdateMeInput): Promise<PublicUser> {
  const user = await prisma.user.update({ where: { id }, data: input, include: userWithRolesInclude });
  return toPublicUser(user);
}

/**
 * Borrado logico + desvinculacion de credenciales y proveedores.
 *
 * Sin borrar las filas de `accounts`, el UNIQUE (providerId, accountId)
 * impediria para siempre que ese correo volviera a registrarse (auditoria A-04).
 */
export async function remove(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await assertPuedeAdministrarUsuario(actor, id);

  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, email: true } });
  if (!user) throw AppError.notFound('Usuario');

  await prisma.$transaction(async (tx) => {
    // El rastro se escribe ANTES de pisar el correo: auditarEnTx congela
    // actorEmail leyendo de la BD, y el objetivo puede ser el propio actor.
    await auditarEnTx(tx, {
      action: AUDIT.usuarioBorrado,
      actorId: actor.id,
      targetType: 'user',
      targetId: id,
      // El correo original queda en el rastro, que es append-only.
      metadata: { emailOriginal: user.email },
      ...meta,
    });
    await tx.user.update({
      where: { id },
      data: { status: UserStatus.DELETED, deletedAt: new Date(), email: `deleted+${id}@invalid.local` },
    });
    await tx.account.deleteMany({ where: { userId: id } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.twoFactor.deleteMany({ where: { userId: id } });
  });

  await invalidarRbac(id);
}

/**
 * Reemplaza el set de roles.
 *
 * DOS guardas, y las dos son necesarias:
 *
 *  - `assertPuedeAsignarRoles` cierra la escalada C-01: nadie concede permisos
 *    que no posee, ni edita sus propios roles.
 *  - `assertPuedeAdministrarUsuario` cierra el sentido contrario, que faltaba:
 *    sin ella, un actor con solo `users:assign-roles` podia mandar `roles: []`
 *    contra el superadmin y dejarlo sin autoridad ni sesiones. El superset
 *    check no lo frenaba porque un set vacio no concede nada, asi que pasaba
 *    trivialmente. Verificado: devolvia 200 y el objetivo quedaba en 0 roles.
 */
export async function setRoles(
  id: string,
  roleNames: string[],
  actor: Actor,
  meta: RequestMeta,
): Promise<PublicUser> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!user) throw AppError.notFound('Usuario');

  // El ORDEN importa para el codigo de estado: `assertPuedeAsignarRoles` trata
  // la auto-edicion como 403 con su mensaje propio, mientras que
  // `assertPuedeAdministrarUsuario` la trata como 400. Al reves, el 400
  // enmascararia el motivo real ("no puedes tocar tus propios roles").
  await assertPuedeAsignarRoles(actor, id, roleNames);
  await assertPuedeAdministrarUsuario(actor, id);
  const roleIds = await resolveRoleIds(roleNames);

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: id } });
    if (roleIds.length > 0) {
      await tx.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: id, roleId, assignedBy: actor.id })),
        skipDuplicates: true,
      });
    }
    await auditarEnTx(tx, {
      action: AUDIT.rolesAsignados,
      actorId: actor.id,
      targetType: 'user',
      targetId: id,
      metadata: { roles: roleNames },
      ...meta,
    });
  });

  // Cambiar la autoridad invalida la cache y obliga a re-autenticar.
  await invalidarRbac(id);
  await prisma.session.deleteMany({ where: { userId: id } });

  return getById(id);
}

import type { Request } from 'express';
import { prisma } from '../db/prisma';
import { AppError } from '../http/errors';
import { WILDCARD_PERMISSION } from './permissions';

/**
 * INVARIANTE DE NO-ESCALADA.
 *
 * Nadie puede conceder autoridad que no posee, ni ampliarse la suya propia.
 * Sin esto, "poder asignar roles" equivale a "ser superadministrador": es
 * exactamente la escalada vertical C-01/C-02 de la auditoria.
 *
 * Es el mismo modelo que el verbo `escalate` del RBAC de Kubernetes y que
 * los PermissionsBoundary de AWS IAM.
 */

export interface Actor {
  id: string;
  roles: string[];
  permissions: Set<string>;
}

/**
 * Construye el `Actor` desde `req.auth` (ya rellenado por `authenticate`).
 * Estaba duplicado, con el mismo cuerpo, en los controladores de users/roles/
 * assistant: vive aqui una sola vez, junto al tipo que describe (B-01).
 */
export function actor(req: Request): Actor {
  return { id: req.auth!.id, roles: req.auth!.roles, permissions: req.auth!.permissions };
}

function esSuperadmin(actor: Actor): boolean {
  return actor.permissions.has(WILDCARD_PERMISSION);
}

/** Permisos efectivos que otorga un conjunto de roles. */
async function permisosDeRoles(nombres: string[]): Promise<Map<string, string[]>> {
  if (nombres.length === 0) return new Map();
  const roles = await prisma.role.findMany({
    where: { name: { in: [...new Set(nombres)] } },
    select: { name: true, permissions: { select: { permission: { select: { action: true } } } } },
  });
  return new Map(roles.map((r) => [r.name, r.permissions.map((p) => p.permission.action)]));
}

/**
 * ¿Puede el actor dejar a `targetUserId` con exactamente estos roles?
 *
 * Reglas:
 *  1. Nadie edita sus propios roles (ni el superadmin: obliga a cuatro ojos).
 *  2. Todo permiso que los roles otorguen debe estar ya en manos del actor.
 */
export async function assertPuedeAsignarRoles(
  actor: Actor,
  targetUserId: string,
  rolesDestino: string[],
): Promise<void> {
  if (actor.id === targetUserId) {
    throw AppError.forbidden(
      'No puedes modificar tus propios roles. Pideselo a otro administrador.',
    );
  }

  if (esSuperadmin(actor)) return;

  const mapa = await permisosDeRoles(rolesDestino);
  const excedidos = new Set<string>();
  for (const acciones of mapa.values()) {
    for (const accion of acciones) {
      if (!actor.permissions.has(accion)) excedidos.add(accion);
    }
  }

  if (excedidos.size > 0) {
    throw AppError.forbidden(
      `No puedes conceder permisos que no posees: ${[...excedidos].sort().join(', ')}.`,
    );
  }
}

/**
 * ¿Puede el actor dejar al rol `rol` con exactamente estos permisos?
 *
 * Reglas:
 *  1. El comodin nunca se concede por API (solo por seed, con acceso al servidor).
 *  2. Los roles de sistema son inmutables: su definicion vive en el codigo.
 *  3. No se toca un rol que el propio actor ostenta (auto-elevacion indirecta).
 *  4. Todo permiso concedido debe estar ya en manos del actor.
 */
export function assertPuedeAsignarPermisos(
  actor: Actor,
  rol: { id: string; name: string; isSystem: boolean },
  permisosDestino: string[],
): void {
  if (permisosDestino.includes(WILDCARD_PERMISSION)) {
    throw AppError.forbidden(
      'El permiso comodin "*" solo puede asignarse desde el seed, nunca por API.',
    );
  }

  if (rol.isSystem) {
    throw AppError.forbidden(
      'Los permisos de un rol de sistema se definen en core/rbac/permissions.ts y se aplican con `npm run db:seed`.',
    );
  }

  if (esSuperadmin(actor)) return;

  if (actor.roles.includes(rol.name)) {
    throw AppError.forbidden('No puedes modificar los permisos de un rol que tu mismo tienes.');
  }

  const excedidos = permisosDestino.filter((p) => !actor.permissions.has(p));
  if (excedidos.length > 0) {
    throw AppError.forbidden(
      `No puedes conceder permisos que no posees: ${[...new Set(excedidos)].sort().join(', ')}.`,
    );
  }
}

/**
 * ¿Puede el actor administrar a este usuario?
 * Impide que un administrador de rango medio suspenda o borre a uno superior.
 */
export async function assertPuedeAdministrarUsuario(
  actor: Actor,
  targetUserId: string,
): Promise<void> {
  if (actor.id === targetUserId) {
    throw AppError.badRequest('No puedes aplicarte esta operacion a ti mismo.');
  }
  if (esSuperadmin(actor)) return;

  const objetivo = await prisma.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: { roles: { select: { role: { select: { permissions: { select: { permission: { select: { action: true } } } } } } } } },
  });
  if (!objetivo) throw AppError.notFound('Usuario');

  const suyos = new Set<string>();
  for (const { role } of objetivo.roles) {
    for (const { permission } of role.permissions) suyos.add(permission.action);
  }

  const superiores = [...suyos].filter((p) => !actor.permissions.has(p));
  if (superiores.length > 0) {
    throw AppError.forbidden(
      'No puedes administrar a un usuario con mas privilegios que tu.',
    );
  }
}

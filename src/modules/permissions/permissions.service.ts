import { prisma } from '../../core/db/prisma';
import { WILDCARD_PERMISSION } from '../../core/rbac/permissions';

export interface PermissionGroup {
  group: string;
  permissions: { id: string; action: string; group: string; description: string | null }[];
}

/**
 * Catalogo agrupado, para construir la pantalla de roles.
 * Solo lectura: los permisos se declaran en core/rbac/permissions.ts y se
 * siembran; nunca se crean por API.
 *
 * El comodin `*` vive en la tabla `Permission` (el seed lo inserta para poder
 * enlazarlo a SUPER_ADMIN via `RolePermission`), pero no es un permiso
 * asignable por API: se excluye aqui para que el catalogo devuelto coincida
 * exactamente con `PERMISSION_LIST`.
 */
export async function listarAgrupados(): Promise<{ total: number; groups: PermissionGroup[] }> {
  const permissions = await prisma.permission.findMany({
    where: { action: { not: WILDCARD_PERMISSION } },
    orderBy: [{ group: 'asc' }, { action: 'asc' }],
    select: { id: true, action: true, group: true, description: true },
  });

  const groups = new Map<string, PermissionGroup['permissions']>();
  for (const permission of permissions) {
    const bucket = groups.get(permission.group) ?? [];
    bucket.push(permission);
    groups.set(permission.group, bucket);
  }

  return {
    total: permissions.length,
    groups: [...groups].map(([group, items]) => ({ group, permissions: items })),
  };
}

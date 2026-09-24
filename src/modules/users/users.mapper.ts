import type { User, UserStatus } from '@prisma/client';

/**
 * Forma publica de un usuario. Es el UNICO objeto de usuario que sale de la
 * API: garantiza que los campos internos nunca se filtren.
 *
 * El hash de la contraseña ya no vive en User (Better Auth lo guarda en
 * `Account.password`), pero el mapper sigue siendo obligatorio: `status`,
 * `deletedAt` y los campos de sesion tampoco deben salir sin querer.
 */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  status: UserStatus;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  roles: string[];
  permissions: string[];
  createdAt: string;
}

type UserWithRoles = User & {
  roles?: {
    role: { name: string; permissions?: { permission: { action: string } }[] };
  }[];
};

export function toPublicUser(user: UserWithRoles): PublicUser {
  const roles: string[] = [];
  const permissions = new Set<string>();

  for (const link of user.roles ?? []) {
    roles.push(link.role.name);
    for (const p of link.role.permissions ?? []) permissions.add(p.permission.action);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    status: user.status,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    roles,
    permissions: [...permissions].sort(),
    createdAt: user.createdAt.toISOString(),
  };
}

/** Include estandar para traer roles + permisos de un usuario. */
export const userWithRolesInclude = {
  roles: {
    select: {
      role: {
        select: {
          name: true,
          permissions: { select: { permission: { select: { action: true } } } },
        },
      },
    },
  },
} as const;

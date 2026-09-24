import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserStatus } from '@prisma/client';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth/auth';
import { prisma } from '../db/prisma';
import { AppError } from '../http/errors';
import { ErrorCode } from '../http/http-status';
import { env } from '../../config/env';
import { guardarRbac, leerRbac } from '../rbac/rbac-cache';

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  status: UserStatus;
  sessionId: string;
  roles: string[];
  /** Permisos efectivos, ya aplanados desde todos sus roles. */
  permissions: Set<string>;
}

/**
 * Permisos efectivos del usuario. Better Auth resuelve la identidad; el RBAC
 * es nuestro y no lo conoce, asi que se carga aparte.
 *
 * La cache por version hace que invalidar sea O(1): la entrada vieja deja de
 * ser direccionable en vez de recorrerse (auditoria A-05).
 */
async function cargarRbac(userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  const cacheado = await leerRbac(userId);
  if (cacheado) return { roles: cacheado.roles, permissions: cacheado.permissions };

  const filas = await prisma.userRole.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          name: true,
          permissions: { select: { permission: { select: { action: true } } } },
        },
      },
    },
  });

  const roles: string[] = [];
  const setPermisos = new Set<string>();
  for (const { role } of filas) {
    roles.push(role.name);
    for (const { permission } of role.permissions) setPermisos.add(permission.action);
  }

  const snapshot = { roles, permissions: [...setPermisos] };
  await guardarRbac(userId, snapshot);
  return snapshot;
}

/**
 * Exige una sesion viva de Better Auth (cookie o `Authorization: Bearer`).
 *
 * El estado de la cuenta se revalida en CADA peticion contra la BD: suspender a
 * alguien debe cortarle el acceso ya, no cuando caduque su sesion.
 *
 * `disableCookieCache: true` fuerza a que CADA peticion consulte la tabla
 * `sessions` en vez de confiar en la cookie firmada (`SESSION_COOKIE_CACHE_SECONDS`).
 * Sin esto, una cookie capturada antes de un logout o de una revocacion
 * seguia autenticando hasta `SESSION_COOKIE_CACHE_SECONDS` segundos despues
 * (verificado en tests/e2e/auth.e2e.test.ts, describe "logout"): la
 * revalidacion de `status`/`deletedAt` de mas abajo no cubre ese hueco porque
 * la sesion ni siquiera llegaba a mirarse contra la BD.
 *
 * Trade-off deliberado: una consulta extra a la BD por peticion autenticada
 * (la que ya hacemos para `status`/`deletedAt` de todos modos toca la BD, asi
 * que el coste marginal es solo el `SELECT` de `sessions` que antes evitaba
 * la cache) a cambio de revocacion inmediata. En este proyecto, "cerrar
 * sesion corta en el acto" pesa mas que ahorrarse esa consulta.
 */
export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const sesion = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true },
    });
    if (!sesion) throw AppError.unauthorized('La sesion no es valida.', ErrorCode.TOKEN_INVALID);

    const user = await prisma.user.findUnique({
      where: { id: sesion.user.id },
      select: { id: true, email: true, emailVerified: true, status: true, deletedAt: true },
    });

    if (!user || user.deletedAt !== null || user.status === UserStatus.DELETED) {
      throw AppError.unauthorized('La sesion ya no es valida.', ErrorCode.TOKEN_INVALID);
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw AppError.forbidden('Cuenta suspendida.', ErrorCode.ACCOUNT_SUSPENDED);
    }

    const { roles, permissions } = await cargarRbac(user.id);

    req.auth = {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      status: user.status,
      sessionId: sesion.session.id,
      roles,
      permissions: new Set(permissions),
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** Bloquea si el correo no esta verificado (segun REQUIRE_VERIFIED_EMAIL). */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!env.REQUIRE_VERIFIED_EMAIL) return next();
  if (!req.auth) return next(AppError.unauthorized());
  if (!req.auth.emailVerified) {
    return next(
      AppError.forbidden('Debes verificar tu correo antes de continuar.', ErrorCode.EMAIL_NOT_VERIFIED),
    );
  }
  next();
};

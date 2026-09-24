import type { RequestHandler } from 'express';
import { AppError } from '../http/errors';
import { ErrorCode } from '../http/http-status';
import { WILDCARD_PERMISSION } from '../rbac/permissions';

type Mode = 'all' | 'any';

interface Options {
  /** 'all' (por defecto) exige todos; 'any' exige al menos uno. */
  mode?: Mode;
}

function assertAuthenticated(auth: unknown): asserts auth {
  if (!auth) throw AppError.unauthorized('Debes iniciar sesion.');
}

/**
 * Exige permisos concretos. El comodin "*" pasa cualquier chequeo.
 *
 *   router.get('/', authenticate, requirePermissions(PERMISSIONS.users.read), handler)
 *   router.post('/', authenticate, requirePermissions([A, B], { mode: 'any' }), handler)
 */
export function requirePermissions(
  required: string | string[],
  options: Options = {},
): RequestHandler {
  const list = Array.isArray(required) ? required : [required];
  const mode: Mode = options.mode ?? 'all';

  if (list.length === 0) {
    throw new Error('requirePermissions() necesita al menos un permiso.');
  }

  return (req, _res, next) => {
    try {
      assertAuthenticated(req.auth);
      const granted = req.auth.permissions;

      if (granted.has(WILDCARD_PERMISSION)) return next();

      const has = (p: string) => granted.has(p);
      const allowed = mode === 'all' ? list.every(has) : list.some(has);
      if (allowed) return next();

      const faltantes = mode === 'all' ? list.filter((p) => !has(p)) : list;
      return next(
        AppError.forbidden(
          `Permisos insuficientes. Requiere ${mode === 'all' ? 'todos' : 'alguno'} de: ${faltantes.join(', ')}.`,
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        ),
      );
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Exige roles concretos. Preferir requirePermissions: los roles cambian, los
 * permisos son el contrato real. Usar esto solo para puertas gruesas.
 */
export function requireRoles(required: string | string[], options: Options = {}): RequestHandler {
  const list = Array.isArray(required) ? required : [required];
  const mode: Mode = options.mode ?? 'any';

  return (req, _res, next) => {
    try {
      assertAuthenticated(req.auth);
      const roles = new Set(req.auth.roles);
      const has = (r: string) => roles.has(r);
      const allowed = mode === 'all' ? list.every(has) : list.some(has);
      if (allowed) return next();

      return next(
        AppError.forbidden(
          `Requiere el rol: ${list.join(mode === 'all' ? ' y ' : ' o ')}.`,
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        ),
      );
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Deja pasar si el usuario tiene el permiso O si es dueño del recurso.
 * `getOwnerId` recibe la request y devuelve el id del dueño.
 *
 *   requireOwnershipOr(PERMISSIONS.users.update, (req) => req.params.id)
 */
export function requireOwnershipOr(
  permission: string,
  getOwnerId: (req: Parameters<RequestHandler>[0]) => string | undefined | Promise<string | undefined>,
): RequestHandler {
  return async (req, _res, next) => {
    try {
      assertAuthenticated(req.auth);
      const auth = req.auth;

      if (auth.permissions.has(WILDCARD_PERMISSION) || auth.permissions.has(permission)) {
        next(); return;
      }

      const ownerId = await getOwnerId(req);
      if (ownerId && ownerId === auth.id) return next();

      return next(
        AppError.forbidden(
          'Solo puedes operar sobre tus propios recursos.',
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        ),
      );
    } catch (error) {
      return next(error);
    }
  };
}

import { cache } from '../cache/redis';
import { env } from '../../config/env';

/**
 * Cache de permisos efectivos con invalidacion por VERSION.
 *
 * La clave incluye un contador que se incrementa al tocar los roles del
 * usuario. Invalidar es O(1) y no requiere recorrer claves ni mantener indices
 * inversos: la entrada vieja simplemente deja de ser direccionable y caduca sola.
 */

export interface RbacSnapshot {
  roles: string[];
  permissions: string[];
}

function claveVersion(userId: string): string {
  return `rbac:v:${userId}`;
}

async function versionDe(userId: string): Promise<string> {
  return (await cache.get(claveVersion(userId))) ?? '0';
}

export async function leerRbac(userId: string): Promise<RbacSnapshot | null> {
  if (env.RBAC_CACHE_TTL_SECONDS === 0) return null;
  const bruto = await cache.get(`rbac:u:${userId}:${await versionDe(userId)}`);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as RbacSnapshot;
  } catch {
    // Entrada corrupta (cambio de formato entre versiones): se ignora y se recalcula.
    return null;
  }
}

export async function guardarRbac(userId: string, snapshot: RbacSnapshot): Promise<void> {
  if (env.RBAC_CACHE_TTL_SECONDS === 0) return;
  await cache.set(
    `rbac:u:${userId}:${await versionDe(userId)}`,
    JSON.stringify(snapshot),
    env.RBAC_CACHE_TTL_SECONDS,
  );
}

/**
 * Se llama SIEMPRE que cambien los roles de un usuario, los permisos de un rol
 * que el usuario tenga, o su estado. Olvidarlo deja permisos revocados vivos
 * hasta que expire el TTL.
 */
export async function invalidarRbac(userId: string): Promise<void> {
  await cache.incr(claveVersion(userId));
}

/** Cambio en un rol: hay que invalidar a todos sus portadores. */
export async function invalidarRbacDeUsuarios(userIds: string[]): Promise<void> {
  await Promise.all(userIds.map(invalidarRbac));
}

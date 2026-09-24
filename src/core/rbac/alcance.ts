import { WILDCARD_PERMISSION } from './permissions';

/**
 * Filtrado por AMBITO, derivado de los permisos efectivos del usuario.
 *
 * Es la unica logica de comodin fuera de `authorize.ts`, y no es una puerta de
 * acceso: la puerta la sigue poniendo `requirePermissions` en el middleware
 * (CLAUDE.md §5). Esto decide, una vez ya autorizada la peticion, que
 * SUBCONJUNTO de filas puede ver el actor (p. ej. FARMACIA ve alertas de
 * `medication` pero no de `service`).
 */

/** true si el conjunto de permisos contiene el permiso pedido o el comodin. */
export function tienePermiso(permisos: ReadonlySet<string>, permiso: string): boolean {
  return permisos.has(WILDCARD_PERMISSION) || permisos.has(permiso);
}

/**
 * Claves de `mapa` cuyo permiso asociado posee el usuario.
 *
 *   alcancesPorPermiso(req.auth!.permissions, ALERT_SCOPE_PERMISSION)
 *   // => ['medication'] para un actor que solo tiene medications:read
 */
export function alcancesPorPermiso<T extends string>(
  permisos: ReadonlySet<string>,
  mapa: Readonly<Record<T, string>>,
): T[] {
  // Type guard en vez de `as T[]` (CLAUDE.md §11): `Object.keys` siempre
  // devuelve `string[]`, pero toda clave de `mapa` es, por construccion, una
  // `T`; el guard se lo demuestra al compilador sin callarlo con una asercion.
  const esClaveDeMapa = (clave: string): clave is T =>
    Object.prototype.hasOwnProperty.call(mapa, clave);

  return Object.keys(mapa)
    .filter(esClaveDeMapa)
    .filter((clave) => tienePermiso(permisos, mapa[clave]));
}

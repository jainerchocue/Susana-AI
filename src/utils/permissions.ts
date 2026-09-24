import type { Permission } from '@/types'

/**
 * El backend reserva el comodín "*" para el rol de super-administrador
 * (no se puede asignar vía API — ver api.md, sección de roles). Cualquier
 * chequeo de permisos en la UI debe reconocerlo como "todos los permisos",
 * o un superadmin real vería la aplicación vacía.
 */
export function hasPermission(permissions: Permission[], required: Permission): boolean {
  return permissions.includes('*') || permissions.includes(required)
}

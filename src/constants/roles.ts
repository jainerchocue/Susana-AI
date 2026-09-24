/**
 * Los roles son dinámicos (administrables vía POST /roles). Este mapa es solo
 * una traducción "amigable" best-effort para los roles de sistema conocidos;
 * cualquier rol no listado aquí se muestra tal cual llega del backend.
 */
export const KNOWN_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  DIRECTOR: 'Director',
  JEFE_SERVICIO: 'Jefe de Servicio',
  FARMACIA: 'Farmacia',
  ANALISTA: 'Analista',
  CONSULTA: 'Consulta',
}

export function roleLabel(role: string): string {
  return KNOWN_ROLE_LABELS[role] ?? role
}

/**
 * CATALOGO DE PERMISOS. Fuente de verdad.
 *
 * Reglas:
 *  - Formato obligatorio "recurso:accion", en minusculas.
 *  - Agregar un permiso = agregarlo aqui y correr `npm run db:seed`.
 *  - Nunca escribir el string suelto en una ruta: usar PERMISSIONS.x.y.
 */

export const PERMISSIONS = {
  users: {
    read: 'users:read',
    create: 'users:create',
    update: 'users:update',
    delete: 'users:delete',
    assignRoles: 'users:assign-roles',
  },
  roles: {
    read: 'roles:read',
    create: 'roles:create',
    update: 'roles:update',
    delete: 'roles:delete',
    assignPermissions: 'roles:assign-permissions',
  },
  permissions: {
    read: 'permissions:read',
  },
  audit: {
    read: 'audit:read',
  },
  system: {
    manage: 'system:manage',
  },
  dashboard: {
    read: 'dashboard:read',
  },
  analytics: {
    read: 'analytics:read',
    export: 'analytics:export',
  },
  assistant: {
    use: 'assistant:use',
    advanced: 'assistant:advanced',
  },
  medications: {
    read: 'medications:read',
    manage: 'medications:manage',
  },
  alerts: {
    read: 'alerts:read',
    manage: 'alerts:manage',
  },
  services: {
    read: 'services:read',
  },
  surgeries: {
    read: 'surgeries:read',
  },
  patients: {
    /// Sensible: cada lectura se audita como `data.sensitive.read` (CRUD HIS, TC2).
    read: 'patients:read',
  },
  data: {
    /// Subir CSV por `/imports/*` (TC1).
    import: 'data:import',
    /// Crear/editar/borrar registros HIS: patients, admissions, triages,
    /// service-records, procedures, surgery-schedules y dispenses (TC2-TC4).
    manage: 'data:manage',
  },
} as const;

/** Comodin: quien lo tiene pasa cualquier chequeo de permisos. */
export const WILDCARD_PERMISSION = '*';

/**
 * Aplana un nivel de objeto (T[keyof T]) distribuyendo sobre T si es una
 * union. Con `keyof` normal, `keyof (A | B)` da la INTERSECCION de las claves
 * de A y B: bastaba mientras todos los grupos de PERMISSIONS compartieran
 * "read", pero un grupo como `system` (solo "manage") la vacia y colapsa todo
 * a `never`. La condicional distributiva evita el problema.
 */
type Values<T> = T extends unknown ? T[keyof T] : never;

export type PermissionAction = typeof WILDCARD_PERMISSION | Values<Values<typeof PERMISSIONS>>;

export interface PermissionDefinition {
  action: string;
  group: string;
  description: string;
}

const DESCRIPTIONS: Record<string, string> = {
  'users:read': 'Ver usuarios',
  'users:create': 'Crear usuarios',
  'users:update': 'Editar usuarios',
  'users:delete': 'Eliminar usuarios',
  'users:assign-roles': 'Asignar roles a usuarios',
  'roles:read': 'Ver roles',
  'roles:create': 'Crear roles',
  'roles:update': 'Editar roles',
  'roles:delete': 'Eliminar roles',
  'roles:assign-permissions': 'Asignar permisos a roles',
  'permissions:read': 'Ver el catalogo de permisos',
  'audit:read': 'Consultar el registro de auditoria',
  'system:manage': 'Administracion total del sistema',
  'dashboard:read': 'Ver el panel general del hospital',
  'analytics:read': 'Ver analitica e indicadores',
  'analytics:export': 'Exportar datos de analitica',
  'assistant:use': 'Usar el asistente de IA',
  'assistant:advanced': 'Consultas avanzadas del asistente (mas cupo y detalle)',
  'medications:read': 'Ver inventario de medicamentos e insumos',
  'medications:manage': 'Gestionar alertas de medicamentos e insumos',
  'alerts:read': 'Ver alertas operativas',
  'alerts:manage': 'Reconocer y resolver alertas',
  'services:read': 'Ver datos de servicios hospitalarios',
  'surgeries:read': 'Ver datos de cirugias programadas',
  'patients:read': 'Ver datos de pacientes (sensible: se audita cada lectura)',
  'data:import': 'Subir datos HIS por CSV',
  'data:manage': 'Crear, editar y borrar registros HIS',
};

/** Lista plana para el seed y para el endpoint GET /permissions. */
export const PERMISSION_LIST: PermissionDefinition[] = Object.entries(PERMISSIONS).flatMap(
  ([group, actions]) =>
    Object.values(actions).map((action) => ({
      action,
      group,
      description: DESCRIPTIONS[action] ?? action,
    })),
);

/**
 * Roles creados por el seed. isSystem = no se pueden borrar por API.
 *
 * Nombres en MAYUSCULAS_CON_GUION_BAJO: distinguen a simple vista un rol de
 * sistema (definido aqui, inmutable por API) de uno creado por un cliente
 * (minusculas, ver roles.schemas.ts). El CHECK `roles_name_formato` en BD
 * acepta ambas convenciones.
 */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: {
    name: 'SUPER_ADMIN',
    description: 'Acceso total al sistema.',
    permissions: [WILDCARD_PERMISSION],
  },
  ADMIN: {
    name: 'ADMIN',
    description: 'Administra usuarios, roles y la configuracion del hospital.',
    // Explicitos y no el comodin: la no-escalada exige poseer lo que se
    // asigna. Sin esto, ADMIN no podria dar de alta a DIRECTOR ni a FARMACIA.
    permissions: PERMISSION_LIST.map((p) => p.action),
  },
  DIRECTOR: {
    name: 'DIRECTOR',
    description: 'Direccion del hospital: panel, analitica y asistente avanzado.',
    permissions: [
      PERMISSIONS.dashboard.read,
      PERMISSIONS.analytics.read,
      PERMISSIONS.analytics.export,
      PERMISSIONS.assistant.use,
      PERMISSIONS.assistant.advanced,
      PERMISSIONS.alerts.read,
      PERMISSIONS.services.read,
      PERMISSIONS.surgeries.read,
      PERMISSIONS.medications.read,
      PERMISSIONS.patients.read,
    ] as string[],
  },
  JEFE_SERVICIO: {
    name: 'JEFE_SERVICIO',
    description: 'Jefatura de un servicio: sus alertas y su analitica.',
    // ponytail: el "ambito de su servicio" necesita la relacion usuario<->servicio
    // de los datos HIS (fase B); hasta entonces ve alertas/analitica de todos
    // los servicios, no solo el suyo.
    permissions: [
      PERMISSIONS.dashboard.read,
      PERMISSIONS.analytics.read,
      PERMISSIONS.assistant.use,
      PERMISSIONS.alerts.read,
      PERMISSIONS.alerts.manage,
      PERMISSIONS.services.read,
      PERMISSIONS.surgeries.read,
    ] as string[],
  },
  FARMACIA: {
    name: 'FARMACIA',
    description: 'Gestion de medicamentos e insumos y sus alertas.',
    permissions: [
      PERMISSIONS.medications.read,
      PERMISSIONS.medications.manage,
      PERMISSIONS.alerts.read,
      PERMISSIONS.alerts.manage,
      PERMISSIONS.assistant.use,
    ] as string[],
  },
  ANALISTA: {
    name: 'ANALISTA',
    description: 'Analitica e indicadores, sin autoridad administrativa.',
    permissions: [
      PERMISSIONS.dashboard.read,
      PERMISSIONS.analytics.read,
      PERMISSIONS.assistant.use,
      PERMISSIONS.services.read,
      PERMISSIONS.surgeries.read,
      PERMISSIONS.medications.read,
    ] as string[],
  },
  CONSULTA: {
    name: 'CONSULTA',
    description: 'Rol por defecto de una cuenta nueva: solo el panel general.',
    permissions: [PERMISSIONS.dashboard.read] as string[],
  },
} as const;

/** Rol asignado automaticamente al registrarse. */
export const DEFAULT_ROLE = SYSTEM_ROLES.CONSULTA.name;

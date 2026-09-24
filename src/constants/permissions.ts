/**
 * Permisos reales del backend (GET /permissions expone el catálogo completo de 25;
 * aquí solo se listan los que esta UI necesita para sus guardas de RequirePermission).
 */
export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard:read',
  ANALYTICS_READ: 'analytics:read',
  ANALYTICS_EXPORT: 'analytics:export',
  MEDICATIONS_READ: 'medications:read',
  MEDICATIONS_MANAGE: 'medications:manage',
  SERVICES_READ: 'services:read',
  SURGERIES_READ: 'surgeries:read',
  ALERTS_READ: 'alerts:read',
  ALERTS_MANAGE: 'alerts:manage',
  ASSISTANT_USE: 'assistant:use',
  ASSISTANT_ADVANCED: 'assistant:advanced',
  USERS_READ: 'users:read',
  ROLES_READ: 'roles:read',
  AUDIT_READ: 'audit:read',
} as const

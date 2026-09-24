import { PERMISSIONS, ROUTES } from '@/constants'
import type { Permission } from '@/types'
import {
  IconAlertTriangle,
  IconBell,
  IconBuilding,
  IconCalendar,
  IconCapsule,
  IconChartLine,
  IconChat,
  IconClipboard,
  IconGrid,
  IconKey,
  IconListChecks,
  IconSettings,
  IconUpload,
  IconUser,
  IconUsers,
} from '@/components/ui/icons'
import type { ComponentType, SVGProps } from 'react'

export type NavGroup = 'General' | 'Clínico' | 'Datos' | 'Administración'

export interface NavItem {
  label: string
  path: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Sin permiso => visible para cualquier usuario autenticado (p. ej. Configuración, que solo exige sesión válida). */
  permission?: Permission
  /** Sin grupo => se renderiza suelto (hoy solo Configuración). */
  group?: NavGroup
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: ROUTES.DASHBOARD, icon: IconGrid, permission: PERMISSIONS.DASHBOARD_READ, group: 'General' },
  { label: 'Analítica', path: ROUTES.ANALYTICS, icon: IconChartLine, permission: PERMISSIONS.ANALYTICS_READ, group: 'General' },
  { label: 'Alertas', path: ROUTES.ALERTS, icon: IconBell, permission: PERMISSIONS.ALERTS_READ, group: 'General' },
  { label: 'Asistente IA', path: ROUTES.ASSISTANT, icon: IconChat, permission: PERMISSIONS.ASSISTANT_USE, group: 'General' },

  { label: 'Pacientes', path: ROUTES.PATIENTS, icon: IconUser, permission: PERMISSIONS.PATIENTS_READ, group: 'Clínico' },
  { label: 'Ingresos', path: ROUTES.ADMISSIONS, icon: IconListChecks, permission: PERMISSIONS.SERVICES_READ, group: 'Clínico' },
  { label: 'Triages', path: ROUTES.TRIAGES, icon: IconAlertTriangle, permission: PERMISSIONS.SERVICES_READ, group: 'Clínico' },
  { label: 'Servicios prestados', path: ROUTES.SERVICE_RECORDS, icon: IconBuilding, permission: PERMISSIONS.SERVICES_READ, group: 'Clínico' },
  { label: 'Cirugías', path: ROUTES.SURGERY_SCHEDULES, icon: IconCalendar, permission: PERMISSIONS.SURGERIES_READ, group: 'Clínico' },
  { label: 'Procedimientos', path: ROUTES.PROCEDURES, icon: IconClipboard, permission: PERMISSIONS.SERVICES_READ, group: 'Clínico' },
  { label: 'Medicamentos', path: ROUTES.MEDICATIONS, icon: IconCapsule, permission: PERMISSIONS.MEDICATIONS_READ, group: 'Clínico' },
  { label: 'Servicios', path: ROUTES.SERVICES, icon: IconBuilding, permission: PERMISSIONS.SERVICES_READ, group: 'Clínico' },

  { label: 'Importar datos', path: ROUTES.IMPORTS, icon: IconUpload, permission: PERMISSIONS.DATA_IMPORT, group: 'Datos' },

  { label: 'Usuarios', path: ROUTES.USERS, icon: IconUsers, permission: PERMISSIONS.USERS_READ, group: 'Administración' },
  { label: 'Roles', path: ROUTES.ROLES, icon: IconKey, permission: PERMISSIONS.ROLES_READ, group: 'Administración' },

  { label: 'Configuración', path: ROUTES.SETTINGS, icon: IconSettings },
]

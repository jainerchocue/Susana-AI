import { PERMISSIONS, ROUTES } from '@/constants'
import type { Permission } from '@/types'
import {
  IconBell,
  IconBuilding,
  IconCapsule,
  IconChartLine,
  IconChat,
  IconGrid,
  IconSettings,
} from '@/components/ui/icons'
import type { ComponentType, SVGProps } from 'react'

export interface NavItem {
  label: string
  path: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Sin permiso => visible para cualquier usuario autenticado (p. ej. Configuración, que solo exige sesión válida). */
  permission?: Permission
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: ROUTES.DASHBOARD, icon: IconGrid, permission: PERMISSIONS.DASHBOARD_READ },
  { label: 'Analítica', path: ROUTES.ANALYTICS, icon: IconChartLine, permission: PERMISSIONS.ANALYTICS_READ },
  { label: 'Medicamentos', path: ROUTES.MEDICATIONS, icon: IconCapsule, permission: PERMISSIONS.MEDICATIONS_READ },
  { label: 'Servicios', path: ROUTES.SERVICES, icon: IconBuilding, permission: PERMISSIONS.SERVICES_READ },
  { label: 'Alertas', path: ROUTES.ALERTS, icon: IconBell, permission: PERMISSIONS.ALERTS_READ },
  { label: 'Asistente IA', path: ROUTES.ASSISTANT, icon: IconChat, permission: PERMISSIONS.ASSISTANT_USE },
  { label: 'Configuración', path: ROUTES.SETTINGS, icon: IconSettings },
]

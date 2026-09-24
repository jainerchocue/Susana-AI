import type { ComponentType, SVGProps } from 'react'
import {
  IconAlertTriangle,
  IconBuilding,
  IconCalendar,
  IconCapsule,
  IconClock,
  IconListChecks,
  IconUser,
} from '@/components/ui/icons'
import type { BadgeTone } from '@/components/ui/Badge'
import type { ImportStatus, ImportTable } from '@/types'

export interface ImportTableMeta {
  label: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const IMPORT_TABLE_META: Record<ImportTable, ImportTableMeta> = {
  patients: { label: 'Pacientes', description: 'Datos demográficos y de identificación.', icon: IconUser },
  admissions: { label: 'Ingresos', description: 'Admisiones y movimientos hospitalarios.', icon: IconListChecks },
  triages: { label: 'Triages', description: 'Clasificación y nivel de urgencia.', icon: IconAlertTriangle },
  'first-care': { label: 'Primera atención', description: 'Fecha de primera atención por ingreso.', icon: IconClock },
  'service-records': { label: 'Servicios prestados', description: 'Procedimientos y consultas realizadas.', icon: IconBuilding },
  dispenses: { label: 'Dispensaciones', description: 'Entregas de medicamentos e insumos.', icon: IconCapsule },
  'surgery-schedules': { label: 'Cirugías', description: 'Programación de cirugías.', icon: IconCalendar },
}

export const IMPORT_TABLE_ORDER: ImportTable[] = [
  'patients',
  'admissions',
  'triages',
  'first-care',
  'service-records',
  'dispenses',
  'surgery-schedules',
]

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  PENDING: 'Pendiente',
  RUNNING: 'Procesando',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
}

export const IMPORT_STATUS_TONE: Record<ImportStatus, BadgeTone> = {
  PENDING: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'good',
  FAILED: 'critical',
}

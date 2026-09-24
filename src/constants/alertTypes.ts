import { formatNumber, formatPercent } from '@/utils/format'

export interface AlertTypeInfo {
  label: string
  /** Explica en lenguaje llano qué mide esta alerta y por qué se disparó. */
  description: string
  /** Sugerencia de siguiente paso para quien gestiona la alerta. */
  recommendedAction: string
}

/** Contexto por tipo de alerta conocido (motor de reglas en alerts.engine.ts del backend). */
const ALERT_TYPE_INFO: Record<string, AlertTypeInfo> = {
  LOW_STOCK: {
    label: 'Stock bajo',
    description:
      'Los días de inventario restantes del medicamento cayeron por debajo del umbral seguro, calculado a partir del consumo reciente.',
    recommendedAction: 'Revisar el inventario del medicamento y generar una orden de reabastecimiento antes de que se agote.',
  },
  HIGH_OCCUPANCY: {
    label: 'Ocupación alta',
    description: 'El porcentaje de camas ocupadas del servicio superó el umbral configurado, lo que indica riesgo de saturación.',
    recommendedAction: 'Revisar altas pendientes, camas disponibles y evaluar la derivación de pacientes a otros servicios.',
  },
  LONG_WAIT: {
    label: 'Espera prolongada',
    description: 'El tiempo mediano de espera en triage superó el umbral definido, lo que puede afectar la atención oportuna.',
    recommendedAction: 'Revisar la asignación de personal en triage y priorizar pacientes según su nivel de urgencia.',
  },
  DEMAND_SPIKE: {
    label: 'Pico de demanda',
    description: 'La variación de la demanda del servicio frente al periodo anterior superó el umbral esperado.',
    recommendedAction: 'Verificar la causa del incremento (estacional, evento, brote) y ajustar la capacidad si es necesario.',
  },
  SURGERY_CANCELLATIONS: {
    label: 'Cancelaciones quirúrgicas',
    description: 'El porcentaje de cirugías canceladas superó el umbral esperado para el periodo evaluado.',
    recommendedAction: 'Revisar las causas de cancelación (insumos, disponibilidad de quirófano, paciente) y coordinar con el equipo quirúrgico.',
  },
}

const FALLBACK_INFO: AlertTypeInfo = {
  label: '',
  description: 'No hay información adicional disponible para este tipo de alerta.',
  recommendedAction: 'Revisar la métrica asociada y validar con el equipo responsable del ámbito afectado.',
}

export function alertTypeLabel(type: string): string {
  return ALERT_TYPE_INFO[type]?.label ?? type
}

/** Contexto y siguiente paso sugerido para el modal de detalle de una alerta. */
export function alertTypeInfo(type: string): AlertTypeInfo {
  return ALERT_TYPE_INFO[type] ?? { ...FALLBACK_INFO, label: type }
}

interface MetricInfo {
  label: string
  unit: '%' | 'días' | 'min'
}

/** Traducción de las métricas crudas del motor de reglas (alerts.engine.ts#MetricKey) a etiquetas legibles. */
const METRIC_INFO: Record<string, MetricInfo> = {
  'medication.daysOfInventory': { label: 'Días de inventario', unit: 'días' },
  'service.occupancyPct': { label: 'Ocupación del servicio', unit: '%' },
  'triage.waitMinutesP50': { label: 'Tiempo de espera (mediana)', unit: 'min' },
  'service.demandChangePct': { label: 'Variación de demanda', unit: '%' },
  'surgery.cancellationPct': { label: 'Cancelaciones quirúrgicas', unit: '%' },
}

export function alertMetricLabel(metric: string): string {
  return METRIC_INFO[metric]?.label ?? metric
}

export function formatAlertMetricValue(metric: string, value: number): string {
  const unit = METRIC_INFO[metric]?.unit
  if (unit === '%') return formatPercent(value)
  if (unit === 'días') return `${formatNumber(value)} días`
  if (unit === 'min') return `${formatNumber(value)} min`
  return formatNumber(value)
}

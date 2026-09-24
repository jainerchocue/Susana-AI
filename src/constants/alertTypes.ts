/** Traducción best-effort de los tipos de alerta conocidos (motor de reglas en alerts.job.ts). */
const KNOWN_ALERT_TYPE_LABELS: Record<string, string> = {
  LOW_STOCK: 'Stock bajo',
  HIGH_OCCUPANCY: 'Ocupación alta',
  DEMAND_SPIKE: 'Pico de demanda',
  SURGERY_CANCELLATIONS: 'Cancelaciones quirúrgicas',
}

export function alertTypeLabel(type: string): string {
  return KNOWN_ALERT_TYPE_LABELS[type] ?? type
}

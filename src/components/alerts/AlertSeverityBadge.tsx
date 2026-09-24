import type { AlertSeverity } from '@/types'
import { Badge, type BadgeTone } from '@/components/ui'

const SEVERITY_CONFIG: Record<string, { tone: BadgeTone; label: string }> = {
  CRITICAL: { tone: 'critical', label: 'Crítica' },
  WARNING: { tone: 'medium', label: 'Advertencia' },
}

export interface AlertSeverityBadgeProps {
  severity: AlertSeverity
  pulse?: boolean
}

export function AlertSeverityBadge({ severity, pulse }: AlertSeverityBadgeProps) {
  // Defensivo: si el backend agrega una severidad nueva, la mostramos tal cual en vez de romper la fila.
  const { tone, label } = SEVERITY_CONFIG[severity] ?? { tone: 'neutral', label: severity }
  return (
    <Badge tone={tone} pulse={pulse}>
      {label}
    </Badge>
  )
}

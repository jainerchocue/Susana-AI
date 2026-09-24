import type { AlertStatus } from '@/types'
import { Badge, type BadgeTone } from '@/components/ui'

const STATUS_CONFIG: Record<string, { tone: BadgeTone; label: string }> = {
  OPEN: { tone: 'high', label: 'Abierta' },
  ACKNOWLEDGED: { tone: 'info', label: 'Reconocida' },
  RESOLVED: { tone: 'good', label: 'Resuelta' },
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const { tone, label } = STATUS_CONFIG[status] ?? { tone: 'neutral', label: status }
  return <Badge tone={tone}>{label}</Badge>
}

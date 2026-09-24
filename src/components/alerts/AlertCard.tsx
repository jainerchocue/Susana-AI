import type { Alert, AlertStatus } from '@/types'
import { Button, Card, CardBody } from '@/components/ui'
import { alertTypeLabel } from '@/constants/alertTypes'
import { cn } from '@/utils/cn'
import { formatNumber, formatRelativeTime } from '@/utils/format'
import { AlertSeverityBadge } from './AlertSeverityBadge'
import { AlertStatusBadge } from './AlertStatusBadge'

const BORDER_COLOR_BY_SEVERITY: Record<string, string> = {
  CRITICAL: 'border-l-status-critical',
  WARNING: 'border-l-status-medium',
}
const DEFAULT_BORDER_COLOR = 'border-l-surface-100'

export interface AlertCardProps {
  alert: Alert
  canManage?: boolean
  /** PATCH /alerts/{id} { status } — solo ACKNOWLEDGED o RESOLVED son transiciones válidas desde la UI. */
  onUpdateStatus?: (id: string, status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'>) => void
  isUpdating?: boolean
}

export function AlertCard({ alert, canManage, onUpdateStatus, isUpdating }: AlertCardProps) {
  return (
    <Card
      interactive
      className={cn('animate-fade-up border-l-4', BORDER_COLOR_BY_SEVERITY[alert.severity] ?? DEFAULT_BORDER_COLOR)}
    >
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AlertSeverityBadge severity={alert.severity} pulse={alert.severity === 'CRITICAL' && alert.status === 'OPEN'} />
            <AlertStatusBadge status={alert.status} />
            <h3 className="text-sm font-semibold text-ink-950">{alertTypeLabel(alert.type)}</h3>
          </div>
          <span className="shrink-0 text-xs text-ink-500">{formatRelativeTime(alert.lastSeenAt)}</span>
        </div>

        <p className="text-sm text-ink-700">{alert.message}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
          <span>
            <span className="font-medium text-ink-700">Ámbito:</span> {alert.scope}
            {alert.scopeId ? ` (${alert.scopeId})` : ''}
          </span>
          <span>
            <span className="font-medium text-ink-700">Métrica:</span> {alert.metric} = {formatNumber(alert.value)}{' '}
            (umbral {formatNumber(alert.threshold)})
          </span>
        </div>

        {alert.status !== 'RESOLVED' && canManage && (
          <div className="flex justify-end gap-2">
            {alert.status === 'OPEN' && (
              <Button
                size="sm"
                variant="secondary"
                isLoading={isUpdating}
                onClick={() => onUpdateStatus?.(alert.id, 'ACKNOWLEDGED')}
              >
                Reconocer
              </Button>
            )}
            <Button size="sm" isLoading={isUpdating} onClick={() => onUpdateStatus?.(alert.id, 'RESOLVED')}>
              Resolver
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

import type { ReactNode } from 'react'
import type { Alert, AlertStatus } from '@/types'
import { Button, Modal } from '@/components/ui'
import { IconCheck, IconEye } from '@/components/ui/icons'
import { alertMetricLabel, alertTypeInfo, alertTypeLabel, formatAlertMetricValue } from '@/constants/alertTypes'
import { formatDateTime } from '@/utils/format'
import { AlertSeverityBadge } from './AlertSeverityBadge'
import { AlertStatusBadge } from './AlertStatusBadge'

export interface AlertDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  alert: Alert | null
  canManage?: boolean
  onUpdateStatus?: (id: string, status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'>) => void
  isUpdating?: boolean
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 text-sm text-ink-900">{value}</p>
    </div>
  )
}

/**
 * Detalle/preview de una alerta: además de lo que ya muestra la tabla (severidad,
 * estado, métrica), explica QUÉ significa el tipo de alerta, cuál es el umbral que
 * se cruzó y una línea de tiempo completa — contexto que antes solo vivía en el
 * mensaje truncado de la fila.
 */
export function AlertDetailModal({ open, onOpenChange, alert, canManage, onUpdateStatus, isUpdating }: AlertDetailModalProps) {
  const info = alertTypeInfo(alert?.type ?? '')

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={alert ? alertTypeLabel(alert.type) : ''} description={alert?.scope} size="lg">
      {alert && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <AlertSeverityBadge severity={alert.severity} pulse={alert.severity === 'CRITICAL' && alert.status === 'OPEN'} />
            <AlertStatusBadge status={alert.status} />
          </div>

          <p className="rounded-lg bg-surface-50 px-3 py-2.5 text-sm text-ink-900">{alert.message}</p>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">¿Qué significa esta alerta?</p>
            <p className="text-sm text-ink-700">{info.description}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-lg border border-surface-100 p-4 sm:grid-cols-2">
            <Field label="Ámbito" value={alert.scopeId ? `${alert.scope} (${alert.scopeId})` : alert.scope} />
            <Field label={alertMetricLabel(alert.metric)} value={formatAlertMetricValue(alert.metric, alert.value)} />
            <Field label="Umbral configurado" value={formatAlertMetricValue(alert.metric, alert.threshold)} />
            <Field label="Primera vez detectada" value={formatDateTime(alert.firstSeenAt)} />
            <Field label="Última actualización" value={formatDateTime(alert.lastSeenAt)} />
            <Field label="Reconocida" value={alert.acknowledgedAt ? formatDateTime(alert.acknowledgedAt) : '—'} />
            <Field label="Resuelta" value={alert.resolvedAt ? formatDateTime(alert.resolvedAt) : '—'} />
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-brand-700">Acción recomendada</p>
            <p className="text-sm text-brand-900">{info.recommendedAction}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
            {canManage && alert.status !== 'RESOLVED' && (
              <>
                {alert.status === 'OPEN' && (
                  <Button
                    type="button"
                    variant="secondary"
                    isLoading={isUpdating}
                    onClick={() => onUpdateStatus?.(alert.id, 'ACKNOWLEDGED')}
                  >
                    <IconEye className="h-4 w-4" />
                    Reconocer
                  </Button>
                )}
                <Button type="button" isLoading={isUpdating} onClick={() => onUpdateStatus?.(alert.id, 'RESOLVED')}>
                  <IconCheck className="h-4 w-4" />
                  Resolver
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

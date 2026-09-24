import type { Alert, AlertStatus } from '@/types'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { getDisplayErrorMessage } from '@/utils/errors'
import { AlertCard } from './AlertCard'

export interface AlertsListProps {
  alerts: Alert[]
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  onRetry?: () => void
  canManage?: boolean
  onUpdateStatus?: (id: string, status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'>) => void
  updatingId?: string | null
}

export function AlertsList({
  alerts,
  isLoading,
  isError,
  error,
  onRetry,
  canManage,
  onUpdateStatus,
  updatingId,
}: AlertsListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (isError) {
    return <ErrorState description={getDisplayErrorMessage(error)} onRetry={onRetry} />
  }

  if (alerts.length === 0) {
    return (
      <EmptyState
        title="No hay alertas"
        description="No se encontraron alertas que coincidan con los filtros actuales."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {alerts.map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          canManage={canManage}
          onUpdateStatus={onUpdateStatus}
          isUpdating={updatingId === alert.id}
        />
      ))}
    </div>
  )
}

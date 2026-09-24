import { AlertsList } from '@/components/alerts'
import { Button, PageHeader, Select, type SelectOption } from '@/components/ui'
import { useAlertsCenter } from '@/features/alerts/hooks/useAlertsCenter'
import type { AlertSeverity, AlertStatus } from '@/types'

const STATUS_OPTIONS: SelectOption[] = [
  { label: 'Abierta', value: 'OPEN' },
  { label: 'Reconocida', value: 'ACKNOWLEDGED' },
  { label: 'Resuelta', value: 'RESOLVED' },
]

const SEVERITY_OPTIONS: SelectOption[] = [
  { label: 'Crítica', value: 'CRITICAL' },
  { label: 'Advertencia', value: 'WARNING' },
]

export default function AlertsPage() {
  const {
    alerts,
    pagination,
    isLoading,
    isError,
    error,
    refetch,
    hasPrev,
    goNext,
    goPrev,
    status,
    setStatus,
    severity,
    setSeverity,
    updateStatus,
    updatingId,
    canManage,
  } = useAlertsCenter()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alertas Operativas"
        description="Hospital Susana López de Valencia — seguimiento de alertas por estado y severidad."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Estado"
          options={STATUS_OPTIONS}
          placeholder="Todos los estados"
          value={status ?? ''}
          onChange={(event) => setStatus(event.target.value === '' ? null : (event.target.value as AlertStatus))}
        />
        <Select
          label="Severidad"
          options={SEVERITY_OPTIONS}
          placeholder="Todas las severidades"
          value={severity ?? ''}
          onChange={(event) =>
            setSeverity(event.target.value === '' ? null : (event.target.value as AlertSeverity))
          }
        />
      </div>

      <AlertsList
        alerts={alerts}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        canManage={canManage}
        onUpdateStatus={updateStatus}
        updatingId={updatingId}
      />

      {!isLoading && !isError && alerts.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={goPrev} disabled={!hasPrev}>
            Anterior
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={goNext} disabled={!pagination?.hasNext}>
            Siguiente
          </Button>
        </div>
      )}
    </div>
  )
}

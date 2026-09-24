import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { AlertSeverityBadge } from '@/components/alerts/AlertSeverityBadge'
import { AlertStatusBadge } from '@/components/alerts/AlertStatusBadge'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Button, PageHeader, Select, type SelectOption } from '@/components/ui'
import { IconCheck, IconEye } from '@/components/ui/icons'
import { alertTypeLabel } from '@/constants/alertTypes'
import { useAlertsCenter } from '@/features/alerts/hooks/useAlertsCenter'
import type { Alert, AlertSeverity, AlertStatus } from '@/types'
import { formatNumber, formatRelativeTime } from '@/utils/format'

const STATUS_LABELS: Record<AlertStatus, string> = {
  OPEN: 'Abierta',
  ACKNOWLEDGED: 'Reconocida',
  RESOLVED: 'Resuelta',
}

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  CRITICAL: 'Crítica',
  WARNING: 'Advertencia',
}

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
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    hasPrev,
    hasNext,
    currentPage,
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

  const activeFilters = [
    status && { key: 'status', label: `Estado: ${STATUS_LABELS[status]}`, onClear: () => setStatus(null) },
    severity && { key: 'severity', label: `Severidad: ${SEVERITY_LABELS[severity]}`, onClear: () => setSeverity(null) },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

  const columns: DataTableColumn<Alert>[] = [
    {
      id: 'severity',
      header: 'Severidad',
      cell: (row) => <AlertSeverityBadge severity={row.severity} pulse={row.severity === 'CRITICAL' && row.status === 'OPEN'} />,
    },
    { id: 'status', header: 'Estado', cell: (row) => <AlertStatusBadge status={row.status} /> },
    {
      id: 'type',
      header: 'Alerta',
      cell: (row) => (
        <div>
          <p className="font-medium text-ink-950">{alertTypeLabel(row.type)}</p>
          <p className="max-w-xs truncate text-xs text-ink-500">{row.message}</p>
        </div>
      ),
    },
    {
      id: 'scope',
      header: 'Ámbito',
      cell: (row) => (
        <span>
          {row.scope}
          {row.scopeId ? ` (${row.scopeId})` : ''}
        </span>
      ),
    },
    {
      id: 'metric',
      header: 'Métrica',
      cell: (row) => (
        <span>
          {row.metric} = {formatNumber(row.value)} <span className="text-ink-500">(umbral {formatNumber(row.threshold)})</span>
        </span>
      ),
    },
    { id: 'lastSeenAt', header: 'Última vez', cell: (row) => formatRelativeTime(row.lastSeenAt) },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: Alert) =>
              row.status === 'RESOLVED' ? null : (
                <div className="flex items-center gap-1">
                  {row.status === 'OPEN' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={updatingId === row.id}
                      onClick={() => updateStatus(row.id, 'ACKNOWLEDGED')}
                    >
                      <IconEye className="h-4 w-4" />
                      Reconocer
                    </Button>
                  )}
                  <Button size="sm" isLoading={updatingId === row.id} onClick={() => updateStatus(row.id, 'RESOLVED')}>
                    <IconCheck className="h-4 w-4" />
                    Resolver
                  </Button>
                </div>
              ),
          } satisfies DataTableColumn<Alert>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alertas Operativas"
        description="Hospital Susana López de Valencia — seguimiento de alertas por estado y severidad."
      />

      <div className="flex flex-col gap-3">
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
        <ActiveFilterChips filters={activeFilters} isFetching={isFetching && !isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={alerts}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay alertas que coincidan con los filtros actuales."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        currentPage={currentPage}
        onPrev={goPrev}
        onNext={goNext}
      />
    </div>
  )
}

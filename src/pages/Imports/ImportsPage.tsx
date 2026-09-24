import { useState } from 'react'
import { Badge, Button, Modal, PageHeader, Select, Tooltip, type SelectOption } from '@/components/ui'
import { IconEye, IconTrash, IconUpload } from '@/components/ui/icons'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { useImportJobs } from '@/features/imports/hooks/useImportJobs'
import { useImportJobDetail } from '@/features/imports/hooks/useImportJobDetail'
import { useDeleteImportJob } from '@/features/imports/hooks/useUploadImport'
import { ImportWizard } from '@/features/imports/components/ImportWizard'
import { ImportJobDetailView } from '@/features/imports/components/ImportJobDetailView'
import {
  IMPORT_STATUS_LABELS,
  IMPORT_STATUS_TONE,
  IMPORT_TABLE_META,
  IMPORT_TABLE_ORDER,
} from '@/features/imports/tableMeta'
import type { ImportJob, ImportStatus, ImportTable } from '@/types'
import { formatBytes, formatRelativeTime } from '@/utils/format'

const STATUS_OPTIONS: SelectOption[] = (Object.keys(IMPORT_STATUS_LABELS) as ImportStatus[]).map((status) => ({
  label: IMPORT_STATUS_LABELS[status],
  value: status,
}))

const TABLE_OPTIONS: SelectOption[] = IMPORT_TABLE_ORDER.map((table) => ({
  label: IMPORT_TABLE_META[table].label,
  value: table,
}))

const ACTIVE_STATUSES = new Set<ImportStatus>(['PENDING', 'RUNNING'])

export default function ImportsPage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null)

  const {
    jobs,
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
    table,
    setTable,
  } = useImportJobs()
  const { job: liveSelectedJob } = useImportJobDetail(selectedJob?.id ?? null)
  const { remove, deletingId } = useDeleteImportJob()

  const activeFilters = [
    status && { key: 'status', label: `Estado: ${IMPORT_STATUS_LABELS[status]}`, onClear: () => setStatus(null) },
    table && { key: 'table', label: `Tabla: ${IMPORT_TABLE_META[table].label}`, onClear: () => setTable(null) },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

  const columns: DataTableColumn<ImportJob>[] = [
    {
      id: 'table',
      header: 'Tabla',
      cell: (row) => {
        const meta = IMPORT_TABLE_META[row.table]
        return (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-ink-500">
              <meta.icon className="h-4 w-4" />
            </span>
            {meta.label}
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (row) => (
        <Badge tone={IMPORT_STATUS_TONE[row.status]} pulse={row.status === 'RUNNING'}>
          {IMPORT_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    { id: 'fileName', header: 'Archivo', cell: (row) => row.fileName ?? 'Sin nombre' },
    { id: 'fileBytes', header: 'Tamaño', cell: (row) => formatBytes(row.fileBytes) },
    { id: 'inserted', header: 'Insertados', cell: (row) => `${row.inserted} de ${row.processed}` },
    { id: 'createdAt', header: 'Creado', cell: (row) => formatRelativeTime(row.createdAt) },
    {
      id: 'actions',
      header: 'Acciones',
      cell: (row) => {
        const isBusy = ACTIVE_STATUSES.has(row.status)
        return (
          <div className="flex items-center gap-1">
            <Tooltip label="Ver detalle">
              <Button type="button" size="sm" variant="ghost" aria-label="Ver detalle" onClick={() => setSelectedJob(row)}>
                <IconEye className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip label={isBusy ? 'No se puede eliminar mientras se procesa' : 'Eliminar registro'}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Eliminar registro"
                disabled={isBusy}
                isLoading={deletingId === row.id}
                onClick={() => remove(row.id)}
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Importar datos masivos"
        description="Hospital Susana López de Valencia — cargue archivos CSV/HIS para poblar pacientes, ingresos, triages y más."
        actions={
          <Button type="button" onClick={() => setIsWizardOpen(true)}>
            <IconUpload className="h-4 w-4" />
            Nueva importación
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Estado"
            options={STATUS_OPTIONS}
            placeholder="Todos los estados"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value === '' ? null : (event.target.value as ImportStatus))}
          />
          <Select
            label="Tabla"
            options={TABLE_OPTIONS}
            placeholder="Todas las tablas"
            value={table ?? ''}
            onChange={(event) => setTable(event.target.value === '' ? null : (event.target.value as ImportTable))}
          />
        </div>
        <ActiveFilterChips filters={activeFilters} isFetching={isFetching && !isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={jobs}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No se encontraron trabajos de importación."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        currentPage={currentPage}
        onPrev={goPrev}
        onNext={goNext}
      />

      <Modal open={isWizardOpen} onOpenChange={setIsWizardOpen} title="Nueva importación" size="lg">
        <ImportWizard onDone={() => setIsWizardOpen(false)} />
      </Modal>

      <Modal
        open={selectedJob !== null}
        onOpenChange={(open) => !open && setSelectedJob(null)}
        title={selectedJob ? IMPORT_TABLE_META[selectedJob.table].label : ''}
        description={selectedJob?.fileName ?? undefined}
      >
        <ImportJobDetailView job={liveSelectedJob ?? selectedJob} />
      </Modal>
    </div>
  )
}

import { useState } from 'react'
import { Button, Modal, PageHeader, Select, type SelectOption } from '@/components/ui'
import { IconUpload } from '@/components/ui/icons'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { useImportJobs } from '@/features/imports/hooks/useImportJobs'
import { useImportJobDetail } from '@/features/imports/hooks/useImportJobDetail'
import { useDeleteImportJob } from '@/features/imports/hooks/useUploadImport'
import { ImportWizard } from '@/features/imports/components/ImportWizard'
import { ImportJobsList } from '@/features/imports/components/ImportJobsList'
import { ImportJobDetailView } from '@/features/imports/components/ImportJobDetailView'
import { IMPORT_STATUS_LABELS, IMPORT_TABLE_META, IMPORT_TABLE_ORDER } from '@/features/imports/tableMeta'
import type { ImportJob, ImportStatus, ImportTable } from '@/types'

const STATUS_OPTIONS: SelectOption[] = (Object.keys(IMPORT_STATUS_LABELS) as ImportStatus[]).map((status) => ({
  label: IMPORT_STATUS_LABELS[status],
  value: status,
}))

const TABLE_OPTIONS: SelectOption[] = IMPORT_TABLE_ORDER.map((table) => ({
  label: IMPORT_TABLE_META[table].label,
  value: table,
}))

export default function ImportsPage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null)

  const { jobs, pagination, isLoading, isFetching, isError, error, refetch, hasPrev, goNext, goPrev, status, setStatus, table, setTable } =
    useImportJobs()
  const { job: liveSelectedJob } = useImportJobDetail(selectedJob?.id ?? null)
  const { remove, deletingId } = useDeleteImportJob()

  const activeFilters = [
    status && { key: 'status', label: `Estado: ${IMPORT_STATUS_LABELS[status]}`, onClear: () => setStatus(null) },
    table && { key: 'table', label: `Tabla: ${IMPORT_TABLE_META[table].label}`, onClear: () => setTable(null) },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

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

      <ImportJobsList
        jobs={jobs}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        onSelect={setSelectedJob}
        onDelete={remove}
        deletingId={deletingId}
      />

      {!isLoading && !isError && jobs.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={goPrev} disabled={!hasPrev}>
            Anterior
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={goNext} disabled={!pagination?.hasNext}>
            Siguiente
          </Button>
        </div>
      )}

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

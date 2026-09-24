import type { MouseEvent } from 'react'
import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Skeleton, Tooltip } from '@/components/ui'
import { IconTrash } from '@/components/ui/icons'
import { IMPORT_STATUS_LABELS, IMPORT_STATUS_TONE, IMPORT_TABLE_META } from '../tableMeta'
import type { ImportJob } from '@/types'
import { formatBytes, formatRelativeTime } from '@/utils/format'
import { getDisplayErrorMessage } from '@/utils/errors'

const ACTIVE_STATUSES = new Set(['PENDING', 'RUNNING'])

export interface ImportJobsListProps {
  jobs: ImportJob[]
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  onRetry?: () => void
  onSelect: (job: ImportJob) => void
  onDelete: (id: string) => void
  deletingId?: string | null
}

export function ImportJobsList({ jobs, isLoading, isError, error, onRetry, onSelect, onDelete, deletingId }: ImportJobsListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (isError) {
    return <ErrorState description={getDisplayErrorMessage(error)} onRetry={onRetry} />
  }

  if (jobs.length === 0) {
    return <EmptyState title="Sin importaciones" description="No se encontraron trabajos que coincidan con los filtros actuales." />
  }

  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job) => {
        const meta = IMPORT_TABLE_META[job.table]
        const isBusy = ACTIVE_STATUSES.has(job.status)

        function handleDelete(event: MouseEvent) {
          event.stopPropagation()
          onDelete(job.id)
        }

        return (
          <Card
            key={job.id}
            interactive
            role="button"
            tabIndex={0}
            onClick={() => onSelect(job)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(job)
              }
            }}
            className="animate-fade-up cursor-pointer"
          >
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-ink-500">
                  <meta.icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-ink-950">{meta.label}</h3>
                    <Badge tone={IMPORT_STATUS_TONE[job.status]} pulse={job.status === 'RUNNING'}>
                      {IMPORT_STATUS_LABELS[job.status]}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-ink-500">
                    {job.fileName ?? 'Sin nombre'} · {formatBytes(job.fileBytes)} · {formatRelativeTime(job.createdAt)}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                <div className="text-right text-xs text-ink-500">
                  <p className="text-sm font-semibold text-ink-950">{job.inserted}</p>
                  <p>de {job.processed} insertados</p>
                </div>
                <Tooltip label={isBusy ? 'No se puede eliminar mientras se procesa' : 'Eliminar registro'}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    isLoading={deletingId === job.id}
                    aria-label="Eliminar registro"
                    onClick={handleDelete}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

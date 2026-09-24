import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Badge, Button, PageHeader, Tooltip } from '@/components/ui'
import { IconEdit, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { useTriages } from '@/features/triages/hooks/useTriages'
import { TriageFormModal } from '@/features/triages/components/TriageFormModal'
import type { Triage } from '@/types'
import { formatDateTime } from '@/utils/format'

const LEVEL_TONE: Record<number, 'critical' | 'high' | 'medium' | 'good' | 'neutral'> = {
  1: 'critical',
  2: 'high',
  3: 'medium',
  4: 'good',
  5: 'neutral',
}

export default function TriagesPage() {
  const canManage = useAuthStore((state) => state.hasPermission(PERMISSIONS.DATA_MANAGE))
  const {
    triages,
    isLoading,
    isError,
    error,
    refetch,
    hasPrev,
    hasNext,
    goNext,
    goPrev,
    create,
    isCreating,
    update,
    isUpdating,
    remove,
    deletingId,
  } = useTriages()

  const [editing, setEditing] = useState<Triage | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const columns: DataTableColumn<Triage>[] = [
    { id: 'id', header: 'ID', cell: (row) => <span className="font-mono text-xs">{row.id}</span> },
    {
      id: 'level',
      header: 'Nivel',
      cell: (row) =>
        row.level ? <Badge tone={LEVEL_TONE[row.level] ?? 'neutral'}>Nivel {row.level}</Badge> : <Badge tone="neutral">Sin nivel</Badge>,
    },
    { id: 'classification', header: 'Clasificación', cell: (row) => row.classification },
    { id: 'code', header: 'Código', cell: (row) => row.code },
    { id: 'patientId', header: 'Paciente', cell: (row) => row.patientId ?? '—' },
    { id: 'triagedAt', header: 'Fecha', cell: (row) => formatDateTime(row.triagedAt) },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: Triage) => (
              <div className="flex items-center gap-1">
                <Tooltip label="Editar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar triage ${row.id}`}
                    onClick={() => {
                      setEditing(row)
                      setIsModalOpen(true)
                    }}
                  >
                    <IconEdit className="h-4 w-4" />
                  </Button>
                </Tooltip>
                <Tooltip label="Eliminar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Eliminar triage ${row.id}`}
                    isLoading={deletingId === row.id}
                    onClick={() => remove(row.id)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ),
          } satisfies DataTableColumn<Triage>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Triages"
        description="Clasificación y signos vitales registrados en la puerta de urgencias."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo triage
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={triages}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay triages registrados."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={goPrev}
        onNext={goNext}
      />

      <TriageFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        triage={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
    </div>
  )
}

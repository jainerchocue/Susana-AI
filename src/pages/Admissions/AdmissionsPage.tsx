import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Badge, Button, PageHeader, Tooltip } from '@/components/ui'
import { IconEdit, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { useAdmissions } from '@/features/admissions/hooks/useAdmissions'
import { AdmissionFormModal } from '@/features/admissions/components/AdmissionFormModal'
import type { Admission } from '@/types'
import { formatDateTime } from '@/utils/format'

export default function AdmissionsPage() {
  const canManage = useAuthStore((state) => state.hasPermission(PERMISSIONS.DATA_MANAGE))
  const {
    admissions,
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
    create,
    isCreating,
    update,
    isUpdating,
    remove,
    deletingId,
  } = useAdmissions()

  const [editing, setEditing] = useState<Admission | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const columns: DataTableColumn<Admission>[] = [
    { id: 'id', header: 'ID', cell: (row) => <span className="font-mono text-xs">{row.id}</span> },
    { id: 'patientId', header: 'Paciente', cell: (row) => row.patientId },
    { id: 'admissionClass', header: 'Clase', cell: (row) => row.admissionClass },
    { id: 'unit', header: 'Unidad', cell: (row) => `${row.unit} / ${row.subunit}` },
    { id: 'bed', header: 'Cama', cell: (row) => `${row.bedName}${row.virtualBed ? ' (virtual)' : ''}` },
    { id: 'admittedAt', header: 'Ingreso', cell: (row) => formatDateTime(row.admittedAt) },
    {
      id: 'firstCareAt',
      header: 'Primera atención',
      cell: (row) => (row.firstCareAt ? formatDateTime(row.firstCareAt) : <Badge tone="neutral">Pendiente</Badge>),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: Admission) => (
              <div className="flex items-center gap-1">
                <Tooltip label="Editar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar ingreso ${row.id}`}
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
                    aria-label={`Eliminar ingreso ${row.id}`}
                    isLoading={deletingId === row.id}
                    onClick={() => remove(row.id)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ),
          } satisfies DataTableColumn<Admission>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ingresos"
        description="Admisiones hospitalarias: cama, unidad, diagnóstico y trazabilidad de atención."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo ingreso
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={admissions}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay ingresos registrados."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        currentPage={currentPage}
        onPrev={goPrev}
        onNext={goNext}
      />

      <AdmissionFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        admission={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
    </div>
  )
}

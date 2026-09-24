import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Button, PageHeader, Tooltip } from '@/components/ui'
import { IconEdit, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { usePatients } from '@/features/patients/hooks/usePatients'
import { PatientFormModal } from '@/features/patients/components/PatientFormModal'
import type { Patient } from '@/types'
import { formatNumber } from '@/utils/format'

export default function PatientsPage() {
  const canManage = useAuthStore((state) => state.hasPermission(PERMISSIONS.DATA_MANAGE))
  const {
    patients,
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
  } = usePatients()

  const [editing, setEditing] = useState<Patient | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const columns: DataTableColumn<Patient>[] = [
    { id: 'id', header: 'ID', cell: (row) => <span className="font-mono text-xs">{row.id}</span> },
    { id: 'documentType', header: 'Documento', cell: (row) => row.documentType },
    { id: 'sex', header: 'Sexo', cell: (row) => row.sex },
    { id: 'age', header: 'Edad', cell: (row) => formatNumber(row.age, 0) },
    { id: 'insurer', header: 'Aseguradora', cell: (row) => row.insurer },
    { id: 'regime', header: 'Régimen', cell: (row) => row.regime },
    {
      id: 'location',
      header: 'Ubicación',
      cell: (row) => (
        <span>
          {row.municipality}, {row.department} <span className="text-ink-500">({row.zone})</span>
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: Patient) => (
              <div className="flex items-center gap-1">
                <Tooltip label="Editar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar paciente ${row.id}`}
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
                    aria-label={`Eliminar paciente ${row.id}`}
                    isLoading={deletingId === row.id}
                    onClick={() => remove(row.id)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ),
          } satisfies DataTableColumn<Patient>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pacientes"
        description="Datos demográficos y de identificación del HIS."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo paciente
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={patients}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay pacientes registrados."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={goPrev}
        onNext={goNext}
      />

      <PatientFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        patient={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
    </div>
  )
}

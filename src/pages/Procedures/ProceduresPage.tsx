import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Button, PageHeader, Tooltip } from '@/components/ui'
import { IconEdit, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { useProcedures } from '@/features/procedures/hooks/useProcedures'
import { ProcedureFormModal } from '@/features/procedures/components/ProcedureFormModal'
import type { Procedure } from '@/types'

export default function ProceduresPage() {
  const canManage = useAuthStore((state) => state.hasPermission(PERMISSIONS.DATA_MANAGE))
  const {
    procedures,
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
    deletingCode,
  } = useProcedures()

  const [editing, setEditing] = useState<Procedure | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const columns: DataTableColumn<Procedure>[] = [
    { id: 'code', header: 'Código', cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { id: 'name', header: 'Nombre', cell: (row) => row.name },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: Procedure) => (
              <div className="flex items-center gap-1">
                <Tooltip label="Editar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar ${row.name}`}
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
                    aria-label={`Eliminar ${row.name}`}
                    isLoading={deletingCode === row.code}
                    onClick={() => remove(row.code)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ),
          } satisfies DataTableColumn<Procedure>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Procedimientos"
        description="Catálogo de procedimientos (CUPS) usado por servicios prestados y cirugías."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo procedimiento
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={procedures}
        getRowId={(row) => row.code}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay procedimientos en el catálogo."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={goPrev}
        onNext={goNext}
      />

      <ProcedureFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        procedure={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
    </div>
  )
}

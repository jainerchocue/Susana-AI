import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Button, Input, PageHeader, Tooltip } from '@/components/ui'
import { IconEdit, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { useServiceRecords } from '@/features/serviceRecords/hooks/useServiceRecords'
import { ServiceRecordFormModal } from '@/features/serviceRecords/components/ServiceRecordFormModal'
import type { ServiceRecord } from '@/types'
import { formatDateTime, formatNumber } from '@/utils/format'

export default function ServiceRecordsPage() {
  const canManage = useAuthStore((state) => state.hasPermission(PERMISSIONS.DATA_MANAGE))
  const {
    records,
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
    admissionId,
    setAdmissionId,
    area,
    setArea,
    specialty,
    setSpecialty,
    create,
    isCreating,
    update,
    isUpdating,
    remove,
    deletingId,
  } = useServiceRecords()

  const [editing, setEditing] = useState<ServiceRecord | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [admissionIdInput, setAdmissionIdInput] = useState('')
  const [areaInput, setAreaInput] = useState('')
  const [specialtyInput, setSpecialtyInput] = useState('')

  const activeFilters = [
    admissionId !== null && {
      key: 'admissionId',
      label: `Ingreso: ${admissionId}`,
      onClear: () => {
        setAdmissionId(null)
        setAdmissionIdInput('')
      },
    },
    area && { key: 'area', label: `Área: ${area}`, onClear: () => { setArea(null); setAreaInput('') } },
    specialty && {
      key: 'specialty',
      label: `Especialidad: ${specialty}`,
      onClear: () => {
        setSpecialty(null)
        setSpecialtyInput('')
      },
    },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

  const columns: DataTableColumn<ServiceRecord>[] = [
    { id: 'id', header: 'ID', cell: (row) => <span className="font-mono text-xs">{row.id}</span> },
    { id: 'admissionId', header: 'Ingreso', cell: (row) => row.admissionId },
    { id: 'procedureName', header: 'Procedimiento', cell: (row) => row.procedureName },
    { id: 'quantity', header: 'Cantidad', cell: (row) => formatNumber(row.quantity, 0) },
    { id: 'area', header: 'Área', cell: (row) => row.area },
    { id: 'specialty', header: 'Especialidad', cell: (row) => row.specialty },
    { id: 'providedAt', header: 'Fecha', cell: (row) => formatDateTime(row.providedAt) },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: ServiceRecord) => (
              <div className="flex items-center gap-1">
                <Tooltip label="Editar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar servicio ${row.id}`}
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
                    aria-label={`Eliminar servicio ${row.id}`}
                    isLoading={deletingId === row.id}
                    onClick={() => remove(row.id)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ),
          } satisfies DataTableColumn<ServiceRecord>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Servicios prestados"
        description="Procedimientos y consultas registrados por ingreso."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo registro
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setAdmissionId(admissionIdInput ? Number(admissionIdInput) : null)
            setArea(areaInput || null)
            setSpecialty(specialtyInput || null)
          }}
        >
          <Input
            label="ID de ingreso"
            type="number"
            value={admissionIdInput}
            onChange={(event) => setAdmissionIdInput(event.target.value)}
            className="w-36"
          />
          <Input label="Área" value={areaInput} onChange={(event) => setAreaInput(event.target.value)} className="w-40" />
          <Input
            label="Especialidad"
            value={specialtyInput}
            onChange={(event) => setSpecialtyInput(event.target.value)}
            className="w-40"
          />
          <Button type="submit" size="sm" variant="secondary">
            Filtrar
          </Button>
        </form>
        <ActiveFilterChips filters={activeFilters} isFetching={isFetching && !isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={records}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay registros de servicio que coincidan con los filtros."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        currentPage={currentPage}
        onPrev={goPrev}
        onNext={goNext}
      />

      <ServiceRecordFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        record={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
    </div>
  )
}

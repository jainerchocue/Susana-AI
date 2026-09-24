import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Badge, Button, Input, PageHeader, Select, Tooltip, type SelectOption } from '@/components/ui'
import { IconEdit, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { useSurgerySchedules } from '@/features/surgerySchedules/hooks/useSurgerySchedules'
import { SurgeryScheduleFormModal } from '@/features/surgerySchedules/components/SurgeryScheduleFormModal'
import type { SurgeryExecuted, SurgerySchedule } from '@/types'

const EXECUTED_LABELS: Record<SurgeryExecuted, string> = { si: 'Sí', no: 'No', desconocido: 'Desconocido' }
const EXECUTED_TONE: Record<SurgeryExecuted, 'good' | 'critical' | 'neutral'> = {
  si: 'good',
  no: 'critical',
  desconocido: 'neutral',
}
const EXECUTED_OPTIONS: SelectOption[] = (Object.keys(EXECUTED_LABELS) as SurgeryExecuted[]).map((key) => ({
  label: EXECUTED_LABELS[key],
  value: key,
}))

export default function SurgerySchedulesPage() {
  const canManage = useAuthStore((state) => state.hasPermission(PERMISSIONS.DATA_MANAGE))
  const {
    schedules,
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
    procedureCode,
    setProcedureCode,
    executed,
    setExecuted,
    create,
    isCreating,
    update,
    isUpdating,
    remove,
    deletingId,
  } = useSurgerySchedules()

  const [editing, setEditing] = useState<SurgerySchedule | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [procedureCodeInput, setProcedureCodeInput] = useState('')

  const activeFilters = [
    procedureCode && {
      key: 'procedureCode',
      label: `Procedimiento: ${procedureCode}`,
      onClear: () => {
        setProcedureCode(null)
        setProcedureCodeInput('')
      },
    },
    executed && { key: 'executed', label: `Ejecutada: ${EXECUTED_LABELS[executed]}`, onClear: () => setExecuted(null) },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

  const columns: DataTableColumn<SurgerySchedule>[] = [
    { id: 'id', header: 'ID', cell: (row) => <span className="font-mono text-xs">{row.id}</span> },
    { id: 'scheduleNumber', header: 'Número', cell: (row) => row.scheduleNumber },
    { id: 'patientId', header: 'Paciente', cell: (row) => row.patientId },
    { id: 'admissionId', header: 'Ingreso', cell: (row) => row.admissionId ?? '—' },
    { id: 'procedureCode', header: 'Procedimiento', cell: (row) => row.procedureCode },
    {
      id: 'executed',
      header: 'Ejecutada',
      cell: (row) => <Badge tone={EXECUTED_TONE[row.executed]}>{EXECUTED_LABELS[row.executed]}</Badge>,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: SurgerySchedule) => (
              <div className="flex items-center gap-1">
                <Tooltip label="Editar">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar cirugía ${row.id}`}
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
                    aria-label={`Eliminar cirugía ${row.id}`}
                    isLoading={deletingId === row.id}
                    onClick={() => remove(row.id)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ),
          } satisfies DataTableColumn<SurgerySchedule>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cirugías"
        description="Programación de cirugías del HIS."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Programar cirugía
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setProcedureCode(procedureCodeInput || null)
            }}
          >
            <Input
              label="Código de procedimiento"
              value={procedureCodeInput}
              onChange={(event) => setProcedureCodeInput(event.target.value)}
              className="w-48"
            />
            <Button type="submit" size="sm" variant="secondary">
              Filtrar
            </Button>
          </form>
          <Select
            label="Ejecutada"
            options={EXECUTED_OPTIONS}
            placeholder="Todas"
            value={executed ?? ''}
            onChange={(event) => setExecuted(event.target.value === '' ? null : (event.target.value as SurgeryExecuted))}
          />
        </div>
        <ActiveFilterChips filters={activeFilters} isFetching={isFetching && !isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={schedules}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay cirugías programadas que coincidan con los filtros."
        paginationMode="cursor"
        hasPrev={hasPrev}
        hasNext={hasNext}
        currentPage={currentPage}
        onPrev={goPrev}
        onNext={goNext}
      />

      <SurgeryScheduleFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        schedule={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
    </div>
  )
}

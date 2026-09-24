import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal } from '@/components/ui'
import { surgeryScheduleCreateSchema, type SurgeryScheduleFormValues } from '@/schemas/surgerySchedule.schema'
import type { SurgerySchedule, SurgeryScheduleCreateInput } from '@/types'

interface SurgeryScheduleFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule: SurgerySchedule | null
  onCreate: (values: SurgeryScheduleCreateInput) => Promise<unknown>
  onUpdate: (id: number, values: SurgeryScheduleCreateInput) => Promise<unknown>
  isSaving: boolean
}

export function SurgeryScheduleFormModal({ open, onOpenChange, schedule, onCreate, onUpdate, isSaving }: SurgeryScheduleFormModalProps) {
  const isEdit = schedule !== null

  const form = useForm<SurgeryScheduleFormValues>({
    resolver: zodResolver(surgeryScheduleCreateSchema),
    values: schedule
      ? {
          scheduleNumber: schedule.scheduleNumber,
          patientId: schedule.patientId,
          admissionId: schedule.admissionId ? String(schedule.admissionId) : '',
          procedureCode: schedule.procedureCode,
        }
      : undefined,
  })

  async function handleSubmit(values: SurgeryScheduleFormValues) {
    const payload: SurgeryScheduleCreateInput = {
      scheduleNumber: values.scheduleNumber,
      patientId: values.patientId,
      admissionId: values.admissionId ? Number(values.admissionId) : null,
      procedureCode: values.procedureCode,
    }
    if (isEdit) {
      await onUpdate(schedule.id, payload)
    } else {
      await onCreate(payload)
      form.reset()
    }
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset()
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar cirugía programada' : 'Programar cirugía'}
      description="Programación de cirugías del HIS."
    >
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(handleSubmit)}>
        {isEdit && <Input label="ID" value={schedule.id} disabled hint="Autogenerado, no editable." />}
        <Input
          label="Número de programación"
          {...form.register('scheduleNumber')}
          error={form.formState.errors.scheduleNumber?.message}
        />
        <Input
          label="ID de paciente"
          type="number"
          {...form.register('patientId', { valueAsNumber: true })}
          error={form.formState.errors.patientId?.message}
        />
        <Input label="ID de ingreso (opcional)" type="number" {...form.register('admissionId')} />
        <Input
          label="Código de procedimiento (CUPS)"
          {...form.register('procedureCode')}
          error={form.formState.errors.procedureCode?.message}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSaving}>
            {isEdit ? 'Guardar' : 'Programar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

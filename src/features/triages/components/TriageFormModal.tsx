import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal, Select, type SelectOption } from '@/components/ui'
import {
  triageCreateSchema,
  triageUpdateSchema,
  type TriageCreateFormValues,
  type TriageUpdateFormValues,
} from '@/schemas/triage.schema'
import type { Triage, TriageCreateInput, TriageUpdateInput } from '@/types'
import { fromDatetimeLocalInput, toDatetimeLocalInput } from '@/utils/datetimeInput'

const LEVEL_OPTIONS: SelectOption[] = [1, 2, 3, 4, 5].map((level) => ({ label: `Nivel ${level}`, value: String(level) }))

interface TriageFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triage: Triage | null
  onCreate: (values: TriageCreateInput) => Promise<unknown>
  onUpdate: (id: number, values: TriageUpdateInput) => Promise<unknown>
  isSaving: boolean
}

function sharedToPayload(values: TriageUpdateFormValues): Omit<TriageCreateInput, 'id'> {
  return {
    triagedAt: fromDatetimeLocalInput(values.triagedAt),
    systolic: values.systolic ? Number(values.systolic) : null,
    diastolic: values.diastolic ? Number(values.diastolic) : null,
    heartRate: values.heartRate ? Number(values.heartRate) : null,
    respiratoryRate: values.respiratoryRate ? Number(values.respiratoryRate) : null,
    temperature: values.temperature ? Number(values.temperature) : null,
    patientId: values.patientId ? Number(values.patientId) : null,
    code: values.code,
    classification: values.classification,
    level: values.level ? Number(values.level) : null,
  }
}

export function TriageFormModal({ open, onOpenChange, triage, onCreate, onUpdate, isSaving }: TriageFormModalProps) {
  const isEdit = triage !== null

  const createForm = useForm<TriageCreateFormValues>({ resolver: zodResolver(triageCreateSchema) })
  const editForm = useForm<TriageUpdateFormValues>({
    resolver: zodResolver(triageUpdateSchema),
    values: triage
      ? {
          triagedAt: toDatetimeLocalInput(triage.triagedAt),
          systolic: triage.systolic ? String(triage.systolic) : '',
          diastolic: triage.diastolic ? String(triage.diastolic) : '',
          heartRate: triage.heartRate ? String(triage.heartRate) : '',
          respiratoryRate: triage.respiratoryRate ? String(triage.respiratoryRate) : '',
          temperature: triage.temperature ? String(triage.temperature) : '',
          patientId: triage.patientId ? String(triage.patientId) : '',
          code: triage.code,
          classification: triage.classification,
          level: triage.level ? String(triage.level) : '',
        }
      : undefined,
  })

  async function handleCreateSubmit(values: TriageCreateFormValues) {
    await onCreate({ id: values.id, ...sharedToPayload(values) })
    createForm.reset()
    onOpenChange(false)
  }

  async function handleEditSubmit(values: TriageUpdateFormValues) {
    if (!triage) return
    await onUpdate(triage.id, sharedToPayload(values))
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset()
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar triage' : 'Nuevo triage'}
      description="Clasificación y signos vitales del HIS."
      size="lg"
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="ID de triage" value={triage.id} disabled hint="Clave natural del HIS, no editable." />
            <Input
              label="Fecha del triage"
              type="datetime-local"
              {...editForm.register('triagedAt')}
              error={editForm.formState.errors.triagedAt?.message}
            />
            <Input label="Código" {...editForm.register('code')} error={editForm.formState.errors.code?.message} />
            <Input
              label="Clasificación"
              {...editForm.register('classification')}
              error={editForm.formState.errors.classification?.message}
            />
            <Select label="Nivel" options={LEVEL_OPTIONS} placeholder="Sin nivel" {...editForm.register('level')} />
            <Input label="ID de paciente" type="number" {...editForm.register('patientId')} />
            <Input label="Sistólica" type="number" {...editForm.register('systolic')} />
            <Input label="Diastólica" type="number" {...editForm.register('diastolic')} />
            <Input label="Frecuencia cardíaca" type="number" {...editForm.register('heartRate')} />
            <Input label="Frecuencia respiratoria" type="number" {...editForm.register('respiratoryRate')} />
            <Input label="Temperatura" type="number" step="0.1" {...editForm.register('temperature')} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Guardar
            </Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={createForm.handleSubmit(handleCreateSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="ID de triage"
              type="number"
              {...createForm.register('id', { valueAsNumber: true })}
              error={createForm.formState.errors.id?.message}
            />
            <Input
              label="Fecha del triage"
              type="datetime-local"
              {...createForm.register('triagedAt')}
              error={createForm.formState.errors.triagedAt?.message}
            />
            <Input label="Código" {...createForm.register('code')} error={createForm.formState.errors.code?.message} />
            <Input
              label="Clasificación"
              {...createForm.register('classification')}
              error={createForm.formState.errors.classification?.message}
            />
            <Select label="Nivel" options={LEVEL_OPTIONS} placeholder="Sin nivel" {...createForm.register('level')} />
            <Input label="ID de paciente" type="number" {...createForm.register('patientId')} />
            <Input label="Sistólica" type="number" {...createForm.register('systolic')} />
            <Input label="Diastólica" type="number" {...createForm.register('diastolic')} />
            <Input label="Frecuencia cardíaca" type="number" {...createForm.register('heartRate')} />
            <Input label="Frecuencia respiratoria" type="number" {...createForm.register('respiratoryRate')} />
            <Input label="Temperatura" type="number" step="0.1" {...createForm.register('temperature')} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Crear
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

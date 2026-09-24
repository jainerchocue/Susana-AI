import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal } from '@/components/ui'
import {
  admissionCreateSchema,
  admissionUpdateSchema,
  type AdmissionCreateFormValues,
  type AdmissionUpdateFormValues,
} from '@/schemas/admission.schema'
import type { Admission, AdmissionCreateInput, AdmissionUpdateInput } from '@/types'
import { fromDatetimeLocalInput, toDatetimeLocalInput } from '@/utils/datetimeInput'

interface AdmissionFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  admission: Admission | null
  onCreate: (values: AdmissionCreateInput) => Promise<unknown>
  onUpdate: (id: number, values: AdmissionUpdateInput) => Promise<unknown>
  isSaving: boolean
}

function sharedToPayload(values: AdmissionUpdateFormValues): Omit<AdmissionCreateInput, 'id'> {
  return {
    consecutive: values.consecutive,
    patientId: values.patientId,
    admissionClass: values.admissionClass,
    entryRoute: values.entryRoute,
    riskType: values.riskType,
    admittedAt: fromDatetimeLocalInput(values.admittedAt),
    hospitalizedAt: values.hospitalizedAt ? fromDatetimeLocalInput(values.hospitalizedAt) : null,
    triageId: values.triageId ? Number(values.triageId) : null,
    bedCode: values.bedCode,
    bedName: values.bedName,
    unit: values.unit,
    subunit: values.subunit,
    diagnosisCode: values.diagnosisCode || null,
    diagnosisName: values.diagnosisName || null,
  }
}

export function AdmissionFormModal({ open, onOpenChange, admission, onCreate, onUpdate, isSaving }: AdmissionFormModalProps) {
  const isEdit = admission !== null

  const createForm = useForm<AdmissionCreateFormValues>({ resolver: zodResolver(admissionCreateSchema) })
  const editForm = useForm<AdmissionUpdateFormValues>({
    resolver: zodResolver(admissionUpdateSchema),
    values: admission
      ? {
          consecutive: admission.consecutive,
          patientId: admission.patientId,
          admissionClass: admission.admissionClass,
          entryRoute: admission.entryRoute,
          riskType: admission.riskType,
          admittedAt: toDatetimeLocalInput(admission.admittedAt),
          hospitalizedAt: toDatetimeLocalInput(admission.hospitalizedAt),
          triageId: admission.triageId ? String(admission.triageId) : '',
          bedCode: admission.bedCode,
          bedName: admission.bedName,
          unit: admission.unit,
          subunit: admission.subunit,
          diagnosisCode: admission.diagnosisCode ?? '',
          diagnosisName: admission.diagnosisName ?? '',
        }
      : undefined,
  })

  async function handleCreateSubmit(values: AdmissionCreateFormValues) {
    await onCreate({ id: values.id, ...sharedToPayload(values) })
    createForm.reset()
    onOpenChange(false)
  }

  async function handleEditSubmit(values: AdmissionUpdateFormValues) {
    if (!admission) return
    await onUpdate(admission.id, sharedToPayload(values))
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset()
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar ingreso' : 'Nuevo ingreso'}
      description="Admisión hospitalaria del HIS."
      size="lg"
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="ID de ingreso" value={admission.id} disabled hint="Clave natural del HIS, no editable." />
            <Input
              label="Consecutivo"
              type="number"
              {...editForm.register('consecutive', { valueAsNumber: true })}
              error={editForm.formState.errors.consecutive?.message}
            />
            <Input
              label="ID de paciente"
              type="number"
              {...editForm.register('patientId', { valueAsNumber: true })}
              error={editForm.formState.errors.patientId?.message}
            />
            <Input
              label="Clase de ingreso"
              {...editForm.register('admissionClass')}
              error={editForm.formState.errors.admissionClass?.message}
            />
            <Input
              label="Vía de entrada"
              {...editForm.register('entryRoute')}
              error={editForm.formState.errors.entryRoute?.message}
            />
            <Input
              label="Tipo de riesgo"
              {...editForm.register('riskType')}
              error={editForm.formState.errors.riskType?.message}
            />
            <Input
              label="Fecha de ingreso"
              type="datetime-local"
              {...editForm.register('admittedAt')}
              error={editForm.formState.errors.admittedAt?.message}
            />
            <Input label="Fecha de hospitalización" type="datetime-local" {...editForm.register('hospitalizedAt')} />
            <Input label="ID de triage vinculado" type="number" {...editForm.register('triageId')} />
            <Input label="Código de cama" {...editForm.register('bedCode')} error={editForm.formState.errors.bedCode?.message} />
            <Input label="Nombre de cama" {...editForm.register('bedName')} error={editForm.formState.errors.bedName?.message} />
            <Input label="Unidad" {...editForm.register('unit')} error={editForm.formState.errors.unit?.message} />
            <Input label="Subunidad" {...editForm.register('subunit')} error={editForm.formState.errors.subunit?.message} />
            <Input label="Código de diagnóstico" {...editForm.register('diagnosisCode')} />
            <Input label="Nombre de diagnóstico" {...editForm.register('diagnosisName')} />
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
              label="ID de ingreso"
              type="number"
              {...createForm.register('id', { valueAsNumber: true })}
              error={createForm.formState.errors.id?.message}
            />
            <Input
              label="Consecutivo"
              type="number"
              {...createForm.register('consecutive', { valueAsNumber: true })}
              error={createForm.formState.errors.consecutive?.message}
            />
            <Input
              label="ID de paciente"
              type="number"
              {...createForm.register('patientId', { valueAsNumber: true })}
              error={createForm.formState.errors.patientId?.message}
            />
            <Input
              label="Clase de ingreso"
              {...createForm.register('admissionClass')}
              error={createForm.formState.errors.admissionClass?.message}
            />
            <Input
              label="Vía de entrada"
              {...createForm.register('entryRoute')}
              error={createForm.formState.errors.entryRoute?.message}
            />
            <Input
              label="Tipo de riesgo"
              {...createForm.register('riskType')}
              error={createForm.formState.errors.riskType?.message}
            />
            <Input
              label="Fecha de ingreso"
              type="datetime-local"
              {...createForm.register('admittedAt')}
              error={createForm.formState.errors.admittedAt?.message}
            />
            <Input label="Fecha de hospitalización" type="datetime-local" {...createForm.register('hospitalizedAt')} />
            <Input label="ID de triage vinculado" type="number" {...createForm.register('triageId')} />
            <Input
              label="Código de cama"
              {...createForm.register('bedCode')}
              error={createForm.formState.errors.bedCode?.message}
            />
            <Input
              label="Nombre de cama"
              {...createForm.register('bedName')}
              error={createForm.formState.errors.bedName?.message}
            />
            <Input label="Unidad" {...createForm.register('unit')} error={createForm.formState.errors.unit?.message} />
            <Input
              label="Subunidad"
              {...createForm.register('subunit')}
              error={createForm.formState.errors.subunit?.message}
            />
            <Input label="Código de diagnóstico" {...createForm.register('diagnosisCode')} />
            <Input label="Nombre de diagnóstico" {...createForm.register('diagnosisName')} />
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

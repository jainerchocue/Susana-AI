import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal } from '@/components/ui'
import {
  serviceRecordCreateSchema,
  serviceRecordUpdateSchema,
  type ServiceRecordCreateFormValues,
  type ServiceRecordUpdateFormValues,
} from '@/schemas/serviceRecord.schema'
import type { ServiceRecord, ServiceRecordCreateInput, ServiceRecordUpdateInput } from '@/types'
import { fromDatetimeLocalInput, toDatetimeLocalInput } from '@/utils/datetimeInput'

interface ServiceRecordFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: ServiceRecord | null
  onCreate: (values: ServiceRecordCreateInput) => Promise<unknown>
  onUpdate: (id: number, values: ServiceRecordUpdateInput) => Promise<unknown>
  isSaving: boolean
}

function sharedToPayload(values: ServiceRecordUpdateFormValues): Omit<ServiceRecordCreateInput, 'id' | 'admissionId'> {
  return {
    code: values.code,
    procedureName: values.procedureName || undefined,
    quantity: values.quantity,
    providedAt: fromDatetimeLocalInput(values.providedAt),
    areaCode: values.areaCode,
    area: values.area,
    specialty: values.specialty,
  }
}

export function ServiceRecordFormModal({ open, onOpenChange, record, onCreate, onUpdate, isSaving }: ServiceRecordFormModalProps) {
  const isEdit = record !== null

  const createForm = useForm<ServiceRecordCreateFormValues>({ resolver: zodResolver(serviceRecordCreateSchema) })
  const editForm = useForm<ServiceRecordUpdateFormValues>({
    resolver: zodResolver(serviceRecordUpdateSchema),
    values: record
      ? {
          code: record.code,
          procedureName: record.procedureName,
          quantity: record.quantity,
          providedAt: toDatetimeLocalInput(record.providedAt),
          areaCode: record.areaCode,
          area: record.area,
          specialty: record.specialty,
        }
      : undefined,
  })

  async function handleCreateSubmit(values: ServiceRecordCreateFormValues) {
    await onCreate({ id: values.id, admissionId: values.admissionId, ...sharedToPayload(values) })
    createForm.reset()
    onOpenChange(false)
  }

  async function handleEditSubmit(values: ServiceRecordUpdateFormValues) {
    if (!record) return
    await onUpdate(record.id, sharedToPayload(values))
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset()
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar servicio prestado' : 'Nuevo servicio prestado'}
      description="Procedimiento o consulta realizada, vinculada a un ingreso."
      size="lg"
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="ID de registro" value={record.id} disabled hint="Clave natural del HIS, no editable." />
            <Input label="ID de ingreso" value={record.admissionId} disabled hint="No se puede reasignar." />
            <Input
              label="Código de procedimiento (CUPS)"
              {...editForm.register('code')}
              error={editForm.formState.errors.code?.message}
            />
            <Input label="Nombre del procedimiento" {...editForm.register('procedureName')} />
            <Input
              label="Cantidad"
              type="number"
              {...editForm.register('quantity', { valueAsNumber: true })}
              error={editForm.formState.errors.quantity?.message}
            />
            <Input
              label="Fecha del servicio"
              type="datetime-local"
              {...editForm.register('providedAt')}
              error={editForm.formState.errors.providedAt?.message}
            />
            <Input
              label="Código de área"
              {...editForm.register('areaCode')}
              error={editForm.formState.errors.areaCode?.message}
            />
            <Input label="Área" {...editForm.register('area')} error={editForm.formState.errors.area?.message} />
            <Input
              label="Especialidad"
              {...editForm.register('specialty')}
              error={editForm.formState.errors.specialty?.message}
            />
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
              label="ID de registro"
              type="number"
              {...createForm.register('id', { valueAsNumber: true })}
              error={createForm.formState.errors.id?.message}
            />
            <Input
              label="ID de ingreso"
              type="number"
              {...createForm.register('admissionId', { valueAsNumber: true })}
              error={createForm.formState.errors.admissionId?.message}
            />
            <Input
              label="Código de procedimiento (CUPS)"
              {...createForm.register('code')}
              error={createForm.formState.errors.code?.message}
            />
            <Input
              label="Nombre del procedimiento"
              {...createForm.register('procedureName')}
              hint="Solo obligatorio si el código no existe aún en el catálogo."
            />
            <Input
              label="Cantidad"
              type="number"
              {...createForm.register('quantity', { valueAsNumber: true })}
              error={createForm.formState.errors.quantity?.message}
            />
            <Input
              label="Fecha del servicio"
              type="datetime-local"
              {...createForm.register('providedAt')}
              error={createForm.formState.errors.providedAt?.message}
            />
            <Input
              label="Código de área"
              {...createForm.register('areaCode')}
              error={createForm.formState.errors.areaCode?.message}
            />
            <Input label="Área" {...createForm.register('area')} error={createForm.formState.errors.area?.message} />
            <Input
              label="Especialidad"
              {...createForm.register('specialty')}
              error={createForm.formState.errors.specialty?.message}
            />
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

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal } from '@/components/ui'
import {
  procedureCreateSchema,
  procedureUpdateSchema,
  type ProcedureCreateFormValues,
  type ProcedureUpdateFormValues,
} from '@/schemas/procedure.schema'
import type { Procedure } from '@/types'

interface ProcedureFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  procedure: Procedure | null
  onCreate: (values: ProcedureCreateFormValues) => Promise<unknown>
  onUpdate: (code: string, values: ProcedureUpdateFormValues) => Promise<unknown>
  isSaving: boolean
}

export function ProcedureFormModal({ open, onOpenChange, procedure, onCreate, onUpdate, isSaving }: ProcedureFormModalProps) {
  const isEdit = procedure !== null

  const createForm = useForm<ProcedureCreateFormValues>({ resolver: zodResolver(procedureCreateSchema) })
  const editForm = useForm<ProcedureUpdateFormValues>({
    resolver: zodResolver(procedureUpdateSchema),
    values: procedure ? { name: procedure.name } : undefined,
  })

  async function handleCreateSubmit(values: ProcedureCreateFormValues) {
    await onCreate(values)
    createForm.reset()
    onOpenChange(false)
  }

  async function handleEditSubmit(values: ProcedureUpdateFormValues) {
    if (!procedure) return
    await onUpdate(procedure.code, values)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset()
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar procedimiento' : 'Nuevo procedimiento'}
      description="Catálogo de procedimientos (CUPS)."
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <Input label="Código" value={procedure.code} disabled hint="El código es la clave del catálogo y no se puede editar." />
          <Input label="Nombre" {...editForm.register('name')} error={editForm.formState.errors.name?.message} />
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
          <Input label="Código" {...createForm.register('code')} error={createForm.formState.errors.code?.message} />
          <Input label="Nombre" {...createForm.register('name')} error={createForm.formState.errors.name?.message} />
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

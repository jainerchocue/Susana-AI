import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal } from '@/components/ui'
import { roleCreateSchema, roleUpdateSchema, type RoleCreateFormValues, type RoleUpdateFormValues } from '@/schemas/role.schema'
import type { Role, RoleCreateInput, RoleUpdateInput } from '@/types'

interface RoleFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
  onCreate: (values: RoleCreateInput) => Promise<unknown>
  onUpdate: (id: string, values: RoleUpdateInput) => Promise<unknown>
  isSaving: boolean
}

export function RoleFormModal({ open, onOpenChange, role, onCreate, onUpdate, isSaving }: RoleFormModalProps) {
  const isEdit = role !== null

  const createForm = useForm<RoleCreateFormValues>({
    resolver: zodResolver(roleCreateSchema),
    defaultValues: { name: '', description: '', permissions: [] },
  })
  const editForm = useForm<RoleUpdateFormValues>({
    resolver: zodResolver(roleUpdateSchema),
    values: role ? { name: role.name, description: role.description ?? '' } : undefined,
  })

  async function handleCreateSubmit(values: RoleCreateFormValues) {
    await onCreate(values)
    createForm.reset({ name: '', description: '', permissions: [] })
    onOpenChange(false)
  }

  async function handleEditSubmit(values: RoleUpdateFormValues) {
    if (!role) return
    await onUpdate(role.id, values)
    onOpenChange(false)
  }

  if (role?.isSystem) {
    return (
      <Modal open={open} onOpenChange={onOpenChange} title="Rol de sistema">
        <p className="text-sm text-ink-500">Los roles de sistema son inmutables y no se pueden editar desde la API.</p>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset({ name: '', description: '', permissions: [] })
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar rol' : 'Nuevo rol'}
      description="Los permisos se asignan por separado, desde 'Editar permisos'."
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <Input label="Nombre" {...editForm.register('name')} error={editForm.formState.errors.name?.message} />
          <Input label="Descripción" {...editForm.register('description')} />
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
          <Input label="Nombre" {...createForm.register('name')} error={createForm.formState.errors.name?.message} />
          <Input label="Descripción" {...createForm.register('description')} />
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

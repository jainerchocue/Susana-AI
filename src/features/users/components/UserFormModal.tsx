import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { Button, Input, Modal, Select } from '@/components/ui'
import { useAllRoles } from '@/features/roles/hooks/useRoles'
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateFormValues,
  type UserUpdateFormValues,
} from '@/schemas/user.schema'
import type { AdminUser, UserCreateInput, UserUpdateInput } from '@/types'

const STATUS_OPTIONS = [
  { label: 'Activo', value: 'ACTIVE' },
  { label: 'Suspendido', value: 'SUSPENDED' },
  { label: 'Eliminado', value: 'DELETED' },
]

interface UserFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUser | null
  onCreate: (values: UserCreateInput) => Promise<unknown>
  onUpdate: (id: string, values: UserUpdateInput) => Promise<unknown>
  isSaving: boolean
}

export function UserFormModal({ open, onOpenChange, user, onCreate, onUpdate, isSaving }: UserFormModalProps) {
  const isEdit = user !== null
  const { roles: availableRoles } = useAllRoles()

  const createForm = useForm<UserCreateFormValues>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { email: '', password: '', name: '', roles: [] },
  })
  const editForm = useForm<UserUpdateFormValues>({
    resolver: zodResolver(userUpdateSchema),
    values: user ? { name: user.name, status: user.status } : undefined,
  })

  async function handleCreateSubmit(values: UserCreateFormValues) {
    await onCreate(values)
    createForm.reset({ email: '', password: '', name: '', roles: [] })
    onOpenChange(false)
  }

  async function handleEditSubmit(values: UserUpdateFormValues) {
    if (!user) return
    await onUpdate(user.id, values)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset({ email: '', password: '', name: '', roles: [] })
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar usuario' : 'Nuevo usuario'}
      description="Cuenta de acceso al sistema."
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <Input label="Correo" value={user.email} disabled hint="El correo no se puede editar aquí." />
          <Input label="Nombre" {...editForm.register('name')} error={editForm.formState.errors.name?.message} />
          <Select label="Estado" options={STATUS_OPTIONS} {...editForm.register('status')} />
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
          <Input label="Correo" type="email" {...createForm.register('email')} error={createForm.formState.errors.email?.message} />
          <Input
            label="Contraseña"
            type="password"
            {...createForm.register('password')}
            error={createForm.formState.errors.password?.message}
            hint="Mínimo 12 caracteres."
          />
          <Input label="Nombre" {...createForm.register('name')} error={createForm.formState.errors.name?.message} />

          {availableRoles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-700">Roles</span>
              <Controller
                control={createForm.control}
                name="roles"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {availableRoles.map((role) => {
                      const checked = field.value.includes(role.name)
                      return (
                        <label
                          key={role.id}
                          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-surface-100 px-2.5 py-1 text-xs text-ink-700 has-checked:border-brand-600 has-checked:bg-brand-50 has-checked:text-brand-700"
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={(event) => {
                              field.onChange(
                                event.target.checked
                                  ? [...field.value, role.name]
                                  : field.value.filter((name) => name !== role.name),
                              )
                            }}
                          />
                          {role.name}
                        </label>
                      )
                    })}
                  </div>
                )}
              />
            </div>
          )}

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
